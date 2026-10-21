import type { SourcePatch } from "@evi/api";

/**
 * Pure logic for Hide Blocked Completely: which messages, members and voice users to hide, and the
 * source patches that ask. No Discord or Evi runtime imports, so tests can run all of it against
 * real snippets of Discord's code.
 */

/** Discord's collapsed-row types (the channel stream's item types for "N blocked messages" etc.) */
export const BLOCKED_GROUP = "MESSAGE_GROUP_BLOCKED";
export const IGNORED_GROUP = "MESSAGE_GROUP_IGNORED";

/** MessageTypes.REPLY. Forwards and thread starters also carry a messageReference, but aren't replies. */
export const REPLY_TYPE = 19;

export interface HideOptions {
    /** Master switch, flipped by /hideblocked */
    active: boolean;
    /** Treat ignored users like blocked ones */
    ignored: boolean;
    /** Also hide replies to a hidden user's message */
    replies: boolean;
}

export interface MessageLike {
    id?: string;
    type?: number;
    author?: { id?: string; } | null;
    blocked?: boolean;
    ignored?: boolean;
    messageReference?: { channel_id?: string; message_id?: string; type?: number; } | null;
}

/** The subset of Discord's RelationshipStore we read */
export interface RelationshipLike {
    isBlocked?(userId: string | undefined): boolean;
    isIgnored?(userId: string | undefined): boolean;
    isBlockedForMessage?(message: MessageLike): boolean;
    isIgnoredForMessage?(message: MessageLike): boolean;
}

export interface Lookups {
    relationships?: RelationshipLike;
    /** ReferencedMessageStore.getMessageByReference: `.message` is set once the replied-to message loaded */
    referenced?(reference: NonNullable<MessageLike["messageReference"]>): { message?: MessageLike | null; } | null | undefined;
}

export type HiddenKind = "blocked" | "ignored";

function safe(fn: () => boolean | undefined) {
    try {
        return fn() === true;
    } catch {
        return false;
    }
}

/**
 * Whether a message's author is someone we hide. Discord keeps `blocked` / `ignored` on message
 * records in sync with RelationshipStore; the store is asked too in case a record is stale. Blocked
 * wins over ignored, like Discord's own grouping.
 */
export function hiddenKind(message: MessageLike | null | undefined, rel: RelationshipLike | undefined, options: Pick<HideOptions, "ignored">): HiddenKind | null {
    if (!message) return null;
    const authorId = message.author?.id;
    if (message.blocked || safe(() => rel?.isBlockedForMessage?.(message)) || (authorId != null && safe(() => rel?.isBlocked?.(authorId)))) return "blocked";
    if (!options.ignored) return null;
    if (message.ignored || safe(() => rel?.isIgnoredForMessage?.(message)) || (authorId != null && safe(() => rel?.isIgnored?.(authorId)))) return "ignored";
    return null;
}

/** Whether a user is someone we hide (member list, voice channels) */
export function isHiddenUser(userId: string | null | undefined, rel: RelationshipLike | undefined, options: Pick<HideOptions, "active" | "ignored">) {
    if (!options.active || userId == null) return false;
    return safe(() => rel?.isBlocked?.(userId)) || (options.ignored && safe(() => rel?.isIgnored?.(userId)));
}

/** A reply whose replied-to message is by someone we hide (only once that message has loaded) */
export function repliesToHidden(message: MessageLike, lookups: Lookups, options: Pick<HideOptions, "ignored">) {
    const ref = message.messageReference;
    if (message.type !== REPLY_TYPE || ref?.message_id == null || !lookups.referenced) return false;
    let target: MessageLike | null | undefined;
    try {
        target = lookups.referenced(ref)?.message;
    } catch {
        return false;
    }
    return hiddenKind(target, lookups.relationships, options) != null;
}

/**
 * The decision the patched channel stream asks for every message. `collapse` is what Discord's own
 * grouping returned for it (MESSAGE_GROUP_BLOCKED and friends, or null), so we hide exactly what
 * Discord would have folded into a "N blocked messages" row, and nothing it deliberately keeps.
 * Replies are only hidden when asked; otherwise they stay and Discord itself swaps the quote for
 * "Blocked message".
 */
export function shouldHideMessage(message: MessageLike | null | undefined, collapse: unknown, lookups: Lookups, options: HideOptions) {
    if (!options.active || !message) return false;
    if (collapse === BLOCKED_GROUP) return true;
    if (collapse === IGNORED_GROUP && options.ignored) return true;
    return options.replies && repliesToHidden(message, lookups, options);
}

type Reference = NonNullable<MessageLike["messageReference"]>;

/**
 * The replied-to messages the stream asked about, and what it got. ReferencedMessageStore changes
 * for messages anywhere, and each change used to rebuild the open channel's whole stream; now only
 * a change to a message the stream actually asked about (loaded, edited, deleted) does.
 */
export function createReplyTracker(read: NonNullable<Lookups["referenced"]>, max = 5000) {
    const asked = new Map<string, { ref: Reference; message: MessageLike | null | undefined; }>();
    const targetOf = (ref: Reference) => {
        try {
            return read(ref)?.message;
        } catch {
            return undefined;
        }
    };
    return {
        /** Lookups.referenced, remembering what it answered */
        referenced(ref: Reference) {
            const result = read(ref);
            if (asked.size >= max) asked.clear();
            asked.set(`${ref.channel_id}:${ref.message_id}`, { ref, message: result?.message });
            return result;
        },
        /** Whether any message asked about is different now */
        changed() {
            let changed = false;
            for (const entry of asked.values()) {
                const now = targetOf(entry.ref);
                if (now === entry.message) continue;
                entry.message = now;
                changed = true;
            }
            return changed;
        },
        clear: () => asked.clear(),
        get size() {
            return asked.size;
        },
    };
}

/** Reference semantics for the stream patch: the messages left once hidden ones are dropped */
export function filterMessages<M extends MessageLike>(messages: Iterable<M>, collapse: (message: M) => unknown, lookups: Lookups, options: HideOptions): M[] {
    const kept: M[] = [];
    for (const message of messages) if (!shouldHideMessage(message, collapse(message), lookups, options)) kept.push(message);
    return kept;
}

/** Member list rows: { type: "MEMBER", user } for members, groups and other rows are never hidden */
export function shouldHideMemberRow(row: unknown, rel: RelationshipLike | undefined, options: Pick<HideOptions, "active" | "ignored">) {
    if (row == null || typeof row !== "object") return false;
    const { type, user } = row as { type?: unknown; user?: { id?: string; }; };
    return type === "MEMBER" && isHiddenUser(user?.id, rel, options);
}

/** Voice channel users ({ user, nick, voiceState }). Returns the same array when nobody is hidden. */
export function filterVoiceStates<V extends { user?: { id?: string; } | null; }>(states: readonly V[], rel: RelationshipLike | undefined, options: Pick<HideOptions, "active" | "ignored">): readonly V[] {
    if (!options.active || !Array.isArray(states) || states.length === 0) return states;
    const kept = states.filter(s => !isHiddenUser(s?.user?.id, rel, options));
    return kept.length === states.length ? states : kept;
}

export const PATCHES = {
    /**
     * The channel's message stream (what the chat list renders: messages, date and unread dividers,
     * "N blocked messages" rows). Each message is skipped before anything is pushed for it, so no
     * date divider is left with nothing under it, the unread divider falls on the next message
     * shown, and messages around a hidden one group as if it was never there. Discord's grouping
     * function (captured from its own call further down) decides what counts as blocked.
     *
     * The memo that builds the stream also gets our version as a dependency (read through a hook,
     * always called), so toggling or changing settings rebuilds the open channel right away. The
     * dependency array is matched at any length: Discord adds and drops entries from it.
     */
    stream: {
        find: "\"416cc9_1\"",
        replace: [
            {
                match: /(\.forEach\((\i)=>\{var \i,\i;let \i,\i,\i;)(if\(\i&&\2\.isFirstMessageInForumPost\((\i)\)\)return;[^]{0,1500}?let \i=(\i)\(\4,\2,\i&&\i\);)/,
                with: "$1if($self?.hide?.($2,$5($4,$2,!1)))return;$3",
            },
            {
                match: /(\[(?:\i,)*\i)(\]\);return\{messages:\i,channelStream:\i,)/,
                with: "$1,$self?.useVersion?.()$2",
            },
        ],
    },
    /** Member list rows. The list keeps its fixed row slots, a hidden member's slot renders nothing. */
    memberList: {
        find: "getFirstApplicationIdOccurrences",
        replace: {
            match: /(renderRow=(\i)=>\{let\{section:\i,row:\i,rowIndex:\i\}=\2,\{channel:\i\}=this\.props,(\i)=this\.getRowProps\(\2\);)/,
            with: "$1if($self?.hideMember?.($3))return null;",
        },
    },
    /** The users listed under a voice channel in the channel list */
    voiceUsers: {
        find: "\"ConnectedVoiceUser\"",
        replace: {
            match: /(collapsedMax:\i=6,[^]{0,200}?=\(0,\i\.\i\)\(\i\.id,)(\i\?\?\i)\)/,
            with: "$1($self?.useVoiceStates?.($2)??$2))",
        },
    },
} satisfies Record<string, SourcePatch>;

// Everything else they'd leave behind (from Lodestone's Erase Blocked Users)

/** What a voice state needs to put a user back in a channel (VOICE_STATE_UPDATES' fields) */
export const VOICE_FIELDS = ["channelId", "deaf", "mute", "requestToSpeakTimestamp", "selfDeaf", "selfMute", "selfStream",
    "selfVideo", "sessionId", "suppress", "userId", "discoverable", "connectedAt"] as const;

export interface ExtraOptions extends HideOptions {
    /** Leave them out of voice: channel rows, call tiles, speaking rings, join sounds and soundboard */
    voice: boolean;
}

interface VoiceStateLike { userId?: string; channelId?: string | null; guildId?: string | null; }

/**
 * Discord's events, before any store sees them: returns the event unchanged, a copy without what's
 * hidden, or null to drop it. `hidden` says whether a user is someone we hide; `onHiddenVoice` hears
 * each voice state dropped, so it can be put back when they're shown again.
 */
export function filterAction(action: any, hidden: (userId: string | undefined) => boolean, options: ExtraOptions, onHiddenVoice?: (state: VoiceStateLike, guildId: string | null) => void): any {
    if (!options.active || action == null || typeof action !== "object") return action;
    switch (action.type) {
        case "MESSAGE_REACTION_ADD":
            return hidden(action.userId) ? null : action;
        // The inbox's Mentions tab, loaded from Discord's servers
        case "LOAD_RECENT_MENTIONS_SUCCESS": {
            if (!Array.isArray(action.messages)) return action;
            const kept = action.messages.filter((m: any) => !hidden(m?.author?.id));
            return kept.length === action.messages.length ? action : { ...action, messages: kept };
        }
        case "VOICE_STATE_UPDATES":
        case "PASSIVE_UPDATE_V2": {
            const states = action.voiceStates;
            if (!options.voice || !Array.isArray(states)) return action;
            let kept: VoiceStateLike[] | null = null;
            states.forEach((s: VoiceStateLike, i: number) => {
                if (!hidden(s?.userId)) return void kept?.push(s);
                onHiddenVoice?.(s, action.guildId ?? s.guildId ?? null);
                kept ??= states.slice(0, i);
            });
            return kept == null ? action : { ...action, voiceStates: kept };
        }
        case "SPEAKING":
        case "VOICE_CHANNEL_EFFECT_SEND":
            return options.voice && hidden(action.userId) ? null : action;
        default:
            return action;
    }
}

/** DM list ids without DMs with someone hidden. Same array back when nothing is left out */
export function filterDmIds(ids: readonly string[], recipientOf: (channelId: string) => string | undefined, hidden: (userId: string | undefined) => boolean): readonly string[] {
    const out = ids.filter(id => !hidden(recipientOf(id)));
    return out.length === ids.length ? ids : out;
}
