import { describe, expect, test } from "bun:test";

import discord from "./fixtures/shop-discord.json";
import { SHOP_PATCHES, shopContentPatch, shopLeavePatch, shopTabsPatch } from "../src/renderer/collectibles/shopPatches";
import type { Replacement, SourcePatch } from "../src/renderer/patching/source";
import { canonicalizeMatch, getPatchRecords, matchesFind, normalizeFactorySource, registerPatches } from "../src/renderer/patching/source";
import { EVI_TAB, NavOption, ShopState, withEviTab } from "../src/renderer/collectibles/shopState";

/** Discord's Shop modules (tests/fixtures/shop-discord.json), by webpack id */
const MODULES = discord as unknown as Record<string, string>;
const ids = Object.keys(MODULES).filter(id => /^\d+$/.test(id));

/** Applies a patch like Evi does, each replacement matching exactly once */
function apply(patch: SourcePatch, code: string) {
    expect(matchesFind(code, patch.find)).toBe(true);
    let next = normalizeFactorySource(code);
    for (const r of ([] as Replacement[]).concat(patch.replace)) {
        const re = canonicalizeMatch(r.match);
        const count = typeof re === "string" ? next.split(re).length - 1 : next.match(new RegExp(re.source, "g"))?.length;
        expect(count).toBe(1);
        const before = next;
        next = next.replace(re as RegExp, r.with as string);
        expect(next).not.toBe(before);
    }
    return next;
}

/** Throws if the module isn't valid JavaScript any more */
const compile = (code: string, win: object = {}) => new Function("window", `return (${code});`)(win);

/** The module a patch is for, in the fixture */
function moduleFor(patch: SourcePatch) {
    const found = ids.filter(id => matchesFind(MODULES[id], patch.find));
    expect(found.length).toBe(1);
    return MODULES[found[0]];
}

/** Anything a module asks for that a test doesn't hand it: callable, and every property is one too */
function anything(): any {
    return new Proxy(function () { }, {
        get: (_, key) => key === Symbol.toPrimitive ? () => "" : anything(),
        apply: () => anything(),
    });
}

/** Runs a (patched) module factory with webpack's helpers and these stand-ins for its imports */
function run(code: string, deps: Record<number, unknown>, win: object) {
    const module = { exports: {} as any };
    const req: any = (id: number) => deps[id] ?? anything();
    req.d = (exports: object, getters: Record<string, () => unknown>) => {
        for (const key in getters) Object.defineProperty(exports, key, { get: getters[key], enumerable: true });
    };
    req.r = () => { };
    req.n = (m: unknown) => () => m;
    compile(code, win)(module, module.exports, req);
    return module.exports;
}

describe("the Evi tab's patches on Discord's Shop", () => {
    test("each finds exactly one of Discord's modules, matches once and still compiles", () => {
        for (const patch of SHOP_PATCHES) {
            expect(patch.optional).toBe(true);
            expect(() => compile(apply(patch, moduleFor(patch)))).not.toThrow();
        }
    });

    test("the tab bar: Evi's tab goes into Discord's list, and is the selected one while Evi's page shows", () => {
        const code = apply(shopTabsPatch, moduleFor(shopTabsPatch));
        expect(code).toMatch(/onClick:\(\)=>\(0,\w+\.\w+\)\(\w+\)\}\)\}return window\.Evi\?\.collectiblesShop\?\.tabs\((\w+)\)\?\?\1\},\[/);
        expect(code).toMatch(/selectedKey:window\.Evi\?\.collectiblesShop\?\.useSelectedKey\?\.\((\w+)\)\?\?\1,overflowLabel:/);
        // Both or neither: a tab that can't show as selected isn't added
        expect(shopTabsPatch.group).toBe(true);
    });

    test("the Shop's content: Evi's page can take the place of the selected tab's", () => {
        const code = apply(shopContentPatch, moduleFor(shopContentPatch));
        expect(code).toMatch(/children:window\.Evi\?\.collectiblesShop\?\.content\?\.\((\(0,\w+\.jsx\)\(\w+,\{tab:(\w+),refreshCategories:[^}]*\})\),\2\)\?\?\(0,\w+\.jsx\)/);
    });

    test("moving to one of Discord's tabs closes Evi's page first, then goes on as Discord had it", () => {
        const left: string[] = [];
        const pushed: string[] = [];
        const win = { Evi: { collectiblesShop: { leave: () => void left.push("leave") } } };
        const state: unknown[] = [];
        const react = {
            useMemo: (fn: () => unknown) => fn(),
            useCallback: (fn: unknown) => fn,
            useEffect: () => { },
            useState: (initial: unknown) => {
                const i = state.length;
                state.push(initial);
                return [state[i], (v: unknown) => void (state[i] = v)];
            },
        };
        const G2 = { HOME: "home", CATALOG: "catalog", ORBS: "orbs", GAME_SERVERS: "game-servers", COLLABS: "collabs", OFFER_ELIGIBLE: "offer-eligible", AVATAR_DECORATIONS: "avatar-decorations" };
        const { o } = run(apply(shopLeavePatch, moduleFor(shopLeavePatch)), {
            582128: react,
            17928: { bG: (_: unknown, fn: () => unknown) => fn() },
            775602: { Ay: { useReducedMotion: true } },
            758836: { G2, Pf: { VISIBLE: 0, IN: 2, OUT: 3 }, dF: () => false, H1: 800 },
            806163: { W6: () => ({ push: (route: string) => void pushed.push(route) }) },
            652215: { BVt: { COLLECTIBLES_SHOP_WITH_TAB: (tab: string) => `/shop?tab=${tab}` } },
        }, win);
        const { transitionToTab } = o("home");
        void transitionToTab("orbs", false);
        expect(left).toEqual(["leave"]);
        expect(pushed).toEqual(["/shop?tab=orbs"]);
        // Without Evi there, Discord's own code runs as before
        const plain = run(apply(shopLeavePatch, moduleFor(shopLeavePatch)), { 582128: react, 758836: { G2, Pf: { VISIBLE: 0 }, dF: () => false } }, {});
        expect(() => void plain.o("home").transitionToTab("orbs", false)).not.toThrow();
    });
});

describe("the Evi tab", () => {
    const mark = () => null;
    const discordTabs = () => {
        const clicked: string[] = [];
        const page = (key: string): NavOption => ({ type: "page", key, text: key, route: `/shop?tab=${key}`, onClick: () => void clicked.push(key) });
        const options: NavOption[] = [page("home"), { type: "menu", key: "catalog", text: "Browse", onClick: () => void clicked.push("catalog"), options: [page("nameplates"), page("bundles")] }, page("orbs")];
        return { options, clicked };
    };
    const tabsOf = (options: NavOption[]) => withEviTab(options, { text: "Evi", icon: mark });

    test("only shows once Discord's Shop takes Evi's page", () => {
        registerPatches("evi", SHOP_PATCHES);
        const record = getPatchRecords("evi").find(r => r.patch === shopContentPatch)!;
        const { options } = discordTabs();
        expect(tabsOf(options)).toBeUndefined();
        record.state = "failed";
        expect(tabsOf(options)).toBeUndefined();
        record.state = "applied";
        expect(tabsOf(options)?.map(o => o.key)).toEqual(["home", EVI_TAB, "catalog", "orbs"]);
    });

    test("goes after Featured with Evi's mark and its own link; Discord's tabs, menus included, close Evi's page", () => {
        const { options, clicked } = discordTabs();
        const tabs = tabsOf(options)!;
        const evi = tabs[1];
        expect(evi).toMatchObject({ type: "page", key: EVI_TAB, text: "Evi", route: "/shop?tab=evi", icon: mark });

        expect(ShopState.showing()).toBe(false);
        evi.onClick!();
        expect(ShopState.showing()).toBe(true);
        // Discord's own tab: Evi's page closes, Discord's click goes through
        tabs[0].onClick!();
        expect(ShopState.showing()).toBe(false);
        // A tab inside the Browse menu does the same
        evi.onClick!();
        tabs[2].options![1].onClick!();
        expect(ShopState.showing()).toBe(false);
        expect(clicked).toEqual(["home", "bundles"]);
        expect(tabs[2].options!.map(o => o.key)).toEqual(["nameplates", "bundles"]);
        expect(tabs[2].options![0].route).toBe("/shop?tab=nameplates");
        // Discord's list itself is left as it was
        expect(options).toHaveLength(3);
    });

    test("anything Discord hands over that isn't a list leaves its tabs alone", () => {
        expect(tabsOf(undefined as never)).toBeUndefined();
        expect(tabsOf({} as never)).toBeUndefined();
    });
});
