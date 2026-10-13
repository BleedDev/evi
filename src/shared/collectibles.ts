/**
 * Evi collectibles: bundles of a nameplate, an avatar decoration and a profile effect that match, drawn
 * by Evi and shown on everyone who equipped them, to everyone running Evi. People without Evi see nothing.
 *
 *   GET /v1/collectibles          CollectiblesDocument: the bundles and who wears what (ETag, 304)
 *   PUT /v1/me/collectibles       { userId, nameplate?, decoration?, effect? }: a bundle id, or null to take it off
 *                                 (a linked X-Evi-Install, like PUT /v1/me/badges; supporter bundles need a supporter)
 *   GET /v1/badges/events         also sends `collectibles` with { etag } when either changes
 *   GET /collectibles/<bundle>/<file>   the files, cached for good (versioned with ?v=)
 *
 * Owning them (since 2.5.0): wearing a part needs owning it. Parts are bought with Sparks, Evi's own
 * currency, at the prices on the bundle, or come from codes Evi's team hands out.
 *   GET  /v1/me/collectibles?userId=     Wallet: your Sparks and what you own (a linked X-Evi-Install)
 *   POST /v1/me/collectibles/buy         { userId, bundle, kind? }: one part, or the whole bundle without kind
 *   POST /v1/me/collectibles/redeem      { userId, code }: a code's Sparks and items -> { wallet, granted }
 *   Admin (Developers page): prices per bundle and part, codes (Sparks and/or items, uses, expiry),
 *   granting Sparks or items to an account, and the monthly Sparks supporters get per level.
 *
 * Files of a bundle, in Discord's own formats:
 *   nameplate.webm      672x126 VP9 with alpha, 12 fps loop     nameplate.png       its still (reduced motion)
 *   decoration.png      288x288 APNG, 12 fps loop               decoration-static.png
 *   effect-<n>.png      450x880 APNG layers (see EffectLayer)    effect-static.png   effect-thumb.png
 *   frame-<n>.png       a profile frame's layers (see FrameLayer), frame-static.png   the whole frame around
 *                       PNG (APNG allowed, then with a still)   a card, for Evi's own previews
 *
 * Shared by evi.rest (server/src/collectibles.ts) and Evi, so both hold the same limits.
 */
import { isDiscordId } from "./badges";

export const COLLECTIBLES_ORIGIN = "https://evi.rest";
export const KINDS = ["nameplate", "decoration", "effect", "frame"] as const;
export type CollectibleKind = typeof KINDS[number];

export const isBundleId = (id: unknown): id is string => typeof id === "string" && /^[a-z0-9][a-z0-9-]{0,39}$/.test(id);

/** Discord's nameplate palettes: the row colour behind the art */
export const PALETTES = ["crimson", "berry", "sky", "teal", "forest", "bubble_gum", "violet", "cobalt", "clover", "lemon", "white"] as const;
export type Palette = typeof PALETTES[number];

/** One layer of a profile effect, the way Discord's effect configs describe them (times in ms) */
export interface EffectLayer {
    src: string;
    loop: boolean;
    /** When it starts after the card opens */
    start: number;
    /** How long one play takes */
    duration: number;
    /** Pause between plays when it loops */
    loopDelay: number;
    width: number;
    height: number;
    x: number;
    y: number;
    zIndex: number;
}

/**
 * One layer of a profile frame, the way Discord's frames are made (its asset tool reads them from file
 * names like "0_staple_top.png" in foreground/ and background/). Art is drawn for a card 1200 px wide
 * (FRAME_INNER_WIDTH) and scaled with the card; a layer as wide as the card plus both side overflows.
 *   staple  one image at the top, bottom or middle of the card; a top one reaches above the card, a
 *           bottom one below it (FRAME_OVERFLOW)
 *   rail    one image the card's height shows a slice of: width-fitted, pinned to its anchor, cut off
 *           (a responsive rail hides on wide cards, like the full profile)
 *   border  one tile repeated down the card's whole height, width-fitted
 */
export interface FrameLayer {
    /** PNG; an APNG animates, and then `static` is its still (reduced motion) */
    src: string;
    static?: string;
    type: FrameLayerType;
    /** In front of the card's content, or behind the card */
    order: "front" | "back";
    /** Where it's pinned; a border is always "center" */
    anchor: "top" | "bottom" | "center";
    /** Hidden on wide cards (Discord's "_responsive" suffix; rails always are) */
    responsive: boolean;
}

export const FRAME_LAYER_TYPES = ["staple", "rail", "border"] as const;
export type FrameLayerType = typeof FRAME_LAYER_TYPES[number];
/** The card width a frame's art is drawn for, in px */
export const FRAME_INNER_WIDTH = 1200;
/**
 * Discord's frame canvas: a top staple is 716 px tall with 304 of them above the card, a bottom staple
 * 424 tall with 212 below it, and 56 px reach past each side. A frame's overflow is measured from its
 * art the way Discord's tool does (frameOverflow), unless the bundle states it.
 */
export const FRAME_OVERFLOW = { topHeight: 716, top: 304, bottomHeight: 424, bottom: 212, horizontal: 56 } as const;
const MAX_FRAME_LAYERS = 8;

/** How far a frame reaches past the card (px at FRAME_INNER_WIDTH), from its layers' image sizes */
export function frameOverflow(layers: { layer: Pick<FrameLayer, "type" | "anchor">; width: number; height: number; }[]) {
    const max = (values: number[]) => values.length ? Math.max(...values) : 0;
    const beyond = (height: number, canvas: number, overflow: number) => Math.max(0, height - (canvas - overflow));
    return {
        overflowTop: max(layers.filter(l => l.layer.type === "staple" && l.layer.anchor === "top").map(l => beyond(l.height, FRAME_OVERFLOW.topHeight, FRAME_OVERFLOW.top))),
        overflowBottom: max(layers.filter(l => l.layer.type === "staple" && l.layer.anchor === "bottom").map(l => beyond(l.height, FRAME_OVERFLOW.bottomHeight, FRAME_OVERFLOW.bottom))),
        overflowHorizontal: max(layers.map(l => Math.round(Math.max(0, (l.width - FRAME_INNER_WIDTH) / 2)))),
    };
}

/**
 * A frame layer from its file name, the way Discord's asset tool names them: "<index>_<type>[_<anchor>]
 * [_responsive].png" in a foreground/ or background/ folder ("0_staple_top.png", "1_border.png",
 * "2_rail_center.png"). A border has no anchor; a rail is always responsive. undefined if it isn't one.
 */
export function frameLayerFromName(fileName: string, folder: "foreground" | "background"): { index: number; layer: Omit<FrameLayer, "src" | "static">; } | undefined {
    const parts = fileName.replace(/\.\w+$/, "").split("_");
    if (parts.length < 2 || parts.length > 4) return undefined;
    const [index, type, ...rest] = parts;
    if (!/^\d+$/.test(index) || !FRAME_LAYER_TYPES.includes(type as FrameLayerType)) return undefined;
    const order = folder === "background" ? "back" : "front";
    if (type === "border") {
        if (rest.length > 1 || (rest.length === 1 && rest[0] !== "responsive")) return undefined;
        return { index: Number(index), layer: { type, order, anchor: "center", responsive: rest.length === 1 } };
    }
    const [anchor, suffix, ...more] = rest;
    if (!["top", "bottom", "center"].includes(anchor) || more.length || (suffix !== undefined && suffix !== "responsive")) return undefined;
    return { index: Number(index), layer: { type: type as FrameLayerType, order, anchor: anchor as FrameLayer["anchor"], responsive: suffix !== undefined || type === "rail" } };
}

/** Discord's layer order: front layers first, then back ones, each by index */
export const frameLayerOrder = (a: { index: number; layer: Pick<FrameLayer, "order">; }, b: { index: number; layer: Pick<FrameLayer, "order">; }) =>
    (a.layer.order === b.layer.order ? 0 : a.layer.order === "front" ? -1 : 1) || a.index - b.index;

export interface FrameOverflow {
    overflowTop: number;
    overflowBottom: number;
    overflowHorizontal: number;
}

export interface Bundle {
    id: string;
    name: string;
    description: string;
    tier: "free" | "supporter";
    nameplate?: { animated: string; static: string; palette: Palette; };
    decoration?: { animated: string; static: string; };
    effect?: { layers: EffectLayer[]; static: string; thumbnail: string; };
    /**
     * A profile frame, drawn around the profile card by Discord's own frame code. `static` is the whole
     * frame around a card (Evi's own previews), `animated` an animated one of those. A frame without
     * layers (documents from before 2.5.0) only shows in Evi's previews.
     */
    frame?: { layers: FrameLayer[]; static: string; animated?: string; } & Partial<FrameOverflow>;
    /** In Sparks: the whole bundle and each part. A missing price means it isn't sold, only given (codes) */
    prices?: Prices;
}

export const CURRENCY = "Sparks";
export type PriceKey = "bundle" | CollectibleKind;
export type Prices = Partial<Record<PriceKey, number>>;
export const MAX_PRICE = 1_000_000;

/** What someone has: their Sparks and the parts they own, by bundle */
export interface Wallet {
    userId: string;
    sparks: number;
    owned: Record<string, CollectibleKind[]>;
}

export function parsePrices(raw: any): Prices | undefined {
    if (!raw || typeof raw !== "object") return undefined;
    const out: Prices = {};
    for (const key of ["bundle", ...KINDS] as PriceKey[]) {
        const v = raw[key];
        if (Number.isInteger(v) && v >= 0 && v <= MAX_PRICE) out[key] = v;
    }
    return Object.keys(out).length ? out : undefined;
}

export function parseWallet(raw: any): Wallet | undefined {
    if (!raw || !isDiscordId(raw.userId) || !Number.isInteger(raw.sparks) || raw.sparks < 0 || typeof raw.owned !== "object" || !raw.owned) return undefined;
    const owned: Record<string, CollectibleKind[]> = {};
    for (const [id, kinds] of Object.entries(raw.owned as Record<string, unknown>)) {
        if (!isBundleId(id) || !Array.isArray(kinds)) continue;
        const k = KINDS.filter(kind => kinds.includes(kind));
        if (k.length) owned[id] = k;
    }
    return { userId: raw.userId, sparks: raw.sparks, owned };
}

/** What buying the rest of a bundle costs: the bundle price, or the remaining parts' prices if that's less */
export function bundleCost(bundle: Bundle, owned: CollectibleKind[] = []): number | undefined {
    const parts = KINDS.filter(k => bundle[k] && !owned.includes(k));
    if (!parts.length) return undefined;
    const sum = parts.every(k => bundle.prices?.[k] !== undefined) ? parts.reduce((n, k) => n + (bundle.prices![k] ?? 0), 0) : undefined;
    const whole = owned.length === 0 ? bundle.prices?.bundle : undefined;
    const options = [whole, sum].filter((v): v is number => v !== undefined);
    return options.length ? Math.min(...options) : undefined;
}

/** Codes are letters, digits and dashes; compared upper case */
export const normalizeCode = (code: unknown) => typeof code === "string" && /^[A-Za-z0-9-]{4,40}$/.test(code.trim()) ? code.trim().toUpperCase() : undefined;

export function validateBuy(body: any): { userId: string; bundle: string; kind?: CollectibleKind; } | { error: string; } {
    if (!body || !isDiscordId(body.userId)) return { error: "userId must be a Discord user id" };
    if (!isBundleId(body.bundle)) return { error: "bundle must be a bundle id" };
    if (body.kind !== undefined && !KINDS.includes(body.kind)) return { error: "kind must be one of " + KINDS.join(", ") };
    return { userId: body.userId, bundle: body.bundle, kind: body.kind };
}

export function validateRedeem(body: any): { userId: string; code: string; } | { error: string; } {
    if (!body || !isDiscordId(body.userId)) return { error: "userId must be a Discord user id" };
    const code = normalizeCode(body.code);
    return code ? { userId: body.userId, code } : { error: "That isn't a valid code" };
}

export type Equipped = Partial<Record<CollectibleKind, string>>;

export interface CollectiblesDocument {
    /** In shop order */
    bundles: Bundle[];
    /** Discord user id -> what they wear */
    users: Record<string, Equipped>;
}

const MAX_LAYERS = 4;

/** Only evi.rest's own collectible files: a bad document can't point Evi anywhere else */
export function isCollectibleUrl(url: unknown): url is string {
    if (typeof url !== "string" || url.length > 300) return false;
    try {
        const u = new URL(url);
        return u.origin === COLLECTIBLES_ORIGIN && /^\/collectibles\/[a-z0-9][a-z0-9-]{0,39}\/[a-z0-9-]{1,40}\.(png|webm)$/.test(u.pathname);
    } catch {
        return false;
    }
}

const num = (v: unknown, min: number, max: number) => typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;

function parseLayer(raw: any): EffectLayer | undefined {
    if (!raw || !isCollectibleUrl(raw.src) || typeof raw.loop !== "boolean") return undefined;
    if (![raw.start, raw.duration, raw.loopDelay].every(v => num(v, 0, 60_000)) || raw.duration < 1) return undefined;
    if (!num(raw.width, 1, 1000) || !num(raw.height, 1, 2000) || !num(raw.x, -1000, 1000) || !num(raw.y, -2000, 2000) || !num(raw.zIndex, 0, 1000)) return undefined;
    const { src, loop, start, duration, loopDelay, width, height, x, y, zIndex } = raw;
    return { src, loop, start, duration, loopDelay, width, height, x, y, zIndex };
}

function parseFrameLayer(raw: any): FrameLayer | undefined {
    if (!raw || !isCollectibleUrl(raw.src) || !FRAME_LAYER_TYPES.includes(raw.type)) return undefined;
    if (raw.static !== undefined && !isCollectibleUrl(raw.static)) return undefined;
    const order = raw.order === "back" ? "back" : "front";
    const anchor = raw.type === "border" ? "center" : ["top", "bottom", "center"].includes(raw.anchor) ? raw.anchor : undefined;
    if (!anchor) return undefined;
    // Discord's tool makes every rail responsive
    const responsive = raw.type === "rail" || raw.responsive === true;
    return { src: raw.src, ...raw.static && { static: raw.static }, type: raw.type, order, anchor, responsive };
}

/** A frame: its layers (all well-formed, or none), its preview still, and the overflow it states */
function parseFrame(raw: any): Bundle["frame"] {
    if (!raw || !isCollectibleUrl(raw.static)) return undefined;
    const layers = Array.isArray(raw.layers) && raw.layers.length <= MAX_FRAME_LAYERS ? raw.layers.map(parseFrameLayer) : [];
    const frame: NonNullable<Bundle["frame"]> = { layers: layers.every(Boolean) ? layers : [], static: raw.static };
    if (isCollectibleUrl(raw.animated)) frame.animated = raw.animated;
    for (const key of ["overflowTop", "overflowBottom", "overflowHorizontal"] as const) {
        if (num(raw[key], 0, 2000)) frame[key] = Math.round(raw[key]);
    }
    return frame;
}

/** A bundle as Evi accepts it: a part that's malformed is left out, a bundle with no parts is dropped */
export function parseBundle(raw: any): Bundle | undefined {
    if (!raw || !isBundleId(raw.id) || typeof raw.name !== "string" || !raw.name.trim()) return undefined;
    const bundle: Bundle = {
        id: raw.id,
        name: raw.name.slice(0, 60),
        description: typeof raw.description === "string" ? raw.description.slice(0, 200) : "",
        tier: raw.tier === "supporter" ? "supporter" : "free",
    };
    const np = raw.nameplate;
    if (np && isCollectibleUrl(np.animated) && isCollectibleUrl(np.static) && PALETTES.includes(np.palette)) {
        bundle.nameplate = { animated: np.animated, static: np.static, palette: np.palette };
    }
    const deco = raw.decoration;
    if (deco && isCollectibleUrl(deco.animated) && isCollectibleUrl(deco.static)) {
        bundle.decoration = { animated: deco.animated, static: deco.static };
    }
    const frame = parseFrame(raw.frame);
    if (frame) bundle.frame = frame;
    const prices = parsePrices(raw.prices);
    if (prices) bundle.prices = prices;
    const fx = raw.effect;
    if (fx && Array.isArray(fx.layers) && fx.layers.length >= 1 && fx.layers.length <= MAX_LAYERS && isCollectibleUrl(fx.static) && isCollectibleUrl(fx.thumbnail)) {
        const layers = fx.layers.map(parseLayer);
        if (layers.every(Boolean)) bundle.effect = { layers: layers as EffectLayer[], static: fx.static, thumbnail: fx.thumbnail };
    }
    return bundle.nameplate || bundle.decoration || bundle.effect || bundle.frame ? bundle : undefined;
}

/** evi.rest's document as Evi reads it. Someone wearing a bundle that isn't listed wears nothing of it. */
export function parseCollectibles(json: unknown): CollectiblesDocument | undefined {
    const raw = json as any;
    if (!raw || !Array.isArray(raw.bundles) || typeof raw.users !== "object" || !raw.users) return undefined;
    const bundles: Bundle[] = [];
    const seen = new Set<string>();
    for (const b of raw.bundles.slice(0, 500)) {
        const bundle = parseBundle(b);
        if (bundle && !seen.has(bundle.id)) {
            seen.add(bundle.id);
            bundles.push(bundle);
        }
    }
    const byId = new Map(bundles.map(b => [b.id, b]));
    const users: Record<string, Equipped> = {};
    for (const [id, worn] of Object.entries(raw.users as Record<string, any>)) {
        if (!isDiscordId(id) || !worn || typeof worn !== "object") continue;
        const kept: Equipped = {};
        for (const kind of KINDS) {
            const b = byId.get(worn[kind]);
            if (b?.[kind]) kept[kind] = b.id;
        }
        if (Object.keys(kept).length) users[id] = kept;
    }
    return { bundles, users };
}

/**
 * A PUT /v1/me/collectibles body, checked the same way on both ends: each kind a bundle id or null,
 * at least one kind given
 */
export function validateEquip(body: any): { userId: string; changes: Partial<Record<CollectibleKind, string | null>>; } | { error: string; } {
    if (!body || typeof body !== "object") return { error: "Expected a JSON object" };
    if (!isDiscordId(body.userId)) return { error: "userId must be a Discord user id" };
    const changes: Partial<Record<CollectibleKind, string | null>> = {};
    for (const kind of KINDS) {
        if (!(kind in body)) continue;
        const v = body[kind];
        if (v !== null && !isBundleId(v)) return { error: `${kind} must be a bundle id or null` };
        changes[kind] = v;
    }
    if (!Object.keys(changes).length) return { error: "Nothing to change" };
    return { userId: body.userId, changes };
}

/** Sentinel SKU ids Evi hands to Discord's collectible code: "evi:<bundle>" */
export const SKU_PREFIX = "evi:";
export const skuFor = (bundleId: string) => SKU_PREFIX + bundleId;
export const bundleFromSku = (sku: unknown) => typeof sku === "string" && sku.startsWith(SKU_PREFIX) && isBundleId(sku.slice(SKU_PREFIX.length)) ? sku.slice(SKU_PREFIX.length) : undefined;

/** The launch set: id, name, description, palette (art in C:/Users/Public/evi-collectibles, ids match its folders) */
export const LAUNCH_BUNDLES: { id: string; name: string; description: string; palette: Palette; }[] = [
    { id: "autumn", name: "Autumn Hillside", description: "Maple leaves drifting down a golden hillside.", palette: "crimson" },
    { id: "sakura", name: "Sakura River", description: "Cherry blossoms falling over a red bridge.", palette: "bubble_gum" },
    { id: "fireflies", name: "Firefly Pond", description: "Fireflies blinking over a quiet summer pond.", palette: "forest" },
    { id: "cabin", name: "Snowed-In Cabin", description: "Snow falling around a warm little cabin.", palette: "cobalt" },
    { id: "neon", name: "Neon Rain", description: "Rain and buzzing neon in a city that never sleeps.", palette: "violet" },
    { id: "ruins", name: "Sunken Ruins", description: "Bubbles rising through an ancient underwater temple.", palette: "teal" },
    { id: "planet", name: "Ringed Planet", description: "A shooting star past a glowing ringed planet.", palette: "berry" },
    { id: "study", name: "Witch's Study", description: "Candlelight and potions fizzing with magic.", palette: "lemon" },
    { id: "glowshroom", name: "Glowshroom Grove", description: "Spores drifting from glowing mushrooms.", palette: "sky" },
];
