import { describe, expect, mock, test } from "bun:test";

import {
    cacheKey, chunkText, googleLanguage, isTranslatable, languageName, LRU, mightBeForeign, mightBeIn, normalizeLanguage, parseGoogleResponse,
    parseLanguageList, protect, RateQueue, restore, sameLanguage, shouldAutoTranslate, shouldShowAuto, translatableText, translateUrl,
} from "../plugins/inline-translate/translate";
import type { AutoOptions } from "../plugins/inline-translate/translate";
import { canonicalizeMatch, matchesFind } from "../src/renderer/patching/source";

mock.module("@evi/api", () => ({
    definePlugin: (plugin: unknown) => plugin,
    defineStrings: () => (key: string) => key,
    filters: { byCode: () => () => false },
    findMenuGroup: () => undefined,
    getStore: () => undefined,
    Menu: {},
    React: {},
}));

describe("languages", () => {
    test("normalizes locales and Google's legacy codes", () => {
        expect(normalizeLanguage("en-US")).toBe("en");
        expect(normalizeLanguage("pt_BR")).toBe("pt");
        expect(normalizeLanguage("IW")).toBe("he");
        expect(normalizeLanguage("jw")).toBe("jv");
        expect(normalizeLanguage("zh")).toBe("zh-CN");
        expect(normalizeLanguage("zh-tw")).toBe("zh-TW");
        expect(normalizeLanguage("zh-HK")).toBe("zh-TW");
        expect(normalizeLanguage("spanish")).toBeUndefined();
        expect(normalizeLanguage("")).toBeUndefined();
        expect(googleLanguage(undefined)).toBe("en");
        expect(googleLanguage("de")).toBe("de");
    });

    test("sameLanguage ignores regions except for Chinese", () => {
        expect(sameLanguage("en-GB", "en")).toBe(true);
        expect(sameLanguage("iw", "he")).toBe(true);
        expect(sameLanguage("zh-CN", "zh-TW")).toBe(false);
        expect(sameLanguage("es", "pt")).toBe(false);
        expect(sameLanguage(undefined, "en")).toBe(false);
    });

    test("parses a free-form language list", () => {
        expect(parseLanguageList("es, ja, de")).toEqual(["es", "ja", "de"]);
        expect(parseLanguageList(" ES;ja  pt-BR, es, nonsense, zh-tw ")).toEqual(["es", "ja", "pt", "zh-TW"]);
        expect(parseLanguageList("")).toEqual([]);
        expect(parseLanguageList(undefined)).toEqual([]);
    });

    test("language names in the UI language, falling back to the code", () => {
        expect(languageName("es", "en")).toBe("Spanish");
        expect(languageName("iw", "en")).toBe("Hebrew");
        expect(languageName("de", "de")).toBe("Deutsch");
        expect(languageName("not a code", "en")).toBe("not a code");
    });
});

describe("Google's response", () => {
    test("joins the translated segments and reads the detected language", () => {
        const data = [[["Hello ", "Hola ", null, null, 10], ["world", "mundo", null, null, 10]], null, "es", null, null, null, 1, [], [["es"], null, [1], ["es"]]];
        expect(parseGoogleResponse(data)).toEqual({ text: "Hello world", source: "es" });
    });

    test("falls back to the language in [8] and normalizes it", () => {
        const data = [[["Shalom", "שלום", null, null, 3]], null, null, null, null, null, null, null, [["iw"], null, [1], ["iw"]]];
        expect(parseGoogleResponse(data)).toEqual({ text: "Shalom", source: "he" });
    });

    test("skips odd segments and rejects answers it can't read", () => {
        expect(parseGoogleResponse([[["a", "x"], null, [null, "y"], ["b", "z"]], null, "fr"]).text).toBe("ab");
        expect(() => parseGoogleResponse({})).toThrow();
        expect(() => parseGoogleResponse([[["a", "b"]], null, null])).toThrow();
    });

    test("builds the gtx URL", () => {
        expect(translateUrl("¿Qué tal? & más", "zh-TW")).toBe(
            "https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=zh-TW&dt=t&q=%C2%BFQu%C3%A9%20tal%3F%20%26%20m%C3%A1s",
        );
    });
});

describe("chunkText", () => {
    test("short text is one chunk", () => {
        expect(chunkText("hola", 100)).toEqual(["hola"]);
    });

    test("splits at line breaks, sentences, then spaces, and joins back to the input", () => {
        const lines = "first line here\nsecond line here\nthird line here";
        const byLine = chunkText(lines, 40);
        expect(byLine.join("")).toBe(lines);
        expect(byLine[0]).toBe("first line here\n");
        for (const c of byLine) expect(encodeURIComponent(c).length).toBeLessThanOrEqual(40);

        const sentences = "One sentence here. Another one follows. And a third.";
        const bySentence = chunkText(sentences, 30);
        expect(bySentence.join("")).toBe(sentences);
        expect(bySentence[0]).toBe("One sentence here.");

        const long = "x".repeat(25);
        expect(chunkText(long, 10)).toEqual(["x".repeat(10), "x".repeat(10), "x".repeat(5)]);
    });

    test("never splits a surrogate pair", () => {
        const text = "😀".repeat(10);
        const chunks = chunkText(text, 30);
        expect(chunks.join("")).toBe(text);
        for (const c of chunks) expect(() => encodeURIComponent(c)).not.toThrow();
    });
});

describe("protect / restore", () => {
    test("code, links, mentions and emoji survive translation", () => {
        const input = "mira <@123> este `código` y https://example.com/a?b=1 <:pepe:456> :smile: @everyone\n```js\nconst x = 1;\n```";
        const { text, tokens } = protect(input);
        expect(tokens).toEqual(["<@123>", "`código`", "https://example.com/a?b=1", "<:pepe:456>", ":smile:", "@everyone", "```js\nconst x = 1;\n```"]);
        expect(text).toBe("mira ⟦0⟧ este ⟦1⟧ y ⟦2⟧ ⟦3⟧ ⟦4⟧ ⟦5⟧\n⟦6⟧");

        // Google may add spaces inside the markers and reorder them
        const translated = "look at this ⟦ 1 ⟧ ⟦0⟧ and ⟦2⟧ ⟦3⟧ ⟦4⟧ ⟦5⟧\n⟦6⟧";
        expect(restore(translated, tokens)).toBe("look at this `código` <@123> and https://example.com/a?b=1 <:pepe:456> :smile: @everyone\n```js\nconst x = 1;\n```");
    });

    test("markers Google dropped are appended, unknown ones are left alone", () => {
        expect(restore("hello", ["<@1>"])).toBe("hello <@1>");
        expect(restore("hello", ["```a```"])).toBe("hello\n```a```");
        expect(restore("hello ⟦7⟧", [])).toBe("hello ⟦7⟧");
    });

    test("markdown outside protected parts is kept as is", () => {
        const { text, tokens } = protect("**hola** _mundo_ > cita <#99> <t:1700000000:R>");
        expect(text).toBe("**hola** _mundo_ > cita ⟦0⟧ ⟦1⟧");
        expect(tokens).toEqual(["<#99>", "<t:1700000000:R>"]);
    });
});

describe("skip rules", () => {
    test("nothing to translate in code, links, mentions or emoji", () => {
        expect(isTranslatable("```\nconst hola = 1\n```")).toBe(false);
        expect(isTranslatable("`inline code`")).toBe(false);
        expect(isTranslatable("https://example.com/hola-mundo")).toBe(false);
        expect(isTranslatable("<@123> <:pepe:456> 😀👍🏽🇪🇸")).toBe(false);
        expect(isTranslatable(":joy: :joy:")).toBe(false);
        expect(isTranslatable("12345 !!! ???")).toBe(false);
        expect(isTranslatable("a")).toBe(false);
        expect(isTranslatable("")).toBe(false);
        expect(isTranslatable(null)).toBe(false);
    });

    test("real words are translatable, whatever the script", () => {
        expect(isTranslatable("hola")).toBe(true);
        expect(isTranslatable("日本")).toBe(true);
        expect(isTranslatable("<@1> mira esto https://x.com 😀")).toBe(true);
        expect(translatableText("<@1> **mira** esto! https://x.com 😀")).toBe("mira esto");
    });

    test("answers stay right when asked again and after the cache fills up", () => {
        for (let round = 0; round < 2; round++) {
            expect(isTranslatable("hola amigo")).toBe(true);
            expect(isTranslatable("`code only`")).toBe(false);
        }
        for (let i = 0; i < 1500; i++) expect(isTranslatable(`${i} ${i % 2 ? "ok" : "!"}`)).toBe(i % 2 === 1);
        expect(isTranslatable("hola amigo")).toBe(true);
        expect(isTranslatable("`code only`")).toBe(false);
    });

    test("script hints only rule out what certainly doesn't match", () => {
        expect(mightBeIn("hello there", ["ja", "ko"])).toBe(false);
        expect(mightBeIn("こんにちは", ["ja"])).toBe(true);
        expect(mightBeIn("你好", ["ja"])).toBe(true);
        expect(mightBeIn("hola amigo", ["es"])).toBe(true);
        expect(mightBeIn("привет", ["es"])).toBe(false);
        expect(mightBeIn("привет", ["ru", "es"])).toBe(true);
        expect(mightBeForeign("안녕하세요", "ko")).toBe(false);
        expect(mightBeForeign("안녕하세요 hi", "ko")).toBe(true);
        expect(mightBeForeign("hello", "en")).toBe(true);
        expect(mightBeForeign("привет", "ru")).toBe(true);
    });
});

describe("automatic mode", () => {
    const base: AutoOptions = { mode: "list", languages: ["es", "ja"], target: "en", currentUserId: "me", ignoreBots: true };
    const msg = (content: string, extra: Record<string, unknown> = {}) => ({ id: "1", type: 0, content, author: { id: "them" }, ...extra });

    test("asks Google only about messages that could qualify", () => {
        expect(shouldAutoTranslate(msg("hola, ¿qué tal?"), base)).toBe(true);
        expect(shouldAutoTranslate(msg("hola"), { ...base, mode: "off" })).toBe(false);
        expect(shouldAutoTranslate(msg("hola"), { ...base, languages: [] })).toBe(false);
        expect(shouldAutoTranslate(msg("hola", { author: { id: "me" } }), base)).toBe(false);
        expect(shouldAutoTranslate(msg("hola", { author: { id: "bot", bot: true } }), base)).toBe(false);
        expect(shouldAutoTranslate(msg("hola", { author: { id: "bot", bot: true } }), { ...base, ignoreBots: false })).toBe(true);
        expect(shouldAutoTranslate(msg("hola", { type: 7 }), base)).toBe(false);
        expect(shouldAutoTranslate(msg("hola", { type: 19 }), base)).toBe(true);
        expect(shouldAutoTranslate(msg("😀 https://x.com"), base)).toBe(false);
        expect(shouldAutoTranslate(msg("привет"), base)).toBe(false);
        expect(shouldAutoTranslate(msg("привет"), { ...base, mode: "foreign" })).toBe(true);
        expect(shouldAutoTranslate(msg("안녕하세요"), { ...base, mode: "foreign", target: "ko" })).toBe(false);
        expect(shouldAutoTranslate({ id: "1", content: 5 as unknown, author: { id: "x" } }, base)).toBe(false);
    });

    test("shows the result only for the right languages", () => {
        const es = { text: "hello, how are you?", source: "es" };
        expect(shouldShowAuto(es, "hola, ¿qué tal?", base)).toBe(true);
        expect(shouldShowAuto({ ...es, source: "de" }, "hallo", base)).toBe(false);
        expect(shouldShowAuto({ ...es, source: "de" }, "hallo", { ...base, mode: "foreign" })).toBe(true);
        expect(shouldShowAuto({ text: "hello", source: "en" }, "hello", { ...base, mode: "foreign" })).toBe(false);
        expect(shouldShowAuto({ text: "Hello", source: "en-US" }, "hellO", { ...base, mode: "foreign", target: "en" })).toBe(false);
        expect(shouldShowAuto(es, "hola", { ...base, mode: "off" })).toBe(false);
        // Google gave the same thing back: a name, "jajaja"
        expect(shouldShowAuto({ text: "Jajaja!", source: "es" }, "jajaja", base)).toBe(false);
    });
});

describe("LRU", () => {
    test("forgets the least recently used past capacity", () => {
        const lru = new LRU<string, number>(2);
        lru.set("a", 1).set("b", 2);
        expect(lru.get("a")).toBe(1);
        lru.set("c", 3);
        expect(lru.has("b")).toBe(false);
        expect([...lru.keys()]).toEqual(["a", "c"]);
        expect(lru.peek("a")).toBe(1);
        lru.set("d", 4);
        expect(lru.has("a")).toBe(false);
        expect(lru.size).toBe(2);
        lru.set("c", 30);
        expect(lru.get("c")).toBe(30);
        lru.delete("c");
        lru.clear();
        expect(lru.size).toBe(0);
    });

    test("keys by message and target language", () => {
        expect(cacheKey("123", "en")).not.toBe(cacheKey("123", "de"));
    });
});

describe("RateQueue", () => {
    const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

    test("one job at a time, spaced by the interval, urgent first, oldest dropped", async () => {
        const order: string[] = [];
        const dropped: string[] = [];
        const q = new RateQueue(20, 2, key => dropped.push(key));
        const job = (key: string) => async () => { order.push(key); };

        q.add("a", job("a"));
        q.add("b", job("b"));
        q.add("c", job("c"));
        q.add("d", job("d")); // drops b (a already started)
        q.add("c", job("c-again")); // same key: ignored
        q.add("u", job("u"), true);
        expect(dropped).toEqual(["b"]);
        expect(q.has("u")).toBe(true);

        const start = Date.now();
        await sleep(120);
        expect(order).toEqual(["a", "u", "c", "d"]);
        expect(Date.now() - start).toBeGreaterThanOrEqual(55);
        q.stop();
    });

    test("an urgent add moves a queued job to the front", async () => {
        const order: string[] = [];
        const q = new RateQueue(15, 10);
        q.add("x", async () => { order.push("x"); });
        q.add("y", async () => { order.push("y"); });
        q.add("z", async () => { order.push("z"); });
        q.add("z", async () => { order.push("z!"); }, true);
        await sleep(80);
        expect(order).toEqual(["x", "z!", "y"]);
        q.stop();
    });

    test("pause delays, a failing job doesn't stop the queue, stop drops the rest", async () => {
        const order: string[] = [];
        const dropped: string[] = [];
        const q = new RateQueue(0, 10, key => dropped.push(key));
        q.pause(40);
        q.add("fail", async () => { order.push("fail"); throw new Error("boom"); });
        q.add("ok", async () => { order.push("ok"); });
        await sleep(15);
        expect(order).toEqual([]);
        await sleep(60);
        expect(order).toEqual(["fail", "ok"]);

        const slow = new RateQueue(1000, 10, key => dropped.push(key));
        slow.add("1", async () => {});
        slow.add("2", async () => {});
        slow.stop();
        slow.add("3", async () => {});
        expect(dropped).toEqual(["2"]);
        expect(slow.size).toBe(0);
        q.stop();
    });
});

describe("hover bar patch", () => {
    // Discord's hover bar, trimmed to the Reply button (October 2026 build, and the earlier one with a plain local)
    const sources = [
        'g&&!c?(0,a.jsx)(nt.qv,{label:eL.intl.string(eL.t["5IEsGx"]),icon:tU.W,onClick:e=>(0,tx.$b)(t,n,e)},"reply-other"):null,c?(0,a.jsx)(nt.qv,{label:eL.intl.string(eL.t.bt75uw)},"edit"):null',
        'g&&!c?(0,a.jsx)(nl,{label:eL.intl.string(eL.t["5IEsGx"]),icon:tU.W,onClick:e=>(0,tC.$b)(t,n,e)},"reply-other"):null,c?(0,a.jsx)(nl,{label:eL.intl.string(eL.t.bt75uw)},"edit"):null',
    ];

    test("adds our button right after Reply, given Discord's button, channel and message", async () => {
        const { patches } = (await import("../plugins/inline-translate/index")).default as any;
        const [patch] = patches;
        for (const code of sources) {
            expect(matchesFind(code, patch.find)).toBe(true);
            const next = code.replace(canonicalizeMatch(patch.replace.match) as RegExp, patch.replace.with.replaceAll("$self", "IT"));
            expect(next).toMatch(/,"reply-other"\):null,IT\.hoverButton\((nt\.qv|nl),t,n\),c\?/);
        }
    });
});
