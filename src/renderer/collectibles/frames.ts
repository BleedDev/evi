/**
 * Evi profile frames, drawn by Discord's own frame code (shared/collectibles.ts has the format).
 *
 * Discord looks a frame up by SKU (module 77157) and gets a ProfileFrame record: its layers ({ id,
 * type, order, anchor, responsive }), the card width its art is for and how far it reaches past the
 * card. Each layer's file is asked for by id through getCollectiblesItemAssetUrl({ skuId, assetId }),
 * which hands an evi: SKU's layer its blob: URL (patches.ts). Discord preloads the layers once per
 * set of layer ids, so an Evi frame has no layers until every file is here (and measured, for a frame
 * whose overflow the bundle doesn't state); then it gets them all at once and Discord draws it.
 */
import { Bundle, bundleFromSku, FRAME_INNER_WIDTH, FrameLayer, frameOverflow, FrameOverflow, skuFor } from "@shared/collectibles";

import { React } from "../webpack/common";
import { findStore } from "../webpack/find";
import { makeItem } from "./items";
import { Collectibles } from "./store";

/** A layer's id among Discord's: the bundle and its place, so it's the same every time */
export const layerId = (bundleId: string, index: number) => `evi-${bundleId}-${index}`;

/** Measured layer sizes, by file URL (only for frames whose bundle doesn't state the overflow) */
const sizes = new Map<string, { width: number; height: number; }>();
const measuring = new Set<string>();
let version = 0;
const listeners = new Set<() => void>();

function changed() {
    version++;
    listeners.forEach(l => l());
}

async function measure(url: string, blob: Blob) {
    if (measuring.has(url)) return;
    measuring.add(url);
    try {
        const bitmap = await createImageBitmap(blob);
        sizes.set(url, { width: bitmap.width, height: bitmap.height });
        bitmap.close();
    } catch {
        // Unreadable: measured as nothing reaching past the card
        sizes.set(url, { width: FRAME_INNER_WIDTH, height: 0 });
    }
    changed();
}

/** The overflow a frame states, or the one its measured layers give; undefined while measuring */
function overflowOf(frame: NonNullable<Bundle["frame"]>): FrameOverflow | undefined {
    if (frame.overflowTop !== undefined && frame.overflowBottom !== undefined && frame.overflowHorizontal !== undefined) {
        return { overflowTop: frame.overflowTop, overflowBottom: frame.overflowBottom, overflowHorizontal: frame.overflowHorizontal };
    }
    const measured: { layer: FrameLayer; width: number; height: number; }[] = [];
    for (const layer of frame.layers) {
        const size = sizes.get(layer.src);
        if (size) {
            measured.push({ layer, ...size });
            continue;
        }
        const blob = Collectibles.blob(layer.src);
        if (blob) void measure(layer.src, blob);
        return undefined;
    }
    return { ...frameOverflow(measured), ...frame.overflowTop !== undefined && { overflowTop: frame.overflowTop }, ...frame.overflowBottom !== undefined && { overflowBottom: frame.overflowBottom }, ...frame.overflowHorizontal !== undefined && { overflowHorizontal: frame.overflowHorizontal } };
}

/** Whether every layer's file is here (asking for the ones that aren't) */
function layersHere(bundle: Bundle) {
    const frame = bundle.frame!;
    Collectibles.loadAnimated(bundle.id, "frame");
    return frame.layers.every(l => Collectibles.file(l.src) && (!l.static || Collectibles.file(l.static)));
}

/** Per bundle, with the versions it was made at: a new list, new files or a new measurement remake it */
const itemCache = new Map<string, { at: string; item: object; }>();

/** The fields of Discord's ProfileFrame record for a bundle: no layers until they can all draw */
export function frameFields(bundle: Bundle, ready: boolean, overflow: FrameOverflow | undefined) {
    const frame = bundle.frame;
    const layers = ready && overflow && frame ? frame.layers.map((l, i) => ({ id: layerId(bundle.id, i), type: l.type, order: l.order, anchor: l.anchor, responsive: l.responsive })) : [];
    return {
        skuId: skuFor(bundle.id),
        label: bundle.name,
        layers,
        innerWidth: FRAME_INNER_WIDTH,
        overflowTop: overflow?.overflowTop ?? 0,
        overflowBottom: overflow?.overflowBottom ?? 0,
        overflowHorizontal: overflow?.overflowHorizontal ?? 0,
    };
}

/**
 * Discord's ProfileFrame record for an evi: SKU, one object until something changes (Discord memoizes
 * on it). Always one for an evi: SKU, so Discord never fetches it from its own API.
 */
export function frameItem(sku: unknown): object | undefined {
    const id = bundleFromSku(sku);
    if (!id) return undefined;
    const at = getVersion();
    const have = itemCache.get(id);
    if (have?.at === at) return have.item;
    const bundle = Collectibles.bundle(id);
    const fields = bundle?.frame?.layers.length
        ? frameFields(bundle, layersHere(bundle), overflowOf(bundle.frame))
        : { skuId: sku as string, label: bundle?.name ?? "", layers: [], innerWidth: FRAME_INNER_WIDTH, overflowTop: 0, overflowBottom: 0, overflowHorizontal: 0 };
    const item = makeItem("frame", fields) ?? fields;
    itemCache.set(id, { at, item });
    return item;
}

let accessibility: { useReducedMotion?: boolean; } | undefined;
function reducedMotion() {
    try {
        return !!(accessibility ??= findStore("AccessibilityStore"))?.useReducedMotion;
    } catch {
        return false;
    }
}

/** A frame layer's blob: URL by Discord's asset id (layerId), its still under reduced motion */
export function frameLayerUrl(sku: unknown, assetId: unknown): string | undefined {
    const id = bundleFromSku(sku);
    if (!id || typeof assetId !== "string" || !assetId.startsWith(`evi-${id}-`)) return undefined;
    const layer = Collectibles.bundle(id)?.frame?.layers[Number(assetId.slice(`evi-${id}-`.length))];
    if (!layer) return undefined;
    const still = layer.static && reducedMotion() ? Collectibles.file(layer.static) : undefined;
    return still ?? Collectibles.file(layer.src);
}

/** For Discord's patched frame hook: it redraws when a frame's files arrive or are measured */
export function useFrames() {
    React.useSyncExternalStore(subscribe, getVersion);
}

const subscribe = (listener: () => void) => {
    listeners.add(listener);
    // A new list or newly arrived files change what a frame record holds
    const stop = Collectibles.subscribe(listener);
    return () => {
        listeners.delete(listener);
        stop();
    };
};
const getVersion = () => `${version}:${Collectibles.getVersion()}`;
/** Changes when a frame's files or measurements do (pickers.ts caches on it) */
export const framesVersion = getVersion;
