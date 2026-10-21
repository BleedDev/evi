import { IPC, WallpaperPickResult, WallpaperReadResult } from "@shared/ipc";
import { extensionOf, MAX_WALLPAPER_BYTES, WALLPAPER_EXTENSIONS, wallpaperKind, wallpaperMime } from "@shared/wallpaper";
import { app, BrowserWindow, dialog, ipcMain, IpcMainInvokeEvent, powerMonitor } from "electron";
import { copyFileSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from "fs";
import { readFile } from "fs/promises";
import { join } from "path";

import { DATA_DIR } from "./paths";
import { broadcast, errorOf } from "./util";

/** Holds one file at most: the wallpaper, copied here so it survives the original being moved */
const WALLPAPER_DIR = join(DATA_DIR, "wallpaper");

/** Tests can't click through the native dialog: with this set, it answers with this path (like EVI_TEST_BACKUP_PATH) */
const TEST_PATH = process.env.EVI_TEST_WALLPAPER_PATH;

async function pickPath(e: IpcMainInvokeEvent) {
    if (TEST_PATH) return TEST_PATH;
    const win = BrowserWindow.fromWebContents(e.sender);
    const options: Electron.OpenDialogOptions = {
        title: "Choose a wallpaper",
        properties: ["openFile"],
        filters: [{ name: "Images and videos", extensions: WALLPAPER_EXTENSIONS }],
    };
    const { canceled, filePaths } = await (win ? dialog.showOpenDialog(win, options) : dialog.showOpenDialog(options));
    return canceled ? undefined : filePaths[0];
}

/** The file in the wallpaper folder, ignoring half-written copies */
function currentFile() {
    try {
        return readdirSync(WALLPAPER_DIR).find(name => wallpaperKind(name) && !name.endsWith(".tmp"));
    } catch {
        return undefined;
    }
}

function clearExcept(keep?: string) {
    let names: string[] = [];
    try {
        names = readdirSync(WALLPAPER_DIR);
    } catch { }
    for (const name of names) if (name !== keep) rmSync(join(WALLPAPER_DIR, name), { force: true, recursive: true });
}

function copyIn(source: string): WallpaperPickResult {
    const kind = wallpaperKind(source);
    if (!kind) return { ok: false, error: `Choose a ${WALLPAPER_EXTENSIONS.join(", ")} file` };
    // Checked before copying: a wrong pick could be a multi-GB file
    const max = MAX_WALLPAPER_BYTES[kind];
    if (statSync(source).size > max) return { ok: false, error: `That ${kind} is larger than ${max / 1024 / 1024} MB` };

    mkdirSync(WALLPAPER_DIR, { recursive: true });
    // A new name each time, so the page can tell a new wallpaper from the old one
    const file = `wallpaper-${Date.now()}.${extensionOf(source)}`;
    const target = join(WALLPAPER_DIR, file);
    copyFileSync(source, target + ".tmp");
    renameSync(target + ".tmp", target);
    clearExcept(file);
    return { ok: true, file, kind };
}

export function initWallpaper() {
    ipcMain.handle(IPC.WALLPAPER_PICK, async (e): Promise<WallpaperPickResult> => {
        try {
            const path = await pickPath(e);
            if (!path) return { ok: false, canceled: true };
            return copyIn(path);
        } catch (err) {
            return { ok: false, error: `Couldn't copy that file: ${errorOf(err)}` };
        }
    });

    // Never a path from the page: only ever the one file main copied in
    ipcMain.handle(IPC.WALLPAPER_READ, async (): Promise<WallpaperReadResult> => {
        const file = currentFile();
        if (!file) return { ok: false, error: "There's no wallpaper file, choose one again" };
        try {
            // Up to MAX_WALLPAPER_BYTES: read off the main thread, which Discord's own work and every request wait on.
            // A Buffer arrives in the page as a Uint8Array
            return { ok: true, file, mime: wallpaperMime(file)!, bytes: await readFile(join(WALLPAPER_DIR, file)) };
        } catch (err) {
            return { ok: false, error: `Couldn't read the wallpaper: ${errorOf(err)}` };
        }
    });

    ipcMain.handle(IPC.WALLPAPER_REMOVE, () => clearExcept());

    // powerMonitor can only be used once the app is ready; the page asks long after that
    ipcMain.handle(IPC.POWER_ON_BATTERY, () => powerMonitor.isOnBatteryPower());
    app.whenReady().then(() => {
        powerMonitor.on("on-battery", () => broadcast(IPC.POWER_CHANGED, true));
        powerMonitor.on("on-ac", () => broadcast(IPC.POWER_CHANGED, false));
    });
}
