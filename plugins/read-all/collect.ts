/**
 * Which channels to ack, and in what batches. Pure: the stores come in as arguments, so tests can
 * pass plain objects.
 */

/** Discord's ReadStateTypes.CHANNEL */
export const CHANNEL_READ_STATE = 0;
/** /read-states/ack-bulk takes at most 100 read states per request */
export const BULK_ACK_LIMIT = 100;

export interface AckEntry {
    channelId: string;
    messageId: string | null;
    readStateType: number;
}

/** An entry plus the server it belongs to (null for DMs), for the result message */
export interface UnreadChannel extends AckEntry {
    guildId: string | null;
}

interface ChannelLike { id: string; }

export interface ReadStores {
    GuildStore: { getGuilds(): Record<string, unknown> | unknown[]; getGuildIds?(): string[]; };
    /** getChannels(guildId) => { SELECTABLE: [{ channel }], VOCAL: [{ channel }], ... } */
    GuildChannelStore: { getChannels(guildId: string): Record<string, unknown> | undefined; };
    ReadStateStore: {
        hasUnread(channelId: string): boolean;
        getMentionCount(channelId: string): number;
        lastMessageId(channelId: string): string | null | undefined;
    };
    /** getActiveJoinedThreadsForGuild(guildId) => { [parentId]: { [threadId]: { channel } } } */
    ActiveJoinedThreadsStore?: { getActiveJoinedThreadsForGuild(guildId: string): Record<string, Record<string, unknown>> | undefined; };
    ChannelStore?: { getSortedPrivateChannels?(): ChannelLike[]; };
    /** Per server: anything unread or mentioned, without going through each channel */
    GuildReadStateStore?: {
        hasUnread?(guildId: string): boolean;
        /** Counts muted channels too, like the per-channel check does */
        getGuildHasUnreadIgnoreMuted?(guildId: string): boolean;
        getMentionCount?(guildId: string): number;
    };
}

export interface CollectOptions {
    includeDms?: boolean;
    /**
     * Skip servers GuildReadStateStore says have nothing unread or mentioned. Much faster with many
     * servers; for the count only, since Discord may leave muted channels out of it.
     */
    skipReadGuilds?: boolean;
}

/** Whether a server may have something unread; true when the store can't tell */
export function guildMaybeUnread(store: ReadStores["GuildReadStateStore"], guildId: string): boolean {
    const unread = store?.getGuildHasUnreadIgnoreMuted?.(guildId) ?? store?.hasUnread?.(guildId);
    if (typeof unread !== "boolean") return true;
    return unread || (store?.getMentionCount?.(guildId) ?? 0) > 0;
}

function guildIds(store: ReadStores["GuildStore"]): string[] {
    const ids = store.getGuildIds?.();
    if (Array.isArray(ids)) return ids;
    const guilds = store.getGuilds();
    if (Array.isArray(guilds)) return guilds.map((g: any) => g?.id).filter((id): id is string => typeof id === "string");
    return Object.keys(guilds ?? {});
}

/** { channel } wrappers (GuildChannelStore, threads) or plain channels */
function channelOf(value: unknown): ChannelLike | undefined {
    const channel = (value as any)?.channel ?? value;
    return typeof channel?.id === "string" ? channel : undefined;
}

/** Every unread channel (or one with mentions) across servers, and DMs when asked */
export function collectUnread(stores: ReadStores, options: CollectOptions = {}): UnreadChannel[] {
    const steps = collectUnreadSteps(stores, options);
    for (; ;) {
        const step = steps.next();
        if (step.done) return step.value;
    }
}

/**
 * collectUnread one server at a time: it pauses after each server, so the count can be spread over
 * idle moments instead of blocking a frame with hundreds of servers. Returns the result when done.
 */
export function* collectUnreadSteps(stores: ReadStores, options: CollectOptions = {}): Generator<void, UnreadChannel[], void> {
    const { ReadStateStore: rs } = stores;
    const seen = new Set<string>();
    const out: UnreadChannel[] = [];

    const consider = (channel: ChannelLike | undefined, guildId: string | null) => {
        if (!channel || seen.has(channel.id)) return;
        seen.add(channel.id);
        if (!rs.hasUnread(channel.id) && !(rs.getMentionCount(channel.id) > 0)) return;
        out.push({ guildId, channelId: channel.id, messageId: rs.lastMessageId(channel.id) ?? null, readStateType: CHANNEL_READ_STATE });
    };

    const skip = options.skipReadGuilds && stores.GuildReadStateStore;
    for (const guildId of guildIds(stores.GuildStore)) {
        if (skip && !guildMaybeUnread(skip, guildId)) continue;
        const groups = stores.GuildChannelStore.getChannels(guildId) ?? {};
        for (const group of Object.values(groups)) {
            if (Array.isArray(group)) group.forEach(item => consider(channelOf(item), guildId));
        }
        const threads = stores.ActiveJoinedThreadsStore?.getActiveJoinedThreadsForGuild(guildId) ?? {};
        for (const byId of Object.values(threads)) {
            for (const thread of Object.values(byId ?? {})) consider(channelOf(thread), guildId);
        }
        yield;
    }

    if (options.includeDms) stores.ChannelStore?.getSortedPrivateChannels?.()?.forEach(channel => consider(channel, null));

    return out;
}

/** Splits into batches of at most `size` */
export function chunk<T>(items: readonly T[], size = BULK_ACK_LIMIT): T[][] {
    if (!(size >= 1)) throw new RangeError("chunk size must be at least 1");
    const out: T[][] = [];
    for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
    return out;
}

/** Just what BULK_ACK reads */
export const toAck = ({ channelId, messageId, readStateType }: AckEntry): AckEntry => ({ channelId, messageId, readStateType });

/** How many servers the entries span */
export const countGuilds = (entries: readonly UnreadChannel[]) => new Set(entries.map(e => e.guildId).filter(id => id != null)).size;

/** The plugin's `t` (strings.ts), passed in so this stays free of Discord */
export type SummaryText = (key: "summary.none" | "summary.channels" | "summary.servers" | "summary.done" | "summary.doneInServers", vars?: Record<string, string | number>) => string;

/** "Marked 12 channels in 3 servers as read", in Discord's language */
export function summary(count: number, guilds: number, t: SummaryText) {
    if (count === 0) return t("summary.none");
    const channels = t("summary.channels", { count });
    return guilds > 0 ? t("summary.doneInServers", { channels, servers: t("summary.servers", { count: guilds }) }) : t("summary.done", { channels });
}
