/**
 * Runs Evi Setup (dist/Evi-Setup.exe, built with `bun scripts/build.ts --installer`) without its window
 * against a fake %LOCALAPPDATA% / %APPDATA% and a fake GitHub, never your real Discord or the network.
 * Checks that it writes the same loader as the CLI, byte for byte.
 *
 *   bun scripts/test-installer.ts
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join, resolve } from "path";

import pkg from "../package.json";
import { createAsar, readAsarFile } from "../src/shared/asar";
import { createShimAsar, ORIGINAL_ASAR, SHIM_MARKER } from "../src/shared/shim";

const ROOT = resolve(import.meta.dir, "..");
const EXE = join(ROOT, "dist", process.platform === "win32" ? "Evi-Setup.exe" : process.platform === "darwin" ? "Evi Setup.app/Contents/MacOS/evi-setup" : `Evi-Setup-linux-${process.arch}`);
const BASE = join(ROOT, "test-results", "installer-e2e");
const LOCAL = join(BASE, "local");
const ROAMING = join(BASE, "roaming");
const RESOURCES = join(LOCAL, "Discord", "app-1.0.9259", "resources");
const OLD_RESOURCES = join(LOCAL, "Discord", "app-1.0.9100", "resources");
const DATA = join(ROAMING, "Evi");

if (process.platform !== "win32") {
    console.log("The fake Discord here is a Windows layout: run this on Windows.");
    process.exit(0);
}
if (!existsSync(EXE)) {
    console.error(`${EXE} is missing. Run bun scripts/build.ts --installer first.`);
    process.exit(1);
}

rmSync(BASE, { recursive: true, force: true });
mkdirSync(RESOURCES, { recursive: true });
mkdirSync(ROAMING, { recursive: true });

const discordPkg = { name: "discord", productName: "Discord", main: "app_bootstrap/index.js" };
const discordAsar = createAsar({ "package.json": JSON.stringify(discordPkg), "app_bootstrap/index.js": "// discord" });
writeFileSync(join(RESOURCES, "app.asar"), discordAsar);

// What a release carries: evi-core.json is dist/embed.json plus the retired plugin list
const embed = JSON.parse(readFileSync(join(ROOT, "dist", "embed.json"), "utf8"));
const payload = (version: string) => Buffer.from(JSON.stringify({ ...embed, version, core: { ...embed.core, "main.js": embed.core["main.js"].replace(/\[Evi\] v\$\{"[^"]+"\}/, `[Evi] v\${"${version}"}`) }, retired: ["badges", "old-thing"] }));
const sha256 = (data: Uint8Array) => new Bun.CryptoHasher("sha256").update(data).digest("hex");

interface FakeRelease { tag: string; core?: Buffer; checksum?: string; }
const releases: Record<string, FakeRelease> = {};
let latest: string | undefined;
let downloads = 0;

const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch(req) {
        const { pathname, origin } = new URL(req.url);
        const describe = (r: FakeRelease) => Response.json({
            tag_name: r.tag,
            draft: false,
            assets: r.core ? ["evi-core.json", "evi-core.json.sha256"].map(name => ({ name, browser_download_url: `${origin}/download/${r.tag}/${name}` })) : [],
        });
        if (pathname === "/repos/BleedDev/evi/releases/latest") return latest ? describe(releases[latest]) : new Response("{}", { status: 404 });
        const tag = pathname.match(/^\/repos\/BleedDev\/evi\/releases\/tags\/(.+)$/)?.[1];
        if (tag) return releases[tag] ? describe(releases[tag]) : new Response("{}", { status: 404 });
        const asset = pathname.match(/^\/download\/([^/]+)\/(.+)$/);
        if (asset && releases[asset[1]]?.core) {
            const r = releases[asset[1]];
            if (asset[2] === "evi-core.json") {
                downloads++;
                return new Response(new Uint8Array(r.core!));
            }
            return new Response(`${r.checksum ?? sha256(r.core!)}  evi-core.json\n`);
        }
        return new Response("Not Found", { status: 404 });
    },
});
const API = server.url.href.replace(/\/$/, "");

function addRelease(version: string, withCore = true) {
    const tag = `v${version}`;
    releases[tag] = { tag, ...withCore && { core: payload(version) } };
    return releases[tag];
}

/** Async so the fake server in this process can answer while the exe runs */
async function setup(...args: string[]) {
    const proc = Bun.spawn([EXE, "--headless", ...args], {
        env: { ...process.env, LOCALAPPDATA: LOCAL, APPDATA: ROAMING, EVI_UPDATE_API: API },
        stdout: "pipe",
        stderr: "pipe",
    });
    const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
    let json: any;
    try {
        json = JSON.parse(out.trim().split("\n").pop() ?? "");
    } catch { }
    return { code, json, log: `${err}${out}`.trim() };
}

let failed = 0;
function check(name: string, ok: boolean, detail?: unknown) {
    if (!ok) failed++;
    console.log(`${ok ? "\x1b[32m✓" : "\x1b[31m✗"} ${name}\x1b[0m${!ok && detail !== undefined ? `\n  ${typeof detail === "string" ? detail : JSON.stringify(detail)}` : ""}`);
}

const asar = join(RESOURCES, "app.asar");
const original = join(RESOURCES, ORIGINAL_ASAR);
const stable = (json: any) => json?.installs?.find((i: any) => i.flavor === "stable");
const coreMain = join(DATA, "core", "main.js");

let r = await setup("status");
check("status: finds Stable, clean", r.code === 0 && stable(r.json)?.state === "clean" && stable(r.json)?.discordVersion === "1.0.9259", r.log);
check("status: lists every flavor, the rest as missing", r.json?.installs?.length === 4 && r.json.installs.filter((i: any) => i.state === "missing").length === 3, r.json);
check("status: reports its own version", r.json?.version === pkg.version, r.json?.version);

// Nothing published: a clear error, nothing touched
r = await setup("install", "--no-restart");
check("install with no release fails in plain words", r.code === 1 && /No Evi release has been published/.test(r.json?.error), r.log);
check("…and changes nothing", readFileSync(asar).equals(discordAsar) && !existsSync(original) && !existsSync(DATA));

// A bad checksum is refused before anything is written
addRelease(pkg.version).checksum = "0".repeat(64);
latest = `v${pkg.version}`;
r = await setup("install", "--no-restart");
check("checksum mismatch is refused", r.code === 1 && /doesn’t match the release’s checksum/.test(r.json?.error), r.log);
check("…and changes nothing", readFileSync(asar).equals(discordAsar) && !existsSync(original) && !existsSync(join(DATA, "core")));

// The latest release
addRelease(pkg.version);
downloads = 0;
r = await setup("install", "--no-restart");
check("install succeeds", r.code === 0 && r.json?.ok === true && /Installed Evi/.test(r.json?.outcomes?.[0]?.message), r.log);
check("install downloads the latest release", r.json?.version === pkg.version && downloads === 1, r.json);
check("Discord's archive moved to _app.asar untouched", readFileSync(original).equals(discordAsar));
check("loader is byte for byte what the CLI writes", readFileSync(asar).equals(createShimAsar({ corePath: coreMain }, discordPkg)), readAsarFile(asar, "index.js"));
check("core written to the data folder", Object.keys(embed.core).every(f => existsSync(join(DATA, "core", f))));
check("core marked as CommonJS", readFileSync(join(DATA, "core", "package.json"), "utf8") === JSON.stringify({ type: "commonjs" }));
check("a fresh install comes with no plugins", !existsSync(join(DATA, "plugins")) || !Object.keys(embed.plugins).some(id => existsSync(join(DATA, "plugins", id))));

r = await setup("status");
check("status: Evi installed, with its version", stable(r.json)?.state === "evi" && stable(r.json)?.eviVersion === pkg.version && stable(r.json)?.devBuild === false, stable(r.json));

// Removed plugins stay removed, retired ones go unless the store installed them, user plugins stay
const [somePlugin, kept, storePlugin] = Object.keys(embed.plugins);
writeFileSync(join(DATA, "removed-plugins.json"), JSON.stringify([somePlugin]));
// An official plugin from before (when installs laid them all down) is refreshed; one from the store isn't touched
mkdirSync(join(DATA, "plugins", kept), { recursive: true });
writeFileSync(join(DATA, "plugins", kept, "manifest.json"), "{}");
mkdirSync(join(DATA, "plugins", storePlugin), { recursive: true });
writeFileSync(join(DATA, "plugins", storePlugin, "manifest.json"), "{}");
writeFileSync(join(DATA, "plugins", storePlugin, ".evi-store.json"), "{}");
mkdirSync(join(DATA, "plugins", "badges"), { recursive: true });
mkdirSync(join(DATA, "plugins", "old-thing"), { recursive: true });
writeFileSync(join(DATA, "plugins", "old-thing", ".evi-store.json"), "{}");
mkdirSync(join(DATA, "plugins", "my-own"), { recursive: true });
writeFileSync(join(DATA, "plugins", "my-own", "manifest.json"), "{}");
writeFileSync(join(DATA, "core", "stale.js"), "");
r = await setup("install", "--no-restart");
check("reinstall succeeds and says Updated", r.code === 0 && /Updated Evi/.test(r.json?.outcomes?.[0]?.message), r.log);
check("a plugin you removed stays removed", !existsSync(join(DATA, "plugins", somePlugin)));
check("an official plugin you already had is updated", readFileSync(join(DATA, "plugins", kept, "manifest.json"), "utf8") !== "{}");
check("a plugin installed from the store is left alone", readFileSync(join(DATA, "plugins", storePlugin, "manifest.json"), "utf8") === "{}");
check("no other plugins are added", Object.keys(embed.plugins).filter(id => existsSync(join(DATA, "plugins", id))).sort().join() === [kept, storePlugin].sort().join());
check("a retired plugin is deleted", !existsSync(join(DATA, "plugins", "badges")));
check("a retired id the store installed is kept", existsSync(join(DATA, "plugins", "old-thing")));
check("your own plugins are left alone", existsSync(join(DATA, "plugins", "my-own", "manifest.json")));
check("the core folder is replaced, not merged", !existsSync(join(DATA, "core", "stale.js")));
check("Discord's archive still intact after reinstall", readFileSync(original).equals(discordAsar));

// One build of Setup serves every release: it installs whatever is latest, never its own version
addRelease("99.0.0");
latest = "v99.0.0";
r = await setup("check");
check("check: names the Evi it would install", r.code === 0 && r.json?.version === "99.0.0", r.json);
r = await setup("install", "--no-restart");
check("install lays down the latest release, newer than Setup itself", r.code === 0 && r.json?.version === "99.0.0", r.log);
r = await setup("status");
check("status: shows the newer Evi", stable(r.json)?.eviVersion === "99.0.0", stable(r.json));

// The latest release without evi-core.json: a plain error, nothing touched
releases["v99.0.0"] = { tag: "v99.0.0" };
r = await setup("check");
check("check: a latest release without Evi names nothing", r.code === 0 && r.json?.version == null, r.json);
r = await setup("install", "--no-restart");
check("install from a latest release without Evi fails in plain words", r.code === 1 && /doesn’t include evi-core\.json/.test(r.json?.error) && stable((await setup("status")).json)?.eviVersion === "99.0.0", r.log);
addRelease(pkg.version);
latest = `v${pkg.version}`;

// Uninstall, including an older app- folder the auto-repair injected too
mkdirSync(OLD_RESOURCES, { recursive: true });
writeFileSync(join(OLD_RESOURCES, ORIGINAL_ASAR), discordAsar);
writeFileSync(join(OLD_RESOURCES, "app.asar"), createShimAsar({ corePath: coreMain }, discordPkg));
r = await setup("uninstall", "--no-restart");
check("uninstall succeeds", r.code === 0 && /Removed Evi/.test(r.json?.outcomes?.[0]?.message), r.log);
check("original app.asar restored byte for byte", readFileSync(asar).equals(discordAsar) && !existsSync(original));
check("older version folders cleaned too", readFileSync(join(OLD_RESOURCES, "app.asar")).equals(discordAsar) && !existsSync(join(OLD_RESOURCES, ORIGINAL_ASAR)));
check("your data folder is kept", existsSync(join(DATA, "plugins", "my-own")));
r = await setup("uninstall", "--no-restart");
check("uninstall again says it wasn't installed", r.code === 0 && /wasn’t installed/.test(r.json?.outcomes?.[0]?.message), r.log);

// Another mod's layout: _app.asar exists and app.asar isn't ours
writeFileSync(original, discordAsar);
writeFileSync(asar, createAsar({ "index.js": "// vencord", "package.json": "{}" }));
r = await setup("status");
check("status: another mod is reported", stable(r.json)?.state === "other-mod", stable(r.json));
r = await setup("install", "--no-restart");
check("refuses to install over another client mod", r.code === 1 && /Another client mod/.test(r.json?.outcomes?.[0]?.message), r.log);
check("other mod's files left alone", readAsarFile(asar, "index.js") === "// vencord");

// Flavors: only what's asked for is touched
const ptbResources = join(LOCAL, "DiscordPTB", "app-1.0.1000", "resources");
mkdirSync(ptbResources, { recursive: true });
writeFileSync(join(ptbResources, "app.asar"), discordAsar);
r = await setup("install", "--flavor", "ptb", "--no-restart");
check("install --flavor ptb touches only PTB", r.code === 0 && readAsarFile(join(ptbResources, "app.asar"), "index.js").startsWith(SHIM_MARKER) && readAsarFile(asar, "index.js") === "// vencord", r.log);
r = await setup("uninstall", "--flavor", "ptb", "--no-restart");
check("uninstall --flavor ptb restores PTB", r.code === 0 && readFileSync(join(ptbResources, "app.asar")).equals(discordAsar), r.log);

// Upgrading an install from before the rename: an old "// delight-shim" loader and %APPDATA%\Delight
writeFileSync(original, discordAsar);
writeFileSync(asar, createAsar({ "index.js": "// delight-shim\nrequire(\"x\");", "package.json": "{}" }));
rmSync(DATA, { recursive: true, force: true });
mkdirSync(join(ROAMING, "Delight", "themes"), { recursive: true });
writeFileSync(join(ROAMING, "Delight", "settings.json"), "{}");
writeFileSync(join(ROAMING, "Delight", "themes", "mine.css"), ":root{}");
r = await setup("status");
check("rename: an old Delight loader counts as installed", stable(r.json)?.state === "evi", stable(r.json));
check("rename: the old data folder moved to %APPDATA%\\Evi", !existsSync(join(ROAMING, "Delight")) && existsSync(join(DATA, "settings.json")) && existsSync(join(DATA, "themes", "mine.css")));
r = await setup("install", "--no-restart");
check("rename: install upgrades the old loader", r.code === 0 && readFileSync(asar).equals(createShimAsar({ corePath: coreMain }, discordPkg)), r.log);
r = await setup("uninstall", "--no-restart");
check("rename: uninstall restores Discord", r.code === 0 && readFileSync(asar).equals(discordAsar), r.log);

// No Discord at all
rmSync(LOCAL, { recursive: true, force: true });
mkdirSync(LOCAL);
r = await setup("install", "--no-restart");
check("no Discord: a plain error", r.code === 1 && /No Discord installation found/.test(r.json?.error), r.log);

server.stop(true);
process.exit(failed ? 1 : 0);
