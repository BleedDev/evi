/**
 * Evi's language in main, for what main says itself: native dialogs and the errors it sends back.
 * The renderer knows Discord's language and tells main through IPC.SET_LOCALE; until it does, English.
 * main.js only carries the keys under scripts/mainLocales.ts's MAIN_KEYS, so main's text goes there.
 */
import { FALLBACK_LOCALE, matchLocale, translate, Vars } from "@shared/i18n";
import { CATALOGS, EviKey, LOCALES } from "@shared/locales";

let locale = FALLBACK_LOCALE;

export function setLocale(next: unknown) {
    locale = typeof next === "string" ? matchLocale(next, LOCALES) ?? FALLBACK_LOCALE : FALLBACK_LOCALE;
}

/** Evi's text for `key` in the language the page last reported */
export const mt = (key: EviKey, vars?: Vars) => translate(CATALOGS, locale, key, vars);
