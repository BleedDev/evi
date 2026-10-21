import { IdleReport, isChannelPath, MemoryUsage, memoryUsage, relaunchArgs, RESTORE_WITHIN_MS, shouldBackground, shouldRestart, shouldTrim } from "@shared/idle";
import { IPC } from "@shared/ipc";
import { app, BrowserWindow, ipcMain, powerMonitor, WebContents } from "electron";
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";

import { DATA_DIR } from "./paths";
import { SafeMode } from "./safeMode";
import { settings } from "./settings";
import { applyBeforeRestart } from "./updater";

const STATE_FILE = join(DATA_DIR, "idle.json");
const CHECK_EVERY_MS = 60_000;

interface IdleFile {
    lastRestart?: number;
    restorePath?: string;
}

/** Discord's main window and its page: whichever page reports, popouts and the overlay don't */
let page: WebContents | undefined;
let win: BrowserWindow | undefined;
let report: IdleReport = { busy: null, path: "" };
let hiddenSince: number | undefined;
let trimmed = false;
let timer: ReturnType<typeof setInterval> | undefined;

/**
 * Lower memory, from main. On Windows Discord starts Chromium with this switch, which keeps its
 * renderers at foreground priority even while hidden, so Chromium never frees a hidden page's memory
 * (Blink's background purge, V8's memory saving mode) and the page competes with games for CPU.
 * While the window is hidden, the page isn't in a call, stream or ringing call and plays no sound,
 * and the in-game overlay isn't up, Evi takes the switch off; any of those puts it back first.
 * macOS and Linux don't have the switch, so nothing happens there.
 */
const KEEP_FOREGROUND = "disable-renderer-backgrounding";
/** foreground: the switch is on. pending: it's off and the page's priority is being recomputed. background: recomputed without it */
let backgrounding: "foreground" | "pending" | "background" = "foreground";
/** A recompute didn't work on this Discord: not tried again until it restarts */
let pokeBroken = false;
/** Discord's own setBackgroundThrottling for its page, which it turns off while the in-game overlay is up */
let discordThrottling = true;
/** Evi turned throttling off to bring the hidden page back to foreground priority, when a recompute failed */
let forcedVisible = false;
/** When the hidden page last had to come back to the foreground: it waits the whole time again */
let heldAt: number | undefined;
let setThrottling: ((allowed: boolean) => void) | undefined;

/** Evi's one way to restart Discord. app.exit skips will-quit, where a silent update installs: it goes in here */
export function relaunch(args?: string[]) {
    applyBeforeRestart();
    app.relaunch(args ? { args } : undefined);
    app.exit(0);
}

function readState(): IdleFile {
    try {
        const parsed = JSON.parse(readFileSync(STATE_FILE, "utf8"));
        return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
        return {};
    }
}

function writeState(state: IdleFile) {
    try {
        writeFileSync(STATE_FILE, JSON.stringify(state));
    } catch (err) {
        console.error("[Evi] Couldn't save idle state", err);
    }
}

const isHidden = (w: BrowserWindow) => !w.isVisible() || w.isMinimized();

function watchWindow(w: BrowserWindow) {
    if (win === w) return;
    win = w;
    const update = () => {
        if (w.isDestroyed()) return;
        if (isHidden(w)) {
            hiddenSince ??= Date.now();
        } else {
            hiddenSince = undefined;
            trimmed = false;
            // Being shown recomputes the page's priority by itself
            keepForeground();
            unforce();
        }
    };
    w.on("hide", update);
    w.on("minimize", update);
    w.on("show", update);
    w.on("restore", update);
    update();
}

function watchPage(wc: WebContents) {
    if (page === wc) return;
    page = wc;
    keepForeground();
    forcedVisible = false;
    discordThrottling = wc.getBackgroundThrottling();
    const original = wc.setBackgroundThrottling.bind(wc);
    setThrottling = original;
    wc.setBackgroundThrottling = (allowed: boolean) => {
        if (page !== wc) return original(allowed);
        discordThrottling = allowed;
        // Evi's forced state keeps the page in the foreground too; Discord's applies once the window is shown
        if (!forcedVisible) original(allowed);
        if (!allowed) void holdForeground();
    };
    wc.on("audio-state-changed", e => {
        if (e.audible && page === wc) void holdForeground();
    });
    // Its next renderer starts with the switch on
    wc.on("render-process-gone", () => {
        if (page !== wc) return;
        keepForeground();
        unforce();
    });
}

const lowerMemory = () => settings.lowerMemory === true && !SafeMode.active;

/**
 * Chromium reads KEEP_FOREGROUND only when it recomputes a renderer's priority, as its page is shown
 * or hidden. Copying one pixel of the hidden page with stayHidden shows it to the copy and hides it
 * again, which recomputes, and the window stays hidden. (Electron 42's setBackgroundThrottling
 * recomputes too, but leaves a hidden page painting.) false: nothing was copied, so no recompute is
 * known to have happened.
 */
async function poke(wc: WebContents) {
    try {
        const image = await wc.capturePage({ x: 0, y: 0, width: 1, height: 1 }, { stayHidden: true });
        return !image.isEmpty();
    } catch {
        return false;
    }
}

async function allowBackground(wc: WebContents) {
    if (backgrounding !== "foreground" || pokeBroken || !app.commandLine.hasSwitch(KEEP_FOREGROUND)) return;
    app.commandLine.removeSwitch(KEEP_FOREGROUND);
    backgrounding = "pending";
    const ok = await poke(wc);
    // Put back meanwhile
    if (backgrounding !== "pending") return;
    if (ok) {
        backgrounding = "background";
        return console.log("[Evi] Lower memory: Discord's hidden page may go to the background");
    }
    console.warn("[Evi] Lower memory: couldn't update the page's priority, not trying again until Discord restarts");
    pokeBroken = true;
    keepForeground();
    // In case the copy failed after its recompute
    if (!wc.isDestroyed()) void poke(wc);
}

/** Puts KEEP_FOREGROUND back. Returns how things were */
function keepForeground() {
    const was = backgrounding;
    if (was === "foreground") return was;
    app.commandLine.appendSwitch(KEEP_FOREGROUND);
    backgrounding = "foreground";
    return was;
}

/** Brings the hidden page back to foreground priority now: a call, sound, the overlay, Lower memory turned off */
async function holdForeground() {
    if (keepForeground() === "foreground") return;
    heldAt = Date.now();
    // Discord turning throttling off shows the page to Chromium, which recomputes by itself
    if (!page || page.isDestroyed() || !win || win.isDestroyed() || !isHidden(win) || !discordThrottling) return;
    if (await poke(page) || page.isDestroyed() || backgrounding !== "foreground" || !isHidden(win)) return;
    // A hidden page that paints until the window is shown beats a call at background priority
    forcedVisible = true;
    setThrottling?.(false);
}

function unforce() {
    if (!forcedVisible) return;
    forcedVisible = false;
    setThrottling?.(discordThrottling);
}

/** After a settings save: Lower memory turned off puts the page back in the foreground right away */
export function updateBackgrounding() {
    if (!lowerMemory()) void holdForeground();
}

function memoryOf(wc: WebContents): MemoryUsage {
    return memoryUsage(app.getAppMetrics(), wc.getOSProcessId());
}

function check() {
    if (!page || page.isDestroyed() || !win || win.isDestroyed()) return;
    const now = Date.now();
    if (shouldTrim({ now, hiddenSince, busy: report.busy, trimmed })) {
        trimmed = true;
        page.send(IPC.MEMORY_TRIM);
    }
    const background = shouldBackground({
        enabled: lowerMemory(),
        now,
        hiddenSince: hiddenSince === undefined ? undefined : Math.max(hiddenSince, heldAt ?? 0),
        busy: report.busy,
        audible: page.isCurrentlyAudible(),
        throttling: discordThrottling,
    });
    if (background) void allowBackground(page);
    // Something changed without an event saying so
    else if (backgrounding !== "foreground") void holdForeground();
    if (!settings.idleRestart) return;

    const state = readState();
    const { renderer } = memoryOf(page);
    const restart = shouldRestart({
        enabled: true,
        now,
        hiddenSince,
        inputIdleMs: powerMonitor.getSystemIdleTime() * 1000,
        busy: report.busy,
        uptimeMs: process.uptime() * 1000,
        lastRestart: state.lastRestart,
        rendererBytes: renderer,
        limitGb: settings.idleRestartGb,
    });
    if (!restart) return;
    console.log(`[Evi] Restarting Discord: its page used ${Math.round(renderer! / 1024 ** 2)} MB while you were away`);
    writeState({ lastRestart: now, restorePath: isChannelPath(report.path) ? report.path : undefined });
    relaunch(relaunchArgs(process.argv.slice(1), isHidden(win)));
}

export function initIdle() {
    ipcMain.on(IPC.IDLE_REPORT, (e, next: IdleReport) => {
        if (!next || typeof next !== "object") return;
        const w = BrowserWindow.fromWebContents(e.sender);
        if (!w) return;
        report = { busy: typeof next.busy === "boolean" ? next.busy : null, path: typeof next.path === "string" ? next.path : "" };
        watchPage(e.sender);
        watchWindow(w);
        // A call, stream or ring, or not knowing: the page's priority comes back right away
        if (report.busy !== false) void holdForeground();
        timer ??= setInterval(check, CHECK_EVERY_MS);
    });

    ipcMain.handle(IPC.MEMORY_USAGE, e => memoryOf(e.sender));

    ipcMain.handle(IPC.IDLE_RESTORE, () => {
        const state = readState();
        if (!state.restorePath) return null;
        writeState({ lastRestart: state.lastRestart });
        const recent = state.lastRestart !== undefined && Date.now() - state.lastRestart < RESTORE_WITHIN_MS;
        return recent && isChannelPath(state.restorePath) ? state.restorePath : null;
    });
}
