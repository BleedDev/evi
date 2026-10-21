import { Components, definePlugin, Dispatcher, findStore, Menu, React } from "@evi/api";
import type { PluginContext } from "@evi/api";

import { chunk, collectUnread, collectUnreadSteps, countGuilds, summary, toAck } from "./collect";
import type { ReadStores, UnreadChannel } from "./collect";
import { t } from "./strings";

/**
 * Marking read is Discord's own BULK_ACK action, the one "Mark as read" on a folder dispatches:
 * { type: "BULK_ACK", context: "APP", channels: [{ channelId, messageId, readStateType }] }.
 * ReadStateStore acks each channel locally, and in the "APP" context queues them for
 * POST /read-states/ack-bulk, which it sends 100 at a time, a second apart. We dispatch in batches
 * of 100 too, so one huge action never blocks a frame.
 *
 * The button comes from a source patch on the server list ("guildsnav"): its scroller renders
 * [home and DMs, separator, servers], and ours goes in right before the servers. It's a round icon
 * like the servers around it, and only shows while something is unread: the count is recomputed
 * once ReadStateStore has been quiet for 1.5 seconds and the browser is idle, so a burst of
 * messages costs one pass, not one each. That pass skips servers GuildReadStateStore says are read,
 * and goes a few servers per idle moment, so it never holds up a frame.
 */

type Settings = typeof settings;
const settings = {
    includeDms: {
        type: "boolean",
        get label() { return t("settings.includeDms"); },
        get description() { return t("settings.includeDms.description"); },
        default: false,
    },
    showButton: {
        type: "boolean",
        get label() { return t("settings.showButton"); },
        get description() { return t("settings.showButton.description"); },
        default: true,
    },
    contextMenu: {
        type: "boolean",
        get label() { return t("settings.contextMenu"); },
        get description() { return t("settings.contextMenu.description"); },
        default: true,
    },
} as const;

let context: PluginContext<Settings> | undefined;

/** Discord's stores, found once all the required ones are there */
let cachedStores: ReadStores | undefined;

function stores(): ReadStores | undefined {
    if (cachedStores) return cachedStores;
    const GuildStore = findStore("GuildStore");
    const GuildChannelStore = findStore("GuildChannelStore");
    const ReadStateStore = findStore("ReadStateStore");
    if (!GuildStore || !GuildChannelStore || !ReadStateStore) return;
    return cachedStores = {
        GuildStore,
        GuildChannelStore,
        ReadStateStore,
        ActiveJoinedThreadsStore: findStore("ActiveJoinedThreadsStore"),
        ChannelStore: findStore("ChannelStore"),
        GuildReadStateStore: findStore("GuildReadStateStore"),
    };
}

/** Marks everything read and returns what to tell the user */
async function readAll(): Promise<{ message: string; ok: boolean; }> {
    const s = stores();
    if (!s) return { message: t("error.stores"), ok: false };

    const unread = collectUnread(s, { includeDms: context?.settings.get("includeDms") ?? false });
    for (const batch of chunk(unread.map(toAck))) {
        await Dispatcher.dispatch({ type: "BULK_ACK", context: "APP", channels: batch });
    }
    return { message: summary(unread.length, countGuilds(unread), t), ok: true };
}

let busy = false;
async function readAllWithToast() {
    if (busy) return;
    busy = true;
    try {
        const { message, ok } = await readAll();
        context?.toast(message, { type: ok ? "success" : "failure" });
    } catch (err) {
        context?.logger.error("Marking all as read failed", err);
        context?.toast(t("error.failed"), { type: "failure" });
    } finally {
        busy = false;
    }
}

/** Unread channels right now, kept up to date while the plugin runs */
let unreadCount = 0;
/** The "Server list button" setting, kept here so the button doesn't redraw on every settings write */
let showButton = true;
const listeners = new Set<() => void>();
let recountTimer: ReturnType<typeof setTimeout> | undefined;
let cancelIdle: (() => void) | undefined;
/** A count in progress, spread over idle moments, and whether the stores changed since it began */
let counting: Generator<void, UnreadChannel[], void> | undefined;
let countAgain = false;
/** Longest a count runs before waiting for the next idle moment */
const SLICE_MS = 5;

const notify = () => listeners.forEach(l => l());

function setUnreadCount(next: number) {
    if (next === unreadCount) return;
    unreadCount = next;
    notify();
}

/**
 * Servers Discord says have nothing unread are skipped: only the rest have their channels counted.
 * Runs a few servers per idle moment, so hundreds of unread servers never hold up a frame.
 */
function recount(deadline?: IdleDeadline) {
    cancelIdle = undefined;
    const s = stores();
    if (!s || !context) {
        counting = undefined;
        return setUnreadCount(0);
    }
    counting ??= collectUnreadSteps(s, { includeDms: context.settings.get("includeDms"), skipReadGuilds: true });
    const until = performance.now() + Math.min(SLICE_MS, Math.max(1, deadline?.timeRemaining?.() ?? SLICE_MS));
    for (; ;) {
        const step = counting.next();
        if (step.done) {
            counting = undefined;
            setUnreadCount(step.value.length);
            // Something changed while counting: servers counted early may be out of date
            if (countAgain) {
                countAgain = false;
                cancelIdle = whenIdle(recount);
            }
            return;
        }
        if (performance.now() >= until) break;
    }
    cancelIdle = whenIdle(recount);
}

/**
 * ReadStateStore changes on every message anywhere, so the count waits for a quiet moment: 1.5s
 * after the last change (but no more than 5s after the first), then for the browser to be idle
 */
const RECOUNT_AFTER = 1500;
const RECOUNT_WITHIN = 5000;
let firstChange = 0;

function whenIdle(fn: (deadline?: IdleDeadline) => void): () => void {
    if (typeof requestIdleCallback === "function") {
        const handle = requestIdleCallback(fn, { timeout: 1000 });
        return () => cancelIdleCallback(handle);
    }
    const handle = setTimeout(() => fn(), 0);
    return () => clearTimeout(handle);
}

function scheduleRecount() {
    const now = performance.now();
    if (recountTimer === undefined) firstChange = now;
    // Changing all the time (a busy server): let the pending one run
    else if (now - firstChange >= RECOUNT_WITHIN) return;
    clearTimeout(recountTimer);
    recountTimer = setTimeout(() => {
        recountTimer = undefined;
        if (counting) countAgain = true;
        cancelIdle ??= whenIdle(recount);
    }, RECOUNT_AFTER);
}

const subscribe = (cb: () => void) => {
    listeners.add(cb);
    return () => void listeners.delete(cb);
};

/** What the button shows: the unread count, or 0 when it's hidden. Only a change redraws it. */
function useButtonCount() {
    return React.useSyncExternalStore(subscribe, () => showButton ? unreadCount : 0);
}

const CheckIcon = () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M2 12.5l4.5 4.5L15 8.5M11.5 16l1 1L22 7.5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
);

function ReadAllButton() {
    const count = useButtonCount();
    if (count === 0) return null;

    const label = t("button.label", { count });
    const button = (
        <button type="button" className="dl-read-all-button" onClick={readAllWithToast} aria-label={label}>
            <CheckIcon />
        </button>
    );
    const Tooltip = Components.Tooltip;
    return (
        <div className="dl-read-all">
            {Tooltip ? <Tooltip text={label} position="right">{button}</Tooltip> : React.cloneElement(button, { title: label })}
        </div>
    );
}

export default definePlugin({
    settings,

    patches: [{
        find: "\"guildsnav\"",
        replace: {
            // children:[<Home .../>,<Separator/>,<Guilds guildDiscoveryButton=... />]: ours goes before the servers
            match: /(?<=lurkingGuildIds:\i\}\),\(0,\i\.jsx\)\(\i,\{\}\),)(?=\(0,\i\.jsx\)\(\i,\{guildDiscoveryButton:)/,
            with: "$self.renderButton(),",
        },
    }],

    /** Called by the patched server list */
    renderButton() {
        if (!context) return null;
        return <ReadAllButton key="evi-read-all" />;
    },

    readAll,

    css: `
        .dl-read-all { display: flex; justify-content: center; width: 100%; margin-bottom: 8px;
            animation: dl-read-all-in 0.2s ease-out; }
        .dl-read-all-button { display: flex; align-items: center; justify-content: center;
            width: var(--guildbar-avatar-size, 40px); height: var(--guildbar-avatar-size, 40px);
            padding: 0; border: 0; border-radius: 50%; cursor: pointer;
            color: var(--status-positive, #23a55a); background: var(--background-surface-high, var(--background-secondary));
            transition: border-radius 0.15s ease-out, background-color 0.15s ease-out, color 0.15s ease-out; }
        .dl-read-all-button:hover { border-radius: 30%; color: var(--white, #fff); background: var(--status-positive, #23a55a); }
        .dl-read-all-button:active { transform: translateY(1px); }
        .dl-read-all-button:focus-visible { outline: 2px solid var(--focus-primary, #5865f2); outline-offset: 2px; }
        @keyframes dl-read-all-in { from { opacity: 0; transform: scale(0.8); } }
        @media (prefers-reduced-motion: reduce) { .dl-read-all, .dl-read-all-button { animation: none; transition: none; } }
    `,

    start(ctx) {
        context = ctx;
        ctx.onDispose(() => {
            context = undefined;
            clearTimeout(recountTimer);
            recountTimer = undefined;
            cancelIdle?.();
            cancelIdle = undefined;
            counting = undefined;
            countAgain = false;
            cachedStores = undefined;
            unreadCount = 0;
            notify();
        });

        // ReadStateStore changes on every new message and ack; GuildStore on joining or leaving
        const watched = ["ReadStateStore", "GuildStore"].map(name => findStore(name)).filter(Boolean);
        for (const store of watched) store.addChangeListener?.(scheduleRecount);
        ctx.onDispose(() => watched.forEach(store => store.removeChangeListener?.(scheduleRecount)));
        showButton = ctx.settings.get("showButton");
        ctx.settings.onChange(values => {
            if (values.showButton !== showButton) {
                showButton = values.showButton;
                notify();
            }
            scheduleRecount();
        });
        // The first count waits for an idle moment too: Discord is busy starting up
        cancelIdle = whenIdle(recount);

        ctx.command({
            name: "readall",
            get description() { return t("command.description"); },
            async execute() {
                const { message } = await readAll();
                return { ephemeral: message };
            },
        });

        ctx.contextMenu("guild-context", (children, props) => {
            if (!ctx.settings.get("contextMenu") || !props.guild?.id || unreadCount === 0) return;
            children.push(
                <Menu.Group key="dl-read-all">
                    <Menu.Item id="dl-read-all" label={t("menu.markAll")} action={readAllWithToast} />
                </Menu.Group>,
            );
        });
    },
});
