import { ORIGINAL_ASAR, SHIM_MARKER } from "@shared/shim";
import { spawn } from "child_process";
import { app } from "electron";
import { homedir } from "os";
import { basename, dirname, join } from "path";

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

/**
 * Discord's updater installs each version into a fresh app-x.y.z folder, which would silently drop
 * us. Move our loader into any sibling version that lacks it: on startup, once an update has been
 * written, and when Discord quits. macOS replaces the whole Discord.app instead: see relinkAfterMacUpdate.
 *
 * @param shimAsar our loader archive, resources/app.asar of the running version
 */
export function persistAcrossUpdates(shimAsar: string) {
    if (process.platform === "darwin") return relinkAfterMacUpdate(shimAsar);
    if (process.platform !== "win32") return;

    const installRoot = dirname(dirname(dirname(shimAsar)));

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
            for (const dir of fs.readdirSync(installRoot)) {
                if (!dir.startsWith("app-")) continue;
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

    runSoon();
    app.on("before-quit", runBeforeExit);
    // app.exit() skips before-quit
    process.on("exit", runBeforeExit);

    // before-quit never fires when Windows shuts down, restarts or logs off, and Discord's updater
    // writes the new version while Discord runs: left open overnight, the next start had no Evi.
    // So move in as soon as the updater is done writing, without waiting for a quit
    if (!basename(dirname(dirname(shimAsar))).startsWith("app-")) return;
    let settle: NodeJS.Timeout | undefined;
    const watch = () => {
        let watcher: ReturnType<typeof fs.watch>;
        try {
            watcher = fs.watch(installRoot, { recursive: true }, (event, file) => {
                // Discord's own updater writes a version into .app-x.y.z.installing and renames it to
                // app-x.y.z when it's complete. At startup it relaunches into it a few seconds later,
                // long before the settle below: move in right away
                if (event === "rename" && file && /^app-[^\\/]+$/.test(file)) return runSoon();
                clearTimeout(settle);
                settle = setTimeout(runSoon, SETTLE_MS);
                settle.unref();
            });
        } catch (err) {
            return console.error("[Evi] Can't watch Discord's folder for updates", err);
        }
        watcher.unref();
        // On Windows, deleting a watched subfolder errors the watcher and it stops for good, and
        // Discord's updater deletes the old app-x.y.z while Discord runs: look again, then watch anew
        watcher.on("error", err => {
            console.warn("[Evi] Discord folder watcher failed, restarting it", err);
            watcher.close();
            setTimeout(() => {
                runSoon();
                watch();
            }, REWATCH_MS).unref();
        });
    };
    watch();
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
    /** Squirrel's request to ShipIt, written once an update is ready */
    const shipItWaiting = () => {
        const caches = join(homedir(), "Library", "Caches");
        try {
            return fs.readdirSync(caches).some(dir => {
                const state = join(caches, dir, "ShipItState.plist");
                return dir.startsWith("com.hnc.Discord") && dir.endsWith(".ShipIt") && fs.existsSync(state) && fs.statSync(state).mtimeMs > started;
            });
        } catch {
            return false;
        }
    };

    // before-quit and exit both come on one quit, and a quit can be called off
    let handedOff = 0;
    const handOff = () => {
        if (Date.now() - handedOff < 60_000 || !(downloaded || shipItWaiting())) return;
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
    app.on("before-quit", handOff);
    // app.exit() skips before-quit
    process.on("exit", handOff);
}
