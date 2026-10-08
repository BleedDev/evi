/**
 * Runs the installer against a fake %LOCALAPPDATA% / %APPDATA%, never your real Discord.
 *
 *   bun scripts/test-cli.ts          test the source CLI
 *   bun scripts/test-cli.ts --exe    test the compiled dist/evi.exe
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join, resolve } from "path";

import pkg from "../package.json";
import { createAsar, readAsarFile } from "../src/shared/asar";
import { ORIGINAL_ASAR, SHIM_MARKER } from "../src/shared/shim";

const ROOT = resolve(import.meta.dir, "..");
const BASE = join(ROOT, "test-results", "cli");
const LOCAL = join(BASE, "local");
const ROAMING = join(BASE, "roaming");
const RESOURCES = join(LOCAL, "Discord", "app-1.0.9259", "resources");
const EXE = process.argv.includes("--exe");

rmSync(BASE, { recursive: true, force: true });
mkdirSync(RESOURCES, { recursive: true });
mkdirSync(ROAMING, { recursive: true });

const discordAsar = createAsar({
    "package.json": JSON.stringify({ name: "discord", productName: "Discord", main: "app_bootstrap/index.js" }),
    "app_bootstrap/index.js": "// discord",
});
writeFileSync(join(RESOURCES, "app.asar"), discordAsar);

function cli(...args: string[]) {
    const cmd = EXE ? [join(ROOT, "dist", "evi.exe"), ...args] : ["bun", join(ROOT, "src", "cli", "index.ts"), ...args];
    const proc = Bun.spawnSync(cmd, { env: { ...process.env, LOCALAPPDATA: LOCAL, APPDATA: ROAMING, NO_COLOR: "1" } });
    return { code: proc.exitCode, out: proc.stdout.toString() + proc.stderr.toString() };
}

let failed = 0;
function check(name: string, ok: boolean, detail?: unknown) {
    if (!ok) failed++;
    console.log(`${ok ? "\x1b[32m✓" : "\x1b[31m✗"} ${name}\x1b[0m${!ok && detail !== undefined ? `\n  ${String(detail).trim()}` : ""}`);
}

const asar = join(RESOURCES, "app.asar");
const original = join(RESOURCES, ORIGINAL_ASAR);
const shim = () => readAsarFile(asar, "index.js");

let r = cli("status");
check("status sees the clean install", r.out.includes("not installed"), r.out);

if (!EXE) {
    r = cli("install", "--dev");
    check("install --dev succeeds", r.code === 0 && r.out.includes("Installed"), r.out);
    check("Discord's archive moved to _app.asar untouched", readFileSync(original).equals(discordAsar));
    check("app.asar is our loader pointing at the repo build", shim().startsWith(SHIM_MARKER) && shim().includes(JSON.stringify(join(ROOT, "dist", "core", "main.js"))), shim());
    check("loader keeps Discord's app name", JSON.parse(readAsarFile(asar, "package.json")).name === "discord");
}

// An official plugin someone already has (installs used to lay them all down) gets updated; nothing is added
const pluginsDir = join(ROAMING, "Evi", "plugins");
mkdirSync(join(pluginsDir, "no-track"), { recursive: true });
writeFileSync(join(pluginsDir, "no-track", "manifest.json"), "{}");
r = cli("install");
check("install (bundled core) succeeds", r.code === 0 && /Installed|Updated/.test(r.out), r.out);
const coreDir = join(ROAMING, "Evi", "core");
check("core written to the data folder", ["main.js", "preload.js", "renderer.js"].every(f => existsSync(join(coreDir, f))));
check("core marked as CommonJS", JSON.parse(readFileSync(join(coreDir, "package.json"), "utf8")).type === "commonjs");
check("Evi comes with no plugins: none added", !["clear-urls", "experiments"].some(id => existsSync(join(pluginsDir, id))));
check("an official plugin you already had is updated", readFileSync(join(pluginsDir, "no-track", "manifest.json"), "utf8") !== "{}");
check("loader points at the installed core", shim().includes(JSON.stringify(join(coreDir, "main.js"))) && !shim().includes("EVI_DEV_PLUGINS"), shim());
check("Discord's archive still intact after reinstall", readFileSync(original).equals(discordAsar));

r = cli("status");
check("status reports installed", r.out.includes("installed") && !r.out.includes("not installed"), r.out);

// What the in-app updater runs as Discord quits: with Discord already gone it installs straight away
r = cli("install", "--wait");
check("install --wait with Discord closed updates at once", r.code === 0 && r.out.includes("Updated"), r.out);

r = cli("uninstall");
check("uninstall succeeds", r.code === 0 && r.out.includes("Removed"), r.out);
check("original app.asar restored byte for byte", readFileSync(asar).equals(discordAsar) && !existsSync(original));

// Another mod's layout: _app.asar exists and app.asar isn't ours
writeFileSync(original, discordAsar);
writeFileSync(asar, createAsar({ "index.js": "// vencord", "package.json": "{}" }));
r = cli("install");
check("refuses to install over another client mod", r.out.includes("another client mod"), r.out);
check("other mod's files left alone", readAsarFile(asar, "index.js") === "// vencord");

// evi update, against a local fake of GitHub's API. Never touches the network.

let latest: { status: number; tag?: string; } = { status: 404 };
let asset = new Uint8Array();
let checksum = "";
let downloads = 0;

const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch(req) {
        const { pathname, origin } = new URL(req.url);
        if (pathname === "/repos/BleedDev/evi/releases/latest") {
            if (!latest.tag) return new Response(JSON.stringify({ message: "Not Found" }), { status: latest.status });
            return Response.json({
                tag_name: latest.tag,
                html_url: `${origin}/releases/${latest.tag}`,
                draft: false,
                prerelease: false,
                assets: ["evi.exe", "evi.exe.sha256"].map(name => ({ name, browser_download_url: `${origin}/download/${name}` })),
            });
        }
        if (pathname === "/download/evi.exe") {
            downloads++;
            return new Response(asset);
        }
        if (pathname === "/download/evi.exe.sha256") return new Response(`${checksum}  evi.exe\n`);
        return new Response("Not Found", { status: 404 });
    },
});
const API = server.url.href.replace(/\/$/, "");

// The exe updates itself in place, so work on a copy
const BIN = join(BASE, "bin");
const exeCopy = join(BIN, "evi.exe");
if (EXE) {
    mkdirSync(BIN, { recursive: true });
    copyFileSync(join(ROOT, "dist", "evi.exe"), exeCopy);
}

/** Async so the fake server in this process can answer while the CLI runs */
async function update(args: string[], api = API) {
    const cmd = EXE ? [exeCopy, ...args] : ["bun", join(ROOT, "src", "cli", "index.ts"), ...args];
    const proc = Bun.spawn(cmd, {
        env: { ...process.env, LOCALAPPDATA: LOCAL, APPDATA: ROAMING, NO_COLOR: "1", EVI_UPDATE_API: api },
        stdout: "pipe",
        stderr: "pipe",
    });
    const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
    return { code, out: out + err };
}

latest = { status: 404 };
r = await update(["update"]);
check("update: no releases yet is reported clearly", r.code === 0 && r.out.includes("No Evi release has been published yet"), r.out);

latest = { status: 200, tag: `v${pkg.version}` };
r = await update(["update"]);
check("update: same version is up to date", r.code === 0 && r.out.includes(`${pkg.version} is up to date`), r.out);

latest = { status: 200, tag: "v0.0.1" };
r = await update(["update", "--check"]);
check("update: older release is up to date", r.code === 0 && r.out.includes("is up to date"), r.out);

latest = { status: 200, tag: "v99.0.0" };
r = await update(["update", "--check"]);
check("update --check: newer version reported", r.code === 0 && r.out.includes("99.0.0 is available"), r.out);
check("update --check: nothing downloaded", downloads === 0, `${downloads} downloads`);
if (EXE) check("update --check: exe untouched", readFileSync(exeCopy).equals(readFileSync(join(ROOT, "dist", "evi.exe"))) && !existsSync(`${exeCopy}.old`));

latest = { status: 500 };
r = await update(["update", "--check"]);
check("update: API error fails with a message", r.code === 1 && r.out.includes("GitHub answered 500"), r.out);

// Grab a free port, then close it so nothing is listening there
const closed = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response() });
const deadApi = closed.url.href.replace(/\/$/, "");
closed.stop(true);
r = await update(["update", "--check"], deadApi);
check("update: network error fails with a message", r.code === 1 && r.out.includes("Couldn't reach"), r.out);

latest = { status: 200, tag: "v99.0.0" };
if (!EXE) {
    r = await update(["update"]);
    check("update from source points at git pull", r.code === 0 && r.out.includes("git pull") && downloads === 0, r.out);
} else {
    const original = readFileSync(exeCopy);
    // Trailing bytes don't affect the exe, but make the new file distinguishable from the old one
    asset = Buffer.concat([original, Buffer.from("EVI-TEST-UPDATE")]);

    checksum = "0".repeat(64);
    r = await update(["update"]);
    check("update: checksum mismatch rejected", r.code === 1 && r.out.includes("Checksum mismatch"), r.out);
    check("update: exe untouched after a bad checksum", readFileSync(exeCopy).equals(original) && !existsSync(`${exeCopy}.old`) && !existsSync(`${exeCopy}.new`));

    // Clean Discord again (the last test left another mod in place), install Evi into Stable with the
    // current exe, and add a PTB without Evi: an update must refresh Stable and never inject into PTB
    rmSync(join(RESOURCES, ORIGINAL_ASAR), { force: true });
    writeFileSync(join(RESOURCES, "app.asar"), discordAsar);
    rmSync(join(ROAMING, "Evi"), { recursive: true, force: true });
    r = await update(["install"]);
    check("update setup: Evi installed into Stable", r.code === 0 && shim().startsWith(SHIM_MARKER), r.out);
    const ptbResources = join(LOCAL, "DiscordPTB", "app-1.0.1000", "resources");
    mkdirSync(ptbResources, { recursive: true });
    writeFileSync(join(ptbResources, "app.asar"), discordAsar);
    rmSync(join(ROAMING, "Evi", "core"), { recursive: true, force: true });

    checksum = new Bun.CryptoHasher("sha256").update(asset).digest("hex");
    r = await update(["update"]);
    check("update: succeeds with a valid checksum", r.code === 0 && r.out.includes("Updated") && r.out.includes("99.0.0"), r.out);
    check("update: exe replaced by the download", readFileSync(exeCopy).equals(asset));
    check("update: previous exe kept as .old", existsSync(`${exeCopy}.old`) && readFileSync(`${exeCopy}.old`).equals(original));
    check("update: refreshed the Discord that has Evi", r.out.includes("Updated Evi in Discord stable") && existsSync(join(ROAMING, "Evi", "core", "main.js")), r.out);
    check("update: never injects into a Discord without Evi", readFileSync(join(ptbResources, "app.asar")).equals(discordAsar) && !existsSync(join(ptbResources, ORIGINAL_ASAR)));

    r = await update(["status"]);
    check("update: next run removes the .old", r.code === 0 && !existsSync(`${exeCopy}.old`), r.out);
}
server.stop(true);

// The release workflow must parse, write its notes from the changelog, and publish only after testing what it uploads
const workflow = Bun.YAML.parse(readFileSync(join(ROOT, ".github", "workflows", "release.yml"), "utf8")) as any;
const triggers = Object.keys(workflow?.on ?? {}).sort().join(",");
check("release.yml parses, triggers only on manual runs and v* tags", triggers === "push,workflow_dispatch" && JSON.stringify(workflow.on.push) === JSON.stringify({ tags: ["v*"] }), triggers);
// The release job tests Evi and builds evi-core.json. Evi Setup comes from the last release when
// installer/ is unchanged (checksums checked), and the release job publishes; otherwise it builds and
// tests on each system (setup-builds.yml) and the publish job waits for both
const publishScript = readFileSync(join(ROOT, "scripts", "publish-release.sh"), "utf8");
const steps: any[] = workflow?.jobs?.release?.steps ?? [];
const stepIndex = (re: RegExp) => steps.findIndex((s: any) => re.test(s.run ?? ""));
const reuse = steps.find((s: any) => s.id === "setup")?.run ?? "";
const publishes = (job: any) => (job?.steps ?? []).some((s: any) => /scripts\/publish-release\.sh/.test(s.run ?? ""));
const setupWindows: any[] = (Bun.YAML.parse(readFileSync(join(ROOT, ".github", "workflows", "setup-builds.yml"), "utf8")) as any)?.jobs?.windows?.steps ?? [];
const installerTest = setupWindows.findIndex((s: any) => /test-installer\.ts/.test(s.run ?? ""));
const setupUpload = setupWindows.findIndex((s: any) => /upload-artifact/.test(s.uses ?? ""));
check("release.yml publishes with notes from the changelog, after everything it carries was tested",
    /--notes-file notes\.md/.test(publishScript) && !/--draft/.test(publishScript)
    && stepIndex(/release-notes\.ts/) >= 0 && stepIndex(/release-notes\.ts/) < stepIndex(/scripts\/build\.ts --release/)
    && stepIndex(/bun test/) >= 0 && stepIndex(/bun test/) < stepIndex(/publish-release\.sh/)
    && installerTest >= 0 && installerTest < setupUpload
    && publishes(workflow?.jobs?.release) && publishes(workflow?.jobs?.publish)
    && JSON.stringify(workflow?.jobs?.publish?.needs) === JSON.stringify(["release", "setup"])
    && workflow?.jobs?.setup?.needs === "release" && /setup-builds\.yml$/.test(workflow?.jobs?.setup?.uses ?? ""),
    publishScript);
check("release.yml reuses Evi Setup only while installer/ is unchanged, and checks its checksums",
    /git diff --quiet "\$last" HEAD -- installer/.test(reuse) && /sha256sum -c/.test(reuse) && /rebuild_setup/.test(JSON.stringify(workflow?.on?.workflow_dispatch)),
    reuse);
check("release.yml attaches Evi Setup for every system and evi-core.json, and no CLI (gone since 1.5.0)",
    ["Evi-Setup.exe", "Evi-Setup-macos.zip", "Evi-Setup-linux-{x64,arm64}", "evi-core.json"].every(f => publishScript.includes(f))
    && !/evi\.exe|evi-(macos|linux)-/.test(publishScript),
    publishScript);

// Upgrading an install from before the rename to Evi: an old "// delight-shim" loader and data in %APPDATA%\Delight
rmSync(join(RESOURCES, ORIGINAL_ASAR), { force: true });
writeFileSync(join(RESOURCES, ORIGINAL_ASAR), discordAsar);
writeFileSync(asar, createAsar({ "index.js": "// delight-shim\nrequire(\"x\");", "package.json": "{}" }));
rmSync(join(ROAMING, "Evi"), { recursive: true, force: true });
mkdirSync(join(ROAMING, "Delight", "themes"), { recursive: true });
writeFileSync(join(ROAMING, "Delight", "settings.json"), JSON.stringify({ plugins: { "fast-lists": { enabled: true } } }));
writeFileSync(join(ROAMING, "Delight", "themes", "mine.css"), ":root{}");
r = cli("status");
check("rename: an old Delight loader counts as installed, not as another mod", r.out.includes("installed") && !r.out.includes("another mod"), r.out);
check("rename: the old data folder moved to %APPDATA%\\Evi with everything in it", !existsSync(join(ROAMING, "Delight"))
    && existsSync(join(ROAMING, "Evi", "settings.json")) && existsSync(join(ROAMING, "Evi", "themes", "mine.css")));
r = cli("install");
check("rename: install upgrades the old loader to the Evi one", r.code === 0 && shim().startsWith(SHIM_MARKER), r.out);
r = cli("uninstall");
check("rename: uninstall still restores Discord", r.code === 0 && readFileSync(asar).equals(discordAsar), r.out);

process.exit(failed ? 1 : 0);
