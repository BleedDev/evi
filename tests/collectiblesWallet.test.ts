/**
 * Your wallet in the page (renderer/collectibles/wallet.ts): loaded from main, owns(), what wear()
 * refuses before asking evi.rest, and buying, redeeming and main's pushes updating it.
 */
import { beforeEach, describe, expect, test } from "bun:test";

import { createWallet, WalletBridge } from "../src/renderer/collectibles/wallet";
import type { Wallet } from "../src/shared/collectibles";

const ME = "123456789012345678";
const OTHER = "876543210987654321";

function setup(answer: () => unknown = () => ({ ok: true, wallet: { userId: ME, sparks: 900, owned: { sakura: ["nameplate"] } } })) {
    const calls = { wallet: [] as unknown[][], buy: [] as unknown[][], changed: 0 };
    let push: ((result: any) => void) | undefined;
    let me: string | undefined = ME;
    const bridge: WalletBridge = {
        collectiblesWallet: async (...args) => (calls.wallet.push(args), answer() as any),
        onCollectiblesWallet: cb => void (push = cb),
        buyCollectible: async (...args) => {
            calls.buy.push(args);
            return { ok: true, wallet: { userId: ME, sparks: 500, owned: { sakura: ["nameplate", "decoration"] } } };
        },
        redeemCollectibleCode: async () => ({ ok: true, wallet: { userId: ME, sparks: 1400, owned: { sakura: ["nameplate"] } }, granted: { sparks: 500, items: [] } }),
    };
    const wallet = createWallet(bridge, () => me, () => void calls.changed++);
    return { wallet, calls, push: (r: unknown) => push?.(r), setMe: (id: string | undefined) => void (me = id) };
}

describe("your wallet in the page", () => {
    let s: ReturnType<typeof setup>;
    beforeEach(async () => {
        s = setup();
        await s.wallet.load();
    });

    test("loads from main and answers owns()", () => {
        expect(s.wallet.current()?.sparks).toBe(900);
        expect(s.wallet.owns("sakura", "nameplate")).toBe(true);
        expect(s.wallet.owns("sakura", "decoration")).toBe(false);
        expect(s.wallet.owns("nope", "nameplate")).toBe(false);
        expect(s.calls.changed).toBe(1);
    });

    test("wearing: a part you don't own is refused, taking off never is", async () => {
        expect(await s.wallet.unowned({ decoration: "sakura" })).toBe("decoration");
        expect(await s.wallet.unowned({ nameplate: "sakura", effect: "sakura" })).toBe("effect");
        expect(await s.wallet.unowned({ nameplate: "sakura" })).toBeUndefined();
        expect(await s.wallet.unowned({ decoration: null, effect: null })).toBeUndefined();
    });

    test("buying and redeeming update it", async () => {
        const bought = await s.wallet.buy("sakura", "decoration");
        expect(bought.ok).toBe(true);
        expect(s.calls.buy[0]).toEqual([ME, "sakura", "decoration"]);
        expect(s.wallet.owns("sakura", "decoration")).toBe(true);
        expect(s.wallet.current()?.sparks).toBe(500);

        const redeemed = await s.wallet.redeem("SPRING-26");
        expect(redeemed.ok && redeemed.granted.sparks).toBe(500);
        expect(s.wallet.current()?.sparks).toBe(1400);
    });

    test("main's push: yours replaces it, someone else's is ignored", () => {
        const other: Wallet = { userId: OTHER, sparks: 5, owned: {} };
        s.push({ ok: true, wallet: other });
        expect(s.wallet.current()?.userId).toBe(ME);
        s.push({ ok: true, wallet: { userId: ME, sparks: 42, owned: {} } });
        expect(s.wallet.current()?.sparks).toBe(42);
        // A failed refetch keeps the wallet that's there
        s.push({ ok: false, error: "offline" });
        expect(s.wallet.current()?.sparks).toBe(42);
        expect(s.wallet.error()).toBeUndefined();
    });

    test("another Discord account: not the old wallet, and asks for the new one", async () => {
        s.setMe(OTHER);
        expect(s.wallet.current()).toBeUndefined();
        await new Promise(r => setTimeout(r, 0));
        expect(s.calls.wallet.at(-1)?.[0]).toBe(OTHER);
    });
});

describe("not linked", () => {
    test("no wallet, the reason kept, and wearing left to evi.rest", async () => {
        const s = setup(() => ({ ok: false, error: "Link this install first", unlinked: true }));
        await s.wallet.load();
        expect(s.wallet.current()).toBeUndefined();
        expect(s.wallet.error()?.unlinked).toBe(true);
        expect(await s.wallet.unowned({ nameplate: "sakura" })).toBeUndefined();
        // It doesn't ask again on every read; refreshing does
        const asked = s.calls.wallet.length;
        s.wallet.current();
        expect(s.calls.wallet.length).toBe(asked);
        await s.wallet.load(true);
        expect(s.calls.wallet.length).toBe(asked + 1);
    });

    test("without a bridge (an older main) nothing breaks", async () => {
        const wallet = createWallet(undefined, () => ME, () => { });
        await wallet.load();
        expect(wallet.current()).toBeUndefined();
        expect((await wallet.buy("sakura")).ok).toBe(false);
        expect((await wallet.redeem("CODE-1234")).ok).toBe(false);
    });
});
