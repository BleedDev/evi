/**
 * Integration test of the main process + preload in real Electron, against a fake Discord install
 * that mimics the real layout. Never touches your actual Discord.
 *
 *   fake-discord/
 *     app-1.0.0/                       a copy of the Electron runtime, standing in for Discord.exe
 *     app-1.0.0/resources/_app.asar/  stand-in Discord (a folder, which Electron loads like an asar)
 *     app-1.0.0/resources/app.asar    our loader archive
 *     app-1.0.1/resources/app.asar/   a "freshly updated" version the loader should take over
 *
 *   bun scripts/test-electron.ts
 */
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "fs";
import { join, resolve } from "path";

import { parseBackup } from "../src/shared/backup";
import { createShimAsar, ORIGINAL_ASAR } from "../src/shared/shim";
import { disablePasskeys } from "./no-passkeys.ts";

const ROOT = resolve(import.meta.dir, "..");
const BASE = join(ROOT, "test-results", "electron");
const INSTALL = join(BASE, "fake-discord");
const DATA = join(BASE, "data");
const ELECTRON_DIST = join(ROOT, "node_modules", "electron", "dist");
// Electron derives the userData folder from the app name. Never "discord": that is the real Discord profile.
// Overridable so parallel runs (e.g. several worktrees) never share a profile. Never "discord".
const APP_NAME = process.env.EVI_TEST_APP_NAME ?? "evi-integration-test";
if (APP_NAME.toLowerCase().startsWith("discord")) throw new Error("Refusing to run as a Discord app name: that is the real Discord profile");

rmSync(BASE, { recursive: true, force: true });

// Plugin store: a local fake registry over https, never the real network

const CERT_DIR = join(BASE, "tls");
mkdirSync(CERT_DIR, { recursive: true });
// A throwaway self-signed certificate for 127.0.0.1. The fake Discord trusts it for that host only.
const openssl = Bun.spawnSync(["openssl", "req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1", "-nodes",
    "-keyout", join(CERT_DIR, "key.pem"), "-out", join(CERT_DIR, "cert.pem"), "-days", "2",
    "-subj", "/CN=127.0.0.1", "-addext", "subjectAltName=IP:127.0.0.1"]);
if (openssl.exitCode !== 0) throw new Error(`openssl couldn't make a test certificate: ${openssl.stderr.toString()}`);

const sha256 = (text: string) => Bun.CryptoHasher.hash("sha256", text, "hex");
const storePlugin = (version: string) => ({
    manifest: JSON.stringify({ id: "store-good", name: "Store Good", version }),
    "index.js": `module.exports = { default: { start(ctx) { window.__storeGood = "${version}"; ctx.onDispose(() => window.__storeGoodDisposed = (window.__storeGoodDisposed || 0) + 1); } } };`,
});
let goodVersion = "1.0.0";
const storeFiles: Record<string, string> = {};
const registryEntry = (id: string, version: string, files: Record<string, string>, extra: object = {}, served: Record<string, string> = files) => {
    const entry = {
        id, name: id, description: `Test plugin ${id}`, authors: ["Tester"], version, tags: ["test"], native: false, ...extra,
        files: Object.fromEntries(Object.entries(files).map(([name, content]) => [name, { url: "", sha256: sha256(content) }])),
    };
    for (const [name, content] of Object.entries(served)) {
        storeFiles[`/files/${id}/${version}/${name}`] = content;
        entry.files[name].url = `https://127.0.0.1:${server.port}/files/${id}/${version}/${name}`;
    }
    return entry;
};

const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    tls: { cert: Bun.file(join(CERT_DIR, "cert.pem")), key: Bun.file(join(CERT_DIR, "key.pem")) },
    fetch(req) {
        const { pathname } = new URL(req.url);
        if (pathname === "/__publish" && req.method === "POST") {
            goodVersion = "2.0.0";
            return new Response("ok");
        }
        if (pathname === "/registry.json") {
            const good = storePlugin(goodVersion);
            const tamperedIndex = "module.exports = { default: { start() { window.__tampered = true; } } };";
            const nativeManifest = JSON.stringify({ id: "store-native", name: "Store Native", version: "1.0.0", native: "native.js" });
            return Response.json({
                schema: 1,
                plugins: [
                    registryEntry("store-good", goodVersion, { "manifest.json": good.manifest, "index.js": good["index.js"] }),
                    // The registry promises one index.js, the server sends another
                    registryEntry("store-tampered", "1.0.0",
                        { "manifest.json": JSON.stringify({ id: "store-tampered", name: "Tampered" }), "index.js": tamperedIndex },
                        {},
                        { "manifest.json": JSON.stringify({ id: "store-tampered", name: "Tampered" }), "index.js": tamperedIndex.replace("true", "\"pwned\"") }),
                    registryEntry("store-native", "1.0.0", {
                        "manifest.json": nativeManifest,
                        // Hands its context to the test: page code can't reach a plugin's context otherwise
                        "index.js": "module.exports = { default: { start(ctx) { window.__storeNative = true; window.__storeNativeCtx = ctx; } } };",
                        "native.js": "module.exports = { ping: () => \"pong\" };",
                    }, { native: true }),
                    // Invalid entries are dropped, the rest still load
                    { id: "../escape", name: "Escape" },
                ],
            });
        }
        const content = storeFiles[pathname];
        return content === undefined ? new Response("not found", { status: 404 }) : new Response(content);
    },
});
const STORE_URL = `https://127.0.0.1:${server.port}/registry.json`;

/** Runs in Discord's page: install a plugin, a tampered one, a native one with and without consent */
async function storeStepInstall() {
    const D = (window as any).Evi;
    const listing = await D.store.refresh().then(() => D.store.getSnapshot());
    const good = await D.store.install("store-good");
    const goodState = D.plugins.get("store-good");
    const tampered = await D.store.install("store-tampered");
    const nativeRefused = await D.store.install("store-native");
    const nativeRefusedListed = !!D.plugins.get("store-native");
    const native = await D.store.install("store-native", { allowNative: true });
    const nativeState = D.plugins.get("store-native");
    const nativeCtx = (window as any).__storeNativeCtx;
    const nativePing = nativeCtx ? await nativeCtx.native.call("ping") : null;
    // A context page code builds itself, under the native plugin's id, can't call main
    const forged = nativeCtx
        ? await (async () => new nativeCtx.constructor({ id: "store-native", name: "Forged", native: "native.js" }, {}).native.call("ping"))().then((r: unknown) => `answered ${r}`, (e: Error) => `refused: ${e.message}`)
        : null;
    // Switched off, its native side answers nobody, not even a ctx kept from when it ran
    const nativeRunning = nativeState?.running === true;
    if (nativeState) await D.plugins.setEnabled("store-native", false);
    const nativeOffCall = nativeCtx ? await nativeCtx.native.call("ping").then((r: unknown) => `answered ${r}`, (e: Error) => `refused: ${e.message}`) : null;
    // Any plugin can be removed: one dropped into the folder by hand, and one from the dev build
    const manual = await D.store.uninstall("late-plugin");
    const devRemoved = await D.store.uninstall("timezones");
    return {
        status: listing.status, ids: listing.plugins.map((p: any) => p.id), problems: listing.problems.length,
        good, goodRan: (window as any).__storeGood, goodRunning: goodState?.running === true, goodSource: goodState?.source,
        tampered, tamperedListed: !!D.plugins.get("store-tampered"), tamperedRan: "__tampered" in window,
        nativeRefused, nativeRefusedListed,
        native, nativeRunning, nativePing, nativeOffCall, forged, stateHasCtx: !!nativeState && "ctx" in nativeState,
        manual, lateStillThere: !!D.plugins.get("late-plugin"),
        devRemoved, devStillThere: !!D.plugins.get("timezones"),
    };
}

/** After the server published 2.0.0: update, then uninstall */
async function storeStepUpdate() {
    const D = (window as any).Evi;
    await D.store.refresh();
    const offered = D.store.getSnapshot().plugins.find((p: any) => p.id === "store-good")?.version;
    const update = await D.store.install("store-good");
    const afterUpdate = { ran: (window as any).__storeGood, disposed: (window as any).__storeGoodDisposed, running: D.plugins.get("store-good")?.running === true };
    const uninstall = await D.store.uninstall("store-good");
    return {
        offered, update, afterUpdate, uninstall,
        listedAfterUninstall: !!D.plugins.get("store-good"), disposedAfterUninstall: (window as any).__storeGoodDisposed,
        installed: Object.keys(D.store.getSnapshot().installed),
    };
}

// Runs as Discord's main process: opens discord.com like the real client, then inspects the page
const fakeDiscordMain = String.raw`
if (process.env.FAKE_SCENARIO) return void require("./" + process.env.FAKE_SCENARIO);
const { app, BrowserWindow, net, session } = require("electron");
const fs = require("fs");
const path = require("path");

// Like Discord's bootstrap, which sets its own feature list after Evi applied plugins' switches
app.commandLine.appendSwitch("disable-features", "DiscordFeatureA,DiscordFeatureB");
console.log("SWITCHES " + JSON.stringify({ disable: app.commandLine.getSwitchValue("disable-features") }));
console.log("COMPILE_CACHE " + JSON.stringify(require("module").getCompileCacheDir?.() ?? null));

app.whenReady().then(() => {
    // Trust the test registry's self-signed certificate, for 127.0.0.1 only
    session.defaultSession.setCertificateVerifyProc((req, cb) => cb(req.hostname === "127.0.0.1" ? 0 : -3));
    const win = new BrowserWindow({
        show: false,
        webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, sandbox: true },
    });
    win.loadURL("https://discord.com/login");
    if (process.env.EVI_TEST_PHASE === "import") return importPhase(win);

    // Install a plugin while running, it should appear without a reload
    setTimeout(() => {
        const dir = path.join(process.env.EVI_DATA_DIR, "plugins", "late-plugin");
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, "index.js"), "module.exports = { default: { start() { window.__late = true; } } };");
        fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify({ id: "late-plugin", name: "Late", enabledByDefault: true }));
        // And a theme: it shows up in the list, and stays off while another one is on
        fs.writeFileSync(path.join(process.env.EVI_DATA_DIR, "themes", "late.css"), "/** @name Late Theme */ :root { --evi-late-theme: live; }");
    }, 12000);

    setTimeout(async () => {
        const result = await win.webContents.executeJavaScript(${"`"}(async () => {
            const D = window.Evi;
            const css = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
            if (!D) return { evi: false, discordNative: !!window.__fakeDiscordPreload };
            const blockedFetch = await fetch("https://discord.com/api/v9/science", { method: "POST", body: "{}" })
                .then(r => "status " + r.status, e => "blocked: " + e.message);
            // Discord's own stylesheet makes a real https CSS file to download
            const sheet = [...document.querySelectorAll("link[rel=stylesheet]")].map(l => l.href).find(h => h.startsWith("https://discord.com/assets/"));
            return {
                evi: true,
                // Evi's renderer claimed the bridge as it started: nothing else in the page can reach it
                bridge: { native: "EviNative" in window, claim: "__eviClaimNative" in window },
                discordNative: window.__fakeDiscordPreload?.ran === true,
                running: D.plugins.getSnapshot().filter(p => p.running).map(p => p.manifest.id),
                isDeveloper: D.api.getStore("DeveloperExperimentStore").isDeveloper,
                blockedFetch,
                latePlugin: window.__late === true,
                themes: D.themes.getSnapshot().map(t => t.name),
                bootTheme: css("--evi-boot-theme"),
                offTheme: css("--evi-off-theme"),
                lateTheme: css("--evi-late-theme"),
                cssOrder: css("--evi-order"),
                styleOrder: [...document.head.querySelectorAll("style[id^=evi-theme-], #evi-quickcss")].map(s => s.id),
                addHttp: await D.themes.addFromUrl("http://example.com/theme.css"),
                addHtml: await D.themes.addFromUrl("https://discord.com/login"),
                addCss: sheet ? await D.themes.addFromUrl(sheet) : "no stylesheet on the page",
                // One theme at a time (since 1.2.0): the downloaded one takes over from the boot theme
                addedStyles: [...document.head.querySelectorAll("style[id^=evi-theme-]")].map(s => s.id),
                bootAfterAdd: css("--evi-boot-theme"),
                // Healthy starts are reported a few seconds after plugins start, wait for it
                reportedOk: await new Promise(resolve => {
                    const deadline = Date.now() + 15000;
                    const poll = () => D.safeMode.reportedOk || Date.now() > deadline ? resolve(D.safeMode.reportedOk) : setTimeout(poll, 200);
                    poll();
                }),
                // Last, so the backup holds everything above. The dialog is bypassed by EVI_TEST_BACKUP_PATH.
                exported: await D.backup.export(),
            };
        })()${"`"});
        console.log("RESULT " + JSON.stringify(result));

        // Reports, asked for the way a page still holding the bridge would: straight at main's handlers
        // (Electron's own table of them; the page can't reach them any more, that's the point)
        const invoke = (channel, ...args) => require("electron").ipcMain._invokeHandlers.get(channel)({ sender: win.webContents, senderFrame: win.webContents.mainFrame }, ...args);
        const crash = (plugin, version) => invoke("evi:crash-report-send", { plugin, version, eviVersion: "0.0.0", discordBuild: "test", report: "Error: test" });
        try {
            console.log("REPORTS " + JSON.stringify({
                crashNotStore: await crash("late-plugin", "1.0.0"),
                healthNotStore: await invoke("evi:health-report", { plugin: "late-plugin", version: "1.0.0", discordBuild: "test", kind: "start" }),
                memory: await invoke("evi:memory-usage"),
            }));
        } catch (err) {
            console.log("REPORTS " + JSON.stringify({ error: String(err && err.stack || err) }));
        }

        // Plugin store, against the local fake registry. What's on disk is checked between steps.
        const plugins = path.join(process.env.EVI_DATA_DIR, "plugins");
        const disk = () => ({
            good: fs.existsSync(path.join(plugins, "store-good", "index.js")) ? fs.readFileSync(path.join(plugins, "store-good", "index.js"), "utf8").match(/__storeGood = "([^"]+)"/)?.[1] : null,
            goodMarker: fs.existsSync(path.join(plugins, "store-good", ".evi-store.json")) ? JSON.parse(fs.readFileSync(path.join(plugins, "store-good", ".evi-store.json"), "utf8")).version : null,
            tampered: fs.existsSync(path.join(plugins, "store-tampered")),
            native: fs.existsSync(path.join(plugins, "store-native", "native.js")),
            late: fs.existsSync(path.join(plugins, "late-plugin")),
            removed: fs.existsSync(path.join(process.env.EVI_DATA_DIR, "removed-plugins.json")) ? JSON.parse(fs.readFileSync(path.join(process.env.EVI_DATA_DIR, "removed-plugins.json"), "utf8")) : [],
            staging: fs.existsSync(path.join(process.env.EVI_DATA_DIR, "store-staging")) ? fs.readdirSync(path.join(process.env.EVI_DATA_DIR, "store-staging")) : [],
        });
        try {
            const install = await win.webContents.executeJavaScript(${JSON.stringify(`(${storeStepInstall})()`)});
            const afterInstall = disk();
            // Installed from the store at 1.0.0: a report about another version isn't about what's here
            install.crashOtherVersion = await crash("store-good", "9.9.9");
            await net.fetch(process.env.EVI_STORE_URL.replace("registry.json", "__publish"), { method: "POST" });
            const update = await win.webContents.executeJavaScript(${JSON.stringify(`(${storeStepUpdate})()`)});
            console.log("STORE " + JSON.stringify({ install, afterInstall, update, afterUpdate: disk() }));
        } catch (err) {
            console.log("STORE " + JSON.stringify({ error: String(err && err.stack || err) }));
        }
        // Let main handle the renderer's last messages (the healthy start report)
        setTimeout(() => app.exit(0), 200);
    }, 16000);
});

// Second run, on a different data folder: restore the backup the first run exported
function importPhase(win) {
    setTimeout(async () => {
        const result = await win.webContents.executeJavaScript(${"`"}(async () => {
            const D = window.Evi;
            if (!D) return { evi: false };
            const css = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
            const running = () => D.plugins.getSnapshot().filter(p => p.running).map(p => p.manifest.id);
            const before = { running: running(), bootTheme: css("--evi-boot-theme"), order: css("--evi-order"), mine: css("--evi-mine") };
            const opened = await D.backup.open();
            const applied = opened.ok ? await D.backup.apply(opened.token, "replace") : null;
            // Quick CSS and theme changes arrive as IPC events, give them a moment
            await new Promise(r => setTimeout(r, 500));
            const again = await D.backup.open();
            return {
                evi: true,
                before,
                opened: opened.ok ? { fileName: opened.fileName, eviVersion: opened.eviVersion, previews: opened.previews } : opened,
                applied: applied && (applied.ok ? { ok: true, changes: applied.preview.changes } : applied),
                after: {
                    running: running(),
                    settings: D.settings.data,
                    themes: D.themes.getSnapshot().map(t => t.file),
                    bootTheme: css("--evi-boot-theme"),
                    lateTheme: css("--evi-late-theme"),
                    order: css("--evi-order"),
                    mine: css("--evi-mine"),
                    themeStyles: [...document.head.querySelectorAll("style[id^=evi-theme-]")].map(s => s.id),
                },
                again: again.ok ? { merge: again.previews.merge.changes, replace: again.previews.replace.changes } : again,
            };
        })()${"`"});
        console.log("RESULT " + JSON.stringify(result));
        app.exit(0);
    }, 12000);
}
`;

/**
 * Discord's main for the safe mode runs. Loads discord.com, polls FAKE_PROBE (a page expression that
 * is null until it has an answer), prints it as RESULT, then optionally runs FAKE_THEN in the page
 * (clicking a restart button). Relaunching is logged instead of done, so each start stays one process.
 */
const fakeSafeModeMain = String.raw`
const { app, BrowserWindow } = require("electron");
const path = require("path");
const log = (tag, value) => console.log(tag + " " + JSON.stringify(value));

app.relaunch = options => log("RELAUNCH", options ?? null);

app.whenReady().then(() => {
    const win = new BrowserWindow({
        show: false,
        webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, sandbox: true },
    });
    win.webContents.on("render-process-gone", (_, details) => {
        log("CRASH", details.reason);
        // Like a user whose Discord just died, starting it again: the test launches the next process
        if (process.env.FAKE_ON_CRASH === "exit") setTimeout(() => app.exit(0), 300);
    });
    win.loadURL("https://discord.com/login");

    const deadline = Date.now() + 60_000;
    let lastError = null;
    const tick = async () => {
        if (Date.now() > deadline) {
            log("RESULT", { timeout: true, lastError });
            return app.exit(0);
        }
        const wc = win.webContents;
        if (!wc.isCrashed() && !wc.isLoading()) {
            const result = await Promise.race([
                wc.executeJavaScript(process.env.FAKE_PROBE).catch(err => void (lastError = String(err))),
                new Promise(r => setTimeout(r, 2000)),
            ]);
            if (result) {
                log("RESULT", result);
                if (!process.env.FAKE_THEN) return app.exit(0);
                wc.executeJavaScript(process.env.FAKE_THEN).catch(() => { });
                // The button restarts (logged, then exits); if nothing happens, give up
                return void setTimeout(() => app.exit(0), 5000);
            }
        }
        setTimeout(tick, 500);
    };
    tick();
});
`;


const fakeDiscordPreload = `
const { contextBridge, webFrame } = require("electron");
// Not "DiscordNative": that would switch Discord's web code into desktop mode, which needs the real native APIs
contextBridge.exposeInMainWorld("__fakeDiscordPreload", { ran: true });
// discord.com asks for passkeys on its login page, which can pop a Windows Hello dialog: switch WebAuthn off
require("electron").webFrame.executeJavaScript(${JSON.stringify(`(${disablePasskeys})()`)});
`;

function fakeVersion(version: string) {
    // Like Discord.exe: Electron boots resources/app (or app.asar) directly, no default_app
    cpSync(ELECTRON_DIST, join(INSTALL, `app-${version}`), { recursive: true, filter: src => !src.endsWith("default_app.asar") });
    const asar = join(INSTALL, `app-${version}`, "resources", "app.asar");
    mkdirSync(asar, { recursive: true });
    writeFileSync(join(asar, "package.json"), JSON.stringify({ name: APP_NAME, main: "index.js" }));
    writeFileSync(join(asar, "index.js"), fakeDiscordMain);
    writeFileSync(join(asar, "preload.js"), fakeDiscordPreload);
    writeFileSync(join(asar, "safe-mode.js"), fakeSafeModeMain);
    return join(INSTALL, `app-${version}`, "resources");
}

const resources = fakeVersion("1.0.0");
const updated = fakeVersion("1.0.1");

// Same swap the installer does: Discord's archive becomes _app.asar, our loader takes its place
renameSync(join(resources, "app.asar"), join(resources, ORIGINAL_ASAR));
const shimAsar = join(resources, "app.asar");
writeFileSync(shimAsar, createShimAsar({ corePath: join(ROOT, "dist", "core", "main.js"), devPluginsDir: join(ROOT, "dist", "plugins") }, { name: APP_NAME }));

mkdirSync(DATA, { recursive: true });
// The real data folder isn't inside a "type": "module" package like this repo, native.js must load as CommonJS
writeFileSync(join(DATA, "package.json"), JSON.stringify({ type: "commonjs" }));
writeFileSync(join(DATA, "settings.json"), JSON.stringify({
    quickCss: true,
    plugins: { experiments: { enabled: true, settings: { marker: "from-a" } }, "gpu-boost": { enabled: true }, "switch-test": { enabled: true } },
    enabledThemes: ["boot.css"],
}));
mkdirSync(join(DATA, "themes"));
// A plugin with a feature list switch: Discord setting its own list afterwards must not drop it
mkdirSync(join(DATA, "plugins", "switch-test"), { recursive: true });
writeFileSync(join(DATA, "plugins", "switch-test", "manifest.json"), JSON.stringify({ id: "switch-test", name: "Switch Test", chromiumSwitches: { "disable-features": "EviTestFeature" } }));
writeFileSync(join(DATA, "plugins", "switch-test", "index.js"), "module.exports = { default: { start() { } } };");
writeFileSync(join(DATA, "themes", "boot.css"), `/**
 * @name Boot Theme
 * @author Tester
 */
:root { --evi-boot-theme: applied; --evi-order: theme; }
`);
writeFileSync(join(DATA, "themes", "off.css"), ":root { --evi-off-theme: applied; }");
// Quick CSS sets the same property as the theme and must win
writeFileSync(join(DATA, "quick.css"), ":root { --evi-order: quick; }");

// The first run exports a backup here, the second restores it. Both dialogs answer with this path.
const BACKUP_FILE = join(BASE, "backup.json");
let failed = 0;
function check(name: string, ok: boolean, detail?: unknown) {
    if (!ok) failed++;
    console.log(`${ok ? "\x1b[32m✓" : "\x1b[31m✗"} ${name}\x1b[0m${detail !== undefined ? `  \x1b[2m${JSON.stringify(detail)}\x1b[0m` : ""}`);
}

async function launch(dataDir: string, env: Record<string, string> = {}) {
    const proc = Bun.spawn([join(INSTALL, "app-1.0.0", "electron.exe")], {
        env: { ...process.env, EVI_DATA_DIR: dataDir, EVI_TEST_BACKUP_PATH: BACKUP_FILE, EVI_TEST_CONFIRM: "page", EVI_STORE_URL: STORE_URL, ELECTRON_ENABLE_LOGGING: "1", ...env },
        stderr: "pipe",
    });
    // Page checks start at 16s, theme downloads may take up to 20s, the healthy start report up to 15s
    const timeout = setTimeout(() => proc.kill(), 90_000);
    const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
    clearTimeout(timeout);

    const line = stdout.split("\n").find(l => l.startsWith("RESULT "));
    if (!line) {
        console.error("No result from Electron.\n--- stdout ---\n" + stdout.slice(-3000) + "\n--- stderr ---\n" + stderr.slice(-3000));
        rmSync(join(process.env.APPDATA!, APP_NAME), { recursive: true, force: true });
        process.exit(1);
    }
    return { stdout, stderr, r: JSON.parse(line.slice(7)) };
}

function printLogs(stdout: string, stderr: string) {
    const eviLines = stderr.split("\n").filter(l => /evi/i.test(l)).join("\n");
    console.log(`--- stdout ---\n${stdout.slice(-2500)}\n--- stderr (Evi lines) ---\n${eviLines.slice(-4000)}`);
}

const { stdout, stderr, r } = await launch(DATA);

check("main process loaded, then handed over to Discord", stdout.includes("[Evi] v"));
check("session preload booted the renderer", r.evi === true);
check("the bridge is gone from the page once Evi's renderer claimed it", r.bridge?.native === false && r.bridge.claim === false, r.bridge);
check("Discord's own preload still ran", r.discordNative === true);
check("plugins from the dev build started", ["clear-urls", "experiments", "no-track"].every(id => r.running?.includes(id)), r.running);
check("source patch works in Electron", r.isDeveloper === true);
check("no-track native module blocks /science", String(r.blockedFetch).startsWith("blocked"), { fetch: r.blockedFetch });
check("plugin dropped into the folder loads live", r.latePlugin === true);
check("auto-injected into the updated app-1.0.1", existsSync(join(updated, ORIGINAL_ASAR, "index.js"))
    && readFileSync(join(updated, "app.asar")).equals(readFileSync(shimAsar)));
check("enabled theme applied at startup", r.bootTheme === "applied", r.bootTheme);
check("theme header parsed, disabled theme listed but not applied", ["Boot Theme", "off"].every(n => r.themes?.includes(n)) && r.offTheme === "", { themes: r.themes, off: r.offTheme });
check("Quick CSS comes after themes and wins", r.cssOrder === "quick" && r.styleOrder?.at(-1) === "evi-quickcss", { value: r.cssOrder, order: r.styleOrder });
check("theme dropped into the folder is listed live, and stays off while another is on", r.themes?.includes("Late Theme") && r.lateTheme === "", { themes: r.themes, late: r.lateTheme });
check("remote themes: http refused, web pages refused", r.addHttp?.ok === false && /https/.test(r.addHttp.error) && r.addHtml?.ok === false && /web page|html/i.test(r.addHtml.error), { http: r.addHttp, html: r.addHtml });
check("remote theme downloaded into the themes folder and turned on instead of the one that was on", r.addCss?.ok === true && existsSync(join(DATA, "themes", r.addCss.file))
    && r.addedStyles?.length === 1 && r.addedStyles[0].includes(r.addCss.file) && r.bootAfterAdd === "", { result: r.addCss, styles: r.addedStyles, boot: r.bootAfterAdd });
check("settings were read from the data folder", existsSync(join(DATA, "settings.json")));
check("enabled plugin's chromium switches applied at startup", stdout.includes("gpu-boost: --force_high_performance_gpu"));
const switchesLine = stdout.split("\n").find(l => l.startsWith("SWITCHES "));
const disabledFeatures: string = switchesLine ? JSON.parse(switchesLine.slice(9)).disable : "";
check("a feature list Discord sets later adds to a plugin's instead of replacing it", ["EviTestFeature", "DiscordFeatureA", "DiscordFeatureB"].every(f => disabledFeatures.split(",").includes(f)), disabledFeatures);
const cacheLine = stdout.split("\n").find(l => l.startsWith("COMPILE_CACHE "));
const cacheDir: string | null = cacheLine ? JSON.parse(cacheLine.slice(14)) : null;
const cacheFiles = (dir: string): number => readdirSync(dir, { withFileTypes: true }).reduce((n, e) => n + (e.isDirectory() ? cacheFiles(join(dir, e.name)) : 1), 0);
check("the loader turned on Node's compile cache, and it was written before Discord quit", !!cacheDir && existsSync(cacheDir) && cacheFiles(cacheDir) > 0, cacheDir);
const firstState = JSON.parse(readFileSync(join(DATA, "safe-mode.json"), "utf8"));
check("healthy start reset the crash counter, installs were recorded", firstState.pendingStarts === 0 && firstState.changes.some((c: any) => c.id === "late-plugin" && c.action === "installed"), firstState);

if (failed) printLogs(stdout, stderr);

// Backup: export from the first data folder, restore into a second one

const parsed = existsSync(BACKUP_FILE) ? parseBackup(readFileSync(BACKUP_FILE, "utf8")) : null;
const backup = parsed?.ok ? parsed.backup : null;
check("backup exported through the save dialog path", r.exported?.ok === true && r.exported.path === BACKUP_FILE && !!backup, parsed && !parsed.ok ? parsed.error : r.exported);
check("backup holds settings, Quick CSS, themes and the plugin list, no plugin code", !!backup
    && backup.settings.plugins.experiments?.settings?.marker === "from-a"
    && backup.quickCss === readFileSync(join(DATA, "quick.css"), "utf8")
    && ["boot.css", "off.css", "late.css"].every(f => backup.themes.some(t => t.file === f))
    && backup.plugins.some(p => p.id === "late-plugin" && p.source === "user" && p.enabled)
    && !readFileSync(BACKUP_FILE, "utf8").includes("__late"),
{ plugins: backup?.plugins.map(p => `${p.id}:${p.source}`), themes: backup?.themes.map(t => t.file) });

const DATA_B = join(BASE, "data-restore");
mkdirSync(join(DATA_B, "themes"), { recursive: true });
writeFileSync(join(DATA_B, "settings.json"), JSON.stringify({ quickCss: true, plugins: { experiments: { enabled: false } }, enabledThemes: ["mine.css"] }));
writeFileSync(join(DATA_B, "themes", "mine.css"), ":root { --evi-mine: on; }");
// Same file name as a theme in the backup, different contents: gets overwritten
writeFileSync(join(DATA_B, "themes", "boot.css"), ":root { --evi-boot-theme: old; }");
writeFileSync(join(DATA_B, "quick.css"), ":root { --evi-order: b-quick; }");

const b = await launch(DATA_B, { EVI_TEST_PHASE: "import" });
const rb = b.r;
const preview = rb.opened?.previews?.replace;
const failedBefore = failed;
check("restore: second profile starts with its own state", rb.before?.mine === "on" && rb.before.order === "b-quick" && !rb.before.running.includes("experiments"), rb.before);
check("restore: preview lists what replace changes", !!preview
    && preview.pluginsEnabled.includes("Experiments")
    && preview.themesOverwritten.includes("boot.css") && preview.themesAdded.includes("late.css")
    && preview.themesDisabled.includes("mine.css") && preview.quickCss === "replaced"
    && preview.missingPlugins.some((p: any) => p.id === "late-plugin"), preview ?? rb.opened);
check("restore: applied", rb.applied?.ok === true && rb.applied.changes > 0, rb.applied);
// Only what a backup carries: this install's own bookkeeping (lastSeenVersion, pluginVersionsSeen, set
// by its first start) isn't in a backup and stays as it was, so What's New doesn't come back
const carried = (settings: any) => settings && backup && Object.fromEntries(Object.keys(backup.settings).map(k => [k, settings[k]]));
check("restore: settings round-trip, in memory and on disk", !!backup
    && Bun.deepEquals(carried(rb.after?.settings), backup.settings)
    && Bun.deepEquals(carried(JSON.parse(readFileSync(join(DATA_B, "settings.json"), "utf8"))), backup.settings), rb.after?.settings);
check("restore: theme files and Quick CSS round-trip on disk", !!backup
    && backup.themes.every(t => readFileSync(join(DATA_B, "themes", t.file), "utf8") === t.css)
    && readFileSync(join(DATA_B, "quick.css"), "utf8") === backup.quickCss
    && existsSync(join(DATA_B, "themes", "mine.css")));
// The backup was taken with the downloaded theme on: that one comes back on, and the profile's own goes off
const restoredTheme = backup?.settings.enabledThemes[0];
check("restore: applies live, no reload (plugins, themes, Quick CSS)", rb.after?.running.includes("experiments") && !!restoredTheme
    && rb.after.themeStyles.length === 1 && rb.after.themeStyles[0].includes(restoredTheme)
    && rb.after.bootTheme === "" && rb.after.lateTheme === "" && rb.after.order === "quick" && rb.after.mine === "", rb.after && { ...rb.after, settings: undefined });
check("restore: opening the same backup again changes nothing", rb.again?.merge === 0 && rb.again.replace === 0, rb.again);
if (failed > failedBefore) printLogs(b.stdout, b.stderr);

const reportsLine = stdout.split("\n").find(l => l.startsWith("REPORTS "));
const reports = reportsLine ? JSON.parse(reportsLine.slice(8)) : { error: "no REPORTS line" };
check("reports: crash and health reports for a plugin the store didn't install are refused",
    reports.crashNotStore?.ok === false && /isn't installed from the store/.test(reports.crashNotStore.error)
    && reports.healthNotStore?.ok === false && /isn't installed from the store/.test(reports.healthNotStore.error), reports);

check("Performance tab: memory of Discord's page and GPU process, from main", reports.memory?.renderer > 10 * 1024 ** 2 && (reports.memory.gpu === undefined || reports.memory.gpu > 0), reports.memory);

const storeLine = stdout.split("\n").find(l => l.startsWith("STORE "));
const s = storeLine ? JSON.parse(storeLine.slice(6)) : { error: "no STORE line" };
if (s.error) check("store steps ran", false, s.error);
else {
    const { install: i, afterInstall: d1, update: u, afterUpdate: d2 } = s;
    check("store: registry from the env URL loads, invalid entry skipped", i.status === "ready" && ["store-good", "store-tampered", "store-native"].every(id => i.ids.includes(id)) && i.problems === 1, { status: i.status, ids: i.ids, problems: i.problems });
    check("store: install hot-loads and runs the plugin, no restart", i.good?.ok === true && i.goodRan === "1.0.0" && i.goodRunning && i.goodSource === "user" && d1.good === "1.0.0" && d1.goodMarker === "1.0.0", { result: i.good, ran: i.goodRan, disk: d1.good });
    check("store: tampered file (bad sha256) rejected, nothing written", i.tampered?.ok === false && /sha256|doesn't match/.test(i.tampered.error) && !i.tamperedListed && !i.tamperedRan && !d1.tampered && d1.staging.length === 0, { result: i.tampered, disk: d1.tampered, staging: d1.staging });
    check("store: native plugin refused without the user's confirmation", i.nativeRefused?.ok === false && /full access/.test(i.nativeRefused.error) && !i.nativeRefusedListed, i.nativeRefused);
    check("store: native plugin installs once confirmed, its native side works", i.native?.ok === true && i.nativeRunning && i.nativePing === "pong" && d1.native, { result: i.native, ping: i.nativePing });
    check("store: main refuses native calls for a plugin that's switched off", /^refused: .*turned off/.test(i.nativeOffCall ?? ""), i.nativeOffCall);
    check("store: a context built by page code can't call a plugin's native side, and Evi.plugins hands none out",
        /^refused: .*no native module/.test(i.forged ?? "") && i.stateHasCtx === false, { forged: i.forged, stateHasCtx: i.stateHasCtx });
    check("reports: a crash report about another version than the store installed is refused", i.crashOtherVersion?.ok === false && /isn't installed from the store/.test(i.crashOtherVersion.error), i.crashOtherVersion);
    check("store: removes a plugin it didn't install, and remembers it so updates don't bring it back", i.manual?.ok === true && !i.lateStillThere && !d1.late && d1.removed.includes("late-plugin"), { result: i.manual, removed: d1.removed });
    check("store: a dev build plugin is hidden (its files are the repo's) and remembered too", i.devRemoved?.ok === true && !i.devStillThere && d1.removed.includes("timezones"), { result: i.devRemoved, removed: d1.removed });
    check("store: update replaces the plugin live", u.offered === "2.0.0" && u.update?.ok === true && u.update.version === "2.0.0" && u.afterUpdate.ran === "2.0.0" && u.afterUpdate.running && u.afterUpdate.disposed === 1, { offered: u.offered, update: u.update, after: u.afterUpdate });
    check("store: uninstall stops and removes it live", u.uninstall?.ok === true && !u.listedAfterUninstall && u.disposedAfterUninstall === 2 && !u.installed.includes("store-good") && d2.good === null && d2.staging.length === 0, { result: u.uninstall, disk: d2 });
}

if (failed) {
    const eviLines = stderr.split("\n").filter(l => /evi/i.test(l)).join("\n");
    console.log(`--- stdout ---\n${stdout.slice(-2500)}\n--- stderr (Evi lines) ---\n${eviLines.slice(-4000)}`);
}

// Safe mode. Each "start" is a new Electron process against the same data folder, like restarting Discord.
// The crasher plugin crashes the renderer from its native side as soon as it starts. Its native file is
// .cjs: test-results/ sits under this repo, whose package.json makes .js files ES modules.

console.log("\nSafe mode");
const SAFE = join(BASE, "data-safe");
const crasherDir = join(SAFE, "plugins", "crasher");
mkdirSync(crasherDir, { recursive: true });
mkdirSync(join(SAFE, "themes"), { recursive: true });
writeFileSync(join(crasherDir, "manifest.json"), JSON.stringify({ id: "crasher", name: "Crasher", native: "native.cjs" }));
writeFileSync(join(crasherDir, "index.js"), `window.__crasherEvaluated = true;
module.exports = { default: { start(ctx) { ctx.native.call("crash"); } } };`);
writeFileSync(join(crasherDir, "native.cjs"), `const { webContents } = require("electron");
module.exports = {
    crash() {
        for (const wc of webContents.getAllWebContents()) if (wc.getURL().includes("discord.com")) wc.forcefullyCrashRenderer();
    },
};`);
writeFileSync(join(SAFE, "themes", "safe.css"), ":root { --evi-safe-theme: applied; }");
writeFileSync(join(SAFE, "quick.css"), ":root { --evi-safe-quick: applied; }");
writeFileSync(join(SAFE, "settings.json"), JSON.stringify({ quickCss: true, plugins: {}, enabledThemes: ["safe.css"] }));

const readJson = (file: string) => JSON.parse(readFileSync(join(SAFE, file), "utf8"));
const writeState = (patch: object) => writeFileSync(join(SAFE, "safe-mode.json"), JSON.stringify({ ...readJson("safe-mode.json"), ...patch }));

/** What the page reports once Evi says this start was healthy */
const PROBE = `(() => {
    const D = window.Evi;
    if (!D || !D.safeMode.reportedOk) return null;
    const css = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    const notice = document.querySelector(".dl-safe-float .dl-safe");
    return {
        safeMode: D.safeMode.info ?? null,
        running: D.plugins.getSnapshot().filter(p => p.running).map(p => p.manifest.id),
        listed: D.plugins.getSnapshot().map(p => p.manifest.id),
        crasherEvaluated: window.__crasherEvaluated === true,
        theme: css("--evi-safe-theme"),
        quickCss: css("--evi-safe-quick"),
        notice: notice?.textContent ?? null,
        buttons: [...(notice?.querySelectorAll("button") ?? [])].map(b => b.textContent || b.getAttribute("aria-label")),
    };
})()`;
const click = (text: string) => `[...document.querySelectorAll(".dl-safe-float button")].find(b => b.textContent.includes(${JSON.stringify(text)})).click()`;

async function start(name: string, options: { then?: string; onCrash?: "exit"; args?: string[]; probe?: string; confirm?: "yes" | "no"; } = {}) {
    const run = Bun.spawn([join(INSTALL, "app-1.0.0", "electron.exe"), ...options.args ?? []], {
        env: {
            ...process.env,
            EVI_DATA_DIR: SAFE,
            // Main's own questions (turning on a plugin with native code), answered for the user
            EVI_TEST_CONFIRM: options.confirm ?? "yes",
            ELECTRON_ENABLE_LOGGING: "1",
            FAKE_SCENARIO: "safe-mode.js",
            FAKE_PROBE: options.probe ?? PROBE,
            FAKE_THEN: options.then ?? "",
            FAKE_ON_CRASH: options.onCrash ?? "",
        },
        stderr: "pipe",
    });
    const kill = setTimeout(() => run.kill(), 90_000);
    const [out, err] = await Promise.all([new Response(run.stdout).text(), new Response(run.stderr).text()]);
    clearTimeout(kill);
    const tagged = (tag: string) => out.split("\n").filter(l => l.startsWith(tag + " ")).map(l => JSON.parse(l.slice(tag.length + 1)));
    const result = {
        // Missing result: empty lists so the checks fail instead of throwing
        result: tagged("RESULT")[0] ?? { missing: true, running: [], listed: [], buttons: [] },
        crashes: tagged("CRASH"),
        relaunch: tagged("RELAUNCH")[0],
        state: readJson("safe-mode.json"),
        log: `${out.slice(-1500)}\n${err.split("\n").filter(l => /evi/i.test(l) && !l.includes("INFO:CONSOLE")).join("\n").slice(-2500)}`,
    };
    console.log(`  \x1b[2m${name}: ${result.crashes.length} crash(es), pendingStarts ${result.state.pendingStarts}${result.state.forceSafe ? `, sticky ${result.state.forceSafe}` : ""}\x1b[0m`);
    return result;
}

// 1. Healthy start, then the user turns the crasher on: Discord dies right away
const s1 = await start("turn crasher on", { then: `Evi.plugins.setEnabled("crasher", true)`, onCrash: "exit" });
check("healthy start in normal mode: plugins, theme and Quick CSS on", s1.result?.safeMode === null && s1.result.running.includes("no-track") && s1.result.theme === "applied" && s1.result.quickCss === "applied", s1.result);
check("turning the crasher on was saved and recorded before it ran, then it crashed", s1.crashes.length === 1 && readJson("settings.json").plugins.crasher?.enabled === true
    && s1.state.changes[0]?.id === "crasher" && s1.state.changes[0]?.action === "enabled" && s1.state.pendingStarts === 0, { crashes: s1.crashes, changes: s1.state.changes });

// 2 + 3. Two starts that crash before they're healthy
const s2 = await start("crash on start 1", { onCrash: "exit" });
const s3 = await start("crash on start 2", { onCrash: "exit" });
check("starts that crash before a healthy boot are counted", s2.crashes.length === 1 && s3.crashes.length === 1 && s3.state.pendingStarts === 2, { s2: s2.state.pendingStarts, s3: s3.state.pendingStarts });

// 4. Safe mode
const s4 = await start("safe mode", { then: click("Disable Crasher and restart") });
const safe = s4.result;
check("third start is in safe mode after two failed ones", safe?.safeMode?.reason === "crash-loop" && safe.safeMode.failures === 2 && s4.crashes.length === 0, safe?.safeMode ?? safe);
check("safe mode: no plugin runs or is even evaluated, crasher still listed", safe?.running.length === 0 && !safe.crasherEvaluated && safe.listed.includes("crasher"), { running: safe?.running, evaluated: safe?.crasherEvaluated });
check("safe mode: themes and Quick CSS aren't applied", safe?.theme === "" && safe.quickCss === "", { theme: safe?.theme, quickCss: safe?.quickCss });
check("safe mode notice names the crasher and offers both ways out", /safe mode/i.test(safe?.notice ?? "") && /Most recent change: Crasher/.test(safe?.notice ?? "")
    && ["Disable Crasher and restart", "Exit safe mode and restart"].every(b => safe?.buttons.includes(b)), { notice: safe?.notice, buttons: safe?.buttons });
check("\"Disable Crasher and restart\" turns it off, leaves safe mode and restarts", s4.relaunch !== undefined && readJson("settings.json").plugins.crasher?.enabled === false
    && s4.state.pendingStarts === 0 && s4.state.forceSafe === undefined, { relaunch: s4.relaunch, state: s4.state });

// 5. Back to normal. A leftover failed start is forgotten once this one is healthy. Then the page turns
// the crasher on again, and the user says no to main's question: it's not saved and never runs.
writeState({ pendingStarts: 1 });
const s5 = await start("normal again", { then: `Evi.plugins.setEnabled("crasher", true)`, confirm: "no" });
check("next start is normal and healthy, resetting the counter", s5.result?.safeMode === null && s5.result.running.includes("no-track") && !s5.result.running.includes("crasher") && s5.state.pendingStarts === 0, { safeMode: s5.result?.safeMode, pending: s5.state.pendingStarts });
check("turning on a native plugin without the user's yes in main isn't saved, and it doesn't run", s5.crashes.length === 0 && readJson("settings.json").plugins.crasher?.enabled === false, { crashes: s5.crashes, crasher: readJson("settings.json").plugins.crasher });

// 6. --evi-safe, left with "Exit safe mode and restart"
const s6 = await start("--evi-safe", { args: ["--evi-safe"], then: click("Exit safe mode and restart") });
check("--evi-safe starts in safe mode", s6.result?.safeMode?.reason === "flag" && s6.result.running.length === 0 && s6.result.theme === "", s6.result?.safeMode);
check("the flag is for one start: not sticky, and not passed on when restarting", s6.state.forceSafe === undefined && Array.isArray(s6.relaunch?.args) && !s6.relaunch.args.includes("--evi-safe"), { relaunch: s6.relaunch, state: s6.state });

// 7. Crashes while running: the crasher is on and Discord doesn't restart, only the window dies
const settingsNow = readJson("settings.json");
writeFileSync(join(SAFE, "settings.json"), JSON.stringify({ ...settingsNow, plugins: { ...settingsNow.plugins, crasher: { enabled: true } } }));
const s7 = await start("renderer crashes while running");
check("two renderer crashes in a row switch the running Discord into safe mode", s7.crashes.length === 2 && s7.result?.safeMode?.reason === "renderer-crash" && s7.result.running.length === 0 && !!s7.result.notice, { crashes: s7.crashes, safeMode: s7.result?.safeMode });
check("that safe mode is saved for the next start", s7.state.forceSafe === "renderer-crash" && s7.state.pendingStarts === 0, s7.state);

const s8 = await start("start after the crashes");
check("next start is still in safe mode, nothing crashes", s8.result?.safeMode?.reason === "renderer-crash" && s8.crashes.length === 0 && s8.result.running.length === 0, s8.result?.safeMode);

// 8. Failing even in safe mode: one start without Evi at all
writeState({ pendingStarts: 4 });
const vanillaProbe = `(() => document.readyState === "complete" && document.querySelector("#app-mount") ? { evi: !!window.Evi, bridge: "EviNative" in window || "__eviClaimNative" in window } : null)()`;
const s9 = await start("failing even in safe mode", { probe: vanillaProbe });
check("after 4 failed starts, one start is vanilla, then safe mode again", s9.result?.evi === false && s9.result.bridge === false && s9.state.pendingStarts === 2 && s9.state.forceSafe === "renderer-crash", { result: s9.result, state: s9.state });

if (failed) {
    for (const [name, s] of Object.entries({ s1, s2, s3, s4, s5, s6, s7, s8, s9 })) console.log(`--- ${name} ---\n${s.log.slice(-1500)}`);
}
// The test app's own profile folder, created by Electron from APP_NAME
rmSync(join(process.env.APPDATA!, APP_NAME), { recursive: true, force: true });

server.stop(true);
process.exit(failed ? 1 : 0);
