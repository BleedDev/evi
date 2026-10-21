import { definePlugin, findStore } from "@evi/api";
import type { PluginContext } from "@evi/api";

import { collectKnown, detectSensitive } from "./detect";
import type { KnownValues } from "./detect";
import { t } from "./strings";

/**
 * Blurs personal information in User Settings: email, phone, username, billing details, connected
 * account names, session locations and IPs, authorized apps.
 *
 * Discord's settings screens change often (the new settings modal isn't even a stable set of
 * components), so nothing here is a source patch. Instead a MutationObserver watches the settings
 * layer only while it's open, and every text node in it goes through detect.ts: patterns (emails,
 * phones, card masks, IPs) plus the user's own values from Discord's stores. A match tags the text's
 * element with a class; the blur and the reveal behavior are plain CSS keyed off <html>.
 *
 * "Settings open" is either the classic settings layer (standardSidebarView) being in the page, or,
 * between USER_SETTINGS_MODAL_OPEN and _CLOSE, any open dialog (the new settings modal).
 */

const BLUR = "evi-hpi-blur";
const REVEALED = "evi-hpi-revealed";
const MODE_ATTR = "data-evi-hpi";
const CLASSIC_ROOT = "[class*=\"standardSidebarView_\"]";
const DIALOG_ROOT = "[role=\"dialog\"], [aria-modal=\"true\"]";
/** Text we never look into */
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
let observer: MutationObserver | undefined;
let observedRoots: Element[] = [];
const pending = new Set<Node>();
let flushTimer: ReturnType<typeof setTimeout> | undefined;
const tagged = new Set<Element>();

function isActive() {
    if (!context?.settings.get("enabled")) return false;
    if (!context.settings.get("onlyStreamerMode")) return true;
    return !!findStore("StreamerModeStore")?.enabled;
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
}

/** Tagged elements whose text changed (React reuses elements) or that left the page get untagged */
function recheckTagged(values: KnownValues) {
    for (const el of tagged) {
        if (!el.isConnected) tagged.delete(el);
        else if (![...el.childNodes].some(n => n.nodeType === Node.TEXT_NODE && detectSensitive((n as Text).data, values))) untag(el);
    }
}

function flush() {
    flushTimer = undefined;
    if (!observer) return pending.clear();
    // The settings closed under us: stop watching
    if (!observedRoots.some(r => r.isConnected)) {
        pending.clear();
        return refresh();
    }
    const values = known();
    recheckTagged(values);
    for (const node of pending) if (node.isConnected) scan(node, values);
    pending.clear();
}

function schedule() {
    flushTimer ??= setTimeout(flush, 150);
}

function disconnect() {
    observer?.disconnect();
    observer = undefined;
    observedRoots = [];
    pending.clear();
    clearTimeout(flushTimer);
    flushTimer = undefined;
}

function cleanAll() {
    for (const el of document.querySelectorAll(`.${BLUR}, .${REVEALED}`)) el.classList.remove(BLUR, REVEALED);
    tagged.clear();
}

/** Starts, restarts or stops watching depending on the settings and whether User Settings is open */
function refresh() {
    disconnect();
    if (!context || !isActive()) {
        cleanAll();
        return;
    }
    const roots = findRoots();
    if (!roots.length) return;
    observer = new MutationObserver(records => {
        for (const r of records) {
            if (r.type === "characterData") pending.add(r.target);
            // React rewrote a className and dropped ours
            else if (r.type === "attributes") {
                const el = r.target as Element;
                if (tagged.has(el) && !el.classList.contains(BLUR)) el.classList.add(BLUR);
            } else r.addedNodes.forEach(n => pending.add(n));
        }
        if (pending.size) schedule();
    });
    for (const root of roots) {
        observer.observe(root, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["class"] });
        pending.add(root);
    }
    observedRoots = roots;
    schedule();
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
        html[${MODE_ATTR}="never"] .${BLUR} { user-select: none; }
        @media (prefers-reduced-motion: reduce) { .${BLUR} { transition: none; } }
    `,

    start(ctx) {
        context = ctx;
        modalOpen = false;
        applyMode();

        document.addEventListener("click", onClick, true);
        ctx.onDispose(() => {
            document.removeEventListener("click", onClick, true);
            disconnect();
            cleanAll();
            document.documentElement.removeAttribute(MODE_ATTR);
            context = undefined;
            modalOpen = false;
        });

        // The settings layer can mount a moment after the action; look again shortly after
        const openSoon = () => {
            refresh();
            ctx.setTimeout(() => !observer && refresh(), 300);
            ctx.setTimeout(() => !observer && refresh(), 1000);
        };
        ctx.flux.subscribe("USER_SETTINGS_MODAL_OPEN", () => {
            modalOpen = true;
            openSoon();
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
