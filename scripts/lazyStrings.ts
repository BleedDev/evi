/**
 * Official plugins keep their text in strings.ts, `export const t = defineStrings({` with one block per
 * language. Built as written, every plugin builds all 9 languages as it loads, although only English
 * (the fallback) and Discord's language are ever read. Built through this, each language but English
 * is a getter that builds its block the first time it's read and replaces itself with it, so the
 * object stays a plain object of languages: defineStrings and every core, older ones too, read it as
 * before (Object.keys still lists them all). Only the build changes; the sources stay as they are.
 */
import type { BunPlugin } from "bun";

const OPENER = /^ {4}("[A-Za-z-]+"|[A-Za-z]+): \{(\r?)$/;
const CLOSER = /^ {4}\}(,?)(\r?)$/;

/** `source` with its non-English blocks built on first read; a file of any other shape as it was */
export function lazyStrings(source: string): string {
    const lines = source.split("\n");
    const start = lines.findIndex(l => /^export const t = defineStrings\(\{\r?$/.test(l));
    const end = lines.findIndex((l, i) => i > start && /^\}\);\r?$/.test(l));
    if (start < 0 || end < 0) return source;
    const out = [...lines];
    let open: string | undefined;
    let english = false;
    for (let i = start + 1; i < end; i++) {
        const line = lines[i];
        // A block's own lines, deeper in; blank lines and comments between blocks
        if (open !== undefined && !/^ {4}\S/.test(line)) continue;
        if (open === undefined && (!line.trim() || /^ {4}\/\//.test(line))) continue;
        const opener = open === undefined && OPENER.exec(line);
        const closer = open !== undefined && CLOSER.exec(line);
        if (opener) {
            open = opener[1];
            if (open === "en" || open === '"en"') {
                english = true;
                continue;
            }
            const name = open.startsWith('"') ? open : JSON.stringify(open);
            out[i] = `    get ${open}() { return Object.defineProperty(this, ${name}, { value: {${opener[2]}`;
        } else if (closer) {
            if (open !== "en" && open !== '"en"') {
                const name = open!.startsWith('"') ? open! : JSON.stringify(open);
                out[i] = `    } })[${name}]; }${closer[1]}${closer[2]}`;
            }
            open = undefined;
        } else {
            return source;
        }
    }
    return open === undefined && english ? out.join("\n") : source;
}

/** For plugin bundles: every strings.ts goes through lazyStrings */
export const lazyStringsPlugin: BunPlugin = {
    name: "evi-lazy-strings",
    setup(build) {
        build.onLoad({ filter: /[\\/]strings\.ts$/ }, async args => ({ contents: lazyStrings(await Bun.file(args.path).text()), loader: "ts" }));
    },
};
