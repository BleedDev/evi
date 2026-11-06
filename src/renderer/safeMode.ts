import type { RecentChange, SafeModeInfo } from "@shared/ipc";
import { STABLE_MS } from "@shared/safeMode";

import { discordBuild } from "./crashReport";
import { Logger } from "./logger";
import { Native } from "./native";
import { Settings } from "./settings";

const logger = new Logger("SafeMode", "#f0b232");

let info: SafeModeInfo | undefined;
let reportedOk = false;

/** See src/main/safeMode.ts. In safe mode plugins are listed but never evaluated, and no CSS is applied. */
export const SafeMode = {
    init(initial: SafeModeInfo | undefined) {
        info = initial;
    },

    get active() {
        return !!info;
    },

    get info() {
        return info;
    },

    /** Whether this start was reported as healthy, for tests */
    get reportedOk() {
        return reportedOk;
    },

    /** Plugins have started. If Discord stays up a few seconds more, this start was healthy. */
    scheduleBootOk() {
        setTimeout(() => {
            // Optional: a main process older than this renderer (dev, after Ctrl+R) doesn't have it
            Native.reportBootOk?.(discordBuild());
            reportedOk = true;
            logger.info("Healthy start reported");
        }, STABLE_MS);
    },

    /** Turns off what the change turned on, then restarts out of safe mode */
    async disableAndExit(change: RecentChange) {
        Settings.update(d => {
            if (change.kind === "plugin") (d.plugins[change.id] ??= {}).enabled = false;
            else if (change.kind === "theme") d.enabledThemes = d.enabledThemes.filter(f => f !== change.id);
            else d.quickCss = false;
        });
        await SafeMode.exit();
    },

    async exit() {
        // Written before main restarts us, a debounced save would be lost
        Settings.flush();
        await Native.exitSafeMode();
    },
};
