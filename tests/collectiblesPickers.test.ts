import { afterEach, describe, expect, spyOn, test } from "bun:test";

import core from "./fixtures/collectibles-discord.json";
import pickers from "./fixtures/picker-discord.json";
import { Bundle, frameLayerFromName, frameLayerOrder, frameOverflow, parseBundle } from "../src/shared/collectibles";
import { frameFields, frameItem, frameLayerUrl, layerId } from "../src/renderer/collectibles/frames";
import { setItemClass } from "../src/renderer/collectibles/items";
import { assetUrlPatch, editorPreviewPatch, frameConfigPatch, ownEffectPatch, ownFramePatch, productFetchPatch, profileFramePatch } from "../src/renderer/collectibles/patches";
import { PickerApi } from "../src/renderer/collectibles/pickerApi";
import {
    decorationPickerPatch, effectPickerPatch, effectThumbPatch, framePickerPatch, nameplatePickerPatch, nameplateRowPatch, openShopPatch, pendingPatch,
    PICKER_PATCHES, PICKER_PATCHES_BY_KIND, previewDetailsPatch, productPatch, saveBodiesPatch, tileBadgePatch,
} from "../src/renderer/collectibles/pickerPatches";
import { EVI_SECTION, productFor, setPickerPatches, takeEviChanges, withEviSections } from "../src/renderer/collectibles/pickers";
import { outgoing, outgoingUrl } from "../src/renderer/collectibles/privacy";
import { Collectibles } from "../src/renderer/collectibles/store";
import type { Replacement, SourcePatch } from "../src/renderer/patching/source";
import { canonicalizeMatch, getPatchRecords, matchesFind, normalizeFactorySource, registerPatches } from "../src/renderer/patching/source";

/** Discord's modules of 2026-10-13 these patches are for, by webpack id (both fixtures) */
const MODULES = { ...core, ...pickers } as unknown as Record<string, string>;
const ids = Object.keys(MODULES).filter(id => /^\d+$/.test(id));
const NEW_CORE = [assetUrlPatch, productFetchPatch, ownEffectPatch, ownFramePatch, editorPreviewPatch, profileFramePatch, frameConfigPatch];

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

const compile = (code: string, win: object = {}) => new Function("window", "platform", `return (${code});`)(win, { name: "Chrome" });

function anything(): any {
    return new Proxy(function () { }, {
        get: (_, key) => key === Symbol.toPrimitive ? () => "" : anything(),
        apply: () => anything(),
    });
}

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

function moduleFor(patch: SourcePatch) {
    const found = ids.filter(id => matchesFind(MODULES[id], patch.find));
    expect(found.length).toBe(1);
    return MODULES[found[0]];
}

/** Patches one module with several patches, in order */
const patched = (code: string, ...patches: SourcePatch[]) => patches.reduce((c, p) => apply(p, c), code);

/** window.Evi.collectibles as the patched code sees it */
function evi(over: Record<string, unknown> = {}) {
    const calls = { useVersion: 0, useFrames: 0, saving: [] as unknown[][] };
    const api = {
        isSku: (sku: unknown) => typeof sku === "string" && sku.startsWith("evi:"),
        profileEffect: (id: string) => id === "1" ? { skuId: "evi:cabin" } : undefined,
        profileFrame: (id: string) => id === "1" ? { skuId: "evi:sakura" } : undefined,
        frame: (sku: string) => ({ skuId: sku, layers: [{ id: "evi-sakura-0" }] }),
        assetUrl: (sku: string, _format: string, assetId?: string) => assetId ? `blob:${sku}/${assetId}` : undefined,
        own: (kind: string) => ({ nameplate: { skuId: "evi:sakura" }, effect: { skuId: "evi:cabin" }, frame: { skuId: "evi:sakura" } } as any)[kind],
        tile: (sku: string) => `tile:${sku}`,
        details: (sku: string) => `details:${sku}`,
        product: (sku: string) => sku.startsWith("evi:") ? { category: undefined, product: { skuId: sku }, purchase: { skuId: sku } } : undefined,
        openShop: (o: any) => typeof o?.initialProductSkuId === "string" && o.initialProductSkuId.startsWith("evi:"),
        saving: (changes: Record<string, unknown>, ...rest: unknown[]) => {
            calls.saving.push([changes, ...rest]);
            return Object.fromEntries(Object.entries(changes).map(([k, v]) => [k, (v as any)?.skuId?.startsWith?.("evi:") ? undefined : v]));
        },
        useVersion: () => ++calls.useVersion,
        useFrames: () => ++calls.useFrames,
        ...over,
    };
    return { window: { Evi: { collectibles: api }, GLOBAL_ENV: { PROJECT_ENV: "production" } }, calls, api };
}

describe("picker and frame patches on Discord's code", () => {
    test("each finds exactly one of Discord's modules, matches once and still compiles", () => {
        for (const patch of [...PICKER_PATCHES, ...NEW_CORE]) {
            expect(patch.optional).toBe(true);
            expect(() => compile(apply(patch, moduleFor(patch)))).not.toThrow();
        }
        // Patches on the same module apply on top of each other
        expect(() => compile(patched(moduleFor(ownEffectPatch), ownEffectPatch, ownFramePatch))).not.toThrow();
        expect(() => compile(patched(moduleFor(productFetchPatch), productFetchPatch, openShopPatch))).not.toThrow();
    });

    test("every picker needs the save, pending, badge, footer and shop patches, and its own modal's", () => {
        for (const [kind, patches] of Object.entries(PICKER_PATCHES_BY_KIND)) {
            for (const p of [saveBodiesPatch, pendingPatch, tileBadgePatch, productPatch, openShopPatch]) expect(patches).toContain(p);
            expect(patches).toContain({ nameplate: nameplatePickerPatch, decoration: decorationPickerPatch, effect: effectPickerPatch, frame: framePickerPatch }[kind]!);
        }
    });

    test("your own profile's effect and frame: an Evi one first, for a server profile too, and the hook redraws", () => {
        const { window, calls } = evi();
        const profile = { profileEffect: { skuId: "real-fx" }, profileFrame: { skuId: "real-frame" } };
        const guild = { profileEffect: { skuId: "guild-fx" }, profileFrame: { skuId: "guild-frame" } };
        const { N2, Xf } = run(patched(moduleFor(ownEffectPatch), ownEffectPatch, ownFramePatch), {
            17928: { bG: (_: unknown, fn: () => unknown) => fn() },
            321191: { A: { getUserProfile: () => profile, getGuildMemberProfile: () => guild } },
        }, window);
        expect(N2({ user: { id: "1" } })).toEqual({ skuId: "evi:cabin" });
        expect(N2({ user: { id: "1" }, guildId: "9" })).toEqual({ skuId: "evi:cabin" });
        expect(N2({ user: { id: "2" } })).toEqual({ skuId: "real-fx" });
        expect(N2({ user: { id: "2" }, guildId: "9" })).toEqual({ skuId: "guild-fx" });
        expect(Xf({ user: { id: "1" } })).toEqual({ skuId: "evi:sakura" });
        expect(Xf({ user: { id: "2" }, guildId: "9" })).toEqual({ skuId: "guild-frame" });
        expect(calls.useVersion).toBe(6);
    });

    test("the editor's profile preview: your Evi effect and frame are the values under what you choose", () => {
        const code = apply(editorPreviewPatch, moduleFor(editorPreviewPatch));
        expect(code).toMatch(/pendingValue:\w+,userValue:window\.Evi\?\.collectibles\?\.profileEffect\((\$|\w+)\?\.userId\)\?\?\1\?\._userProfile\?\.profileEffect,guildValue:/);
        expect(code).toMatch(/pendingValue:\w+,userValue:window\.Evi\?\.collectibles\?\.profileFrame\?\.\((\$|\w+)\?\.userId\)\?\?\1\?\._userProfile\?\.profileFrame,guildValue:/);
    });

    test("a profile's frame is asked for each time, like its effect", () => {
        let wearing = true;
        const { window } = evi({ profileFrame: (id: string) => wearing && id === "1" ? { skuId: "evi:sakura" } : undefined });
        const { AP } = run(apply(profileFramePatch, moduleFor(profileFramePatch)), { 583613: { L_: (fn: unknown) => fn } }, window);
        const users = { getUser: () => ({}) };
        const profiles = (frame: unknown) => ({ getUserProfile: (id: string) => ({ userId: id, profileFrame: frame }), getGuildMemberProfile: () => null });
        const mine = AP("1", undefined, [users, profiles({ skuId: "real" })]);
        expect(mine.profileFrame).toEqual({ skuId: "evi:sakura" });
        wearing = false;
        expect(mine.profileFrame).toEqual({ skuId: "real" });
        expect(AP("2", undefined, [users, profiles(undefined)]).profileFrame).toBeUndefined();
    });

    test("a frame by SKU: Evi's record for an evi: SKU, Discord's products and purchases for the rest", () => {
        const { window, calls } = evi();
        const frame = { type: 3, skuId: "shop" };
        const { A } = run(apply(frameConfigPatch, moduleFor(frameConfigPatch)), {
            17928: { bG: (_: unknown, fn: () => unknown) => fn() },
            590180: { A: { getProduct: (sku: string) => sku === "shop" ? { items: [frame] } : undefined } },
            4227: { A: { getPurchase: () => undefined } },
            892118: { s: (item: any) => item?.type === 3 },
        }, window);
        expect(A("evi:sakura")).toEqual({ skuId: "evi:sakura", layers: [{ id: "evi-sakura-0" }] });
        expect(A("shop")).toBe(frame);
        expect(A(null)).toBeUndefined();
        expect(calls.useFrames).toBe(3);
    });

    test("collectible files: a frame layer of an evi: SKU gets its blob, nothing else of Evi's gets Discord's CDN", () => {
        const { window } = evi();
        const { getCollectiblesItemAssetUrl: url } = run(apply(assetUrlPatch, moduleFor(assetUrlPatch)), {}, window);
        expect(url({ skuId: "evi:sakura", assetFormat: "static", assetId: "evi-sakura-0" })).toBe("blob:evi:sakura/evi-sakura-0");
        expect(url({ skuId: "evi:sakura", assetFormat: "static" })).toBeNull();
        expect(url({ skuId: "123", assetFormat: "static", assetId: "a" })).toBe("https://cdn.discordapp.com/media/v1/collectibles-shop/123/a/static");
        expect(url({ skuId: null, assetFormat: "static" })).toBeNull();
    });

    test("Discord never asks its API for an evi: product, and opening its Shop at one opens Evi's dialog", async () => {
        const { window } = evi();
        const dispatched: unknown[] = [], fetched: unknown[] = [];
        const exports = run(patched(moduleFor(productFetchPatch), productFetchPatch, openShopPatch), {
            73153: { h: { dispatch: (a: unknown) => void dispatched.push(a) } },
            636537: { Bo: { get: async (r: unknown) => (fetched.push(r), { body: {} }) } },
            590180: { A: { isFetchingProduct: () => false, isProductFetchBackedOff: () => false } },
        }, window);
        await exports.RE("evi:sakura");
        expect(dispatched).toEqual([]);
        expect(fetched).toEqual([]);
        await exports.RE("1144058522808614923");
        expect(dispatched.length).toBeGreaterThan(0);
        expect(fetched.length).toBe(1);

        dispatched.length = 0;
        expect(exports.Cz({ initialProductSkuId: "evi:sakura", analyticsLocations: [] })).toBeUndefined();
        expect(dispatched).toEqual([]);
        exports.Cz({ initialProductSkuId: "1144058522808614923" });
        expect(dispatched).toContainEqual(expect.objectContaining({ type: "COLLECTIBLES_SHOP_OPEN", initialProductSkuId: "1144058522808614923" }));
    });

    test("an item tile's badge is Evi's for an evi: SKU, Discord's for the rest", () => {
        const { window } = evi();
        const { A } = run(apply(tileBadgePatch, moduleFor(tileBadgePatch)), {
            17928: { bG: (_: unknown, fn: () => unknown) => fn() },
            993408: { aT: () => false, gA: () => false, G0: () => false },
        }, window);
        expect(A({ skuId: "evi:sakura", isPurchaseSection: true })).toBe("tile:evi:sakura");
        expect(A({ skuId: "evi:sakura", isPurchaseSection: false })).toBe("tile:evi:sakura");
        expect(A({ skuId: "123", isPurchaseSection: true })).toBeNull();
    });

    test("the footer's product and purchase: Evi's for an evi: SKU, with Discord's hooks run every time", () => {
        const { window } = evi();
        let hooks = 0;
        const { A } = run(apply(productPatch, moduleFor(productPatch)), {
            702841: { yK: (_: unknown, fn: () => unknown) => (hooks++, fn()), bG: (_: unknown, fn: () => unknown) => (hooks++, fn()) },
            590180: { A: { getCategoryForProduct: () => "cat", getProduct: (sku: string) => ({ sku }) } },
            4227: { A: { getPurchase: (sku: string) => sku === "1" ? { sku } : undefined } },
        }, window);
        expect(A("evi:sakura")).toEqual({ category: undefined, product: { skuId: "evi:sakura" }, purchase: { skuId: "evi:sakura" } });
        expect(A("1")).toEqual({ category: "cat", product: { sku: "1" }, purchase: { sku: "1" } });
        expect(hooks).toBe(4);
    });

    test("the details under the preview are Evi's for an evi: SKU", () => {
        const code = apply(previewDetailsPatch, moduleFor(previewDetailsPatch));
        expect(code).toMatch(/return window\.Evi\?\.collectibles\?\.isSku\?\.\((\w+)\)\?window\.Evi\?\.collectibles\.details\(\1\):null==/);
        expect(code).toMatch(/previewSkuId:(\w+),[^]*isSku\?\.\(\1\)/);
    });

    test("an effect thumbnail that's a blob: URL is used as it is", () => {
        const { Rc } = run(apply(effectThumbPatch, moduleFor(effectThumbPatch)), {}, {});
        expect(Rc("blob:https://discord.com/abc")).toBe("blob:https://discord.com/abc");
        expect(Rc("https://cdn.discordapp.com/x.png")).toBe("https://cdn.discordapp.com/x.png?width=100&height=195");
        expect(Rc(undefined)).toBeUndefined();
    });

    test("the nameplate row and the pickers ask for Evi's where Discord reads its own", () => {
        expect(apply(nameplateRowPatch, moduleFor(nameplateRowPatch))).toMatch(/\w+=window\.Evi\?\.collectibles\?\.own\?\.\("nameplate"\)\?\?\w+\.collectibles\?\.nameplate,\w+=\w+\?\w+:\w+/);
        const nameplate = apply(nameplatePickerPatch, moduleFor(nameplatePickerPatch));
        // The grid's sections, with the server it's for
        expect(nameplate).toMatch(/guildId:(\w+),onSelect:\w+,onOpenShop:\w+\}=\w+,\w+=\w+\.\w+\.canUseCollectibles\(\w+\),\w+=window\.Evi\?\.collectibles\?\.sections\?\.\("nameplate",(\w+)\(\),\1\)\?\?\2\(\)/);
        expect(nameplate).toContain(':window.Evi?.collectibles?.own?.("nameplate")??');
        expect(nameplate).toMatch(/return \w+===(\w+)\.skuId\}\)\?\?window\.Evi\?\.collectibles\?\.item\?\.\(\1,"nameplate"\)\?\?null/);
        for (const [patch, kind] of [[decorationPickerPatch, "decoration"], [effectPickerPatch, "effect"], [framePickerPatch, "frame"]] as const) {
            const code = apply(patch, moduleFor(patch));
            expect(code).toMatch(new RegExp(`guild:(\\w+),[^}]*onOpenShop:\\w+\\}=\\w+,\\w+=window\\.Evi\\?\\.collectibles\\?\\.sections\\?\\.\\("${kind}",(\\w+)\\(\\),\\1\\?\\.id\\)\\?\\?\\2\\(\\)`));
            expect(code).toContain(`window.Evi?.collectibles?.item?.(`);
        }
    });
});

describe("saving from Discord's profile editor", () => {
    const PENDING_DEPS = (wornNameplate: unknown, profile: unknown, dispatched: any[]) => ({
        811315: (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b),
        73153: { h: { dispatch: (a: unknown) => void dispatched.push(a) } },
        287809: { default: { getCurrentUser: () => ({ id: "1", avatarDecoration: undefined, collectibles: { nameplate: wornNameplate } }) } },
        321191: { A: { getUserProfile: () => profile, getGuildMemberProfile: () => profile } },
        696451: { Ay: { getMember: () => null } },
    });

    test("choosing None over an Evi item is a change, choosing the Evi one you wear isn't", () => {
        const { window } = evi();
        const dispatched: any[] = [];
        const { p } = run(apply(pendingPatch, moduleFor(pendingPatch)), PENDING_DEPS(undefined, {}, dispatched), window);
        p({ nameplate: null });
        p({ nameplate: { skuId: "evi:sakura" } });
        p({ profileEffect: null });
        p({ profileFrame: { skuId: "evi:sakura" } });
        expect(dispatched.map(d => [d.pendingNameplate, d.pendingProfileEffect, d.pendingProfileFrame])).toEqual([
            [null, undefined, undefined],
            [undefined, undefined, undefined],
            [undefined, null, undefined],
            [undefined, undefined, undefined],
        ]);
        expect("pendingNameplate" in dispatched[1]).toBe(true);
    });

    test("without Evi it compares like Discord does", () => {
        const dispatched: any[] = [];
        const { p } = run(apply(pendingPatch, moduleFor(pendingPatch)), PENDING_DEPS(undefined, {}, dispatched), {});
        p({ nameplate: null });
        p({ profileEffect: null });
        expect(dispatched.map(d => [d.pendingNameplate, d.pendingProfileEffect])).toEqual([[undefined, undefined], [undefined, undefined]]);
    });

    test("Discord's request bodies are built after Evi took its changes out", () => {
        const { window, calls } = evi();
        const { Sk, yX, C5 } = run(apply(saveBodiesPatch, moduleFor(saveBodiesPatch)), {
            575593: { R: { PROFILE_EFFECT: 1, PROFILE_FRAME: 3 } },
            287809: { default: { getCurrentUser: () => ({ id: "1" }) } },
            321191: { A: { getUserProfile: () => ({ collectibles: [{ skuId: "badge-1", type: 7 }, { skuId: "real-fx", type: 1 }] }), getGuildMemberProfile: () => null } },
        }, window);
        const pending = {
            pendingNameplate: { skuId: "evi:sakura" }, pendingAvatarDecoration: { skuId: "real-deco" }, pendingGlobalName: "Ada",
            pendingProfileEffect: { skuId: "evi:cabin" }, pendingProfileFrame: { skuId: "real-frame", type: 3 }, pendingBio: "hi",
        };
        const user = Sk(pending), profile = yX(pending), member = C5(pending);
        expect(user).toEqual({ globalName: "Ada", avatarDecoration: { skuId: "real-deco" } });
        // The Evi effect isn't saved, so Discord's own stays; the Discord frame is
        expect(profile).toEqual({ bio: "hi", collectibles_sku_ids: ["badge-1", "real-fx", "real-frame"] });
        expect(member).toEqual({ avatarDecoration: { skuId: "real-deco" } });
        expect(calls.saving.map(c => c.slice(1))).toEqual([["user"], ["profile", undefined], ["member"]]);
        for (const body of [user, profile, member]) expect(JSON.stringify(body)).not.toContain("evi:");
        // Nothing left for the request guard to take out
        expect(outgoing("PATCH", "https://discord.com/api/v9/users/@me", JSON.stringify(user))).toBeUndefined();
    });
});

/** A bundle as evi.rest sends it, parsed */
const url = (bundle: string, file: string) => `https://evi.rest/collectibles/${bundle}/${file}?v=1`;
function bundle(id: string, prices?: Record<string, number>): Bundle {
    return parseBundle({
        id, name: id[0].toUpperCase() + id.slice(1), description: "", tier: "free", prices,
        nameplate: { animated: url(id, "nameplate.webm"), static: url(id, "nameplate.png"), palette: "sky" },
        frame: {
            static: url(id, "frame-static.png"),
            layers: [{ src: url(id, "frame-0.png"), type: "staple", order: "front", anchor: "top" }, { src: url(id, "frame-1.png"), type: "border", order: "back" }],
        },
    })!;
}

describe("Evi items in Discord's pickers", () => {
    const sakura = bundle("sakura", { nameplate: 120 }), cabin = bundle("cabin", { nameplate: 80 }), gift = bundle("gift");
    let owned = new Set<string>(), worn: Record<string, string> = {}, version = 1000;
    const equipped: unknown[] = [];
    class Item { constructor(fields: Record<string, unknown>) { Object.assign(this, fields); } }

    function stub() {
        const spies = [
            spyOn(Collectibles, "bundles").mockImplementation(() => [sakura, cabin, gift]),
            spyOn(Collectibles, "bundle").mockImplementation((id: string) => [sakura, cabin, gift].find(b => b.id === id)),
            spyOn(Collectibles, "owns").mockImplementation((id: string, kind: string) => owned.has(`${id}:${kind}`)),
            spyOn(Collectibles, "mine").mockImplementation(() => worn),
            spyOn(Collectibles, "drawn").mockImplementation(() => true),
            spyOn(Collectibles, "equip").mockImplementation(async (changes: unknown) => (equipped.push(changes), { ok: true } as any)),
            // Each test is a new list: nothing cached from the one before
            spyOn(Collectibles, "getVersion").mockImplementation(() => version),
        ];
        setItemClass("nameplate", Item as any);
        setItemClass("frame", Item as any);
        return spies;
    }
    let spies: ReturnType<typeof stub> = [];
    afterEach(() => {
        spies.forEach(s => s.mockRestore());
        setItemClass("nameplate", undefined);
        setItemClass("frame", undefined);
        owned = new Set();
        worn = {};
        equipped.length = 0;
        version++;
    });

    // The patches a picker needs are registered (pending until their modules load)
    registerPatches("evi", PICKER_PATCHES);
    setPickerPatches(PICKER_PATCHES_BY_KIND);

    const discord = () => [
        { section: "purchase", items: [{ skuId: "None" }, { skuId: "Shop" }, { skuId: "111" }], height: 12, header: "Your Nameplates" },
        { section: "premium_purchase", items: [{ skuId: "222" }], height: 12, header: "Exclusive to Nitro" },
        { section: "preview", items: [{ skuId: "333" }], height: 12, header: "See What's in Shop" },
    ];

    test("yours after Discord's own in Your Nameplates, the rest for sale in From Evi before the Shop's", () => {
        spies = stub();
        owned.add("sakura:nameplate");
        const sections = discord();
        const out = withEviSections("nameplate", sections, undefined);
        expect(out.map(s => s.section)).toEqual(["purchase", "premium_purchase", EVI_SECTION, "preview"]);
        expect(out[0].items.map((i: any) => i.skuId)).toEqual(["None", "Shop", "111", "evi:sakura"]);
        expect(out[0].items[3]).toBeInstanceOf(Item);
        expect(out[0].items[3]).toMatchObject({ skuId: "evi:sakura", asset: "evi:sakura", label: "Sakura", palette: "sky" });
        // A gift (no price) you don't own isn't listed
        expect(out[2].items.map((i: any) => i.skuId)).toEqual(["evi:cabin"]);
        // Same answer until something changes, Discord's own sections untouched
        expect(withEviSections("nameplate", sections, undefined)).toBe(out);
        expect(sections[0].items.length).toBe(3);
    });

    test("one you wear counts as yours, and a server profile's picker has no Evi items", () => {
        spies = stub();
        worn = { nameplate: "gift" };
        const sections = discord();
        expect(withEviSections("nameplate", sections, "9")).toBe(sections);
        expect(withEviSections("nameplate", sections, undefined)[0].items.map((i: any) => i.skuId)).toContain("evi:gift");
    });

    test("no picker items when a patch it needs failed, or Discord's class for the kind isn't there", () => {
        spies = stub();
        owned.add("sakura:nameplate");
        const record = getPatchRecords("evi").find(r => r.patch === nameplatePickerPatch)!;
        record.state = "failed";
        const sections = discord();
        expect(withEviSections("nameplate", sections, undefined)).toBe(sections);
        record.state = "pending";
        setItemClass("nameplate", null);
        version++;
        expect(withEviSections("nameplate", discord(), undefined)[0].items.length).toBe(3);
    });

    test("the footer: a purchase for one you own (Apply), none for one you don't (Evi's dialog)", () => {
        spies = stub();
        owned.add("sakura:nameplate");
        withEviSections("nameplate", discord(), undefined);
        expect(productFor("evi:sakura")?.purchase).toMatchObject({ skuId: "evi:sakura", type: 2 });
        expect(productFor("evi:cabin")?.purchase).toBeUndefined();
        expect(productFor("evi:cabin")?.product).toMatchObject({ skuId: "evi:cabin", name: "Cabin" });
        expect(productFor("123")).toBeUndefined();
    });

    test("saving: an Evi item is worn through Evi and left out, None or a Discord item takes Evi's off", async () => {
        spies = stub();
        worn = { decoration: "cabin", effect: "cabin" };
        const changes = { pendingNameplate: { skuId: "evi:sakura" }, pendingAvatarDecoration: null, pendingBio: "hi" };
        const user = takeEviChanges(changes, "user");
        expect(user).toEqual({ pendingNameplate: undefined, pendingAvatarDecoration: null, pendingBio: "hi" });
        const profile = takeEviChanges({ pendingProfileEffect: { skuId: "1144058522808614923" }, pendingProfileFrame: { skuId: "evi:sakura", type: 3 } }, "profile", undefined);
        expect(profile).toEqual({ pendingProfileEffect: { skuId: "1144058522808614923" }, pendingProfileFrame: undefined });
        await new Promise(r => setTimeout(r, 0));
        // One request for the whole save
        expect(equipped).toEqual([{ nameplate: "sakura", decoration: null, effect: null, frame: "sakura" }]);
    });

    test("saving a server profile only takes Evi items out", async () => {
        spies = stub();
        worn = { nameplate: "cabin" };
        expect(takeEviChanges({ pendingNameplate: { skuId: "evi:sakura" } }, "member")).toEqual({ pendingNameplate: undefined });
        expect(takeEviChanges({ pendingProfileFrame: null }, "profile", "9")).toEqual({ pendingProfileFrame: null });
        expect(takeEviChanges({ pendingNameplate: null }, "member")).toEqual({ pendingNameplate: null });
        await new Promise(r => setTimeout(r, 0));
        expect(equipped).toEqual([]);
    });

    test("PickerApi.saving never hands Discord an Evi item, even if Evi's part fails", () => {
        spies = stub();
        spies.push(spyOn(Collectibles, "mine").mockImplementation(() => { throw new Error("boom"); }));
        const out = PickerApi.saving({ pendingNameplate: null, pendingAvatarDecoration: { skuId: "evi:sakura" } }, "user");
        expect(out).toEqual({ pendingNameplate: null, pendingAvatarDecoration: undefined });
    });
});

describe("profile frames", () => {
    test("Discord's layer file names: index, type, anchor, responsive, the way its asset tool reads them", () => {
        expect(frameLayerFromName("0_staple_top.png", "foreground")).toEqual({ index: 0, layer: { type: "staple", order: "front", anchor: "top", responsive: false } });
        expect(frameLayerFromName("3_staple_bottom_responsive.png", "background")).toEqual({ index: 3, layer: { type: "staple", order: "back", anchor: "bottom", responsive: true } });
        expect(frameLayerFromName("1_border.png", "foreground")).toEqual({ index: 1, layer: { type: "border", order: "front", anchor: "center", responsive: false } });
        expect(frameLayerFromName("2_rail_center.png", "foreground")?.layer.responsive).toBe(true);
        for (const bad of ["staple_top.png", "0_frame_top.png", "0_staple.png", "0_border_top.png", "0_staple_top_wide.png"]) expect(frameLayerFromName(bad, "foreground")).toBeUndefined();
        const sorted = [{ index: 1, layer: { order: "back" as const } }, { index: 2, layer: { order: "front" as const } }, { index: 0, layer: { order: "front" as const } }].sort(frameLayerOrder);
        expect(sorted.map(l => `${l.layer.order}${l.index}`)).toEqual(["front0", "front2", "back1"]);
    });

    test("overflow is measured like Discord's tool: 716/304 top, 424/212 bottom, past 1200 wide", () => {
        const staple = (anchor: "top" | "bottom", width: number, height: number) => ({ layer: { type: "staple" as const, anchor }, width, height });
        expect(frameOverflow([staple("top", 1312, 716), staple("bottom", 1312, 424)])).toEqual({ overflowTop: 304, overflowBottom: 212, overflowHorizontal: 56 });
        expect(frameOverflow([staple("top", 1200, 300), { layer: { type: "border" as const, anchor: "center" as const }, width: 1200, height: 64 }])).toEqual({ overflowTop: 0, overflowBottom: 0, overflowHorizontal: 0 });
        expect(frameOverflow([])).toEqual({ overflowTop: 0, overflowBottom: 0, overflowHorizontal: 0 });
    });

    test("the contract: layered frames parse, old { animated, static } ones still do (Evi's previews only)", () => {
        const b = bundle("sakura");
        expect(b.frame!.layers).toEqual([
            { src: url("sakura", "frame-0.png"), type: "staple", order: "front", anchor: "top", responsive: false },
            { src: url("sakura", "frame-1.png"), type: "border", order: "back", anchor: "center", responsive: false },
        ]);
        const old = parseBundle({ id: "old", name: "Old", tier: "free", frame: { animated: url("old", "frame.png"), static: url("old", "frame-static.png") } });
        expect(old?.frame).toEqual({ layers: [], static: url("old", "frame-static.png"), animated: url("old", "frame.png") });
        // One bad layer: no layers rather than half a frame
        const bad = parseBundle({ id: "bad", name: "Bad", tier: "free", frame: { static: url("bad", "frame-static.png"), layers: [{ src: url("bad", "frame-0.png"), type: "staple", anchor: "top" }, { src: "https://example.com/x.png", type: "border" }] } });
        expect(bad?.frame?.layers).toEqual([]);
        const stated = parseBundle({ id: "s", name: "S", tier: "free", frame: { static: url("s", "frame-static.png"), layers: [], overflowTop: 304, overflowBottom: -1 } });
        expect(stated?.frame).toEqual({ layers: [], static: url("s", "frame-static.png"), overflowTop: 304 });
    });

    test("Discord's ProfileFrame record: no layers until they can all draw, then all of them by stable id", () => {
        const b = bundle("sakura");
        const overflow = { overflowTop: 304, overflowBottom: 212, overflowHorizontal: 56 };
        expect(frameFields(b, false, overflow).layers).toEqual([]);
        expect(frameFields(b, true, undefined).layers).toEqual([]);
        expect(frameFields(b, true, overflow)).toEqual({
            skuId: "evi:sakura", label: "Sakura", innerWidth: 1200, ...overflow,
            layers: [
                { id: layerId("sakura", 0), type: "staple", order: "front", anchor: "top", responsive: false },
                { id: "evi-sakura-1", type: "border", order: "back", anchor: "center", responsive: false },
            ],
        });
    });

    test("frame records and layer files: one for any evi: SKU (so Discord never fetches it), blobs by layer id", () => {
        const b = bundle("sakura");
        const spies = [
            spyOn(Collectibles, "bundle").mockImplementation((id: string) => id === "sakura" ? b : undefined),
            spyOn(Collectibles, "file").mockImplementation((u?: string) => u ? `blob:${u.split("/").pop()}` : undefined),
            spyOn(Collectibles, "loadAnimated").mockImplementation(() => { }),
        ];
        // No webpack here: plain records
        setItemClass("frame", null);
        try {
            expect(frameItem("evi:unknown")).toMatchObject({ skuId: "evi:unknown", layers: [] });
            expect(frameItem("123")).toBeUndefined();
            expect(frameLayerUrl("evi:sakura", "evi-sakura-1")).toBe("blob:frame-1.png?v=1");
            expect(frameLayerUrl("evi:sakura", "evi-other-1")).toBeUndefined();
            expect(frameLayerUrl("evi:sakura", "evi-sakura-9")).toBeUndefined();
        } finally {
            spies.forEach(s => s.mockRestore());
            setItemClass("frame", undefined);
        }
    });
});

describe("the request guard", () => {
    test("an evi: SKU in a Discord API address becomes SKU 0; searches and other sites are left alone", () => {
        expect(outgoingUrl("https://discord.com/api/v9/store/published-listings/skus/evi:sakura/subscription-plans")).toBe("https://discord.com/api/v9/store/published-listings/skus/0/subscription-plans");
        expect(outgoingUrl("/api/v9/collectibles-products/evi%3Asakura?locale=en")).toBe("/api/v9/collectibles-products/0?locale=en");
        expect(outgoingUrl("https://discord.com/api/v9/guilds/1/messages/search?content=evi:sakura")).toBeUndefined();
        expect(outgoingUrl("https://evi.rest/collectibles/evi:sakura")).toBeUndefined();
        expect(outgoingUrl("https://discord.com/api/v9/users/@me")).toBeUndefined();
    });
});
