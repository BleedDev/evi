/**
 * What Discord's patched picker and frame code asks (pickerPatches.ts, patches.ts), added to
 * window.Evi.collectibles beside store.ts's CollectiblesApi.
 */
import { bundleFromSku, CollectibleKind } from "@shared/collectibles";

import { Logger } from "../logger";
import { React } from "../webpack/common";
import { frameItem, frameLayerUrl, useFrames } from "./frames";
import { previewDetails, tileMark } from "./pickerUi";
import { openShopFor, own, PickerSection, pickerItem, productFor, SavePart, takeEviChanges, withEviSections } from "./pickers";
import { Collectibles } from "./store";

const logger = new Logger("Collectibles", "#c27aff");

/** Discord's code must never break on Evi's account: an error is logged and Discord's own value used */
function safe<A extends unknown[], R>(name: string, fn: (...args: A) => R, fallback: (...args: A) => R): (...args: A) => R {
    return (...args) => {
        try {
            return fn(...args);
        } catch (err) {
            logger.error(`${name} failed`, err);
            return fallback(...args);
        }
    };
}

const frameSentinels = new Map<string, { skuId: string; }>();

export const PickerApi = {
    /** A profile's frame: the Evi one someone wears, when Evi can draw it and it has layers */
    profileFrame: safe("profileFrame", (userId: string) => {
        const id = Collectibles.forUser(userId).frame;
        if (!id || !Collectibles.drawn("frame") || !Collectibles.bundle(id)?.frame?.layers.length) return undefined;
        let sentinel = frameSentinels.get(id);
        if (!sentinel) frameSentinels.set(id, sentinel = { skuId: `evi:${id}` });
        return sentinel;
    }, () => undefined),
    /** Discord's ProfileFrame record for an evi: SKU (frames.ts) */
    frame: safe("frame", (sku: unknown) => frameItem(sku), () => undefined),
    /** getCollectiblesItemAssetUrl for an evi: SKU: a frame layer's blob: URL, nothing else */
    assetUrl: safe("assetUrl", (sku: unknown, _format: unknown, assetId: unknown) => frameLayerUrl(sku, assetId), () => undefined),
    /** Called as a hook where Discord looks frames up */
    useFrames,

    /** A picker's sections with Evi's items (a hook: the grid redraws when Evi's list or your wallet changes) */
    sections(kind: CollectibleKind, sections: PickerSection[], guildId: unknown) {
        React.useSyncExternalStore(Collectibles.subscribe, Collectibles.getVersion);
        // A frame's tile redraws as its layers arrive
        useFrames();
        try {
            return withEviSections(kind, sections, guildId) ?? sections;
        } catch (err) {
            logger.error("Couldn't add Evi's items to a picker", err);
            return sections;
        }
    },
    /** The Evi item a picker's selection stands for */
    item: safe("item", (selected: unknown, kind: CollectibleKind) => pickerItem(selected, kind), () => undefined),
    /** What you wear of a kind through Evi, where Discord compares with your current one */
    own: safe("own", (kind: CollectibleKind) => own(kind), () => undefined),
    /** The badge on an Evi item's tile */
    tile: safe("tile", (skuId: string) => tileMark(skuId), () => null),
    /** The details under a picker's preview for an Evi item */
    details: safe("details", (skuId: string) => previewDetails(skuId), () => null),
    /** Product and purchase for an evi: SKU, for a picker's footer */
    product: safe("product", (sku: unknown) => productFor(sku), () => undefined),
    /** Opening Discord's Shop at an evi: SKU opens Evi's product dialog; true when it did */
    openShop: safe("openShop", (options: unknown) => openShopFor(options), (options: unknown) => bundleFromSku((options as any)?.initialProductSkuId) !== undefined),
    /** The profile editor's pending changes as Discord saves them: Evi's taken out and worn through Evi */
    saving(changes: Record<string, unknown>, part: SavePart, guildId?: unknown) {
        try {
            return takeEviChanges(changes, part, guildId);
        } catch (err) {
            logger.error("Couldn't take Evi's changes out of a profile save", err);
            // Still never Discord's to save
            return Object.fromEntries(Object.entries(changes ?? {}).map(([k, v]) => [k, bundleFromSku((v as any)?.skuId) ? undefined : v]));
        }
    },
};
