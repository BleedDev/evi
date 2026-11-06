/**
 * Plugin authors, live plugin health, pulled plugins and the reports an install can send, for the
 * renderer.
 *
 * Authors and health are read-only lists from evi.rest, cached on disk (with their ETag) so the
 * store shows them from the first frame and keeps them while the server is down. Health also
 * carries the kill switch (shared/pulls.ts): the copy on disk is what keeps a pulled plugin off at
 * the next start, even offline, and health is asked for again every half hour so a pull reaches
 * running installs too. The reports are fixed shapes checked here before they leave: a crash report
 * the user chose to send to a plugin's author, "this store plugin can't find parts of Discord" (the
 * plugin, its version, Discord's build and the kind of problem, nothing else), and a store plugin
 * reported to Evi's team.
 *
 * Evi's hotfixes for broken plugins (shared/hotfixes.ts) are one more cached list: asked for as soon
 * as Discord starts, so the page usually boots with the fresh one, and handed to the page from disk
 * when evi.rest is slow or down.
 *
 * Plugins run in the same page as the buttons that send these, so main checks what it can itself:
 * crash and health reports only for a plugin the store installed here, at the version reported, and
 * a handful of plugin reports an hour, so no plugin can use every install to flood evi.rest.
 */
import { parseAuthors } from "@shared/authors";
import { parseClashes } from "@shared/clashes";
import { validateCrashReport } from "@shared/crashReports";
import { parseHealth, parseSunsets, validateHealthReport } from "@shared/health";
import { Hotfix, parseHotfixes } from "@shared/hotfixes";
import { AuthorsResult, CrashReportResult, HealthReportResult, HealthResult, IPC, PluginReportResult } from "@shared/ipc";
import { validatePluginReport } from "@shared/pluginReports";
import { parsePulled, PulledPlugins } from "@shared/pulls";
import { STORE_MARKER } from "@shared/store";
import { app, ipcMain } from "electron";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import { join } from "path";

import { onHotfixesAnnounced, onPullsAnnounced } from "./badges";
import { apiRequest, apiUrl } from "./evirest";
import { mt } from "./locale";
import { DATA_DIR, PLUGINS_DIR } from "./paths";
import { broadcast, rateLimit, sleep } from "./util";

const CACHE_DIR = join(DATA_DIR, "cache");

interface Cache {
    etag: string | null;
    /** As the server sent it; cleaned each time it's handed out */
    json: unknown;
}

/**
 * A GET that remembers its answer on disk: asks with If-None-Match, falls back to the saved copy
 * when the server can't be reached. One request at a time; everyone asking meanwhile shares it.
 * `saved()` is the copy on disk as it is, without asking the server.
 */
export function cachedGet<T>(file: string, path: string, parse: (json: unknown) => T) {
    const cacheFile = join(CACHE_DIR, file);
    let cache: Cache | undefined;
    let pending: Promise<{ ok: true; value: T; } | { ok: false; error: string; }> | undefined;

    function readCache(): Cache | undefined {
        try {
            const saved = JSON.parse(readFileSync(cacheFile, "utf8"));
            return { etag: typeof saved?.etag === "string" ? saved.etag : null, json: saved?.json };
        } catch {
            return undefined;
        }
    }

    function writeCache(next: Cache) {
        try {
            mkdirSync(CACHE_DIR, { recursive: true });
            writeFileSync(cacheFile + ".tmp", JSON.stringify(next));
            renameSync(cacheFile + ".tmp", cacheFile);
        } catch (err) {
            console.warn(`[Evi] Reports: couldn't write ${file}`, err);
        }
    }

    async function refresh() {
        cache ??= readCache();
        try {
            const res = await apiRequest("GET", path, { headers: cache?.etag ? { "If-None-Match": cache.etag } : {}, max: 2 * 1024 * 1024 });
            if (res.status !== 304) {
                cache = { etag: res.etag, json: res.json };
                writeCache(cache);
            }
        } catch (err) {
            if (!cache) return { ok: false as const, error: (err as Error).message };
            console.warn(`[Evi] Reports: using the cached ${path},`, (err as Error).message);
        }
        return { ok: true as const, value: parse(cache!.json) };
    }

    const get = () => (pending ??= refresh().finally(() => void (pending = undefined)));
    return Object.assign(get, { saved: () => parse((cache ??= readCache())?.json) });
}

const authors = cachedGet("authors.json", "/authors", parseAuthors);

/** Authors' banners as evi.rest listed them: the only banners the store downloads */
export function authorBanners(): Set<string> {
    return new Set(Object.values(authors.saved()).flatMap(a => a.banner ? [a.banner] : []));
}

const health = cachedGet("health.json", "/health", json => ({ plugins: parseHealth(json), pulled: parsePulled(json), sunset: parseSunsets(json), clashes: parseClashes((json as { clashes?: unknown; } | null)?.clashes) }));

async function getAuthors(): Promise<AuthorsResult> {
    const result = await authors();
    return result.ok ? { ok: true, authors: result.value, site: new URL(apiUrl()).origin } : result;
}

async function getHealth(): Promise<HealthResult> {
    const result = await health();
    if (!result.ok) return result;
    updatePulls(result.value.pulled);
    return { ok: true, ...result.value };
}

const PULLS_EVERY = 30 * 60 * 1000;
/** After startup settles: until then the copy on disk covers it */
const PULLS_FIRST_AFTER = 15_000;

let pulls: PulledPlugins | undefined;
const pullListeners = new Set<(pulled: PulledPlugins) => void>();

/** Pulled plugins as evi.rest last said, from the copy on disk until it answers */
export function currentPulls(): PulledPlugins {
    return (pulls ??= health.saved().pulled);
}

/** For main's own part of a pull (native modules); pages hear about it through PULLS_CHANGED */
export function onPullsChange(listener: (pulled: PulledPlugins) => void) {
    pullListeners.add(listener);
}

function updatePulls(next: PulledPlugins) {
    const before = currentPulls();
    pulls = next;
    if (JSON.stringify(before) === JSON.stringify(next)) return;
    console.log(`[Evi] Reports: pulled plugins are now ${Object.keys(next).join(", ") || "none"}`);
    for (const listener of pullListeners) listener(next);
    broadcast(IPC.PULLS_CHANGED, next);
}

const hotfixes = cachedGet("hotfixes.json", "/hotfixes", parseHotfixes);
let hotfixList: Hotfix[] | undefined;

/** Evi's hotfixes as evi.rest last said, from the copy on disk until it answers */
export function currentHotfixes(): Hotfix[] {
    return (hotfixList ??= hotfixes.saved());
}

/** Asks evi.rest, and tells every Discord window when the list changed */
async function refreshHotfixes() {
    const result = await hotfixes();
    if (!result.ok) return;
    const before = currentHotfixes();
    hotfixList = result.value;
    if (JSON.stringify(before) === JSON.stringify(result.value)) return;
    console.log(`[Evi] Reports: hotfixes for ${[...new Set(result.value.map(h => h.plugin))].join(", ") || "no plugins"}`);
    broadcast(IPC.HOTFIXES_CHANGED, result.value);
}

/**
 * Whether the store installed this plugin here, at exactly this version: its marker in the plugins
 * folder says so. (Read here rather than through store.ts, which already depends on this file.)
 */
function installedFromStore(id: string, version: string) {
    try {
        const marker = JSON.parse(readFileSync(join(PLUGINS_DIR, id, STORE_MARKER), "utf8"));
        return marker?.id === id && marker.version === version;
    } catch {
        return false;
    }
}

const NOT_FROM_STORE = "That plugin isn't installed from the store";

async function sendCrashReport(input: unknown): Promise<CrashReportResult> {
    const checked = validateCrashReport(input);
    if ("error" in checked) return { ok: false, error: checked.error };
    if (!installedFromStore(checked.report.plugin, checked.report.version)) return { ok: false, error: NOT_FROM_STORE };
    try {
        const { json } = await apiRequest("POST", "/crash-reports", { headers: { "Content-Type": "application/json" }, body: JSON.stringify(checked.report) });
        return { ok: true, ...(typeof json?.author === "string" && json.author && { author: json.author.slice(0, 80) }) };
    } catch (err) {
        console.warn(`[Evi] Reports: couldn't send the crash report for ${checked.report.plugin}`, err);
        return { ok: false, error: (err as Error).message };
    }
}

async function reportHealth(input: unknown): Promise<HealthReportResult> {
    const checked = validateHealthReport(input);
    if ("error" in checked) return { ok: false, error: checked.error };
    if (!installedFromStore(checked.report.plugin, checked.report.version)) return { ok: false, error: NOT_FROM_STORE };
    try {
        // The version lets evi.rest set aside patch reports from Evis that counted optional patches (see health.ts there)
        await apiRequest("POST", "/health/reports", { headers: { "Content-Type": "application/json", "X-Evi-Version": EVI_VERSION }, body: JSON.stringify(checked.report) });
        return { ok: true };
    } catch (err) {
        return { ok: false, error: (err as Error).message };
    }
}

/** A person reports a plugin now and then, not five an hour */
const reportAllowed = rateLimit(5, 60 * 60 * 1000);

/**
 * A store plugin reported to Evi's team. Any plugin in the registry, installed or not. The server's
 * refusals ("You already reported this plugin…") are shown as they are.
 */
async function reportPlugin(id: unknown, input: unknown): Promise<PluginReportResult> {
    const checked = validatePluginReport(id, input, mt);
    if ("error" in checked) return { ok: false, error: checked.error };
    if (!reportAllowed()) return { ok: false, error: mt("main.rate.reportsSent") };
    const { plugin, ...report } = checked.report;
    try {
        await apiRequest("POST", `/plugins/${plugin}/reports`, { headers: { "Content-Type": "application/json" }, body: JSON.stringify(report) });
        return { ok: true };
    } catch (err) {
        console.warn(`[Evi] Reports: couldn't report ${plugin},`, (err as Error).message);
        return { ok: false, error: (err as Error).message };
    }
}

export function initReports() {
    ipcMain.handle(IPC.AUTHORS_GET, () => getAuthors());
    ipcMain.handle(IPC.HEALTH_GET, () => getHealth());
    ipcMain.handle(IPC.CRASH_REPORT_SEND, (_, input: unknown) => sendCrashReport(input));
    ipcMain.handle(IPC.HEALTH_REPORT, (_, input: unknown) => reportHealth(input));
    ipcMain.handle(IPC.PLUGIN_REPORT, (_, id: unknown, input: unknown) => reportPlugin(id, input));

    // Asked for even when nobody opens the store: it's how a pull reaches a running install
    void app.whenReady().then(() => {
        setTimeout(() => void getHealth(), PULLS_FIRST_AFTER);
        setInterval(() => void getHealth(), PULLS_EVERY);
        // evi.rest says so the moment a plugin is pulled: asked for within a few seconds, spread out so
        // every install doesn't ask in the same instant
        onPullsAnnounced(() => void sleep(Math.random() * 5000).then(() => getHealth()));

        // Right away, not after startup settles: a fix that's here before the page boots applies as
        // Discord's modules first load, with nothing to re-run
        void refreshHotfixes();
        setInterval(() => void refreshHotfixes(), PULLS_EVERY);
        onHotfixesAnnounced(() => void sleep(Math.random() * 5000).then(() => refreshHotfixes()));
    });
}
