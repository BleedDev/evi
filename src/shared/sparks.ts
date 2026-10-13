/**
 * Owning Evi collectibles, as Evi reads evi.rest's answers and shows prices (shared/collectibles.ts has
 * the contract): what a refusal means, what a code gave you, and what each part of a bundle offers you
 * now (wear it, buy it, or only get it with a code). Pure, so the shop, the settings page and tests
 * agree on every number.
 */
import { Bundle, bundleCost, CollectibleKind, isBundleId, KINDS, parseWallet, Wallet } from "./collectibles";

/** Why evi.rest said no, the ones Evi explains in its own words */
export type RefusalCode = "insufficient" | "not_owned" | "owned" | "not_for_sale" | "rate_limited" | "invalid_code" | "used_up" | "expired" | "supporter";

/** A refused buy, redeem or wear, as main hands it to the page */
export interface Refusal {
    ok: false;
    error: string;
    /** This Evi needs linking to your account first */
    unlinked?: boolean;
    code?: RefusalCode;
    /** insufficient: the Sparks it costs and the ones you have */
    need?: number;
    have?: number;
}

const CODES: RefusalCode[] = ["insufficient", "not_owned", "owned", "not_for_sale", "rate_limited", "invalid_code", "used_up", "expired", "supporter"];
const count = (v: unknown) => Number.isInteger(v) && (v as number) >= 0 ? v as number : undefined;

/** A refusal from evi.rest's status and JSON body (`{ error, code, need, have }`) */
export function refusalFrom(error: string, status: number | undefined, body: any): Refusal {
    const raw = typeof body?.code === "string" ? body.code : undefined;
    let code: RefusalCode | undefined = CODES.find(c => c === raw);
    if (!code) {
        if (status === 409) code = "owned";
        else if (status === 429) code = "rate_limited";
        else if (status === 404 && raw === undefined && /sale|price/i.test(error)) code = "not_for_sale";
    }
    const out: Refusal = { ok: false, error: error.slice(0, 300) };
    if (status === 401) out.unlinked = true;
    if (code) out.code = code;
    const need = count(body?.need), have = count(body?.have);
    if (need !== undefined) out.need = need;
    if (have !== undefined) out.have = have;
    return out;
}

/** What a code gave: Sparks, and parts by bundle */
export interface Granted {
    sparks: number;
    items: { bundle: string; kinds: CollectibleKind[]; }[];
}

export function parseGranted(raw: any): Granted {
    const items = (Array.isArray(raw?.items) ? raw.items : []).slice(0, 50).flatMap((item: any) => {
        if (!isBundleId(item?.bundle)) return [];
        const kinds = Array.isArray(item.kinds) ? KINDS.filter(k => item.kinds.includes(k)) : [];
        return [{ bundle: item.bundle as string, kinds }];
    });
    return { sparks: count(raw?.sparks) ?? 0, items };
}

/** POST /me/collectibles/redeem's answer */
export function parseRedeem(raw: any): { wallet: Wallet; granted: Granted; } | undefined {
    const wallet = parseWallet(raw?.wallet);
    return wallet ? { wallet, granted: parseGranted(raw?.granted) } : undefined;
}

/** The parts of a bundle, in Evi's order */
export const partsOf = (bundle: Bundle): CollectibleKind[] => KINDS.filter(k => bundle[k]);

export const ownedOf = (wallet: Wallet | undefined, bundleId: string): CollectibleKind[] => wallet?.owned[bundleId] ?? [];

export const ownsPart = (wallet: Wallet | undefined, bundleId: string, kind: CollectibleKind) => ownedOf(wallet, bundleId).includes(kind);

/** What one part offers you */
export type PartOffer =
    | { state: "owned"; }
    /** Sold: its price */
    | { state: "buy"; price: number; }
    /** No price: codes only */
    | { state: "code"; };

export function partOffer(bundle: Bundle, kind: CollectibleKind, wallet: Wallet | undefined): PartOffer {
    if (ownsPart(wallet, bundle.id, kind)) return { state: "owned" };
    const price = bundle.prices?.[kind];
    return price === undefined ? { state: "code" } : { state: "buy", price };
}

/** What the whole bundle (or the rest of it) offers you, and what that saves over buying the parts one by one */
export type BundleOffer =
    | { state: "owned"; }
    | { state: "buy"; price: number; save: number; parts: CollectibleKind[]; }
    | { state: "code"; parts: CollectibleKind[]; };

export function bundleOffer(bundle: Bundle, wallet: Wallet | undefined): BundleOffer {
    const owned = ownedOf(wallet, bundle.id);
    const parts = partsOf(bundle).filter(k => !owned.includes(k));
    if (!parts.length) return { state: "owned" };
    const price = bundleCost(bundle, owned);
    if (price === undefined) return { state: "code", parts };
    // Saving only counts when every remaining part has a price to compare with
    const separately = parts.every(k => bundle.prices?.[k] !== undefined) ? parts.reduce((n, k) => n + bundle.prices![k]!, 0) : price;
    return { state: "buy", price, save: Math.max(0, separately - price), parts };
}

/** A card's line: the bundle's (or part's) price, owned, or codes only */
export function cardOffer(bundle: Bundle, kind: CollectibleKind | "bundle", wallet: Wallet | undefined): PartOffer {
    if (kind !== "bundle") return partOffer(bundle, kind, wallet);
    const offer = bundleOffer(bundle, wallet);
    return offer.state === "buy" ? { state: "buy", price: offer.price } : offer.state === "owned" ? { state: "owned" } : { state: "code" };
}

/** Whether a wallet covers a price, and what's left after */
export function afterBuying(wallet: Wallet | undefined, price: number): { enough: boolean; left: number; short: number; } {
    const have = wallet?.sparks ?? 0;
    return { enough: have >= price, left: Math.max(0, have - price), short: Math.max(0, price - have) };
}

/** A wallet with a part (or a whole bundle) bought, shown before evi.rest's answer replaces it */
export function withBought(wallet: Wallet, bundle: Bundle, kind: CollectibleKind | undefined, price: number): Wallet {
    const owned = ownedOf(wallet, bundle.id);
    const kinds = kind ? [kind] : partsOf(bundle);
    return {
        ...wallet,
        sparks: Math.max(0, wallet.sparks - price),
        owned: { ...wallet.owned, [bundle.id]: KINDS.filter(k => owned.includes(k) || kinds.includes(k)) },
    };
}

/** A code as typed: upper case, letters, digits and dashes only, as many as a code can have */
export const typedCode = (value: string) => value.toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, 40);

/** A code to hand out: four groups of four, letters and digits that can't be mistaken for each other */
export function generateCode(random: (n: number) => number = n => Math.floor(Math.random() * n)) {
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    return Array.from({ length: 4 }, () => Array.from({ length: 4 }, () => alphabet[random(alphabet.length)]).join("")).join("-");
}
