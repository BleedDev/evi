import { describe, expect, test } from "bun:test";

import {
    analyzeLink, decodeHostname, editDistance, hostnameInText, meetsThreshold, mixedScriptLabels, parseAllowlist, PATCH, registrableDomain,
    skeleton,
} from "../plugins/link-safety/analyze";
import { canonicalizeMatch, matchesFind } from "../src/renderer/patching/source";

const level = (url: string, text?: string, allowlist?: string[]) => analyzeLink(url, { text, allowlist }).level;
const codes = (url: string, text?: string) => analyzeLink(url, { text }).findings.map(f => f.code);

describe("helpers", () => {
    test("registrable domain", () => {
        expect(registrableDomain("cdn.discordapp.com")).toBe("discordapp.com");
        expect(registrableDomain("discord.com")).toBe("discord.com");
        expect(registrableDomain("www.bbc.co.uk")).toBe("bbc.co.uk");
        expect(registrableDomain("discord-nitro.vercel.app")).toBe("discord-nitro.vercel.app");
        expect(registrableDomain("a.b.evil.github.io")).toBe("evil.github.io");
        expect(registrableDomain("192.168.0.1")).toBe("192.168.0.1");
    });

    test("skeleton collapses lookalikes", () => {
        expect(skeleton("dlscord")).toBe(skeleton("discord"));
        expect(skeleton("d1scord")).toBe(skeleton("discord"));
        expect(skeleton("disсord")).toBe(skeleton("discord")); // Cyrillic с
        expect(skeleton("steamcommunlty")).toBe(skeleton("steamcommunity"));
        expect(skeleton("rnicrosoft")).toBe(skeleton("microsoft"));
        expect(skeleton("paypa1")).toBe(skeleton("paypal"));
    });

    test("edit distance", () => {
        expect(editDistance("discord", "discord")).toBe(0);
        expect(editDistance("disocrd", "discord")).toBe(1);
        expect(editDistance("discordd", "discord")).toBe(1);
        expect(editDistance("kitten", "sitting")).toBe(3);
    });

    test("punycode decoding", () => {
        expect(decodeHostname("xn--80ak6aa92e.com")).toBe("аррӏе.com");
        expect(decodeHostname("xn--mnchen-3ya.de")).toBe("münchen.de");
        expect(decodeHostname("discord.com")).toBe("discord.com");
    });

    test("mixed scripts", () => {
        expect(mixedScriptLabels("disсord.com")).toEqual(["disсord"]);
        expect(mixedScriptLabels("münchen.de")).toEqual([]);
        expect(mixedScriptLabels("пример.рф")).toEqual([]);
    });

    test("hostname in link text", () => {
        expect(hostnameInText("discord.com")).toEqual({ host: "discord.com", whole: true });
        expect(hostnameInText("https://discord.com/nitro")).toEqual({ host: "discord.com", whole: true });
        expect(hostnameInText("<steamcommunity.com/gift>")).toEqual({ host: "steamcommunity.com", whole: true });
        expect(hostnameInText("claim at discord.gift/abc now")).toEqual({ host: "discord.gift", whole: false });
        expect(hostnameInText("click here")).toBeNull();
        expect(hostnameInText("v1.2.3")).toBeNull();
    });

    test("allowlist parsing", () => {
        expect(parseAllowlist("example.com, https://www.Foo.org/path\n*.bar.dev ;nope")).toEqual(["example.com", "www.foo.org", "bar.dev"]);
        expect(parseAllowlist(undefined)).toEqual([]);
    });

    test("threshold", () => {
        expect(meetsThreshold("safe", "caution")).toBe(false);
        expect(meetsThreshold("caution", "caution")).toBe(true);
        expect(meetsThreshold("caution", "danger")).toBe(false);
        expect(meetsThreshold("danger", "danger")).toBe(true);
    });
});

describe("no false positives", () => {
    const safe = [
        "https://discord.com",
        "https://discord.com/channels/123/456/789",
        "https://discord.gg/abcdef",
        "https://discord.gift/AbCdEf123456",
        "https://discord.com/billing/promotions/xyz",
        "https://cdn.discordapp.com/attachments/1/2/image.png?ex=abc&is=def&hm=123",
        "https://media.discordapp.net/attachments/1/2/video.mp4",
        "https://support.discord.com/hc/en-us/articles/123",
        "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        "https://youtu.be/dQw4w9WgXcQ",
        "https://music.youtube.com/playlist?list=abc",
        "https://github.com/user/repo/releases",
        "https://raw.githubusercontent.com/user/repo/main/README.md",
        "https://steamcommunity.com/tradeoffer/new/?partner=1",
        "https://store.steampowered.com/app/730",
        "https://steamdb.info/app/730/",
        "https://www.google.com/search?q=discord",
        "https://www.google.co.uk/maps",
        "https://www.paypal.com/myaccount",
        "https://x.com/discord/status/1",
        "https://twitter.com/discord",
        "https://www.twitch.tv/somestreamer",
        "https://www.roblox.com/games/1",
        "https://store.epicgames.com/free-games",
        "https://en.wikipedia.org/wiki/Discord",
        "https://www.reddit.com/r/discordapp/",
        "https://open.spotify.com/track/abc",
        "https://tenor.com/view/cat-gif-123",
        "https://example.com/some/page",
    ];
    for (const url of safe) {
        test(url, () => {
            const result = analyzeLink(url);
            expect(result.findings.filter(f => f.level !== "info")).toEqual([]);
            expect(result.level).toBe("safe");
        });
    }

    test("plain links whose text is the link", () => {
        expect(level("https://discord.com/channels/1/2", "https://discord.com/channels/1/2")).toBe("safe");
        expect(level("https://www.youtube.com/watch?v=x", "youtube.com/watch?v=x")).toBe("safe");
    });

    test("masked links to the same owner are fine", () => {
        expect(level("https://discord.com/invite/abc", "discord.gg/abc")).toBe("safe");
        expect(level("https://www.discord.com/", "discord.com")).toBe("safe");
        expect(level("https://youtu.be/x", "youtube.com")).toBe("safe");
        expect(level("https://example.com/docs", "Read the docs")).toBe("safe");
    });

    test("non-web links are left to Discord", () => {
        expect(level("steam://run/730")).toBe("safe");
        expect(level("spotify:track:abc")).toBe("safe");
    });
});

describe("masked links", () => {
    test("text shows a different domain", () => {
        const r = analyzeLink("https://evil.xyz/login", { text: "discord.com" });
        expect(r.level).toBe("danger");
        expect(r.findings[0].code).toBe("masked-mismatch");
        expect(r.findings[0].message).toContain("discord.com");
        expect(r.findings[0].message).toContain("evil.xyz");
    });

    test("full URL text", () => {
        expect(level("https://grabify.link/ABC", "https://discord.com/nitro")).toBe("danger");
    });

    test("mentioned domain inside text", () => {
        expect(codes("https://example.net", "Redeem your gift at discord.com today")).toContain("masked-mention");
        expect(level("https://example.net", "Redeem your gift at discord.com today")).toBe("caution");
    });

    test("text shows one official site, link goes to another", () => {
        expect(level("https://www.youtube.com/watch?v=x", "discord.com")).toBe("caution");
    });
});

describe("lookalikes", () => {
    const danger = [
        "https://dlscord.com/nitro",
        "https://d1scord.gift/abc",
        "https://discorcl.com/",
        "https://steamcommunlty.com/tradeoffer/new",
        "https://steamcommunity.ru/id/abc",
        "https://discord.xyz/gift",
        "https://paypa1.com/signin",
        "https://rnicrosoft.com/login",
        "https://discord-gift.com/claim",
        "https://discordapp.io/",
        "https://steamcomunity.com/id/abc",
        "https://discordnitro.ru/",
        "https://discord-nitro.vercel.app/",
        "https://steamcommunity-trade.com/offer",
        "https://discord.com.evil.xyz/login",
        "https://xn--dscord-pvf.com/", // dіscord with a Cyrillic і
        "https://xn--80ak6aa92e.com/", // аррӏе, all Cyrillic
    ];
    for (const url of danger) test(url, () => expect(level(url)).toBe("danger"));

    test("typos are suspicious", () => {
        expect(level("https://disocrd.com/")).toBe("caution");
        expect(codes("https://disocrd.com/")).toContain("typosquat");
        expect(level("https://githuub.com/user/repo")).toBe("caution");
        expect(level("https://youtubee.com/watch")).toBe("caution");
    });

    test("brand names on unrelated sites", () => {
        expect(level("https://discordbots.org/bot/1")).toBe("caution");
        expect(codes("https://discordbots.org/bot/1")).toContain("brand-mention");
    });

    test("mixed scripts are called out", () => {
        const r = analyzeLink("https://xn--dscord-pvf.com/");
        expect(r.findings.map(f => f.code)).toContain("mixed-script");
        expect(r.displayHostname).toBe("dіscord.com");
        expect(r.hostname).toBe("xn--dscord-pvf.com");
    });

    test("unrelated IDNs are only a caution", () => {
        const r = analyzeLink("https://xn--e1afmkfd.xn--p1ai/"); // пример.рф
        expect(r.level).toBe("caution");
        expect(r.findings.map(f => f.code)).toEqual(["punycode"]);
        expect(level("https://münchen.de")).toBe("caution");
    });
});

describe("address tricks", () => {
    test("userinfo", () => {
        const r = analyzeLink("https://discord.com@evil.xyz/login");
        expect(r.level).toBe("danger");
        expect(r.hostname).toBe("evil.xyz");
        expect(r.findings.map(f => f.code)).toContain("userinfo");
        expect(r.parts?.prefix).toBe("https://discord.com@");
        expect(r.parts?.domain).toBe("evil.xyz");
    });

    test("IP addresses", () => {
        expect(level("http://185.62.1.10/free")).toBe("caution");
        expect(codes("http://185.62.1.10/free")).toContain("ip-address");
        expect(codes("http://3232235777/")).toContain("ip-address"); // decimal form of 192.168.1.1
        expect(codes("http://[::1]:8080/")).toContain("ip-address");
    });

    test("file-like TLDs", () => {
        expect(codes("https://setup.zip/")).toContain("file-tld");
    });

    test("unreadable links", () => {
        expect(level("not a url")).toBe("caution");
    });
});

describe("scams", () => {
    test("nitro and steam bait", () => {
        expect(level("https://free-nitro.com/")).toBe("danger");
        expect(level("https://example.com/free-nitro-giveaway")).toBe("caution");
        expect(level("https://steam-gift.ru/")).toBe("danger");
        expect(codes("https://gg.example/claim", "Free Nitro for everyone!")).toContain("scam-words");
    });

    test("official domains aren't flagged for their own words", () => {
        expect(level("https://discord.com/nitro")).toBe("safe");
        expect(level("https://discord.gift/xyz")).toBe("safe");
    });
});

describe("shorteners and files", () => {
    test("shorteners are info only", () => {
        const r = analyzeLink("https://bit.ly/3abcDEF");
        expect(r.level).toBe("safe");
        expect(r.findings.map(f => f.code)).toEqual(["shortener"]);
    });

    test("programs", () => {
        expect(level("https://cdn.discordapp.com/attachments/1/2/setup.exe")).toBe("caution");
        expect(level("https://example.com/Game%20Installer.msi")).toBe("caution");
        expect(level("https://example.com/app.apk?x=1")).toBe("caution");
        expect(level("https://example.com/run.bat")).toBe("caution");
        expect(level("https://example.com/screensaver.scr")).toBe("caution");
    });

    test("disguised programs", () => {
        expect(level("https://cdn.discordapp.com/attachments/1/2/photo.png.exe")).toBe("danger");
    });

    test("normal files are fine", () => {
        expect(level("https://cdn.discordapp.com/attachments/1/2/notes.txt")).toBe("safe");
        expect(level("https://example.com/archive.zip")).toBe("safe");
    });
});

describe("allowlist", () => {
    test("allowlisted domains and subdomains are safe", () => {
        expect(level("https://discordbots.org/bot/1", undefined, ["discordbots.org"])).toBe("safe");
        expect(level("https://a.b.disocrd.com/", undefined, ["disocrd.com"])).toBe("safe");
    });

    test("allowlist doesn't leak to lookalikes", () => {
        expect(analyzeLink("https://discordbots.org.evil.xyz/", { allowlist: ["discordbots.org"] }).findings.map(f => f.code)).not.toContain("allowlisted");
        expect(level("https://evildiscordbots.org/", undefined, ["discordbots.org"])).toBe("caution");
    });
});

describe("url parts", () => {
    test("split for highlighting", () => {
        const r = analyzeLink("https://cdn.discordapp.com/attachments/1/a.png?x=1#y");
        expect(r.parts).toEqual({ prefix: "https://", subdomain: "cdn.", domain: "discordapp.com", rest: "/attachments/1/a.png?x=1#y" });
        expect(analyzeLink("https://discord.com").parts?.rest).toBe("");
        expect(analyzeLink("https://discord.com:8443/x").parts?.rest).toBe(":8443/x");
    });
});

// Verbatim from Discord's web build (test-results/chunks), the link click handler
const HANDLER = 'function Y(e,t){let i=arguments.length>2&&void 0!==arguments[2]?arguments[2]:[],s=arguments.length>3?arguments[3]:void 0,{trusted:c,onClick:u,onConfirm:E,onCancel:m,shouldConfirm:L,messageId:y,channelId:D}=e,b=m??(()=>{}),M=r().sanitizeUrl(e.href);if(null==M){null!=t&&t.preventDefault(),a.A.show({title:j.intl.string(j.t.x87gan),body:j.intl.format(j.t["9rqRwl"],{url:e.href}),isDismissable:!0,contextKey:s}),b();return}let P=M;try{decodeURI(M)}catch(e){P=encodeURI(M)}let U=null,w=!1,G=y,x=D,k=null;if(p.A.trackLinkClicked(P),null!=u){if(u(t))return}else{let{default:e}=n(983555),r=e(P,{skipExtensionCheck:void 0,analyticsLocations:i,messageId:y,channelId:D});if(null!=r&&r(t))return}function V(){(w&&p.A.trackAnnouncementMessageLinkClicked({messageId:G,channelId:D,guildId:U,sourceChannelId:x,sourceGuildId:k}),null!=E)?E():(0,d.A)(P)}if(null!==I.isBlockedDomain(P)){t?.preventDefault(),_.show(P),b();return}if(null!=(0,C.m)(P)){t?.preventDefault(),N.A.show(P),b();return}let H=("function"==typeof c?c():c)||S.has(P),W=(0,v.J)(P),Y="http:"!==W&&"https:"!==W;if(!Y&&(H||F.isTrustedDomain(P))||Y&&F.isTrustedProtocol(P))return void(null==t||null!=L&&L?V():w&&p.A.trackAnnouncementMessageLinkClicked({messageId:G,channelId:D,guildId:U,sourceChannelId:x,sourceGuildId:k}));if(null!=t&&t.preventDefault(),Y)g.show({url:P,trustUrl:o,onConfirm:V,onCancel:b,isProtocol:!0,contextKey:s});else{let e=(0,T.W1)(P),t=null!=e?e.displayTarget:P;g.show({url:t,trustUrl:l,onConfirm:V,onCancel:b,isProtocol:!1,contextKey:s})}}';

describe("source patch", () => {
    const replacement = PATCH.replace as { match: RegExp; with: string; };

    test("finds and rewrites the link click handler", () => {
        expect(matchesFind(HANDLER, PATCH.find)).toBe(true);
        const next = HANDLER.replace(canonicalizeMatch(replacement.match) as RegExp, replacement.with.replaceAll("$self", "S"));
        expect(next).not.toBe(HANDLER);
        expect(next).toContain("(0,d.A)(P)}if(null===I.isBlockedDomain(P)&&S?.intercept?.(P,t,V,b,arguments[0]))return;if(null!==I.isBlockedDomain(P))");
        expect(() => new Function(`return ${next}`)).not.toThrow();
    });

    test("runs: takes over when the plugin says so, else Discord continues", () => {
        const next = HANDLER.replace(canonicalizeMatch(replacement.match) as RegExp, replacement.with.replaceAll("$self", "SELF"));
        const calls: string[] = [];
        let blocked = "";
        const env = {
            r: () => ({ sanitizeUrl: (u: string) => u }),
            p: { A: { trackLinkClicked() { }, trackAnnouncementMessageLinkClicked() { } } },
            n: () => ({ default: () => null }),
            d: { A: (u: string) => calls.push(`open ${u}`) },
            I: { isBlockedDomain: (u: string) => u === blocked ? u : null },
            _: { show: (u: string) => calls.push(`blocked ${u}`) },
            C: { m: () => { calls.push("discord-checks"); return null; } },
            S: new Set(), v: { J: () => "https:" }, F: { isTrustedDomain: () => true, isTrustedProtocol: () => false },
        };
        const run = (plugin: unknown) => {
            calls.length = 0;
            const fn = new Function(...Object.keys(env), "SELF", `return ${next}`)(...Object.values(env), plugin);
            fn({ href: "https://evil.xyz", children: "discord.com" }, { preventDefault() { calls.push("prevented"); } });
            return [...calls];
        };
        let got: unknown[] = [];
        const plugin = {
            intercept(url: string, event: any, open: () => void, cancel: () => void, props: any) {
                got = [url, typeof event.preventDefault, typeof open, typeof cancel, props.children];
                event.preventDefault();
                open();
                return true;
            },
        };
        expect(run(plugin)).toEqual(["prevented", "open https://evil.xyz"]);
        expect(got).toEqual(["https://evil.xyz", "function", "function", "function", "discord.com"]);
        expect(run({ intercept: () => false })).toEqual(["discord-checks"]);
        expect(run({})).toEqual(["discord-checks"]);
        expect(run(undefined)).toEqual(["discord-checks"]);

        // A domain Discord blocks gets Discord's hard block, not our dialog with its Open anyway
        blocked = "https://evil.xyz";
        got = [];
        expect(run(plugin)).toEqual(["prevented", "blocked https://evil.xyz"]);
        expect(got).toEqual([]);
    });
});
