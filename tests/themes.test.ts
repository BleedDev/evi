import { describe, expect, test } from "bun:test";

import { isPlainThemeFileName, parseThemeMeta, themeFileName, whyNotCss } from "../src/shared/themes";

describe("theme metadata", () => {
    test("reads a BetterDiscord header", () => {
        const css = `/**
 * @name Midnight
 * @description A dark theme with a mail@example.com in it
 * @author someone
 * @version 1.2.0
 * @website https://example.com
 */
:root { --x: 1; }`;
        expect(parseThemeMeta(css, "midnight.css")).toEqual({
            file: "midnight.css",
            name: "Midnight",
            description: "A dark theme with a mail@example.com in it",
            author: "someone",
            version: "1.2.0",
        });
    });

    test("tags on one line, CRLF and a BOM", () => {
        const meta = parseThemeMeta(String.fromCharCode(0xfeff) + "/** @name One Line @author A B */\r\nbody{}", "x.css");
        expect(meta.name).toBe("One Line");
        expect(meta.author).toBe("A B");
        expect(parseThemeMeta("/**\r\n * @name Crlf\r\n * @version 2\r\n */", "x.css")).toMatchObject({ name: "Crlf", version: "2" });
    });

    test("falls back to the file name", () => {
        expect(parseThemeMeta("body { color: red; }", "My Theme.CSS").name).toBe("My Theme");
        // Only the leading comment counts as a header
        expect(parseThemeMeta("body{}\n/** @name Later */", "a.css").name).toBe("a");
    });
});

describe("remote themes", () => {
    test("accepts CSS, rejects pages and binaries", () => {
        expect(whyNotCss("body { color: red }", "text/css; charset=utf-8")).toBeUndefined();
        expect(whyNotCss("@import url('https://x/y.css');", "text/plain")).toBeUndefined();
        expect(whyNotCss("<!doctype html><html>", "text/plain")).toBeDefined();
        expect(whyNotCss("body{}", "text/html")).toBeDefined();
        expect(whyNotCss("a\0b{}", "")).toBeDefined();
        expect(whyNotCss("just words", "text/plain")).toBeDefined();
    });

    test("file names are safe", () => {
        expect(themeFileName(new URL("https://x.dev/themes/Clear%20Vision.theme.css"), {})).toBe("Clear-Vision.theme.css");
        expect(themeFileName(new URL("https://x.dev/raw?id=4"), { name: "../../evil" })).toBe("evil.css");
        expect(themeFileName(new URL("https://x.dev/"), { name: "" })).toBe("x.dev.css");
        // A % that isn't an escape doesn't throw, and every name can be deleted again
        expect(themeFileName(new URL("https://x.dev/dark%E0.css"), {})).toBe("dark-E0.css");
        for (const [url, name] of [["https://x.dev/my..theme.css", undefined], ["https://x.dev/a.", "Night."], ["https://x.dev/", "x".repeat(79) + ".y"]] as const) {
            expect(isPlainThemeFileName(themeFileName(new URL(url), { name }))).toBe(true);
        }
        expect(themeFileName(new URL("https://x.dev/my..theme.css"), {})).toBe("my.theme.css");
    });
});

describe("localized theme headers", () => {
    test("@name:xx and @description:xx become locales", () => {
        const css = `/**
 * @name Midnight
 * @name:de Mitternacht
 * @name:pt-BR Meia-noite
 * @description True black
 * @description:de Tiefschwarz
 * @author Evi
 * @author:de ignored
 * @version 1.0.0
 */
body{}`;
        const meta = parseThemeMeta(css, "midnight.css");
        expect(meta).toMatchObject({ name: "Midnight", description: "True black", author: "Evi", version: "1.0.0" });
        expect(meta.locales).toEqual({ de: { name: "Mitternacht", description: "Tiefschwarz" }, "pt-BR": { name: "Meia-noite" } });
    });

    test("themes without any have no locales, and the shipped themes list every language", () => {
        expect(parseThemeMeta("/** @name A */", "a.css")).not.toHaveProperty("locales");
        for (const file of ["aurora.css", "midnight.css"]) {
            const meta = parseThemeMeta(require("fs").readFileSync(`${import.meta.dir}/../themes/${file}`, "utf8"), file);
            expect(Object.keys(meta.locales ?? {}).sort()).toEqual(["de", "es", "fr", "ja", "pl", "pt-BR", "ru", "tr"]);
            for (const l of Object.values(meta.locales!)) expect(l.name && l.description).toBeTruthy();
        }
    });
});

describe("theme file names for deleting", () => {
    test("accepts plain .css names", () => {
        for (const file of ["midnight.css", "My Theme.CSS", "a-b_c.1.css"]) expect(isPlainThemeFileName(file)).toBe(true);
    });

    test("refuses anything that isn't a plain file name", () => {
        for (const file of ["../x.css", "..\\x.css", "a/b.css", "a\\b.css", "..css", ".hidden.css", "x.css.evi-tmp", "x.txt", ".css", "", "C:x.css", "a\0b.css", " x.css"]) {
            expect(isPlainThemeFileName(file)).toBe(false);
        }
        for (const file of [undefined, null, 5, {}, ["a.css"]]) expect(isPlainThemeFileName(file)).toBe(false);
    });
});
