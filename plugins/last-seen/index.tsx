/**
 * When someone was last online, last active and last sent a message, as far as this client has seen.
 *
 * - Presence: PRESENCE_UPDATES names who changed; once the dispatch settles, PresenceStore's
 *   combined status says whether they're online (online/idle/dnd) or went offline. Going offline
 *   stamps "last seen". On start and on reconnect everyone online in PresenceStore is seeded, and
 *   anyone we had online who isn't anymore is marked as gone. Someone online when Discord closed
 *   gets an approximate time ("in the last 3h").
 * - Activity: typing, joining or leaving voice and reacting stamp "last active".
 * - Messages: MESSAGE_CREATE stamps "last message" and where; LOAD_MESSAGES_SUCCESS (opening or
 *   scrolling a channel) backfills it from history.
 * - Presences and history are recorded when the browser is idle, never inside Discord's dispatch.
 * - Storage: IndexedDB (Discord removes window.localStorage), one record kept as columns (track.ts
 *   pack), written at most every 5 minutes, when Discord is hidden and on stop/unload. Capped at 25000 people, least
 *   recently seen dropped first (a few hundred at a time), friends and DM contacts last.
 * - Profiles: a clock badge through ctx.profileBadges, also listed in Discord's badge directory;
 *   hovering shows the full summary, clicking jumps to their last message.
 * - Member list, friends list, DM list: a line under offline people's names (source patches).
 *   Each line listens to its own person only (state.ts).
 */
import { definePlugin, React } from "@evi/api";
import type { ProfileBadge } from "@evi/api";

import { dmMethods, dmPatches } from "./dms";
import { friendsMethods, friendsPatches } from "./friends";
import { lastSeenLine, lineCss } from "./line";
import { SettingsPanel } from "./panel";
import {
    bumpNow, changed, fullText, ignored, invalidateKeep, isBot, isOnline, load, opts, refreshOwnId, resetLookups, save, settings, state, statusOf,
    store, tick, versionOf,
} from "./state";
import { isOnlineStatus, observeActivity, observeMessage, observePresence } from "./track";

const SAVE_EVERY = 5 * 60_000;

const MUTED = "#949ba4";
const CLOCK = `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="${MUTED}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9.5"/><path d="M12 6.5V12l3.5 2"/></svg>`,
)}`;

/**
 * Presence updates and message history are recorded off the dispatch, when the browser is idle:
 * opening a channel or a busy server shouldn't wait on bookkeeping. Updates that arrive meanwhile
 * are batched into one pass.
 */
const pendingPresences = new Map<string, boolean | undefined>();
let pendingPages: { messages: any[]; channelId?: string; }[] = [];
let cancelFlush: (() => void) | undefined;

/** At the latest this long after the dispatch, even if the browser never goes idle */
const IDLE_TIMEOUT = 1000;

function whenIdle(fn: (deadline?: IdleDeadline) => void): () => void {
    if (typeof requestIdleCallback === "function") {
        const handle = requestIdleCallback(fn, { timeout: IDLE_TIMEOUT });
        return () => cancelIdleCallback(handle);
    }
    const handle = setTimeout(fn, 50);
    return () => clearTimeout(handle);
}

const scheduleFlush = () => void (cancelFlush ??= whenIdle(flush));

/** Reads PresenceStore once the dispatch has settled, so it reflects the updates, then message history */
function flush(deadline?: IdleDeadline) {
    cancelFlush = undefined;
    if (!state.context) return;
    const now = Date.now();
    for (const [id, bot] of pendingPresences) {
        if (!ignored(id, bot) && observePresence(state.tracker, id, statusOf(id), now, opts)) changed(id);
    }
    pendingPresences.clear();
    // A page (50 messages) at a time, while the browser has time to spare
    while (pendingPages.length) {
        const page = pendingPages.shift()!;
        for (const msg of page.messages) {
            const id = message(msg, page.channelId);
            if (id) changed(id);
        }
        if (deadline && !deadline.didTimeout && deadline.timeRemaining() < 1) break;
    }
    if (pendingPages.length) scheduleFlush();
}

/** Everyone online right now counts as seen; anyone we had online who no longer is went offline */
function seed() {
    const statuses = store("PresenceStore")?.getState?.()?.statuses as Record<string, string> | undefined;
    const now = Date.now();
    let any = false;
    if (statuses) {
        // Once per connection, off the dispatch: worth asking UserStore, so online bots aren't all stored
        for (const id in statuses) {
            if (isOnlineStatus(statuses[id]) && !ignored(id, isBot(id))) any = observePresence(state.tracker, id, statuses[id], now, opts) || any;
        }
    }
    for (const [id, entry] of state.tracker) {
        if (entry.online && !isOnline(id)) any = observePresence(state.tracker, id, "offline", now, opts) || any;
    }
    if (any) changed();
}

/** Parses a message timestamp, never later than now */
function timeOf(timestamp: unknown) {
    const at = typeof timestamp === "string" ? Date.parse(timestamp) : NaN;
    return Number.isFinite(at) ? Math.min(at, Date.now()) : Date.now();
}

/** Records a message; returns the author's id if that changed anything */
function message(msg: any, channelId?: string): string | undefined {
    const author = msg?.author;
    if (!author?.id || msg.webhook_id || ignored(author.id, author.bot)) return;
    if (observeMessage(state.tracker, author.id, timeOf(msg.timestamp), { channelId: msg.channel_id ?? channelId, messageId: msg.id }, opts)) return author.id;
}

function activity(id: unknown, at = Date.now()) {
    if (typeof id !== "string" || ignored(id)) return;
    if (observeActivity(state.tracker, id, at, opts)) changed(id);
}

/** Clicking the profile clock jumps to their last message, when we know where it was */
function messageLink(userId: string): string | undefined {
    const entry = state.tracker.get(userId);
    if (!entry?.channelId || !entry.messageId) return;
    const channel = store("ChannelStore")?.getChannel?.(entry.channelId);
    if (!channel) return;
    return `https://discord.com/channels/${channel.guild_id ?? "@me"}/${entry.channelId}/${entry.messageId}`;
}

export default definePlugin({
    settings,

    patches: [
        {
            // The member row: subText:(0,r.jsx)(ed,{hideSubtext:U,activities:T,status:S,…,user:h,…})
            find: "hideSubtext:",
            replace: {
                match: /subText:(\(0,\i\.jsx\)\(\i,\{hideSubtext:\i,activities:\i,status:(\i),[^}]*?user:(\i)[^}]*\}\))/,
                with: "subText:$self.memberSubText($1,$3,$2)",
            },
        },
        ...friendsPatches,
        ...dmPatches,
    ],

    memberSubText(original: unknown, user: { id?: string; bot?: boolean; } | null | undefined, status: string | undefined) {
        if (!state.context || !user?.id || isOnlineStatus(status) || ignored(user.id, user.bot)) return original;
        const Line = lastSeenLine();
        return <>{original}<Line key="evi-last-seen" userId={user.id} setting="showInMemberList" /></>;
    },

    ...friendsMethods,
    ...dmMethods,

    flux: {
        PRESENCE_UPDATES(action: any) {
            if (!state.context) return;
            for (const u of action?.updates ?? []) {
                const id = u?.user?.id;
                if (typeof id === "string") pendingPresences.set(id, u.user.bot);
            }
            scheduleFlush();
        },
        MESSAGE_CREATE(action: any) {
            if (!state.context || action?.optimistic) return;
            const id = message(action?.message, action?.channelId);
            if (id) changed(id);
        },
        LOAD_MESSAGES_SUCCESS(action: any) {
            if (!state.context || !Array.isArray(action?.messages) || !action.messages.length) return;
            pendingPages.push({ messages: action.messages, channelId: action.channelId });
            scheduleFlush();
        },
        TYPING_START(action: any) {
            if (state.context) activity(action?.userId);
        },
        MESSAGE_REACTION_ADD(action: any) {
            if (state.context && !action?.optimistic) activity(action?.userId);
        },
        VOICE_STATE_UPDATES(action: any) {
            if (!state.context) return;
            for (const vs of action?.voiceStates ?? []) activity(vs?.userId);
        },
        CONNECTION_OPEN() {
            if (!state.context) return;
            refreshOwnId();
            invalidateKeep();
            // Walks every presence Discord has: once it has settled, when the browser is idle
            setTimeout(() => whenIdle(() => void (state.context && seed())), 1000);
        },
        // Who counts as a friend or DM contact, for pruning
        RELATIONSHIP_ADD: invalidateKeep,
        RELATIONSHIP_REMOVE: invalidateKeep,
        RELATIONSHIP_UPDATE: invalidateKeep,
        CHANNEL_CREATE: invalidateKeep,
        CHANNEL_DELETE: invalidateKeep,
    },

    start(ctx) {
        state.context = ctx;
        state.tracker = new Map();
        state.loaded = false;
        ctx.addStyle(lineCss);

        // What was seen while loading goes on top of the saved data
        void load(ctx, () => {
            seed();
            state.dirty = true;
            bumpNow();
        });

        // Packing everyone takes a few frames' worth of time: do it when Discord has nothing else to do
        ctx.setInterval(() => void (state.dirty && whenIdle(() => void save())), SAVE_EVERY);
        ctx.setInterval(tick, 60_000);
        const onUnload = () => void save();
        // Minimised or in the tray: a good moment to save, in case Discord is then closed without unload
        const onHide = () => void (document.visibilityState === "hidden" && state.dirty && whenIdle(() => void save()));
        window.addEventListener("beforeunload", onUnload);
        document.addEventListener("visibilitychange", onHide);
        ctx.onDispose(() => {
            window.removeEventListener("beforeunload", onUnload);
            document.removeEventListener("visibilitychange", onHide);
        });
        ctx.settings.onChange(bumpNow);

        // On profiles and in Discord's badge directory, through Evi's badges. Asked on every
        // profile render, so the badge is only rebuilt when their data, their status or the minute changes
        const badges = new Map<string, { key: string; badges: ProfileBadge[] | undefined; }>();
        ctx.profileBadges(userId => {
            if (!ctx.settings.get("showOnProfiles") || ignored(userId, isBot(userId))) return;
            const key = `${versionOf(userId)}:${statusOf(userId)}`;
            const cached = badges.get(userId);
            if (cached?.key === key) return cached.badges;
            const description = fullText(userId);
            const result = description ? [{ id: "last-seen", description, iconSrc: CLOCK, link: messageLink(userId) }] : undefined;
            if (badges.size >= 500) badges.clear();
            badges.set(userId, { key, badges: result });
            return result;
        });
    },

    stop() {
        void save();
        cancelFlush?.();
        cancelFlush = undefined;
        pendingPresences.clear();
        pendingPages = [];
        state.context = undefined;
        resetLookups();
        bumpNow();
    },

    settingsPanel: () => <SettingsPanel />,
});
