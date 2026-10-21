import type { AuthorProfile } from "@shared/authors";
import { permissionGrowth, PermissionGrowth, readPermissions } from "@shared/declaredPermissions";
import type { PluginHealth } from "@shared/health";
import type { PluginManifest } from "@shared/ipc";
import { localizePlugin } from "@shared/pluginLocales";
import { PulledPlugin, pullFor } from "@shared/pulls";
import { PluginPage, RatingSummary, ratingScore } from "@shared/reviews";
import { starKey, StarsSnapshot } from "@shared/stars";
import { betaOf, InstalledPlugin, InstalledTheme, RegistryEntry, storeAction, StoreProgress, StoreResult, ThemeEntry } from "@shared/store";
import type { StoreHome } from "@shared/storeHome";

import { I18n, t } from "./i18n";
import { Logger } from "./logger";
import { Native } from "./native";
import { PluginManager } from "./plugins/manager";
import { SafeMode } from "./safeMode";
import { Settings } from "./settings";
import { Themes } from "./themes";
import { showToast } from "./toolkit/toasts";

export type StoreKind = "plugin" | "theme";

export type StoreOp =
    | { type: "busy"; label: string; }
    | { type: "done"; message: string; }
    | { type: "error"; error: string; };

export interface StoreState {
    status: "idle" | "loading" | "ready" | "error";
    error?: string;
    registryUrl?: string;
    plugins: RegistryEntry[];
    themes: ThemeEntry[];
    /** Entries the registry listed but that failed validation */
    problems: string[];
    installed: Record<string, InstalledPlugin>;
    installedThemes: Record<string, InstalledTheme>;
    /** Latest operation per plugin id */
    ops: Record<string, StoreOp>;
    /** Latest operation per theme id */
    themeOps: Record<string, StoreOp>;
    /** Set while Update all runs */
    updatingAll?: StoreKind;
    /** Star counts and this install's stars. Missing while loading or when the server is unreachable. */
    stars?: StarsSnapshot;
    /** Store plugins evi.rest knows are broken right now, by id. Missing until loaded. */
    health?: Record<string, PluginHealth>;
    /** Author profiles on evi.rest, by slug. Missing until loaded. */
    authors?: Record<string, AuthorProfile>;
    /** Where author pages are, e.g. https://evi.rest */
    authorSite?: string;
    /** The store's front page: trending, new this week, collections. Missing until loaded. */
    home?: StoreHome;
    /** Ratings by "plugin:id". Missing until loaded. */
    ratings?: Record<string, RatingSummary>;
    /** Each plugin page's community side, by id, once opened */
    pages: Record<string, { status: "loading"; } | { status: "ready"; page: PluginPage; } | { status: "error"; error: string; }>;
    /** Authors this Evi's account follows; undefined while unknown or not linked */
    following?: string[];
    /** Whether this Evi is linked to an account, as far as the last community answer said */
    linked?: boolean;
}

export interface UpdateAllResult {
    updated: string[];
    failed: string[];
    /** Full-access plugins left alone because nobody confirmed them */
    skippedNative: string[];
    /** Updates that ask for more than the installed version, left alone because nobody confirmed them */
    skippedMoreAccess: string[];
}

const logger = new Logger("Store", "#f0a35e");
const listeners = new Set<() => void>();
let state: StoreState = { status: "idle", plugins: [], themes: [], problems: [], installed: {}, installedThemes: {}, ops: {}, themeOps: {}, pages: {} };
let listening = false;
let reportsAsked = false;

/** The registry's lists as they came: the state has them in Discord's language, which can change */
let raw: { plugins: RegistryEntry[]; themes: ThemeEntry[]; } | undefined;

function localizedLists() {
    if (!raw) return {};
    const locale = I18n.discordLocale;
    return { plugins: raw.plugins.map(p => localizePlugin(p, locale)), themes: raw.themes.map(th => localizePlugin(th, locale)) };
}

function followLocale() {
    if (raw) return;
    I18n.subscribe(() => raw && set(localizedLists()));
}

function set(next: Partial<StoreState>) {
    state = { ...state, ...next };
    for (const listener of listeners) listener();
}

const opsKey = (kind: StoreKind) => kind === "theme" ? "themeOps" : "ops";

function setOp(kind: StoreKind, id: string, op: StoreOp | undefined) {
    const ops = { ...state[opsKey(kind)] };
    if (op) ops[id] = op;
    else delete ops[id];
    set({ [opsKey(kind)]: ops });
}

const phaseLabel = ({ phase, done, total }: StoreProgress) => ({
    downloading: total > 1 ? t("op.downloadingFile", { n: Math.min(done + 1, total), count: total }) : t("common.downloading"),
    verifying: t("op.verifying"),
    installing: t("op.installing"),
    removing: t("op.removing"),
})[phase];

function listen() {
    if (listening) return;
    listening = true;
    Native.onStoreProgress?.(progress => {
        const kind = progress.kind ?? "plugin";
        if (state[opsKey(kind)][progress.id]?.type === "busy") setOp(kind, progress.id, { type: "busy", label: phaseLabel(progress) });
    });
}

async function run(kind: StoreKind, id: string, label: string, action: () => Promise<StoreResult>) {
    listen();
    if (state[opsKey(kind)][id]?.type === "busy") return { ok: false, error: t("op.alreadyRunning") } as StoreResult;
    setOp(kind, id, { type: "busy", label });
    let result: StoreResult;
    try {
        result = await action();
    } catch (err) {
        result = { ok: false, error: String((err as Error)?.message ?? err) };
    }
    if (!result.ok) {
        logger.warn(`${kind} ${id}: ${result.error}`);
        setOp(kind, id, { type: "error", error: result.error });
    }
    return result;
}

/** What a fresh install says, from how the plugin actually ended up rather than what was asked */
function installedMessage(plugin: ReturnType<typeof PluginManager.get>) {
    if (SafeMode.active) return t("op.installedSafeMode");
    if (!plugin) return t("op.installedNextStart");
    if (plugin.error) return t("op.installedCrashed");
    if (plugin.needsReload) return t("op.installedRestart");
    return plugin.running ? t("op.installedOn") : t("store.installed");
}

/**
 * What's installed under a plugin id. Main only looks in the plugins folder, so a plugin loaded from
 * somewhere else (a dev build) counts as installed outside the store instead of being offered again.
 */
function installedPlugin(id: string): InstalledPlugin | undefined {
    const listed = state.installed[id];
    if (listed) return listed;
    const loaded = PluginManager.get(id);
    return loaded ? { id, version: loaded.manifest.version, fromStore: false } : undefined;
}

/**
 * A manifest's authors, if they're a list of names. A manifest says whatever its plugin says, in any
 * shape: nothing here assumes it's an array of strings.
 */
export function manifestAuthors(manifest: PluginManifest): string[] {
    const authors: unknown = manifest.authors;
    if (!Array.isArray(authors)) return [];
    return authors.filter((a): a is string => typeof a === "string" && !!a.trim()).map(a => a.trim().slice(0, 80)).slice(0, 10);
}

const images = new Map<string, Promise<string | null>>();
const MAX_IMAGES = 24;
const media = new Map<string, Promise<{ url: string; video: boolean; } | null>>();

/** A plugin's entry as this install gets it: its beta when you opted into betas and there's a newer one */
function entryFor(entry: RegistryEntry): RegistryEntry {
    return Settings.data.pluginBetas?.includes(entry.id) ? betaOf(entry) ?? entry : entry;
}

let autoTimer: ReturnType<typeof setInterval> | undefined;
const AUTO_UPDATE_EVERY = 6 * 60 * 60 * 1000;

export const Store = {
    /** An entry's name and description as the registry has them, before translation: search matches those too */
    original(kind: StoreKind, id: string): { name: string; description?: string; } | undefined {
        return (kind === "theme" ? raw?.themes : raw?.plugins)?.find(e => e.id === id);
    },
    /** Downloads the registry (main does the fetching and validation) */
    async refresh() {
        listen();
        set({ status: "loading", error: undefined });
        // They don't need the registry: plugin health shows in the Plugins list even when it can't load
        void Store.refreshReports();
        try {
            const listing = await Native.storeList();
            const installed = Object.fromEntries(listing.installed.map(p => [p.id, p]));
            // Mains older than the theme store don't send these
            const installedThemes = Object.fromEntries((listing.installedThemes ?? []).map(t => [t.id, t]));
            if (!listing.ok) return set({ status: "error", error: listing.error, registryUrl: listing.registryUrl, installed, installedThemes });
            followLocale();
            raw = { plugins: listing.plugins, themes: listing.themes ?? [] };
            set({ status: "ready", registryUrl: listing.registryUrl, ...localizedLists(), problems: listing.problems, installed, installedThemes });
            void Store.refreshStars();
            void Store.refreshCommunity();
        } catch (err) {
            set({ status: "error", error: String((err as Error)?.message ?? err) });
        }
    },

    installedPlugin,

    /**
     * Who made an installed plugin. For a store install, the registry's names: those were reviewed,
     * while its manifest could claim to be by anyone (nothing until the registry has loaded). Anything
     * else, its manifest's.
     */
    authorsOf({ manifest, source }: { manifest: PluginManifest; source: string; }): string[] {
        if (source !== "dev" && state.installed[manifest.id]?.fromStore) return state.plugins.find(p => p.id === manifest.id)?.authors ?? [];
        return manifestAuthors(manifest);
    },

    /** Loads star counts. Stars are extra: when the server is down the store works without them. */
    async refreshStars() {
        const result = await Native.getStars?.().catch(() => undefined);
        if (result?.ok) set({ stars: { counts: result.counts, mine: result.mine } });
        else if (result) logger.warn(`Stars unavailable: ${result.error}`);
    },

    /** Plugin health and author profiles. Extra, like stars: without them there's no pill and no profile. */
    async refreshReports() {
        reportsAsked = true;
        const [health, authors] = await Promise.all([
            Native.getHealth?.().catch(() => undefined),
            Native.getAuthors?.().catch(() => undefined),
        ]);
        if (health?.ok) {
            set({ health: health.plugins });
            // Main tells every page when pulls change; this answer may simply be here first
            if (health.pulled) void PluginManager.setPulls(health.pulled);
        }
        else if (health) logger.warn(`Plugin health unavailable: ${health.error}`);
        if (authors?.ok) set({ authors: authors.authors, authorSite: authors.site });
        else if (authors) logger.warn(`Authors unavailable: ${authors.error}`);
    },

    /** The front page, ratings and who you follow. Extra like stars: the store works without them. */
    async refreshCommunity() {
        const [home, ratings, following] = await Promise.all([
            Native.storeHome?.().catch(() => undefined),
            Native.storeRatings?.().catch(() => undefined),
            Native.following?.().catch(() => undefined),
        ]);
        if (home?.ok) set({ home: home.value });
        if (ratings?.ok) set({ ratings: ratings.value });
        if (following?.ok) set({ following: following.value, linked: true });
        else if (following && !following.ok && following.unlinked) set({ following: undefined, linked: false });
    },

    /** A plugin's page beyond the registry: reviews, related plugins, known issues, the author's note */
    async loadPage(id: string, force = false) {
        if (!Native.pluginPage || (!force && state.pages[id]?.status === "ready")) return;
        if (state.pages[id]?.status !== "ready") set({ pages: { ...state.pages, [id]: { status: "loading" } } });
        const result = await Native.pluginPage(id).catch(err => ({ ok: false as const, error: String(err) }));
        set({ pages: { ...state.pages, [id]: result.ok ? { status: "ready", page: result.value } : { status: "error", error: result.error } } });
    },

    pageOf: (id: string) => state.pages[id],

    rating: (kind: StoreKind, id: string): RatingSummary | undefined => state.ratings?.[starKey(kind, id)],

    /** For sorting by rating: an average that needs a few ratings to count for much */
    ratingScore: (kind: StoreKind, id: string) => ratingScore(state.ratings?.[starKey(kind, id)]),

    /** For sorting by trending: higher is more, 0 when it isn't trending */
    trendingScore(kind: StoreKind, id: string) {
        const list = state.home?.trending ?? [];
        const at = list.indexOf(starKey(kind, id));
        return at < 0 ? 0 : list.length - at;
    },

    /** Writes or changes this account's review, or takes it back (null) */
    async review(id: string, review: { rating: number; body: string; } | null) {
        if (!Native.setReview) return { ok: false as const, error: t("common.notSupported") };
        const version = Store.installedPlugin(id)?.version ?? state.plugins.find(p => p.id === id)?.version ?? "";
        const result = await Native.setReview(id, review && { ...review, version });
        if (!result.ok && result.unlinked) set({ linked: false });
        if (result.ok) {
            await Store.loadPage(id, true);
            // evi.rest caches ratings for a minute: the page has the fresh one
            const page = state.pages[id];
            if (page?.status === "ready") set({ ratings: { ...state.ratings, [starKey("plugin", id)]: page.page.rating } });
        }
        return result;
    },

    async reportReview(reviewId: number) {
        return Native.reportReview?.(reviewId) ?? { ok: false as const, error: t("common.notSupported") };
    },

    isFollowing: (slug: string) => !!state.following?.includes(slug),

    /** Follows or unfollows an author; the count comes back with the answer */
    async follow(slug: string, on: boolean) {
        if (!Native.follow) return { ok: false as const, error: t("common.notSupported") };
        const result = await Native.follow(slug, on);
        if (result.ok) {
            const following = new Set(state.following ?? []);
            if (result.value.following) following.add(slug);
            else following.delete(slug);
            const profile = state.authors?.[slug];
            set({ following: [...following], linked: true, ...profile && { authors: { ...state.authors, [slug]: { ...profile, followers: result.value.followers } } } });
        } else if (result.unlinked) set({ linked: false });
        return result;
    },

    isWished: (kind: StoreKind, id: string) => !!Settings.data.wishlist?.includes(starKey(kind, id)),

    /** Hearts or un-hearts a store item. Its current version counts as seen: you hear about the next. */
    toggleWish(kind: StoreKind, id: string) {
        const key = starKey(kind, id);
        const entry: RegistryEntry | ThemeEntry | undefined = kind === "plugin" ? state.plugins.find(p => p.id === id) : state.themes.find(t => t.id === id);
        Settings.update(d => {
            const list = new Set(d.wishlist ?? []);
            const seen = { ...d.wishlistSeen };
            if (list.has(key)) {
                list.delete(key);
                delete seen[key];
                delete seen[`${key}#beta`];
            } else {
                list.add(key);
                if (entry) seen[key] = entry.version;
                const beta = entry && "beta" in entry ? entry.beta : undefined;
                if (beta) seen[`${key}#beta`] = beta.version;
            }
            d.wishlist = [...list];
            d.wishlistSeen = seen;
        });
        set({});
    },

    entryFor,

    hasBetas: (id: string) => !!Settings.data.pluginBetas?.includes(id),

    /** Opts into (or out of) a plugin's betas; main reads the same setting when it installs */
    setBetas(id: string, on: boolean) {
        Settings.update(d => {
            const list = new Set(d.pluginBetas ?? []);
            if (on) list.add(id);
            else list.delete(id);
            d.pluginBetas = [...list];
        });
        set({});
    },

    /** Loads plugin health and authors the first time something shows them */
    loadReports() {
        if (!reportsAsked) void Store.refreshReports();
    },

    healthOf: (id: string): PluginHealth | undefined => state.health?.[id],

    authorOf: (slug: string): AuthorProfile | undefined => state.authors?.[slug],

    stars: (kind: StoreKind, id: string) => state.stars?.counts[starKey(kind, id)] ?? 0,

    isStarred: (kind: StoreKind, id: string) => !!state.stars?.mine.includes(starKey(kind, id)),

    /** Stars or unstars right away, and puts it back if the server says no */
    async toggleStar(kind: StoreKind, id: string) {
        const stars = state.stars;
        if (!stars || !Native.setStar) return;
        const key = starKey(kind, id);
        const starred = !stars.mine.includes(key);
        const apply = (on: boolean, count: number) => {
            const current = state.stars ?? stars;
            set({
                stars: {
                    counts: { ...current.counts, [key]: Math.max(0, count) },
                    mine: on ? [...new Set([...current.mine, key])] : current.mine.filter(k => k !== key),
                },
            });
        };
        const before = stars.counts[key] ?? 0;
        apply(starred, before + (starred ? 1 : -1));
        const result = await Native.setStar(kind, id, starred).catch(err => ({ ok: false as const, error: String(err) }));
        if (result.ok) apply(result.starred, result.count);
        else {
            logger.warn(`Couldn't ${starred ? "star" : "unstar"} ${key}: ${result.error}`);
            apply(!starred, before);
        }
    },

    /**
     * What the store offers for a plugin id, or undefined when the registry doesn't list it. "pulled":
     * it would offer the version Evi pulled, which is never installed, not even as an update.
     */
    pluginAction(id: string) {
        const listed = state.plugins.find(p => p.id === id);
        const entry = listed && entryFor(listed);
        const action = entry && storeAction(entry, installedPlugin(id), EVI_VERSION);
        if ((action === "install" || action === "update") && Store.pullOf(id, entry!.version)) return "pulled" as const;
        return action;
    },

    /**
     * What the store's version of an installed plugin asks for that the installed one doesn't declare,
     * or undefined when it asks for nothing more (or there's no update). Main asks again before it
     * installs one that does (main/store.ts).
     */
    growthOf(id: string): PermissionGrowth | undefined {
        const listed = state.plugins.find(p => p.id === id);
        const entry = listed && entryFor(listed);
        const installed = PluginManager.get(id)?.manifest;
        if (!entry || !installed || Store.pluginAction(id) !== "update") return undefined;
        return permissionGrowth(readPermissions(installed.permissions), entry.permissions);
    },

    /** The pull on a version of a plugin, if Evi pulled it */
    pullOf: (id: string, version: string | undefined): PulledPlugin | undefined => pullFor(PluginManager.pulls(), id, version),

    themeAction(id: string) {
        const entry = state.themes.find(t => t.id === id);
        return entry && storeAction(entry, state.installedThemes[id], EVI_VERSION);
    },

    /**
     * Installs or updates a plugin and turns it on. Native plugins need `allowNative`, which the UI
     * only passes after the user confirmed they trust it with full access to their computer, and an
     * update that asks for more access needs `allowMore`, passed once they agreed to that.
     */
    async install(id: string, options: { allowNative?: boolean; allowMore?: boolean; } = {}) {
        if (Store.pluginAction(id) === "pulled") return { ok: false, error: t("op.pulled") } as StoreResult;
        const updating = !!state.installed[id];
        // Switched on before it arrives, so it starts however main's announcement and its answer are
        // ordered (and on the next start of Discord, if neither reaches this page)
        const wasOn = Settings.data.plugins[id]?.enabled;
        if (!updating) Settings.update(d => void ((d.plugins[id] ??= {}).enabled = true));
        const result = await run("plugin", id, t("op.starting"), () => Native.storeInstall(id, options));
        if (!result.ok) {
            if (!updating) Settings.update(d => {
                const entry = d.plugins[id];
                if (!entry) return;
                if (wasOn === undefined) delete entry.enabled;
                else entry.enabled = wasOn;
            });
            return result;
        }

        set({ installed: { ...state.installed, [id]: { id, version: result.version, fromStore: true } } });
        if (updating) {
            setOp("plugin", id, { type: "done", message: t("op.updatedTo", { version: result.version }) });
            return result;
        }
        const plugin = await PluginManager.whenLoaded(id);
        if (plugin) await PluginManager.setEnabled(id, true);
        setOp("plugin", id, { type: "done", message: installedMessage(plugin) });
        return result;
    },

    async uninstall(id: string) {
        const result = await run("plugin", id, t("op.removing"), () => Native.storeUninstall(id));
        if (!result.ok) return result;

        const installed = { ...state.installed };
        delete installed[id];
        set({ installed });
        setOp("plugin", id, { type: "done", message: t("op.uninstalled") });
        return result;
    },

    /** Installs or updates a theme; a new one is turned on straight away */
    async installTheme(id: string) {
        const updating = !!state.installedThemes[id];
        const result = await run("theme", id, t("op.starting"), () => Native.storeInstallTheme(id));
        if (!result.ok) return result;

        const file = `${id}.css`;
        set({ installedThemes: { ...state.installedThemes, [id]: { id, version: result.version, file, fromStore: true } } });
        if (!updating) Themes.setEnabled(file, true);
        setOp("theme", id, { type: "done", message: updating ? t("op.updatedTo", { version: result.version }) : t("op.installedOn") });
        return result;
    },

    async uninstallTheme(id: string) {
        const file = state.installedThemes[id]?.file;
        const result = await run("theme", id, t("op.removing"), () => Native.storeUninstallTheme(id));
        if (!result.ok) return result;

        const installedThemes = { ...state.installedThemes };
        delete installedThemes[id];
        set({ installedThemes });
        // Don't leave a dangling "on" behind for a file that's gone
        if (file && Themes.isEnabled(file)) Themes.setEnabled(file, false);
        setOp("theme", id, { type: "done", message: t("op.uninstalled") });
        return result;
    },

    /**
     * Everything with an update, one at a time. Full-access plugins only with `includeNative`, updates
     * that ask for more access only with `includeMoreAccess`.
     */
    async updateAll(kind: StoreKind, { includeNative = false, includeMoreAccess = false } = {}): Promise<UpdateAllResult> {
        const result: UpdateAllResult = { updated: [], failed: [], skippedNative: [], skippedMoreAccess: [] };
        if (state.updatingAll) return result;
        set({ updatingAll: kind });
        try {
            if (kind === "plugin") {
                for (const entry of state.plugins) {
                    if (Store.pluginAction(entry.id) !== "update") continue;
                    if (entry.native && !includeNative) {
                        result.skippedNative.push(entry.name);
                        continue;
                    }
                    const more = !!Store.growthOf(entry.id);
                    if (more && !includeMoreAccess) {
                        result.skippedMoreAccess.push(entry.name);
                        continue;
                    }
                    const r = await Store.install(entry.id, { allowNative: entry.native, allowMore: more });
                    (r.ok ? result.updated : result.failed).push(entry.name);
                }
            } else {
                for (const entry of state.themes) {
                    if (Store.themeAction(entry.id) !== "update") continue;
                    const r = await Store.installTheme(entry.id);
                    (r.ok ? result.updated : result.failed).push(entry.name);
                }
            }
        } finally {
            set({ updatingAll: undefined });
        }
        return result;
    },

    /** Checks the store and quietly installs updates, saying what changed in a toast */
    async autoUpdate() {
        if (!Settings.data.autoUpdate || SafeMode.active) return;
        await Store.refresh();
        if (state.status !== "ready") return;

        const plugins = await Store.updateAll("plugin");
        const themes = await Store.updateAll("theme");
        const updated = [...plugins.updated, ...themes.updated];
        if (updated.length) {
            logger.info(`Auto-updated ${updated.join(", ")}`);
            showToast(updated.length === 1 ? t("toast.autoUpdatedOne", { name: updated[0] }) : t("toast.autoUpdatedMany", { count: updated.length }), { type: "success" });
        }
        if (plugins.skippedNative.length) {
            showToast(t("toast.nativeWaiting", { names: plugins.skippedNative.join(", "), count: plugins.skippedNative.length }), { duration: 6000 });
        }
        if (plugins.skippedMoreAccess.length) {
            showToast(t("toast.moreAccessWaiting", { names: plugins.skippedMoreAccess.join(", "), count: plugins.skippedMoreAccess.length }), { duration: 6000 });
        }
    },

    /** Runs auto-update now (after startup settles) and every few hours while it's on */
    scheduleAutoUpdate(delay = 20_000) {
        clearInterval(autoTimer);
        autoTimer = undefined;
        if (!Settings.data.autoUpdate) return;
        setTimeout(() => void Store.autoUpdate(), delay);
        autoTimer = setInterval(() => void Store.autoUpdate(), AUTO_UPDATE_EVERY);
    },

    setAutoUpdate(on: boolean) {
        Settings.update(d => {
            d.autoUpdate = on;
        });
        Store.scheduleAutoUpdate(1000);
    },

    /** A screenshot from the registry as a data URL, or null when it can't be shown */
    image(url: string) {
        let pending = images.get(url);
        // Last seen goes last: the ones dropped are the ones longest unseen
        if (pending) images.delete(url);
        else {
            pending = (Native.storeImage?.(url) ?? Promise.resolve({ ok: false as const, error: t("common.notSupported") }))
                .then(r => r.ok ? r.dataUrl : null, () => null);
            const settled = pending;
            settled.then(r => r === null && images.get(url) === settled && images.delete(url));
            // Data URLs, often hundreds of KB each: only the latest few dozen are kept
            if (images.size >= MAX_IMAGES) images.delete(images.keys().next().value!);
        }
        images.set(url, pending);
        return pending;
    },

    /**
     * A store preview (video or GIF) as a blob: URL the page can play, or null when it can't be had.
     * Discord's page can't reach evi.rest or an author's host itself: main downloads it.
     */
    previewMedia(url: string) {
        let pending = media.get(url);
        if (!pending) {
            pending = (Native.storePreviewMedia?.(url) ?? Promise.resolve({ ok: false as const, error: t("common.notSupported") }))
                .then(r => r.ok ? { url: URL.createObjectURL(new Blob([r.bytes as Uint8Array<ArrayBuffer>], { type: r.mime })), video: r.mime.startsWith("video/") } : null, () => null);
            // Big: only the latest few are kept
            if (media.size >= 4) {
                const [oldest] = media;
                media.delete(oldest[0]);
                void oldest[1].then(m => m && URL.revokeObjectURL(m.url));
            }
            media.set(url, pending);
            pending.then(r => r === null && media.delete(url));
        }
        return pending;
    },

    getSnapshot: () => state,

    subscribe(listener: () => void) {
        listeners.add(listener);
        return () => void listeners.delete(listener);
    },
};
