import { definePlugin } from "@evi/api";
import { t } from "./strings";

/**
 * Makes Discord's long lists cheap to render, with no patches to Discord's code: it works on the
 * DOM through the `data-list-id` / `data-list-item-id` attributes all of Discord's keyboard-navigable
 * lists carry, so Discord updates can't silently break it.
 *
 * Rows far outside the visible area get `content-visibility: hidden`: the browser skips their
 * style, layout and paint, but keeps their rendered state (decoded images included) and their
 * size. They are never unmounted or emptied, so nothing flickers or disappears. We decide when a
 * row renders again, a generous distance before it can scroll into view; a jump bigger than that
 * reveals every row before the frame paints. We never touch the scroll position ourselves.
 *
 * A hidden row keeps the size it had when it was hidden, so it must never go stale: Discord's chat
 * holds your place with an anchor message whose offset it freezes while you scroll, and any change to
 * the chat's height mid-scroll makes it jump back to where the scroll began. So a hidden row that
 * changes (a reaction, an edit, an image or embed loading, a new width or font size) is revealed right
 * then, when it would have changed size without us, and hidden again with its new size.
 *
 * Measured on a 185-server account on a ~300Hz display: p95 frame gap 6.7ms -> 3.7ms (server list).
 * Measured and rejected: `contain: layout style` on every row made frames slower (p95 10ms).
 * Chat, 150 messages in headless Chrome: a relayout of the chat (window resize) 3.3-4ms -> 0.45ms.
 * The member list stays off by default: Discord's list already renders only a chunk or two around
 * the view, closer than our render distance, so there is never a far row to skip.
 *
 * Hidden rows are hidden from screen readers too, so while assistive technology is on (Evi marks the
 * page with data-evi-assistive) every list stands down and all rows render normally.
 *
 * The server list additionally has Discord's `translateZ(0)` hack on every unread pill removed
 * (flattened to the identical 2D transform): 132 compositor layers -> 39, animations unchanged.
 */

const ROW = "dl-fl-row";
const FAR = "dl-fl-far";

const css = `
.${ROW} {
    contain-intrinsic-size: auto 48px;
}
.${ROW}.${FAR} {
    content-visibility: hidden;
}
`;

interface ListKind {
    key: "servers" | "chat" | "members";
    list: string;
    /** Items of one list element, given its data-list-id */
    item: (listId: string) => string;
    flattenPills?: boolean;
}

const itemOf = (listId: string) => `[data-list-item-id^="${listId}___"]`;

const LISTS: ListKind[] = [
    { key: "servers", list: '[data-list-id="guildsnav"]', item: itemOf, flattenPills: true },
    { key: "chat", list: '[data-list-id^="chat-messages"]', item: itemOf },
    { key: "members", list: '[data-list-id^="members"]', item: itemOf },
];

function isScrollable(el: Element) {
    return /(auto|scroll)/.test(getComputedStyle(el).overflowY) && el.scrollHeight > el.clientHeight;
}

/** The first or last child that takes part in layout: not display: none, not taken out of the flow */
function edgeChild(el: Element, last: boolean) {
    const children = [...el.children];
    if (last) children.reverse();
    for (const child of children) {
        const cs = getComputedStyle(child);
        if (cs.display !== "none" && cs.position !== "absolute" && cs.position !== "fixed") return cs;
    }
    return null;
}

/**
 * Whether a child's vertical margin passes through el's top or bottom edge. Only a block (or list
 * item) that isn't its own formatting context lets margins through, and only across an edge with no
 * padding or border.
 */
function marginCollapsesThrough(el: Element) {
    const cs = getComputedStyle(el);
    if (cs.display !== "block" && cs.display !== "list-item") return false;
    if (cs.overflowY !== "visible" || cs.contain !== "none" || cs.float !== "none" || cs.position === "absolute" || cs.position === "fixed") return false;
    const top = parseFloat(cs.paddingTop) === 0 && parseFloat(cs.borderTopWidth) === 0 && parseFloat(edgeChild(el, false)?.marginTop ?? "0") !== 0;
    const bottom = parseFloat(cs.paddingBottom) === 0 && parseFloat(cs.borderBottomWidth) === 0 && parseFloat(edgeChild(el, true)?.marginBottom ?? "0") !== 0;
    return top || bottom;
}

/** How deep inside the list its scroller can be. Discord's sits a level or two in; deeper ones are code blocks and embeds. */
const SCROLLER_DEPTH = 4;

/**
 * The list's scroller: an ancestor, or failing that an element near the top of the list. Never
 * walks the whole list, which read the layout of thousands of elements and froze Discord for 100ms+.
 */
function findScroller(list: Element): HTMLElement | null {
    for (let el: Element | null = list; el; el = el.parentElement) {
        if (el instanceof HTMLElement && isScrollable(el)) return el;
    }
    let level: Element[] = [...list.children];
    for (let depth = 1; depth <= SCROLLER_DEPTH && level.length; depth++) {
        for (const el of level) {
            if (el instanceof HTMLElement && isScrollable(el)) return el;
        }
        level = level.flatMap(el => [...el.children]);
    }
    return null;
}

/**
 * Discord puts `translateZ(0)` on every server's unread pill, an old "force a GPU layer" hack.
 * With 185 servers that is 184 compositor layers, and every icon overlapping one gets promoted too.
 * The same transform in 2D looks identical, keeps every animation, and needs no layer. Rules are
 * found by what they do, not by Discord's hashed class names.
 *
 * That means reading every rule of Discord's stylesheets (tens of thousands), which took a third of
 * a second in one go. So it runs in idle time, a few milliseconds per slice, and the result is kept
 * for as long as the page has the same stylesheets: a re-rendered server list reuses it.
 */
const flatten = (value: string) => value
    .replace(/translate3d\(\s*([^,]+),\s*([^,]+),\s*0(?:px)?\s*\)/g, "translate($1, $2)")
    .replace(/\s*translateZ\(\s*0(?:px)?\s*\)/g, "")
    .trim() || "none";

const LAYER_HACK = /translateZ\(\s*0|translate3d\([^)]*,\s*0(?:px)?\s*\)/;

/** Idle time used per slice: long enough to get through a few thousand rules, short enough to never drop a frame */
const SLICE_MS = 4;

let flattened: { sheets: number; css: string; } | undefined;

/**
 * Works out the flattening rules for the server list at `root` in idle slices, then calls `done`
 * with them. Returns a function that cancels it.
 */
function flattenRules(root: Element, done: (css: string) => void): () => void {
    const sheetCount = document.styleSheets.length;
    if (flattened?.sheets === sheetCount) {
        done(flattened.css);
        return () => { };
    }

    const css: string[] = [];
    const sheets = [...document.styleSheets];
    // Rule lists still to read, innermost last
    const stack: { rules: CSSRuleList; next: number; }[] = [];

    /** Returns true when the rule is a group whose rules are to be read next, in source order */
    const visit = (rule: CSSRule) => {
        if (rule instanceof CSSStyleRule) {
            const transform = rule.style.getPropertyValue("transform");
            if (!transform || !LAYER_HACK.test(transform)) return false;
            let applies = false;
            try {
                applies = root.querySelector(rule.selectorText) !== null;
            } catch { }
            if (!applies) return false;
            // Scoped to the server list and one step more specific, so it wins without !important
            const selector = rule.selectorText.split(",").map(part => `[data-list-id="guildsnav"] ${part.trim()}`).join(", ");
            css.push(`${selector} { transform: ${flatten(transform)}; }`);
        } else if ("cssRules" in rule) {
            stack.push({ rules: (rule as CSSGroupingRule).cssRules, next: 0 });
            return true;
        }
        return false;
    };

    /** Reads rules until the deadline; true once every sheet is read */
    const step = (deadline: number) => {
        while (performance.now() < deadline) {
            const top = stack[stack.length - 1];
            if (!top) {
                const sheet = sheets.shift();
                if (!sheet) return true;
                try {
                    stack.push({ rules: sheet.cssRules, next: 0 });
                } catch {
                    // Cross-origin sheets can't be read, Discord's own are same-origin
                }
                continue;
            }
            if (top.next >= top.rules.length) {
                stack.pop();
                continue;
            }
            // A few hundred rules between clock reads
            const end = Math.min(top.next + 200, top.rules.length);
            while (top.next < end && !visit(top.rules[top.next++]));
        }
        return false;
    };

    return inIdleSlices(step, () => {
        flattened = { sheets: sheetCount, css: css.join("\n") };
        done(flattened.css);
    });
}

/** Runs `step(deadline)` in idle slices of SLICE_MS until it returns true, then calls `finish`. Returns a cancel function. */
function inIdleSlices(step: (deadline: number) => boolean, finish: () => void): () => void {
    let cancelled = false;
    const schedule = (fn: () => void) => typeof requestIdleCallback === "function"
        ? requestIdleCallback(fn, { timeout: 1000 })
        : setTimeout(fn, 16);
    const run = () => {
        if (cancelled) return;
        if (step(performance.now() + SLICE_MS)) finish();
        else schedule(run);
    };
    schedule(run);
    return () => void (cancelled = true);
}

/**
 * Everything attached to one list element with one configuration. A new configuration or a
 * re-rendered list gets a new session; a disposed session can't be revived.
 */
function createSession(list: Element, kind: ListKind, marginScreens: number) {
    const itemSelector = kind.item(list.getAttribute("data-list-id")!);
    const scroller = findScroller(list);
    const rows = new Set<HTMLElement>();
    let disposed = false;
    let queued = false;

    /** Whether any of el's siblings is or contains an item. Usually answered by the first sibling. */
    const siblingHasItem = (el: Element) => {
        for (const sibling of el.parentElement!.children) {
            if (sibling !== el && (sibling.matches(itemSelector) || sibling.querySelector(itemSelector))) return true;
        }
        return false;
    };

    // Rows only change when Discord re-renders them, so work each item's row out once
    const rowCache = new WeakMap<Element, HTMLElement | null>();

    /** The outermost element around an item that contains no other item: one row, for servers and folder headers alike */
    const rowOf = (item: Element) => {
        const cached = rowCache.get(item);
        if (cached === null || (cached?.isConnected && cached.contains(item))) return cached;
        const row = computeRow(item);
        rowCache.set(item, row);
        return row;
    };

    const computeRow = (item: Element): HTMLElement | null => {
        let el = item as HTMLElement;
        while (el.parentElement && el.parentElement !== scroller && el.parentElement !== list && !siblingHasItem(el)) {
            el = el.parentElement;
        }
        // A hidden row keeps its size but its children's margins no longer collapse through it, so a
        // row they collapse through would shrink by that margin (Discord's chat: a message group's
        // 17px top margin through its <li>). The chat reads that as the layout moving and pulls the
        // view back. Take the child with the margin as the row instead, so the margin stays outside.
        while (marginCollapsesThrough(el) && el.children.length === 1) el = el.children[0] as HTMLElement;
        // Can't be hidden without changing the list's height: leave it rendered
        return marginCollapsesThrough(el) ? null : el;
    };

    // Read once: a layout read on every scroll event could force a reflow mid-scroll
    const margin = Math.round((scroller?.clientHeight ?? 800) * marginScreens);

    // Without a scroller (short list) there is nothing far away to skip.
    // We never write scrollTop: doing so to keep the view pinned fought fast scrolling and Discord
    // loading older messages, and could hold the chat in place. The browser's scroll anchoring
    // keeps the view stable when a revealed row turns out to have a different size.
    const visibility = scroller
        ? new IntersectionObserver(entries => {
            if (disposed) return;
            for (const entry of entries) {
                const row = entry.target as HTMLElement;
                if (rows.has(row)) row.classList.toggle(FAR, !entry.isIntersecting);
            }
        }, { root: scroller, rootMargin: `${margin}px 0px` })
        : undefined;

    /**
     * Brings the tracked rows in line with the list, in idle slices: working out hundreds of rows at
     * once (a channel switch, a re-rendered server list) was a long freeze. Nothing waits on it, rows
     * are fully rendered until we get to them.
     */
    let cancelSync: (() => void) | undefined;
    /** Rows changed while a sync was running: run once more after it, never restart it (a busy chat would starve it) */
    let again = false;
    let grew = false;
    const sync = () => {
        if (disposed) return;
        if (cancelSync) {
            again = true;
            return;
        }
        const items = [...list.querySelectorAll(itemSelector)];
        const current = new Set<HTMLElement>();
        let next = 0;
        cancelSync = inIdleSlices(deadline => {
            // A few dozen rows between clock reads
            while (next < items.length && performance.now() < deadline) {
                const end = Math.min(next + 50, items.length);
                for (; next < end; next++) {
                    const row = items[next].isConnected && rowOf(items[next]);
                    if (row) current.add(row);
                }
            }
            return next >= items.length;
        }, () => {
            cancelSync = undefined;
            if (disposed) return;
            for (const row of rows) {
                if (current.has(row)) continue;
                visibility?.unobserve(row);
                row.classList.remove(ROW, FAR);
                rows.delete(row);
            }
            for (const row of current) {
                if (rows.has(row)) continue;
                rows.add(row);
                row.classList.add(ROW);
                // Starts rendered; the observer's first callback hides it only if it really is far away
                visibility?.observe(row);
            }
            grew = true;
            if (again) {
                again = false;
                sync();
            }
        });
    };

    const queueSync = () => {
        if (queued) return;
        queued = true;
        requestAnimationFrame(() => {
            queued = false;
            sync();
        });
    };

    /** Rows revealed since the last frame, for the observer to look at again */
    const revealed = new Set<HTMLElement>();
    let reobserveQueued = false;
    /**
     * Renders hidden rows again. The observer only reports changes, so a row that is still far away
     * wouldn't be hidden again by itself: re-observing it after a frame gives it a fresh first report,
     * and by then the browser has remembered its new size.
     */
    const reveal = (targets: Iterable<HTMLElement>) => {
        for (const row of targets) {
            if (!row.classList.contains(FAR)) continue;
            row.classList.remove(FAR);
            revealed.add(row);
        }
        if (reobserveQueued || !revealed.size) return;
        reobserveQueued = true;
        requestAnimationFrame(() => {
            reobserveQueued = false;
            if (disposed || !visibility) return;
            for (const row of revealed) {
                if (!rows.has(row)) continue;
                visibility.unobserve(row);
                visibility.observe(row);
            }
            revealed.clear();
        });
    };

    /** The hidden row el is in, if any */
    const hiddenRowOf = (node: Node) => {
        const el = node instanceof Element ? node : node.parentElement;
        const row = el?.closest<HTMLElement>(`.${FAR}`);
        return row && rows.has(row) ? row : null;
    };

    /** A row's class without ours: what Discord set */
    const theirClasses = (value: string | null) => (value ?? "").split(/\s+/).filter(c => c && c !== ROW && c !== FAR).join(" ");

    // Lists mutate constantly (badges, typing, reactions): resync only when rows come or go, and reveal
    // only hidden rows that changed. Changes in rendered rows are Discord's business.
    const touchesRows = (nodes: NodeList) => {
        for (const node of nodes) {
            if (node instanceof Element && (node.matches(itemSelector) || node.querySelector(itemSelector))) return true;
        }
        return false;
    };
    const mutations = new MutationObserver(records => {
        let resync = false;
        let changed: Set<HTMLElement> | undefined;
        for (const record of records) {
            if (record.type === "childList" && !resync && (touchesRows(record.addedNodes) || touchesRows(record.removedNodes))) resync = true;
            // Our own FAR and ROW toggles
            if (record.type === "attributes" && record.attributeName === "class" && rows.has(record.target as HTMLElement)
                && theirClasses(record.oldValue) === theirClasses((record.target as Element).getAttribute("class"))) continue;
            const row = hiddenRowOf(record.target);
            if (row) (changed ??= new Set()).add(row);
        }
        if (changed) {
            reveal(changed);
            // What it changed may also be where the row should be (a message that now opens a group
            // has a margin that passes through its <li>): work its row out again
            for (const row of changed) {
                const item = row.matches(itemSelector) ? row : row.closest(itemSelector) ?? row.querySelector(itemSelector);
                if (item) rowCache.delete(item);
            }
            resync = true;
        }
        if (resync) queueSync();
    });
    mutations.observe(list, { childList: true, subtree: true, attributes: true, attributeOldValue: true, characterData: true });

    // An image, video or embed finishing loading resizes its row without changing the DOM
    const onLoad = (event: Event) => {
        const row = event.target instanceof Node ? hiddenRowOf(event.target) : null;
        if (row) reveal([row]);
    };
    const LOAD_EVENTS = ["load", "error", "loadedmetadata"];
    for (const type of LOAD_EVENTS) list.addEventListener(type, onLoad, true);

    // A new width rewraps every message, hidden ones included: render them all again, as the
    // browser would without us, then hide what's still far away at its new size
    let width = -1;
    const resize = new ResizeObserver(entries => {
        const next = entries[entries.length - 1].contentRect.width;
        if (next === width) return;
        const first = width < 0;
        width = next;
        if (!first) reveal(rows);
    });
    resize.observe(list);

    // So do a new font size (Discord sets it on <html>) and stylesheets coming or going (themes,
    // custom CSS). Not the title or other tags in <head>, which change with every unread.
    const isStyleNode = (node: Node) => node instanceof HTMLStyleElement || (node instanceof HTMLLinkElement && node.rel === "stylesheet");
    const styles = new MutationObserver(records => {
        if (records.some(r => r.target === document.documentElement || isStyleNode(r.target) || isStyleNode(r.target.parentNode!)
            || [...r.addedNodes, ...r.removedNodes].some(isStyleNode))) reveal(rows);
    });
    styles.observe(document.documentElement, { attributes: true, attributeFilter: ["style"] });
    styles.observe(document.head, { childList: true, subtree: true, characterData: true });

    // A jump further than the render distance (scrollbar drag, jump to message): reveal everything
    // synchronously, before this frame paints. The observer re-hides what's still far away.
    let lastTop = scroller?.scrollTop ?? 0;
    const onScroll = () => {
        const top = scroller!.scrollTop;
        if (Math.abs(top - lastTop) > margin / 2) reveal(rows);
        lastTop = top;
    };
    scroller?.addEventListener("scroll", onScroll, { passive: true });

    let flat: HTMLStyleElement | undefined;
    const stopFlattening = kind.flattenPills
        ? flattenRules(list, css => {
            if (disposed || !css) return;
            flat = document.createElement("style");
            flat.id = "evi-fl-flatten";
            flat.textContent = css;
            document.head.append(flat);
        })
        : undefined;

    sync();

    return {
        list,
        /**
         * Attached before the list could scroll (still loading) and rows came in since the last look:
         * worth checking again whether it scrolls now. No layout read here, that's `scrollable`'s job,
         * after Discord's frame.
         */
        stale() {
            if (scroller || !grew) return false;
            grew = false;
            return true;
        },
        /** Whether the list has a scroller now. Reads layout: call it after Discord's frame, never mid-render. */
        scrollable: () => !!findScroller(list),
        dispose() {
            disposed = true;
            cancelSync?.();
            stopFlattening?.();
            visibility?.disconnect();
            mutations.disconnect();
            resize.disconnect();
            styles.disconnect();
            for (const type of LOAD_EVENTS) list.removeEventListener(type, onLoad, true);
            scroller?.removeEventListener("scroll", onScroll);
            flat?.remove();
            for (const row of rows) row.classList.remove(ROW, FAR);
            rows.clear();
        },
    };
}

export default definePlugin({
    settings: {
        servers: {
            type: "boolean",
            get label() { return t("settings.servers"); },
            get description() { return t("settings.servers.description"); },
            default: true,
        },
        chat: {
            type: "boolean",
            get label() { return t("settings.chat"); },
            get description() { return t("settings.chat.description"); },
            // Off by default since 2.2.1. 2.2.2 and 2.2.3 fixed what pulled the chat back while scrolling up
            default: false,
        },
        members: {
            type: "boolean",
            get label() { return t("settings.members"); },
            get description() { return t("settings.members.description"); },
            default: false,
        },
        margin: {
            type: "number",
            get label() { return t("settings.margin"); },
            get description() { return t("settings.margin.description"); },
            default: 2,
            min: 1,
            max: 10,
            step: 1,
        },
    },

    start(ctx) {
        ctx.addStyle(css);
        const sessions = new Map<ListKind["key"], ReturnType<typeof createSession>>();

        /** A screen reader or other assistive technology is on: nothing may be hidden from it */
        const root = document.documentElement;
        let assistive = root.hasAttribute("data-evi-assistive");
        const watchAssistive = new MutationObserver(() => {
            if (root.hasAttribute("data-evi-assistive") === assistive) return;
            assistive = !assistive;
            refresh(true);
        });
        watchAssistive.observe(root, { attributes: true, attributeFilter: ["data-evi-assistive"] });
        ctx.onDispose(() => watchAssistive.disconnect());
        const active = (key: ListKind["key"]) => !assistive && !!ctx.settings.get(key);

        /** Lists waiting to be set up after Discord's next frame */
        const pending = new Map<string, Element>();
        /** Pending lists to set up again even if they are the current session's (settings changed) */
        const rebuild = new Set<string>();
        let scheduled = false;

        /**
         * Sets up the waiting lists once Discord has drawn them. Doing it straight away, while Discord was
         * still building a new channel, made finding the scroller lay out the whole page there and then:
         * 270ms once on a big server. A frame later the layout is done and reading it costs nothing.
         */
        const schedule = () => {
            if (scheduled) return;
            scheduled = true;
            requestAnimationFrame(() => setTimeout(() => {
                scheduled = false;
                for (const kind of LISTS) {
                    const list = pending.get(kind.key);
                    if (!list) continue;
                    pending.delete(kind.key);
                    const forced = rebuild.delete(kind.key);
                    if (!list.isConnected || !active(kind.key)) continue;
                    const current = sessions.get(kind.key);
                    // A stale check: only start over once the list really can scroll
                    if (current?.list === list && !forced && !current.scrollable()) continue;
                    current?.dispose();
                    sessions.set(kind.key, createSession(list, kind, ctx.settings.get("margin")));
                }
            }, 0));
        };

        /**
         * The lists of `kinds` on the page, found in one walk of the document. A prefix attribute
         * selector can't use any of the browser's indexes, so each lookup reads every element:
         * three separate lookups every second were most of this plugin's idle cost.
         */
        const findLists = (kinds: ListKind[]) => {
            const found = new Map<ListKind["key"], Element>();
            if (!kinds.length) return found;
            for (const el of document.querySelectorAll(kinds.map(kind => kind.list).join(", "))) {
                for (const kind of kinds) {
                    if (!found.has(kind.key) && el.matches(kind.list)) found.set(kind.key, el);
                }
                if (found.size === kinds.length) break;
            }
            return found;
        };

        const drop = (key: ListKind["key"]) => {
            sessions.get(key)?.dispose();
            sessions.delete(key);
            pending.delete(key);
        };

        const refresh = (force = false) => {
            const missing: ListKind[] = [];
            for (const kind of LISTS) {
                const current = sessions.get(kind.key);
                if (!active(kind.key)) {
                    drop(kind.key);
                    continue;
                }
                // The list we're on is still there and nothing changed: no page search (most ticks).
                // stale() resets itself, so it's asked once.
                const stale = !!current && current.list.isConnected && current.stale();
                if (!force && !stale && current?.list.isConnected) continue;
                if (stale && !force) {
                    pending.set(kind.key, current!.list);
                    schedule();
                    continue;
                }
                missing.push(kind);
            }
            const lists = findLists(missing);
            for (const kind of missing) {
                const current = sessions.get(kind.key);
                const list = lists.get(kind.key);
                if (!list) {
                    drop(kind.key);
                    continue;
                }
                if (!force && current?.list === list) continue;
                if (force) rebuild.add(kind.key);
                pending.set(kind.key, list);
                schedule();
            }
        };

        refresh();
        ctx.onDispose(() => {
            for (const session of sessions.values()) session.dispose();
            // Belt and braces: nothing of ours may survive a disable
            for (const el of document.querySelectorAll(`.${ROW}, .${FAR}`)) el.classList.remove(ROW, FAR);
        });
        ctx.settings.onChange(() => refresh(true));

        // Chats and member lists are replaced when you switch channels: re-attach to the new ones
        ctx.setInterval(() => {
            refresh();
        }, 1000);
    },
});
