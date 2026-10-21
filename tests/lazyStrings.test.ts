import { describe, expect, test } from "bun:test";
import type { BunPlugin } from "bun";
import { existsSync, readdirSync, readFileSync } from "fs";
import { join, resolve } from "path";

import { lazyStrings, lazyStringsPlugin } from "../scripts/lazyStrings";
import { stringTables } from "../src/shared/pluginTranslations";

const PLUGINS = resolve(import.meta.dir, "..", "plugins");
const files = readdirSync(PLUGINS).map(id => join(PLUGINS, id, "strings.ts")).filter(existsSync);

// @evi/api's defineStrings, keeping what the plugin hands it
const stubApi: BunPlugin = {
    name: "stub-api",
    setup(build) {
        build.onResolve({ filter: /^@evi\/api$/ }, () => ({ path: "api", namespace: "stub" }));
        build.onLoad({ filter: /.*/, namespace: "stub" }, () => ({ contents: "export const defineStrings = s => (globalThis.__strings = s, () => '');", loader: "js" }));
    },
};

/** strings.ts built as the plugin build does (lazy) or as written, and what it passes defineStrings */
async function strings(file: string, lazy: boolean): Promise<{ code: string; strings: Record<string, Record<string, unknown>>; }> {
    const result = await Bun.build({ entrypoints: [file], target: "browser", format: "iife", plugins: lazy ? [stubApi, lazyStringsPlugin] : [stubApi] });
    expect(result.success).toBe(true);
    const code = await result.outputs[0].text();
    new Function(code)();
    return { code, strings: (globalThis as any).__strings };
}

describe("plugin strings built lazily", () => {
    test("every official plugin's strings.ts has the shape the build makes lazy", () => {
        expect(files.length).toBeGreaterThan(40);
        for (const file of files) expect([file, lazyStrings(readFileSync(file, "utf8")).includes("Object.defineProperty(this")]).toEqual([file, true]);
    });

    test("the same languages and text as written, each built once when first read", async () => {
        for (const file of files) {
            const { code: eagerCode, strings: eager } = await strings(file, false);
            const { code: lazyCode, strings: lazy } = await strings(file, true);
            // The upload checks read the same tables from either (shared/pluginTranslations.ts)
            expect([file, stringTables(lazyCode)]).toEqual([file, stringTables(eagerCode)]);
            expect([file, Object.keys(lazy)]).toEqual([file, Object.keys(eager)]);
            for (const lang of Object.keys(eager)) {
                const before = Object.getOwnPropertyDescriptor(lazy, lang)!;
                expect([file, lang, typeof before.get === "function"]).toEqual([file, lang, lang !== "en"]);
                const value = lazy[lang];
                expect([file, lang, value]).toEqual([file, lang, eager[lang]]);
                // Replaced by the object itself: read again, the same one; still listed
                const after = Object.getOwnPropertyDescriptor(lazy, lang)!;
                expect([after.value === value, after.enumerable, lazy[lang] === value]).toEqual([true, true, true]);
            }
        }
    });

    test("a file of another shape comes back as it was", () => {
        const odd = [
            "export const t = { en: {} };\n",
            "export const t = defineStrings({\n    en: {\n        a: \"A\",\n    },\n    de: { a: \"B\" },\n});\n",
            "export const t = defineStrings({\n    de: {\n        a: \"B\",\n    },\n});\n",
            "export const t = defineStrings({\n    en: {\n        a: \"A\",\n    },\n    extra,\n});\n",
            "export const t = defineStrings({\n    en: {\n        a: \"A\",\n    },\n    de: {\n        a: \"B\",\n",
        ];
        for (const source of odd) expect(lazyStrings(source)).toBe(source);
    });

    test("CRLF files and quoted languages", () => {
        const source = "export const t = defineStrings({\r\n    en: {\r\n        a: \"A\",\r\n    },\r\n    \"pt-BR\": {\r\n        a: \"B\",\r\n    },\r\n});\r\n";
        const out = lazyStrings(source);
        expect(out).toContain("    get \"pt-BR\"() { return Object.defineProperty(this, \"pt-BR\", { value: {\r\n");
        expect(out).toContain("    } })[\"pt-BR\"]; },\r\n");
        expect(out.split("\n").length).toBe(source.split("\n").length);
    });
});
