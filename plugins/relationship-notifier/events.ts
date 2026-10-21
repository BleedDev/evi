/**
 * What Relationship Notifier decides. Pure: no Discord, no DOM, no storage, so it's unit tested.
 *
 * `decide` looks at a Flux action BEFORE Discord's stores apply it, so the lookup still sees the
 * friend, group DM or server that's about to go, and its name. Things you do yourself (removing a
 * friend, leaving a group or server) are marked on the tracker first and never reported.
 *
 * `missedChanges` compares what you had when Discord last saw it (a Snapshot) with what you have now,
 * for what happened while you were offline. `unansweredRequests` finds friend requests you sent that
 * have waited a week. The history is capped, filtered, searched and paged here too.
 */

export type NotificationKind = "friendRemoved" | "requestCancelled" | "requestAccepted" | "requestUnanswered" | "groupRemoved" | "serverRemoved";

export const KINDS: readonly NotificationKind[] = ["friendRemoved", "requestCancelled", "requestAccepted", "requestUnanswered", "groupRemoved", "serverRemoved"];

export interface RelationshipNotification {
    kind: NotificationKind;
    /** The user, group DM or server id */
    id: string;
    name: string;
    /** Their @username, for search */
    username?: string;
    /** When it happened, or when it was noticed (ms) */
    at: number;
    /** When you became friends (ms), for a friend removal */
    since?: number;
    /** Noticed after being offline: it happened somewhere between this (ms) and `at` */
    offlineSince?: number;
    /** What the toast and the log say, in English */
    text: string;
}

/** Discord's relationship types */
export const RelationshipType = { NONE: 0, FRIEND: 1, BLOCKED: 2, INCOMING: 3, OUTGOING: 4, IMPLICIT: 5 } as const;
/** Discord's channel type for group DMs */
export const GROUP_DM = 3;

export interface ChannelSnapshot {
    type: number;
    name?: string | null;
    /** Recipient user ids, yourself excluded */
    recipients?: readonly string[];
}

/** Reads the stores as they are before the action is applied */
export interface Lookup {
    currentUserId?: string;
    relationshipType(userId: string): number | undefined;
    userName(userId: string): string | undefined;
    /** Their @username */
    username?(userId: string): string | undefined;
    /** When you became friends (ms) */
    since?(userId: string): number | undefined;
    channel(channelId: string): ChannelSnapshot | undefined;
    guildName(guildId: string): string | undefined;
}

/**
 * A Lookup over Discord's stores that finds each store only when a question needs it. Most actions
 * that reach `decide` (a server channel deleted, a server going unavailable) are settled by one
 * store, so the others aren't looked up for them.
 */
export function storeLookup(store: (name: string) => any): Lookup {
    const cache = new Map<string, any>();
    const get = (name: string) => {
        if (!cache.has(name)) cache.set(name, store(name));
        return cache.get(name);
    };
    return {
        get currentUserId() {
            return get("UserStore")?.getCurrentUser?.()?.id;
        },
        relationshipType: id => get("RelationshipStore")?.getRelationshipType?.(id),
        userName: id => {
            const nick = get("RelationshipStore")?.getNickname?.(id);
            if (nick) return nick;
            const user = get("UserStore")?.getUser?.(id);
            return user ? user.globalName ?? user.global_name ?? user.username : undefined;
        },
        username: id => get("UserStore")?.getUser?.(id)?.username,
        since: id => parseTime(get("RelationshipStore")?.getSince?.(id)),
        channel: id => {
            const channel = get("ChannelStore")?.getChannel?.(id);
            return channel ? { type: channel.type, name: channel.name, recipients: channel.recipients } : undefined;
        },
        guildName: id => get("GuildStore")?.getGuild?.(id)?.name,
    };
}

/** Discord's ISO "since" strings (or ms) as ms */
export function parseTime(value: unknown): number | undefined {
    const ms = typeof value === "number" ? value : typeof value === "string" ? Date.parse(value) : NaN;
    return Number.isFinite(ms) ? ms : undefined;
}

export type Scope = "relationship" | "channel" | "guild";

/** How long something you did yourself waits for Discord's matching event */
export const SELF_WINDOW = 60_000;
/** A group DM removal can arrive twice (recipient remove, then channel delete): report it once */
export const DEDUPE_WINDOW = 10_000;
/** Marks every pending relationship as yours, e.g. when you clear all pending requests */
export const ALL = "*";

export class Tracker {
    private readonly self = new Map<string, number>();
    private readonly reported = new Map<string, number>();

    /** Something you're about to do yourself, e.g. leaving a server */
    markSelf(scope: Scope, id: string, now = Date.now()) {
        this.prune(now);
        this.self.set(`${scope}:${id}`, now);
    }

    /** Whether the event was caused by you. Consumes the mark. */
    consumeSelf(scope: Scope, id: string, now = Date.now()) {
        this.prune(now);
        if (this.self.delete(`${scope}:${id}`)) return true;
        return this.self.has(`${scope}:${ALL}`);
    }

    /** True the first time within the dedupe window */
    firstReport(scope: Scope | "accepted", id: string, now = Date.now()) {
        this.prune(now);
        const key = `${scope}:${id}`;
        if (this.reported.has(key)) return false;
        this.reported.set(key, now);
        return true;
    }

    private prune(now: number) {
        for (const [key, at] of this.self) if (now - at > SELF_WINDOW) this.self.delete(key);
        for (const [key, at] of this.reported) if (now - at > DEDUPE_WINDOW) this.reported.delete(key);
    }
}

export interface FluxLikeAction {
    type: string;
    [key: string]: any;
}

const fallbackUser = (id: string) => `User ${id}`;

/** The English text of an entry: what's kept in `text` */
export function englishText(kind: NotificationKind, name: string, offline = false) {
    switch (kind) {
        case "friendRemoved": return offline ? `${name} is no longer your friend` : `${name} removed you as a friend`;
        case "requestCancelled": return offline ? `Your friend request to ${name} is gone: declined, cancelled, or they blocked you` : `Your friend request to ${name} was declined, or they blocked you`;
        case "requestAccepted": return `${name} accepted your friend request`;
        case "requestUnanswered": return `Your friend request to ${name} has had no answer for a week`;
        case "groupRemoved": return `You were removed from ${name}`;
        case "serverRemoved": return offline ? `You're no longer in ${name}` : `You were removed from ${name}`;
    }
}

/** Kinds whose wording changes when it was noticed after being offline: it may have been you, elsewhere */
export const OFFLINE_WORDING: ReadonlySet<NotificationKind> = new Set(["friendRemoved", "requestCancelled", "serverRemoved"]);

/** An entry with its English text, leaving out what isn't known */
export function notification(fields: Omit<RelationshipNotification, "text">): RelationshipNotification {
    const entry = { ...fields } as RelationshipNotification;
    for (const key of ["username", "since", "offlineSince"] as const) if (entry[key] === undefined) delete entry[key];
    entry.text = englishText(entry.kind, entry.name, entry.offlineSince !== undefined);
    return entry;
}

export function groupName(channel: ChannelSnapshot, lookup: Pick<Lookup, "userName">) {
    if (channel.name) return channel.name;
    const names = (channel.recipients ?? []).map(id => lookup.userName(id)).filter((n): n is string => !!n);
    return names.length ? names.join(", ") : "a group DM";
}

function groupRemoved(channelId: string, lookup: Lookup, tracker: Tracker, now: number): RelationshipNotification | null {
    const channel = lookup.channel(channelId);
    if (!channel || channel.type !== GROUP_DM) return null;
    if (tracker.consumeSelf("channel", channelId, now)) return null;
    if (!tracker.firstReport("channel", channelId, now)) return null;
    return notification({ kind: "groupRemoved", id: channelId, name: groupName(channel, lookup), at: now });
}

/** A user's name and @username, from the stores or else the action's payload */
function person(id: string, user: any, lookup: Lookup) {
    return {
        name: lookup.userName(id) ?? user?.global_name ?? user?.username ?? fallbackUser(id),
        username: lookup.username?.(id) ?? user?.username,
    };
}

/** What an action means for you, or null if there's nothing to report */
export function decide(action: FluxLikeAction, lookup: Lookup, tracker: Tracker, now = Date.now()): RelationshipNotification | null {
    switch (action?.type) {
        case "RELATIONSHIP_REMOVE": {
            const rel = action.relationship;
            const id: string | undefined = rel?.id ?? rel?.user?.id;
            if (!id) return null;
            const type = lookup.relationshipType(id) ?? rel?.type;
            if (type !== RelationshipType.FRIEND && type !== RelationshipType.OUTGOING) return null;
            if (tracker.consumeSelf("relationship", id, now)) return null;
            return type === RelationshipType.FRIEND
                ? notification({ kind: "friendRemoved", id, ...person(id, rel?.user, lookup), at: now, since: lookup.since?.(id) })
                : notification({ kind: "requestCancelled", id, ...person(id, rel?.user, lookup), at: now });
        }
        case "RELATIONSHIP_ADD":
        case "RELATIONSHIP_UPDATE": {
            // A request you sent becoming a friendship: the store still says it's outgoing
            const rel = action.relationship;
            const id: string | undefined = rel?.id ?? rel?.user?.id;
            if (!id || rel.type !== RelationshipType.FRIEND || lookup.relationshipType(id) !== RelationshipType.OUTGOING) return null;
            if (!tracker.firstReport("accepted", id, now)) return null;
            return notification({ kind: "requestAccepted", id, ...person(id, rel.user, lookup), at: now });
        }
        case "CHANNEL_DELETE": {
            const id: string | undefined = action.channel?.id;
            return id ? groupRemoved(id, lookup, tracker, now) : null;
        }
        case "CHANNEL_RECIPIENT_REMOVE": {
            const userId: string | undefined = action.user?.id;
            if (!action.channelId || !userId || !lookup.currentUserId || userId !== lookup.currentUserId) return null;
            return groupRemoved(action.channelId, lookup, tracker, now);
        }
        case "GUILD_DELETE": {
            const guild = action.guild;
            const id: string | undefined = guild?.id;
            // Outages send GUILD_DELETE with unavailable: the server comes back on its own
            if (!id || guild.unavailable) return null;
            const known = lookup.guildName(id);
            if (known === undefined) return null;
            if (tracker.consumeSelf("guild", id, now)) return null;
            if (!tracker.firstReport("guild", id, now)) return null;
            return notification({ kind: "serverRemoved", id, name: known, at: now });
        }
    }
    return null;
}

/** How long a friend request you sent waits for an answer before it's reported */
export const UNANSWERED_AFTER = 7 * 24 * 60 * 60 * 1000;

/**
 * Outgoing requests (id, sent at) that have waited a week and weren't reported yet (`due`), and the
 * ids to remember as reported: only those still pending, so the list never outgrows your requests.
 */
export function unansweredRequests(outgoing: Iterable<readonly [string, number | undefined]>, reported: ReadonlySet<string>, now: number) {
    const due: string[] = [];
    const remember: string[] = [];
    for (const [id, sentAt] of outgoing) {
        if (reported.has(id)) remember.push(id);
        else if (sentAt !== undefined && now - sentAt >= UNANSWERED_AFTER) {
            due.push(id);
            remember.push(id);
        }
    }
    return { due, remember };
}

export interface KnownUser {
    name: string;
    username?: string;
    /** Friends since (ms) */
    since?: number;
}

/** Your friends, pending outgoing requests and servers, as last seen by this account */
export interface Snapshot {
    /** Your account: another account's snapshot is never compared */
    user: string;
    at: number;
    friends: Record<string, KnownUser>;
    requests: Record<string, KnownUser>;
    /** Server id to name */
    servers: Record<string, string>;
}

/** An empty section where there used to be entries means Discord hasn't loaded it, not that it's all gone */
const loaded = (was: object, is: object) => Object.keys(is).length > 0 || Object.keys(was).length === 0;
/** Friends and requests arrive together, so your last request being answered doesn't look unloaded */
const peopleLoaded = (before: Snapshot, now: Snapshot) => loaded({ ...before.friends, ...before.requests }, { ...now.friends, ...now.requests });

/**
 * The snapshot to keep: the new one, with sections that don't look loaded yet kept from before, and
 * servers that are only unavailable for now (`stillThere`) kept too.
 */
export function settleSnapshot(before: Snapshot | undefined, now: Snapshot, stillThere: (guildId: string) => boolean = () => false): Snapshot {
    if (!before || before.user !== now.user) return now;
    const servers = { ...now.servers };
    for (const [id, name] of Object.entries(before.servers)) if (!(id in servers) && stillThere(id)) servers[id] = name;
    const people = peopleLoaded(before, now);
    return {
        ...now,
        friends: people ? now.friends : before.friends,
        requests: people ? now.requests : before.requests,
        servers: loaded(before.servers, now.servers) ? servers : before.servers,
    };
}

/**
 * What changed between two snapshots of the same account, as entries noticed at `at`. A request
 * that's gone was accepted if they're a friend now. `stillThere` keeps servers that are only
 * unavailable for now.
 */
export function missedChanges(before: Snapshot | undefined, now: Snapshot, at: number, stillThere: (guildId: string) => boolean = () => false): RelationshipNotification[] {
    if (!before || before.user !== now.user) return [];
    const offlineSince = before.at;
    const people = peopleLoaded(before, now);
    const gone = <T>(was: Record<string, T>, is: Record<string, T>, isLoaded: boolean) => isLoaded ? Object.entries(was).filter(([id]) => !(id in is)) : [];
    return [
        ...gone(before.friends, now.friends, people).map(([id, user]) => notification({ kind: "friendRemoved", id, ...user, at, offlineSince })),
        ...gone(before.requests, now.requests, people).map(([id, user]) =>
            notification({ kind: id in now.friends ? "requestAccepted" : "requestCancelled", id, name: user.name, username: user.username, at, offlineSince })),
        ...gone(before.servers, now.servers, loaded(before.servers, now.servers)).filter(([id]) => !stillThere(id)).map(([id, name]) => notification({ kind: "serverRemoved", id, name, at, offlineSince })),
    ];
}

const isRecord = (value: unknown): value is Record<string, any> => !!value && typeof value === "object" && !Array.isArray(value);

function knownUsers(raw: unknown): Record<string, KnownUser> {
    const users: Record<string, KnownUser> = {};
    if (!isRecord(raw)) return users;
    for (const [id, user] of Object.entries(raw)) {
        if (!isRecord(user) || typeof user.name !== "string") continue;
        users[id] = { name: user.name };
        if (typeof user.username === "string") users[id].username = user.username;
        const since = parseTime(user.since);
        if (since !== undefined) users[id].since = since;
    }
    return users;
}

/** A stored snapshot, or undefined if it isn't one */
export function parseSnapshot(raw: unknown): Snapshot | undefined {
    if (!isRecord(raw) || typeof raw.user !== "string" || !Number.isFinite(raw.at)) return undefined;
    const servers: Record<string, string> = {};
    if (isRecord(raw.servers)) for (const [id, name] of Object.entries(raw.servers)) if (typeof name === "string") servers[id] = name;
    return { user: raw.user, at: raw.at, friends: knownUsers(raw.friends), requests: knownUsers(raw.requests), servers };
}

/** How many notifications the history keeps */
export const CAP = 500;
/** The same thing reported again this soon (another session, a reconnect) is the same thing */
export const REPEAT_WINDOW = 60_000;

/**
 * Whether `entry` was already logged: the same kind and id within a minute, or, for something noticed
 * after being offline, logged any time since it could have happened.
 */
export function isRepeat(entries: readonly RelationshipNotification[], entry: RelationshipNotification) {
    return entries.some(e => e.kind === entry.kind && e.id === entry.id
        && (Math.abs(entry.at - e.at) < REPEAT_WINDOW || (entry.offlineSince !== undefined && e.at >= entry.offlineSince)));
}

/** A stored history, newest first, without anything that isn't an entry. `text` is rebuilt, not stored. */
export function parseHistory(raw: unknown, limit = CAP): RelationshipNotification[] {
    if (!Array.isArray(raw)) return [];
    const entries: RelationshipNotification[] = [];
    for (const item of raw) {
        if (!isRecord(item) || !KINDS.includes(item.kind) || typeof item.id !== "string" || typeof item.name !== "string" || !Number.isFinite(item.at)) continue;
        entries.push(notification({
            kind: item.kind,
            id: item.id,
            name: item.name,
            username: typeof item.username === "string" ? item.username : undefined,
            at: item.at,
            since: parseTime(item.since),
            offlineSince: parseTime(item.offlineSince),
        }));
    }
    return entries.sort((a, b) => b.at - a.at).slice(0, Math.max(1, limit));
}

/** What's stored: everything but the English text */
export const storedHistory = (entries: readonly RelationshipNotification[]) => entries.map(({ text: _text, ...rest }) => rest);

/** The history's filters: everything, or one kind */
export const FILTERS = ["all", ...KINDS] as const;
export type Filter = (typeof FILTERS)[number];

/** Whether an entry is of the filter's kind and its name, @username or id has the query in it */
export function matches(entry: RelationshipNotification, filter: Filter, query = "") {
    if (filter !== "all" && entry.kind !== filter) return false;
    const q = query.trim().toLowerCase();
    return !q || entry.id.includes(q) || entry.name.toLowerCase().includes(q) || !!entry.username?.toLowerCase().includes(q);
}

export const filterEntries = (entries: readonly RelationshipNotification[], filter: Filter, query = "") => entries.filter(e => matches(e, filter, query));

/** How many entries each filter shows */
export function countByFilter(entries: readonly RelationshipNotification[]) {
    const counts = Object.fromEntries(FILTERS.map(f => [f, 0])) as Record<Filter, number>;
    for (const entry of entries) {
        counts.all++;
        counts[entry.kind]++;
    }
    return counts;
}

export const PAGE_SIZE = 20;

/** One page of `list` (0-based, clamped into range), and how many pages there are (at least one) */
export function paginate<T>(list: readonly T[], page: number, size = PAGE_SIZE) {
    const pages = Math.max(1, Math.ceil(list.length / size));
    const current = Math.min(Math.max(Math.floor(page) || 0, 0), pages - 1);
    return { items: list.slice(current * size, (current + 1) * size), page: current, pages };
}

/** The history, newest first, capped */
export class NotificationLog {
    private items: readonly RelationshipNotification[];
    private readonly listeners = new Set<() => void>();

    constructor(private limit = CAP, initial: readonly RelationshipNotification[] = []) {
        this.items = initial.slice(0, Math.max(1, limit));
    }

    /** Adds an entry unless it repeats one already logged. Returns whether it was added. */
    add(entry: RelationshipNotification) {
        if (isRepeat(this.items, entry)) return false;
        this.items = [entry, ...this.items].slice(0, Math.max(1, this.limit));
        this.changed();
        return true;
    }

    /** Immutable: a new array after every change, so it works as a React snapshot */
    get entries() {
        return this.items;
    }

    clear() {
        if (!this.items.length) return;
        this.items = [];
        this.changed();
    }

    subscribe = (listener: () => void) => {
        this.listeners.add(listener);
        return () => void this.listeners.delete(listener);
    };

    private changed() {
        for (const listener of [...this.listeners]) {
            try {
                listener();
            } catch { }
        }
    }
}
