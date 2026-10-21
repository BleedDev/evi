/**
 * Search Highlight: jump to a search result and the words you searched for light up in it.
 *
 * - The search: Discord's search actions (fetchMessages, fetchTabMessages) are given the search box's
 *   text as `searchQueryString`, and hand the parsed query to `onFetchStart`. We read the parsed
 *   query's `content` (Discord already took the filters out, in any language) and fall back to
 *   our own parsing of the raw text. Checked 2026-10-02:
 *       fetchMessages:function(e){let{searchContext:t,searchQueryString:n,...,onFetchStart:c,...}=e
 * - The jump: the message actions' jumpToMessage({ channelId, messageId, ... }). A jump while a
 *   search is open is a jump to a result.
 * - The highlight: the CSS Custom Highlight API. It paints ranges of text without touching the
 *   page, so React never finds nodes it didn't make. Message text is in #message-content-<id>.
 *   Code, links, mentions, emoji and spoilers are skipped.
 * - Closing the search (or clearing it) takes the highlights away.
 */
import { definePlugin, filters } from "@evi/api";
import type { PluginContext } from "@evi/api";

import { findMatches, locate, matcher, parseQuery } from "./highlight";
import type { Term } from "./highlight";
import { t } from "./strings";

const settings = {
    scope: {
        type: "select",
        get label() { return t("settings.scope"); },
        get description() { return t("settings.scope.description"); },
        default: "jumped",
        options: [
            { get label() { return t("settings.scope.jumped"); }, value: "jumped" },
            { get label() { return t("settings.scope.all"); }, value: "all" },
        ],
    },
    duration: {
        type: "select",
        get label() { return t("settings.duration"); },
        get description() { return t("settings.duration.description"); },
        default: "fade",
        options: [
            { get label() { return t("settings.duration.fade"); }, value: "fade" },
            { get label() { return t("settings.duration.stay"); }, value: "stay" },
        ],
    },
} as const;

/** How long the jumped-to message stays lit before fading, and how long the fade takes */
const HOLD_MS = 4000;
const FADE_MS = 600;
/** Highlight names, styled with ::highlight() */
const JUMP = "evi-search-jump";
const ALL = "evi-search-all";
/** Where the words aren't searchable text, or aren't text Discord's search matched */
const MESSAGE = "[id^='message-content-']";
const SKIP = "code, pre, a, [class*='mention'], [class*='emoji'], [class*='spoilerContent'], [class*='timestamp'], [role='button'], img, svg";

const searchActions = filters.byProps("fetchTabMessages", "clearSearchMessages");
const messageActions = filters.byProps("jumpToMessage", "trackJump");

let context: PluginContext<typeof settings> | undefined;
let terms: Term[] = [];
let regex: RegExp | undefined;
let jump: { messageId: string; } | undefined;
let observer: MutationObserver | undefined;
let frame = 0;
let fadeTimer: ReturnType<typeof setTimeout> | undefined;
let fadeFrame = 0;

const supported = () => typeof CSS !== "undefined" && "highlights" in CSS && typeof Highlight === "function";

function setTerms(next: Term[]) {
    terms = next;
    regex = matcher(terms);
    if (!terms.length) jump = undefined;
    watch();
    schedule();
}

/** The query Discord parsed for this search, or its text when it didn't give us one */
function termsFrom(query: any, raw: unknown) {
    const content = query?.content;
    const text = Array.isArray(content) ? content.join(" ") : typeof content === "string" ? content : undefined;
    return parseQuery(text ?? (typeof raw === "string" ? raw : ""));
}

function onSearch({ args }: { args: any[]; }) {
    const opts = args[0];
    if (!opts || typeof opts !== "object") return;
    setTerms(parseQuery(typeof opts.searchQueryString === "string" ? opts.searchQueryString : ""));
    // Discord's own parse, with the filters out in whatever language they were typed
    const original = opts.onFetchStart;
    args[0] = {
        ...opts,
        onFetchStart(info: any) {
            try {
                const next = termsFrom(info?.searchQuery, info?.searchQueryString ?? opts.searchQueryString);
                if (next.length || !terms.length) setTerms(next);
            } catch (err) {
                context?.logger.error("Couldn't read the search", err);
            }
            return original?.(info);
        },
    };
}

function onJump({ args }: { args: any[]; }) {
    const messageId = args[0]?.messageId;
    if (!terms.length || typeof messageId !== "string") return;
    jump = { messageId };
    setFade(1);
    clearTimeout(fadeTimer);
    if (context?.settings.get("duration") === "fade") fadeTimer = setTimeout(fadeOut, HOLD_MS);
    schedule();
}

function clearSearch() {
    clearTimeout(fadeTimer);
    cancelAnimationFrame(fadeFrame);
    setTerms([]);
}

/**
 * The variable is on the root, so every change restyles the whole document: it's only written when
 * it changes, and the fade goes in 8 steps rather than one per frame
 */
let lastFade = 1;
const setFade = (v: number) => {
    if (v === lastFade) return;
    lastFade = v;
    document.documentElement.style.setProperty("--evi-search-fade", String(v));
};

function fadeOut() {
    const start = performance.now();
    const step = (now: number) => {
        const p = Math.min(1, (now - start) / FADE_MS);
        setFade(Math.round((1 - p) * 8) / 8);
        if (p < 1) fadeFrame = requestAnimationFrame(step);
        else {
            jump = undefined;
            setFade(1);
            schedule();
        }
    };
    fadeFrame = requestAnimationFrame(step);
}

/** The searchable text nodes of a message, in order */
function textNodes(root: Element): Text[] {
    const out: Text[] = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode: node => {
            const skip = node.parentElement?.closest(SKIP);
            return skip && root.contains(skip) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
        },
    });
    for (let n = walker.nextNode(); n; n = walker.nextNode()) out.push(n as Text);
    return out;
}

function rangesIn(root: Element): Range[] {
    const nodes = textNodes(root);
    if (!nodes.length) return [];
    const pieces = nodes.map(n => n.data);
    const matches = findMatches(pieces.join(""), regex);
    return locate(pieces, matches).map(({ start, end }) => {
        const r = new Range();
        r.setStart(nodes[start.piece], start.offset);
        r.setEnd(nodes[end.piece], end.offset);
        return r;
    });
}

function paint() {
    frame = 0;
    if (!supported()) return;
    const registry = CSS.highlights;
    if (!regex) {
        registry.delete(JUMP);
        registry.delete(ALL);
        return;
    }
    const jumped = jump ? document.querySelectorAll(`[id="message-content-${CSS.escape(jump.messageId)}"]`) : [];
    registry.set(JUMP, new Highlight(...[...jumped].flatMap(rangesIn)));
    if (context?.settings.get("scope") === "all") {
        const all = [...document.querySelectorAll(MESSAGE)].filter(el => !jump || el.id !== `message-content-${jump.messageId}`);
        registry.set(ALL, new Highlight(...all.flatMap(rangesIn)));
    } else registry.delete(ALL);
}

function schedule() {
    if (!frame) frame = requestAnimationFrame(paint);
}

/** Whether a DOM change can add or change message text: the rest of Discord changes all the time */
function touchesMessages(records: MutationRecord[]) {
    for (const r of records) {
        const target = r.target instanceof Element ? r.target : r.target.parentElement;
        if (target?.closest(MESSAGE)) return true;
        for (const node of r.addedNodes) {
            if (node instanceof Element && (node.matches(MESSAGE) || node.querySelector(MESSAGE))) return true;
        }
    }
    return false;
}

/** While a search is open, repaint when messages render, scroll in or change */
function watch() {
    if (terms.length && !observer) {
        observer = new MutationObserver(records => {
            if (!frame && touchesMessages(records)) schedule();
        });
        observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    } else if (!terms.length && observer) {
        observer.disconnect();
        observer = undefined;
    }
}

const css = `
::highlight(${JUMP}) {
    background-color: color-mix(in srgb, var(--text-warning, #f0b232) calc(45% * var(--evi-search-fade, 1)), transparent);
    color: inherit;
}
::highlight(${ALL}) {
    background-color: color-mix(in srgb, var(--text-warning, #f0b232) 22%, transparent);
    color: inherit;
}
`;

export default definePlugin({
    settings,

    start(ctx) {
        context = ctx;
        if (!supported()) {
            ctx.logger.warn("This Discord can't highlight text ranges (CSS Custom Highlight API missing)");
            return;
        }
        ctx.addStyle(css);
        // One lookup for both methods: each lookup walks Discord's modules
        ctx.waitFor(searchActions, actions => {
            for (const method of ["fetchMessages", "fetchTabMessages"]) {
                if (typeof actions[method] === "function") ctx.hook.before(actions, method, onSearch);
            }
        });
        ctx.hookExport("before", messageActions, "jumpToMessage", onJump);
        for (const type of ["SEARCH_MESSAGES_CLEAR", "SEARCH_MESSAGES_CLEAR_ALL", "SEARCH_RESULTS_CLOSE", "SEARCH_QUERY_TEXT_CLEAR"]) {
            ctx.flux.subscribe(type, clearSearch);
        }
        ctx.settings.onChange(schedule);
    },

    stop() {
        clearSearch();
        cancelAnimationFrame(frame);
        frame = 0;
        if (supported()) {
            CSS.highlights.delete(JUMP);
            CSS.highlights.delete(ALL);
        }
        document.documentElement.style.removeProperty("--evi-search-fade");
        // Unset reads as 1
        lastFade = 1;
        context = undefined;
    },
});
