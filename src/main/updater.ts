/**
 * Updating Evi from inside Discord. Checks GitHub, through evi.rest's mirror, for the latest published
 * release (prereleases too, with betas on). Installing one downloads its evi-core.json (a few MB: Evi's
 * files, what Evi Setup downloads), checks it against the published SHA-256, writes it into the data
 * folder (coreUpdate.ts) and restarts Discord. Releases without one fall back to the installer for this
 * system (evi.exe on Windows, over 100 MB), run as `install --restart`.
 *
 * Downloading and installing are separate steps. download() stages the verified installer as
 * evi.exe.pending (with update-staged.json saying which version it is); apply() swaps it in and runs it.
 * With silent updates on, a check that finds a newer release stages it in the background, and quitting
 * Discord runs the staged installer with `--wait`: it waits for Discord to be gone, never closes it, and
 * the next start runs the new Evi.
 *
 * The installer closes Discord, so it can't be Discord's child: on Windows it's started through WMI,
 * elsewhere in a session of its own. Its output goes to logs/update.log.
 *
 * A dev build (the loader points at a repo's dist/) updates with git; it only checks.
 */
import { IPC } from "@shared/ipc";
import { EXE_ASSET, fetchReleaseApi, Flavor, flavorOf, isNewerRelease, parseRelease, pickRelease, releaseApis, ReleaseInfo, UpdateInstallResult, UpdateProgress, UpdateStatus } from "@shared/release";
import { compareVersions, isVersion } from "@shared/store";
import { mayUpdateEviUnasked } from "@shared/required";
import { installerArgs, installerCommandLine, isStagedRelevant, parseStaged, shouldApplyOnQuit, shouldStage, StagedUpdate } from "@shared/silentUpdate";
import { execFile, execFileSync, spawn } from "child_process";
import { createHash } from "crypto";
import { app, ipcMain, net, WebContents } from "electron";
import { accessSync, constants, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "fs";
import { join, resolve } from "path";

import { applyCorePayload, parseCorePayload } from "./coreUpdate";
import { mt } from "./locale";
import { DATA_DIR } from "./paths";
import { settings } from "./settings";
import { broadcast } from "./util";

/** evi.rest's mirror of GitHub's release API, then GitHub itself. EVI_UPDATE_API alone when set: tests serve fake releases from a local server */
const APIS = releaseApis(process.env.EVI_UPDATE_API);
const HEADERS = { "User-Agent": "evi-app", "Accept": "application/vnd.github+json" };
/** A check within this long is answered from memory: GitHub, when evi.rest can't answer, allows 60 unauthenticated calls an hour */
const FRESH_FOR = 10 * 60 * 1000;
const MAX_EXE_BYTES = 400 * 1024 * 1024;
const EXE = join(DATA_DIR, EXE_ASSET);
/** A downloaded, verified installer waiting to be swapped in */
const PENDING = `${EXE}.pending`;
/** Which version PENDING is, and its SHA-256 */
const STAGED = join(DATA_DIR, "update-staged.json");
/** A downloaded, verified evi-core.json waiting to be written in */
const CORE_PENDING = join(DATA_DIR, "update-core.json.pending");
const MAX_CORE_BYTES = 64 * 1024 * 1024;
const LOG = join(DATA_DIR, "logs", "update.log");

let last: UpdateStatus | undefined;
/** Whether the last check counted betas */
let lastBeta = false;
let checking: Promise<UpdateStatus> | undefined;
let installing = false;
let staging: { version: string; promise: Promise<StagedUpdate>; } | undefined;
const silentOn = () => settings.silentUpdates === true;

const DEV_BUILD_ERROR = "This Evi runs from a dev build. Update it with git pull and bun run build.";

/** Running from a repo's build output rather than the core `evi install` put in the data folder */
export function isDevBuild() {
    return resolve(globalThis.__eviCoreDir ?? "") !== resolve(DATA_DIR, "core");
}

/** Why this Discord can't update itself, if it can't. Linux packages install Discord as root */
function blockedReason(): string | undefined {
    if (isDevBuild()) return "This is a dev build: update it with git pull and bun run build.";
    if (process.platform === "win32") return;
    try {
        accessSync(process.resourcesPath, constants.W_OK);
    } catch {
        return mt("main.update.rootOwned");
    }
}

function readStaged(): StagedUpdate | undefined {
    try {
        return parseStaged(JSON.parse(readFileSync(STAGED, "utf8")));
    } catch {
        return;
    }
}

/** The staged update, if its installer is still on disk (not checked against its hash: that's for apply) */
function readyStaged() {
    const staged = readStaged();
    return staged && (existsSync(CORE_PENDING) || existsSync(PENDING) || existsSync(EXE)) ? staged : undefined;
}

function forgetStaged() {
    for (const file of [STAGED, PENDING, `${PENDING}.part`, CORE_PENDING, `${CORE_PENDING}.part`]) {
        try {
            rmSync(file, { force: true });
        } catch { }
    }
}

function sha256Of(file: string) {
    try {
        return createHash("sha256").update(readFileSync(file)).digest("hex");
    } catch {
        return;
    }
}

/** The staged file with this hash: the core, the installer still waiting as .pending, or already evi.exe (an apply whose install didn't get to run) */
function stagedFile(sha256: string) {
    return [CORE_PENDING, PENDING, EXE].find(file => existsSync(file) && sha256Of(file) === sha256);
}

/** The newest release. /releases/latest never answers with a prerelease, so betas pick from the list instead */
async function fetchLatest(beta: boolean): Promise<ReleaseInfo | null> {
    let res: Response;
    const path = beta ? "releases?per_page=30" : "releases/latest";
    try {
        res = await fetchReleaseApi(APIS, path, url => net.fetch(url, { headers: HEADERS, cache: "no-store", signal: AbortSignal.timeout(15_000) }));
    } catch (err) {
        throw new Error(mt("main.update.unreachable", { error: (err as Error).message }));
    }
    if (res.status === 404) return null;
    if (res.status === 403 || res.status === 429) throw new Error(mt("main.update.rateLimit"));
    if (!res.ok) throw new Error(mt("main.update.githubStatus", { status: res.status }));
    const json = await res.json().catch(() => null);
    const release = parseRelease(beta ? pickRelease(json, true) : json);
    if (!release) return null;
    if ("error" in release) throw new Error(release.error);
    return release;
}

/** ready when silent updates are on and this very version is staged */
function withReady(status: UpdateStatus): UpdateStatus {
    if (status.state !== "available" || !status.installable || !silentOn()) return status;
    return readyStaged()?.version === status.release.version ? { ...status, ready: true } : status;
}

export function checkForUpdate(force = false): Promise<UpdateStatus> {
    const beta = settings.betaUpdates === true;
    // Turning betas on or off makes the last answer stale
    if (!force && last && lastBeta === beta && Date.now() - last.checkedAt < FRESH_FOR) return Promise.resolve(withReady(last));
    checking ??= (async (): Promise<UpdateStatus> => {
        const current = EVI_VERSION;
        const checkedAt = Date.now();
        lastBeta = beta;
        try {
            // Only ever forward: with betas off again, someone on 0.5.0-beta.1 waits for 0.5.0 rather than going back
            const release = await fetchLatest(beta);
            if (!release) return { state: "none", current, checkedAt };
            if (!isNewerRelease(release.tag, current)) return { state: "current", current, latest: release.version, checkedAt };
            const blocked = blockedReason();
            return { state: "available", current, release, installable: !blocked, ...blocked && { blocked }, checkedAt };
        } catch (err) {
            return { state: "error", current, error: (err as Error).message, checkedAt };
        }
    })().then(status => {
        last = withReady(status);
        stageInBackground(last);
        return last;
    }).finally(() => void (checking = undefined));
    return checking;
}

async function fetchBytes(url: string, max: number, onProgress?: (done: number, total: number) => void) {
    const res = await net.fetch(url, { headers: { "User-Agent": HEADERS["User-Agent"] }, cache: "no-store" });
    if (!res.ok || !res.body) throw new Error(mt("main.update.downloadFailed", { status: res.status }));
    const total = Number(res.headers.get("content-length")) || 0;
    if (total > max) throw new Error(mt("main.update.tooLarge"));
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let done = 0;
    while (true) {
        const { done: end, value } = await reader.read();
        if (end) break;
        done += value.length;
        if (done > max) throw new Error(mt("main.update.tooLarge"));
        chunks.push(value);
        onProgress?.(done, total);
    }
    return Buffer.concat(chunks);
}

/**
 * Downloads the release's installer, checks it against the published SHA-256 and stages it as
 * evi.exe.pending. Idempotent: an installer already on disk with that hash isn't downloaded again,
 * and a download of the same version already running is joined.
 */
function download(release: ReleaseInfo, report?: (progress: UpdateProgress) => void): Promise<StagedUpdate> {
    if (staging?.version === release.version) return staging.promise;
    const promise = (async () => {
        report?.({ phase: "downloading", done: 0 });
        // Evi's files alone when the release has them, else the whole installer
        const core = !!(release.coreUrl && release.coreChecksumUrl);
        const [url, checksumUrl, target, max] = core
            ? [release.coreUrl!, release.coreChecksumUrl!, CORE_PENDING, MAX_CORE_BYTES]
            : [release.exeUrl!, release.checksumUrl!, PENDING, MAX_EXE_BYTES];
        const checksum = (await fetchBytes(checksumUrl, 4096)).toString("utf8").match(/\b[a-f0-9]{64}\b/i)?.[0].toLowerCase();
        if (!checksum) throw new Error(mt("main.update.noChecksum"));
        const staged = { version: release.version, sha256: checksum };

        if (!stagedFile(checksum)) {
            rmSync(target, { force: true });
            const bytes = await fetchBytes(url, max, (done, total) => report?.({ phase: "downloading", done, total }));
            report?.({ phase: "verifying" });
            const actual = createHash("sha256").update(bytes).digest("hex");
            if (actual !== checksum) throw new Error(mt("main.update.mismatch"));
            if (core) parseCorePayload(bytes.toString("utf8"));
            mkdirSync(DATA_DIR, { recursive: true });
            // Written beside, then renamed: a half-written file is never taken for the update
            try {
                writeFileSync(`${target}.part`, bytes, { mode: 0o755 });
                renameSync(`${target}.part`, target);
            } catch (err) {
                rmSync(`${target}.part`, { force: true });
                throw err;
            }
        }
        writeFileSync(STAGED, JSON.stringify(staged));
        return staged;
    })().finally(() => {
        if (staging?.promise === promise) staging = undefined;
    });
    staging = { version: release.version, promise };
    return promise;
}

/** With silent updates on, a newer release downloads quietly; the Updates tab hears when it's ready */
function stageInBackground(status: UpdateStatus) {
    if (installing || status.state !== "available" || !shouldStage(silentOn(), status, readyStaged())) return;
    const { version } = status.release;
    download(status.release).then(() => {
        console.log(`[Evi] Evi ${version} is downloaded and installs when Discord quits`);
        if (last?.state === "available" && last.release.version === version) last = withReady(last);
        broadcast(IPC.UPDATE_READY, version);
    }, err => console.warn(`[Evi] Couldn’t download Evi ${version} in the background:`, (err as Error).message));
}

/** PowerShell asking WMI to start a hidden process that isn't Discord's child */
function wmiArgs(commandLine: string) {
    const ps = [
        "$si = New-CimInstance -ClassName Win32_ProcessStartup -ClientOnly -Property @{ ShowWindow = [uint16]0 }",
        `$r = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = '${commandLine.replace(/'/g, "''")}'; ProcessStartupInformation = $si }`,
        "exit $r.ReturnValue",
    ].join("; ");
    return ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", Buffer.from(ps, "utf16le").toString("base64")];
}

/** Starts a command line as its own process, outside Discord's, hidden. Resolves once it's running. */
function launchDetached(commandLine: string) {
    if (process.platform !== "win32") {
        return new Promise<void>((done, fail) => {
            const child = spawn("/bin/sh", ["-c", commandLine], { detached: true, stdio: "ignore" });
            child.once("error", err => fail(new Error(`Couldn’t start the installer (${err.message})`)));
            child.once("spawn", () => {
                child.unref();
                done();
            });
        });
    }
    return new Promise<void>((done, fail) => {
        execFile("powershell.exe", wmiArgs(commandLine), { windowsHide: true, timeout: 30_000 }, err => {
            if (err) fail(new Error(`Couldn’t start the installer (${(err as any).code ?? err.message})`));
            else done();
        });
    });
}

/**
 * The same, finished before returning: for will-quit, where Discord exits as soon as the handler returns
 * and would take a child still starting the installer down with it.
 */
function launchDetachedNow(commandLine: string) {
    if (process.platform !== "win32") {
        const child = spawn("/bin/sh", ["-c", commandLine], { detached: true, stdio: "ignore" });
        child.on("error", err => console.error("[Evi] Couldn’t start the installer", err));
        child.unref();
        return;
    }
    execFileSync("powershell.exe", wmiArgs(commandLine), { windowsHide: true, timeout: 20_000, stdio: "ignore" });
}

/** Puts the staged installer in place as evi.exe, ready to run */
function swapIn(staged: StagedUpdate) {
    const file = stagedFile(staged.sha256);
    if (!file) {
        forgetStaged();
        throw new Error(mt("main.update.damaged"));
    }
    if (file === PENDING) {
        try {
            // Still locked if the installer from the last update is somehow running: then it just stays
            rmSync(`${EXE}.old`, { force: true });
            renameSync(EXE, `${EXE}.old`);
        } catch { }
        renameSync(PENDING, EXE);
    }
    rmSync(STAGED, { force: true });
    mkdirSync(join(DATA_DIR, "logs"), { recursive: true });
}

const commandLineFor = (flavor: Flavor, mode: "restart" | "on-exit") => installerCommandLine(EXE, installerArgs(flavor, mode), LOG, process.platform);

/** Writes a staged evi-core.json in, if that's what's staged. Synchronous, for will-quit too */
function applyStagedCore(staged: StagedUpdate) {
    if (stagedFile(staged.sha256) !== CORE_PENDING) return false;
    applyCorePayload(parseCorePayload(readFileSync(CORE_PENDING, "utf8")));
    forgetStaged();
    return true;
}

/** Installs the staged update and restarts Discord: the core in place and a relaunch, or the installer's `install --restart` */
async function applyWithRestart(staged: StagedUpdate, flavor: Flavor) {
    if (applyStagedCore(staged)) {
        // After the answer reaches the page, which says Discord is restarting
        setTimeout(() => {
            app.relaunch();
            app.exit(0);
        }, 800);
        return;
    }
    swapIn(staged);
    await launchDetached(commandLineFor(flavor, "restart"));
}

/** Installs the staged update as Discord quits: the core right away, or the installer's `install --wait`. Synchronous, for will-quit */
function applyOnExit(staged: StagedUpdate, flavor: Flavor) {
    if (applyStagedCore(staged)) return;
    swapIn(staged);
    launchDetachedNow(commandLineFor(flavor, "on-exit"));
}

/**
 * A required update: downloads the latest release now, as long as it's at least `minimum`. Only with
 * automatic updates on (shared/required.ts): checked here too, not only in the page, so nothing in
 * Discord's page can start an unasked update. The page then restarts Discord when nobody's in a call
 * (install(), which finds it already downloaded); quitting Discord before that installs it too, as
 * any automatic update does.
 */
async function prepare(minimum: unknown): Promise<UpdateInstallResult> {
    if (!isVersion(minimum)) return { ok: false, error: "No version given" };
    if (!mayUpdateEviUnasked(settings)) return { ok: false, error: mt("main.update.automaticOff") };
    if (isDevBuild()) return { ok: false, error: DEV_BUILD_ERROR };
    const blocked = blockedReason();
    if (blocked) return { ok: false, error: blocked };
    try {
        const status = await checkForUpdate(true);
        if (status.state === "error") return { ok: false, error: status.error };
        if (status.state !== "available") return { ok: false, error: mt("main.update.noRequired", { version: minimum }) };
        if (compareVersions(status.release.version.replace(/-.*$/, ""), minimum) < 0) return { ok: false, error: mt("main.update.noRequired", { version: minimum }) };
        // No progress to the page: its Updates tab would take it for an install under way
        const staged = await download(status.release);
        console.log(`[Evi] Evi ${staged.version} is required: downloaded, installs on restart or quit`);
        return { ok: true, version: staged.version };
    } catch (err) {
        return { ok: false, error: (err as Error).message };
    }
}

async function install(sender: WebContents): Promise<UpdateInstallResult> {
    const report = (progress: UpdateProgress) => {
        if (!sender.isDestroyed()) sender.send(IPC.UPDATE_PROGRESS, progress);
    };
    if (isDevBuild()) return { ok: false, error: DEV_BUILD_ERROR };
    const blocked = blockedReason();
    if (blocked) return { ok: false, error: blocked };
    if (installing) return { ok: false, error: mt("main.update.already") };
    const flavor = flavorOf(process.execPath);
    if (!flavor) return { ok: false, error: mt("main.update.unknownDiscord") };

    installing = true;
    try {
        const status = await checkForUpdate(true);
        if (status.state !== "available") return { ok: false, error: status.state === "error" ? status.error : "There’s no newer version" };
        const { release } = status;

        const staged = await download(release, report);
        report({ phase: "installing" });
        await applyWithRestart(staged, flavor);
        console.log(`[Evi] Updating to ${release.version}: the installer restarts Discord`);
        return { ok: true, version: release.version };
    } catch (err) {
        return { ok: false, error: (err as Error).message };
    } finally {
        installing = false;
    }
}

/**
 * On quit, a staged update installs. will-quit, not before-quit: it comes once every window has closed
 * and nothing can call the quit off any more, and neither fires when Discord's window closes to the tray.
 */
function applyOnQuit() {
    const staged = readStaged();
    const flavor = flavorOf(process.execPath);
    if (installing || !shouldApplyOnQuit({ enabled: silentOn(), staged, running: EVI_VERSION, blocked: blockedReason(), flavor })) return;
    try {
        applyOnExit(staged!, flavor!);
        console.log(`[Evi] Installing Evi ${staged!.version} now that Discord is quitting`);
    } catch (err) {
        console.error("[Evi] Couldn’t install the downloaded update", err);
    }
}

export function initUpdater() {
    // Installed, or older than what runs now (betas turned off, installed by hand): not needed any more
    if (!isStagedRelevant(readStaged(), EVI_VERSION)) forgetStaged();
    else {
        // A background download cut off by quitting
        try {
            rmSync(`${PENDING}.part`, { force: true });
            rmSync(`${CORE_PENDING}.part`, { force: true });
        } catch { }
    }

    ipcMain.handle(IPC.UPDATE_CHECK, (_, force: unknown) => checkForUpdate(force === true));
    ipcMain.handle(IPC.UPDATE_INSTALL, e => install(e.sender));
    ipcMain.handle(IPC.UPDATE_PREPARE, (_e, minimum: unknown) => prepare(minimum));
    app.on("will-quit", applyOnQuit);
}
