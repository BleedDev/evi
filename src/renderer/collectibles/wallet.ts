/**
 * Your wallet in the page (shared/sparks.ts): your Sparks and the parts you own, from main, which asks
 * evi.rest and pushes a new one after a purchase, a code, or evi.rest's `wallet` event. Kept apart from
 * store.ts and handed its bridge and your id, so it can be tested on its own.
 */
import type { CollectibleKind, Wallet } from "@shared/collectibles";
import { KINDS } from "@shared/collectibles";
import type { CollectiblesChanges, RedeemResult, WalletResult } from "@shared/ipc";
import { ownsPart, Refusal } from "@shared/sparks";

/** The part of main's bridge this needs (preload/index.ts) */
export interface WalletBridge {
    collectiblesWallet?(userId: string, fresh?: boolean): Promise<WalletResult>;
    onCollectiblesWallet?(cb: (result: WalletResult) => void): void;
    buyCollectible?(userId: string, bundle: string, kind?: CollectibleKind): Promise<WalletResult>;
    redeemCollectibleCode?(userId: string, code: string): Promise<RedeemResult>;
}

const failed = (err: unknown) => ({ ok: false as const, error: String(err) });

export function createWallet(bridge: WalletBridge | undefined, myId: () => string | undefined, changed: () => void) {
    let wallet: Wallet | undefined;
    /** Why it couldn't load (not linked, offline); cleared when it does */
    let error: Refusal | undefined;
    let loading: Promise<void> | undefined;

    function set(next: Wallet) {
        if (next.userId !== myId()) return;
        wallet = next;
        error = undefined;
        changed();
    }

    function fail(why: Refusal) {
        error = why;
        changed();
    }

    function load(fresh = false): Promise<void> {
        const me = myId();
        if (!me || !bridge?.collectiblesWallet) return Promise.resolve();
        return loading ??= (async () => {
            const result: WalletResult = await bridge.collectiblesWallet!(me, fresh).catch(failed);
            if (result.ok) set(result.wallet);
            else fail(result);
        })().finally(() => void (loading = undefined));
    }

    /** Yours, when it's loaded and it's this Discord account's */
    function current(): Wallet | undefined {
        const me = myId();
        if (!me) return undefined;
        if (wallet?.userId === me) return wallet;
        // Not asked yet (Discord had no user when collectibles started), or another account now
        if (!loading && !error) void load();
        return undefined;
    }

    // Pushed by main after a purchase, a code, or evi.rest saying your wallet changed
    bridge?.onCollectiblesWallet?.(result => {
        if (result.ok) set(result.wallet);
        else if (!wallet) fail(result);
    });

    return {
        current,
        error: () => error,
        load,
        owns: (bundleId: string, kind: CollectibleKind) => ownsPart(current(), bundleId, kind),

        /**
         * The first part `changes` would put on that you don't own, once the wallet is here. Without a
         * wallet (not linked, offline) nothing is refused here: evi.rest decides.
         */
        async unowned(changes: CollectiblesChanges): Promise<CollectibleKind | undefined> {
            const putOn = KINDS.filter(k => typeof changes[k] === "string");
            if (!putOn.length) return undefined;
            if (!current()) await load();
            const w = current();
            return w ? putOn.find(k => !ownsPart(w, changes[k] as string, k)) : undefined;
        },

        async buy(bundleId: string, kind?: CollectibleKind): Promise<WalletResult> {
            const me = myId();
            if (!me || !bridge?.buyCollectible) return { ok: false, error: "This Evi can't buy collectibles" };
            const result: WalletResult = await bridge.buyCollectible(me, bundleId, kind).catch(failed);
            // Refused because it was bought elsewhere, or the Sparks changed: main fetches what's true now
            if (result.ok) set(result.wallet);
            return result;
        },

        async redeem(code: string): Promise<RedeemResult> {
            const me = myId();
            if (!me || !bridge?.redeemCollectibleCode) return { ok: false, error: "This Evi can't redeem codes" };
            const result: RedeemResult = await bridge.redeemCollectibleCode(me, code).catch(failed);
            if (result.ok) set(result.wallet);
            return result;
        },
    };
}
