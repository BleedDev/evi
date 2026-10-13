import { describe, expect, test } from "bun:test";

import { bundleFromSku, isBundleId, isCollectibleUrl, LAUNCH_BUNDLES, parseBundle, parseCollectibles, skuFor, validateEquip } from "../src/shared/collectibles";
import { cacheName, fetchUrlFor, fileVersion, mimeForExt, sniffMime } from "../src/shared/collectiblesFiles";

const file = (bundle: string, name: string, v = "abc123") => `https://evi.rest/collectibles/${bundle}/${name}?v=${v}`;
const layer = (n: number, over: Record<string, unknown> = {}) => ({ src: file("sakura", `effect-${n}.png`), loop: n > 0, start: n ? 2490 : 0, duration: 2490, loopDelay: 0, width: 450, height: 880, x: 0, y: 0, zIndex: 100 + n, ...over });
const sakura = () => ({
    id: "sakura",
    name: "Sakura River",
    description: "Cherry blossoms falling over a red bridge.",
    tier: "free",
    nameplate: { animated: file("sakura", "nameplate.webm"), static: file("sakura", "nameplate.png"), palette: "bubble_gum" },
    decoration: { animated: file("sakura", "decoration.png"), static: file("sakura", "decoration-static.png") },
    effect: { layers: [layer(0), layer(1)], static: file("sakura", "effect-static.png"), thumbnail: file("sakura", "effect-thumb.png") },
});

describe("collectible files", () => {
    test("only evi.rest's own collectible paths", () => {
        expect(isCollectibleUrl(file("sakura", "nameplate.webm"))).toBe(true);
        expect(isCollectibleUrl("https://evi.rest/collectibles/sakura/nameplate.png")).toBe(true);
        for (const bad of [
            "http://evi.rest/collectibles/sakura/nameplate.png",
            "https://evil.rest/collectibles/sakura/nameplate.png",
            "https://evi.rest.evil.com/collectibles/sakura/nameplate.png",
            "https://evi.rest/collectibles/../badges/x.png",
            "https://evi.rest/collectibles/sakura/nameplate.svg",
            "https://evi.rest/collectibles/Sakura/nameplate.png",
            "https://evi.rest/badges/sakura.png",
            `https://evi.rest/collectibles/sakura/${"a".repeat(300)}.png`,
            42,
            undefined,
        ]) expect(isCollectibleUrl(bad)).toBe(false);
    });

    test("cached by bundle, name and version, never outside the cache folder", () => {
        expect(cacheName(file("sakura", "effect-2.png", "1588636811"))).toEqual({ dir: "sakura", file: "effect-2.1588636811.png", name: "effect-2", ext: "png" });
        expect(cacheName("https://evi.rest/collectibles/neon/nameplate.webm")?.file).toBe("nameplate.0.webm");
        // A version that isn't plain is ignored rather than put in a file name
        expect(fileVersion("https://evi.rest/collectibles/neon/nameplate.webm?v=../../x")).toBe("0");
        expect(cacheName("https://evi.rest/collectibles/../../etc/passwd.png")).toBeUndefined();
        expect(cacheName("https://example.com/collectibles/neon/nameplate.webm")).toBeUndefined();
    });

    test("fetched from evi.rest, or from the API's own server when Evi talks to a local one", () => {
        const url = file("neon", "nameplate.webm", "5");
        expect(fetchUrlFor(url, "https://evi.rest/v1")).toBe(url);
        expect(fetchUrlFor(url, "http://127.0.0.1:8799/v1")).toBe("http://127.0.0.1:8799/collectibles/neon/nameplate.webm?v=5");
    });

    test("bytes must be what the name says", () => {
        expect(sniffMime(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe("image/png");
        expect(sniffMime(new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 1]))).toBe("video/webm");
        expect(sniffMime(new TextEncoder().encode("<svg onload=alert(1)>"))).toBeUndefined();
        expect(mimeForExt("webm")).toBe("video/webm");
        expect(mimeForExt("png")).toBe("image/png");
    });
});

describe("the collectibles document", () => {
    test("a full bundle comes through as it is", () => {
        const doc = parseCollectibles({ bundles: [sakura()], users: { "123456789012345678": { nameplate: "sakura", decoration: "sakura", effect: "sakura" } } });
        expect(doc?.bundles).toEqual([sakura() as any]);
        expect(doc?.users).toEqual({ "123456789012345678": { nameplate: "sakura", decoration: "sakura", effect: "sakura" } });
    });

    test("a malformed part is left out, a bundle with no parts dropped", () => {
        const bad = { ...sakura(), nameplate: { ...sakura().nameplate, palette: "rainbow" }, decoration: { animated: "https://evil.com/x.png", static: file("sakura", "d.png") } };
        expect(Object.keys(parseBundle(bad)!).filter(k => ["nameplate", "decoration", "effect"].includes(k))).toEqual(["effect"]);
        expect(parseBundle({ id: "empty", name: "Empty" })).toBeUndefined();
        expect(parseBundle({ ...sakura(), id: "Bad Id" })).toBeUndefined();
        expect(parseBundle({ ...sakura(), name: "  " })).toBeUndefined();
        // Anything but "supporter" is free
        expect(parseBundle({ ...sakura(), tier: "gold" })?.tier).toBe("free");
        expect(parseBundle({ ...sakura(), tier: "supporter" })?.tier).toBe("supporter");
    });

    test("an effect needs every layer well formed, and at most four", () => {
        const withLayers = (layers: unknown[]) => parseBundle({ ...sakura(), effect: { ...sakura().effect, layers } })?.effect;
        expect(withLayers([layer(0), layer(1, { duration: 0 })])).toBeUndefined();
        expect(withLayers([layer(0), layer(1, { src: "https://evi.rest/x.png" })])).toBeUndefined();
        expect(withLayers([layer(0), layer(1, { loop: "yes" })])).toBeUndefined();
        expect(withLayers([layer(0), layer(1, { start: 120_000 })])).toBeUndefined();
        expect(withLayers([layer(0), layer(1), layer(2), layer(3), layer(4)])).toBeUndefined();
        expect(withLayers([])).toBeUndefined();
        // Unknown fields don't come along
        expect(withLayers([layer(0, { onload: "x" })])?.layers[0]).not.toHaveProperty("onload");
    });

    test("people wear only what's listed, and only real Discord ids", () => {
        const doc = parseCollectibles({
            bundles: [sakura(), { ...sakura(), id: "neon", effect: undefined }],
            users: {
                "123456789012345678": { nameplate: "neon", effect: "neon", decoration: "gone" },
                "not-an-id": { nameplate: "sakura" },
                "223456789012345678": { nameplate: "gone" },
            },
        });
        expect(doc?.users).toEqual({ "123456789012345678": { nameplate: "neon" } });
    });

    test("a bundle listed twice counts once, and a document that isn't one is refused", () => {
        expect(parseCollectibles({ bundles: [sakura(), { ...sakura(), name: "Again" }], users: {} })?.bundles.map(b => b.name)).toEqual(["Sakura River"]);
        expect(parseCollectibles({ bundles: "x", users: {} })).toBeUndefined();
        expect(parseCollectibles({ bundles: [] })).toBeUndefined();
        expect(parseCollectibles(null)).toBeUndefined();
    });
});

describe("wearing", () => {
    test("each kind a bundle id or null, at least one", () => {
        expect(validateEquip({ userId: "123456789012345678", nameplate: "sakura", effect: null })).toEqual({ userId: "123456789012345678", changes: { nameplate: "sakura", effect: null } });
        expect(validateEquip({ userId: "123456789012345678" })).toEqual({ error: "Nothing to change" });
        expect(validateEquip({ userId: "1", nameplate: "sakura" })).toHaveProperty("error");
        expect(validateEquip({ userId: "123456789012345678", nameplate: "Bad Id" })).toHaveProperty("error");
        expect(validateEquip({ userId: "123456789012345678", decoration: 5 })).toHaveProperty("error");
        expect(validateEquip(null)).toHaveProperty("error");
    });

    test("sentinel SKUs go both ways, and nothing else reads as one", () => {
        expect(skuFor("sakura")).toBe("evi:sakura");
        expect(bundleFromSku("evi:sakura")).toBe("sakura");
        for (const sku of ["1144058522808614923", "evi:", "evi:Bad Id", "evi-sakura", null, 5]) expect(bundleFromSku(sku)).toBeUndefined();
    });

    test("the launch bundles have usable ids", () => {
        expect(LAUNCH_BUNDLES.length).toBe(9);
        expect(LAUNCH_BUNDLES.every(b => isBundleId(b.id))).toBe(true);
    });
});
