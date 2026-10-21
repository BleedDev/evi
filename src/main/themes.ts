import { AddThemeResult, IPC, ThemeChange, ThemePayload, ThemeSaveResult } from "@shared/ipc";
import { isEditorTheme, themeSlug } from "@shared/themeEditor";
import { isPlainThemeFileName, isThemeFile, MAX_THEME_BYTES, parseThemeMeta, themeFileName, whyNotCss } from "@shared/themes";
import { ipcMain } from "electron";
import { existsSync, FSWatcher, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, watch, writeFileSync } from "fs";
import { basename, join } from "path";

import { downloadHttps } from "./download";
import { mt } from "./locale";
import { DATA_DIR, THEMES_DIR } from "./paths";
import { SafeMode } from "./safeMode";
import { broadcast, errorOf } from "./util";

const themes = new Map<string, ThemePayload>();

function readTheme(file: string): ThemePayload | null {
    if (!isThemeFile(file)) return null;
    try {
        const css = readFileSync(join(THEMES_DIR, file), "utf8");
        return { ...parseThemeMeta(css, file), css };
    } catch {
        // Gone, or a folder that happens to end in .css
        return null;
    }
}

const announce = (change: ThemeChange) => broadcast(IPC.THEME_CHANGED, change);

export function reloadTheme(file: string) {
    const previous = themes.get(file);
    const next = readTheme(file);
    // Editors touch files on save without changing them, don't restyle Discord for that
    if (previous && next && previous.css === next.css) return;

    if (!next) {
        if (previous) {
            themes.delete(file);
            announce({ type: "remove", file });
        }
        return;
    }
    themes.set(file, next);
    SafeMode.recordChange({ kind: "theme", id: file, action: previous ? "updated" : "installed" });
    announce({ type: "upsert", theme: next });
}

/** Re-reads every theme, including ones that disappeared while the watcher was down */
function rescan() {
    const files = new Set(existsSync(THEMES_DIR) ? readdirSync(THEMES_DIR) : []);
    for (const file of themes.keys()) files.add(file);
    for (const file of files) reloadTheme(file);
}

function watchThemes() {
    const pending = new Map<string, ReturnType<typeof setTimeout>>();

    const start = () => {
        let watcher: FSWatcher;
        try {
            // The folder may have been deleted, recreate it so there's something to watch
            mkdirSync(THEMES_DIR, { recursive: true });
            watcher = watch(THEMES_DIR, (_event, filename) => {
                // No file name means we can't tell what changed, look at everything
                const key = filename ?? "";
                clearTimeout(pending.get(key));
                pending.set(key, setTimeout(() => {
                    pending.delete(key);
                    filename ? reloadTheme(filename) : rescan();
                }, 100));
            });
        } catch {
            return void setTimeout(start, 2000);
        }

        // Same failure mode as the plugin watcher: on Windows the watcher errors for good when the
        // folder is deleted or renamed. Restart it and catch up on whatever changed meanwhile.
        watcher.on("error", err => {
            console.warn("[Evi] Theme watcher failed, restarting it", err);
            watcher.close();
            setTimeout(() => {
                rescan();
                start();
            }, 500);
        });
    };

    start();
}

/** Uses a name that's free, unless the same theme is already there (re-adding updates nothing) */
function pickFile(wanted: string, css: string) {
    const base = wanted.replace(/\.css$/i, "");
    for (let i = 1; ; i++) {
        const file = i === 1 ? wanted : `${base}-${i}.css`;
        const path = join(THEMES_DIR, file);
        if (!existsSync(path) || readFileSync(path, "utf8") === css) return file;
    }
}

export async function addThemeFromUrl(input: string): Promise<AddThemeResult> {
    const download = await downloadHttps(input, MAX_THEME_BYTES);
    if (!download.ok) return download;
    const url = new URL(input.trim());
    const { body } = download;

    let css: string;
    try {
        css = new TextDecoder("utf-8", { fatal: true }).decode(body);
    } catch {
        return { ok: false, error: mt("main.backup.notText") };
    }
    const problem = whyNotCss(css, download.contentType, mt);
    if (problem) return { ok: false, error: problem };

    const name = themeFileName(url, parseThemeMeta(css, ""));
    let file: string;
    try {
        file = pickFile(name, css);
        writeFileSync(join(THEMES_DIR, file), css);
    } catch (err) {
        return { ok: false, error: errorOf(err) };
    }
    // Don't wait for the watcher, the renderer should have it by the time this resolves
    reloadTheme(file);
    console.log(`[Evi] Added theme ${file} from ${url.href}`);
    return { ok: true, file };
}

/** Theme files the store put there (store.ts keeps the list): the editor saves a copy of those instead */
function storeThemeFiles() {
    try {
        const record = JSON.parse(readFileSync(join(DATA_DIR, "store-themes.json"), "utf8"));
        return new Set(Object.values(record ?? {}).map(t => (t as { file?: unknown; })?.file));
    } catch {
        return new Set();
    }
}

/**
 * A theme from the editor. Replacing one is only for files the editor wrote itself and the store
 * doesn't manage, so the editor can't overwrite a theme it merely started from; anything else gets
 * a new file named after the theme.
 */
export function saveTheme(input: unknown): ThemeSaveResult {
    const { css, name, file } = (input ?? {}) as Record<string, unknown>;
    if (typeof css !== "string" || typeof name !== "string") return { ok: false, error: mt("themeEditor.nothingToSave") };
    if (new TextEncoder().encode(css).length > MAX_THEME_BYTES) return { ok: false, error: mt("main.theme.tooLarge") };
    const problem = whyNotCss(css, "text/css", mt);
    if (problem) return { ok: false, error: problem };

    let target: string | undefined;
    if (file !== undefined) {
        if (typeof file !== "string" || basename(file) !== file || !isThemeFile(file) || file.startsWith(".")) return { ok: false, error: "That isn't a theme file name" };
        let current: string | undefined;
        try {
            current = readFileSync(join(THEMES_DIR, file), "utf8");
        } catch { }
        // Gone meanwhile, or not the editor's to replace: a new file instead
        if (current !== undefined && isEditorTheme(current) && !storeThemeFiles().has(file)) target = file;
    }
    target ??= pickFile(`${themeSlug(name)}.css`, css);

    mkdirSync(THEMES_DIR, { recursive: true });
    // Write then rename, so the theme watcher never reads half a file
    const tmp = join(THEMES_DIR, `.${target}.evi-tmp`);
    writeFileSync(tmp, css);
    renameSync(tmp, join(THEMES_DIR, target));
    reloadTheme(target);
    return { ok: true, file: target };
}

/** Deletes one theme file from the themes folder; store themes go through the store's uninstall */
export function deleteTheme(file: unknown): { ok: true; } | { ok: false; error: string; } {
    if (!isPlainThemeFileName(file)) return { ok: false, error: "That isn't a theme file name" };
    const path = join(THEMES_DIR, file);
    try {
        if (!statSync(path).isFile()) return { ok: false, error: "That isn't a theme file" };
    } catch {
        return { ok: false, error: "That theme is already gone" };
    }
    if (storeThemeFiles().has(file)) return { ok: false, error: "That theme belongs to the store, uninstall it there" };
    try {
        rmSync(path);
    } catch (err) {
        return { ok: false, error: errorOf(err) };
    }
    // Don't wait for the watcher: broadcasts the removal like it would
    reloadTheme(file);
    console.log(`[Evi] Deleted theme ${file}`);
    return { ok: true };
}

export function getThemePayloads() {
    return [...themes.values()];
}

export function initThemes() {
    for (const file of readdirSync(THEMES_DIR)) {
        const theme = readTheme(file);
        if (theme) themes.set(file, theme);
    }
    watchThemes();

    ipcMain.handle(IPC.THEME_ADD_URL, (_, url: string) => addThemeFromUrl(String(url)));
    ipcMain.handle(IPC.THEME_DELETE, (_, file: unknown) => deleteTheme(file));
    ipcMain.handle(IPC.THEME_SAVE, (_, input: unknown) => saveTheme(input));
}
