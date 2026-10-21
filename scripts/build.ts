/**
 *   bun scripts/build.ts            build core + plugins into dist/
 *   bun scripts/build.ts --watch    rebuild on change; running Discord hot-reloads plugins, Ctrl+R picks up core
 *   bun scripts/build.ts --cli      also compile the installer into dist/evi.exe
 *   bun scripts/build.ts --release  evi-core.json (the core and official plugins Evi Setup and updates download) and
 *                                   its .sha256; with --installer, Evi Setup's .sha256 too. With --cli as well, the evi CLI
 *                                   for every system (releases stopped carrying it at 1.5.0; it's for developing Evi)
 *   bun scripts/build.ts --installer  compile Evi Setup, the small window installer in installer/ (Rust + Tauri), into
 *                                   dist/Evi-Setup.exe. On its own it only does that and leaves core and plugins alone
 */
import type { BunPlugin } from "bun";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, watch, writeFileSync } from "fs";
import { basename, dirname, join, resolve } from "path";

import pkg from "../package.json";
import type { PluginManifest } from "../src/shared/ipc";
import { CORE_GZ_ASSET, RELEASE_ASSETS } from "../src/shared/release";
import { RETIRED_PLUGINS } from "../src/shared/store";
import { escapeNonLatin1 } from "./escapeNonLatin1";
import { mainLocales, strayKeys } from "./mainLocales";
import { lazyStringsPlugin } from "./lazyStrings";

const ROOT = resolve(import.meta.dir, "..");
const DIST = join(ROOT, "dist");
const CORE_OUT = join(DIST, "core");
const PLUGINS_OUT = join(DIST, "plugins");
/** Plugins only the tests load (Toolkit Demo exercises the toolkit): never shipped, never in the store */
const TEST_PLUGINS_OUT = join(DIST, "test-plugins");
const TEST_PLUGIN_ROOT = join(ROOT, "tests", "fixtures", "plugins");
const PLUGIN_ROOTS = [join(ROOT, "plugins"), join(ROOT, "userplugins")];

const args = new Set(process.argv.slice(2));
const WATCH = args.has("--watch");
const RELEASE = args.has("--release");
const CLI = args.has("--cli");
const INSTALLER = args.has("--installer");
// --release with --installer still builds evi-core.json
const INSTALLER_ONLY = INSTALLER && !CLI && !WATCH && !RELEASE;

/** Release assets next to the CLI's: what Evi Setup downloads, and Evi Setup itself */
const CORE_ASSET = "evi-core.json";
// macOS gets one app for Apple Silicon and Intel, zipped; Linux one file per processor
const INSTALLER_ASSET = process.platform === "win32" ? "Evi-Setup.exe" : process.platform === "darwin" ? "Evi-Setup-macos.zip" : `Evi-Setup-linux-${process.arch}`;

/** Bun cross-compiles, so every installer builds from any machine */
const TARGETS: Record<typeof RELEASE_ASSETS[number], string> = {
    "evi.exe": "bun-windows-x64",
    "evi-macos-arm64": "bun-darwin-arm64",
    "evi-macos-x64": "bun-darwin-x64",
    "evi-linux-x64": "bun-linux-x64",
    "evi-linux-arm64": "bun-linux-arm64",
};

const define = {
    EVI_VERSION: JSON.stringify(pkg.version),
    "process.env.NODE_ENV": JSON.stringify(WATCH ? "development" : "production"),
};

/** Our own JSX goes through the shim that forwards to Discord's React */
const jsxShim: BunPlugin = {
    name: "evi-jsx-shim",
    setup(build) {
        build.onResolve({ filter: /^react\/jsx-(dev-)?runtime$/ }, () => ({
            path: join(ROOT, "src/renderer/react/jsx-runtime.ts"),
        }));
    },
};

/**
 * Core outside --watch drops whitespace and comments only (code and names stay as they are) and is
 * one byte per character (see escapeNonLatin1): V8 keeps each script's source for as long as it runs.
 * Plugins stay as built: their code is what store review reads.
 */
async function bundle(label: string, config: Parameters<typeof Bun.build>[0], core = false) {
    const lean = core && !WATCH;
    const result = await Bun.build({ define, minify: lean ? { whitespace: true } : false, ...config });
    if (!result.success) {
        console.error(`✗ ${label}`);
        for (const log of result.logs) console.error(log);
        if (!WATCH) process.exit(1);
        return false;
    }
    if (lean) {
        for (const { path } of result.outputs) {
            try {
                const code = escapeNonLatin1(readFileSync(path, "utf8"));
                new Function(code);
                writeFileSync(path, code);
            } catch (e) {
                console.error(`✗ ${label}: ${e instanceof Error ? e.message : e}`);
                process.exit(1);
            }
        }
    }
    return true;
}

/** Evi's languages but English and What's new's notes, files main reads when they're needed (scripts/coreData.ts) */
async function writeCoreData() {
    mkdirSync(CORE_OUT, { recursive: true });
    const code = await Bun.spawn([process.execPath, join(ROOT, "scripts/coreData.ts"), CORE_OUT], { stdio: ["inherit", "inherit", "inherit"] }).exited;
    if (code === 0) return true;
    console.error("✗ core data");
    if (!WATCH) process.exit(1);
    return false;
}

async function buildCore() {
    const start = performance.now();
    const data = writeCoreData();
    const results = await Promise.all([
        bundle("main", {
            entrypoints: [join(ROOT, "src/main/index.ts")],
            outdir: CORE_OUT,
            naming: "main.js",
            target: "node",
            format: "cjs",
            external: ["electron", "original-fs"],
            plugins: WATCH ? [] : [mainLocales],
        }, true).then(ok => ok && mainKeysOk()),
        bundle("preload", {
            entrypoints: [join(ROOT, "src/preload/index.ts")],
            outdir: CORE_OUT,
            naming: "preload.js",
            target: "node",
            format: "cjs",
            external: ["electron"],
        }, true),
        bundle("renderer", {
            entrypoints: [join(ROOT, "src/renderer/index.ts")],
            outdir: CORE_OUT,
            naming: "renderer.js",
            target: "browser",
            format: "iife",
            plugins: [jsxShim],
            sourcemap: WATCH ? "inline" : "none",
        }, true),
        // What Discord's popout windows get instead of the renderer (src/renderer/popout.ts)
        bundle("popout", {
            entrypoints: [join(ROOT, "src/renderer/popout.ts")],
            outdir: CORE_OUT,
            naming: "popout.js",
            target: "browser",
            format: "iife",
            sourcemap: WATCH ? "inline" : "none",
        }, true),
    ]);
    results.push(await data);
    if (results.every(Boolean)) console.log(`✓ core (${Math.round(performance.now() - start)}ms)`);
}

/** Every key main.js names is in the tables it carries (scripts/mainLocales.ts) */
function mainKeysOk() {
    if (WATCH) return true;
    const stray = strayKeys(readFileSync(join(CORE_OUT, "main.js"), "utf8"));
    if (!stray.length) return true;
    console.error(`✗ main uses ${stray.join(", ")}, which main.js doesn't carry. Main's text goes under the prefixes in scripts/mainLocales.ts`);
    process.exit(1);
}

function findEntry(dir: string, name: string) {
    return ["ts", "tsx", "js", "jsx"].map(ext => join(dir, `${name}.${ext}`)).find(existsSync);
}

async function buildPlugin(dir: string, outRoot = PLUGINS_OUT) {
    const manifestPath = join(dir, "manifest.json");
    if (!existsSync(manifestPath)) return;

    const manifest: PluginManifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    manifest.id ??= basename(dir);
    const out = join(outRoot, manifest.id);

    const entry = findEntry(dir, "index");
    if (!entry) return console.error(`✗ ${manifest.id}: no index.ts`);

    const ok = await bundle(manifest.id, {
        entrypoints: [entry],
        outdir: out,
        naming: "index.js",
        target: "browser",
        format: "cjs",
        // Provided at runtime by Evi, see requireMap in src/renderer/plugins/manager.ts
        external: ["@evi/api", "react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime"],
        // Official plugins build their languages but English when first read. Not userplugins/: their
        // authors upload this build to evi.rest, whose checks may predate the lazy form
        plugins: outRoot === PLUGINS_OUT && dirname(dir) === PLUGIN_ROOTS[0] ? [lazyStringsPlugin] : [],
        sourcemap: WATCH ? "inline" : "none",
    });
    if (!ok) return;

    const nativeEntry = findEntry(dir, "native");
    if (nativeEntry) {
        const nativeOk = await bundle(`${manifest.id} native`, {
            entrypoints: [nativeEntry],
            outdir: out,
            naming: "native.js",
            target: "node",
            format: "cjs",
            external: ["electron"],
        });
        if (!nativeOk) return;
        manifest.native = "native.js";
    }

    manifest.main = "index.js";
    // Manifest last: the running client reloads once it changes
    writeFileSync(join(out, "manifest.json"), JSON.stringify(manifest, null, 4));
    console.log(`✓ plugin ${manifest.id}`);
}

function pluginDirs() {
    return PLUGIN_ROOTS.filter(existsSync).flatMap(root =>
        readdirSync(root, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => join(root, e.name)),
    );
}

/** Everything the compiled installer needs to lay down, as one JSON blob */
function writeEmbed() {
    const read = (dir: string) => Object.fromEntries(readdirSync(dir).map(f => [f, readFileSync(join(dir, f), "utf8")]));
    const embed = {
        version: pkg.version,
        core: read(CORE_OUT),
        plugins: Object.fromEntries(readdirSync(PLUGINS_OUT).map(id => [id, read(join(PLUGINS_OUT, id))])),
    };
    writeFileSync(join(DIST, "embed.json"), JSON.stringify(embed));
}

/**
 * Bun's cross-compiled macOS binaries carry a signature that doesn't match their contents, and Apple
 * Silicon kills those on launch. rcodesign (github.com/indygreg/apple-platform-rs) re-signs them ad hoc
 * from any system, like `codesign -s -` would on a Mac.
 */
function adhocSign(file: string) {
    const rcodesign = process.env.RCODESIGN || Bun.which("rcodesign");
    if (!rcodesign) {
        console.error("✗ rcodesign isn't installed, and the macOS installers need re-signing. Get it from https://github.com/indygreg/apple-platform-rs/releases or set RCODESIGN.");
        process.exit(1);
    }
    const sign = Bun.spawnSync([rcodesign, "sign", "--binary-identifier", "rest.evi.installer", file], { stderr: "pipe" });
    const problem = sign.exitCode === 0 ? signatureProblem(readFileSync(file)) : sign.stderr.toString();
    if (problem) {
        console.error(`✗ Signing ${basename(file)} failed: ${problem}`);
        process.exit(1);
    }
}

/**
 * What macOS checks before running a binary: the code directory covers the whole file up to the
 * signature, and every page hashes to what it records. (rcodesign's own verify trips over ad hoc signatures.)
 */
function signatureProblem(bin: Buffer): string | undefined {
    if (bin.readUInt32LE(0) !== 0xfeedfacf) return "not a 64-bit Mach-O";
    let sigOffset = -1;
    for (let i = 0, off = 32; i < bin.readUInt32LE(16); i++, off += bin.readUInt32LE(off + 4)) {
        if (bin.readUInt32LE(off) === 0x1d) sigOffset = bin.readUInt32LE(off + 8);
    }
    if (sigOffset < 0) return "no signature";
    for (let i = 0; i < bin.readUInt32BE(sigOffset + 8); i++) {
        const cd = sigOffset + bin.readUInt32BE(sigOffset + 16 + i * 8);
        if (bin.readUInt32BE(cd) !== 0xfade0c02) continue;
        const hashOffset = bin.readUInt32BE(cd + 16), pages = bin.readUInt32BE(cd + 28), codeLimit = bin.readUInt32BE(cd + 32);
        const hashSize = bin[cd + 36], hashType = bin[cd + 37], pageSize = 2 ** bin[cd + 39];
        if (codeLimit !== sigOffset) return `signs ${codeLimit} bytes of ${sigOffset}`;
        const algorithm = hashType === 2 ? "sha256" : hashType === 1 ? "sha1" : undefined;
        if (!algorithm) return `unknown hash type ${hashType}`;
        for (let p = 0; p < pages; p++) {
            const actual = new Bun.CryptoHasher(algorithm).update(bin.subarray(p * pageSize, Math.min((p + 1) * pageSize, codeLimit))).digest();
            if (!actual.subarray(0, hashSize).equals(bin.subarray(cd + hashOffset + p * hashSize, cd + hashOffset + (p + 1) * hashSize))) return `page ${p} doesn't match its hash`;
        }
    }
}

/** The installer for this machine, or with --release for every system at once */
async function compileCli() {
    writeEmbed();
    const builds = RELEASE ? RELEASE_ASSETS.map(asset => ({ asset, target: [`--target=${TARGETS[asset]}`] })) : [{ asset: "evi.exe", target: [] }];
    const codes = await Promise.all(builds.map(({ asset, target }) =>
        Bun.spawn(["bun", "build", "--compile", "--minify", ...target, join(ROOT, "src/cli/index.ts"), "--outfile", join(DIST, asset)], {
            stdio: ["inherit", "inherit", "inherit"],
        }).exited));
    const failed = codes.find(code => code !== 0);
    if (failed !== undefined) process.exit(failed);
    for (const { asset } of builds) {
        if (RELEASE) {
            if (asset.startsWith("evi-macos-")) adhocSign(join(DIST, asset));
            writeChecksum(asset);
        }
        console.log(`✓ dist/${asset}`);
    }
}

function writeChecksum(asset: string) {
    const hash = new Bun.CryptoHasher("sha256").update(readFileSync(join(DIST, asset))).digest("hex");
    writeFileSync(join(DIST, `${asset}.sha256`), `${hash}  ${asset}\n`);
}

/** The ids of the plugins in one of PLUGIN_ROOTS */
function pluginIds(root: string) {
    if (!existsSync(root)) return new Set<string>();
    return new Set(readdirSync(root, { withFileTypes: true }).filter(e => e.isDirectory() && existsSync(join(root, e.name, "manifest.json")))
        .map(e => (JSON.parse(readFileSync(join(root, e.name, "manifest.json"), "utf8")) as PluginManifest).id ?? e.name));
}

/**
 * What Evi Setup installs: the same as dist/embed.json, plus the plugins it should delete as retired.
 * Official plugins only: userplugins/ are someone's own, and this file is published with the release.
 */
function writeCoreAsset() {
    const [officialRoot, userRoot] = PLUGIN_ROOTS;
    const official = pluginIds(officialRoot);
    // Both build into dist/plugins/<id>, so the output could be either one
    const clash = [...pluginIds(userRoot)].filter(id => official.has(id));
    if (clash.length) {
        console.error(`✗ userplugins/ has ${clash.join(", ")}, which official plugins use too. Move them out of userplugins/ before a release build.`);
        process.exit(1);
    }
    const embed = JSON.parse(readFileSync(join(DIST, "embed.json"), "utf8"));
    const plugins = Object.fromEntries(Object.entries(embed.plugins).filter(([id]) => official.has(id)));
    const core = JSON.stringify({ ...embed, plugins, retired: RETIRED_PLUGINS });
    writeFileSync(join(DIST, CORE_ASSET), core);
    writeChecksum(CORE_ASSET);
    // What updates download first. No checksum of its own: they check what it unpacks to against evi-core.json's
    writeFileSync(join(DIST, CORE_GZ_ASSET), Bun.gzipSync(core, { level: 9 }));
    console.log(`✓ dist/${CORE_ASSET} and ${CORE_GZ_ASSET}`);
}

/** Evi Setup (installer/): a Rust + Tauri app, built with cargo for this system */
async function compileInstaller() {
    const cargo = Bun.which("cargo");
    if (!cargo) {
        console.error("✗ Evi Setup needs Rust: install it from https://rustup.rs");
        process.exit(1);
    }
    const dir = join(ROOT, "installer");
    if (process.platform === "darwin") await compileMacApp(cargo, dir);
    else {
        await run([cargo, "build", "--release", "--locked"], dir);
        copyFileSync(join(dir, "target", "release", process.platform === "win32" ? "evi-setup.exe" : "evi-setup"), join(DIST, INSTALLER_ASSET));
    }
    // Each system's build is made on its own CI runner, by itself: always with its checksum
    writeChecksum(INSTALLER_ASSET);
    console.log(`✓ dist/${INSTALLER_ASSET} (${(statSync(join(DIST, INSTALLER_ASSET)).size / 1024 / 1024).toFixed(1)} MB)`);
}

async function run(cmd: string[], cwd = ROOT) {
    const code = await Bun.spawn(cmd, { cwd, stdio: ["inherit", "inherit", "inherit"] }).exited;
    if (code !== 0) {
        console.error(`✗ ${cmd.join(" ")} failed (${code})`);
        process.exit(code);
    }
}

/**
 * Evi Setup.app for Apple Silicon and Intel in one: both builds joined with lipo, the bundle put
 * together here (Tauri's bundler would need its CLI for three files), signed ad hoc, which Apple
 * Silicon needs to run it at all, and zipped with ditto so the bundle survives the download.
 * Unnotarized: macOS asks once, and the download page says where to click Open Anyway.
 */
async function compileMacApp(cargo: string, dir: string) {
    const targets = ["aarch64-apple-darwin", "x86_64-apple-darwin"];
    // One cargo run for both: each one's last step (LTO, one codegen unit) is single-threaded, so they overlap
    await run([cargo, "build", "--release", "--locked", ...targets.flatMap(t => ["--target", t])], dir);

    const app = join(DIST, "Evi Setup.app");
    rmSync(app, { recursive: true, force: true });
    mkdirSync(join(app, "Contents", "MacOS"), { recursive: true });
    mkdirSync(join(app, "Contents", "Resources"), { recursive: true });
    await run(["lipo", "-create", "-output", join(app, "Contents", "MacOS", "evi-setup"), ...targets.map(t => join(dir, "target", t, "release", "evi-setup"))]);
    copyFileSync(join(dir, "icons", "icon.icns"), join(app, "Contents", "Resources", "icon.icns"));
    writeFileSync(join(app, "Contents", "Info.plist"), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleDevelopmentRegion</key><string>en</string>
    <key>CFBundleDisplayName</key><string>Evi Setup</string>
    <key>CFBundleExecutable</key><string>evi-setup</string>
    <key>CFBundleIconFile</key><string>icon.icns</string>
    <key>CFBundleIdentifier</key><string>rest.evi.setup</string>
    <key>CFBundleInfoDictionaryVersion</key><string>6.0</string>
    <key>CFBundleName</key><string>Evi Setup</string>
    <key>CFBundlePackageType</key><string>APPL</string>
    <key>CFBundleShortVersionString</key><string>${pkg.version}</string>
    <key>CFBundleVersion</key><string>${pkg.version}</string>
    <key>LSApplicationCategoryType</key><string>public.app-category.utilities</string>
    <key>LSMinimumSystemVersion</key><string>10.15</string>
    <key>NSHighResolutionCapable</key><true/>
</dict>
</plist>
`);
    await run(["codesign", "--force", "--deep", "--sign", "-", app]);
    rmSync(join(DIST, INSTALLER_ASSET), { force: true });
    await run(["ditto", "-c", "-k", "--sequesterRsrc", "--keepParent", app, join(DIST, INSTALLER_ASSET)]);
}

function debounce(fn: () => void, ms = 100) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    return () => {
        clearTimeout(timer);
        timer = setTimeout(fn, ms);
    };
}

if (INSTALLER_ONLY) {
    mkdirSync(DIST, { recursive: true });
    await compileInstaller();
    process.exit(0);
}

// Overwrite in place rather than wiping dist/: a running Discord watches it, and a wipe would
// briefly uninstall every plugin. Only drop plugin outputs whose source folder is gone.
mkdirSync(PLUGINS_OUT, { recursive: true });
const sourceIds = new Set(pluginDirs().map(dir => basename(dir)));
for (const id of readdirSync(PLUGINS_OUT)) {
    if (!sourceIds.has(id)) rmSync(join(PLUGINS_OUT, id), { recursive: true, force: true });
}
// The repo is "type": "module", but Electron has to load our output as CommonJS
writeFileSync(join(DIST, "package.json"), JSON.stringify({ type: "commonjs" }));

await buildCore();
await Promise.all(pluginDirs().map(dir => buildPlugin(dir)));
if (existsSync(TEST_PLUGIN_ROOT)) {
    await Promise.all(readdirSync(TEST_PLUGIN_ROOT, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => buildPlugin(join(TEST_PLUGIN_ROOT, e.name), TEST_PLUGINS_OUT)));
}
writeEmbed();
if (CLI) await compileCli();
if (RELEASE) writeCoreAsset();
if (INSTALLER) await compileInstaller();

if (WATCH) {
    watch(join(ROOT, "src"), { recursive: true }, debounce(buildCore));
    for (const root of PLUGIN_ROOTS.filter(existsSync)) {
        const pending = new Map<string, () => void>();
        watch(root, { recursive: true }, (_event, filename) => {
            if (!filename) return;
            const folder = filename.split(/[\\/]/)[0];
            if (!pending.has(folder)) pending.set(folder, debounce(() => buildPlugin(join(root, folder))));
            pending.get(folder)!();
        });
    }
    console.log("Watching for changes…");
}
