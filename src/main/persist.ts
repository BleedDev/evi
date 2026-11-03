import { ORIGINAL_ASAR, SHIM_MARKER } from "@shared/shim";
import { spawn } from "child_process";
import { app } from "electron";
import { homedir } from "os";
import { basename, dirname, join, resolve } from "path";
import { fileURLToPath } from "url";

import { DATA_DIR } from "./paths";

// Electron's fs treats .asar files as folders, original-fs sees them as the plain files they are
const fs: typeof import("fs") = require("original-fs");

/** How long Discord's install folder has to stay quiet before a new version counts as fully written */
const SETTLE_MS = 60_000;
/** A version Discord just wrote stays locked for a moment: an antivirus scanning it, the updater closing it */
const LOCKED = new Set(["EBUSY", "EPERM", "EACCES"]);
const RETRY_MS = 250;
/** How long a quit waits out such a lock. Discord starts the new version right after, and it would start without us */
const QUIT_WAIT_MS = 10_000;
/** How long a watcher that failed waits before watching again */
const REWATCH_MS = 1000;

const sleep = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/** macOS: leaves the relink shell behind if Discord is quitting into an update (relinkAfterMacUpdate) */
let macHandOff: (() => void) | undefined;

/**
 * Evi's own restarts (relaunch in idle.ts, an update's restart) end in app.exit, which skips
 * before-quit. Node's exit event isn't something to count on there, so they call this first
 */
export function beforeEviRestart() {
    macHandOff?.();
}

/**
 * Discord's updater installs each version into a fresh app-x.y.z folder, which would silently drop
 * us. Move our loader into any sibling version that lacks it: on startup, once an update has been
 * written, and when Discord quits. macOS replaces the whole Discord.app instead: see relinkAfterMacUpdate.
 *
 * @param shimAsar our loader archive, resources/app.asar of the running version
 */
export function persistAcrossUpdates(shimAsar: string) {
    if (process.platform === "darwin") return relinkAfterMacUpdate(shimAsar);
    const appDir = dirname(dirname(shimAsar));
    if (!basename(appDir).startsWith("app-")) return;

    const installRoot = dirname(appDir);
    const watched = new Map<string, ReturnType<typeof fs.watch>>();

    /** Discord's archive never goes missing: the loader is copied in beside it first, then the two swap names */
    const inject = (resources: string) => {
        const asar = join(resources, "app.asar");
        const original = join(resources, ORIGINAL_ASAR);
        const incoming = join(resources, "app.asar.evi");
        fs.copyFileSync(shimAsar, incoming);
        try {
            fs.renameSync(asar, original);
        } catch (err) {
            fs.rmSync(incoming, { force: true });
            throw err;
        }
        try {
            fs.renameSync(incoming, asar);
        } catch (err) {
            fs.renameSync(original, asar);
            fs.rmSync(incoming, { force: true });
            throw err;
        }
    };

    /** false while a version that needs us is locked, so it's worth trying again */
    const run = () => {
        let done = true;
        try {
            for (const [path, watcher] of watched) {
                if (path !== installRoot && !fs.existsSync(path)) {
                    watcher.close();
                    watched.delete(path);
                }
            }
            for (const dir of fs.readdirSync(installRoot)) {
                if (!dir.startsWith("app-")) continue;
                if (process.platform === "linux") watch(join(installRoot, dir));
                const resources = join(installRoot, dir, "resources");
                if (!fs.existsSync(join(resources, "app.asar")) || fs.existsSync(join(resources, ORIGINAL_ASAR))) continue;
                try {
                    inject(resources);
                    console.log("[Evi] Injected into updated Discord at", resources);
                } catch (err: any) {
                    if (LOCKED.has(err?.code)) done = false;
                    else console.error("[Evi] Failed to persist across update", err);
                }
            }
        } catch (err) {
            console.error("[Evi] Failed to persist across update", err);
        }
        return done;
    };

    let retry: NodeJS.Timeout | undefined;
    const runSoon = (tries = QUIT_WAIT_MS / RETRY_MS) => {
        clearTimeout(retry);
        if (run() || tries <= 0) return;
        retry = setTimeout(() => runSoon(tries - 1), RETRY_MS);
        retry.unref();
    };
    // Nothing runs after these, so they wait right here. One wait for both: exit follows before-quit
    let quitDeadline = 0;
    const runBeforeExit = () => {
        clearTimeout(retry);
        quitDeadline ||= Date.now() + QUIT_WAIT_MS;
        while (!run() && Date.now() < quitDeadline) sleep(RETRY_MS);
    };

    // before-quit never fires when Windows shuts down, restarts or logs off, and Discord's updater
    // writes the new version while Discord runs: left open overnight, the next start had no Evi.
    // So move in as soon as the updater is done writing, without waiting for a quit
    let settle: NodeJS.Timeout | undefined;
    const watch = (path: string) => {
        if (watched.has(path)) return;
        let watcher: ReturnType<typeof fs.watch>;
        try {
            // Linux's install root is also userData: watch versions recursively, never profile caches.
            watcher = fs.watch(path, { recursive: path !== installRoot || process.platform === "win32" }, (event, file) => {
                if (path === installRoot && process.platform === "linux" && file && !/^app-[^\\/]+$/.test(file)) return;
                // Discord's own updater writes a version into .app-x.y.z.installing and renames it to
                // app-x.y.z when it's complete. At startup it relaunches into it a few seconds later,
                // long before the settle below: move in right away
                if (path === installRoot && event === "rename" && file && /^app-[^\\/]+$/.test(file)) return runSoon();
                clearTimeout(settle);
                settle = setTimeout(runSoon, SETTLE_MS);
                settle.unref();
            });
        } catch (err) {
            return console.error("[Evi] Can't watch Discord's folder for updates", err);
        }
        watched.set(path, watcher);
        watcher.unref();
        // On Windows, deleting a watched subfolder errors the watcher and it stops for good, and
        // Discord's updater deletes the old app-x.y.z while Discord runs: look again, then watch anew
        watcher.on("error", err => {
            console.warn("[Evi] Discord folder watcher failed, restarting it", err);
            watcher.close();
            watched.delete(path);
            setTimeout(() => {
                runSoon();
                watch(path);
            }, REWATCH_MS).unref();
        });
    };
    watch(installRoot);
    runSoon();
    app.on("before-quit", runBeforeExit);
    // app.exit() skips before-quit
    process.on("exit", runBeforeExit);
}

/**
 * Waits for Discord to quit, then for ShipIt to put a new Discord.app in place of the old one (its
 * Contents folder is a new one), and moves the loader into it the moment it's there: ShipIt starts
 * Discord again right after. Arguments: Discord's pid, Contents, its inode now, the loader to copy,
 * Discord's archive's new name, the loader's marker, the log.
 */
export const RELINK_SH = `
pid=$1 contents=$2 ino=$3 loader=$4 original=$5 marker=$6 log=$7
res="$contents/Resources"
note() { echo "$(date '+%Y-%m-%d %H:%M:%S') $*" >> "$log"; }
n=0
while kill -0 "$pid" 2>/dev/null; do
    n=$((n + 1)); [ $n -gt 300 ] && exit 0
    sleep 0.2
done
n=0
while [ $n -lt 3600 ]; do
    set -- $(ls -di "$contents" 2>/dev/null)
    if [ "$1" != "$ino" ] && [ -f "$res/app.asar" ]; then
        if [ -e "$res/$original" ] || grep -qF "$marker" "$res/app.asar"; then exit 0; fi
        if cp "$loader" "$res/app.asar.evi" 2>>"$log" && mv "$res/app.asar" "$res/$original" 2>>"$log"; then
            if mv "$res/app.asar.evi" "$res/app.asar" 2>>"$log"; then note "Put Evi back into the updated $contents"; exit 0; fi
            mv "$res/$original" "$res/app.asar"
        fi
        rm -f "$res/app.asar.evi"
        note "Couldn't put Evi back into the updated $contents"
        exit 1
    fi
    n=$((n + 1)); sleep 0.05
done
note "Discord quit with an update waiting, but $contents wasn't replaced"
`;

/** A bundle's CFBundleVersion, from an XML Info.plist */
function bundleVersion(contents: string) {
    try {
        return /<key>CFBundleVersion<\/key>\s*<string>([^<]+)<\/string>/.exec(fs.readFileSync(join(contents, "Info.plist"), "utf8"))?.[1];
    } catch { }
}

/**
 * Whether Squirrel has asked ShipIt to replace this Discord.app: its request (JSON, whatever the name
 * says) is written once an update is ready. One from an earlier start counts too: Evi's own restart
 * brings Discord back before ShipIt gets going, and ShipIt then waits for that Discord to quit. The
 * request and its update bundle stay behind after ShipIt installs, so it counts while the update is
 * another version than this Discord; without versions to compare, while it's newer than `since`.
 */
export function shipItWaiting(contents: string, since: number, caches = join(homedir(), "Library", "Caches")) {
    const running = bundleVersion(contents);
    try {
        return fs.readdirSync(caches).some(dir => {
            const state = join(caches, dir, "ShipItState.plist");
            if (!dir.startsWith("com.hnc.Discord") || !dir.endsWith(".ShipIt") || !fs.existsSync(state)) return false;
            try {
                const request = JSON.parse(fs.readFileSync(state, "utf8"));
                // PTB's and Canary's caches start with com.hnc.Discord too
                if (resolve(fileURLToPath(request.targetBundleURL)) !== resolve(dirname(contents))) return false;
                const update = bundleVersion(join(fileURLToPath(request.updateBundleURL), "Contents"));
                if (update && running) return update !== running;
            } catch { }
            return fs.statSync(state).mtimeMs > since;
        });
    } catch {
        return false;
    }
}

/**
 * macOS Discord updates through Squirrel: once an update is downloaded, quitting hands it to ShipIt,
 * which swaps in a whole new Discord.app, without the loader, and starts it. Evi Setup's launchd
 * watcher looks seconds later, after Discord already started without Evi, and macOS's App Management
 * can refuse it outright, since it isn't Discord. So when Discord quits with an update waiting, it
 * leaves a shell behind that moves the loader in as soon as the new bundle is there. A child of
 * Discord's changes Discord's bundle as Discord.
 */
function relinkAfterMacUpdate(shimAsar: string) {
    const contents = dirname(dirname(shimAsar));
    if (basename(contents) !== "Contents") return;

    const started = Date.now();
    let downloaded = false;
    try {
        // The same autoUpdater Discord's host updater uses on macOS
        require("electron").autoUpdater.on("update-downloaded", () => downloaded = true);
    } catch { }
    // before-quit and exit both come on one quit, and a quit can be called off
    let handedOff = 0;
    const handOff = () => {
        if (Date.now() - handedOff < 60_000 || !(downloaded || shipItWaiting(contents, started))) return;
        handedOff = Date.now();
        try {
            // The old bundle, the running loader with it, is gone by the time it's needed
            const loader = join(DATA_DIR, "relink-loader.asar");
            fs.copyFileSync(shimAsar, loader);
            const ino = fs.statSync(contents, { bigint: true }).ino.toString();
            spawn("/bin/sh", ["-c", RELINK_SH, "evi-relink", String(process.pid), contents, ino, loader, ORIGINAL_ASAR, SHIM_MARKER, join(DATA_DIR, "relink.log")], {
                detached: true,
                stdio: "ignore",
            }).unref();
            console.log("[Evi] Discord is quitting to update, Evi will move into the new version");
        } catch (err) {
            console.error("[Evi] Couldn't prepare to follow Discord's update", err);
        }
    };
    macHandOff = handOff;
    app.on("before-quit", handOff);
    // app.exit() skips before-quit
    process.on("exit", handOff);
}
