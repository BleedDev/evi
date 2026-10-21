/**
 * Evi speaks Discord's language. The language comes from Discord's LocaleStore (the one picked in
 * Discord's Language settings), else the `lang` Discord puts on <html>, else English, and follows
 * changes live: components re-render through useLocale(). English is bundled; the language in use
 * comes from main once it's known (loadCatalogsWith), and is English until then.
 */
import { FALLBACK_LOCALE, matchLocale, Message, Messages, translate, Vars } from "@shared/i18n";
import type { EviKey } from "@shared/locales";
import { en } from "@shared/locales/en";
import { LOCALES } from "@shared/locales/tags";
import type { ReactNode } from "react";

import { React } from "./webpack/common";
import { filters, findStore, waitFor } from "./webpack/find";

interface LocaleStore {
    locale?: string;
    addChangeListener?(fn: () => void): void;
}

let discordLocale = "";
let locale = FALLBACK_LOCALE;
let started = false;
const listeners = new Set<() => void>();
/** English and the language in use: another one replaces it */
let catalogs: Record<string, Messages | undefined> = { en };
let loadCatalog: ((tag: string) => string | null | undefined) | undefined;

/** Fetches `tag`'s catalog once while it's in use: without an answer that language is English */
function ensureCatalog(tag: string) {
    if (tag === FALLBACK_LOCALE || tag in catalogs || !loadCatalog) return;
    let messages: Messages | undefined;
    try {
        messages = JSON.parse(loadCatalog(tag) ?? "null") ?? undefined;
    } catch { }
    catalogs = { en, [tag]: messages };
}

function read() {
    let store: LocaleStore | undefined;
    try {
        store = findStore<LocaleStore>("LocaleStore");
    } catch {
        // Webpack isn't up yet
    }
    return store?.locale || (typeof document !== "undefined" ? document.documentElement?.lang : "") || "";
}

function refresh() {
    const next = read();
    if (next === discordLocale) return;
    discordLocale = next;
    locale = matchLocale(next, LOCALES) ?? FALLBACK_LOCALE;
    ensureCatalog(locale);
    listeners.forEach(l => l());
}

function start() {
    if (started) return;
    started = true;
    if (typeof document === "undefined") return;
    // Evi can start before <html> exists: watch it once it does
    const watchLang = () => {
        refresh();
        // Discord updates <html lang> when its language changes, even before its stores exist
        new MutationObserver(refresh).observe(document.documentElement, { attributes: true, attributeFilter: ["lang"] });
    };
    if (document.documentElement) watchLang();
    else new MutationObserver((_, observer) => {
        if (!document.documentElement) return;
        observer.disconnect();
        watchLang();
    }).observe(document, { childList: true });
    waitFor<LocaleStore>(filters.byStoreName("LocaleStore"), store => {
        store.addChangeListener?.(refresh);
        refresh();
    });
}

export const I18n = {
    /** Evi's language, one of its locales */
    get locale() {
        start();
        return locale;
    },
    /** Discord's own language tag, like `en-US` or `pt-BR` */
    get discordLocale() {
        start();
        return discordLocale || FALLBACK_LOCALE;
    },
    subscribe(fn: () => void) {
        start();
        listeners.add(fn);
        return () => void listeners.delete(fn);
    },
};

/** Where the languages but English come from: main, as JSON text. Set once, as Evi boots; not for plugins */
export function loadCatalogsWith(load: (tag: string) => string | null | undefined) {
    loadCatalog = load;
    // The language may be known already
    if (locale === FALLBACK_LOCALE || locale in catalogs) return;
    ensureCatalog(locale);
    listeners.forEach(l => l());
}

/** Evi's UI text for `key` in Discord's language, `{name}` placeholders filled from `vars` */
export function t(key: EviKey, vars?: Vars): string {
    return translate(catalogs, I18n.locale, key, vars);
}

/**
 * Like t(), for text with React elements in it: each `{name}` whose value is in `nodes` becomes that
 * node, so a translation can move it around ("By {authors}" / "{authors} tarafından").
 */
export function tNodes(key: EviKey, nodes: Record<string, ReactNode>, vars?: Vars): ReactNode[] {
    return t(key, vars).split(/\{(\w+)\}/g).map((part, i) => i % 2 ? React.createElement(React.Fragment, { key: i }, nodes[part] ?? `{${part}}`) : part);
}

/** Making an Intl formatter costs about 60 µs and lists format a date per row, so they're kept */
const formatters = new Map<string, Intl.DateTimeFormat | Intl.RelativeTimeFormat>();

function formatter<T extends Intl.DateTimeFormat | Intl.RelativeTimeFormat>(key: string, make: () => T): T {
    let made = formatters.get(key) as T | undefined;
    if (!made) formatters.set(key, made = make());
    return made;
}

/** A date formatter in Discord's language, the same as toLocaleDateString(locale, options) */
export function dateFormat(options: Intl.DateTimeFormatOptions) {
    const locale = I18n.discordLocale;
    return formatter(`date|${locale}|${JSON.stringify(options)}`, () => new Intl.DateTimeFormat(locale, options));
}

/** date.toLocaleString(Discord's language, options) with a kept formatter; options must name what to show */
export function localeDate(date: Date, options: Intl.DateTimeFormatOptions) {
    // toLocaleString says "Invalid Date" where format() throws
    return Number.isNaN(date.getTime()) ? String(date) : dateFormat(options).format(date);
}

/** "5 minutes ago", "yesterday", in Discord's language */
export function timeAgo(at: number, now = Date.now()) {
    const locale = I18n.discordLocale;
    const relative = formatter(`relative|${locale}`, () => new Intl.RelativeTimeFormat(locale, { numeric: "auto" }));
    const seconds = Math.round((at - now) / 1000);
    const units = [["day", 86400], ["hour", 3600], ["minute", 60]] as const;
    for (const [unit, size] of units) {
        if (Math.abs(seconds) >= size) return relative.format(Math.round(seconds / size), unit);
    }
    return t("common.justNow");
}

/** React hook: the current language. Call it at a tree's root so the tree re-renders when it changes. */
export function useLocale() {
    return React.useSyncExternalStore(I18n.subscribe, () => I18n.locale);
}

/**
 * A plugin's own strings, by locale: `{ en: {...}, es: {...}, "pt-BR": {...} }`. English is the
 * fallback and the source of the keys. Returns a `t(key, vars)` that follows Discord's language.
 */
export function defineStrings<const E extends Record<string, Message>>(strings: { en: E; } & Record<string, Partial<Record<keyof E, Message>>>) {
    const catalogs = strings as Record<string, Record<string, Message>>;
    const locales = Object.keys(catalogs);
    return (key: keyof E & string, vars?: Vars): string => {
        const lang = matchLocale(I18n.discordLocale, locales) ?? "en";
        return translate(catalogs, lang, key, vars, "en");
    };
}
