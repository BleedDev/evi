import { ORIGINAL_ASAR } from "@shared/shim";
import { app } from "electron";
import { basename, dirname, join } from "path";

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
 * written, and when Discord quits.
 *
 * @param shimAsar our loader archive, resources/app.asar of the running version
 */
export function persistAcrossUpdates(shimAsar: string) {
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
