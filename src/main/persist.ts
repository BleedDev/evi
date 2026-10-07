import { ORIGINAL_ASAR } from "@shared/shim";
import { app } from "electron";
import { basename, dirname, join } from "path";

// Electron's fs treats .asar files as folders, original-fs sees them as the plain files they are
const fs: typeof import("fs") = require("original-fs");

/** How long Discord's install folder has to stay quiet before a new version counts as fully written */
const SETTLE_MS = 60_000;

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

    const run = () => {
        try {
            for (const dir of fs.readdirSync(installRoot)) {
                if (!dir.startsWith("app-")) continue;
                const resources = join(installRoot, dir, "resources");
                const asar = join(resources, "app.asar");
                const original = join(resources, ORIGINAL_ASAR);
                if (!fs.existsSync(asar) || fs.existsSync(original)) continue;

                fs.renameSync(asar, original);
                fs.copyFileSync(shimAsar, asar);
                console.log("[Evi] Injected into updated Discord at", resources);
            }
        } catch (err) {
            console.error("[Evi] Failed to persist across update", err);
        }
    };

    run();
    app.on("before-quit", run);

    // before-quit never fires when Windows shuts down, restarts or logs off, and Discord's updater
    // writes the new version while Discord runs: left open overnight, the next start had no Evi.
    // So move in as soon as the updater is done writing, without waiting for a quit
    if (!basename(dirname(dirname(shimAsar))).startsWith("app-")) return;
    let settle: NodeJS.Timeout | undefined;
    try {
        fs.watch(installRoot, { recursive: true }, () => {
            clearTimeout(settle);
            settle = setTimeout(run, SETTLE_MS);
            settle.unref();
        }).unref();
    } catch (err) {
        console.error("[Evi] Can't watch Discord's folder for updates", err);
    }
}
