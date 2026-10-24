/**
 * Upload speed, time left and sizes, pure so tests/uploadTools.test.ts can check them. No Discord or
 * DOM access here.
 */

/** How far back the speed looks: long enough to smooth out bursts, short enough to follow a change */
export const WINDOW_MS = 3000;
/** The speed shown changes at most this often, so it can be read while it updates */
export const SHOW_EVERY_MS = 1000;
/** Too little to go on below this: no speed or time left yet */
const MIN_SPAN_MS = 500;

export interface Speed {
    /** Bytes a second */
    rate: number;
    /** Seconds until done at that rate, undefined while it can't be guessed */
    secondsLeft?: number;
}

/**
 * Upload speed from how many bytes are done over time: bytes over the last WINDOW_MS, held for
 * SHOW_EVERY_MS between changes. `sample` gives undefined until there's enough to go on.
 */
export class SpeedMeter {
    private samples: { at: number; loaded: number; }[] = [];
    private shown?: Speed;
    private shownAt = -Infinity;

    sample(loaded: number, total: number, now: number): Speed | undefined {
        const last = this.samples[this.samples.length - 1];
        // Fewer bytes than before: an upload was cancelled or restarted, start over
        if (last && loaded < last.loaded) this.reset();
        if (!last || now > last.at || loaded !== last.loaded) this.samples.push({ at: now, loaded });
        while (this.samples.length > 2 && now - this.samples[1].at >= WINDOW_MS) this.samples.shift();
        if (this.shown && now - this.shownAt < SHOW_EVERY_MS) return this.shown;
        const first = this.samples[0];
        const span = now - first.at;
        if (span < MIN_SPAN_MS) return this.shown;
        const rate = Math.max(0, (loaded - first.loaded) / (span / 1000));
        this.shown = { rate, secondsLeft: secondsLeft(total - loaded, rate) };
        this.shownAt = now;
        return this.shown;
    }

    reset() {
        this.samples = [];
        this.shown = undefined;
        this.shownAt = -Infinity;
    }
}

export function secondsLeft(remaining: number, rate: number): number | undefined {
    if (!(rate > 0) || !Number.isFinite(remaining)) return undefined;
    return Math.max(0, remaining) / rate;
}

export type TimeUnit = "seconds" | "minutes" | "hours";

/**
 * Time left in the unit people say it in: whole seconds under a minute (in fives past ten, so it
 * doesn't flicker), minutes under an hour, then hours.
 */
export function timeLeft(seconds: number): { unit: TimeUnit; count: number; } {
    if (seconds < 10) return { unit: "seconds", count: Math.max(1, Math.ceil(seconds)) };
    if (seconds < 60) return { unit: "seconds", count: Math.min(55, Math.ceil(seconds / 5) * 5) };
    if (seconds < 3600) return { unit: "minutes", count: Math.round(seconds / 60) };
    return { unit: "hours", count: Math.round(seconds / 360) / 10 };
}

export type SizeUnit = "b" | "kb" | "mb" | "gb";

/** Bytes in Discord's units (1 KB = 1024 bytes, like its own sizes), with one decimal under 10 */
export function size(bytes: number): { unit: SizeUnit; value: number; } {
    const units: SizeUnit[] = ["b", "kb", "mb", "gb"];
    let value = Math.max(0, bytes);
    let i = 0;
    while (value >= 1024 && i < units.length - 1) {
        value /= 1024;
        i++;
    }
    const value10 = i === 0 ? Math.round(value) : value < 10 ? Math.round(value * 10) / 10 : Math.round(value);
    return { unit: units[i], value: value10 };
}

/** What a file waiting to be sent has done: 0 to 1 */
export function fraction(loaded: number, total: number): number {
    if (!(total > 0)) return 0;
    return Math.min(1, Math.max(0, loaded / total));
}

export interface Transfer { loaded: number; total: number; }

/**
 * Everything being sent, as one fraction for the taskbar: bytes done over bytes to send, or -1 (no
 * bar) when nothing is. A message whose size isn't known yet counts as just started.
 */
export function overall(transfers: Iterable<Transfer>): number {
    let loaded = 0, total = 0, any = false;
    for (const t of transfers) {
        any = true;
        loaded += Math.max(0, Math.min(t.loaded, t.total));
        total += Math.max(0, t.total);
    }
    if (!any) return -1;
    return total > 0 ? loaded / total : 0;
}
