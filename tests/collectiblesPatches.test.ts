import { describe, expect, test } from "bun:test";

import discord from "./fixtures/collectibles-discord.json";
import pickers from "./fixtures/picker-discord.json";
import { ALL_COLLECTIBLE_PATCHES, assetUrlPatch, decorationHookPatch, decorationUrlPatch, effectConfigPatch, memberDecorationPatch, mergePatch, nameplateHookPatch, nameplateUrlPatch, profileEffectPatch, rpcUserPatch, userDecorationPatch, userNameplatePatch } from "../src/renderer/collectibles/patches";
import { layerPlay } from "../src/renderer/collectibles/timeline";
import type { Replacement, SourcePatch } from "../src/renderer/patching/source";
import { canonicalizeMatch, matchesFind, normalizeFactorySource } from "../src/renderer/patching/source";

/** Discord's modules (tests/fixtures/collectibles-discord.json, and picker-discord.json for the frame ones), by webpack id */
const MODULES = { ...discord, ...pickers } as unknown as Record<string, string>;
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
const compile = (code: string, win: object = {}) => new Function("window", "platform", `return (${code});`)(win, { name: "Chrome" });

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

/** window.Evi.collectibles as the patched code sees it: one user wears Evi's "sakura" */
function evi(over: Record<string, unknown> = {}) {
    const calls = { useVersion: 0, ensured: [] as string[] };
    const api = {
        isSku: (sku: unknown) => typeof sku === "string" && sku.startsWith("evi:"),
        isOurs: (v: any) => typeof v?.skuId === "string" && v.skuId.startsWith("evi:"),
        wears: (id: string, kind: string) => id === "1" && kind !== "none",
        decoration: (id: string) => id === "1" ? { skuId: "evi:sakura" } : undefined,
        nameplate: (id: string) => id === "1" ? { skuId: "evi:sakura", asset: "evi:sakura", label: "Sakura River", palette: "bubble_gum" } : undefined,
        profileEffect: (id: string) => id === "1" ? { skuId: "evi:sakura" } : undefined,
        decorationUrl: (sku: string, animated: boolean) => `blob:${sku}/${animated ? "animated" : "static"}`,
        nameplateUrls: (sku: string) => ({ staticImageUrl: `blob:${sku}/still`, videoUrl: `blob:${sku}/video` }),
        effectConfig: (sku: string) => sku === "evi:sakura" ? { skuId: sku, effects: [] } : undefined,
        useVersion: () => ++calls.useVersion,
        ...over,
    };
    return { window: { Evi: { collectibles: api }, GLOBAL_ENV: { PROJECT_ENV: "production" } }, calls, api };
}

/** The module a patch is for, in the fixture */
function moduleFor(patch: SourcePatch) {
    const found = ids.filter(id => matchesFind(MODULES[id], patch.find));
    expect(found.length).toBe(1);
    return MODULES[found[0]];
}

describe("collectibles patches on Discord's code", () => {
    test("each finds exactly one of Discord's modules, matches once and still compiles", () => {
        for (const patch of ALL_COLLECTIBLE_PATCHES) {
            expect(patch.optional).toBe(true);
            expect(() => compile(apply(patch, moduleFor(patch)))).not.toThrow();
        }
    });

    test("the user record: an Evi decoration and nameplate go first, Discord's own stay for everyone else", () => {
        let code = apply(userDecorationPatch, moduleFor(userDecorationPatch));
        code = apply(userNameplatePatch, code);
        expect(code).toContain("get avatarDecoration(){return window.Evi?.collectibles?.decoration(this.id)??this.avatarDecorationData}");
        expect(code).toMatch(/get nameplate\(\)\{return\(0,\w+\.\w+\)\(window\.Evi\?\.collectibles\?\.nameplate\(this\.id\)\?\?this\.collectibles\?\.nameplate\)\}/);
        expect(() => compile(code)).not.toThrow();
    });

    test("CDN addresses: none for an evi: SKU, Discord's for the rest", () => {
        const { window } = evi();
        const exports = run(apply(assetUrlPatch, moduleFor(assetUrlPatch)), {}, window);
        expect(exports.getCollectiblesItemAssetUrl({ skuId: "evi:sakura", assetFormat: "static" })).toBeNull();
        expect(exports.getCollectiblesItemAssetUrl({ skuId: "1144058522808614923", assetFormat: "static" })).toBe("https://cdn.discordapp.com/media/v1/collectibles-shop/1144058522808614923/static");
        expect(exports.getCollectiblesItemAssetUrl({ skuId: null, assetFormat: "static" })).toBeNull();
    });

    test("own value or server profile's: an Evi one wins unless you're editing", () => {
        const { window } = evi();
        const { lw } = run(apply(mergePatch, moduleFor(mergePatch)), {}, window);
        const ours = { skuId: "evi:sakura" }, theirs = { skuId: "1" }, guild = { skuId: "2" };
        expect(lw({ userValue: ours, guildValue: guild, pendingValue: undefined, guildId: "9" })).toBe(ours);
        expect(lw({ userValue: theirs, guildValue: guild, pendingValue: undefined, guildId: "9" })).toBe(guild);
        // Editing your server profile: what you pick shows
        expect(lw({ userValue: ours, guildValue: guild, pendingValue: theirs, guildId: "9" })).toBe(theirs);
        expect(lw({ userValue: ours, guildValue: guild, pendingValue: null, guildId: "9" })).toBe(ours);
        // Not about collectibles at all: as Discord had it
        expect(lw({ userValue: "bio", guildValue: "server bio", pendingValue: undefined, guildId: "9" })).toBe("server bio");
    });

    test("a member's decoration: a server one doesn't hide an Evi one", () => {
        const { window } = evi();
        const { U } = run(apply(memberDecorationPatch, moduleFor(memberDecorationPatch)), {}, window);
        const store = { getMember: () => ({ avatarDecoration: { skuId: "server" } }) };
        expect(U({ id: "1", avatarDecoration: { skuId: "evi:sakura" } }, "9", [store])).toEqual({ skuId: "evi:sakura" });
        expect(U({ id: "2", avatarDecoration: { skuId: "own" } }, "9", [store])).toEqual({ skuId: "server" });
        expect(U({ id: "2", avatarDecoration: { skuId: "own" } }, null, [store])).toEqual({ skuId: "own" });
    });

    test("activities and RPC clients get the user's own Discord decoration, never an Evi one", () => {
        const { window } = evi();
        // Discord's Xq: its server shape, null for none
        const Xq = (d: any) => d && typeof d === "object" ? { skuId: d.skuId, ...typeof d.asset === "string" && { asset: d.asset } } : null;
        const { A } = run(apply(rpcUserPatch, moduleFor(rpcUserPatch)), { 821956: { Xq } }, window);
        const own = { asset: "a_1", skuId: "100" };
        expect(A({ id: "1", avatarDecoration: { skuId: "evi:sakura" }, avatarDecorationData: own }).avatar_decoration_data).toEqual(own);
        expect(A({ id: "1", avatarDecoration: { skuId: "evi:sakura" }, avatarDecorationData: undefined }).avatar_decoration_data).toBeNull();
        expect(A({ id: "2", avatarDecoration: own, avatarDecorationData: own }).avatar_decoration_data).toEqual(own);
    });

    test("avatar decoration URL: an evi: SKU gets the page's blob, still or animated as Discord asks", () => {
        const code = apply(decorationUrlPatch, moduleFor(decorationUrlPatch));
        expect(code).toContain("if(window.Evi?.collectibles?.isSku(t?.skuId))return window.Evi?.collectibles.decorationUrl(t.skuId,r);");
        const { window } = evi();
        const { F_ } = run(code, {}, window);
        expect(F_({ avatarDecoration: { skuId: "evi:sakura" }, canAnimate: true })).toBe("blob:evi:sakura/animated");
        expect(F_({ avatarDecoration: { skuId: "evi:sakura" } })).toBe("blob:evi:sakura/static");
        expect(F_({ avatarDecoration: null })).toBeNull();
    });

    test("the avatar decoration hook redraws when Evi's files arrive", () => {
        const code = apply(decorationHookPatch, moduleFor(decorationHookPatch));
        expect(code).toMatch(/\[\w+,\w+,\w+,\w+,\w+,window\.Evi\?\.collectibles\?\.useVersion\?\.\(\)\]\);return\{avatarPlaceholderSrc:/);
    });

    test("the nameplate hook: an Evi nameplate wins over a server one, and redraws with Evi's files", () => {
        const { window, calls } = evi();
        const member = { collectibles: { nameplate: { skuId: "server" } } };
        const { r } = run(apply(nameplateHookPatch, moduleFor(nameplateHookPatch)), {
            582128: { useMemo: (fn: () => unknown) => fn() },
            17928: { bG: (_: unknown, fn: () => unknown) => fn() },
            696451: { Ay: { getMember: () => member } },
            780898: { WK: (n: any) => n ? { from: n.skuId } : null },
        }, window);
        expect(r({ user: { id: "1", nameplate: { from: "evi:sakura" } }, guildId: "9" })).toEqual({ from: "evi:sakura" });
        expect(r({ user: { id: "2", nameplate: { from: "own" } }, guildId: "9" })).toEqual({ from: "server" });
        expect(calls.useVersion).toBe(2);
    });

    test("nameplate files: an evi: SKU gets the page's blobs, others Discord's CDN", () => {
        const { window } = evi();
        const { K } = run(apply(nameplateUrlPatch, moduleFor(nameplateUrlPatch)), {
            582128: { useMemo: (fn: () => unknown) => fn() },
            17928: { bG: (_: unknown, fn: () => unknown) => fn() },
            723702: { isLinux: () => false },
            775602: { Ay: { useReducedMotion: false } },
            746002: { getCollectiblesItemAssetUrl: ({ skuId, assetFormat }: any) => `cdn/${skuId}/${assetFormat}`, CollectiblesItemAssetFormat: { STATIC: "static", ANIMATED: "animated", VIDEO: "video" } },
            901139: { TW: () => ({ getImgCache: () => undefined }) },
        }, window);
        expect(K({ skuId: "evi:sakura" })).toEqual({ staticImageUrl: "blob:evi:sakura/still", videoUrl: "blob:evi:sakura/video" });
        expect(K({ skuId: "1" })).toEqual({ staticImageUrl: "cdn/1/static", videoUrl: "cdn/1/video" });
    });

    test("a profile's effect is asked for each time, so wearing one shows on a profile that's open", () => {
        let wearing = true;
        const { window } = evi({ profileEffect: (id: string) => wearing && id === "1" ? { skuId: "evi:sakura" } : undefined });
        const { AP } = run(apply(profileEffectPatch, moduleFor(profileEffectPatch)), { 583613: { L_: (fn: unknown) => fn } }, window);
        const users = { getUser: () => ({}) };
        const profiles = (effect: unknown) => ({ getUserProfile: (id: string) => ({ userId: id, profileEffect: effect }), getGuildMemberProfile: () => null });
        const mine = AP("1", undefined, [users, profiles({ skuId: "real" })]);
        expect(mine.profileEffect).toEqual({ skuId: "evi:sakura" });
        wearing = false;
        expect(mine.profileEffect).toEqual({ skuId: "real" });
        const theirs = AP("2", undefined, [users, profiles(undefined)]);
        expect(theirs.profileEffect).toBeUndefined();
        // Spread like a plain object, as Discord sometimes does
        expect({ ...mine }.profileEffect).toEqual({ skuId: "real" });
    });

    test("the effect config: Evi's for an evi: SKU, never fetched from Discord; Discord's for the rest", () => {
        const fetched: string[] = [];
        const deps = {
            582128: { useEffect: (fn: () => void) => fn() },
            17928: { bG: (_: unknown, fn: () => unknown) => fn() },
            815996: { RE: (sku: string) => void fetched.push(sku) },
            590180: { A: { getProduct: (sku: string) => sku === "shop" ? { items: [{ type: "effect", skuId: "shop" }] } : undefined } },
            4227: { A: { getPurchase: () => undefined } },
            203632: { C3: (item: unknown) => !!item },
        };
        const { window, calls } = evi();
        const { A } = run(apply(effectConfigPatch, moduleFor(effectConfigPatch)), deps, window);
        expect(A("evi:sakura")).toEqual({ skuId: "evi:sakura", effects: [] });
        // Still loading its layers: nothing yet, and Discord isn't asked for it either
        expect(A("evi:loading")).toBeUndefined();
        expect(A("shop")).toEqual({ type: "effect", skuId: "shop" });
        expect(A("missing")).toBeUndefined();
        expect(fetched).toEqual(["missing"]);
        expect(calls.useVersion).toBe(4);
    });
});

describe("profile effect timing", () => {
    test("an intro plays once, a loop repeats, a pause between plays shows nothing", () => {
        const intro = { start: 0, duration: 2490, loop: false, loopDelay: 0 };
        expect([0, 2489, 2490, 9000].map(t => layerPlay(intro, t))).toEqual([0, 0, undefined, undefined]);
        const loop = { start: 2490, duration: 3984, loop: true, loopDelay: 0 };
        expect([0, 2490, 6473, 6474, 20000].map(t => layerPlay(loop, t))).toEqual([undefined, 0, 0, 1, 4]);
        const paused = { start: 0, duration: 1000, loop: true, loopDelay: 500 };
        expect([999, 1200, 1500, 2600].map(t => layerPlay(paused, t))).toEqual([0, undefined, 1, undefined]);
    });
});
