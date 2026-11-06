/**
 * The store's clash warnings: which plugins you have that a store plugin doesn't work together with
 * (shared/clashes.ts clashingWith + renderer/clashWarnings.ts versionsYouHave), and the strings in
 * every language.
 */
import { describe, expect, test } from "bun:test";

import { clashingWith, parseClashes, type PluginClash } from "../src/shared/clashes";
import { versionsYouHave } from "../src/renderer/clashWarnings";
import { CATALOGS } from "../src/shared/locales";

const clash = (extra: Partial<PluginClash> = {}): PluginClash => ({ by: "platform-indicators-plus", byVersion: "1.0.3", breaks: "platform-indicators", breaksVersion: "1.2.0", kind: "patch", module: "589158", patch: 0, ...extra });

describe("which plugins you have", () => {
    test("dev builds never count, whichever listing comes first", () => {
        const have = versionsYouHave([
            { id: "a", version: "1.0.0" },
            { id: "b", version: "2.0.0", dev: true },
            { id: "b", version: "2.0.0" },
            { id: "c" },
        ]);
        expect([...have]).toEqual([["a", "1.0.0"]]);
    });

    test("the plugin itself is left out, and the first version listed wins", () => {
        expect([...versionsYouHave([{ id: "a", version: "1.0.0" }, { id: "a", version: "0.9.0" }, { id: "x", version: "1.0.0" }], "x")]).toEqual([["a", "1.0.0"]]);
    });
});

describe("plugins a store plugin clashes with", () => {
    const clashes = parseClashes([clash()]);

    test("from either side of the clash", () => {
        expect(clashingWith(clashes, "platform-indicators", "1.2.0", new Map([["platform-indicators-plus", "1.0.3"]]))).toEqual(["platform-indicators-plus"]);
        expect(clashingWith(clashes, "platform-indicators-plus", "1.0.3", new Map([["platform-indicators", "1.2.0"]]))).toEqual(["platform-indicators"]);
    });

    test("only at the versions that were checked", () => {
        // You have another version of the other plugin: it may be fine
        expect(clashingWith(clashes, "platform-indicators", "1.2.0", new Map([["platform-indicators-plus", "1.0.4"]]))).toEqual([]);
        // The store's version of this one isn't the one checked
        expect(clashingWith(clashes, "platform-indicators", "1.2.1", new Map([["platform-indicators-plus", "1.0.3"]]))).toEqual([]);
    });

    test("nothing when you don't have the other one, and each plugin once", () => {
        expect(clashingWith(clashes, "platform-indicators", "1.2.0", new Map())).toEqual([]);
        const twice = parseClashes([clash(), clash({ module: "1", patch: 1 }), clash({ kind: "compile", module: "2", patch: undefined })]);
        expect(clashingWith(twice, "platform-indicators", "1.2.0", new Map([["platform-indicators-plus", "1.0.3"]]))).toEqual(["platform-indicators-plus"]);
    });

    test("a dev build on your side is never a clash", () => {
        const have = versionsYouHave([{ id: "platform-indicators-plus", version: "1.0.3", dev: true }]);
        expect(clashingWith(clashes, "platform-indicators", "1.2.0", have)).toEqual([]);
    });

    test("malformed clashes from evi.rest are left out", () => {
        expect(parseClashes([clash({ by: "Not An Id" }), clash({ breaks: "platform-indicators-plus" }), clash({ kind: "maybe" as never }), "x", null])).toEqual([]);
        expect(parseClashes("nope")).toEqual([]);
    });
});

describe("the clash strings", () => {
    const keys = ["store.clash.title", "store.clash.titleInstalled", "store.clash.bodyOne", "store.clash.bodyMany", "store.clash.badgeOne", "store.clash.badgeMany"];
    test("every language has them, with the same placeholders as English", () => {
        const en = CATALOGS.en as Record<string, unknown>;
        for (const [lang, messages] of Object.entries(CATALOGS) as [string, Record<string, unknown>][]) {
            for (const key of keys) {
                expect(typeof messages[key], `${lang} ${key}`).toBe("string");
                const vars = (s: unknown) => [...String(s).matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort();
                expect(vars(messages[key]), `${lang} ${key}`).toEqual(vars(en[key]));
            }
        }
    });
});
