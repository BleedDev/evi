import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "fs";
import { join } from "path";

import { MAIN_KEYS, mainLocales, strayKeys } from "../scripts/mainLocales";
import { CATALOGS } from "../src/shared/locales";
import { LOCALES } from "../src/shared/locales/tags";

const ROOT = join(import.meta.dir, "..");

describe("main's locale tables", () => {
    test("main.js carries every key main names, only main's keys, and only in English", async () => {
        const result = await Bun.build({
            entrypoints: [join(ROOT, "src/main/index.ts")],
            target: "node",
            format: "cjs",
            external: ["electron", "original-fs"],
            plugins: [mainLocales],
        });
        expect(result.success).toBe(true);
        const mainJs = await result.outputs[0].text();
        expect(strayKeys(mainJs)).toEqual([]);
        expect(mainJs).not.toContain("\"perf.gameMode.title\"");
        expect(mainJs).toContain(JSON.stringify(CATALOGS.en!["main.backup.notJson"]));
        // The other languages are locale-<tag>.json files main reads when one is in use (scripts/coreData.ts)
        expect(mainJs).not.toContain(JSON.stringify(CATALOGS.ru!["main.backup.notJson"]));
    });

    // tags.ts sits beside the tables: filtered like one, LOCALES came out {} and main threw on its first setLocale
    test("main.js keeps the list of languages whole", async () => {
        const result = await Bun.build({
            entrypoints: [join(ROOT, "src/shared/locales/tags.ts")],
            target: "node",
            format: "cjs",
            plugins: [mainLocales],
        });
        expect(result.success).toBe(true);
        const module = { exports: {} as { LOCALES?: unknown; } };
        new Function("module", "exports", await result.outputs[0].text())(module, module.exports);
        expect(module.exports.LOCALES).toEqual(LOCALES);
    });

    test("the stray-key check sees a key outside MAIN_KEYS", () => {
        expect(strayKeys("tr(\"perms.title\"); mt(\"main.backup.notJson\"); x(\"not.a.key\")")).toEqual(["perms.title"]);
        expect(MAIN_KEYS.test("check.css.empty")).toBe(true);
    });

    // A key built from a template has no literal for the check to find
    test("main and shared code never build a key from a template", () => {
        const files = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(e =>
            e.isDirectory() ? (e.name === "locales" ? [] : files(join(dir, e.name))) : /\.tsx?$/.test(e.name) ? [join(dir, e.name)] : []);
        const built = [...files(join(ROOT, "src/main")), ...files(join(ROOT, "src/shared"))]
            .filter(file => /\b(mt|tr)\(\s*`/.test(readFileSync(file, "utf8")));
        expect(built).toEqual([]);
    });
});
