import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";

import { CATALOGS } from "../src/shared/locales";
import { en } from "../src/shared/locales/en";
import { LOCALES } from "../src/shared/locales/tags";

// What the build writes next to main.js (scripts/coreData.ts), in a folder of its own
const dir = mkdtempSync(join(tmpdir(), "evi-core-data-"));
const run = Bun.spawnSync([process.execPath, resolve(import.meta.dir, "../scripts/coreData.ts"), dir], { stderr: "pipe" });
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("Evi's languages, one file each", () => {
    test("tags.ts lists the catalogs, in their order", () => {
        expect(LOCALES).toEqual(Object.keys(CATALOGS));
    });

    test("the build writes every language but English, as it is", () => {
        expect(run.exitCode).toBe(0);
        for (const tag of LOCALES.filter(l => l !== "en")) {
            expect(JSON.parse(readFileSync(join(dir, `locale-${tag}.json`), "utf8"))).toEqual(CATALOGS[tag] as object);
        }
    });

    test("main reads the language in use from them, and stays English without one", async () => {
        const previous = globalThis.__eviCoreDir;
        globalThis.__eviCoreDir = dir;
        try {
            const { mt, readCatalog, setLocale } = await import("../src/main/locale");
            expect(readCatalog("en")).toBeNull();
            expect(readCatalog("../locale-de")).toBeNull();
            expect(readCatalog("xx")).toBeNull();
            expect(JSON.parse(readCatalog("pt-BR")!)).toEqual(CATALOGS["pt-BR"] as object);

            setLocale("de-DE");
            expect(mt("common.close")).toBe(CATALOGS.de["common.close"] as string);
            setLocale("ja");
            expect(mt("common.close")).toBe(CATALOGS.ja["common.close"] as string);

            globalThis.__eviCoreDir = join(dir, "missing");
            setLocale("fr");
            expect(mt("common.close")).toBe(en["common.close"]);
        } finally {
            globalThis.__eviCoreDir = previous;
            const { setLocale } = await import("../src/main/locale");
            setLocale("en");
        }
    });
});
