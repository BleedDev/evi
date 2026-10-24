import { describe, expect, test } from "bun:test";

import {
    clampWidth, classifyUrl, DEFAULT_WIDTH, displayHost, hostMatches, intersects, MIN_CHAT, MIN_WIDTH, opensInPanel, parseSiteRules, ruleHost,
    sameRect, samplePoints, toViewBounds,
} from "../plugins/side-browser/links";
import type { Gesture, Mode } from "../plugins/side-browser/links";

const none = { open: [], never: [] };

describe("classifyUrl", () => {
    test("http(s) pages are web", () => {
        expect(classifyUrl("https://example.com/a?b#c")).toEqual({ kind: "web", href: "https://example.com/a?b#c", host: "example.com" });
        expect(classifyUrl("http://sub.example.co.uk").kind).toBe("web");
        expect(classifyUrl("https://EXAMPLE.com.").host).toBe("example.com");
    });

    test("Discord's own sites are Discord's, subdomains included", () => {
        for (const url of [
            "https://discord.com/channels/1/2/3", "https://discord.gg/abc", "https://canary.discord.com/channels/@me",
            "https://discordapp.com/invite/abc", "https://discord.gift/x", "https://cdn.discordapp.com/a.png",
            "https://media.discordapp.net/a.png", "https://discord.new/abc", "https://dis.gd/support", "https://ptb.discord.com/",
        ]) expect([url, classifyUrl(url).kind]).toEqual([url, "discord"]);
    });

    test("lookalikes of Discord are just sites", () => {
        expect(classifyUrl("https://notdiscord.com").kind).toBe("web");
        expect(classifyUrl("https://discord.com.evil.example").kind).toBe("web");
        expect(classifyUrl("https://dlscord.com").kind).toBe("web");
    });

    test("anything that isn't an http(s) page is refused", () => {
        for (const url of [
            "mailto:a@b.c", "steam://run/1", "file:///C:/x", "javascript:alert(1)", "data:text/html,hi", "blob:https://example.com/1",
            "about:blank", "ftp://example.com", "not a url", "", "https://",
        ]) expect([url, classifyUrl(url).kind]).toEqual([url, "refused"]);
        expect(classifyUrl(undefined).kind).toBe("refused");
        expect(classifyUrl(42).kind).toBe("refused");
        expect(classifyUrl("https://example.com/" + "a".repeat(9000)).kind).toBe("refused");
    });
});

describe("site rules", () => {
    test("a host covers its subdomains and nothing else", () => {
        expect(hostMatches("example.com", "example.com")).toBe(true);
        expect(hostMatches("www.example.com", "example.com")).toBe(true);
        expect(hostMatches("a.b.example.com", "*.example.com")).toBe(true);
        expect(hostMatches("notexample.com", "example.com")).toBe(false);
        expect(hostMatches("example.com.evil", "example.com")).toBe(false);
        expect(hostMatches("example.com", "")).toBe(false);
    });

    test("lines become hosts: bare, wildcard, pasted links, ports and paths dropped", () => {
        expect(ruleHost("YouTube.com")).toBe("youtube.com");
        expect(ruleHost("*.github.io")).toBe("github.io");
        expect(ruleHost("https://www.reddit.com/r/discord")).toBe("www.reddit.com");
        expect(ruleHost("example.com:8080/path")).toBe("example.com");
        expect(ruleHost("localhost")).toBe("localhost");
        expect(ruleHost("bücher.de")).toBe("xn--bcher-kva.de");
        expect(ruleHost("")).toBeNull();
        expect(ruleHost("two words.com")).toBeNull();
        expect(ruleHost("nodot")).toBeNull();
    });

    test("the list: one per line or comma, ! for never, comments and junk skipped, no repeats", () => {
        expect(parseSiteRules("youtube.com\n!github.com, wikipedia.org # reading\n\n# a comment\n!!x\nyoutube.com\n   ")).toEqual({
            open: ["youtube.com", "wikipedia.org"],
            never: ["github.com"],
        });
        expect(parseSiteRules(undefined)).toEqual(none);
        expect(parseSiteRules(12)).toEqual(none);
    });
});

describe("opensInPanel", () => {
    const decide = (url: string, mode: Mode, gesture: Gesture, sites = "") => opensInPanel(url, { mode, rules: parseSiteRules(sites), gesture });

    test("every link: clicks open here, Ctrl+click and middle click go to the browser", () => {
        expect(decide("https://example.com", "all", "click")).toBe(true);
        expect(decide("https://example.com", "all", "none")).toBe(true);
        expect(decide("https://example.com", "all", "modified")).toBe(false);
        expect(decide("https://example.com", "all", "middle")).toBe(false);
    });

    test("modifier: only Ctrl+click and middle click open here", () => {
        expect(decide("https://example.com", "modifier", "click")).toBe(false);
        expect(decide("https://example.com", "modifier", "none")).toBe(false);
        expect(decide("https://example.com", "modifier", "modified")).toBe(true);
        expect(decide("https://example.com", "modifier", "middle")).toBe(true);
    });

    test("sites: listed sites open here, Ctrl+click swaps", () => {
        expect(decide("https://www.youtube.com/watch?v=1", "sites", "click", "youtube.com")).toBe(true);
        expect(decide("https://example.com", "sites", "click", "youtube.com")).toBe(false);
        expect(decide("https://example.com", "sites", "modified", "youtube.com")).toBe(true);
        expect(decide("https://youtube.com", "sites", "middle", "youtube.com")).toBe(false);
        expect(decide("https://example.com", "sites", "click", "")).toBe(false);
    });

    test("a ! site never opens here, in any mode or gesture", () => {
        for (const mode of ["all", "modifier", "sites"] as Mode[]) {
            for (const gesture of ["click", "modified", "middle", "none"] as Gesture[]) {
                expect(decide("https://gist.github.com/x", mode, gesture, "github.com\n!github.com")).toBe(false);
            }
        }
    });

    test("Discord's links and other schemes never open here", () => {
        for (const mode of ["all", "modifier", "sites"] as Mode[]) {
            for (const gesture of ["click", "modified", "middle", "none"] as Gesture[]) {
                expect(decide("https://discord.com/channels/1/2", mode, gesture, "discord.com")).toBe(false);
                expect(decide("https://discord.gg/invite", mode, gesture, "discord.gg")).toBe(false);
                expect(decide("steam://run/440", mode, gesture)).toBe(false);
                expect(decide("javascript:alert(1)", mode, gesture)).toBe(false);
            }
        }
    });
});

test("displayHost drops www. and reads only real links", () => {
    expect(displayHost("https://www.example.com/a")).toBe("example.com");
    expect(displayHost("https://sub.example.com")).toBe("sub.example.com");
    expect(displayHost("mailto:a@b.c")).toBe("");
    expect(displayHost(undefined)).toBe("");
});

describe("width", () => {
    test("defaults, and stays between its minimum and what leaves the chat room", () => {
        expect(clampWidth(undefined, 2000)).toBe(DEFAULT_WIDTH);
        expect(clampWidth(Number.NaN, 2000)).toBe(DEFAULT_WIDTH);
        expect(clampWidth(100, 2000)).toBe(MIN_WIDTH);
        expect(clampWidth(5000, 2000)).toBe(2000 - MIN_CHAT);
        expect(clampWidth(600.4, 2000)).toBe(600);
        expect(clampWidth(600, Infinity)).toBe(600);
    });

    test("a narrow window still gets the minimum panel", () => {
        expect(clampWidth(500, 500)).toBe(MIN_WIDTH);
    });
});

describe("geometry", () => {
    test("rectangles", () => {
        const a = { x: 0, y: 0, width: 10, height: 10 };
        expect(intersects(a, { x: 5, y: 5, width: 10, height: 10 })).toBe(true);
        expect(intersects(a, { x: 10, y: 0, width: 5, height: 5 })).toBe(false);
        expect(intersects(a, { x: 2, y: 2, width: 0, height: 5 })).toBe(false);
        expect(sameRect(a, { ...a })).toBe(true);
        expect(sameRect(a, { ...a, width: 11 })).toBe(false);
        expect(sameRect(a, null)).toBe(false);
    });

    test("sample points cover the rectangle's inset edges and inside", () => {
        const points = samplePoints({ x: 100, y: 50, width: 400, height: 600 }, 5, 7, 8);
        expect(points).toHaveLength(35);
        expect(points[0]).toEqual([108, 58]);
        expect(points[points.length - 1]).toEqual([492, 642]);
        for (const [x, y] of points) {
            expect(x).toBeGreaterThanOrEqual(108);
            expect(x).toBeLessThanOrEqual(492);
            expect(y).toBeGreaterThanOrEqual(58);
            expect(y).toBeLessThanOrEqual(642);
        }
        expect(samplePoints({ x: 0, y: 0, width: 10, height: 10 }, 5, 7, 8)).toEqual([]);
    });

    test("view bounds: CSS pixels scaled by the page's zoom, whole pixels, inside the window", () => {
        const content = { width: 1600, height: 900 };
        // No zoom: the page is as wide as the window
        expect(toViewBounds({ x: 1100.4, y: 48, width: 499.6, height: 852, viewportWidth: 1600 }, content)).toEqual({ x: 1100, y: 48, width: 500, height: 852 });
        // Discord zoomed to 125%: 1280 CSS pixels across 1600 DIPs
        expect(toViewBounds({ x: 880, y: 40, width: 400, height: 680, viewportWidth: 1280 }, content)).toEqual({ x: 1100, y: 50, width: 500, height: 850 });
        // Without the page's width, the zoom factor
        expect(toViewBounds({ x: 100, y: 0, width: 100, height: 100 }, content, 2)).toEqual({ x: 200, y: 0, width: 200, height: 200 });
        // Clipped to the window
        expect(toViewBounds({ x: 1500, y: 800, width: 400, height: 400, viewportWidth: 1600 }, content)).toEqual({ x: 1500, y: 800, width: 100, height: 100 });
    });

    test("view bounds: nothing for junk or an empty rectangle", () => {
        const content = { width: 1600, height: 900 };
        expect(toViewBounds(null, content)).toBeNull();
        expect(toViewBounds("x", content)).toBeNull();
        expect(toViewBounds({ x: "a", y: 0, width: 1, height: 1 }, content)).toBeNull();
        expect(toViewBounds({ x: 0, y: 0, width: 0, height: 100, viewportWidth: 1600 }, content)).toBeNull();
        expect(toViewBounds({ x: 2000, y: 0, width: 100, height: 100, viewportWidth: 1600 }, content)).toBeNull();
        // An absurd zoom is held to 5x
        expect(toViewBounds({ x: 0, y: 0, width: 10, height: 10, viewportWidth: 1 }, content)).toEqual({ x: 0, y: 0, width: 50, height: 50 });
    });
});
