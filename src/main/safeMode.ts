/**
 * Safe mode: a plugin, theme or Quick CSS that breaks Discord must never lock the user out.
 *
 * Every start bumps a counter in safe-mode.json, and the renderer resets it once plugins have started
 * and the page stayed up for a few seconds (IPC.BOOT_OK). A start that crashes, hangs, or gets closed
 * before that leaves the counter up. After CRASH_LOOP_STARTS of those in a row, the next start is in
 * safe mode: the core loads, but no plugins (renderer or native), themes, Quick CSS or plugin
 * Chromium switches. If Discord keeps failing even then, one start goes fully vanilla.
 *
 * Crashes while Discord runs are caught too: RENDERER_CRASHES renderer crashes within CRASH_WINDOW_MS
 * switch the running process into safe mode, and the reloaded window boots without plugins.
 *
 * Safe mode caused by crashes is sticky across restarts until the user leaves it from the notice.
 * `--evi-safe` is for one start only.
 */
import { isOverlayUrl } from "@shared/appHosts";
import { Breadcrumb, CrashRecord, parseBreadcrumb, pickCrashSuspect } from "@shared/crashDetective";
import { RecentChange, SafeModeInfo, SafeModeReason } from "@shared/ipc";
import { addChange, CRASH_LOOP_STARTS, CRASH_WINDOW_MS, EMPTY_STATE, parseState, RENDERER_CRASHES, StartupMode, startupMode, StartupState, undoStart } from "@shared/safeMode";
import { app, WebContents } from "electron";
import { readFileSync, renameSync, writeFileSync } from "fs";
import { join } from "path";

import { DATA_DIR } from "./paths";
import { settings } from "./settings";

/** Whether crashes may turn safe mode on (General, Updates). Read when it matters, so a change counts at once */
const autoSafe = () => settings.autoSafeMode !== false;

export const SAFE_FLAG = "--evi-safe";
const STATE_FILE = join(DATA_DIR, "safe-mode.json");

function load(): StartupState {
    try {
        return parseState(JSON.parse(readFileSync(STATE_FILE, "utf8")));
    } catch {
        return structuredClone(EMPTY_STATE);
    }
}

/** The latest breadcrumb from each Discord page, see shared/crashDetective.ts. Memory only. */
const breadcrumbs = new WeakMap<WebContents, Breadcrumb>();
const watchedPages = new WeakSet<WebContents>();

/** Writes down that the page died or froze, and who was busiest right before */
function recordCrash(wc: WebContents, reason: string) {
    const at = Date.now();
    // Nothing of the plugins ran in safe mode, whatever an old breadcrumb says
    const breadcrumb = info ? undefined : breadcrumbs.get(wc);
    const record: CrashRecord = { at, reason, suspect: pickCrashSuspect(breadcrumb, at), breadcrumb };
    state.crash = record;
    save();
    if (record.suspect) console.warn(`[Evi] Crash Detective: ${record.suspect.plugin} was ${record.suspect.why} (${record.suspect.site.kind} ${record.suspect.site.name})`);
    return record;
}

let state = load();
let info: Omit<SafeModeInfo, "changes"> | undefined;
const enterListeners = new Set<() => void>();

function save() {
    try {
        // Write then rename: this file is written right before crashes, a torn write must not happen
        const tmp = STATE_FILE + ".tmp";
        writeFileSync(tmp, JSON.stringify(state, null, 4));
        renameSync(tmp, STATE_FILE);
    } catch (err) {
        console.error("[Evi] Couldn't save safe mode state", err);
    }
}

/** Discord's own window. Not the in-game overlay: games close that one, and it isn't Discord crashing */
function isDiscordApp(wc: WebContents) {
    try {
        const url = wc.getURL();
        return /(^|\.)discord\.com$/.test(new URL(url).hostname) && !isOverlayUrl(url);
    } catch {
        return false;
    }
}

function enter(reason: SafeModeReason, failures: number) {
    info = { reason, failures };
    if (reason !== "flag") state.forceSafe = reason;
    console.warn(`[Evi] Safe mode (${reason}): plugins, themes and Quick CSS are off`);
    for (const listener of enterListeners) listener();
}

export const SafeMode = {
    get active() {
        return !!info;
    },

    /** For the renderer's boot data */
    get info(): SafeModeInfo | undefined {
        return info && { ...info, changes: state.changes, crash: state.crash?.seen ? undefined : state.crash };
    },

    /** Decides what this start is and counts it. Runs first thing in main. */
    begin(): StartupMode {
        const flag = process.argv.includes(SAFE_FLAG);
        const failures = state.pendingStarts;
        const mode = startupMode(state, flag, autoSafe());

        // Every real start opens Discord's splash first. A process that quits without a window never started
        const before = { pendingStarts: failures, forceSafe: state.forceSafe };
        let opened = false;
        app.once("browser-window-created", () => void (opened = true));
        app.once("will-quit", () => {
            if (opened) return;
            state = undoStart(load(), before);
            save();
        });
        // Turned off: what crashes left behind doesn't keep safe mode on either
        if (!autoSafe() && state.forceSafe) delete state.forceSafe;

        if (mode === "vanilla") {
            console.warn(`[Evi] Discord failed to start ${failures} times in a row, even in safe mode. Starting it without Evi once.`);
            // Next start is safe mode again, with two more tries before the next vanilla one
            state.pendingStarts = CRASH_LOOP_STARTS;
            state.forceSafe ??= "crash-loop";
            save();
            return mode;
        }

        if (mode === "safe") {
            const crashed = state.forceSafe ?? (failures >= CRASH_LOOP_STARTS ? "crash-loop" : undefined);
            enter(crashed ?? "flag", failures);
        }
        state.pendingStarts++;
        save();
        return mode;
    },

    /** The renderer booted and stayed up: this start was healthy */
    bootOk() {
        if (state.pendingStarts === 0) return;
        state.pendingStarts = 0;
        save();
        console.log("[Evi] Healthy start, crash counter reset");
    },

    /** Forget the crash history and restart normally. The --evi-safe flag isn't passed on. */
    exit() {
        state.pendingStarts = 0;
        delete state.forceSafe;
        // The safe mode notice already told them about it
        if (state.crash) state.crash.seen = true;
        save();
        app.relaunch({ args: process.argv.slice(1).filter(a => a !== SAFE_FLAG) });
        app.exit(0);
    },

    recordChange(change: Omit<RecentChange, "at">) {
        state.changes = addChange(state.changes, { ...change, at: Date.now() });
        save();
    },

    /** Runs when a running Discord switches into safe mode */
    onEnter(listener: () => void) {
        enterListeners.add(listener);
    },

    /** The renderer's latest breadcrumb (IPC.CRASH_BREADCRUMB) */
    breadcrumb(wc: WebContents, raw: unknown) {
        if (info || !isDiscordApp(wc)) return;
        const breadcrumb = parseBreadcrumb(raw);
        if (!breadcrumb) return;
        breadcrumbs.set(wc, breadcrumb);
        if (watchedPages.has(wc)) return;
        watchedPages.add(wc);
        // A reload starts a new page: what the old one was doing says nothing about it
        wc.on("did-navigate", () => void breadcrumbs.delete(wc));
    },

    /** The last crash, if the user hasn't seen it yet */
    get unseenCrash(): CrashRecord | undefined {
        return state.crash?.seen ? undefined : state.crash;
    },

    markCrashSeen() {
        if (!state.crash || state.crash.seen) return;
        state.crash.seen = true;
        save();
    },

    watchCrashes() {
        // A freeze: Chromium's hang monitor gave up waiting for the page. If it recovers on its own,
        // there's nothing to offer after the next reload.
        app.on("browser-window-created", (_, win) => {
            let frozeAt: number | undefined;
            win.on("unresponsive", () => {
                if (win.isDestroyed() || !isDiscordApp(win.webContents)) return;
                console.error("[Evi] Discord's window stopped responding");
                frozeAt = recordCrash(win.webContents, "unresponsive").at;
            });
            win.on("responsive", () => {
                if (frozeAt !== undefined && state.crash?.at === frozeAt && !state.crash.seen) {
                    delete state.crash;
                    save();
                }
                frozeAt = undefined;
            });
        });

        let crashes: number[] = [];
        app.on("render-process-gone", (_, wc, details) => {
            if (details.reason === "clean-exit" || !isDiscordApp(wc)) return;

            // Before safe mode may switch on below: the record is about the plugins that were running
            recordCrash(wc, details.reason);
            breadcrumbs.delete(wc);

            const now = Date.now();
            crashes = [...crashes.filter(t => now - t < CRASH_WINDOW_MS), now];
            console.error(`[Evi] Discord's window crashed (${details.reason}), ${crashes.length} time(s) within ${CRASH_WINDOW_MS / 1000}s`);
            if (crashes.length >= RENDERER_CRASHES && !info && autoSafe()) {
                enter("renderer-crash", crashes.length);
                save();
            }

            // Discord may reload or relaunch on its own. If the window is still dead after that, reload it:
            // after enough crashes, the reloaded page boots in safe mode.
            setTimeout(() => {
                if (!wc.isDestroyed() && wc.isCrashed()) wc.reload();
            }, 1500);
        });
    },
};
