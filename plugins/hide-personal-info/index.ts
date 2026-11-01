import { definePlugin, findStore } from "@evi/api";
import type { PluginContext } from "@evi/api";

import { collectKnown, detectSensitive, isTextField } from "./detect";
import type { KnownValues } from "./detect";
import { t } from "./strings";

/**
 * Blurs personal information in User Settings: email, phone, username, billing details, connected
 * account names, session locations and IPs, authorized apps.
 *
 * Discord's settings screens change often (the new settings modal isn't even a stable set of
 * components), so nothing here is a source patch. Instead a MutationObserver watches the settings
 * layer only while it's open, and every text node in it goes through detect.ts: patterns (emails,
 * phones, card masks, IPs) plus the user's own values from Discord's stores. Text boxes go through
 * it by their value. A match tags the element with a class; the blur and the reveal behavior are
 * plain CSS keyed off <html>.
 *
 * Tagging happens inside the MutationObserver callbacks, which run before the browser paints, so
 * nothing personal is ever shown unblurred for a frame: not when settings open (a second observer,
 * looking only at added nodes, catches the layer as it's added), not when a section loads or a
 * value is revealed.
 *
 * "Settings open" is either the classic settings layer (standardSidebarView) being in the page, or,
 * between USER_SETTINGS_MODAL_OPEN and _CLOSE, any open dialog (the new settings modal, and the
 * dialogs it opens, like changing your email).
 */

const BLUR = "evi-hpi-blur";
const REVEALED = "evi-hpi-revealed";
const MODE_ATTR = "data-evi-hpi";
const CLASSIC_ROOT = "[class*=\"standardSidebarView_\"]";
const DIALOG_ROOT = "[role=\"dialog\"], [aria-modal=\"true\"]";
/** Text we never look into (a text box's text is its value, looked at separately) */
const SKIP = new Set(["SCRIPT", "STYLE", "TEXTAREA", "INPUT", "SVG", "CODE"]);

type Settings = typeof settings;
const settings = {
    enabled: {
        type: "boolean",
        get label() { return t("settings.enabled"); },
        get description() { return t("settings.enabled.description"); },
        default: true,
    },
    onlyStreamerMode: {
        type: "boolean",
        get label() { return t("settings.onlyStreamerMode"); },
        get description() { return t("settings.onlyStreamerMode.description"); },
        default: false,
    },
    reveal: {
        type: "select",
        get label() { return t("settings.reveal"); },
        get description() { return t("settings.reveal.description"); },
        default: "hover",
        options: [
            { get label() { return t("reveal.hover"); }, value: "hover" },
            { get label() { return t("reveal.click"); }, value: "click" },
            { get label() { return t("reveal.never"); }, value: "never" },
        ],
    },
} as const;

let context: PluginContext<Settings> | undefined;
/** Between USER_SETTINGS_MODAL_OPEN and USER_SETTINGS_MODAL_CLOSE */
let modalOpen = false;
/** Watches the settings roots and tags what they show */
let observer: MutationObserver | undefined;
/** Watches the page for a settings root (or a dialog opened from settings) appearing, or the roots going */
let watcher: MutationObserver | undefined;
let observedRoots: Element[] = [];
const tagged = new Set<Element>();

function isActive() {
    if (!context?.settings.get("enabled")) return false;
    if (!context.settings.get("onlyStreamerMode")) return true;
    return !!findStore("StreamerModeStore")?.enabled;
}

function rootSelector() {
    return modalOpen ? `${CLASSIC_ROOT}, ${DIALOG_ROOT}` : CLASSIC_ROOT;
}

function findRoots(): Element[] {
    const roots = [...document.querySelectorAll(CLASSIC_ROOT)];
    if (modalOpen) roots.push(...document.querySelectorAll(DIALOG_ROOT));
    // Drop roots nested in another root
    return roots.filter(r => !roots.some(o => o !== r && o.contains(r)));
}

function known(): KnownValues {
    const call = <T>(fn: () => T): T | undefined => {
        try {
            return fn();
        } catch {
            return undefined;
        }
    };
    return collectKnown({
        user: call(() => findStore("UserStore")?.getCurrentUser?.()),
        connectedAccounts: call(() => findStore("ConnectedAccountsStore")?.getAccounts?.()),
        authorizedApps: call(() => findStore("AuthorizedAppsStore")?.getNewestTokens?.()),
        sessions: call(() => findStore("AuthSessionsStore")?.getSessions?.()),
        paymentSources: call(() => findStore("PaymentSourceStore")?.paymentSources),
    });
}

function tag(el: Element) {
    if (el.classList.contains(BLUR)) return;
    el.classList.add(BLUR);
    tagged.add(el);
}

function untag(el: Element) {
    el.classList.remove(BLUR, REVEALED);
    tagged.delete(el);
}

function isField(el: Element): el is HTMLInputElement | HTMLTextAreaElement {
    return isTextField(el.tagName, (el as HTMLInputElement).type);
}

function checkField(el: HTMLInputElement | HTMLTextAreaElement, values: KnownValues) {
    if (detectSensitive(el.value, values)) tag(el);
    else if (tagged.has(el)) untag(el);
}

function checkText(node: Text, values: KnownValues) {
    const el = node.parentElement;
    if (!el || SKIP.has(el.tagName.toUpperCase()) || el.closest("[contenteditable=\"true\"]")) return;
    if (detectSensitive(node.data, values)) tag(el);
}

function scan(node: Node, values: KnownValues) {
    if (node.nodeType === Node.TEXT_NODE) return checkText(node as Text, values);
    if (node.nodeType !== Node.ELEMENT_NODE && node.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) return;
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    for (let text = walker.nextNode(); text; text = walker.nextNode()) checkText(text as Text, values);
    if (node.nodeType === Node.ELEMENT_NODE && isField(node as Element)) checkField(node as HTMLInputElement, values);
    for (const field of (node as Element | DocumentFragment).querySelectorAll("input, textarea")) {
        if (isField(field)) checkField(field, values);
    }
}

/** A tagged element whose text changed (React reuses elements) keeps its blur only if it still holds something */
function recheck(el: Element, values: KnownValues) {
    if (!el.isConnected) return void tagged.delete(el);
    if (isField(el)) return checkField(el, values);
    if (![...el.childNodes].some(n => n.nodeType === Node.TEXT_NODE && detectSensitive((n as Text).data, values))) untag(el);
}

/**
 * Runs in the MutationObserver callback, which comes before the browser paints the change: new
 * text is blurred in the same frame it appears in, never shown for a moment first.
 */
function onMutations(records: MutationRecord[]) {
    // Read from the stores once per batch, and not for batches that are only class changes (our own tags)
    let read: KnownValues | undefined;
    const values = () => read ??= known();
    for (const r of records) {
        if (r.type === "characterData") {
            const el = (r.target as Text).parentElement;
            if (el && tagged.has(el)) recheck(el, values());
            else checkText(r.target as Text, values());
        } else if (r.type === "attributes") {
            // React rewrote a className and dropped ours
            const el = r.target as Element;
            if (tagged.has(el) && !el.classList.contains(BLUR)) el.classList.add(BLUR);
        } else {
            r.addedNodes.forEach(n => n.isConnected && scan(n, values()));
            if (r.removedNodes.length && tagged.has(r.target as Element)) recheck(r.target as Element, values());
        }
    }
    // Tagged elements that left the page
    if (tagged.size > 50) for (const el of tagged) if (!el.isConnected) tagged.delete(el);
}

/**
 * Only child lists, and only a cheap look at what was added: a settings root showing up (settings
 * opening, a dialog opened from them) or the roots leaving means looking again, right away.
 */
function onPageMutations(records: MutationRecord[]) {
    if (observedRoots.length && !observedRoots.some(r => r.isConnected)) return refresh();
    const selector = rootSelector();
    for (const r of records) {
        for (const n of r.addedNodes) {
            if (n.nodeType !== Node.ELEMENT_NODE || !n.isConnected) continue;
            const el = n as Element;
            if (observedRoots.some(root => root.contains(el))) continue;
            if (el.matches(selector) || (el.firstElementChild && el.querySelector(selector))) return refresh();
        }
    }
}

function onInput(e: Event) {
    const el = e.target as Element | null;
    if (!observer || !el || !isField(el) || !observedRoots.some(r => r.contains(el))) return;
    checkField(el, known());
}

function disconnect() {
    observer?.disconnect();
    observer = undefined;
    watcher?.disconnect();
    watcher = undefined;
    observedRoots = [];
}

function cleanAll() {
    for (const el of document.querySelectorAll(`.${BLUR}, .${REVEALED}`)) el.classList.remove(BLUR, REVEALED);
    tagged.clear();
}

/**
 * Starts, restarts or stops watching depending on the settings and whether User Settings is open.
 * The first look at what's open happens here and now, so it's blurred before it's painted.
 */
function refresh() {
    disconnect();
    if (!context || !isActive()) {
        cleanAll();
        return;
    }
    const roots = findRoots();
    // Settings are on their way (or open with a dialog of theirs to come): watch for them
    if (modalOpen || roots.length) {
        watcher = new MutationObserver(onPageMutations);
        watcher.observe(document.body, { childList: true, subtree: true });
    }
    if (!roots.length) return;
    const current = known();
    for (const el of tagged) recheck(el, current);
    observer = new MutationObserver(onMutations);
    for (const root of roots) {
        observer.observe(root, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["class"] });
        scan(root, current);
    }
    observedRoots = roots;
}

function applyMode() {
    const mode = context?.settings.get("reveal") ?? "hover";
    document.documentElement.setAttribute(MODE_ATTR, mode);
    if (mode !== "click") for (const el of document.querySelectorAll(`.${REVEALED}`)) el.classList.remove(REVEALED);
}

function onClick(e: MouseEvent) {
    if (context?.settings.get("reveal") !== "click") return;
    const el = (e.target as Element | null)?.closest?.(`.${BLUR}`);
    if (el) el.classList.toggle(REVEALED);
}

function toggle() {
    if (!context) return "";
    const enabled = !context.settings.get("enabled");
    context.settings.set("enabled", enabled);
    return enabled ? t("toggle.on") : t("toggle.off");
}

export default definePlugin({
    settings,

    toggle,
    detectSensitive,

    css: `
        .${BLUR} { filter: blur(6px); transition: filter 0.15s ease-out; }
        html[${MODE_ATTR}="hover"] .${BLUR}:hover,
        html[${MODE_ATTR}="click"] .${BLUR}.${REVEALED} { filter: none; }
        html[${MODE_ATTR}="click"] .${BLUR} { cursor: pointer; }
        html[${MODE_ATTR}="never"] .${BLUR}:not(input, textarea) { user-select: none; }
        @media (prefers-reduced-motion: reduce) { .${BLUR} { transition: none; } }
    `,

    start(ctx) {
        context = ctx;
        modalOpen = false;
        applyMode();

        document.addEventListener("click", onClick, true);
        document.addEventListener("input", onInput, true);
        ctx.onDispose(() => {
            document.removeEventListener("click", onClick, true);
            document.removeEventListener("input", onInput, true);
            disconnect();
            cleanAll();
            document.documentElement.removeAttribute(MODE_ATTR);
            context = undefined;
            modalOpen = false;
        });

        // The settings layer mounts a moment after the action: refresh() leaves the page watched
        // until it does, and looks at it as it's added
        ctx.flux.subscribe("USER_SETTINGS_MODAL_OPEN", () => {
            modalOpen = true;
            refresh();
        });
        for (const type of ["USER_SETTINGS_MODAL_CLOSE", "LOGOUT"]) {
            ctx.flux.subscribe(type, () => {
                modalOpen = false;
                refresh();
            });
        }
        // Covers settings opened some other way (or before we started). The classic settings view is
        // one of Discord's layers: with none open (nearly always) the page isn't searched, since a
        // class-substring selector reads every element. Without LayerStore it always looks.
        ctx.setInterval(() => {
            if (observer || !isActive() || findStore("LayerStore")?.hasLayers?.() === false) return;
            if (document.querySelector(CLASSIC_ROOT)) refresh();
        }, 1500);

        ctx.settings.onChange(() => {
            applyMode();
            refresh();
        });

        const streamerMode = findStore("StreamerModeStore");
        if (streamerMode?.addChangeListener) {
            let last = !!streamerMode.enabled;
            const onStreamerMode = () => {
                if (!!streamerMode.enabled === last) return;
                last = !!streamerMode.enabled;
                refresh();
            };
            streamerMode.addChangeListener(onStreamerMode);
            ctx.onDispose(() => streamerMode.removeChangeListener?.(onStreamerMode));
        }

        ctx.command({
            name: "hidepersonal",
            description: t("command.description"),
            execute: () => ({ ephemeral: toggle() }),
        });

        refresh();
    },
});
