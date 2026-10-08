/**
 * Safe mode rules shared by main, renderer and tests. Pure functions, no Electron.
 */
import { CrashRecord, parseCrashRecord } from "./crashDetective";
import { EviSettings, isPluginEnabled, PluginManifest, RecentChange } from "./ipc";

/** Starts in a row that never reached a healthy boot before the next start is in safe mode */
export const CRASH_LOOP_STARTS = 2;
/** Starts in a row that failed even with safe mode (2 normal + 2 safe) before one start is vanilla */
export const VANILLA_STARTS = 4;
/** Renderer crashes within CRASH_WINDOW_MS that switch a running Discord into safe mode */
export const RENDERER_CRASHES = 2;
export const CRASH_WINDOW_MS = 2 * 60_000;
/** How long the page has to stay up after plugins started for the start to count as healthy */
export const STABLE_MS = 5000;
/** Recent changes kept on disk */
export const MAX_CHANGES = 10;

export type StartupMode = "normal" | "safe" | "vanilla";

export interface StartupState {
    /** Starts since the last healthy boot */
    pendingStarts: number;
    /** Sticky safe mode, only cleared when the user leaves it */
    forceSafe?: "crash-loop" | "renderer-crash";
    /** Newest first */
    changes: RecentChange[];
    /** The last time Discord's page crashed or froze, and who Crash Detective blames (shared/crashDetective.ts) */
    crash?: CrashRecord;
}

export const EMPTY_STATE: StartupState = { pendingStarts: 0, changes: [] };

/** safe-mode.json as read from disk. Files from before a field existed, or damaged ones, still load. */
export function parseState(raw: unknown): StartupState {
    const v = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, any> : {};
    // Fields this version doesn't know are kept: a newer Evi may have written them
    const state: StartupState = {
        ...v,
        pendingStarts: Number.isInteger(v.pendingStarts) && v.pendingStarts >= 0 ? v.pendingStarts : 0,
        changes: Array.isArray(v.changes) ? v.changes : [],
    };
    if (v.forceSafe !== "crash-loop" && v.forceSafe !== "renderer-crash") delete state.forceSafe;
    const crash = parseCrashRecord(v.crash);
    if (crash) state.crash = crash;
    else delete state.crash;
    return state;
}

/** What this start should be, given the state left by the previous ones */
/**
 * @param auto whether crashes turn safe mode on (EviSettings.autoSafeMode). Off, only --evi-safe does;
 *   Discord failing to start at all still gets one start without Evi, so it can't lock you out.
 */
export function startupMode(state: StartupState, flag: boolean, auto = true): StartupMode {
    if (state.pendingStarts >= VANILLA_STARTS) return "vanilla";
    if (flag) return "safe";
    if (auto && (state.forceSafe || state.pendingStarts >= CRASH_LOOP_STARTS)) return "safe";
    return "normal";
}

/**
 * Takes back what begin() counted, for a process that quit without opening a window: Discord already
 * running (its icon clicked again, a discord:// link) or a Squirrel event. Those quit before ready and
 * were never a failed start; counting them sent a healthy Discord into vanilla after a few clicks.
 * @param current safe-mode.json as it is now: the running Discord may have written since
 * @param before what begin() found
 */
export function undoStart(current: StartupState, before: Pick<StartupState, "pendingStarts" | "forceSafe">): StartupState {
    const state: StartupState = { ...current, pendingStarts: Math.min(current.pendingStarts, before.pendingStarts) };
    if (before.forceSafe) state.forceSafe = before.forceSafe;
    else delete state.forceSafe;
    return state;
}

/** Adds a change, newest first. Repeats of the newest (typing in Quick CSS) only bump its time. */
export function addChange(changes: RecentChange[], change: RecentChange): RecentChange[] {
    const [newest, ...rest] = changes;
    if (newest && newest.kind === change.kind && newest.id === change.id && newest.action === change.action) {
        return [change, ...rest];
    }
    return [change, ...changes].slice(0, MAX_CHANGES);
}

/** What a settings save turned on or changed. Turning things off can't break anything, so it isn't recorded. */
export function diffSettings(prev: EviSettings, next: EviSettings): Omit<RecentChange, "at">[] {
    const out: Omit<RecentChange, "at">[] = [];
    for (const [id, entry] of Object.entries(next.plugins ?? {})) {
        const before = prev.plugins?.[id];
        if (entry?.enabled === true && before?.enabled !== true) out.push({ kind: "plugin", id, action: "enabled" });
        else if (JSON.stringify(entry?.settings ?? {}) !== JSON.stringify(before?.settings ?? {})) out.push({ kind: "plugin", id, action: "settings" });
    }
    for (const file of next.enabledThemes ?? []) {
        if (!prev.enabledThemes?.includes(file)) out.push({ kind: "theme", id: file, action: "enabled" });
    }
    if (next.quickCss && !prev.quickCss) out.push({ kind: "quickCss", id: "quick.css", action: "enabled" });
    return out;
}

/** Whether a change is about something that's still on, so it could be what breaks Discord */
export function isStillActive(change: RecentChange, settings: EviSettings, manifests: PluginManifest[]) {
    if (change.kind === "plugin") {
        const manifest = manifests.find(m => m.id === change.id);
        return !!manifest && isPluginEnabled(settings, manifest);
    }
    if (change.kind === "theme") return settings.enabledThemes.includes(change.id);
    return settings.quickCss;
}

/** The newest change that's still on: the most likely reason Discord broke */
export function pickSuspect(changes: RecentChange[], settings: EviSettings, manifests: PluginManifest[]) {
    return changes.find(c => isStillActive(c, settings, manifests));
}
