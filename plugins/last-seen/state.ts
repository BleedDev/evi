/**
 * Shared state for Last Seen: the tracker, storage, re-render signal and Discord store lookups.
 * index.tsx fills it; the UI modules (member list, friends, DMs, settings panel) read it.
 */
import { getStore, React } from "@evi/api";
import type { PluginContext } from "@evi/api";

import { DEFAULT_CAP, describe, deserialize, isIgnored, isOnlineStatus, lineText, merge, pack, PRUNE_SLACK } from "./track";
import type { Entry, Options, Tracker } from "./track";
import { t, words } from "./strings";

export const settings = {
    showOnProfiles: {
        type: "boolean",
        get label() { return t("settings.showOnProfiles"); },
        get description() { return t("settings.showOnProfiles.description"); },
        default: true,
    },
    showInMemberList: {
        type: "boolean",
        get label() { return t("settings.showInMemberList"); },
        get description() { return t("settings.showInMemberList.description"); },
        default: true,
    },
    showInFriends: {
        type: "boolean",
        get label() { return t("settings.showInFriends"); },
        get description() { return t("settings.showInFriends.description"); },
        default: true,
    },
    showInDms: {
        type: "boolean",
        get label() { return t("settings.showInDms"); },
        get description() { return t("settings.showInDms.description"); },
        default: true,
    },
    ignoreBots: {
        type: "boolean",
        get label() { return t("settings.ignoreBots"); },
        get description() { return t("settings.ignoreBots.description"); },
        default: true,
    },
} as const;

export type Settings = typeof settings;

/** The settings that turn a line on in one place */
export type Where = { [K in keyof Settings]: Settings[K]["type"] extends "boolean" ? K : never }[keyof Settings];

export const state = {
    context: undefined as PluginContext<Settings> | undefined,
    tracker: new Map() as Tracker,
    dirty: false,
    /** False until the saved data has loaded; saving waits for it so nothing is overwritten */
    loaded: false,
};

const stores = new Map<string, any>();

/** A Flux store, found once: lines ask on every row render and presences arrive by the hundred */
export const store = (name: string): any => {
    let found = stores.get(name);
    if (found) return found;
    try {
        found = getStore(name);
    } catch {
        return undefined;
    }
    stores.set(name, found);
    return found;
};

/** Your id, looked up once and again on reconnect (refreshOwnId): every observation checks it */
let me: string | undefined;
export const ownId = () => me ??= store("UserStore")?.getCurrentUser?.()?.id as string | undefined;
export const refreshOwnId = () => void (me = store("UserStore")?.getCurrentUser?.()?.id);

export const statusOf = (id: string) => store("PresenceStore")?.getStatus?.(id) as string | undefined;
export const isOnline = (id: string) => isOnlineStatus(statusOf(id));
/** For the places that show someone, where looking the user up is cheap next to rendering them */
export const isBot = (id: string) => store("UserStore")?.getUser?.(id)?.bot as boolean | undefined;

/** You, and bots when "Ignore bots" is on. `bot` is the payload's flag: missing means not a bot. */
export const ignored = (id: string, bot?: boolean) => isIgnored(id, bot, ownId(), !!state.context?.settings.get("ignoreBots"));

/**
 * Friends and 1:1 DM contacts, dropped last when the tracker is full. Built when a prune needs it
 * and kept until a relationship or DM channel changes (invalidateKeep).
 */
let keepIds: Set<string> | undefined;
/** False when RelationshipStore can't list friends: then they're asked about one by one */
let friendsListed = false;

function keepSet(): Set<string> {
    if (keepIds) return keepIds;
    const next = new Set<string>();
    friendsListed = false;
    try {
        const friends = store("RelationshipStore")?.getFriendIDs?.() as string[] | undefined;
        if (Array.isArray(friends)) {
            friendsListed = true;
            for (const id of friends) next.add(id);
        }
        const channels = store("PrivateChannelStore")?.getPrivateChannelIds?.() as string[] | undefined;
        const channelStore = store("ChannelStore");
        for (const channelId of channels ?? []) {
            const channel = channelStore?.getChannel?.(channelId);
            // Only 1:1 DMs: group DMs can have strangers in them
            if (channel?.type === 1) for (const id of channel.recipients ?? []) next.add(id);
        }
    } catch { }
    keepIds = next;
    return next;
}

export const invalidateKeep = () => void (keepIds = undefined);

export const keep = (id: string) => keepSet().has(id) || !friendsListed && !!store("RelationshipStore")?.isFriend?.(id);

/** Prunes a few hundred at a time, once that many new people came in */
export const opts: Options = { cap: DEFAULT_CAP, keep, slack: PRUNE_SLACK };

/** Forgets what was looked up for the current account (on stop) */
export function resetLookups() {
    me = undefined;
    keepIds = undefined;
}

/** "#general", "@name" for a DM, or undefined */
export function channelLabel(channelId: string | undefined): string | undefined {
    if (!channelId) return;
    const channel = store("ChannelStore")?.getChannel?.(channelId);
    if (!channel) return;
    if (channel.type === 1) return t("where.dms");
    if (channel.type === 3) return channel.name ? t("where.group", { name: channel.name }) : t("where.groupUnnamed");
    return channel.name ? t("where.channel", { name: channel.name }) : undefined;
}

export const entryOf = (id: string): Entry | undefined => state.tracker.get(id);

/** The full hover text for someone, or null when nothing is known */
export function fullText(id: string): string | null {
    const entry = entryOf(id);
    return describe(entry, isOnline(id), Date.now(), channelLabel(entry?.channelId), words);
}

/**
 * Lines subscribe per person, so a change re-renders only that person's lines. Changes are batched
 * (at most every 5 seconds). Once a minute every line re-reads its text for the relative times, and
 * React re-renders only the ones whose text changed. The settings panel listens to everything.
 */
const userListeners = new Map<string, Set<() => void>>();
const panelListeners = new Set<() => void>();
/** Bumped whenever everyone is re-read (the minute, settings, loading, clearing) */
let epoch = 0;
/** Bumped for one person when their data changes; cleared with each epoch */
const userVersions = new Map<string, number>();
/** For the panel: bumped on every change */
let version = 0;
const pendingIds = new Set<string>();
let pendingAll = false;
let bumpTimer: ReturnType<typeof setTimeout> | undefined;
/**
 * The time lines are worded for, moved on each notification. React may read a line's text more
 * than once per render, and it has to come out the same each time.
 */
let clock = Date.now();

const call = (listeners: Iterable<() => void>) => {
    for (const l of [...listeners]) l();
};

function notify(ids?: Iterable<string>) {
    clock = Date.now();
    version++;
    if (ids) {
        for (const id of ids) {
            userVersions.set(id, (userVersions.get(id) ?? 0) + 1);
            const listeners = userListeners.get(id);
            if (listeners) call(listeners);
        }
    } else {
        epoch++;
        userVersions.clear();
        for (const listeners of userListeners.values()) call(listeners);
    }
    call(panelListeners);
}

/** Re-reads every line now: settings changes, clearing, importing, loading, stopping */
export function bumpNow() {
    clearTimeout(bumpTimer);
    bumpTimer = undefined;
    pendingIds.clear();
    pendingAll = false;
    notify();
}

/** Once a minute: relative times move on. Only lines whose text changed re-render. */
export const tick = () => notify();

function flushChanges() {
    bumpTimer = undefined;
    if (pendingAll) return bumpNow();
    const ids = [...pendingIds];
    pendingIds.clear();
    notify(ids);
}

/** Someone's data changed (or, without an id, anyone's): saved soon, their lines update within 5 seconds */
export function changed(id?: string) {
    state.dirty = true;
    if (id === undefined) pendingAll = true;
    else pendingIds.add(id);
    bumpTimer ??= setTimeout(flushChanges, 5000);
}

/** Changes when someone's data changes or everyone is re-read: a cache key for what's built from their data */
export const versionOf = (id: string) => `${epoch}:${userVersions.get(id) ?? 0}`;

/** The settings panel: re-renders on every change */
export function useVersion() {
    return React.useSyncExternalStore(
        cb => {
            panelListeners.add(cb);
            return () => void panelListeners.delete(cb);
        },
        () => version,
    );
}

function subscribeUser(id: string, cb: () => void) {
    let listeners = userListeners.get(id);
    if (!listeners) userListeners.set(id, listeners = new Set());
    listeners.add(cb);
    return () => {
        listeners.delete(cb);
        if (!listeners.size && userListeners.get(id) === listeners) userListeners.delete(id);
    };
}

/**
 * React hook: `read()` about one person, read again when their data changes, on the minute and on
 * settings changes. Re-renders only when the result is different (===), so return a string,
 * number or boolean.
 */
export function useUser<T extends string | number | boolean>(userId: string, read: () => T): T {
    const subscribe = React.useCallback((cb: () => void) => subscribeUser(userId, cb), [userId]);
    return React.useSyncExternalStore(subscribe, read);
}

/** The line under someone's name, or "" for none: the setting is off, they're online, or nothing is known */
export function lineOf(userId: string, setting: Where): string {
    if (!state.context?.settings.get(setting) || isOnline(userId)) return "";
    return lineText(entryOf(userId), clock, words) ?? "";
}

const DB_NAME = "evi-last-seen";
const DB_STORE = "kv";
const DB_KEY = "data";
/** Where a saved record that can't be read is kept before it's replaced */
const UNREADABLE_KEY = "data-unreadable";
const RETRY_FIRST = 5_000;
const RETRY_MAX = 5 * 60_000;

function openDb(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(DB_STORE);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

export async function dbGet(): Promise<unknown> {
    const db = await openDb();
    try {
        return await new Promise((resolve, reject) => {
            const req = db.transaction(DB_STORE, "readonly").objectStore(DB_STORE).get(DB_KEY);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    } finally {
        db.close();
    }
}

/** Writes `value`, or deletes the record when it's undefined */
export async function dbPut(value: unknown, key = DB_KEY): Promise<void> {
    const db = await openDb();
    try {
        await new Promise<void>((resolve, reject) => {
            const tx = db.transaction(DB_STORE, "readwrite");
            if (value === undefined) tx.objectStore(DB_STORE).delete(key);
            else tx.objectStore(DB_STORE).put(value, key);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    } finally {
        db.close();
    }
}

/**
 * Reads the saved data in under what was seen while it loaded, then calls `onLoaded`. Nothing is
 * saved until then, so a read that fails (the database busy during an update, say) is tried again
 * later rather than letting this session's data replace everything saved. Only a record that was
 * read and can't be understood is started over, after it's kept aside.
 */
export function load(ctx: PluginContext<Settings>, onLoaded: () => void, read: () => Promise<unknown> = dbGet, attempt = 0): Promise<void> {
    // Stopped, or everything was replaced (clear, import) while this was loading
    const stale = () => state.context !== ctx || state.loaded;
    return read().then(data => {
        if (stale()) return;
        let saved: Tracker;
        try {
            saved = deserialize(data, opts);
        } catch (e) {
            ctx.logger.error("Saved data can't be read, starting over", e);
            dbPut(data, UNREADABLE_KEY).catch(() => { });
            saved = new Map();
        }
        state.tracker = mergeOnTop(saved, state.tracker);
        state.loaded = true;
        onLoaded();
    }, e => {
        if (stale()) return;
        ctx.logger.error("Couldn't load saved data, trying again", e);
        ctx.setTimeout(() => void load(ctx, onLoaded, read, attempt + 1), Math.min(RETRY_FIRST * 2 ** attempt, RETRY_MAX));
    });
}

export async function save() {
    if (!state.dirty || !state.loaded) return;
    state.dirty = false;
    try {
        await dbPut(pack(state.tracker, Date.now()));
    } catch (e) {
        state.dirty = true;
        state.context?.logger.error("Couldn't save", e);
    }
}

/** Merges each of `newer`'s entries into `base` (moved to the most recently used end) and returns `base` */
export function mergeOnTop(base: Tracker, newer: Tracker): Tracker {
    for (const [id, entry] of newer) {
        const old = base.get(id);
        base.delete(id);
        base.set(id, merge(old, entry));
    }
    return base;
}

/** Replaces all data (clear, undo, import) and saves right away */
export function replaceAll(tracker: Tracker) {
    state.tracker = tracker;
    state.dirty = true;
    state.loaded = true;
    bumpNow();
    return save();
}
