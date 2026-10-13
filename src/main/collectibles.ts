/**
 * Evi collectibles for the renderer (shared/collectibles.ts): the document from evi.rest, cached on
 * disk with its ETag so they show from the first frame, and refetched the moment evi.rest's change
 * stream says who wears what changed.
 *
 * Discord's page may only load images and video from Discord or blob:/data: URLs, so the page asks
 * main for each file it needs and makes a blob: URL of the bytes. Files are only ever evi.rest's own
 * collectible URLs, cached on disk by their version (?v=) for good.
 */
import { CollectiblesDocument, Equipped, parseCollectibles, parseWallet, validateBuy, validateEquip, validateRedeem, Wallet } from "@shared/collectibles";
import { cacheName, fetchUrlFor, MAX_COLLECTIBLE_BYTES, mimeForExt, sniffMime } from "@shared/collectiblesFiles";
import { CollectibleFileResult, CollectiblesChanges, CollectiblesEquipResult, CollectiblesResult, IPC, RedeemResult, WalletResult } from "@shared/ipc";
import { parseRedeem, Refusal, refusalFrom } from "@shared/sparks";
import { ipcMain, net } from "electron";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "fs";
import { join } from "path";

import { listenForChanges, onCollectiblesAnnounced, onWalletAnnounced } from "./badges";
import { readCapped } from "./download";
import { apiRequest, apiUrl, isLocalDevApi } from "./evirest";
import { DATA_DIR } from "./paths";
import { broadcast, rateLimit, sleep } from "./util";

const CACHE_FILE = join(DATA_DIR, "cache", "collectibles.json");
const FILES_DIR = join(DATA_DIR, "cache", "collectibles");

interface Cache {
    etag: string | null;
    doc: CollectiblesDocument;
}

let cache: Cache | undefined;
let pending: Promise<CollectiblesResult> | undefined;

function readCache(): Cache | undefined {
    try {
        const saved = JSON.parse(readFileSync(CACHE_FILE, "utf8"));
        const doc = parseCollectibles(saved?.doc);
        return doc ? { etag: typeof saved.etag === "string" ? saved.etag : null, doc } : undefined;
    } catch {
        return undefined;
    }
}

function writeCache(next: Cache) {
    try {
        mkdirSync(join(DATA_DIR, "cache"), { recursive: true });
        writeFileSync(CACHE_FILE + ".tmp", JSON.stringify(next));
        renameSync(CACHE_FILE + ".tmp", CACHE_FILE);
    } catch (err) {
        console.warn("[Evi] Collectibles: couldn't write the cache", err);
    }
}

async function refresh(): Promise<CollectiblesResult> {
    cache ??= readCache();
    try {
        const res = await apiRequest("GET", "/collectibles", { headers: cache?.etag ? { "If-None-Match": cache.etag } : {}, max: 4 * 1024 * 1024 });
        if (res.status !== 304) {
            const doc = parseCollectibles(res.json);
            if (!doc) throw new Error("The collectibles server sent something unexpected");
            cache = { etag: res.etag, doc };
            writeCache(cache);
            broadcast(IPC.COLLECTIBLES_CHANGED, { ok: true, doc });
        }
    } catch (err) {
        console.warn("[Evi] Collectibles: using the cached list,", (err as Error).message);
        if (!cache) return { ok: false, error: (err as Error).message };
    }
    return { ok: true, doc: cache!.doc };
}

/** One request at a time; everyone asking meanwhile gets the same answer */
export function getCollectibles(cachedOnly = false): Promise<CollectiblesResult> {
    if (cachedOnly) {
        cache ??= readCache();
        if (cache) return Promise.resolve({ ok: true, doc: cache.doc });
    }
    pending ??= refresh().finally(() => void (pending = undefined));
    return pending;
}

/** Files being fetched, so a file asked for twice at once is fetched once */
const fetching = new Map<string, Promise<CollectibleFileResult>>();

async function fetchFile(url: string): Promise<CollectibleFileResult> {
    const name = cacheName(url);
    if (!name) return { ok: false, error: "Not one of evi.rest's collectible files" };
    const dir = join(FILES_DIR, name.dir);
    const path = join(dir, name.file);
    const mime = mimeForExt(name.ext);
    if (existsSync(path)) {
        try {
            return { ok: true, bytes: new Uint8Array(readFileSync(path)), mime };
        } catch { }
    }

    const base = apiUrl();
    const from = fetchUrlFor(url, base);
    if (!from.startsWith("https://") && !isLocalDevApi(base)) return { ok: false, error: "Collectibles only come over https" };
    let res: Response;
    try {
        res = await net.fetch(from, { signal: AbortSignal.timeout(60_000), credentials: "omit" });
    } catch (err) {
        return { ok: false, error: (err as Error).message };
    }
    if (!res.ok) return { ok: false, error: `evi.rest answered ${res.status}` };
    const bytes = await readCapped(res, MAX_COLLECTIBLE_BYTES).catch(() => undefined);
    if (!bytes) return { ok: false, error: bytes === null ? "The file is too large" : "The download was interrupted" };
    // Bytes that aren't what the name says never reach the page
    if (sniffMime(bytes) !== mime) return { ok: false, error: "The file isn't what its name says" };

    try {
        mkdirSync(dir, { recursive: true });
        writeFileSync(path + ".tmp", bytes);
        renameSync(path + ".tmp", path);
        // Older versions of the same file aren't needed any more
        for (const old of readdirSync(dir)) {
            if (old !== name.file && old.startsWith(name.name + ".") && old.endsWith("." + name.ext) && old.split(".").length === 3) rmSync(join(dir, old), { force: true });
        }
    } catch (err) {
        console.warn("[Evi] Collectibles: couldn't cache", url, err);
    }
    return { ok: true, bytes, mime };
}

export function getFile(url: unknown): Promise<CollectibleFileResult> {
    if (typeof url !== "string") return Promise.resolve({ ok: false, error: "Not a URL" });
    let job = fetching.get(url);
    if (!job) {
        job = fetchFile(url).finally(() => fetching.delete(url));
        fetching.set(url, job);
    }
    return job;
}

/** Buttons in the page can be pressed by anything running there: main caps how often they reach evi.rest */
const equipAllowed = rateLimit(10, 60_000);

/** Wears or takes off your own; evi.rest checks this install is linked to that account */
export async function equip(userId: unknown, changes: CollectiblesChanges): Promise<CollectiblesEquipResult> {
    const checked = validateEquip({ ...(changes && typeof changes === "object" ? changes : {}), userId });
    if ("error" in checked) return { ok: false, error: checked.error };
    if (!equipAllowed()) return { ok: false, error: "Too many changes at once. Try again in a minute." };
    let json: any;
    try {
        ({ json } = await apiRequest("PUT", "/me/collectibles", {
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ userId: checked.userId, ...checked.changes }),
            max: 64 * 1024,
        }));
    } catch (err) {
        return refused(err);
    }
    cache ??= readCache();
    const bundles = cache?.doc.bundles ?? [];
    const equipped: Equipped = parseCollectibles({ bundles, users: { [checked.userId]: json?.equipped ?? {} } })?.users[checked.userId] ?? {};
    if (cache) {
        const users = { ...cache.doc.users };
        if (Object.keys(equipped).length) users[checked.userId] = equipped;
        else delete users[checked.userId];
        // Shown here first; the next look at evi.rest replaces it with the real list
        cache = { etag: null, doc: { ...cache.doc, users } };
        broadcast(IPC.COLLECTIBLES_CHANGED, { ok: true, doc: cache.doc });
    }
    void getCollectibles();
    return { ok: true, equipped };
}

/** evi.rest's refusal as the page reads it: why (not linked, not enough Sparks, not owned) and the numbers */
function refused(err: unknown): Refusal {
    const e = err as Error & { status?: number; json?: unknown; };
    return refusalFrom(e?.message ?? String(err), e?.status, e?.json);
}

// ---- owning them: Sparks and what you own ----

/** Wallets fetched this session, by Discord user id (one, normally: yours) */
const wallets = new Map<string, Wallet>();
const walletPending = new Map<string, Promise<WalletResult>>();
/** Whose wallet to fetch again when evi.rest says collectibles changed */
let walletOwner: string | undefined;

/** Buying and redeeming from the page, a person's pace: no plugin can make this install spam evi.rest */
const buyAllowed = rateLimit(10, 60_000);
const redeemAllowed = rateLimit(10, 60_000);

function gotWallet(wallet: Wallet) {
    wallets.set(wallet.userId, wallet);
    broadcast(IPC.COLLECTIBLES_WALLET_CHANGED, { ok: true, wallet } satisfies WalletResult);
    return wallet;
}

/** Your Sparks and what you own; evi.rest answers a linked install for its own account */
export function getWallet(userId: unknown, fresh = false): Promise<WalletResult> {
    if (typeof userId !== "string" || !/^\d{17,20}$/.test(userId)) return Promise.resolve({ ok: false, error: "Not a Discord user id" });
    walletOwner = userId;
    const have = wallets.get(userId);
    if (have && !fresh) return Promise.resolve({ ok: true, wallet: have });
    let job = walletPending.get(userId);
    if (!job) {
        job = (async (): Promise<WalletResult> => {
            try {
                const { json } = await apiRequest("GET", `/me/collectibles?userId=${userId}`, { max: 256 * 1024 });
                const wallet = parseWallet(json);
                if (!wallet || wallet.userId !== userId) return { ok: false, error: "evi.rest sent something unexpected" };
                return { ok: true, wallet: gotWallet(wallet) };
            } catch (err) {
                return refused(err);
            }
        })().finally(() => walletPending.delete(userId));
        walletPending.set(userId, job);
    }
    return job;
}

/** One part, or the rest of a bundle: the new wallet, or why not (not enough Sparks: need and have) */
export async function buy(userId: unknown, bundle: unknown, kind: unknown): Promise<WalletResult> {
    const checked = validateBuy({ userId, bundle, kind: kind ?? undefined });
    if ("error" in checked) return { ok: false, error: checked.error };
    if (!buyAllowed()) return { ok: false, error: "Too many purchases at once. Try again in a minute.", code: "rate_limited" };
    try {
        const { json } = await apiRequest("POST", "/me/collectibles/buy", {
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(checked),
            max: 256 * 1024,
        });
        const wallet = parseWallet(json?.wallet ?? json);
        if (wallet) return { ok: true, wallet: gotWallet(wallet) };
    } catch (err) {
        const why = refused(err);
        // Bought elsewhere meanwhile, or the Sparks changed: what's true now
        if (why.code === "owned" || why.code === "insufficient") void getWallet(checked.userId, true);
        return why;
    }
    // Bought, but the answer was odd: ask again
    return getWallet(checked.userId, true);
}

/** A code: its Sparks and items go to your account; what it gave comes back to show */
export async function redeem(userId: unknown, code: unknown): Promise<RedeemResult> {
    const checked = validateRedeem({ userId, code });
    if ("error" in checked) return { ok: false, error: checked.error, code: "invalid_code" };
    if (!redeemAllowed()) return { ok: false, error: "Too many tries. Try again in a minute.", code: "rate_limited" };
    try {
        const { json } = await apiRequest("POST", "/me/collectibles/redeem", {
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(checked),
            max: 256 * 1024,
        });
        const result = parseRedeem(json);
        if (!result) return { ok: false, error: "evi.rest sent something unexpected" };
        gotWallet(result.wallet);
        return { ok: true, ...result };
    } catch (err) {
        return refused(err);
    }
}

export function initCollectibles() {
    ipcMain.handle(IPC.COLLECTIBLES_GET, (_, cachedOnly: unknown) => {
        // Discord is showing collectibles: from now on, hear about changes as they happen
        listenForChanges();
        return getCollectibles(cachedOnly === true);
    });
    ipcMain.handle(IPC.COLLECTIBLES_FILE, (_, url: unknown) => getFile(url));
    ipcMain.handle(IPC.COLLECTIBLES_EQUIP, (_, userId: unknown, changes: CollectiblesChanges) => equip(userId, changes));
    ipcMain.handle(IPC.COLLECTIBLES_WALLET, (_, userId: unknown, fresh: unknown) => {
        // A grant, a purchase on another computer: the stream says so (its `wallet` event)
        listenForChanges();
        return getWallet(userId, fresh === true);
    });
    ipcMain.handle(IPC.COLLECTIBLES_BUY, (_, userId: unknown, bundle: unknown, kind: unknown) => buy(userId, bundle, kind));
    ipcMain.handle(IPC.COLLECTIBLES_REDEEM, (_, userId: unknown, code: unknown) => redeem(userId, code));
    // A change, or the stream came back (one may have been missed): after a moment, so thousands of
    // installs don't all ask in the same instant
    onCollectiblesAnnounced(() => void sleep(Math.random() * 2000).then(() => getCollectibles()));
    // Your Sparks or parts changed (only your own installs hear it), or the stream came back: your
    // wallet again, if the page has asked for it
    onWalletAnnounced(() => {
        if (walletOwner) void getWallet(walletOwner, true).then(r => !r.ok && broadcast(IPC.COLLECTIBLES_WALLET_CHANGED, r));
    });
}
