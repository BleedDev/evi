/**
 * Evi collectibles, part of the core like badges: nameplates, avatar decorations and profile effects
 * from evi.rest, drawn by Discord's own collectible code on everyone who wears one, for everyone
 * running Evi (store.ts, patches.ts). The Collectibles page in Evi's settings is where you wear them.
 */
import { registerPatches } from "../patching/source";
import { ALL_COLLECTIBLE_PATCHES } from "./patches";
import { PickerApi } from "./pickerApi";
import { PICKER_PATCHES, PICKER_PATCHES_BY_KIND } from "./pickerPatches";
import { setPickerPatches } from "./pickers";
import { guardRequests } from "./privacy";
import { SHOP_PATCHES } from "./shopPatches";
import { Collectibles, CollectiblesApi } from "./store";

// Profile frames and Discord's own pickers ask window.Evi.collectibles too (pickerApi.ts)
Object.assign(CollectiblesApi, PickerApi);
setPickerPatches(PICKER_PATCHES_BY_KIND);

export { Collectibles, CollectiblesApi, useWallet } from "./store";

/** From boot, before Discord's modules run */
export function installCollectibles() {
    registerPatches("evi", ALL_COLLECTIBLE_PATCHES);
    // The Evi tab in Discord's Shop (ui/CollectiblesShop.tsx)
    registerPatches("evi", SHOP_PATCHES);
    // Evi items in Discord's nameplate, decoration, effect and frame pickers (pickerPatches.ts)
    registerPatches("evi", PICKER_PATCHES);
    // Before Discord sends anything: no Evi SKU ever reaches Discord's API
    guardRequests();
}

let started = false;

/** Starts loading who wears what; once, for the life of the page */
export function startCollectibles() {
    if (started) return;
    started = true;
    Collectibles.use();
}
