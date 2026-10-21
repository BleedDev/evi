import { describe, expect, test } from "bun:test";

import { cleanLink, cleanMessage, DEFAULT_PARAMS } from "../plugins/clear-urls/clean";

const params = new Set(DEFAULT_PARAMS);

describe("Clear URLs", () => {
    test("tracking parameters go, the rest of the link stays as written", () => {
        expect(cleanLink("https://youtu.be/abc?si=XYZ", params)).toBe("https://youtu.be/abc");
        expect(cleanLink("https://youtube.com/watch?si=x&v=abc", params)).toBe("https://youtube.com/watch?v=abc");
        expect(cleanLink("https://example.com/?q=a%20b+c&utm_source=x&t=1#top", params)).toBe("https://example.com/?q=a%20b+c&t=1#top");
        expect(cleanLink("https://example.com/?q=1#utm_source=x", params)).toBe("https://example.com/?q=1#utm_source=x");
        expect(cleanLink("https://example.com/a?b=1", params)).toBe("https://example.com/a?b=1");
    });

    test("spoilers, bold, strikethrough and masked links keep their closing marker", () => {
        expect(cleanMessage("||https://youtu.be/abc?si=XYZ||", params)).toBe("||https://youtu.be/abc||");
        expect(cleanMessage("**https://youtu.be/abc?si=XYZ**", params)).toBe("**https://youtu.be/abc**");
        expect(cleanMessage("~~https://youtu.be/abc?si=XYZ~~", params)).toBe("~~https://youtu.be/abc~~");
        expect(cleanMessage("[watch](https://youtu.be/abc?si=XYZ) now", params)).toBe("[watch](https://youtu.be/abc) now");
        expect(cleanMessage("[w](https://youtube.com/watch?si=x&v=abc)", params)).toBe("[w](https://youtube.com/watch?v=abc)");
        expect(cleanMessage("(see https://youtu.be/abc?si=XYZ)", params)).toBe("(see https://youtu.be/abc)");
    });

    test("punctuation after a link stays, brackets inside it too", () => {
        expect(cleanMessage("watch this: https://youtu.be/abc?si=XYZ.", params)).toBe("watch this: https://youtu.be/abc.");
        expect(cleanMessage("https://youtu.be/abc?si=XYZ!?", params)).toBe("https://youtu.be/abc!?");
        expect(cleanMessage("https://en.wikipedia.org/wiki/Foo_(bar)?utm_source=x", params)).toBe("https://en.wikipedia.org/wiki/Foo_(bar)");
    });

    test("code is left alone", () => {
        const msg = "`https://youtu.be/a?si=1` https://youtu.be/b?si=2\n```\nhttps://youtu.be/c?si=3\n```";
        expect(cleanMessage(msg, params)).toBe("`https://youtu.be/a?si=1` https://youtu.be/b\n```\nhttps://youtu.be/c?si=3\n```");
        expect(cleanMessage("no links here", params)).toBe("no links here");
    });
});
