import { describe, expect, test } from "bun:test";

import { compareCatalog, format, matchLocale, Messages, pickPlural, translate } from "../src/shared/i18n";
import { CATALOGS, LOCALES } from "../src/shared/locales";
import { en } from "../src/shared/locales/en";

const catalogs: Record<string, Messages> = {
    en: {
        hello: "Hello, {name}",
        plain: "Plain",
        files: { one: "{count} file", other: "{count} files" },
        onlyEnglish: "Only in English",
    },
    ru: {
        hello: "Привет, {name}",
        files: { one: "{count} файл", few: "{count} файла", many: "{count} файлов", other: "{count} файла" },
    },
    ja: {
        files: { other: "{count} 個のファイル" },
    },
};

describe("t()", () => {
    test("fills placeholders and leaves unknown ones alone", () => {
        expect(translate(catalogs, "en", "hello", { name: "Ada" })).toBe("Hello, Ada");
        expect(translate(catalogs, "en", "hello")).toBe("Hello, {name}");
        expect(format("{a} and {b}", { a: 1 })).toBe("1 and {b}");
        expect(format("{a}{a}", { a: "x" })).toBe("xx");
    });

    test("falls back to English, then to the key itself", () => {
        expect(translate(catalogs, "ru", "hello", { name: "Ада" })).toBe("Привет, Ада");
        expect(translate(catalogs, "ru", "onlyEnglish")).toBe("Only in English");
        expect(translate(catalogs, "xx", "plain")).toBe("Plain");
        expect(translate(catalogs, "ru", "nowhere")).toBe("nowhere");
    });

    test("plurals follow each language's rules", () => {
        expect(translate(catalogs, "en", "files", { count: 1 })).toBe("1 file");
        expect(translate(catalogs, "en", "files", { count: 0 })).toBe("0 files");
        expect(translate(catalogs, "en", "files", { count: 2 })).toBe("2 files");
        expect(translate(catalogs, "ru", "files", { count: 1 })).toBe("1 файл");
        expect(translate(catalogs, "ru", "files", { count: 3 })).toBe("3 файла");
        expect(translate(catalogs, "ru", "files", { count: 5 })).toBe("5 файлов");
        expect(translate(catalogs, "ru", "files", { count: 21 })).toBe("21 файл");
        expect(translate(catalogs, "ja", "files", { count: 1 })).toBe("1 個のファイル");
        // A missing form uses `other`
        expect(pickPlural({ other: "x" }, "en", 1)).toBe("x");
    });

    test("an English plural used as a fallback picks English forms", () => {
        const onlyEn = { en: { n: { one: "{count} thing", other: "{count} things" } }, pl: {} };
        expect(translate(onlyEn, "pl", "n", { count: 1 })).toBe("1 thing");
        expect(translate(onlyEn, "pl", "n", { count: 5 })).toBe("5 things");
    });
});

describe("matchLocale", () => {
    test("Discord's tags map onto Evi's languages", () => {
        expect(matchLocale("en-US", LOCALES)).toBe("en");
        expect(matchLocale("en-GB", LOCALES)).toBe("en");
        expect(matchLocale("es-ES", LOCALES)).toBe("es");
        expect(matchLocale("es-419", LOCALES)).toBe("es");
        expect(matchLocale("pt-BR", LOCALES)).toBe("pt-BR");
        expect(matchLocale("pt_br", LOCALES)).toBe("pt-BR");
        expect(matchLocale("pt-PT", LOCALES)).toBe("pt-BR");
        expect(matchLocale("fr", LOCALES)).toBe("fr");
        expect(matchLocale("de", LOCALES)).toBe("de");
        expect(matchLocale("tr", LOCALES)).toBe("tr");
        expect(matchLocale("ru", LOCALES)).toBe("ru");
        expect(matchLocale("pl", LOCALES)).toBe("pl");
        expect(matchLocale("ja", LOCALES)).toBe("ja");
    });

    test("languages Evi doesn't have yet match nothing", () => {
        expect(matchLocale("zh-CN", LOCALES)).toBeUndefined();
        expect(matchLocale("", LOCALES)).toBeUndefined();
        expect(matchLocale(undefined, LOCALES)).toBeUndefined();
    });

    test("an exact tag wins over the bare language", () => {
        expect(matchLocale("pt-BR", ["pt", "pt-BR"])).toBe("pt-BR");
        expect(matchLocale("pt-PT", ["pt", "pt-BR"])).toBe("pt");
    });
});

const placeholders = (m: unknown) => new Set([...JSON.stringify(m).matchAll(/\{(\w+)\}/g)].map(x => x[1]));

describe("Evi's catalogs", () => {
    test("the languages Evi ships", () => {
        expect(LOCALES.sort()).toEqual(["de", "en", "es", "fr", "ja", "pl", "pt-BR", "ru", "tr"]);
    });

    for (const locale of LOCALES.filter(l => l !== "en")) {
        test(`${locale}: no keys English lacks, none missing`, () => {
            const { extra, missing } = compareCatalog(en, CATALOGS[locale]);
            expect(extra).toEqual([]);
            // A missing key shows in English; this names them so they get translated
            if (missing.length) console.warn(`${locale} is missing ${missing.length} keys:\n  ${missing.join("\n  ")}`);
            expect(missing).toEqual([]);
        });

        test(`${locale}: placeholders match English`, () => {
            const wrong: string[] = [];
            for (const [key, message] of Object.entries(CATALOGS[locale])) {
                const source = en[key as keyof typeof en];
                if (source === undefined || message === undefined) continue;
                const want = [...placeholders(source)].sort().join(",");
                // Plural messages may drop {count} in a form ("once"), but can't invent placeholders
                const have = [...placeholders(message)].filter(p => !placeholders(source).has(p));
                if (have.length) wrong.push(`${key}: unknown {${have.join("}, {")}}`);
                if (typeof message === "string" && typeof source === "string" && [...placeholders(message)].sort().join(",") !== want) {
                    wrong.push(`${key}: has {${[...placeholders(message)].join("}, {")}}, English has {${want}}`);
                }
                if (typeof message === "object" && !("other" in message)) wrong.push(`${key}: plural without "other"`);
            }
            expect(wrong).toEqual([]);
        });
    }
});

describe("dates (kept formatters)", () => {
    test("timeAgo and localeDate read as before, and a formatter is made once", async () => {
        const { dateFormat, I18n, localeDate, timeAgo } = await import("../src/renderer/i18n");
        const now = Date.UTC(2026, 9, 21, 12);
        const relative = new Intl.RelativeTimeFormat(I18n.discordLocale, { numeric: "auto" });
        expect(timeAgo(now - 5 * 60_000, now)).toBe(relative.format(-5, "minute"));
        expect(timeAgo(now - 86_400_000, now)).toBe(relative.format(-1, "day"));
        for (const options of [{ dateStyle: "medium" }, { dateStyle: "medium", timeStyle: "short" }, { year: "numeric", month: "short", day: "numeric" }] as const) {
            expect(localeDate(new Date(now), options)).toBe(new Date(now).toLocaleString(I18n.discordLocale, options));
            expect(dateFormat({ ...options })).toBe(dateFormat(options));
        }
        expect(localeDate(new Date("not a date"), { dateStyle: "medium" })).toBe(new Date(NaN).toLocaleDateString(I18n.discordLocale, { dateStyle: "medium" }));
    });
});

describe("defineStrings (plugins)", () => {
    test("uses English outside Discord, with placeholders and plurals", async () => {
        const { defineStrings } = await import("../src/renderer/i18n");
        const t = defineStrings({
            en: { copied: "Copied {name}", messages: { one: "{count} message", other: "{count} messages" } },
            es: { copied: "Se copió {name}" },
            ru: { messages: { one: "{count} сообщение", few: "{count} сообщения", many: "{count} сообщений", other: "{count} сообщения" } },
        });
        expect(t("copied", { name: "Ada" })).toBe("Copied Ada");
        expect(t("messages", { count: 1 })).toBe("1 message");
        expect(t("messages", { count: 4 })).toBe("4 messages");
    });
});
