import { describe, expect, test } from "bun:test";

import { Bundle, bundleCost, normalizeCode, Wallet } from "../src/shared/collectibles";
import { codeBody, CodeForm, parseAdminWallet, parseAllowance, parseCodes, parseDelta, parsePriceList, pricesBody } from "../src/shared/collectiblesAdmin";
import { isAdminRoute } from "../src/shared/devAdmin";
import { afterBuying, bundleOffer, cardOffer, generateCode, ownsPart, parseGranted, parseRedeem, partOffer, refusalFrom, typedCode, withBought } from "../src/shared/sparks";

const ME = "123456789012345678";
const url = (file: string) => `https://evi.rest/collectibles/sakura/${file}.png`;

const sakura: Bundle = {
    id: "sakura",
    name: "Sakura River",
    description: "",
    tier: "free",
    nameplate: { animated: "https://evi.rest/collectibles/sakura/nameplate.webm", static: url("nameplate"), palette: "bubble_gum" },
    decoration: { animated: url("decoration"), static: url("decoration-static") },
    effect: { layers: [], static: url("effect-static"), thumbnail: url("effect-thumb") },
    frame: { layers: [], animated: url("frame"), static: url("frame-static") },
    prices: { bundle: 1200, nameplate: 500, decoration: 400, effect: 400, frame: 200 },
};

const wallet = (sparks: number, owned: Wallet["owned"] = {}): Wallet => ({ userId: ME, sparks, owned });

describe("what a part offers you", () => {
    test("its price, owned, or codes only", () => {
        expect(partOffer(sakura, "nameplate", wallet(0))).toEqual({ state: "buy", price: 500 });
        expect(partOffer(sakura, "nameplate", wallet(0, { sakura: ["nameplate"] }))).toEqual({ state: "owned" });
        const unpriced = { ...sakura, prices: { bundle: 1200 } };
        expect(partOffer(unpriced, "frame", wallet(0))).toEqual({ state: "code" });
        // No wallet yet (loading, or not linked): still shows the price
        expect(partOffer(sakura, "effect", undefined)).toEqual({ state: "buy", price: 400 });
    });

    test("the whole bundle costs less than its parts, and says by how much", () => {
        expect(bundleOffer(sakura, wallet(0))).toEqual({ state: "buy", price: 1200, save: 300, parts: ["nameplate", "decoration", "effect", "frame"] });
        expect(cardOffer(sakura, "bundle", wallet(0))).toEqual({ state: "buy", price: 1200 });
    });

    test("the rest of a partly owned bundle costs bundleCost: the remaining parts", () => {
        const w = wallet(0, { sakura: ["nameplate", "frame"] });
        expect(bundleCost(sakura, ["nameplate", "frame"])).toBe(800);
        expect(bundleOffer(sakura, w)).toEqual({ state: "buy", price: 800, save: 0, parts: ["decoration", "effect"] });
    });

    test("all owned, or nothing priced", () => {
        expect(bundleOffer(sakura, wallet(0, { sakura: ["nameplate", "decoration", "effect", "frame"] }))).toEqual({ state: "owned" });
        expect(bundleOffer({ ...sakura, prices: undefined }, wallet(0)).state).toBe("code");
    });

    test("a bundle without a frame has three parts", () => {
        const { frame, ...noFrame } = sakura;
        void frame;
        const offer = bundleOffer(noFrame, wallet(0));
        expect(offer.state === "buy" && offer.parts).toEqual(["nameplate", "decoration", "effect"]);
        expect(offer.state === "buy" && offer.save).toBe(100);
    });

    test("whether a wallet covers a price, and what's left", () => {
        expect(afterBuying(wallet(1500), 1200)).toEqual({ enough: true, left: 300, short: 0 });
        expect(afterBuying(wallet(900), 1200)).toEqual({ enough: false, left: 0, short: 300 });
        expect(afterBuying(undefined, 10)).toEqual({ enough: false, left: 0, short: 10 });
    });

    test("bought: the parts join what you own and the Sparks go", () => {
        const w = withBought(wallet(1500, { sakura: ["frame"] }), sakura, "nameplate", 500);
        expect(w.sparks).toBe(1000);
        expect(w.owned.sakura).toEqual(["nameplate", "frame"]);
        expect(ownsPart(withBought(wallet(1200), sakura, undefined, 1200), "sakura", "effect")).toBe(true);
    });
});

describe("codes as typed", () => {
    test("upper case, letters, digits and dashes", () => {
        expect(typedCode("evi-k7qm x2pd!")).toBe("EVI-K7QMX2PD");
        expect(typedCode("a".repeat(60)).length).toBe(40);
        expect(normalizeCode(typedCode(" spring-2026 "))).toBe("SPRING-2026");
    });

    test("generated codes are readable and valid", () => {
        for (let i = 0; i < 50; i++) {
            const code = generateCode();
            expect(code).toMatch(/^[A-HJ-NP-Z2-9]{4}(-[A-HJ-NP-Z2-9]{4}){3}$/);
            expect(normalizeCode(code)).toBe(code);
        }
    });
});

describe("evi.rest's answers", () => {
    test("refusals keep why, and the numbers for not enough Sparks", () => {
        expect(refusalFrom("Not enough Sparks", 402, { error: "Not enough Sparks", code: "insufficient", need: 1200, have: 300 }))
            .toEqual({ ok: false, error: "Not enough Sparks", code: "insufficient", need: 1200, have: 300 });
        expect(refusalFrom("Link first", 401, { error: "Link first" })).toEqual({ ok: false, error: "Link first", unlinked: true });
        expect(refusalFrom("Owned", 409, {}).code).toBe("owned");
        expect(refusalFrom("Slow down", 429, {}).code).toBe("rate_limited");
        expect(refusalFrom("x", 403, { code: "not_owned" }).code).toBe("not_owned");
        expect(refusalFrom("x", 400, { code: "something-else" }).code).toBeUndefined();
        expect(refusalFrom("x", 402, { code: "insufficient", need: -1, have: "lots" })).toEqual({ ok: false, error: "x", code: "insufficient" });
    });

    test("what a code gave", () => {
        expect(parseGranted({ sparks: 500, items: [{ bundle: "sakura", kinds: ["frame", "nope"] }, { bundle: "../x" }] }))
            .toEqual({ sparks: 500, items: [{ bundle: "sakura", kinds: ["frame"] }] });
        expect(parseGranted(null)).toEqual({ sparks: 0, items: [] });
        expect(parseRedeem({ wallet: { userId: ME, sparks: 500, owned: {} }, granted: { sparks: 500 } })?.granted.sparks).toBe(500);
        expect(parseRedeem({ wallet: { userId: "nope", sparks: 1, owned: {} } })).toBeUndefined();
    });
});

describe("the Developers page's Collectibles tab", () => {
    test("only its own admin routes go through", () => {
        expect(isAdminRoute("GET", "/admin/collectibles/prices")).toBe(true);
        expect(isAdminRoute("PUT", "/admin/collectibles/prices/sakura")).toBe(true);
        expect(isAdminRoute("PUT", "/admin/collectibles/prices/../x")).toBe(false);
        expect(isAdminRoute("POST", "/admin/collectibles/codes")).toBe(true);
        expect(isAdminRoute("PATCH", "/admin/collectibles/codes/EVI-K7QM-X2PD")).toBe(true);
        expect(isAdminRoute("PATCH", "/admin/collectibles/codes/evi-lower")).toBe(false);
        expect(isAdminRoute("PATCH", "/admin/people?page=1&size=1")).toBe(false);
        expect(isAdminRoute("POST", `/admin/users/${ME}/sparks`)).toBe(true);
        expect(isAdminRoute("PUT", `/admin/users/${ME}/collectibles`)).toBe(true);
        expect(isAdminRoute("DELETE", `/admin/users/${ME}/collectibles`)).toBe(true);
        expect(isAdminRoute("GET", `/admin/users/${ME}/wallet`)).toBe(true);
        expect(isAdminRoute("PUT", "/admin/collectibles/allowance")).toBe(true);
        expect(isAdminRoute("DELETE", "/admin/collectibles/allowance")).toBe(false);
    });

    test("prices: blank isn't sold, anything else must be whole Sparks", () => {
        expect(pricesBody({ bundle: "1200", nameplate: "", effect: " 400 " }, ["bundle", "nameplate", "effect"])).toEqual({ bundle: 1200, nameplate: null, effect: 400 });
        expect(pricesBody({ bundle: "12.5" }, ["bundle"])).toEqual({ error: "bundle" });
        expect(pricesBody({ frame: "2000000" }, ["frame"])).toEqual({ error: "frame" });
        const [b] = parsePriceList({ bundles: [{ id: "sakura", name: "Sakura River", parts: ["nameplate", "frame", "x"], prices: { bundle: 1200, frame: -1 }, cost: 1200, owners: 3 }, { id: "../no" }] });
        expect(b).toEqual({ id: "sakura", name: "Sakura River", tier: "free", parts: ["nameplate", "frame"], prices: { bundle: 1200 }, cost: 1200, owners: 3 });
    });

    test("a new code from the form", () => {
        const form: CodeForm = { code: "", sparks: "500", items: [], maxUses: "", perUserOnce: true, expires: "", note: " launch " };
        expect(codeBody(form)).toEqual({ perUserOnce: true, note: "launch", sparks: 500, items: [], maxUses: null, expiresAt: null });
        expect(codeBody({ ...form, sparks: "" })).toEqual({ error: "empty" });
        expect(codeBody({ ...form, code: "no" })).toEqual({ error: "code" });
        expect(codeBody({ ...form, maxUses: "0" })).toEqual({ error: "maxUses" });
        expect(codeBody({ ...form, expires: "2020-01-01" })).toEqual({ error: "expires" });
        const body = codeBody({ ...form, code: "spring-26", sparks: "", items: [{ bundle: "sakura", kinds: ["frame"] }], maxUses: "10", expires: "2099-12-31" }) as Record<string, unknown>;
        expect(body.code).toBe("SPRING-26");
        expect(body.maxUses).toBe(10);
        expect(body.items).toEqual([{ bundle: "sakura", kinds: ["frame"] }]);
        expect(typeof body.expiresAt).toBe("number");
    });

    test("codes, wallets and the allowance as evi.rest sends them", () => {
        const [code] = parseCodes({ codes: [{ code: "EVI-AAAA-BBBB", sparks: 100, items: [{ bundle: "sakura" }], maxUses: null, uses: 2, perUserOnce: true, expiresAt: null, note: "", createdAt: 1, disabled: false, state: "active" }, { nope: 1 }] });
        expect(code).toMatchObject({ code: "EVI-AAAA-BBBB", sparks: 100, items: [{ bundle: "sakura" }], uses: 2, state: "active" });
        expect(code.maxUses).toBeUndefined();

        const w = parseAdminWallet({
            wallet: { userId: ME, sparks: 40, owned: { sakura: ["frame"] } },
            parts: [{ bundle: "sakura", kind: "frame", source: "code:X", at: 5 }, { bundle: "sakura", kind: "hat", source: "", at: 1 }],
            ledger: [{ id: 3, delta: -200, balance: 40, reason: "buy", ref: "sakura:frame", actor: null, created_at: 2, at: 2 }],
            allowance: { level: "supporter-gold", perMonth: 300, lastMonth: "2026-10" },
        })!;
        expect(w.wallet.sparks).toBe(40);
        expect(w.parts).toEqual([{ bundle: "sakura", kind: "frame", source: "code:X", at: 5 }]);
        expect(w.ledger[0]).toEqual({ id: 3, delta: -200, balance: 40, reason: "buy", ref: "sakura:frame", actor: undefined, at: 2 });
        expect(w.allowance).toEqual({ level: "supporter-gold", perMonth: 300, lastMonth: "2026-10" });
        expect(parseAdminWallet({ wallet: null })).toBeUndefined();

        expect(parseAllowance({ perLevel: { a: 1 }, levels: [{ id: "a", name: "Bronze", days: 30, sparks: 100 }] })).toEqual([{ id: "a", name: "Bronze", days: 30, sparks: 100 }]);
        expect(parseAllowance({ perLevel: { a: 5 } })).toEqual([{ id: "a", name: "a", days: 0, sparks: 5 }]);
    });

    test("Sparks to give or take", () => {
        expect(parseDelta("+250")).toBe(250);
        expect(parseDelta("-40")).toBe(-40);
        expect(parseDelta("0")).toBeUndefined();
        expect(parseDelta("1.5")).toBeUndefined();
        expect(parseDelta("99999999")).toBeUndefined();
    });
});
