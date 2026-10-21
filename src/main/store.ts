/**
 * The store: reads a registry over https, and installs, updates and uninstalls plugins and themes from it.
 *
 * The renderer only ever names an id. Where files come from and what they must hash to is decided
 * here, from the registry this process downloaded itself, so nothing in Discord's page can point an
 * install at other files. Every file is verified before anything touches the plugins or themes folder,
 * and a finished plugin folder is moved into place with a single rename, so the plugin watcher never
 * sees half a plugin.
 */
import { describeGrowth, permissionGrowth, readPermissions } from "@shared/declaredPermissions";
import { imageDataUrl } from "@shared/images";
import { IPC, isPluginEnabled, PluginManifest, PreviewMediaResult } from "@shared/ipc";
import { cleanSwitches, StorePreviewResult } from "@shared/pluginPermissions";
import {
    betaOf,
    DEFAULT_REGISTRY_URL,
    InstalledPlugin,
    InstalledTheme,
    isPluginId,
    MAX_FILE_BYTES,
    MAX_IMAGE_BYTES,
    MAX_PREVIEW_BYTES,
    MAX_REGISTRY_BYTES,
    meetsMinEvi,
    parseRegistry,
    previewType,
    RegistryEntry,
    STORE_MARKER,
    StoreFileName,
    StoreImageResult,
    StoreListing,
    StoreMarker,
    StoreProgress,
    StoreResult,
    storeThemeFile,
    ThemeEntry,
    whyNotHash,
    whyNotManifest,
    whyNotStoreUrl,
} from "@shared/store";
import { MAX_THEME_BYTES, whyNotCss } from "@shared/themes";
import { createHash } from "crypto";
import { ipcMain, net, WebContents } from "electron";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "fs";
import { basename, dirname, join, resolve } from "path";

import { confirmWithUser } from "./confirm";
import { downloadHttps, readCapped } from "./download";
import { mt } from "./locale";
import { DATA_DIR, PLUGINS_DIR, THEMES_DIR } from "./paths";
import { consentToRun, hideDevPlugin, pluginLocation, refreshUserPlugin, setRemoved } from "./plugins";
import { authorBanners } from "./reports";
import { settings } from "./settings";
import { reloadTheme } from "./themes";

/** Outside the plugins folder, so the plugin watcher never loads a half-written plugin */
const STAGING_DIR = join(DATA_DIR, "store-staging");
/** `{ "registryUrl": "https://…" }`, edited by hand. The renderer can't change it. */
const CONFIG_FILE = join(DATA_DIR, "store.json");
/** Themes are single files with no room for a marker, so the store remembers its own here */
const THEMES_RECORD = join(DATA_DIR, "store-themes.json");

let cache: {
    url: string; entries: Map<string, RegistryEntry>; themes: Map<string, ThemeEntry>; images: Set<string>; previews: Set<string>;
    /** What the server called this copy, and what it listed: a 304 for that ETag reuses it */
    etag?: string; listing: { plugins: RegistryEntry[]; themes: ThemeEntry[]; problems: string[]; };
} | undefined;
const busy = new Set<string>();

export function getRegistryUrl() {
    if (process.env.EVI_STORE_URL) return process.env.EVI_STORE_URL;
    try {
        const { registryUrl } = JSON.parse(readFileSync(CONFIG_FILE, "utf8"));
        if (typeof registryUrl === "string" && registryUrl.trim()) return registryUrl.trim();
    } catch { }
    return DEFAULT_REGISTRY_URL;
}

/** SHA-256 of the native.js a store install has on disk, or undefined without one */
function installedNativeHash(dir: string) {
    try {
        return createHash("sha256").update(readFileSync(join(dir, "native.js"))).digest("hex");
    } catch {
        return undefined;
    }
}

function readMarker(dir: string): StoreMarker | undefined {
    try {
        const marker = JSON.parse(readFileSync(join(dir, STORE_MARKER), "utf8"));
        return marker && typeof marker.version === "string" ? marker : undefined;
    } catch {
        return undefined;
    }
}

function listInstalled(): InstalledPlugin[] {
    if (!existsSync(PLUGINS_DIR)) return [];
    const installed: InstalledPlugin[] = [];
    for (const entry of readdirSync(PLUGINS_DIR, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const dir = join(PLUGINS_DIR, entry.name);
        const marker = readMarker(dir);
        if (marker?.id === entry.name) {
            installed.push({ id: entry.name, version: marker.version, fromStore: true });
            continue;
        }
        try {
            const manifest: PluginManifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
            installed.push({ id: manifest.id ?? entry.name, version: manifest.version, fromStore: false });
        } catch { }
    }
    return installed;
}

/**
 * The store plugins this install has, at the version it has, and whether each is on: what the daily
 * usage check-in says (main/community.ts). Only ids the registry lists: a local plugin's stays here.
 */
export async function storeUsage(): Promise<{ id: string; version: string; enabled: boolean; }[]> {
    const listed = (await current()).entries;
    return listInstalled().flatMap(p => {
        if (!listed.has(p.id) || !p.version) return [];
        let manifest: PluginManifest = { id: p.id, name: p.id };
        try {
            manifest = JSON.parse(readFileSync(join(PLUGINS_DIR, p.id, "manifest.json"), "utf8"));
        } catch { }
        return [{ id: p.id, version: p.version, enabled: isPluginEnabled(settings, { ...manifest, id: p.id }) }];
    });
}

type ThemesRecord = Record<string, { version: string; file: string; }>;

function readThemesRecord(): ThemesRecord {
    try {
        const record = JSON.parse(readFileSync(THEMES_RECORD, "utf8"));
        return record && typeof record === "object" && !Array.isArray(record) ? record : {};
    } catch {
        return {};
    }
}

function writeThemesRecord(record: ThemesRecord) {
    const tmp = THEMES_RECORD + ".tmp";
    writeFileSync(tmp, JSON.stringify(record, null, 4));
    renameSync(tmp, THEMES_RECORD);
}

/** Store themes whose file is still there: deleting the file by hand uninstalls it too */
function listInstalledThemes(): InstalledTheme[] {
    return Object.entries(readThemesRecord())
        .filter(([id, t]) => isPluginId(id) && typeof t?.version === "string" && t.file === storeThemeFile(id) && existsSync(join(THEMES_DIR, t.file)))
        .map(([id, t]) => ({ id, version: t.version, file: t.file, fromStore: true }));
}

/**
 * registry.json as downloadHttps would get it, plus its ETag. Given the ETag of the copy this session
 * already has, the server answers 304 when it's unchanged: `{ ok: true }` with no body.
 */
async function downloadRegistry(registryUrl: string, etag: string | undefined): Promise<{ ok: true; body: Uint8Array; etag?: string; } | { ok: true; } | { ok: false; error: string; }> {
    const url = new URL(registryUrl).href;
    let res: Response;
    try {
        res = await net.fetch(url, { signal: AbortSignal.timeout(20_000), cache: "no-store", credentials: "omit", headers: etag ? { "If-None-Match": etag } : {} });
    } catch (err) {
        return { ok: false, error: mt("main.dl.failed", { error: (err as Error).message }) };
    }
    if (etag && res.status === 304) return { ok: true };
    if (!res.ok) return { ok: false, error: mt("main.dl.status", { status: `${res.status} ${res.statusText}`.trim() }) };
    if (new URL(res.url || url).protocol !== "https:") return { ok: false, error: mt("main.dl.redirect") };

    const body = await readCapped(res, MAX_REGISTRY_BYTES).catch(() => undefined);
    if (body === undefined) return { ok: false, error: mt("main.dl.interrupted") };
    if (body === null) return { ok: false, error: mt("main.dl.tooLarge", { what: "The registry", size: `${MAX_REGISTRY_BYTES / 1024 / 1024} MB` }) };
    return { ok: true, body, etag: res.headers.get("etag") ?? undefined };
}

async function fetchRegistry(): Promise<StoreListing> {
    const registryUrl = getRegistryUrl();
    const installed = listInstalled();
    const installedThemes = listInstalledThemes();
    const fail = (error: string): StoreListing => ({ ok: false, registryUrl, error, installed, installedThemes });

    const badUrl = whyNotStoreUrl(registryUrl);
    if (badUrl) return fail(`The registry URL can't be used: ${badUrl}`);

    // Asked with the ETag of the copy already checked: unchanged, it isn't downloaded or checked again
    const known = cache?.url === registryUrl ? cache : undefined;
    const download = await downloadRegistry(registryUrl, known?.etag);
    if (!download.ok) return fail(download.error);
    if (!("body" in download)) return { ok: true, registryUrl, ...known!.listing, installed, installedThemes };

    let json: unknown;
    try {
        json = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(download.body));
    } catch {
        return fail("The registry isn't valid JSON");
    }
    const parsed = parseRegistry(json);
    if ("error" in parsed) return fail(parsed.error);

    const { plugins, themes } = parsed.registry;
    cache = {
        url: registryUrl,
        entries: new Map(plugins.map(p => [p.id, p])),
        themes: new Map(themes.map(t => [t.id, t])),
        images: new Set([...plugins, ...themes].flatMap(e => e.screenshots)),
        previews: new Set([...plugins, ...themes].flatMap(e => e.preview ? [e.preview] : [])),
        etag: download.etag,
        listing: { plugins, themes, problems: parsed.problems },
    };
    if (parsed.problems.length) console.warn(`[Evi] Store registry: skipped ${parsed.problems.length} entries`, parsed.problems);
    return { ok: true, registryUrl, plugins, themes, problems: parsed.problems, installed, installedThemes };
}

/** The registry currently configured: a stale cache from another URL doesn't count */
async function current() {
    if (!cache || cache.url !== getRegistryUrl()) {
        const listing = await fetchRegistry();
        if (!listing.ok) throw new Error(listing.error);
    }
    return cache!;
}

async function getEntry(id: string) {
    const entry = (await current()).entries.get(id);
    if (!entry) throw new Error(mt("main.store.notInStore", { id }));
    return entry;
}

const tempName = (id: string, kind: string) => join(STAGING_DIR, `${id}-${kind}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`);

function decodeText(name: string, data: Uint8Array) {
    try {
        return new TextDecoder("utf-8", { fatal: true }).decode(data);
    } catch {
        throw new Error(mt("main.store.notText", { name }));
    }
}

/** Downloads one file a registry entry lists and checks it against the registry's hash */
async function downloadVerified(name: string, file: { url: string; sha256: string; }) {
    const download = await downloadHttps(file.url, MAX_FILE_BYTES, { what: name, cache: "no-store" });
    if (!download.ok) throw new Error(`${name}: ${download.error}`);
    const badHash = await whyNotHash(name, download.body, file.sha256);
    if (badHash) throw new Error(badHash);
    return download.body;
}

function assertMeetsMinEvi(entry: { name: string; minEviVersion?: string; }) {
    if (!meetsMinEvi(EVI_VERSION, entry.minEviVersion)) {
        throw new Error(mt("main.store.needsEvi", { name: entry.name, min: entry.minEviVersion ?? "", version: EVI_VERSION }));
    }
}

/** What the installed copy of a store plugin declares, read from its own manifest on disk */
function installedPermissions(dir: string) {
    try {
        return readPermissions((JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")) as PluginManifest).permissions);
    } catch {
        return undefined;
    }
}

async function install(id: string, sender: WebContents, pageAllowed: { native: boolean; more: boolean; }, report: (p: StoreProgress) => void): Promise<StoreResult> {
    const stable = await getEntry(id);
    // Its beta, when you opted into this plugin's betas (read from the settings file, not what the page
    // says) and this Evi can run it; checked and held to exactly like a stable version
    const beta = settings.pluginBetas?.includes(id) ? betaOf(stable) : undefined;
    const entry = beta && meetsMinEvi(EVI_VERSION, beta.minEviVersion) ? beta : stable;
    assertMeetsMinEvi(entry);

    const dir = join(PLUGINS_DIR, id);
    const existing = existsSync(dir);
    if (existing && readMarker(dir)?.id !== id) {
        throw new Error(mt("main.store.folderExists", { id }));
    }
    // Full access is the user's call, asked from main: the page could be a plugin saying yes for them.
    // An update of a store install they already trusted doesn't ask again.
    const trusted = existing && readMarker(dir)?.native === true;
    // ...unless the update changes its full-access part: that's new code with the same access, and
    // the registry saying who made it proves nothing, so the user decides again
    const nativeChanged = trusted && entry.native && entry.files["native.js"]?.sha256.toLowerCase() !== installedNativeHash(dir);
    const confirmed = entry.native && (!trusted || nativeChanged);
    if (confirmed) {
        if (!await confirmWithUser(sender, nativeChanged ? {
            message: mt("main.nativeChanged.message", { name: entry.name, version: entry.version }),
            detail: mt("main.nativeChanged.detail", { name: entry.name, authors: entry.authors.join(mt("common.listSeparator")) }),
            confirm: mt("common.update"),
            pageSaid: pageAllowed.native,
        } : {
            message: mt("main.installNative.message", { name: entry.name }),
            detail: mt("main.installNative.detail", { name: entry.name, authors: entry.authors.join(mt("common.listSeparator")) }),
            confirm: mt("common.install"),
            pageSaid: pageAllowed.native,
        })) {
            throw new Error(mt("main.installNative.refused", { name: entry.name }));
        }
    }
    // An update that asks for more than the installed version declares is a new decision, asked the
    // same way. The download is checked against entry.permissions (whyNotManifest): this is what it gets.
    const growth = existing && !confirmed ? permissionGrowth(installedPermissions(dir), entry.permissions) : undefined;
    if (growth && !await confirmWithUser(sender, {
        message: mt("main.growth.message", { name: entry.name }),
        detail: mt("main.growth.detail", { growth: describeGrowth(growth, mt), authors: entry.authors.join(mt("common.listSeparator")) }),
        confirm: mt("common.update"),
        pageSaid: pageAllowed.more,
    })) {
        throw new Error(mt("main.growth.refused", { name: entry.name, version: entry.version }));
    }

    // Download and verify everything in memory first: any failure leaves the disk untouched
    const names = Object.keys(entry.files) as StoreFileName[];
    const files = new Map<StoreFileName, Uint8Array>();
    for (const [i, name] of names.entries()) {
        report({ id, phase: "downloading", done: i, total: names.length });
        files.set(name, await downloadVerified(name, entry.files[name]!));
    }

    report({ id, phase: "verifying", done: names.length, total: names.length });
    let manifest: unknown;
    try {
        manifest = JSON.parse(decodeText("manifest.json", files.get("manifest.json")!));
    } catch (err) {
        throw new Error(err instanceof SyntaxError ? "manifest.json isn't valid JSON" : (err as Error).message);
    }
    const badManifest = whyNotManifest(manifest, entry);
    if (badManifest) throw new Error(badManifest);
    for (const name of names) if (name !== "manifest.json") decodeText(name, files.get(name)!);

    report({ id, phase: "installing", done: names.length, total: names.length });
    mkdirSync(STAGING_DIR, { recursive: true });
    const staged = tempName(id, "new");
    const marker: StoreMarker = {
        id,
        version: entry.version,
        native: entry.native,
        registryUrl: cache!.url,
        files: Object.fromEntries(names.map(n => [n, entry.files[n]!.sha256])),
    };
    try {
        mkdirSync(staged);
        for (const [name, data] of files) writeFileSync(join(staged, name), data);
        writeFileSync(join(staged, STORE_MARKER), JSON.stringify(marker, null, 4));

        // Replace the old version by moving it aside, so a failed move puts it straight back
        const old = existing ? tempName(id, "old") : undefined;
        if (old) renameSync(dir, old);
        try {
            renameSync(staged, dir);
        } catch (err) {
            if (old) renameSync(old, dir);
            throw err;
        }
        if (old) rmSync(old, { recursive: true, force: true });
    } finally {
        rmSync(staged, { recursive: true, force: true });
    }

    // Installing a plugin the user removed earlier brings it back for good
    setRemoved(id, false);
    // The page turns it on once it's in: that's what the user just agreed to, main doesn't ask twice
    if (confirmed) consentToRun(id);
    // Don't wait for the watcher: the renderer has the plugin by the time this resolves
    refreshUserPlugin(id);
    console.log(`[Evi] Store: ${existing ? "updated" : "installed"} ${id} ${entry.version}`);
    return { ok: true, id, version: entry.version };
}

/**
 * Removes any plugin: from the store, one Evi ships with, or one dropped into the plugins folder.
 * Its folder is deleted, and it's remembered as removed so Evi's updates don't put it back. A plugin
 * from the dev build output (the repo's own) can't be deleted from here, so it's hidden instead.
 */
async function uninstall(id: string, sender: WebContents, report: (p: StoreProgress) => void): Promise<StoreResult> {
    const loaded = pluginLocation(id);
    // The folder of a plugin in the user plugins folder, whatever it's named
    const inPlugins = (dir: string) => resolve(dirname(dir)) === resolve(PLUGINS_DIR);
    const dir = loaded?.source === "user" && inPlugins(loaded.dir) ? loaded.dir
        : existsSync(join(PLUGINS_DIR, id)) ? join(PLUGINS_DIR, id) : undefined;
    if (!dir && loaded?.source !== "dev") throw new Error(mt("main.store.notInstalled", { id }));
    const version = (dir && readMarker(dir)?.version) || loaded?.version || "";
    // A folder the store didn't make may be the user's own work, with nothing to reinstall it from:
    // deleting it takes their OK, asked from main so a plugin can't delete it for them
    if (dir && readMarker(dir)?.id !== id && !await confirmWithUser(sender, {
        message: mt("main.delete.message", { name: loaded?.version ? id : basename(dir) }),
        detail: mt("main.delete.detail", { dir }),
        confirm: mt("main.delete.confirm"),
        pageSaid: true,
    })) {
        throw new Error(mt("main.delete.refused"));
    }

    report({ id, phase: "removing", done: 0, total: 1 });
    if (dir) {
        mkdirSync(STAGING_DIR, { recursive: true });
        // One rename takes the whole plugin away at once, then the leftovers are deleted at leisure
        const trash = tempName(id, "removed");
        renameSync(dir, trash);
        refreshUserPlugin(basename(dir));
        rmSync(trash, { recursive: true, force: true });
    }
    setRemoved(id, true);
    hideDevPlugin(id);
    console.log(`[Evi] Store: removed ${id}`);
    return { ok: true, id, version };
}

async function installTheme(id: string, report: (p: StoreProgress) => void): Promise<StoreResult> {
    const entry = (await current()).themes.get(id);
    if (!entry) throw new Error(mt("main.store.notInStore", { id }));
    assertMeetsMinEvi(entry);

    const file = storeThemeFile(id);
    const record = readThemesRecord();
    const path = join(THEMES_DIR, file);
    if (existsSync(path) && record[id]?.file !== file) {
        throw new Error(mt("main.store.themeExists", { file }));
    }

    report({ id, phase: "downloading", done: 0, total: 1 });
    const download = await downloadHttps(entry.file.url, Math.min(MAX_FILE_BYTES, MAX_THEME_BYTES), { what: file, cache: "no-store" });
    if (!download.ok) throw new Error(`${file}: ${download.error}`);

    report({ id, phase: "verifying", done: 1, total: 1 });
    const badHash = await whyNotHash(file, download.body, entry.file.sha256);
    if (badHash) throw new Error(badHash);
    const badCss = whyNotCss(decodeText(file, download.body), "", mt);
    if (badCss) throw new Error(badCss);

    report({ id, phase: "installing", done: 1, total: 1 });
    const updating = !!record[id];
    // Write then rename, so the theme watcher never reads half a file
    const tmp = join(THEMES_DIR, `.${file}.evi-tmp`);
    writeFileSync(tmp, download.body);
    renameSync(tmp, path);
    writeThemesRecord({ ...record, [id]: { version: entry.version, file } });

    reloadTheme(file);
    console.log(`[Evi] Store: ${updating ? "updated" : "installed"} theme ${id} ${entry.version}`);
    return { ok: true, id, version: entry.version };
}

function uninstallTheme(id: string, report: (p: StoreProgress) => void): StoreResult {
    const record = readThemesRecord();
    const installed = record[id];
    if (!installed || installed.file !== storeThemeFile(id)) throw new Error(mt("main.store.notFromStore", { id }));

    report({ id, phase: "removing", done: 0, total: 1 });
    rmSync(join(THEMES_DIR, installed.file), { force: true });
    delete record[id];
    writeThemesRecord(record);
    reloadTheme(installed.file);
    console.log(`[Evi] Store: uninstalled theme ${id}`);
    return { ok: true, id, version: installed.version };
}

/**
 * Downloads under way, so an image asked for twice is fetched once. The page keeps what they return
 * (renderer/store.ts): a second copy here held every screenshot seen twice, until Discord quit.
 */
const images = new Map<string, Promise<StoreImageResult>>();

/**
 * Discord's page can't load images from arbitrary hosts, so main fetches screenshots and hands back
 * a data URL. Only URLs the registry itself lists: the page can't use this to fetch anything else.
 */
async function fetchImage(url: unknown): Promise<StoreImageResult> {
    if (typeof url !== "string") return { ok: false, error: "Not a URL" };
    try {
        if (!(await current()).images.has(url) && !authorBanners().has(url)) return { ok: false, error: "That image isn't in the store" };
    } catch (err) {
        return { ok: false, error: (err as Error).message };
    }

    let pending = images.get(url);
    if (!pending) {
        pending = (async (): Promise<StoreImageResult> => {
            const download = await downloadHttps(url, MAX_IMAGE_BYTES, { what: "The image" });
            if (!download.ok) return download;
            const dataUrl = imageDataUrl(download.body);
            return dataUrl ? { ok: true, dataUrl } : { ok: false, error: "Not a PNG, JPEG, GIF or WebP image" };
        })();
        images.set(url, pending);
        const forget = () => images.delete(url);
        pending.then(forget, forget);
    }
    return pending;
}

const media = new Map<string, Promise<PreviewMediaResult>>();

/** The first bytes of each kind of preview, so a file can't pass for one it isn't */
function sniffPreview(bytes: Uint8Array): string | undefined {
    const ascii = (from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to));
    if (ascii(4, 8) === "ftyp") return "video/mp4";
    if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return "video/webm";
    if (ascii(0, 4) === "GIF8") return "image/gif";
    if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
}

/** A store item's preview, only one the registry lists, as bytes for the page to show */
async function fetchPreviewMedia(url: unknown): Promise<PreviewMediaResult> {
    if (typeof url !== "string") return { ok: false, error: "Not a URL" };
    try {
        if (!(await current()).previews.has(url)) return { ok: false, error: "That preview isn't in the store" };
    } catch (err) {
        return { ok: false, error: (err as Error).message };
    }
    let pending = media.get(url);
    if (!pending) {
        pending = (async (): Promise<PreviewMediaResult> => {
            const download = await downloadHttps(url, MAX_PREVIEW_BYTES, { what: "The preview" });
            if (!download.ok) return download;
            const mime = sniffPreview(download.body);
            if (!mime || mime !== previewType(url)) return { ok: false, error: "Not the MP4, WebM, GIF or WebP its link says" };
            return { ok: true, bytes: download.body, mime };
        })();
        // One at a time in memory: previews are big
        media.clear();
        media.set(url, pending);
        pending.then(r => !r.ok && media.delete(url));
    }
    return pending;
}

const previews = new Map<string, Promise<StorePreviewResult>>();

/**
 * A plugin's manifest and renderer code before it's installed, so its store page can say what it
 * can touch. The same download and checks as an install (registry hashes, manifest), and nothing is
 * written anywhere. Only plugins the registry lists: the page can't fetch anything else with this.
 */
async function previewPlugin(id: unknown): Promise<StorePreviewResult> {
    if (!isPluginId(id)) return { ok: false, error: "That isn't a valid plugin id" };
    let entry: RegistryEntry;
    try {
        entry = await getEntry(id);
    } catch (err) {
        return { ok: false, error: (err as Error).message };
    }

    const key = `${id}:${entry.files["manifest.json"].sha256}:${entry.files["index.js"].sha256}`;
    let pending = previews.get(key);
    if (!pending) {
        const text = async (name: "manifest.json" | "index.js") => decodeText(name, await downloadVerified(name, entry.files[name]));
        pending = (async (): Promise<StorePreviewResult> => {
            try {
                const [manifestText, code] = await Promise.all([text("manifest.json"), text("index.js")]);
                let manifest: any;
                try {
                    manifest = JSON.parse(manifestText);
                } catch {
                    throw new Error("manifest.json isn't valid JSON");
                }
                const badManifest = whyNotManifest(manifest, entry);
                if (badManifest) throw new Error(badManifest);
                return { ok: true, code, manifest: { native: entry.native, chromiumSwitches: cleanSwitches(manifest.chromiumSwitches) } };
            } catch (err) {
                return { ok: false, error: (err as Error)?.message ?? String(err) };
            }
        })();
        // A few recent ones: going back and forth between store pages doesn't download again
        if (previews.size >= 20) previews.delete(previews.keys().next().value!);
        previews.set(key, pending);
        pending.then(r => !r.ok && previews.delete(key));
    }
    return pending;
}

/** Runs one operation per item at a time and turns thrown errors into results */
async function exclusive(id: unknown, run: (id: string) => Promise<StoreResult> | StoreResult, kind = "plugin"): Promise<StoreResult> {
    if (!isPluginId(id)) return { ok: false, error: `That isn't a valid ${kind} id` };
    const key = `${kind}:${id}`;
    if (busy.has(key)) return { ok: false, error: mt("main.store.busy", { id }) };
    busy.add(key);
    try {
        return await run(id);
    } catch (err) {
        console.warn(`[Evi] Store: ${kind} ${id} failed`, err);
        return { ok: false, error: (err as Error)?.message ?? String(err) };
    } finally {
        busy.delete(key);
    }
}

function progressTo(sender: WebContents, kind: StoreProgress["kind"] = "plugin") {
    return (progress: StoreProgress) => {
        if (!sender.isDestroyed()) sender.send(IPC.STORE_PROGRESS, { ...progress, kind });
    };
}

export function initStore() {
    // Leftovers of an install that was cut off (Discord quit mid-way)
    rmSync(STAGING_DIR, { recursive: true, force: true });

    ipcMain.handle(IPC.STORE_LIST, () => fetchRegistry());
    ipcMain.handle(IPC.STORE_INSTALL, (e, id: unknown, options?: { allowNative?: unknown; allowMore?: unknown; }) =>
        exclusive(id, id => install(id, e.sender, { native: options?.allowNative === true, more: options?.allowMore === true }, progressTo(e.sender))));
    ipcMain.handle(IPC.STORE_UNINSTALL, (e, id: unknown) => exclusive(id, id => uninstall(id, e.sender, progressTo(e.sender))));
    ipcMain.handle(IPC.STORE_THEME_INSTALL, (e, id: unknown) => exclusive(id, id => installTheme(id, progressTo(e.sender, "theme")), "theme"));
    ipcMain.handle(IPC.STORE_THEME_UNINSTALL, (e, id: unknown) => exclusive(id, id => uninstallTheme(id, progressTo(e.sender, "theme")), "theme"));
    ipcMain.handle(IPC.STORE_IMAGE, (_, url: unknown) => fetchImage(url));
    ipcMain.handle(IPC.STORE_PREVIEW_MEDIA, (_, url: unknown) => fetchPreviewMedia(url));
    ipcMain.handle(IPC.STORE_PREVIEW, (_, id: unknown) => previewPlugin(id));
}
