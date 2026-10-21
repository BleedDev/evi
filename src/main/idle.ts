import { IdleReport, isChannelPath, MemoryUsage, relaunchArgs, RESTORE_WITHIN_MS, shouldRestart, shouldTrim } from "@shared/idle";
import { IPC } from "@shared/ipc";
import { app, BrowserWindow, ipcMain, powerMonitor, WebContents } from "electron";
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";

import { DATA_DIR } from "./paths";
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
        }
    };
    w.on("hide", update);
    w.on("minimize", update);
    w.on("show", update);
    w.on("restore", update);
    update();
}

function memoryOf(wc: WebContents): MemoryUsage {
    const metrics = app.getAppMetrics();
    const pid = wc.getOSProcessId();
    const kb = (m?: Electron.ProcessMetric) => m ? m.memory.workingSetSize * 1024 : undefined;
    return { renderer: kb(metrics.find(m => m.pid === pid)), gpu: kb(metrics.find(m => m.type === "GPU")) };
}

function check() {
    if (!page || page.isDestroyed() || !win || win.isDestroyed()) return;
    const now = Date.now();
    if (shouldTrim({ now, hiddenSince, busy: report.busy, trimmed })) {
        trimmed = true;
        page.send(IPC.MEMORY_TRIM);
    }
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
        page = e.sender;
        report = { busy: typeof next.busy === "boolean" ? next.busy : null, path: typeof next.path === "string" ? next.path : "" };
        watchWindow(w);
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
