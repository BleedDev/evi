import { app } from "electron";
import { existsSync, mkdirSync, renameSync } from "fs";
import { join, resolve } from "path";

export const DATA_DIR = process.env.EVI_DATA_DIR ?? join(app.getPath("appData"), "Evi");

// Before the rename to Evi the data folder was %APPDATA%/Delight: move it over once, keeping everything
const LEGACY_DATA_DIR = join(app.getPath("appData"), "Delight");
if (!process.env.EVI_DATA_DIR && !existsSync(DATA_DIR) && existsSync(LEGACY_DATA_DIR)) {
    try {
        renameSync(LEGACY_DATA_DIR, DATA_DIR);
    } catch (err) {
        console.error("[Evi] Couldn't move the old Delight data folder", err);
    }
}
export const PLUGINS_DIR = join(DATA_DIR, "plugins");
export const SETTINGS_FILE = join(DATA_DIR, "settings.json");
export const THEMES_DIR = join(DATA_DIR, "themes");
export const QUICK_CSS_FILE = join(DATA_DIR, "quick.css");

mkdirSync(PLUGINS_DIR, { recursive: true });
mkdirSync(THEMES_DIR, { recursive: true });

/** Running from a repo's build output rather than the core `evi install` put in the data folder */
export function isDevBuild() {
    return resolve(globalThis.__eviCoreDir ?? "") !== resolve(DATA_DIR, "core");
}
