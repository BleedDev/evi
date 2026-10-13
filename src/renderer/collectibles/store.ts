/**
 * Evi collectibles in the page (shared/collectibles.ts): who wears what, loaded through main (cached
 * copy first, then the live list), updated the moment evi.rest says it changed, with a poll every few
 * minutes in case that stream is down.
 *
 * Discord's page can't load evi.rest's files, so each one comes from main as bytes and becomes a
 * blob: URL here. The stills of every bundle load with the list (they're small, and a new list only
 * shows once they're here); the animated files of a bundle load the first time Discord draws it.
 * Blob URLs are kept until a new list no longer names their file.
 *
 * What Discord's patched code asks (patches.ts) is `CollectiblesApi`, at window.Evi.collectibles.
 */
import { Bundle, bundleFromSku, CollectibleKind, CollectiblesDocument, Equipped, isBundleId, KINDS, skuFor, Wallet } from "@shared/collectibles";
import type { CollectiblesChanges, CollectiblesEquipResult, CollectiblesResult } from "@shared/ipc";

import { t } from "../i18n";
import { Logger } from "../logger";
import { Native } from "../native";
import { diagnosePatches } from "../patching/diagnose";
import { getPatchRecords, PatchRecord, SourcePatch } from "../patching/source";
import { SafeMode } from "../safeMode";
import { Settings } from "../settings";
import { React } from "../webpack/common";
import { findStore } from "../webpack/find";
import { ALL_COLLECTIBLE_PATCHES, COLLECTIBLE_PATCHES } from "./patches";
import { scrub, scrubAll } from "./privacy";
import { createWallet } from "./wallet";

const logger = new Logger("Collectibles", "#c27aff");
/** Only a fallback: changes normally arrive over main's stream from evi.rest */
const REFRESH_EVERY = 5 * 60 * 1000;
/** A new list waits this long at most for its stills before it shows anyway */
const STILLS_WAIT_MS = 5000;
/** For a decoration whose still hasn't arrived: nothing, rather than a broken image */
const TRANSPARENT = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
const NONE: Equipped = Object.freeze({}) as Equipped;

let doc: CollectiblesDocument = { bundles: [], users: {} };
let byId = new Map<string, Bundle>();
let version = 0;
const listeners = new Set<() => void>();

/** evi.rest URL (with its ?v=) -> the file as a blob and its blob: URL */
const files = new Map<string, { blob: Blob; url: string; }>();
const loading = new Map<string, Promise<string | undefined>>();
/** Bundles whose animated files were asked for, by kind */
const animatedAsked = new Set<string>();

// ---- the files ----

function loadFile(url: string): Promise<string | undefined> {
    const have = files.get(url);
    if (have) return Promise.resolve(have.url);
    let job = loading.get(url);
    if (job) return job;
    job = (async () => {
        const result = await Native.collectibleFile?.(url).catch(err => ({ ok: false as const, error: String(err) }));
        if (!result?.ok) {
            logger.warn(`Couldn't load ${url}: ${result?.error ?? "this Evi can't"}`);
            return undefined;
        }
        const blob = new Blob([result.bytes as BlobPart], { type: result.mime });
        const entry = { blob, url: URL.createObjectURL(blob) };
        files.set(url, entry);
        return entry.url;
    })().finally(() => loading.delete(url));
    loading.set(url, job);
    return job;
}

const blobUrl = (url: string | undefined) => url ? files.get(url)?.url : undefined;

/** A frame as either shape of the document has it: one image, or Discord's layers (with an image too) */
type FrameFiles = { static?: string; animated?: string; layers?: { src: string; static?: string; }[]; };
const frameOf = (b: Bundle) => b.frame as FrameFiles | undefined;

/** The stills a bundle shows with before anything animates */
function stillsOf(b: Bundle) {
    const frame = frameOf(b);
    return [b.nameplate?.static, b.decoration?.static, b.effect?.static, b.effect?.thumbnail, frame?.static, ...frame?.layers?.map(l => l.static) ?? []]
        .filter((u): u is string => !!u);
}

/** The animated files of one kind of a bundle */
function animatedOf(b: Bundle, kind: CollectibleKind) {
    if (kind === "nameplate") return b.nameplate ? [b.nameplate.animated] : [];
    if (kind === "decoration") return b.decoration ? [b.decoration.animated] : [];
    if (kind === "frame") {
        const frame = frameOf(b);
        return [...frame?.layers?.map(l => l.src) ?? [], frame?.animated].filter((u): u is string => !!u);
    }
    return b.effect?.layers.map(l => l.src) ?? [];
}

/** Every file a document names, to know which blob URLs may go */
function allFiles(d: CollectiblesDocument) {
    const urls = new Set<string>();
    for (const b of d.bundles) {
        for (const u of stillsOf(b)) urls.add(u);
        for (const kind of KINDS) for (const u of animatedOf(b, kind)) urls.add(u);
    }
    return urls;
}

/** Loads a bundle's animated files of one kind, once; Discord redraws when they're here */
function ensureAnimated(bundleId: string, kind: CollectibleKind) {
    const key = `${bundleId}:${kind}`;
    if (animatedAsked.has(key)) return;
    const b = byId.get(bundleId);
    if (!b) return;
    animatedAsked.add(key);
    const urls = animatedOf(b, kind).filter(u => !files.has(u));
    if (urls.length) void Promise.all(urls.map(loadFile)).then(() => bump());
}

// ---- the list ----

let bumpTimer: ReturnType<typeof setTimeout> | undefined;
/** Something Discord draws changed: everything listening redraws, once for a burst of changes */
function bump() {
    if (bumpTimer) return;
    bumpTimer = setTimeout(() => {
        bumpTimer = undefined;
        version++;
        decorationCache.clear();
        nameplateCache.clear();
        effectCache.clear();
        for (const listener of listeners) listener();
    }, 16);
}

/** Discord re-reads its users when UserStore changes: our getters answer differently now */
function tellDiscord() {
    try {
        findStore<{ emitChange?(): void; }>("UserStore")?.emitChange?.();
    } catch (err) {
        logger.warn("Couldn't tell Discord its users changed", err);
    }
}

let applying = 0;

async function set(next: CollectiblesDocument) {
    const mine = ++applying;
    // The stills first, so nothing shows half drawn (each is fetched once, and kept on disk by main)
    const stills = next.bundles.flatMap(stillsOf);
    await Promise.race([Promise.all(stills.map(loadFile)), new Promise(resolve => setTimeout(resolve, STILLS_WAIT_MS))]);
    // A newer list arrived meanwhile: that one shows
    if (mine !== applying) return;
    swap(next);
}

function swap(next: CollectiblesDocument) {
    const keep = allFiles(next);
    for (const [url, entry] of files) {
        if (keep.has(url)) continue;
        URL.revokeObjectURL(entry.url);
        files.delete(url);
    }
    doc = next;
    byId = new Map(next.bundles.map(b => [b.id, b]));
    // Bundles that changed get their animated files again when next drawn
    for (const key of [...animatedAsked]) if (!byId.has(key.slice(0, key.lastIndexOf(":")))) animatedAsked.delete(key);
    bump();
    tellDiscord();
}

function apply(result: CollectiblesResult | undefined) {
    if (!result) return;
    if (result.ok) void set(result.doc);
    else logger.warn(`Collectibles unavailable: ${result.error}`);
}

async function load(cachedOnly = false) {
    apply(await Native.getCollectibles?.(cachedOnly).catch(err => ({ ok: false as const, error: String(err) })));
}

// ---- who wears what ----

let userStore: { getCurrentUser?(): { id: string; } | undefined; } | undefined;
const myId = (): string | undefined => {
    try {
        return (userStore ??= findStore("UserStore"))?.getCurrentUser?.()?.id;
    } catch {
        return undefined;
    }
};

/** What someone wears that this Evi shows: yours always, others' unless you turned that off */
function equippedFor(userId: string | undefined): Equipped {
    if (!userId) return NONE;
    const worn = doc.users[userId];
    if (!worn) return NONE;
    if (Settings.data.collectiblesOnOthers === false && userId !== myId()) return NONE;
    return worn;
}

/** The patch records of Evi's collectible patches, found once (registered at boot, before Discord's modules) */
let records: Map<SourcePatch, PatchRecord> | undefined;
function recordOf(patch: SourcePatch) {
    if (!records?.size) records = new Map(getPatchRecords("evi").filter(r => ALL_COLLECTIBLE_PATCHES.includes(r.patch)).map(r => [r.patch, r]));
    return records.get(patch);
}

/** The patches that draw a kind; none yet for a kind Evi doesn't draw in Discord (then it isn't drawn) */
const patchesOf = (kind: CollectibleKind): readonly SourcePatch[] | undefined =>
    (COLLECTIBLE_PATCHES as Partial<Record<CollectibleKind, readonly SourcePatch[]>>)[kind];

/**
 * Whether Evi can draw a kind: none of the patches that draw it failed. One still waiting is fine, its
 * module patches as it first runs (some only run once Discord first draws that kind). Where a patch
 * no longer fits, nobody gets an evi: SKU of that kind, so nothing shows broken. Asked on every draw.
 */
function drawn(kind: CollectibleKind) {
    const patches = patchesOf(kind);
    if (!patches?.length) return false;
    for (const patch of patches) {
        const state = recordOf(patch)?.state;
        if (state !== "applied" && state !== "pending") return false;
    }
    return true;
}

/** The kinds that don't show in this Discord: a patch failed, or no longer finds its code (for the Collectibles page) */
function brokenKinds(): CollectibleKind[] {
    const health = new Map(diagnosePatches().filter(d => d.plugin === "evi").map(d => [d.patch, d.health]));
    return KINDS.filter(kind => (patchesOf(kind) ?? []).some(p => {
        const h = health.get(p);
        return h !== "applied" && h !== "waiting";
    }));
}

/** The bundle someone wears of a kind, when Evi can draw it */
function wornBundle(userId: string | undefined, kind: CollectibleKind): Bundle | undefined {
    const id = equippedFor(userId)[kind];
    if (!id || !drawn(kind)) return undefined;
    const b = byId.get(id);
    return b?.[kind] ? b : undefined;
}

// One object per bundle, until something changes: Discord memoizes on them
const decorationCache = new Map<string, object>();
const nameplateCache = new Map<string, object>();
const effectCache = new Map<string, object | undefined>();

function cached<T extends object | undefined>(map: Map<string, T>, key: string, make: () => T): T {
    if (map.has(key)) return map.get(key)!;
    const value = make();
    map.set(key, value);
    return value;
}

/** Discord's effect config: an evi: SKU's layers as blob URLs, once all of them are here */
function effectConfig(b: Bundle) {
    const fx = b.effect!;
    const layers = fx.layers.map(l => blobUrl(l.src));
    if (layers.some(u => !u)) return undefined;
    const still = blobUrl(fx.static) ?? "", thumb = blobUrl(fx.thumbnail) ?? still;
    return {
        skuId: skuFor(b.id),
        title: b.name,
        description: b.description,
        accessibilityLabel: b.name,
        // Discord's ANIMATION_TYPE_PERSISTENT: plays its intro, then loops while the profile is open
        animationType: 1,
        reducedMotionSrc: still,
        staticFrameSrc: still,
        thumbnailPreviewSrc: thumb,
        effects: fx.layers.map((l, i) => ({
            src: layers[i]!,
            loop: l.loop,
            start: l.start,
            duration: l.duration,
            loopDelay: l.loopDelay,
            width: l.width,
            height: l.height,
            position: { x: l.x, y: l.y },
            zIndex: l.zIndex,
        })),
    };
}

/** What Discord's patched code asks for, as window.Evi.collectibles */
export const CollectiblesApi = {
    isSku: (sku: unknown) => bundleFromSku(sku) !== undefined,
    /** Discord's analytics: an event's properties, and a batch about to be uploaded (privacy.ts) */
    scrub,
    scrubAll,
    /** Whether a Discord collectible value (a decoration, a nameplate) is one of Evi's */
    isOurs: (value: unknown) => bundleFromSku((value as { skuId?: unknown; } | null)?.skuId) !== undefined,
    /** Whether Evi draws someone's collectible of this kind (it then wins over their server profile's) */
    wears: (userId: string | undefined, kind: CollectibleKind) => !!wornBundle(userId, kind),

    /** For the user record's avatarDecoration */
    decoration(userId: string) {
        const b = wornBundle(userId, "decoration");
        return b ? cached(decorationCache, b.id, () => ({ skuId: skuFor(b.id) })) : undefined;
    },
    /** For the user record's nameplate, in the server's shape (Discord fills in the palette) */
    nameplate(userId: string) {
        const b = wornBundle(userId, "nameplate");
        return b ? cached(nameplateCache, b.id, () => ({ skuId: skuFor(b.id), asset: skuFor(b.id), label: b.name, palette: b.nameplate!.palette })) : undefined;
    },
    /** For a profile's profileEffect */
    profileEffect(userId: string) {
        const b = wornBundle(userId, "effect");
        return b ? cached(decorationCache, `fx:${b.id}`, () => ({ skuId: skuFor(b.id) })) : undefined;
    },

    /** getAvatarDecorationURL for an evi: SKU: the animation once it's here, the still until then */
    decorationUrl(sku: string, animated: boolean): string {
        const b = byId.get(bundleFromSku(sku) ?? "");
        if (!b?.decoration) return TRANSPARENT;
        // First drawn: the animation loads now, for when someone hovers it
        ensureAnimated(b.id, "decoration");
        const still = blobUrl(b.decoration.static) ?? TRANSPARENT;
        return animated ? blobUrl(b.decoration.animated) ?? still : still;
    },
    /** A nameplate's files for an evi: SKU: the still, and the video once it's here */
    nameplateUrls(sku: string): { staticImageUrl?: string; videoUrl?: string; } {
        const b = byId.get(bundleFromSku(sku) ?? "");
        if (!b?.nameplate) return {};
        ensureAnimated(b.id, "nameplate");
        const video = blobUrl(b.nameplate.animated);
        return { staticImageUrl: blobUrl(b.nameplate.static), ...video && { videoUrl: video } };
    },
    /** The effect player's config for an evi: SKU, once its layers are here */
    effectConfig(sku: unknown) {
        const id = bundleFromSku(sku);
        const b = id ? byId.get(id) : undefined;
        if (!b?.effect) return undefined;
        ensureAnimated(b.id, "effect");
        return cached(effectCache, b.id, () => effectConfig(b));
    },

    /** Called as a hook by Discord's patched hooks: they redraw when Evi's list or files change */
    useVersion: () => React.useSyncExternalStore(Collectibles.subscribe, Collectibles.getVersion),
};

// ---- what you own: your Sparks and parts (wallet.ts) ----

// Only Evi's own UI and the pickers read the wallet: nothing Discord memoizes on changes
const wallet = createWallet(Native, myId, () => {
    version++;
    for (const listener of listeners) listener();
});

let users = 0;
let timer: ReturnType<typeof setInterval> | undefined;
let stopSettings: (() => void) | undefined;

// Pushed by main whenever evi.rest's list changes
Native?.onCollectiblesChange?.(result => {
    if (users > 0) apply(result);
});

export const Collectibles = {
    /** Starts loading and refreshing while something uses collectibles; returns the matching stop */
    use() {
        if (users++ === 0 && !SafeMode.active) {
            // The cached copy shows right away, the live list replaces it when it arrives
            void load(true).then(() => load());
            void wallet.load();
            timer = setInterval(() => void load(), REFRESH_EVERY);
            let others = Settings.data.collectiblesOnOthers !== false;
            stopSettings = Settings.subscribe(() => {
                if (others === (Settings.data.collectiblesOnOthers !== false)) return;
                others = !others;
                bump();
                tellDiscord();
            });
        }
        return () => {
            if (--users === 0) {
                clearInterval(timer);
                timer = undefined;
                stopSettings?.();
                stopSettings = undefined;
            }
        };
    },

    refresh: () => load(),

    /** The bundles, in shop order */
    bundles: (): readonly Bundle[] => doc.bundles,
    bundle: (id: string) => byId.get(id),

    /** What someone wears, as this Evi shows it */
    forUser: (userId: string | undefined): Equipped => equippedFor(userId),
    /** What you wear */
    mine: (): Equipped => equippedFor(myId()),
    myId,

    /** A file's blob: URL if it's here; starts loading it if not (the page redraws when it is) */
    file(url: string | undefined): string | undefined {
        if (!url) return undefined;
        const have = blobUrl(url);
        if (!have && !loading.has(url)) void loadFile(url).then(u => u && bump());
        return have;
    },
    /** The file itself, for playing an effect layer from its start again (a fresh blob: URL each time) */
    blob: (url: string | undefined) => url ? files.get(url)?.blob : undefined,
    /** Loads a bundle's animated files of a kind (the settings page's previews) */
    loadAnimated: ensureAnimated,

    /** Whether Discord's code takes the patches for a kind, so it shows there */
    drawn,
    brokenKinds,

    /**
     * Wears (a bundle id) or takes off (null) yours. Shown straight away, here and (through evi.rest)
     * for everyone; put back if evi.rest refuses, like when this Evi isn't linked to your account.
     */
    async equip(changes: CollectiblesChanges): Promise<CollectiblesEquipResult> {
        const me = myId();
        if (!me || !Native.equipCollectibles) return { ok: false, error: "This Evi can't change collectibles" };
        const clean: CollectiblesChanges = {};
        for (const kind of KINDS) {
            const v = changes[kind];
            if (v === null || (isBundleId(v) && byId.get(v)?.[kind])) clean[kind] = v;
        }
        if (!Object.keys(clean).length) return { ok: false, error: "Nothing to change" };

        // Nothing is free: wearing a part needs owning it (evi.rest checks too)
        if (await wallet.unowned(clean)) return { ok: false, error: t("collectibles.notOwned"), code: "not_owned" };

        const before = doc;
        const worn: Equipped = { ...doc.users[me] };
        for (const kind of KINDS) {
            const v = clean[kind];
            if (v === null) delete worn[kind];
            else if (v) worn[kind] = v;
        }
        const users = { ...doc.users };
        if (Object.keys(worn).length) users[me] = worn;
        else delete users[me];
        swap({ ...doc, users });
        const optimistic = doc;
        const result: CollectiblesEquipResult = await Native.equipCollectibles(me, clean).catch(err => ({ ok: false as const, error: String(err) }));
        // Undone only if nothing newer arrived in the meantime
        if (!result.ok && doc === optimistic) swap(before);
        // evi.rest knows better what you own
        if (!result.ok && result.code === "not_owned") void wallet.load(true);
        return result;
    },

    /** Your Sparks and what you own; undefined until it loads (or when this Evi isn't linked) */
    wallet: wallet.current,
    /** Why the wallet didn't load, like not being linked */
    walletError: wallet.error,
    /** Asks evi.rest again */
    refreshWallet: () => wallet.load(true),
    /** Whether you own a part of a bundle */
    owns: wallet.owns,
    /** Wears one part (a bundle id) or takes it off (null); refuses a part you don't own */
    wear: (kind: CollectibleKind, bundleId: string | null) => Collectibles.equip({ [kind]: bundleId }),
    /** Buys one part, or the rest of the bundle without `kind`; the wallet updates when evi.rest answers */
    buy: wallet.buy,
    /** A code's Sparks and items; what it gave, to show */
    redeem: wallet.redeem,

    /** Changes whenever the list, a file or your wallet does, for useSyncExternalStore */
    getVersion: () => version,

    subscribe(listener: () => void) {
        listeners.add(listener);
        return () => void listeners.delete(listener);
    },
};

/** React hook: your wallet, redrawing when it changes (undefined until it loads, or when not linked) */
export function useWallet(): Wallet | undefined {
    React.useSyncExternalStore(Collectibles.subscribe, Collectibles.getVersion);
    return Collectibles.wallet();
}
