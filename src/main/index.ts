import { BootData, EviSettings, IPC, isPluginEnabled, OpenPathTarget, PluginManifest, SettingsSaveResult } from "@shared/ipc";
import { diffSettings } from "@shared/safeMode";
import { ORIGINAL_ASAR } from "@shared/shim";
import { app, ipcMain, Session, session, shell, WebContents, webContents } from "electron";
import { existsSync, readFileSync, watch, writeFileSync } from "fs";
import { dirname, join } from "path";

import { initAccount } from "./account";
import { initBackup } from "./backup";
import { initBadges } from "./badges";
import { initCommunity } from "./community";
import { initFindCache, readFindCache } from "./findCache";
import { guardIpc } from "./ipcGuard";
import { setLocale } from "./locale";
import { DATA_DIR, PLUGINS_DIR, QUICK_CSS_FILE, THEMES_DIR } from "./paths";
import { persistAcrossUpdates } from "./persist";
import { initIdle, relaunch } from "./idle";
import { applyChromiumSwitches, askToEnable, enablesNeedingConsent, getBootPlugins, initPlugins } from "./plugins";
import { currentHotfixes, currentPulls, initReports } from "./reports";
import { SafeMode } from "./safeMode";
import { saveSettings, settings } from "./settings";
import { initStars } from "./stars";
import { initStore } from "./store";
import { mergeListSwitches } from "./switches";
import { initThemeSubmit } from "./themeSubmit";
import { getThemePayloads, initThemes } from "./themes";
import { initUpdater } from "./updater";
import { broadcast } from "./util";
import { initWallpaper } from "./wallpaper";

// Loaders installed before the rename to Evi still pass the old name
globalThis.__eviCoreDir ??= globalThis.__delightCoreDir!;

declare global {
    // eslint-disable-next-line no-var
    var __eviLoadedDiscord: boolean | undefined;
    /** Folder holding main.js, preload.js and renderer.js. Set by the loader. */
    var __eviCoreDir: string;
    /** Set by loaders installed before the rename to Evi */
    var __delightCoreDir: string | undefined;
}

// Our loader is resources/app.asar, Discord's untouched archive was renamed to resources/_app.asar
const shimAsar = dirname(require.main!.filename);
const asarPath = join(shimAsar, "..", ORIGINAL_ASAR);

const vanilla = process.argv.includes("--vanilla") || !!process.env.EVI_DISABLE;

function readQuickCss() {
    try {
        return readFileSync(QUICK_CSS_FILE, "utf8");
    } catch {
        return "";
    }
}

function registerIpc() {
    ipcMain.on(IPC.GET_RENDERER, e => {
        // Read fresh every time so Ctrl+R picks up a rebuilt renderer without restarting Discord
        e.returnValue = readFileSync(join(globalThis.__eviCoreDir, "renderer.js"), "utf8");
    });

    ipcMain.on(IPC.GET_BOOT, e => {
        const boot: BootData = {
            version: EVI_VERSION,
            dataDir: DATA_DIR,
            settings,
            plugins: getBootPlugins(),
            quickCss: readQuickCss(),
            assistive: app.isAccessibilitySupportEnabled(),
            themes: getThemePayloads(),
            safeMode: SafeMode.info,
            pulled: currentPulls(),
            hotfixes: currentHotfixes(),
            findCache: readFindCache(),
        };
        e.returnValue = boot;
    });

    ipcMain.on(IPC.SET_LOCALE, (_, locale: unknown) => setLocale(locale));

    ipcMain.handle(IPC.SETTINGS_SAVE, (e, next: EviSettings) => saveFromPage(next, e.sender));
    ipcMain.handle(IPC.CSS_SAVE, (_, css: string) => writeFileSync(QUICK_CSS_FILE, css));
    ipcMain.on(IPC.SETTINGS_SAVE_SYNC, (e, next: EviSettings) => {
        // Saved before this returns; any question about turning a plugin on is answered later
        void saveFromPage(next, e.sender);
        e.returnValue = true;
    });
    ipcMain.on(IPC.CSS_SAVE_SYNC, (e, css: string) => {
        writeFileSync(QUICK_CSS_FILE, css);
        e.returnValue = true;
    });

    ipcMain.handle(IPC.OPEN_PATH, (_, target: OpenPathTarget) => {
        if (target === "quickCss" && !existsSync(QUICK_CSS_FILE)) writeFileSync(QUICK_CSS_FILE, "");
        const path = { data: DATA_DIR, plugins: PLUGINS_DIR, themes: THEMES_DIR, quickCss: QUICK_CSS_FILE }[target];
        return shell.openPath(path);
    });

    ipcMain.handle(IPC.RELAUNCH, () => relaunch());

    ipcMain.on(IPC.BOOT_OK, () => SafeMode.bootOk());
    ipcMain.handle(IPC.SAFE_MODE_EXIT, () => SafeMode.exit());
    ipcMain.on(IPC.CRASH_BREADCRUMB, (e, breadcrumb: unknown) => SafeMode.breadcrumb(e.sender, breadcrumb));
    ipcMain.handle(IPC.CRASH_RECORD_GET, () => SafeMode.unseenCrash);
    ipcMain.on(IPC.CRASH_RECORD_SEEN, () => SafeMode.markCrashSeen());
}

/** Remembers what the save turned on or changed, so safe mode can name a suspect */
function saveAndRecord(next: EviSettings) {
    for (const change of diffSettings(settings, next)) SafeMode.recordChange(change);
    saveSettings(next);
}

/** What the page last asked for: a yes that comes later only applies if it still wants the plugin on */
let requested: EviSettings | undefined;

/** `settings` with one plugin's switch set to `enabled` (undefined: back to its default) */
function withEnabled(base: EviSettings, id: string, enabled: boolean | undefined): EviSettings {
    const entry = { ...base.plugins[id] };
    if (enabled === undefined) delete entry.enabled;
    else entry.enabled = enabled;
    return { ...base, plugins: { ...base.plugins, [id]: entry } };
}

/**
 * Saves settings sent by the page, except for turning on plugins that reach beyond it (native code,
 * Chromium switches): those stay as they were until the user says yes in a dialog main shows
 * (plugins.ts). Plugins run in the page and can save settings too; without this one could turn on
 * another plugin's native code and restart Discord. Resolves once every question is answered, with
 * the plugins the user kept off, so Evi's switch can flip back.
 */
async function saveFromPage(next: EviSettings, sender: WebContents): Promise<SettingsSaveResult> {
    if (!next || typeof next !== "object" || !next.plugins || typeof next.plugins !== "object") return { refused: [] };
    requested = next;
    const held: PluginManifest[] = enablesNeedingConsent(settings, next);
    let saved = next;
    for (const manifest of held) saved = withEnabled(saved, manifest.id, settings.plugins[manifest.id]?.enabled);
    saveAndRecord(saved);
    if (!held.length) return { refused: [] };

    const refused: string[] = [];
    await Promise.all(held.map(async manifest => {
        if (!await askToEnable(manifest, sender)) return void refused.push(manifest.id);
        // Other saves may have landed while the question was up: apply the yes to what's saved now
        if (requested && isPluginEnabled(requested, manifest) && !isPluginEnabled(settings, manifest)) {
            saveAndRecord(withEnabled(settings, manifest.id, true));
        }
    }));
    return { refused };
}

function watchQuickCss() {
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Watch the folder rather than the file: editors often save by replacing the file
    watch(DATA_DIR, (_event, filename) => {
        if (filename !== "quick.css") return;
        clearTimeout(timer);
        timer = setTimeout(() => {
            const css = readQuickCss();
            // Our own saves land here too: every edit is recorded, wherever it's made
            SafeMode.recordChange({ kind: "quickCss", id: "quick.css", action: "edited" });
            for (const wc of webContents.getAllWebContents()) wc.send(IPC.CSS_CHANGED, css);
        }, 50);
    });
}

/**
 * Instead of replacing Discord's BrowserWindow to swap its preload, we register an additional
 * session-wide preload. It runs before Discord's own preload in every frame of the session.
 */
const preloadedSessions = new WeakSet<Session>();
function addPreload(s: Session) {
    if (preloadedSessions.has(s)) return;
    preloadedSessions.add(s);

    const filePath = join(globalThis.__eviCoreDir, "preload.js");
    if (typeof s.registerPreloadScript === "function") {
        s.registerPreloadScript({ id: "evi", type: "frame", filePath });
    } else {
        s.setPreloads([...s.getPreloads(), filePath]);
    }
}

/** Discord hides DevTools unless this setting is on. appSettings is assigned during Discord's startup. */
function enableDevTools() {
    let value: any;
    Object.defineProperty(globalThis, "appSettings", {
        configurable: true,
        get: () => value,
        set(v) {
            value = v;
            try {
                v?.set?.("DANGEROUS_ENABLE_DEVTOOLS_ONLY_ENABLE_IF_YOU_KNOW_WHAT_YOURE_DOING", true);
            } catch { }
        },
    });
}

function setup() {
    console.log(`[Evi] v${EVI_VERSION} starting, data at ${DATA_DIR}`);

    // Before any handler is registered: they all get its sender check
    guardIpc();
    registerIpc();
    SafeMode.watchCrashes();
    enableDevTools();
    mergeListSwitches();
    applyChromiumSwitches();
    app.on("session-created", addPreload);
    app.whenReady().then(() => addPreload(session.defaultSession));
    app.whenReady().then(initPlugins);
    app.on("accessibility-support-changed", (_, on) => broadcast(IPC.ASSISTIVE_CHANGED, on));
    initBackup();
    // Themes need nothing from Electron to load, have them ready for the first window's boot
    initThemes();
    initStore();
    initCommunity();
    initStars();
    initReports();
    initAccount();
    initThemeSubmit();
    initBadges();
    initUpdater();
    initWallpaper();
    initIdle();
    initFindCache();
    watchQuickCss();
    persistAcrossUpdates(shimAsar);
}

/**
 * Discord's bundle compiles from Node's cache from the second start on (53 ms to 6 ms here), asar
 * and all. Older loaders don't turn it on themselves; when the loader did, this changes nothing.
 */
function enableCompileCache() {
    try {
        require("module").enableCompileCache(join(DATA_DIR, "cc"));
    } catch { }
}

if (vanilla) {
    console.log("[Evi] Vanilla mode, not loading.");
} else {
    enableCompileCache();
    try {
        // Counts this start, and decides whether it's safe mode (or, after repeated failures, vanilla)
        if (SafeMode.begin() !== "vanilla") setup();
    } catch (err) {
        console.error("[Evi] Setup failed, continuing with Discord only", err);
    }
}

// Hand over to Discord as if it had been launched directly
const discordPkg = require(join(asarPath, "package.json"));
require.main!.filename = join(asarPath, discordPkg.main);
(app as any).setAppPath(asarPath);
globalThis.__eviLoadedDiscord = true;
// Loaders from before the rename check this name
(globalThis as any).__delightLoadedDiscord = true;
require(require.main!.filename);
// Node writes the cache when the process ends normally, which app.exit() and a killed Discord skip
try {
    require("module").flushCompileCache?.();
} catch { }
