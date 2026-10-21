/**
 * What Evi does while Discord sits unused (main/idle.ts): empties its page's caches once after its
 * window has been hidden a while, and, if you turned it on, restarts it when its page has grown past
 * a limit while you were away. Never during a call: a restart would drop it. With Lower memory on,
 * lets Chromium put the hidden page in the background, never during a call either.
 */

/** What the page tells main. busy: in a call or stream, or a call rings; null: Evi couldn't tell */
export interface IdleReport {
    busy: boolean | null;
    /** Discord's current route, to come back to after a restart */
    path: string;
}

/** Bytes of memory, from app.getAppMetrics; undefined where Electron didn't say */
export interface MemoryUsage {
    renderer?: number;
    gpu?: number;
    /** Discord's other renderers: Activities, popouts, other windows, DevTools */
    others?: number;
    /** Every process, as private bytes where Electron has them (Windows), like Task Manager */
    total?: number;
}

/** The part of Electron's ProcessMetric used here, in KB */
export interface ProcessMemory {
    pid: number;
    type: string;
    memory: { workingSetSize: number; privateBytes?: number; };
}

/** Discord's memory by part, from app.getAppMetrics(); `pid` is its page's renderer */
export function memoryUsage(metrics: readonly ProcessMemory[], pid: number): MemoryUsage {
    const kb = (m?: ProcessMemory) => m ? m.memory.workingSetSize * 1024 : undefined;
    let others = 0;
    let total = 0;
    for (const m of metrics) {
        if (m.type === "Tab" && m.pid !== pid) others += m.memory.workingSetSize * 1024;
        total += (m.memory.privateBytes ?? m.memory.workingSetSize) * 1024;
    }
    return {
        renderer: kb(metrics.find(m => m.pid === pid)),
        gpu: kb(metrics.find(m => m.type === "GPU")),
        others: metrics.length ? others : undefined,
        total: metrics.length ? total : undefined,
    };
}

export const TRIM_HIDDEN_MS = 10 * 60_000;
export const RESTART_AWAY_MS = 30 * 60_000;
export const RESTART_MIN_UPTIME_MS = 60 * 60_000;
export const RESTART_EVERY_MS = 24 * 60 * 60_000;
/** How long after a restart its channel is still worth reopening */
export const RESTORE_WITHIN_MS = 10 * 60_000;
export const RESTART_GB_OPTIONS = [2, 3, 4, 6, 8] as const;
export const DEFAULT_RESTART_GB = 4;

export function restartLimitGb(setting: unknown): number {
    return RESTART_GB_OPTIONS.includes(setting as never) ? setting as number : DEFAULT_RESTART_GB;
}

/** Once per hidden stretch, after TRIM_HIDDEN_MS of it, and only when the page said it's not busy */
export function shouldTrim(s: { now: number; hiddenSince?: number; busy: boolean | null; trimmed: boolean; }) {
    return s.hiddenSince !== undefined && !s.trimmed && s.busy === false && s.now - s.hiddenSince >= TRIM_HIDDEN_MS;
}

export interface RestartCheck {
    enabled: boolean;
    now: number;
    hiddenSince?: number;
    /** Since the last keyboard or mouse input anywhere on the computer */
    inputIdleMs: number;
    busy: boolean | null;
    uptimeMs: number;
    lastRestart?: number;
    rendererBytes?: number;
    limitGb?: unknown;
}

export function shouldRestart(c: RestartCheck) {
    if (!c.enabled || c.busy !== false || c.rendererBytes === undefined) return false;
    const away = (c.hiddenSince !== undefined && c.now - c.hiddenSince >= RESTART_AWAY_MS) || c.inputIdleMs >= RESTART_AWAY_MS;
    if (!away || c.uptimeMs < RESTART_MIN_UPTIME_MS) return false;
    // A clock set back counts as recent too
    if (c.lastRestart !== undefined && c.now - c.lastRestart < RESTART_EVERY_MS) return false;
    return c.rendererBytes >= restartLimitGb(c.limitGb) * 1024 ** 3;
}

/** Lower memory: how long Discord's window stays hidden before its page may go to the background */
export const BACKGROUND_HIDDEN_MS = 5 * 60_000;

export interface BackgroundCheck {
    /** Lower memory is on, outside safe mode */
    enabled: boolean;
    now: number;
    /** Since the window was hidden, or since the page last had to come back to the foreground while it was */
    hiddenSince?: number;
    busy: boolean | null;
    /** The page plays sound: a ring, a video, music */
    audible: boolean;
    /** Discord's own background throttling for the page, which it turns off while the in-game overlay is up */
    throttling: boolean;
}

/**
 * Whether Chromium may treat Discord's hidden page as in the background, where it frees memory and
 * gets less CPU. Only when the page said it's not in a call, stream or ringing call.
 */
export function shouldBackground(c: BackgroundCheck) {
    return c.enabled && c.busy === false && !c.audible && c.throttling
        && c.hiddenSince !== undefined && c.now - c.hiddenSince >= BACKGROUND_HIDDEN_MS;
}

/** A channel, or a DM: the only places worth reopening */
export function isChannelPath(path: unknown): path is string {
    return typeof path === "string" && /^\/channels\/(@me|\d+)(\/\d+){0,2}$/.test(path);
}

/**
 * Discord's own flags for how its window opens (its autostart uses them): a hidden Discord comes
 * back hidden, a shown one comes back without taking focus from whatever you're doing.
 */
export function relaunchArgs(argv: readonly string[], hidden: boolean) {
    const rest = argv.filter(a => a !== "--start-minimized" && a !== "--start-inactive");
    return [...rest, hidden ? "--start-minimized" : "--start-inactive"];
}

/** Discord's stores, any of which may be missing; see isBusy */
export interface CallStores {
    selectedChannel?: any;
    rtcConnection?: any;
    call?: any;
    streaming?: any;
}

/** In a voice channel or call, streaming or watching one, or a call ringing. null: can't tell. */
export function isBusy({ selectedChannel, rtcConnection, call, streaming }: CallStores): boolean | null {
    try {
        if (typeof selectedChannel?.getVoiceChannelId !== "function" || typeof rtcConnection?.getChannelId !== "function" || typeof call?.getCalls !== "function") return null;
        if (selectedChannel.getVoiceChannelId() || rtcConnection.getChannelId() || rtcConnection.isConnected?.()) return true;
        const calls = call.getCalls();
        if (!Array.isArray(calls)) return null;
        if (calls.some(c => Array.isArray(c?.ringing) && c.ringing.length > 0)) return true;
        const streams = streaming?.getAllActiveStreams?.();
        if (Array.isArray(streams) && streams.length > 0) return true;
        return !!streaming?.getCurrentUserActiveStream?.();
    } catch {
        return null;
    }
}
