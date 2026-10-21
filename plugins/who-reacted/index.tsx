import { definePlugin, findStore, React } from "@evi/api";
import type { PluginContext } from "@evi/api";

import { t } from "./strings";

import { extraLabel, FetchQueue, pickReactors, PATCHES, REACTION_VOTE, reactionKey, shownCount } from "./reactors";
import type { ReactionEmoji } from "./reactors";

/**
 * Small avatars of who reacted, inside each reaction next to its count. A source patch calls
 * renderUsers with the pill's props; the avatars come from MessageReactionsStore, which asks Discord
 * for them the first time a reaction is looked up (see reactors.ts for why that goes through a queue).
 * They update live as people react, because the store does.
 */

type Settings = typeof settings;
const settings = {
    max: { type: "number", get label() { return t("settings.max"); }, get description() { return t("settings.max.description"); }, default: 5, min: 1, max: 10, step: 1 },
    showExtra: { type: "boolean", get label() { return t("settings.showExtra"); }, get description() { return t("settings.showExtra.description"); }, default: true },
} as const;

/** Asked of Discord's API per reaction: enough for the most avatars a reaction can show */
const FETCH_LIMIT = 10;
/** Between two of those requests, so a busy chat doesn't run into Discord's rate limit */
const FETCH_GAP_MS = 350;

let context: PluginContext<Settings> | undefined;
const queue = new FetchQueue(FETCH_GAP_MS);

function store(name: string): any {
    try {
        return findStore(name);
    } catch {
        return undefined;
    }
}

const reactionsStore = () => store("MessageReactionsStore");

/** Told when a queued lookup runs: a reaction Discord already knew about doesn't change the store */
const asked = new Set<() => void>();

function subscribe(onChange: () => void) {
    const s = reactionsStore();
    s?.addChangeListener?.(onChange);
    asked.add(onChange);
    return () => {
        s?.removeChangeListener?.(onChange);
        asked.delete(onChange);
    };
}

function isHidden(id: string) {
    const relationships = store("RelationshipStore");
    return !!(relationships?.isBlockedOrIgnored?.(id) ?? relationships?.isBlocked?.(id));
}

interface ReactionProps {
    message: { id: string; getChannelId(): string; };
    emoji: ReactionEmoji;
    type?: number;
    count?: number;
    burst_count?: number;
    hideCount?: boolean;
}

const noSettings = () => undefined;
const noSubscribe = () => () => { };

/**
 * The settings, or undefined once the plugin stopped. The patch stays in Discord's code, so avatars
 * already drawn still re-render when the store changes, without the pill calling renderUsers again.
 * Either way it's one useSyncExternalStore, so the hooks stay in the same order.
 */
const useSettings = () => context ? context.settings.use() : React.useSyncExternalStore(noSubscribe, noSettings);

function Reactors({ message, emoji, type = 0, count }: { message: ReactionProps["message"]; emoji: ReactionEmoji; type?: number; count: number; }) {
    const values = useSettings();
    const channelId = message.getChannelId();
    const key = reactionKey(message.id, emoji, type);

    // On screen: ask for who reacted, in turn. Scrolled away before its turn: never asked.
    React.useEffect(() => {
        if (!context) return;
        queue.add(key, () => {
            reactionsStore()?.getReactions?.(channelId, message.id, emoji, FETCH_LIMIT, type);
            for (const listener of asked) listener();
        });
        return () => queue.remove(key);
    }, [key]);

    // The store changes one Map in place, so the snapshot is the ids it holds, not the Map
    const ids = React.useSyncExternalStore(subscribe, () => {
        if (!queue.has(key)) return "";
        const users: Map<string, unknown> | undefined = reactionsStore()?.getReactions?.(channelId, message.id, emoji, FETCH_LIMIT, type);
        return users ? [...users.keys()].join(",") : "";
    });
    if (!values || !ids) return null;

    const { max, showExtra } = values;
    const users = ids.split(",").map(id => ({ id }));
    const { shown, extra } = pickReactors(users, count, max, isHidden);
    if (!shown.length) return null;

    const guildId = store("ChannelStore")?.getChannel?.(channelId)?.getGuildId?.();
    const userStore = store("UserStore");
    return (
        <span className="evi-who-reacted" aria-hidden="true">
            {shown.map(({ id }) => {
                const src = userStore?.getUser?.(id)?.getAvatarURL?.(guildId ?? undefined, 32);
                return src ? <img key={id} className="evi-who-reacted-avatar" src={src} alt="" draggable={false} /> : null;
            })}
            {showExtra && extra > 0 && <span className="evi-who-reacted-extra">{extraLabel(extra)}</span>}
        </span>
    );
}

export default definePlugin({
    settings,

    patches: [PATCHES.pill],

    /** Called by the patched reaction pill with its props, right after the count */
    renderUsers(props: ReactionProps) {
        try {
            if (!context || !props?.message?.id || !props.emoji || props.hideCount || props.type === REACTION_VOTE) return null;
            const count = shownCount(props);
            if (!count) return null;
            return <Reactors message={props.message} emoji={props.emoji} type={props.type} count={count} />;
        } catch (err) {
            context?.logger.error("Couldn't draw who reacted", err);
            return null;
        }
    },

    css: `
        .evi-who-reacted { display: inline-flex; align-items: center; margin-inline-start: 6px; pointer-events: none; }
        .evi-who-reacted-avatar { inline-size: 16px; block-size: 16px; border-radius: 50%; object-fit: cover;
            box-shadow: 0 0 0 1.5px var(--background-base-lower, var(--background-primary, #1e1f22)); }
        .evi-who-reacted-avatar + .evi-who-reacted-avatar { margin-inline-start: -4px; }
        .evi-who-reacted-extra { margin-inline-start: 4px; color: var(--text-muted, #949ba4); font-size: 12px; font-weight: 600;
            font-variant-numeric: tabular-nums; }
    `,

    start(ctx) {
        context = ctx;
        ctx.onDispose(() => {
            context = undefined;
            queue.clear();
        });
    },
});
