import { describe, expect, test } from "bun:test";

import {
    type BootEvent, DEFAULT_CONFIG, EN_STRINGS, initialState, isDiscordAppUrl, isSplashUrl, orderPlugins, parseReport, reduce, REPORT_PREFIX,
    sanitizeConfig, sanitizeStrings, splashCss, splashScript, view,
} from "../plugins/boot-sequence/boot";

const PLUGINS = [{ id: "a", name: "alpha" }, { id: "b", name: "beta" }, { id: "c", name: "gamma" }];
const report = (data: unknown) => REPORT_PREFIX + JSON.stringify(data);
const run = (events: BootEvent[], version = "1.0.9261") => events.reduce(reduce, initialState(version));
const rows = (events: BootEvent[], config = DEFAULT_CONFIG) => view(run(events), EN_STRINGS, config).rows.map(r => `${r.mark} ${r.label}${r.detail ? ` ${r.detail}` : ""}`);
const hello: BootEvent = { t: "hello", evi: "2.3.0", themes: ["Midnight"], safe: false, plugins: PLUGINS };

describe("boot sequence", () => {
    test("Discord's update steps, live, then ticked once it launches", () => {
        expect(rows([])).toEqual(["current checking for updates"]);
        const downloading: BootEvent = { t: "discord", state: { status: "downloading-updates", current: 1, total: 2, progress: 60 } };
        expect(rows([downloading])).toEqual(["current downloading update 1 of 2"]);
        expect(view(run([downloading]), EN_STRINGS, DEFAULT_CONFIG)).toMatchObject({ count: "60%", bar: { filled: 14 } });
        expect(rows([{ t: "discord", state: { status: "update-failure", seconds: 3 } }])).toEqual(["fail update failed retrying in 3s"]);
        expect(rows([downloading, { t: "discord", state: { status: "launching" } }])).toEqual(["done updates installed 2", "done discord 1.0.9261", "current evi"]);
        expect(rows([{ t: "discord", state: { status: "launching" } }])[0]).toBe("done up to date");
    });

    test("only what really started is ticked; the next one is current; failures stay listed", () => {
        expect(rows([hello])).toEqual(["done up to date", "done discord 1.0.9261", "done evi 2.3.0", "done theme Midnight", "current alpha"]);
        const after = rows([hello, { t: "plugin", id: "a", ok: true }, { t: "plugin", id: "b", ok: false }]);
        expect(after.slice(-3)).toEqual(["done alpha", "fail beta", "current gamma"]);
        const all = run([hello, { t: "plugin", id: "a", ok: true }, { t: "plugin", id: "b", ok: false }, { t: "plugin", id: "c", ok: true }]);
        const v = view(all, EN_STRINGS, DEFAULT_CONFIG);
        expect(v.rows.at(-1)).toMatchObject({ key: "open", mark: "current" });
        expect(v.bar).toEqual({ segments: 3, filled: 3, failed: [1] });
        expect(v.count).toBe("3 of 3");
    });

    test("reports for unknown or repeated plugins change nothing", () => {
        const s = run([hello, { t: "plugin", id: "a", ok: true }]);
        expect(reduce(s, { t: "plugin", id: "a", ok: false })).toBe(s);
        expect(reduce(s, { t: "plugin", id: "zzz", ok: true })).toBe(s);
    });

    test("one line for all plugins when the list is off; safe mode says plugins are off", () => {
        expect(rows([hello, { t: "plugin", id: "a", ok: true }], { ...DEFAULT_CONFIG, showPlugins: false }).at(-1)).toBe("current plugins 1 of 3");
        expect(rows([{ ...hello, safe: true }]).slice(-1)).toEqual(["fail safe mode plugins off"]);
    });

    test("plugins come in the order Evi starts them", () => {
        expect(orderPlugins(PLUGINS, ["c", "a"]).map(p => p.id)).toEqual(["c", "a", "b"]);
        expect(orderPlugins(PLUGINS, []).map(p => p.id)).toEqual(["a", "b", "c"]);
    });

    test("reports from the page are parsed defensively", () => {
        expect(parseReport("hello")).toBeNull();
        expect(parseReport(`${REPORT_PREFIX}{oops`)).toBeNull();
        expect(parseReport(report({ t: "nope" }))).toBeNull();
        expect(parseReport(report({ t: "plugin", id: "x", ok: false }))).toEqual({ t: "plugin", id: "x", ok: false });
        const h = parseReport(report({ t: "hello", evi: 5, themes: ["A", 3, "x".repeat(200)], plugins: [{ id: "a", name: "\u0007A" }, { id: "a" }, { name: "no id" }] }));
        expect(h).toMatchObject({ t: "hello", evi: "", safe: false, plugins: [{ id: "a", name: "A" }] });
        expect((h as any).themes).toEqual(["A", "x".repeat(60)]);
    });

    test("config and texts from disk fall back instead of failing", () => {
        expect(sanitizeConfig(null)).toEqual(DEFAULT_CONFIG);
        expect(sanitizeConfig({ accent: "red", compact: true, showPlugins: 0 })).toEqual({ showPlugins: true, accent: "white", compact: true });
        const s = sanitizeStrings({ checking: "suche nach updates", count: "{done}/{total}", downloading: "lade {total}", opening: 5 });
        expect(s.checking).toBe("suche nach updates");
        expect(s.count).toBe("{done}/{total}");
        // A placeholder missing would show a wrong number: English instead
        expect(s.downloading).toBe(EN_STRINGS.downloading);
        expect(s.opening).toBe(EN_STRINGS.opening);
    });

    test("only Discord's splash and app pages count", () => {
        expect(isSplashUrl("file:///C:/Users/a/AppData/Local/Discord/app-1.0.9261/resources/app.asar/splash/index.html")).toBe(true);
        expect(isSplashUrl("https://discord.com/splash/index.html")).toBe(false);
        expect(isDiscordAppUrl("https://discord.com/app")).toBe(true);
        expect(isDiscordAppUrl("https://canary.discord.com/channels/@me")).toBe(true);
        expect(isDiscordAppUrl("https://discord.com.evil.example/app")).toBe(false);
        expect(isDiscordAppUrl("http://discord.com/app")).toBe(false);
    });

    test("the splash script is valid and writes text, never markup from the page", () => {
        const script = splashScript(Date.now());
        expect(() => new Function(`return ${script}`)).not.toThrow();
        expect(script).toContain("textContent = row.label");
        expect(script).not.toMatch(/innerHTML\s*=\s*row/);
        const css = splashCss(DEFAULT_CONFIG);
        expect(css).not.toMatch(/gradient|box-shadow|text-shadow|:has\(/);
        expect(css).toContain("prefers-reduced-motion");
    });
});
