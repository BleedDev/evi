import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";

import { COVERS } from "../src/renderer/ui/covers";
import { latestRelease, localizedRelease, mergeReleases, RELEASES, releasesSince } from "../src/shared/changelog";
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

describe("What's new from releases.json", () => {
    const read = async (seen: unknown, locale: unknown, current: string, coreDir = dir) => {
        const previous = globalThis.__eviCoreDir;
        globalThis.__eviCoreDir = coreDir;
        try {
            const { readWhatsNew } = await import("../src/main/whatsNew");
            return readWhatsNew(seen, locale, current);
        } finally {
            globalThis.__eviCoreDir = previous;
        }
    };

    test("after an update: the releases since the one last seen, as one, in the page's language", async () => {
        const current = RELEASES[0].version, seen = RELEASES[3].version;
        const want = mergeReleases(releasesSince(seen, current).map(r => localizedRelease(r, "de-DE")));
        const notes = await read(seen, "de-DE", current);
        expect(notes?.release).toEqual(want);
        expect(notes?.coverSvg).toBe(want.cover ? COVERS[want.cover] : undefined);
    });

    test("the panel's link: the newest release, with its cover when Evi has one", async () => {
        const notes = await read(null, "ja", "1.0.0");
        expect(notes?.release).toEqual(mergeReleases([localizedRelease(latestRelease("1.0.0")!, "ja")]));
        expect(notes?.coverSvg).toBe(COVERS["1.0.0"]);
    });

    test("nothing to show, a bad request or no file: null", async () => {
        expect(await read(RELEASES[0].version, "en", RELEASES[0].version)).toBeNull();
        expect(await read(5, "en", RELEASES[0].version)).toBeNull();
        expect(await read(null, undefined, RELEASES[0].version)).toBeNull();
        expect(await read(null, "en", RELEASES[0].version, join(dir, "missing"))).toBeNull();
    });
});
