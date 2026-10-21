/**
 * Main only says its own text (native dialogs, the errors it sends back) and what the shared checks it
 * runs say, so main.js keeps just those keys of each language: the full tables were most of main.js.
 * Text main says goes under one of MAIN_KEYS; a release build fails if main.js uses any other key.
 */
import type { BunPlugin } from "bun";

import { en } from "../src/shared/locales/en";

export const MAIN_KEYS = /^(main|common|check|themeEditor)\./;

/** Each language's table, filtered. Bun caches what it imports, so --watch builds leave this out and keep them whole */
export const mainLocales: BunPlugin = {
    name: "evi-main-locales",
    setup(build) {
        build.onLoad({ filter: /[\\/]src[\\/]shared[\\/]locales[\\/](?!index\.ts$)[\w-]+\.ts$/ }, async args => {
            // One export per file: en, de, es, fr, ja, pl, ptBR, ru, tr
            const [[name, table]] = Object.entries(await import(args.path) as Record<string, Record<string, unknown>>);
            const kept = Object.fromEntries(Object.entries(table).filter(([key]) => MAIN_KEYS.test(key)));
            return { contents: `export const ${name} = ${JSON.stringify(kept)};`, loader: "ts" };
        });
    },
};

/** English keys main.js names that its tables left out: they'd show as the raw key */
export function strayKeys(mainJs: string) {
    const stray = new Set<string>();
    for (const [, key] of mainJs.matchAll(/"([\w.-]+)"/g)) {
        if (Object.hasOwn(en, key) && !MAIN_KEYS.test(key)) stray.add(key);
    }
    return [...stray];
}
