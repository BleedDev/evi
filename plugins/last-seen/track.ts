/**
 * Pure bookkeeping for Last Seen: who was last seen online when, when they were last active, and
 * when (and where) they last sent a message. No Discord or storage access here, so it can be
 * tested on its own.
 */

export interface Entry {
    /** Last time we saw them online (the moment they went offline, or the last observation while online, refreshed at most every 5 minutes) */
    seen?: number;
    /**
     * `seen` is only a lower bound: they were online when Discord closed and may have stayed online
     * after, so the real time is somewhere between `seen` and now
     */
    approx?: boolean;
    /** Online at the last observation */
    online?: boolean;
    /** Last time we saw them do something: typing, joining or leaving voice, reacting */
    active?: number;
    /** Last time we saw them send a message */
    message?: number;
    /** Where that message was */
    channelId?: string;
    messageId?: string;
}

/** Insertion-ordered: least recently touched first, so pruning drops from the front */
export type Tracker = Map<string, Entry>;

/** About 40 bytes per person saved, so roughly a megabyte at the cap */
export const DEFAULT_CAP = 25_000;

/** People who are never dropped while anyone else can be (friends, DM contacts) */
export type Keep = (id: string) => boolean;

export const isOnlineStatus = (status: string | null | undefined) => status === "online" || status === "idle" || status === "dnd";

/** Moves an entry to the most recently used end and returns it */
function touch(tracker: Tracker, id: string): Entry {
    const entry = tracker.get(id) ?? {};
    tracker.delete(id);
    tracker.set(id, entry);
    return entry;
}

/**
 * How far past the cap the tracker may grow before it's pruned. Pruning then drops this many at
 * once, so it runs once per few hundred new people instead of on every one.
 */
export const PRUNE_SLACK = 500;

/**
 * Drops the least recently touched entries until `cap` are left, skipping anyone `keep` protects.
 * Only if everyone left is protected do protected people go too. With `slack`, nothing happens
 * until there are more than `cap + slack`. Returns how many were removed.
 *
 * Protected people who were skipped move to the most recently used end, so the next prune doesn't
 * walk past them again: with thousands of friends at the front, every prune would rescan them all.
 */
export function prune(tracker: Tracker, cap = DEFAULT_CAP, keep?: Keep, slack = 0): number {
    if (tracker.size <= cap + slack) return 0;
    const excess = tracker.size - cap;
    let removed = 0;
    const skipped: [string, Entry][] = [];
    for (const [id, entry] of tracker) {
        if (removed >= excess) break;
        if (keep?.(id)) {
            skipped.push([id, entry]);
            continue;
        }
        tracker.delete(id);
        removed++;
    }
    for (const [id, entry] of skipped) {
        tracker.delete(id);
        tracker.set(id, entry);
    }
    for (const id of tracker.keys()) {
        if (removed >= excess) break;
        tracker.delete(id);
        removed++;
    }
    return removed;
}

export interface Options {
    cap?: number;
    keep?: Keep;
    /** Extra room before pruning, see PRUNE_SLACK. 0 (the default) prunes on every addition over the cap. */
    slack?: number;
}

/**
 * Whether someone isn't tracked: you, and bots when `ignoreBots` is on. Only an explicit bot flag
 * counts: raw payloads (presences, typing, voice) usually leave it out, and looking each one up in
 * UserStore on every dispatch isn't worth it. The lines under names pass the user record's own flag.
 */
export function isIgnored(id: string | undefined, bot: boolean | undefined, me: string | undefined, ignoreBots: boolean): boolean {
    if (!id || id === me) return true;
    return ignoreBots && bot === true;
}

/**
 * Still online: their stamp only matters once they go offline (views say "Online now" meanwhile,
 * and a saved "online" becomes the save time on restore), so it's refreshed at most this often.
 * Activity, song and idle changes would otherwise mark the data changed, and due a save, all the time.
 */
export const RESTAMP_MS = 5 * 60_000;

/**
 * Records a presence observation. Online (online/idle/dnd): marks them online and seen now, or
 * only keeps them recent if they were already online and seen within RESTAMP_MS.
 * Anything else (offline, invisible, unknown): if they were online, they were last seen now.
 * Someone we never saw online isn't recorded. Returns whether anything changed.
 */
export function observePresence(tracker: Tracker, id: string, status: string | null | undefined, now: number, opts: Options = {}): boolean {
    if (isOnlineStatus(status)) {
        const old = tracker.get(id);
        const since = now - (old?.seen ?? 0);
        if (old?.online && since >= 0 && since < RESTAMP_MS) {
            touch(tracker, id);
            return false;
        }
        const entry = touch(tracker, id);
        entry.online = true;
        entry.seen = now;
        delete entry.approx;
        prune(tracker, opts.cap, opts.keep, opts.slack);
        return true;
    }
    const entry = tracker.get(id);
    if (!entry?.online) return false;
    touch(tracker, id);
    entry.online = false;
    entry.seen = now;
    delete entry.approx;
    return true;
}

/** Records activity (typing, voice, a reaction) at `at`. Returns whether anything changed. */
export function observeActivity(tracker: Tracker, id: string, at: number, opts: Options = {}): boolean {
    const old = tracker.get(id)?.active ?? 0;
    if (at <= old) return false;
    touch(tracker, id).active = at;
    prune(tracker, opts.cap, opts.keep, opts.slack);
    return true;
}

/**
 * Records a message sent at `at`, and where. Older messages than the one we have (from scrolling
 * back through history) change nothing and don't count as a recent touch. Returns whether anything
 * changed.
 */
export function observeMessage(tracker: Tracker, id: string, at: number, where: { channelId?: string; messageId?: string; } = {}, opts: Options = {}): boolean {
    const old = tracker.get(id)?.message ?? 0;
    if (at <= old) return false;
    const entry = touch(tracker, id);
    entry.message = at;
    if (where.channelId) entry.channelId = where.channelId;
    else delete entry.channelId;
    if (where.messageId) entry.messageId = where.messageId;
    else delete entry.messageId;
    prune(tracker, opts.cap, opts.keep, opts.slack);
    return true;
}

/** v2: [id, seen, message, online, active, channelId, messageId, approx]. v1 rows are the first four. */
type Row = [string, number, number, 0 | 1, number, string, string, 0 | 1];

export interface Saved {
    v: 2;
    savedAt: number;
    rows: Row[];
}

export function serialize(tracker: Tracker, now: number): Saved {
    const rows: Row[] = [];
    for (const [id, e] of tracker) {
        rows.push([id, e.seen ?? 0, e.message ?? 0, e.online ? 1 : 0, e.active ?? 0, e.channelId ?? "", e.messageId ?? "", e.approx ? 1 : 0]);
    }
    return { v: 2, savedAt: now, rows };
}

const num = (v: unknown) => (typeof v === "number" && v > 0 ? v : 0);
const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);

/** One saved person back into the tracker; nothing is added for someone with nothing known */
function restore(tracker: Tracker, savedAt: number, id: string, seen: unknown, message: unknown, online: unknown, active: unknown, channelId: unknown, messageId: unknown, approx: unknown) {
    const entry: Entry = {};
    const s = num(seen);
    if (online && savedAt > s) {
        entry.seen = savedAt;
        entry.approx = true;
    } else if (s) {
        entry.seen = s;
        if (approx) entry.approx = true;
    }
    if (num(active)) entry.active = num(active);
    if (num(message)) {
        entry.message = num(message);
        if (str(channelId)) entry.channelId = str(channelId);
        if (str(messageId)) entry.messageId = str(messageId);
    }
    if (entry.seen || entry.message || entry.active) tracker.set(id, entry);
}

/**
 * v3, the format kept in IndexedDB: one column per field, numbers in typed arrays and ids joined
 * into one string each. Saving copies the data into the database (a structured clone, on the main
 * thread); tens of thousands of little row arrays took several milliseconds every 30 seconds, a
 * few strings and typed arrays copy in one go. Exports stay v2 (serialize), which reads as JSON.
 */
export interface Packed {
    v: 3;
    savedAt: number;
    /** Snowflakes joined with "," */
    ids: string;
    seen: Float64Array;
    message: Float64Array;
    active: Float64Array;
    /** 1: online, 2: approx */
    flags: Uint8Array;
    /** Joined with ",", "" where unknown */
    channelIds: string;
    messageIds: string;
}

const SEP = ",";

export function pack(tracker: Tracker, now: number): Packed {
    const n = tracker.size;
    const seen = new Float64Array(n), message = new Float64Array(n), active = new Float64Array(n), flags = new Uint8Array(n);
    const ids: string[] = [], channelIds: string[] = [], messageIds: string[] = [];
    let i = 0;
    for (const [id, e] of tracker) {
        const channelId = e.channelId ?? "", messageId = e.messageId ?? "";
        // Ids are snowflakes; anything with the separator in it (a hand-edited import) would misalign the columns
        if (id.includes(SEP) || channelId.includes(SEP) || messageId.includes(SEP)) continue;
        ids.push(id);
        channelIds.push(channelId);
        messageIds.push(messageId);
        seen[i] = e.seen ?? 0;
        message[i] = e.message ?? 0;
        active[i] = e.active ?? 0;
        flags[i] = (e.online ? 1 : 0) | (e.approx ? 2 : 0);
        i++;
    }
    const fit = <T extends Float64Array | Uint8Array>(column: T): T => i < n ? column.slice(0, i) as T : column;
    return {
        v: 3,
        savedAt: now,
        ids: ids.join(SEP),
        seen: fit(seen),
        message: fit(message),
        active: fit(active),
        flags: fit(flags),
        channelIds: channelIds.join(SEP),
        messageIds: messageIds.join(SEP),
    };
}

function unpack(saved: Partial<Packed>, tracker: Tracker) {
    const { seen, message, active, flags } = saved;
    if (!(seen instanceof Float64Array) || !(message instanceof Float64Array) || !(active instanceof Float64Array) || !(flags instanceof Uint8Array)) return;
    const n = seen.length;
    if (!n || typeof saved.ids !== "string") return;
    const ids = saved.ids.split(SEP);
    const channelIds = typeof saved.channelIds === "string" ? saved.channelIds.split(SEP) : [];
    const messageIds = typeof saved.messageIds === "string" ? saved.messageIds.split(SEP) : [];
    if (ids.length !== n || message.length !== n || active.length !== n || flags.length !== n) return;
    const savedAt = num(saved.savedAt);
    for (let i = 0; i < n; i++) {
        if (!ids[i]) continue;
        restore(tracker, savedAt, ids[i], seen[i], message[i], flags[i] & 1, active[i], channelIds[i], messageIds[i], flags[i] & 2);
    }
}

/**
 * Restores saved data (v1, v2 or v3). Anyone who was online when it was saved was, as far as we know,
 * last seen then: the "online" flag is stale after a restart, so it becomes an approximate timestamp.
 */
export function deserialize(data: unknown, opts: Options = {}): Tracker {
    const tracker: Tracker = new Map();
    const saved = data as { v?: unknown; savedAt?: unknown; rows?: unknown; } | null | undefined;
    if (saved?.v === 3) unpack(saved as Partial<Packed>, tracker);
    else if (saved && Array.isArray(saved.rows)) {
        const savedAt = num(saved.savedAt);
        for (const row of saved.rows) {
            if (!Array.isArray(row) || typeof row[0] !== "string") continue;
            const [id, seen, message, online, active, channelId, messageId, approx] = row;
            restore(tracker, savedAt, id, seen, message, online, active, channelId, messageId, approx);
        }
    }
    prune(tracker, opts.cap, opts.keep, opts.slack);
    return tracker;
}

/** Keeps the newer of each field. Used to merge what was seen while the saved data was loading. */
export function merge(into: Entry | undefined, from: Entry): Entry {
    const out: Entry = { ...into };
    if (from.seen && (!out.seen || from.seen >= out.seen || from.online)) {
        out.seen = from.seen;
        out.online = from.online;
        if (from.approx) out.approx = true;
        else delete out.approx;
    }
    if (from.active && from.active > (out.active ?? 0)) out.active = from.active;
    if (from.message && from.message > (out.message ?? 0)) {
        out.message = from.message;
        out.channelId = from.channelId;
        out.messageId = from.messageId;
        if (!out.channelId) delete out.channelId;
        if (!out.messageId) delete out.messageId;
    }
    return out;
}

/** The words the summaries are made of. English here; the plugin passes its translations in (strings.ts) */
export type WordKey =
    | "unit.y" | "unit.mo" | "unit.w" | "unit.d" | "unit.h" | "unit.m"
    | "ago" | "justNow" | "seen" | "seenIn" | "active" | "online" | "message" | "messageIn";
export type Words = (key: WordKey, vars?: Record<string, string | number>) => string;

const ENGLISH: Record<WordKey, string> = {
    "unit.y": "{n}y",
    "unit.mo": "{n}mo",
    "unit.w": "{n}w",
    "unit.d": "{n}d",
    "unit.h": "{n}h",
    "unit.m": "{n}m",
    ago: "{span} ago",
    justNow: "just now",
    seen: "Last seen {when}",
    seenIn: "Last seen in the last {span}",
    active: "Active {when}",
    online: "Online now",
    message: "Last message {when}",
    messageIn: "Last message {when} in {where}",
};

export const english: Words = (key, vars) => ENGLISH[key].replace(/\{(\w+)\}/g, (whole, name: string) => vars && name in vars ? String(vars[name]) : whole);

const UNITS: [number, "y" | "mo" | "w" | "d" | "h" | "m"][] = [
    [365 * 24 * 3600_000, "y"],
    [30 * 24 * 3600_000, "mo"],
    [7 * 24 * 3600_000, "w"],
    [24 * 3600_000, "d"],
    [3600_000, "h"],
    [60_000, "m"],
];

/** "5m", "3h", "2d", or null under a minute */
export function formatSpan(then: number, now: number, say: Words = english): string | null {
    const diff = Math.max(0, now - then);
    for (const [ms, unit] of UNITS) {
        if (diff >= ms) return say(`unit.${unit}`, { n: Math.floor(diff / ms) });
    }
    return null;
}

/** "just now", "5m ago", "3h ago", "2d ago", "3w ago", "4mo ago", "1y ago" */
export function formatRelative(then: number, now: number, say: Words = english): string {
    const span = formatSpan(then, now, say);
    return span ? say("ago", { span }) : say("justNow");
}

/** "Last seen 3h ago", or "Last seen in the last 3h" when it's only a lower bound */
export function seenText(entry: Entry, now: number, say: Words = english): string | null {
    if (!entry.seen) return null;
    if (!entry.approx) return say("seen", { when: formatRelative(entry.seen, now, say) });
    const span = formatSpan(entry.seen, now, say);
    return span ? say("seenIn", { span }) : say("seen", { when: say("justNow") });
}

/** The one-line summary for an offline person: whichever of last seen and last active is newer */
export function lineText(entry: Entry | undefined, now: number, say: Words = english): string | null {
    if (!entry) return null;
    if (entry.active && entry.active > (entry.seen ?? 0)) return say("active", { when: formatRelative(entry.active, now, say) });
    return seenText(entry, now, say);
}

/**
 * "Last seen 3h ago · Active 1h ago · Last message 2d ago in #general", "Online now · Last message
 * 5m ago", or null when nothing is known. Activity is only mentioned when it's newer than last seen.
 */
export function describe(entry: Entry | undefined, onlineNow: boolean, now: number, where?: string, say: Words = english): string | null {
    const parts: string[] = [];
    if (onlineNow) parts.push(say("online"));
    else if (entry?.seen) parts.push(seenText(entry, now, say)!);
    if (!onlineNow && entry?.active && entry.active > (entry.seen ?? 0)) parts.push(say("active", { when: formatRelative(entry.active, now, say) }));
    if (entry?.message) {
        const when = formatRelative(entry.message, now, say);
        parts.push(where ? say("messageIn", { when, where }) : say("message", { when }));
    }
    return parts.length ? parts.join(" · ") : null;
}
