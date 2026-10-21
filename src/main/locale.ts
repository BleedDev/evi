/**
 * Evi's language in main, for what main says itself: native dialogs and the errors it sends back.
 * The renderer knows Discord's language and tells main through IPC.SET_LOCALE; until it does, English.
 * Only English is bundled: the other languages are files next to main.js (scripts/coreData.ts), read
 * when one is in use, by main for itself and for the renderer (IPC.LOCALE_CATALOG).
 * Its English is cut to the keys under scripts/mainLocales.ts's MAIN_KEYS, so main's own text goes there.
 */
import { FALLBACK_LOCALE, matchLocale, Messages, translate, Vars } from "@shared/i18n";
import type { EviKey } from "@shared/locales";
import { en } from "@shared/locales/en";
import { LOCALES } from "@shared/locales/tags";
import { readFileSync } from "fs";
import { join } from "path";

let locale = FALLBACK_LOCALE;
/** English and the language last used: another one replaces it */
let catalogs: Record<string, Messages | undefined> = { en };

/** One of Evi's languages but English, as the JSON text the build wrote; null for anything else or a file that can't be read */
export function readCatalog(tag: unknown): string | null {
    if (typeof tag !== "string" || tag === FALLBACK_LOCALE || !LOCALES.includes(tag)) return null;
    try {
        return readFileSync(join(globalThis.__eviCoreDir, `locale-${tag}.json`), "utf8");
    } catch {
        return null;
    }
}

export function setLocale(next: unknown) {
    locale = typeof next === "string" ? matchLocale(next, LOCALES) ?? FALLBACK_LOCALE : FALLBACK_LOCALE;
}

/** Evi's text for `key` in the language the page last reported */
export const mt = (key: EviKey, vars?: Vars) => {
    if (!(locale in catalogs)) {
        let messages: Messages | undefined;
        try {
            messages = JSON.parse(readCatalog(locale) ?? "null") ?? undefined;
        } catch { }
        // Read once while it's in use: without it, English
        catalogs = { en, [locale]: messages };
    }
    return translate(catalogs, locale, key, vars);
};
