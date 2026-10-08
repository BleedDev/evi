/**
 * Smooth Chat: messages that arrive while a chat is open slide in instead of popping in.
 *
 * Discord's chat holds your place with an anchor message whose offset it freezes while you scroll,
 * and jumps back on any change to the chat's height (see Fast Lists). So nothing here may change
 * layout, ever:
 * - The motion is transform and opacity on the message inside its row, and the row clips it while it
 *   moves (`overflow: clip`, which unlike `hidden` changes nothing about layout or margins). A
 *   transformed element still counts towards the scroll height, so without the clip a message
 *   starting a few pixels low would grow the chat for a moment.
 * - Rows are picked by id before React renders them: on MESSAGE_CREATE we add a rule for
 *   `#chat-messages-<channel>-<message>` to our stylesheet, the row animates when it's inserted, and
 *   the rule goes away right after. No DOM is read or written, so history loads, channel switches,
 *   jumps and edits never animate: they aren't MESSAGE_CREATE.
 * - Only the chat on screen (and a thread open beside it) counts, so busy servers in the background
 *   don't rewrite the stylesheet.
 * - Your message shows twice to Discord: once as you send it (optimistic, its id is the nonce), again
 *   when Discord confirms it under its real id, which mounts a new row. Only the first one moves.
 *
 * Discord's Reduce Motion setting (`.reduce-motion` on <html>) and the system's both turn it off.
 * Smooth scrolling isn't offered: any animated scroll fights the chat's place-keeping.
 *
 * Row ids checked 2026-10-08: let l="chat-messages";function i(e,t){return`${l}-${e}-${t}`}
 */
import { definePlugin, filters, findStore } from "@evi/api";
import type { PluginContext } from "@evi/api";

import { t } from "./strings";

const settings = {
    others: {
        type: "boolean",
        get label() { return t("settings.others"); },
        get description() { return t("settings.others.description"); },
        default: true,
    },
    own: {
        type: "boolean",
        get label() { return t("settings.own"); },
        get description() { return t("settings.own.description"); },
        default: true,
    },
    speed: {
        type: "select",
        get label() { return t("settings.speed"); },
        get description() { return t("settings.speed.description"); },
        default: "subtle",
        options: [
            { get label() { return t("settings.speed.subtle"); }, value: "subtle" },
            { get label() { return t("settings.speed.normal"); }, value: "normal" },
        ],
    },
} as const;

const MOTION = {
    subtle: { ms: 180, px: 6 },
    normal: { ms: 240, px: 12 },
};
/** How long a row's rule waits for React to render the row, on top of the animation */
const RENDER_GRACE_MS = 500;
/** How many sent messages to remember, to skip Discord's confirmed copy of each */
const SENT_MEMORY = 50;

const KEYFRAMES = "evi-smooth-chat-in";

const baseCss = `
@keyframes ${KEYFRAMES} {
    from { opacity: 0; transform: translateY(var(--evi-smooth-chat-y, 6px)); }
}
`;

let context: PluginContext<typeof settings> | undefined;
let selected: any;
let sections: any;
let rules: { update(css: string): void; } | undefined;
/** Row id -> when its rule can go */
const pending = new Map<string, number>();
/** Ids of messages sent from here, in the order they were sent */
const sent: string[] = [];
let cleanup: ReturnType<typeof setTimeout> | undefined;

function motion() {
    return MOTION[context?.settings.get("speed") === "normal" ? "normal" : "subtle"];
}

/** The chat on screen, and the thread or channel open in the sidebar beside it */
function onScreen(channelId: string) {
    const current = selected?.getChannelId?.();
    if (channelId === current) return true;
    return current != null && channelId === sections?.getCurrentSidebarChannelId?.(current);
}

function render() {
    if (!rules) return;
    if (!pending.size) {
        rules.update("");
        return;
    }
    const { ms } = motion();
    const rows = [...pending.keys()].map(id => `#${CSS.escape(id)}`).join(", ");
    rules.update(`
@media (prefers-reduced-motion: no-preference) {
    :root:not(.reduce-motion) :is(${rows}) { overflow: clip; }
    :root:not(.reduce-motion) :is(${rows}) > * { animation: ${KEYFRAMES} ${ms}ms cubic-bezier(0.2, 0.8, 0.2, 1) backwards; }
}
`);
}

function sweep() {
    cleanup = undefined;
    const now = Date.now();
    for (const [id, until] of pending) if (until <= now) pending.delete(id);
    render();
    schedule();
}

function schedule() {
    if (cleanup || !pending.size) return;
    const next = Math.min(...pending.values());
    cleanup = setTimeout(sweep, Math.max(16, next - Date.now()));
}

function onMessage(action: any) {
    const { channelId, message } = action;
    if (action.isPushNotification || typeof channelId !== "string" || typeof message?.id !== "string") return;
    if (action.optimistic) {
        sent.push(message.id);
        if (sent.length > SENT_MEMORY) sent.shift();
        if (!context?.settings.get("own")) return;
    } else {
        // Discord confirming a message sent from here: its row was already shown (and animated)
        if (message.nonce != null && sent.includes(String(message.nonce))) return;
        if (!context?.settings.get("others")) return;
    }
    if (!onScreen(channelId)) return;
    pending.set(`chat-messages-${channelId}-${message.id}`, Date.now() + motion().ms + RENDER_GRACE_MS);
    render();
    schedule();
}

function applyMotion() {
    document.documentElement.style.setProperty("--evi-smooth-chat-y", `${motion().px}px`);
}

function withStore(ctx: PluginContext<typeof settings>, name: string, callback: (store: any) => void) {
    const found = findStore(name);
    if (found) callback(found);
    else ctx.waitFor(filters.byStoreName(name), callback);
}

export default definePlugin({
    settings,

    start(ctx) {
        context = ctx;
        ctx.addStyle(baseCss);
        rules = ctx.addStyle("");
        applyMotion();
        ctx.settings.onChange(() => {
            applyMotion();
            render();
        });
        withStore(ctx, "SelectedChannelStore", s => void (selected = s));
        // Holds the sidebar's thread (or channel) for each channel
        ctx.waitFor(filters.byProps("getCurrentSidebarChannelId"), s => void (sections = s));
        ctx.flux.subscribe("MESSAGE_CREATE", onMessage);
    },

    stop() {
        clearTimeout(cleanup);
        cleanup = undefined;
        pending.clear();
        sent.length = 0;
        document.documentElement.style.removeProperty("--evi-smooth-chat-y");
        rules = undefined;
        selected = undefined;
        sections = undefined;
        context = undefined;
    },
});
