import { definePlugin, Dispatcher, findByProps, findStore, React } from "@evi/api";

import { createReplyTracker, filterAction, filterDmIds, filterVoiceStates, isHiddenUser, PATCHES, shouldHideMemberRow, shouldHideMessage, VOICE_FIELDS } from "./filter";
import type { HideOptions, Lookups, MessageLike, RelationshipLike } from "./filter";
import { t } from "./strings";

/**
 * Discord folds a blocked user's messages into a "N blocked messages" row. This drops them from the
 * channel's message stream instead, the list Discord builds from MessageStore before rendering, so
 * dividers, grouping and scroll anchoring are all computed without them (see PATCHES.stream).
 *
 * Typing indicators need nothing: Discord already leaves blocked and ignored users out of them.
 * Reply previews need nothing either while "Hide replies" is off: Discord shows "Blocked message"
 * (or "Ignored message") in place of the quote by itself.
 *
 * Beyond messages (from Lodestone's Erase Blocked Users): their reactions and Mentions-inbox entries
 * are dropped at Discord's dispatcher; with "voice" on, so are their voice states, speaking and
 * soundboard, so call tiles and join sounds never appear; their audio can be muted locally; and DMs
 * with them can leave the DM list. Everything comes back when they're unblocked or this is off.
 *
 * Patched code keeps calling $self after the plugin is turned off until Discord reloads, so every
 * helper does nothing while the plugin isn't running.
 */

const settings = {
    active: {
        type: "boolean",
        get label() { return t("settings.active"); },
        get description() { return t("settings.active.description"); },
        default: true,
    },
    ignored: {
        type: "boolean",
        get label() { return t("settings.ignored"); },
        get description() { return t("settings.ignored.description"); },
        default: true,
    },
    replies: {
        type: "boolean",
        get label() { return t("settings.replies"); },
        get description() { return t("settings.replies.description"); },
        default: false,
    },
    memberList: {
        type: "boolean",
        get label() { return t("settings.memberList"); },
        get description() { return t("settings.memberList.description"); },
        default: true,
    },
    voice: {
        type: "boolean",
        get label() { return t("settings.voice"); },
        get description() { return t("settings.voice.description"); },
        default: false,
    },
    mute: {
        type: "boolean",
        get label() { return t("settings.mute"); },
        get description() { return t("settings.mute.description"); },
        default: true,
    },
    dms: {
        type: "boolean",
        get label() { return t("settings.dms"); },
        get description() { return t("settings.dms.description"); },
        default: true,
    },
} as const;

let options: HideOptions & { memberList: boolean; voice: boolean; mute: boolean; dms: boolean; } | undefined;
interface Listenable {
    addChangeListener?(listener: () => void): void;
    removeChangeListener?(listener: () => void): void;
}
let relationships: RelationshipLike & Listenable | undefined;
let referencedStore: Listenable & { getMessageByReference?(ref: unknown): { message?: MessageLike | null; } | undefined; } | undefined;

const replies = createReplyTracker(ref => referencedStore?.getMessageByReference?.(ref));

const lookups: Lookups = {
    get relationships() {
        return relationships;
    },
    referenced: replies.referenced,
};

/** Bumped whenever what's hidden may have changed; patched components re-render on it */
let version = 0;
const listeners = new Set<() => void>();
function bump() {
    version++;
    listeners.forEach(l => l());
}
function subscribe(cb: () => void) {
    listeners.add(cb);
    return () => void listeners.delete(cb);
}

function useVersion() {
    return React.useSyncExternalStore(subscribe, () => version);
}

const hidden = (userId: string | undefined) => !!options && isHiddenUser(userId, relationships, options);

/** Marks events this plugin dispatches itself, so its own filter lets them through */
const OWN = Symbol("hide-blocked");
const AUDIO_CONTEXTS = ["default", "stream"];
const DM = 1;

/** userId to the voice state Discord would have shown, so they can be put back */
const hiddenVoice = new Map<string, Record<string, unknown>>();

function dispatchOwn(action: Record<string, unknown>) {
    try {
        void Promise.resolve(Dispatcher.dispatch({ ...action, [OWN]: true } as any)).catch(() => { });
    } catch { }
}

let voiceStore: any, channelStore: any, mediaEngine: any, audioActions: any, dmSort: any;
let saveMuted: ((ids: string[]) => void) | undefined;
let mutedByUs: () => string[] = () => [];

/** Takes hidden users out of voice (call tiles), and puts back anyone shown again */
function reconcileVoice() {
    if (voiceStore == null) return;
    const on = !!options?.active && !!options.voice;
    const leaves: Record<string, unknown>[] = [];
    if (on) {
        for (const users of Object.values(voiceStore.getAllVoiceStates?.() ?? {}) as any[]) {
            for (const [userId, s] of Object.entries(users ?? {}) as [string, any][]) {
                if (!hidden(userId) || s?.channelId == null) continue;
                const state: Record<string, unknown> = { guildId: channelStore?.getChannel?.(s.channelId)?.guild_id ?? null };
                for (const k of VOICE_FIELDS) state[k] = s[k];
                state.userId = userId;
                hiddenVoice.set(userId, state);
                leaves.push({ ...state, channelId: null });
            }
        }
    }
    const returns: Record<string, unknown>[] = [];
    for (const [userId, state] of hiddenVoice) {
        if (on && hidden(userId)) continue;
        returns.push(state);
        hiddenVoice.delete(userId);
    }
    if (leaves.length) dispatchOwn({ type: "VOICE_STATE_UPDATES", voiceStates: leaves });
    if (returns.length) dispatchOwn({ type: "VOICE_STATE_UPDATES", voiceStates: returns });
}

/** Local mutes this plugin added are kept in a setting, so they're undone even after a restart */
function reconcileAudio(off = false) {
    if (audioActions?.toggleLocalMute == null || mediaEngine?.isLocalMute == null) return;
    const ids: string[] = [];
    try {
        ids.push(...relationships && (relationships as any).getBlockedIDs ? (relationships as any).getBlockedIDs() : []);
        if (options?.ignored) ids.push(...(relationships as any)?.getIgnoredIDs?.() ?? []);
    } catch { }
    const want = new Set(!off && options?.active && options.mute ? ids : []);
    const ours = new Set(mutedByUs());
    const before = [...ours].join();
    for (const id of want) {
        for (const c of AUDIO_CONTEXTS) {
            if (mediaEngine.isLocalMute(id, c)) continue;
            audioActions.toggleLocalMute(id, c);
            ours.add(`${id}:${c}`);
        }
    }
    for (const key of [...ours]) {
        const [id, c] = key.split(":");
        if (want.has(id)) continue;
        if (mediaEngine.isLocalMute(id, c)) audioActions.toggleLocalMute(id, c);
        ours.delete(key);
    }
    if ([...ours].join() !== before) saveMuted?.([...ours]);
}

function refreshDms() {
    try {
        dmSort?.emitChange?.();
    } catch { }
}

/**
 * The DM list asks for its ids on every render. Each answer is kept for the array Discord handed us
 * and the version it was worked out under, so the same question isn't filtered again
 */
let lastDmIn: unknown, lastDmVersion = -1, lastDmOut: readonly string[] | undefined;

/** Voice lists get a stable array per input and version, so Discord's memos downstream hold */
const voiceCache = new WeakMap<object, { version: number; out: readonly unknown[]; }>();

export default definePlugin({
    settings,

    patches: [PATCHES.stream, PATCHES.memberList, PATCHES.voiceUsers],

    /** Channel stream: skip this message? `collapse` is Discord's own grouping verdict for it */
    hide(message: MessageLike, collapse: unknown) {
        return !!options && shouldHideMessage(message, collapse, lookups, options);
    },

    useVersion,

    hideMember(row: unknown) {
        return !!options?.memberList && shouldHideMemberRow(row, relationships, options);
    },

    useVoiceStates<V extends { user?: { id?: string; } | null; }>(states: readonly V[]): readonly V[] {
        const v = useVersion();
        if (!options?.voice || !Array.isArray(states)) return states;
        const cached = voiceCache.get(states);
        if (cached?.version === v) return cached.out as readonly V[];
        const out = filterVoiceStates(states, relationships, options);
        voiceCache.set(states, { version: v, out });
        return out;
    },

    start(ctx) {
        relationships = findStore("RelationshipStore");
        referencedStore = findStore("ReferencedMessageStore");
        voiceStore = findStore("VoiceStateStore");
        channelStore = findStore("ChannelStore");
        mediaEngine = findStore("MediaEngineStore");
        dmSort = findStore("PrivateChannelSortStore");
        audioActions = findByProps("setLocalVolume", "toggleLocalMute", "toggleSelfDeaf");
        // Not a setting people see: a key outside the schema is stored, never shown
        const store = ctx.settings as unknown as { get(key: string): unknown; set(key: string, value: unknown): void; };
        mutedByUs = () => {
            const v = store.get("mutedByUs");
            return Array.isArray(v) ? v.filter((k): k is string => typeof k === "string") : [];
        };
        saveMuted = ids => store.set("mutedByUs", ids);
        options = { ...ctx.settings.all };

        const droppedReactions = new Set<string>();
        ctx.hook.instead(Dispatcher, "dispatch", call => {
            const action = call.args[0] as any;
            if (!options?.active || action == null || action[OWN]) return call.callOriginal(...call.args);
            let next = action;
            try {
                next = filterAction(action, hidden, options, (s, guildId) => {
                    if (s.userId == null) return;
                    if (s.channelId == null) hiddenVoice.delete(s.userId);
                    else hiddenVoice.set(s.userId, { ...s, guildId });
                }, droppedReactions);
            } catch (e) {
                ctx.logger.error("Filter failed for", action.type, e);
            }
            return next == null ? Promise.resolve() : call.callOriginal(next, ...call.args.slice(1));
        });

        if (dmSort) {
            ctx.hook.after(dmSort, "getPrivateChannelIds", ({ result }: { result: unknown; }) => {
                if (!options?.active || !options.dms || !Array.isArray(result)) return;
                if (result === lastDmIn && version === lastDmVersion) return lastDmOut === result ? undefined : lastDmOut;
                try {
                    const out = filterDmIds(result, id => {
                        const ch = channelStore?.getChannel?.(id);
                        return ch?.type === DM ? ch.getRecipientId?.() ?? ch.recipients?.[0] : undefined;
                    }, hidden);
                    lastDmIn = result;
                    lastDmVersion = version;
                    if (out === result) {
                        lastDmOut = result;
                        return;
                    }
                    // Same contents as last time: the same array, so nothing re-renders
                    if (lastDmOut?.length === out.length && out.every((id, i) => lastDmOut![i] === id)) return lastDmOut;
                    lastDmOut = out;
                    return out;
                } catch (e) {
                    ctx.logger.error("DM filter failed", e);
                }
            });
        }

        let pending: ReturnType<typeof setTimeout> | undefined;
        const reconcile = () => {
            clearTimeout(pending);
            pending = setTimeout(() => {
                reconcileVoice();
                reconcileAudio();
                refreshDms();
            }, 0);
        };
        if (!relationships) ctx.logger.warn("RelationshipStore not found, only Discord's own blocked flags are used");

        // Discord refreshes message records itself when someone is blocked, but the reply check and
        // the lists read the stores directly, so they rebuild on these
        const onRelationships = () => {
            if (options?.active) bump();
            reconcile();
        };
        // Only when a replied-to message the stream asked about changed, not for every message anywhere
        const onReferenced = () => void (options?.active && options.replies && replies.changed() && bump());
        relationships?.addChangeListener?.(onRelationships);
        referencedStore?.addChangeListener?.(onReferenced);

        ctx.settings.onChange(values => {
            options = { ...values };
            bump();
            reconcile();
        });

        ctx.command({
            name: "hideblocked",
            get description() { return t("command.description"); },
            execute() {
                const next = !ctx.settings.get("active");
                ctx.settings.set("active", next);
                return { ephemeral: next ? t("command.on") : t("command.off") };
            },
        });

        ctx.onDispose(() => {
            clearTimeout(pending);
            // Everything put back while the stores are still known
            const was = options;
            options = was && { ...was, active: false };
            reconcileVoice();
            reconcileAudio(true);
            refreshDms();
            hiddenVoice.clear();
            lastDmIn = lastDmOut = undefined;
            lastDmVersion = -1;
            voiceStore = channelStore = mediaEngine = audioActions = dmSort = undefined;
            saveMuted = undefined;
            relationships?.removeChangeListener?.(onRelationships);
            referencedStore?.removeChangeListener?.(onReferenced);
            options = undefined;
            relationships = undefined;
            referencedStore = undefined;
            replies.clear();
            bump();
        });
        bump();
        reconcile();
    },
});
