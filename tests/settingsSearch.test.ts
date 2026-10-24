import { describe, expect, test } from "bun:test";

import type { SearchablePlugin } from "../src/shared/pluginSearch";
import { createFinder, SearchablePage, searchEntries } from "../src/shared/settingsSearch";

let language = "en";
const pages: SearchablePage[] = [
    {
        id: "plugins",
        label: () => "Plugins",
        tabs: [{ id: "installed", label: () => "Installed" }, { id: "store", label: () => "Store" }],
    },
    {
        id: "themes",
        label: () => "Themes",
        tabs: [{ id: "quickcss", label: () => "Quick CSS" }, { id: "wallpaper", label: () => language === "de" ? "Hintergrund" : "Wallpaper" }],
    },
];
const plugins: SearchablePlugin[] = [
    {
        id: "streamer-mode-plus",
        name: "Streamer Mode+",
        description: "Hides what you don't want on stream.",
        authors: ["Evi"],
        settings: {
            blurImages: { type: "boolean", label: "Blur images" },
            hide: { type: "select", label: "Hide", description: "What to hide while you stream", options: [{ label: "Emails" }, { label: "Phone numbers" }] },
        },
    },
    { id: "message-logger", name: "Message Logger", description: "Keeps deleted and edited messages.", authors: ["Someone"] },
];

const entries = searchEntries(pages, plugins);
const find = createFinder(entries);
const keys = (query: string) => [...find(query)];

describe("Discord's settings search finding Evi", () => {
    test("lists every tab, then each plugin followed by its settings", () => {
        expect(entries.map(e => e.key)).toEqual([
            "tab:plugins:installed",
            "tab:plugins:store",
            "tab:themes:quickcss",
            "tab:themes:wallpaper",
            "plugin:streamer-mode-plus",
            "setting:streamer-mode-plus:blurImages",
            "setting:streamer-mode-plus:hide",
            "plugin:message-logger",
        ]);
    });

    test("tabs stay on their page, plugins and settings go on Plugins", () => {
        const pageOf = Object.fromEntries(entries.map(e => [e.key, `${e.page}/${e.group}`]));
        expect(pageOf["tab:themes:quickcss"]).toBe("themes/tabs");
        expect(pageOf["plugin:message-logger"]).toBe("plugins/plugins");
        expect(pageOf["setting:streamer-mode-plus:hide"]).toBe("plugins/settings");
    });

    test("each result says where it goes", () => {
        const target = (key: string) => entries.find(e => e.key === key)!.target;
        expect(target("tab:themes:quickcss")).toEqual({ page: "themes", tab: "quickcss" });
        expect(target("plugin:message-logger")).toEqual({ plugin: "message-logger" });
        expect(target("setting:streamer-mode-plus:blurImages")).toEqual({ plugin: "streamer-mode-plus", setting: "blurImages" });
    });

    test("a setting's row names its plugin, a plugin's row its description", () => {
        const entry = (key: string) => entries.find(e => e.key === key)!;
        expect(entry("setting:streamer-mode-plus:blurImages").title()).toBe("Blur images");
        expect(entry("setting:streamer-mode-plus:blurImages").subtitle?.()).toBe("Streamer Mode+");
        expect(entry("plugin:message-logger").subtitle?.()).toBe("Keeps deleted and edited messages.");
        expect(searchEntries([], [{ id: "x", name: "X", authors: [] }])).toEqual([]);
        expect(searchEntries(pages.slice(0, 1), [{ id: "x", name: "X", authors: [] }])[2].subtitle).toBeUndefined();
    });

    test("tabs are found by their label, in any case, with spaces around the query ignored", () => {
        expect(keys("quick css")).toEqual(["tab:themes:quickcss"]);
        expect(keys("  QUICK ")).toEqual(["tab:themes:quickcss"]);
        expect(keys("store")).toEqual(["tab:plugins:store"]);
    });

    test("a plugin is found by name, description, id or author, the same as in the Plugins tab", () => {
        expect(keys("logger")).toEqual(["plugin:message-logger"]);
        expect(keys("edited")).toEqual(["plugin:message-logger"]);
        expect(keys("streamer-mode")).toEqual(["plugin:streamer-mode-plus"]);
        expect(keys("someone")).toEqual(["plugin:message-logger"]);
    });

    test("a setting is found by its label, description or an option, without its plugin", () => {
        expect(keys("blur")).toEqual(["setting:streamer-mode-plus:blurImages"]);
        expect(keys("phone")).toEqual(["setting:streamer-mode-plus:hide"]);
        // "stream" is in the plugin's name and in the Hide setting's description
        expect(keys("stream")).toEqual(["plugin:streamer-mode-plus", "setting:streamer-mode-plus:hide"]);
    });

    test("nothing is found for an empty query or one nothing holds", () => {
        expect(keys("")).toEqual([]);
        expect(keys("   ")).toEqual([]);
        expect(keys("nothing has this")).toEqual([]);
    });

    test("matches are worked out once per query, and again when it changes", () => {
        expect(find("blur")).toBe(find(" Blur"));
        expect(find("blur")).not.toBe(find("phone"));
    });

    test("labels are read as the search runs, so a new language is searched in that language", () => {
        const fresh = createFinder(entries);
        expect([...fresh("hintergrund", language)]).toEqual([]);
        language = "de";
        expect([...fresh("hintergrund", language)]).toEqual(["tab:themes:wallpaper"]);
        language = "en";
    });

    test("ids and setting keys can't run into each other or break out of a quoted selector", () => {
        const odd = searchEntries(pages, [
            { id: "a", name: "A", authors: [], settings: { "b:c": { type: "boolean", label: "One" } } },
            { id: "a:b", name: "AB", authors: [], settings: { c: { type: "boolean", label: "Two" } } },
            { id: "q", name: "Q", authors: [], settings: { 'say "hi"\\': { type: "boolean", label: "Three" } } },
        ]).map(e => e.key);
        expect(new Set(odd).size).toBe(odd.length);
        expect(odd.some(key => /["\\]/.test(key))).toBe(false);
    });
});
