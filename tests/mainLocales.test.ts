import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "fs";
import { join } from "path";

import { MAIN_KEYS, mainLocales, strayKeys } from "../scripts/mainLocales";
import { CATALOGS } from "../src/shared/locales";

const ROOT = join(import.meta.dir, "..");

describe("main's locale tables", () => {
    test("main.js carries every key main names, and only main's keys", async () => {
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
        expect(mainJs).toContain(JSON.stringify(CATALOGS.ru!["main.backup.notJson"]));
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
