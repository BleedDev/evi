import { describe, expect, test } from "bun:test";

import { fixLink, fixMessage, SERVICES } from "../plugins/fix-embeds/fix";

const defaults = Object.fromEntries(SERVICES.map(s => [s.id, s.sites[0]]));

describe("Fix Embeds", () => {
    test("posts go through the fix-up site, without the share tracking", () => {
        expect(fixLink("https://x.com/evi/status/1234567890?s=20", defaults)).toBe("https://fixupx.com/evi/status/1234567890");
        expect(fixLink("https://twitter.com/evi/status/1", defaults)).toBe("https://fixupx.com/evi/status/1");
        expect(fixLink("https://mobile.x.com/evi/status/1", defaults)).toBe("https://fixupx.com/evi/status/1");
        expect(fixLink("https://www.instagram.com/reel/Cx1abc/?igsh=xyz", defaults)).toBe("https://kkinstagram.com/reel/Cx1abc/");
        expect(fixLink("https://www.instagram.com/p/Cx1abc/", defaults)).toBe("https://kkinstagram.com/p/Cx1abc/");
        expect(fixLink("https://www.tiktok.com/@someone/video/7300000000000000000?is_from_webapp=1", defaults)).toBe("https://tnktok.com/@someone/video/7300000000000000000");
        expect(fixLink("https://vm.tiktok.com/ZMabc123/", defaults)).toBe("https://vm.tnktok.com/ZMabc123/");
        expect(fixLink("https://old.reddit.com/r/discordapp/comments/abc/title/", defaults)).toBe("https://rxddit.com/r/discordapp/comments/abc/title/");
        expect(fixLink("https://bsky.app/profile/evi.rest/post/3kabc", defaults)).toBe("https://fxbsky.app/profile/evi.rest/post/3kabc");
        expect(fixLink("https://www.threads.net/@evi/post/C1abc", defaults)).toBe("https://vxthreads.net/@evi/post/C1abc");
        expect(fixLink("https://www.pixiv.net/en/artworks/123", defaults)).toBe("https://phixiv.net/en/artworks/123");
    });

    test("profiles, home pages and other sites stay as they are", () => {
        for (const link of ["https://x.com/evi", "https://x.com/home", "https://www.instagram.com/evi/", "https://www.tiktok.com/foryou", "https://www.reddit.com/r/discordapp/", "https://example.com/x.com/evi/status/1", "https://notx.com/evi/status/1", "https://a.b.x.com/evi/status/1", "https://ads.tiktok.com/t/abc"]) {
            expect(fixLink(link, defaults)).toBe(link);
        }
    });

    test("a service set to Leave as is, or another site, follows the setting", () => {
        expect(fixLink("https://x.com/evi/status/1", { ...defaults, twitter: "off" })).toBe("https://x.com/evi/status/1");
        expect(fixLink("https://x.com/evi/status/1", { ...defaults, twitter: "vxtwitter.com" })).toBe("https://vxtwitter.com/evi/status/1");
    });

    test("code and <links without an embed> are left alone; the rest of the message too", () => {
        const msg = "look https://x.com/a/status/1 and <https://x.com/b/status/2> `https://x.com/c/status/3`\n```\nhttps://x.com/d/status/4\n```\n[here](https://x.com/e/status/5)";
        expect(fixMessage(msg, defaults)).toBe("look https://fixupx.com/a/status/1 and <https://x.com/b/status/2> `https://x.com/c/status/3`\n```\nhttps://x.com/d/status/4\n```\n[here](https://fixupx.com/e/status/5)");
        expect(fixMessage("no links here", defaults)).toBe("no links here");
    });

    test("spoilers, bold and punctuation after a link with a query are kept", () => {
        expect(fixMessage("||https://x.com/a/status/1?s=20||", defaults)).toBe("||https://fixupx.com/a/status/1||");
        expect(fixMessage("**https://x.com/a/status/1?s=20**", defaults)).toBe("**https://fixupx.com/a/status/1**");
        expect(fixMessage("~~https://x.com/a/status/1?s=20~~", defaults)).toBe("~~https://fixupx.com/a/status/1~~");
        expect(fixMessage("look: https://www.instagram.com/reel/Cx1abc/?igsh=xyz.", defaults)).toBe("look: https://kkinstagram.com/reel/Cx1abc/.");
        expect(fixMessage("[here](https://x.com/a/status/1?t=abc) ok", defaults)).toBe("[here](https://fixupx.com/a/status/1) ok");
    });
});
