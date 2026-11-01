/**
 * The queue Who Reacted's lookups go through, kept free of Discord so it can be tested.
 *
 * Each lookup is one request to Discord's API, so they go one at a time: a gap apart, no more than a
 * few a minute, and only for reactions on screen (a pill that scrolls away before its turn is dropped).
 * When Discord answers 429 the queue pauses for as long as it asks, and at least `backoffMs`, doubling
 * each time it happens again in a row; the reaction that got it is asked again after, if it's still on screen.
 */

export interface Clock {
    now(): number;
    setTimeout(fn: () => void, ms: number): unknown;
    clearTimeout(handle: unknown): void;
}

export interface Limits {
    /** Between two requests */
    gapMs: number;
    /** Requests in any minute */
    perMinute: number;
    /** The shortest pause after a 429 */
    backoffMs: number;
    /** The longest, unless Discord asks for longer */
    maxBackoffMs: number;
}

/** A lookup. It may return its request's promise, so the queue knows when Discord said to slow down. */
export type Job = () => unknown;

const MINUTE = 60_000;

const systemClock: Clock = {
    now: () => Date.now(),
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/**
 * How long Discord asked to wait in ms (0 when it didn't say), or undefined if `err` isn't a rate limit.
 * Discord's HTTP client rejects with an HTTPResponseError, or the bare response, or (for a route it knows
 * is limited) { status, body: { retry_after } }: all three have the status, and retry_after is seconds.
 */
export function rateLimitWait(err: any): number | undefined {
    if (err?.status !== 429) return undefined;
    const header = err.headers?.["retry-after"] ?? err.headers?.["Retry-After"];
    const seconds = [err.retryAfter, err.body?.retry_after, typeof header === "string" ? parseFloat(header) : header]
        .find(s => typeof s === "number" && Number.isFinite(s) && s > 0);
    return seconds ? Math.ceil(seconds * 1000) : 0;
}

const isThenable = (value: any): value is PromiseLike<unknown> => typeof value?.then === "function";

/** Runs jobs one at a time within `limits`, each key once. A job removed before its turn never runs. */
export class FetchQueue {
    private readonly pending = new Map<string, Job>();
    /** Asked and not answered yet. Undefined once its pill went away, so a 429 doesn't bring it back. */
    private readonly running = new Map<string, Job | undefined>();
    private readonly done = new Set<string>();
    /** When the last `perMinute` requests went */
    private readonly sent: number[] = [];
    private last = -Infinity;
    private pausedUntil = -Infinity;
    private strikes = 0;
    private timer: unknown;
    /** Bumped by clear(), so answers to what was asked before it are ignored */
    private generation = 0;

    constructor(private readonly limits: Limits, private readonly clock: Clock = systemClock) { }

    has(key: string) {
        return this.done.has(key);
    }

    add(key: string, job: Job) {
        if (this.running.has(key)) return void this.running.set(key, job);
        if (this.done.has(key) || this.pending.has(key)) return;
        this.pending.set(key, job);
        this.schedule();
    }

    remove(key: string) {
        this.pending.delete(key);
        if (this.running.has(key)) this.running.set(key, undefined);
    }

    /** Forgets everything, for when the plugin stops */
    clear() {
        this.pending.clear();
        this.running.clear();
        this.done.clear();
        this.sent.length = 0;
        this.last = this.pausedUntil = -Infinity;
        this.strikes = 0;
        this.generation++;
        this.stopTimer();
    }

    /** When the next request may go: a gap after the last one, under the cap, and not while paused */
    private nextAt() {
        const { gapMs, perMinute } = this.limits;
        const capped = this.sent.length >= perMinute ? this.sent[this.sent.length - perMinute] + MINUTE : -Infinity;
        return Math.max(this.last + gapMs, capped, this.pausedUntil);
    }

    private schedule() {
        if (this.timer !== undefined || !this.pending.size) return;
        this.timer = this.clock.setTimeout(() => this.next(), Math.max(0, this.nextAt() - this.clock.now()));
    }

    private stopTimer() {
        if (this.timer !== undefined) this.clock.clearTimeout(this.timer);
        this.timer = undefined;
    }

    private next() {
        this.timer = undefined;
        const now = this.clock.now();
        if (now < this.nextAt()) return this.schedule();
        const first = this.pending.entries().next();
        if (first.done) return;
        const [key, job] = first.value;
        this.pending.delete(key);
        this.done.add(key);
        this.last = now;
        this.sent.push(now);
        if (this.sent.length > this.limits.perMinute) this.sent.shift();

        let result: unknown;
        try {
            result = job();
        } finally {
            this.schedule();
        }
        if (!isThenable(result)) return;
        const generation = this.generation;
        this.running.set(key, job);
        result.then(() => {
            if (generation !== this.generation) return;
            this.running.delete(key);
            this.strikes = 0;
        }, err => {
            if (generation === this.generation) this.failed(key, err);
        });
    }

    private failed(key: string, err: unknown) {
        const job = this.running.get(key);
        this.running.delete(key);
        const wait = rateLimitWait(err);
        // Anything else stays done: asking again wouldn't go better
        if (wait === undefined) return;

        const { backoffMs, maxBackoffMs } = this.limits;
        this.pausedUntil = Math.max(this.pausedUntil, this.clock.now() + Math.max(wait, Math.min(maxBackoffMs, backoffMs * 2 ** this.strikes)));
        this.strikes++;
        this.done.delete(key);
        // Still on screen: first in line once the pause is over
        if (job && !this.pending.has(key)) {
            const rest = [...this.pending];
            this.pending.clear();
            this.pending.set(key, job);
            for (const [k, j] of rest) this.pending.set(k, j);
        }
        this.stopTimer();
        this.schedule();
    }
}
