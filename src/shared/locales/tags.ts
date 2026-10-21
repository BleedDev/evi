/**
 * Evi's languages, in CATALOGS' order (index.ts), without loading any of them. The renderer and main
 * bundle English only and read the language in use from the locale-<tag>.json files the build writes
 * next to main.js (scripts/coreData.ts); index.ts, with every catalog, is for tests and scripts.
 */
export const LOCALES = ["en", "es", "pt-BR", "fr", "de", "tr", "ru", "pl", "ja"];
