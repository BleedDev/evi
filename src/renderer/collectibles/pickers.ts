/**
 * Evi collectibles in Discord's own pickers: "Change Nameplate", "Change Avatar Decoration",
 * "Change Profile Effect" and "Change Profile Frame" in the profile editor (pickerPatches.ts has the
 * patches, Discord's code they change and why).
 *
 * - Yours from Evi come after Discord's own in "Your Nameplates" (and the others), marked with Evi's
 *   "e"; ones you don't own yet are in a "From Evi" section with a lock and their price in Sparks.
 * - Choosing one previews it in the picker's preview like Discord's, and Apply makes it the profile
 *   editor's pending change, so the editor's preview shows it too.
 * - Save Changes then wears it through Evi (Collectibles.equip), never through Discord: Discord's
 *   request body for that change is built without it. Choosing None or one of Discord's own takes
 *   the Evi one of that kind off, and Discord saves its part as usual.
 * - An Evi item you don't own opens Evi's product dialog where Discord would open its Shop.
 *
 * Server profiles have no Evi items: Evi's are the same everywhere, so a server's picker lists only
 * Discord's, and a server profile's save never changes what you wear through Evi.
 */
import { Bundle, bundleFromSku, CollectibleKind, KINDS, skuFor } from "@shared/collectibles";
import type { CollectiblesChanges } from "@shared/ipc";

import { t } from "../i18n";
import { Logger } from "../logger";
import { getPatchRecords, SourcePatch } from "../patching/source";
import { showToast } from "../toolkit/toasts";
import { frameItem, framesVersion } from "./frames";
import { ITEM_TYPE, makeItem } from "./items";
import { Collectibles, CollectiblesApi } from "./store";

const logger = new Logger("Collectibles", "#c27aff");

/** The patches a kind's picker needs to list Evi items, set by pickerPatches.ts (kept apart to avoid an import cycle) */
let required: Partial<Record<CollectibleKind, SourcePatch[]>> = {};
export const setPickerPatches = (byKind: Partial<Record<CollectibleKind, SourcePatch[]>>) => void (required = byKind);

/** Whether Evi items can be listed in a kind's picker: it draws them, and choosing one saves through Evi */
export function pickerReady(kind: CollectibleKind): boolean {
    if (!Collectibles.drawn(kind)) return false;
    const patches = required[kind];
    if (!patches?.length) return false;
    const records = getPatchRecords("evi");
    return patches.every(p => {
        const state = records.find(r => r.patch === p)?.state;
        return state === "applied" || state === "pending";
    });
}

/** The pending change each kind is in Discord's profile editor */
const PENDING: Record<CollectibleKind, string> = {
    nameplate: "pendingNameplate",
    decoration: "pendingAvatarDecoration",
    effect: "pendingProfileEffect",
    frame: "pendingProfileFrame",
};

/** Which of Discord's request bodies (module 56348) carries which kinds */
const PARTS = {
    user: ["nameplate", "decoration"],
    profile: ["effect", "frame"],
    member: ["nameplate", "decoration"],
} as const satisfies Record<string, CollectibleKind[]>;
export type SavePart = keyof typeof PARTS;

// ---- items ----

/** Discord's item for one part of a bundle, as its pickers list them; one per bundle until the list changes */
const items = new Map<string, { at: number; item: object | undefined; }>();

export function itemFor(bundle: Bundle, kind: CollectibleKind): object | undefined {
    // A frame's record changes as its layers arrive and are measured: frames.ts keeps it
    if (kind === "frame") return frameItem(skuFor(bundle.id));
    const key = `${kind}:${bundle.id}`;
    const at = Collectibles.getVersion();
    const have = items.get(key);
    if (have?.at === at) return have.item;
    const sku = skuFor(bundle.id);
    let item: object | undefined;
    switch (kind) {
        case "nameplate":
            item = makeItem(kind, { skuId: sku, asset: sku, label: bundle.name, palette: bundle.nameplate!.palette });
            break;
        case "decoration":
            item = makeItem(kind, { skuId: sku, asset: sku, label: bundle.name });
            break;
        case "effect":
            item = makeItem(kind, { skuId: sku, title: bundle.name, description: bundle.description, accessibilityLabel: bundle.name, effects: [], animationType: 1 });
            break;
    }
    items.set(key, { at, item });
    return item;
}

/** Whether you own a part, or wear it (wearing one needed owning it, and the wallet may not have loaded) */
export function yours(bundleId: string, kind: CollectibleKind) {
    return Collectibles.owns(bundleId, kind) || Collectibles.mine()[kind] === bundleId;
}

/** The Evi item a picker's selection stands for ({ skuId } or an item), for its preview; undefined for Discord's */
export function pickerItem(selected: unknown, kind: CollectibleKind): object | undefined {
    // Asked before the modal's footer looks its product up (and before its grid renders): the picker open now
    openKind = kind;
    const id = bundleFromSku((selected as { skuId?: unknown; } | null)?.skuId);
    const bundle = id ? Collectibles.bundle(id) : undefined;
    return bundle?.[kind] ? itemFor(bundle, kind) : undefined;
}

/** What you wear of a kind through Evi, in the shape Discord's own value has there (pending comparisons, current values) */
export function own(kind: CollectibleKind): object | undefined {
    const me = Collectibles.myId();
    if (!me) return undefined;
    switch (kind) {
        case "nameplate": return CollectiblesApi.nameplate(me);
        case "decoration": return CollectiblesApi.decoration(me);
        case "effect": return CollectiblesApi.profileEffect(me);
        case "frame": return (CollectiblesApi as { profileFrame?(id: string): object | undefined; }).profileFrame?.(me);
    }
}

// ---- the sections ----

export interface PickerSection {
    section: string;
    items: unknown[];
    height?: number;
    header?: string;
    [other: string]: unknown;
}

/** Evi's section key, beside Discord's "purchase", "premium_purchase" and "preview" */
export const EVI_SECTION = "evi";

const sectionCache = new WeakMap<object, { key: string; out: PickerSection[]; }>();

/**
 * A picker's sections with Evi's: yours after Discord's own in the first ("Your …"), the rest that
 * are sold in "From Evi", before Discord's "See What's in Shop". The same array back when there's
 * nothing to add, and the same new one until something changes.
 */
export function withEviSections(kind: CollectibleKind, sections: PickerSection[], guildId: unknown): PickerSection[] {
    openKind = kind;
    if (!Array.isArray(sections) || guildId != null || !pickerReady(kind)) return sections;
    const key = `${kind}:${Collectibles.getVersion()}:${kind === "frame" ? framesVersion() : ""}`;
    const have = sectionCache.get(sections);
    if (have?.key === key) return have.out;

    const owned: object[] = [], forSale: object[] = [];
    for (const bundle of Collectibles.bundles()) {
        if (!bundle[kind] || (kind === "frame" && !bundle.frame!.layers.length)) continue;
        const mine = yours(bundle.id, kind);
        if (!mine && bundle.prices?.[kind] === undefined) continue;
        const item = itemFor(bundle, kind);
        if (!item) return sections;
        (mine ? owned : forSale).push(item);
    }
    let out = sections;
    if (owned.length || forSale.length) {
        out = sections.map(s => s.section === "purchase" && owned.length ? { ...s, items: [...s.items, ...owned] } : s);
        if (forSale.length) {
            const evi: PickerSection = { section: EVI_SECTION, items: forSale, height: 12, header: t("collectibles.picker.fromEvi") };
            const shop = out.findIndex(s => s.section === "preview");
            out = shop < 0 ? [...out, evi] : [...out.slice(0, shop), evi, ...out.slice(shop)];
        }
    }
    sectionCache.set(sections, { key, out });
    return out;
}

// ---- the footer and the preview's details ----

/** The kind of picker open last: what an evi: SKU stands for in its footer and details */
let openKind: CollectibleKind | undefined;

/** The part of a bundle an evi: SKU stands for where nothing says which: the open picker's kind, or its first part */
function kindOf(bundle: Bundle | undefined): CollectibleKind | undefined {
    if (!bundle) return undefined;
    return openKind && bundle[openKind] ? openKind : KINDS.find(k => bundle[k]);
}

const products = new Map<string, { at: number; value: ProductAndPurchase; }>();
type ProductAndPurchase = { category: undefined; product: object; purchase: object | undefined; };

/**
 * The product and purchase Discord's picker footer decides with (module 821701), for an evi: SKU: a
 * purchase for one you own (the footer then offers Apply), none otherwise (it offers going to the
 * Shop, which opens Evi's product dialog). Neither is ever premium. undefined for Discord's SKUs.
 */
export function productFor(sku: unknown): ProductAndPurchase | undefined {
    const id = bundleFromSku(sku);
    if (!id) return undefined;
    const bundle = Collectibles.bundle(id);
    const kind = kindOf(bundle);
    const key = `${kind}:${id}`;
    const at = Collectibles.getVersion();
    const have = products.get(key);
    if (have?.at === at) return have.value;
    const type = kind && ITEM_TYPE[kind];
    const product = { skuId: sku, name: bundle?.name ?? "", summary: bundle?.description ?? "", type, items: [], prices: {} };
    const purchase = bundle && kind && yours(id, kind) ? { skuId: sku, name: bundle.name, summary: bundle.description, type, items: [], purchasedAt: new Date(), purchaseType: -1 } : undefined;
    const value = { category: undefined, product, purchase };
    products.set(key, { at, value });
    return value;
}

/** An evi: SKU's bundle and part as the open picker shows it, for its details under the preview */
export function previewOf(sku: unknown): { bundle: Bundle; kind: CollectibleKind; owned: boolean; price?: number; } | undefined {
    const id = bundleFromSku(sku);
    const bundle = id ? Collectibles.bundle(id) : undefined;
    const kind = kindOf(bundle);
    if (!bundle || !kind) return undefined;
    return { bundle, kind, owned: yours(bundle.id, kind), price: bundle.prices?.[kind] };
}

/** What Discord's Shop would open for an Evi SKU: Evi's product dialog instead. True when it handled it. */
export function openShopFor(options: unknown): boolean {
    const sku = (options as { initialProductSkuId?: unknown; } | null)?.initialProductSkuId;
    const id = bundleFromSku(sku);
    if (!id) return false;
    const bundle = Collectibles.bundle(id);
    const kind = kindOf(bundle);
    const shop = (window as any).Evi?.collectiblesShop;
    try {
        if (bundle && kind && typeof shop?.openProduct === "function") shop.openProduct(id, kind);
        else logger.warn("Evi's product dialog isn't available");
    } catch (err) {
        logger.error("Couldn't open Evi's product dialog", err);
    }
    return true;
}

// ---- saving ----

let queued: CollectiblesChanges | undefined;

/** Wears and takes off what one save chose, in one request (Discord builds its bodies one after another) */
function queue(kind: CollectibleKind, value: string | null) {
    if (!queued) {
        queued = {};
        queueMicrotask(flush);
    }
    queued[kind] = value;
}

async function flush() {
    const changes = queued;
    queued = undefined;
    if (!changes || !Object.keys(changes).length) return;
    const result = await Collectibles.equip(changes).catch(err => ({ ok: false as const, error: String(err) }));
    if (result.ok) return;
    logger.warn("Couldn't save Evi collectibles from Discord's profile editor", result);
    const why = "unlinked" in result && result.unlinked ? t("collectibles.needsLink") : "code" in result && result.code === "not_owned" ? t("collectibles.notOwned") : result.error;
    showToast(t("collectibles.picker.saveFailed", { error: why }), { type: "failure", duration: 6000 });
}

/**
 * Discord builds a request body from the profile editor's pending changes (module 56348): Evi's take
 * their part first. An Evi item chosen is worn through Evi and left out of Discord's body; None or a
 * Discord item takes the Evi one of that kind off, and stays in Discord's body. Server profiles only
 * lose Evi items, nothing changes through Evi. Returns the changes Discord should build from.
 */
export function takeEviChanges(changes: Record<string, unknown>, part: SavePart, guildId?: unknown): Record<string, unknown> {
    if (!changes || typeof changes !== "object") return changes;
    const kinds = PARTS[part];
    if (!kinds) return changes;
    const global = part !== "member" && guildId == null;
    let out: Record<string, unknown> | undefined;
    for (const kind of kinds) {
        const key = PENDING[kind];
        const value = changes[key] as { skuId?: unknown; } | null | undefined;
        if (value === undefined) continue;
        const bundle = bundleFromSku(value?.skuId);
        if (bundle) {
            (out ??= { ...changes })[key] = undefined;
            if (global) queue(kind, bundle);
        } else if (global && Collectibles.mine()[kind]) {
            queue(kind, null);
        }
    }
    return out ?? changes;
}
