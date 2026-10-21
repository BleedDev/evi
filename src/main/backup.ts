import { backupFileName, BackupSource, buildBackup, EviBackup, ImportMode, MAX_BACKUP_BYTES, parseBackup, planImport } from "@shared/backup";
import { BackupApplyResult, BackupExportResult, BackupOpenResult, EviSettings, IPC } from "@shared/ipc";
import { diffSettings } from "@shared/safeMode";
import { randomUUID } from "crypto";
import { app, BrowserWindow, dialog, ipcMain, IpcMainInvokeEvent, WebContents } from "electron";
import { existsSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "fs";
import { basename, join } from "path";
import { isDeepStrictEqual } from "util";

import { mt } from "./locale";
import { QUICK_CSS_FILE, THEMES_DIR } from "./paths";
import { askToEnable, enablesNeedingConsent, getPluginPayloads } from "./plugins";
import { SafeMode } from "./safeMode";
import { saveSettings, settings } from "./settings";
import { getThemePayloads, reloadTheme } from "./themes";
import { broadcast, errorOf } from "./util";

/**
 * Tests can't click through native dialogs: with this set, both dialogs answer with this path.
 * Only scripts/test-electron.ts sets it.
 */
const TEST_PATH = process.env.EVI_TEST_BACKUP_PATH;

/** The last validated backup, applied by token so the renderer never sends file contents back */
let pending: { token: string; backup: EviBackup; } | undefined;

function currentState(): BackupSource {
    let quickCss = "";
    try {
        quickCss = readFileSync(QUICK_CSS_FILE, "utf8");
    } catch { }
    return { settings, quickCss, themes: getThemePayloads(), plugins: getPluginPayloads() };
}

async function pickSavePath(e: IpcMainInvokeEvent) {
    if (TEST_PATH) return TEST_PATH;
    const win = BrowserWindow.fromWebContents(e.sender);
    const options: Electron.SaveDialogOptions = {
        title: mt("main.backup.saveTitle"),
        defaultPath: join(app.getPath("documents"), backupFileName()),
        filters: [{ name: mt("main.backup.filterName"), extensions: ["json"] }],
    };
    const { canceled, filePath } = await (win ? dialog.showSaveDialog(win, options) : dialog.showSaveDialog(options));
    return canceled ? undefined : filePath;
}

async function pickOpenPath(e: IpcMainInvokeEvent) {
    if (TEST_PATH) return TEST_PATH;
    const win = BrowserWindow.fromWebContents(e.sender);
    const options: Electron.OpenDialogOptions = {
        title: mt("main.backup.restoreTitle"),
        properties: ["openFile"],
        filters: [{ name: mt("main.backup.filterName"), extensions: ["json"] }, { name: mt("main.backup.filterAll"), extensions: ["*"] }],
    };
    const { canceled, filePaths } = await (win ? dialog.showOpenDialog(win, options) : dialog.showOpenDialog(options));
    return canceled ? undefined : filePaths[0];
}

export function writeBackup(path: string) {
    const backup = buildBackup(currentState(), EVI_VERSION);
    const tmp = path + ".tmp";
    writeFileSync(tmp, JSON.stringify(backup, null, 4));
    renameSync(tmp, path);
}

export function readBackup(path: string) {
    // Check the size before reading, a wrong pick could be a multi-GB file
    if (statSync(path).size > MAX_BACKUP_BYTES) return { ok: false as const, error: mt("main.backup.tooLarge", { mb: MAX_BACKUP_BYTES / 1024 / 1024 }) };
    const bytes = readFileSync(path);
    let text: string;
    try {
        text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
        return { ok: false as const, error: mt("main.backup.notText") };
    }
    return parseBackup(text, mt);
}

/**
 * Writes every file of the plan, all or nothing: everything is staged to temp files first, then
 * renamed into place. If a rename fails, files already replaced get their old contents back.
 */
function commitFiles(writes: { path: string; data: string; }[]) {
    const staged: { path: string; tmp: string; previous: string | null; }[] = [];
    try {
        for (const { path, data } of writes) {
            const tmp = path + ".evi-import";
            writeFileSync(tmp, data);
            staged.push({ path, tmp, previous: existsSync(path) ? readFileSync(path, "utf8") : null });
        }
    } catch (err) {
        for (const { tmp } of staged) rmSync(tmp, { force: true });
        throw err;
    }

    const done: typeof staged = [];
    try {
        for (const entry of staged) {
            renameSync(entry.tmp, entry.path);
            done.push(entry);
        }
    } catch (err) {
        for (const { path, previous } of done) {
            try {
                previous === null ? rmSync(path, { force: true }) : writeFileSync(path, previous);
            } catch { }
        }
        for (const { tmp } of staged) rmSync(tmp, { force: true });
        throw err;
    }
    return () => {
        for (const { path, previous } of done) previous === null ? rmSync(path, { force: true }) : writeFileSync(path, previous);
    };
}

/** `base` with plugin `id` switched as `previous` had it */
function keepSwitch(base: EviSettings, previous: EviSettings, id: string, enabled?: boolean): EviSettings {
    const entry = { ...base.plugins[id] };
    const was = enabled ?? previous.plugins[id]?.enabled;
    if (was === undefined) delete entry.enabled;
    else entry.enabled = was;
    return { ...base, plugins: { ...base.plugins, [id]: entry } };
}

/**
 * `restored` with the saves made since the restore began on top. The page has the settings from
 * before it (`before`) until the restore returns, so it saves on top of those: only what a save
 * changed (a version seen, a switch) carries over, not the old values it still holds.
 */
function withSavedSince(restored: EviSettings, before: EviSettings, now: EviSettings): EviSettings {
    const changed = <T extends object>(base: T, from: T, to: T) => {
        const out = { ...base } as Record<string, unknown>;
        for (const key of new Set([...Object.keys(from), ...Object.keys(to)])) {
            const value = (to as Record<string, unknown>)[key];
            if (isDeepStrictEqual((from as Record<string, unknown>)[key], value)) continue;
            if (value === undefined) delete out[key];
            else out[key] = value;
        }
        return out as T;
    };
    // Plugins one by one: a switch flipped meanwhile doesn't bring back every plugin's old entry
    return { ...changed(restored, before, now), plugins: changed(restored.plugins, before.plugins, now.plugins) };
}

/** Saves, and remembers what that turned on or changed for safe mode, as a save from the page does */
function saveAndRecord(next: EviSettings) {
    const changes = diffSettings(settings, next);
    saveSettings(next);
    for (const change of changes) SafeMode.recordChange(change);
}

export async function applyBackup(backup: EviBackup, mode: ImportMode, sender?: WebContents): Promise<BackupApplyResult> {
    const previousSettings = structuredClone(settings);
    const plan = planImport(currentState(), backup, mode);
    // A backup is a file anyone could have made: plugins it turns on that reach beyond the page
    // (native code, Chromium switches) stay as they were until the user says yes, as for any save
    const held = enablesNeedingConsent(previousSettings, plan.settings);
    for (const manifest of held) plan.settings = keepSwitch(plan.settings, previousSettings, manifest.id);

    const writes = plan.themes.map(t => ({ path: join(THEMES_DIR, basename(t.file)), data: t.css }));
    if (plan.quickCss !== null) writes.push({ path: QUICK_CSS_FILE, data: plan.quickCss });

    let rollback: () => void;
    try {
        rollback = commitFiles(writes);
    } catch (err) {
        return { ok: false, error: mt("main.backup.writeFailed", { error: errorOf(err) }) };
    }
    try {
        saveAndRecord(plan.settings);
    } catch (err) {
        try {
            rollback();
            saveSettings(previousSettings);
        } catch { }
        return { ok: false, error: mt("main.backup.settingsFailed", { error: errorOf(err) }) };
    }

    if (held.length) {
        const approved: string[] = [];
        for (const manifest of held) {
            if (await askToEnable(manifest, sender)) approved.push(manifest.id);
        }
        // The questions can stay up for minutes, and saves land meanwhile: keep them and the restore
        let next = withSavedSince(plan.settings, previousSettings, settings);
        for (const id of approved) next = keepSwitch(next, previousSettings, id, true);
        try {
            saveAndRecord(next);
        } catch (err) {
            // Main holds them anyway, and the page saves them again with its next change
            console.error("[Evi] Couldn't save the plugins a restored backup turned on", err);
        }
    }

    // Don't wait for the watchers, the renderer should have everything when this resolves
    for (const { file } of plan.themes) reloadTheme(basename(file));
    if (plan.quickCss !== null) broadcast(IPC.CSS_CHANGED, plan.quickCss);
    console.log(`[Evi] Restored a backup (${mode}), ${plan.preview.changes} changes`);
    return { ok: true, settings, preview: plan.preview };
}

export function initBackup() {
    ipcMain.handle(IPC.BACKUP_EXPORT, async (e): Promise<BackupExportResult> => {
        try {
            const path = await pickSavePath(e);
            if (!path) return { ok: false, canceled: true };
            writeBackup(path);
            console.log(`[Evi] Saved a backup to ${path}`);
            return { ok: true, path };
        } catch (err) {
            return { ok: false, error: mt("main.backup.saveFailed", { error: errorOf(err) }) };
        }
    });

    ipcMain.handle(IPC.BACKUP_OPEN, async (e): Promise<BackupOpenResult> => {
        try {
            const path = await pickOpenPath(e);
            if (!path) return { ok: false, canceled: true };
            const parsed = readBackup(path);
            if (!parsed.ok) return parsed;

            const { backup } = parsed;
            const token = randomUUID();
            pending = { token, backup };
            const state = currentState();
            return {
                ok: true,
                token,
                fileName: basename(path),
                createdAt: backup.createdAt,
                eviVersion: backup.eviVersion,
                previews: {
                    merge: planImport(state, backup, "merge").preview,
                    replace: planImport(state, backup, "replace").preview,
                },
            };
        } catch (err) {
            return { ok: false, error: mt("main.backup.readFailed", { error: errorOf(err) }) };
        }
    });

    ipcMain.handle(IPC.BACKUP_APPLY, (e, token: string, mode: ImportMode): Promise<BackupApplyResult> | BackupApplyResult => {
        if (!pending || pending.token !== token) return { ok: false, error: mt("main.backup.closed") };
        if (mode !== "merge" && mode !== "replace") return { ok: false, error: "Unknown import mode" };
        const { backup } = pending;
        pending = undefined;
        // Planned again against the current state, in case something changed since the preview
        return applyBackup(backup, mode, e.sender);
    });
}
