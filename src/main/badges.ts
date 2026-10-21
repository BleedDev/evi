/**
 * Badges for the renderer: the list from evi.rest with every icon turned into a data: URL (Discord's
 * page can't load images from other hosts), cached on disk so badges show from the first frame even
 * when the server is slow or down.
 *
 * Live: while Discord is open, main listens on evi.rest's change stream and refetches the list the
 * moment it changes, then pushes it to the page. If the stream can't be had, the page still polls.
 *
 * Admin actions (the /badge command) need evi-admin.json in the data folder, { "token": "…" }. The
 * token stays in main: the page can only ask for one of a few fixed actions.
 */
import { BadgeAdminAction, BadgeAdminResult, BadgePrefs, BadgePrefsResult, BadgesDocument, BadgesResult, hasAnnouncementsEvent, hasHotfixesEvent, hasNotificationsEvent, hasPullsEvent, hasRequiredEvent, isDiscordId, parseBadgeEvents, parseBadges } from "@shared/badges";
import { imageDataUrl, imageType } from "@shared/images";
import { IPC } from "@shared/ipc";
import { isPluginId } from "@shared/store";
import { SUPPORTER_TIERS } from "@shared/supporter";
import { ipcMain, net, WebContents } from "electron";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import { join } from "path";

import { confirmWithUser } from "./confirm";
import { downloadHttps } from "./download";
import { apiRequest, apiUrl, getInstallId } from "./evirest";
import { DATA_DIR } from "./paths";
import { broadcast, sleep } from "./util";

const CACHE_FILE = join(DATA_DIR, "cache", "badges.json");
const ADMIN_FILE = join(DATA_DIR, "evi-admin.json");
const MAX_ICON_BYTES = 1024 * 1024;

interface Cache {
    etag: string | null;
    /** As the server sent it, https icons */
    doc: BadgesDocument;
    /** Icon URL -> data URL */
    icons: Record<string, string>;
}

let cache: Cache | undefined;
let pending: Promise<BadgesResult> | undefined;
let streaming = false;

function readCache(): Cache | undefined {
    try {
        const saved = JSON.parse(readFileSync(CACHE_FILE, "utf8"));
        const doc = parseBadges(saved?.doc);
        if (!doc) return;
        const icons: Record<string, string> = {};
        for (const [url, data] of Object.entries(saved.icons ?? {})) {
            if (typeof data === "string" && data.startsWith("data:image/")) icons[url] = data;
        }
        return { etag: typeof saved.etag === "string" ? saved.etag : null, doc, icons };
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
        console.warn("[Evi] Badges: couldn't write the cache", err);
    }
}

/** Icons only from the API's own host: the server hands out URLs to its uploads, nothing else */
function sameHost(url: string) {
    try {
        return new URL(url).host === new URL(apiUrl()).host;
    } catch {
        return false;
    }
}

/** A badge icon as a data URL, or why it couldn't be had */
async function iconData(url: string): Promise<{ data: string; } | { error: string; }> {
    const download = await downloadHttps(url, MAX_ICON_BYTES, { what: "The badge icon" });
    if (!download.ok) return { error: download.error };
    const data = imageDataUrl(download.body);
    return data ? { data } : { error: "not an image" };
}

async function fetchIcons(doc: BadgesDocument, known: Record<string, string>) {
    const icons: Record<string, string> = {};
    await Promise.all(Object.values(doc.badges).map(async ({ icon }) => {
        if (known[icon]) return void (icons[icon] = known[icon]);
        if (!sameHost(icon)) return;
        const result = await iconData(icon);
        if ("data" in result) icons[icon] = result.data;
        else console.warn(`[Evi] Badges: couldn't load ${icon}`, result.error);
    }));
    return icons;
}

/** Badge icons already turned into data URLs, by their evi.rest address */
const inlined = new Map<string, string>();
const BADGE_ICON = /^https?:\/\/[^/]+\/badges\/[\w.-]+\.(?:png|gif|webp|jpe?g)(?:\?v=\w+)?$/;

/**
 * Discord's page may only show images from Discord, so an evi.rest badge icon address shows as a
 * broken image there. Swaps every one found in an answer (the Developers page's people and badges)
 * for the image itself, the way the badges in Discord get theirs. Anything else is left as it is.
 */
export async function inlineBadgeIcons<T>(value: T): Promise<T> {
    const found = new Set<string>();
    const walk = (v: unknown) => {
        if (typeof v === "string") { if (BADGE_ICON.test(v) && sameHost(v)) found.add(v); }
        else if (Array.isArray(v)) v.forEach(walk);
        else if (v && typeof v === "object") Object.values(v).forEach(walk);
    };
    walk(value);
    await Promise.all([...found].filter(url => !inlined.has(url)).map(async url => {
        const result = await iconData(url);
        if ("data" in result) inlined.set(url, result.data);
    }));
    const swap = (v: unknown): unknown => {
        if (typeof v === "string") return inlined.get(v) ?? v;
        if (Array.isArray(v)) return v.map(swap);
        if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, swap(x)]));
        return v;
    };
    return found.size ? swap(value) as T : value;
}

/** The document with icons swapped for data URLs; badges whose icon failed are left out */
function forPage({ doc, icons }: Cache): BadgesResult {
    const badges: BadgesDocument["badges"] = {};
    for (const [id, b] of Object.entries(doc.badges)) if (icons[b.icon]) badges[id] = { ...b, icon: icons[b.icon] };
    const users: BadgesDocument["users"] = {};
    for (const [user, ids] of Object.entries(doc.users)) {
        const shown = ids.filter(id => id in badges);
        if (shown.length) users[user] = shown;
    }
    return { ok: true, badges, users, supporters: doc.supporters, prefs: doc.prefs };
}

async function refresh(): Promise<BadgesResult> {
    cache ??= readCache();
    try {
        const res = await apiRequest("GET", "/badges", { headers: cache?.etag ? { "If-None-Match": cache.etag } : {}, max: 4 * 1024 * 1024 });
        if (res.status !== 304) {
            const doc = parseBadges(res.json);
            if (!doc) throw new Error("The badges server sent something unexpected");
            const icons = await fetchIcons(doc, cache?.icons ?? {});
            cache = { etag: res.etag, doc, icons };
            writeCache(cache);
            broadcast(IPC.BADGES_CHANGED, forPage(cache));
        }
    } catch (err) {
        console.warn("[Evi] Badges: using the cached list,", (err as Error).message);
        if (!cache) return { ok: false, error: (err as Error).message };
    }
    return forPage(cache!);
}

/** One request at a time; everyone asking meanwhile gets the same answer */
function getBadges(cachedOnly = false): Promise<BadgesResult> {
    if (cachedOnly) {
        cache ??= readCache();
        if (cache) return Promise.resolve(forPage(cache));
    }
    pending ??= refresh().finally(() => void (pending = undefined));
    return pending;
}

/** Listeners for one kind of change stream event */
function signal() {
    const listeners = new Set<() => void>();
    return {
        on: (listener: () => void) => void listeners.add(listener),
        fire: () => listeners.forEach(listener => listener()),
    };
}

const pulls = signal();
const hotfixes = signal();
const inbox = signal();
const announcements = signal();
const required = signal();

/** Told when the stream says pulled plugins changed, and after it reconnects (one may have been missed) */
export const onPullsAnnounced = pulls.on;
/** Told when the stream says Evi's hotfixes changed, and after it reconnects */
export const onHotfixesAnnounced = hotfixes.on;
/** Told when the stream says this account's inbox changed, and after it reconnects */
export const onInboxAnnounced = inbox.on;
/** Told when an announcement from Evi's team was sent or withdrawn */
export const onAnnouncementsChanged = announcements.on;
/** Told when the required Evi version changed, and after the stream reconnects (it may have meanwhile) */
export const onRequiredChanged = required.on;

/** Everyone reconnects at once after a server restart: spread them out */
const jitter = (ms: number) => ms / 2 + Math.random() * ms;

/** One connection's life: resolves when it ends, after at least one event, or throws */
async function listen() {
    const res = await net.fetch(`${apiUrl()}/badges/events`, {
        // The version only feeds Evi's developers' numbers (who runs which Evi)
        headers: { "Accept": "text/event-stream", "X-Evi-Install": getInstallId(), "X-Evi-Version": EVI_VERSION },
        cache: "no-store",
    });
    if (!res.ok || !res.body) throw Object.assign(new Error(`The change stream answered ${res.status}`), { status: res.status });

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let lastData = Date.now();
    // Pings arrive every 25 s: a silent minute means the connection died without saying so
    const watchdog = setInterval(() => {
        if (Date.now() - lastData > 70_000) void reader.cancel();
    }, 10_000);
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) return;
            lastData = Date.now();
            buffer += decoder.decode(value, { stream: true });
            if (buffer.length > 64 * 1024) throw new Error("The change stream sent too much at once");
            const end = buffer.lastIndexOf("\n\n");
            if (end < 0) continue;
            const chunk = buffer.slice(0, end);
            if (hasPullsEvent(chunk)) pulls.fire();
            if (hasHotfixesEvent(chunk)) hotfixes.fire();
            if (hasNotificationsEvent(chunk)) inbox.fire();
            if (hasAnnouncementsEvent(chunk)) announcements.fire();
            if (hasRequiredEvent(chunk)) required.fire();
            const etags = parseBadgeEvents(chunk);
            buffer = buffer.slice(end + 2);
            const latest = etags.at(-1);
            // A change: fetch it after a moment, so thousands of installs don't all ask in the same instant
            // Cloudflare may hand the ETag on as a weak one (W/"…") after compressing
            if (latest && latest !== cache?.etag?.replace(/^W\//, "")) void sleep(Math.random() * 2000).then(() => getBadges());
        }
    } finally {
        clearInterval(watchdog);
    }
}

async function stream() {
    if (streaming) return;
    streaming = true;
    let failures = 0;
    while (true) {
        const opened = Date.now();
        try {
            await listen();
        } catch (err) {
            // No stream on this server (an older one): polling covers it, look again much later
            if ((err as { status?: number; }).status === 404) {
                await sleep(jitter(30 * 60 * 1000));
                continue;
            }
            console.warn("[Evi] Badges: change stream dropped,", (err as Error).message);
        }
        // A connection that lasted a while was healthy: start the backoff over
        failures = Date.now() - opened > 60_000 ? 0 : failures + 1;
        await sleep(jitter(Math.min(5_000 * 2 ** failures, 5 * 60 * 1000)));
        // Whatever changed while we were away
        void getBadges();
        pulls.fire();
        hotfixes.fire();
        inbox.fire();
        required.fire();
    }
}

function adminToken() {
    try {
        const { token } = JSON.parse(readFileSync(ADMIN_FILE, "utf8"));
        return typeof token === "string" && token.length >= 32 ? token : undefined;
    } catch {
        return undefined;
    }
}

/** What an admin action does, for the confirmation main shows before it runs */
function describeAdmin(input: BadgeAdminAction): string | undefined {
    switch (input?.action) {
        case "create": return `Create the badge "${input.name}" (${input.id})?`;
        case "delete": return `Delete the badge ${input.id} and take it off everyone?`;
        case "grant": return `Give the badge ${input.badgeId} to ${input.userId}?`;
        case "revoke": return `Take the badge ${input.badgeId} from ${input.userId}?`;
        case "supporter": return `Make ${input.userId} a supporter?`;
        case "time": return `${input.days > 0 ? "Give" : "Take"} ${Math.abs(input.days)} days of support ${input.days > 0 ? "to" : "from"} ${input.userId}?`;
        case "unsupport": return `Stop ${input.userId} being a supporter?`;
    }
}

async function admin(input: BadgeAdminAction, sender: WebContents): Promise<BadgeAdminResult> {
    const token = adminToken();
    if (!token) return { ok: false, error: "This install has no admin token (evi-admin.json in the data folder)" };
    // The token changes badges for everyone: every change is confirmed from main, where no plugin
    // running in the page can answer for you
    const question = describeAdmin(input);
    if (question && !await confirmWithUser(sender, { message: question, detail: "This changes Evi badges for everyone, with this install's admin token.", confirm: "Do it", pageSaid: true })) {
        return { ok: false, error: "Cancelled" };
    }
    const auth = { Authorization: `Bearer ${token}` };
    const call = (method: "GET" | "PUT" | "POST" | "DELETE", path: string, body?: unknown) =>
        apiRequest(method, `/admin${path}`, { headers: { ...auth, ...(body !== undefined && { "Content-Type": "application/json" }) }, body: body === undefined ? undefined : JSON.stringify(body) });

    const done = (message: string) => {
        // The next look at badges should see the change, not a cached copy
        if (cache) cache.etag = null;
        return { ok: true as const, message };
    };

    try {
        switch (input?.action) {
            case "list": {
                const { json } = await call("GET", "/badges");
                const rows = (json?.badges ?? []) as { id: string; name: string; icon: string; holders: number; }[];
                if (!rows.length) return { ok: true, message: "No badges yet. Make one with /badge create." };
                return { ok: true, message: rows.map(b => `**${b.name}** \`${b.id}\`: ${b.holders} ${b.holders === 1 ? "person" : "people"}${b.icon ? "" : ", no icon yet"}`).join("\n") };
            }
            case "create": {
                if (!isPluginId(input.id)) return { ok: false, error: "Badge ids are lowercase letters, digits and dashes, like early-supporter" };
                // Check the icon before anything is created, so a bad link leaves nothing half-made
                const download = await downloadHttps(input.iconUrl, MAX_ICON_BYTES, { what: "The icon" });
                if (!download.ok) return { ok: false, error: `Icon: ${download.error}` };
                if (!imageType(download.body)) return { ok: false, error: "The icon must be a PNG, JPEG, GIF or WebP image" };
                await call("PUT", `/badges/${input.id}`, { name: input.name, description: input.description ?? "" });
                await apiRequest("PUT", `/admin/badges/${input.id}/icon`, { headers: { ...auth, "Content-Type": "application/octet-stream" }, body: download.body });
                return done(`Badge **${input.name}** (\`${input.id}\`) is ready. Give it to someone with /badge grant.`);
            }
            case "delete": {
                if (!isPluginId(input.id)) return { ok: false, error: "Not a badge id" };
                await call("DELETE", `/badges/${input.id}`);
                return done(`Deleted \`${input.id}\` and took it off everyone.`);
            }
            case "grant":
            case "revoke": {
                if (!isDiscordId(input.userId)) return { ok: false, error: "Pick a user" };
                if (!isPluginId(input.badgeId)) return { ok: false, error: "Not a badge id" };
                await call(input.action === "grant" ? "PUT" : "DELETE", `/users/${input.userId}/badges/${input.badgeId}`);
                return done(input.action === "grant" ? `Gave \`${input.badgeId}\` to <@${input.userId}>.` : `Took \`${input.badgeId}\` from <@${input.userId}>.`);
            }
            case "supporter": {
                if (!isDiscordId(input.userId)) return { ok: false, error: "Pick a user" };
                const { json } = await call("PUT", `/supporters/${input.userId}`);
                return done(`<@${input.userId}> is a supporter: ${level(json?.level)}, ${json?.days ?? 0} days.`);
            }
            case "time": {
                if (!isDiscordId(input.userId)) return { ok: false, error: "Pick a user" };
                if (!Number.isSafeInteger(input.days) || !input.days) return { ok: false, error: "Days is a whole number, like 30 or -7" };
                const { json } = await call("POST", `/supporters/${input.userId}/time`, { days: input.days });
                return done(`${input.days > 0 ? "Gave" : "Took"} ${Math.abs(input.days)} days ${input.days > 0 ? "to" : "from"} <@${input.userId}>: ${level(json?.level)}, ${json?.days ?? 0} days.`);
            }
            case "unsupport": {
                if (!isDiscordId(input.userId)) return { ok: false, error: "Pick a user" };
                await call("DELETE", `/supporters/${input.userId}`);
                return done(`<@${input.userId}> isn't a supporter any more.`);
            }
            default:
                return { ok: false, error: "Unknown badge action" };
        }
    } catch (err) {
        return { ok: false, error: (err as Error).message };
    }
}

/** Your own arrangement, from Discord's badge settings; evi.rest checks this install is linked to that account */
async function setPrefs(userId: unknown, prefs: Partial<BadgePrefs> | undefined): Promise<BadgePrefsResult> {
    if (!isDiscordId(userId) || !prefs || typeof prefs !== "object") return { ok: false, error: "Nothing to save" };
    const body = {
        userId,
        ...(Array.isArray(prefs.order) && { order: prefs.order }),
        ...(Array.isArray(prefs.hidden) && { hidden: prefs.hidden }),
    };
    try {
        await apiRequest("PUT", "/me/badges", { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    } catch (err) {
        return { ok: false, error: (err as Error).message };
    }
    // The stream brings the new list too; this gets it here first
    if (cache) cache.etag = null;
    void getBadges();
    return { ok: true };
}

const level = (badge: unknown) => `**${SUPPORTER_TIERS.find(t => t.badge === badge)?.name ?? "Supporter"}**`;

export function initBadges() {
    ipcMain.handle(IPC.BADGES_GET, (_, cachedOnly: unknown) => {
        // Discord is showing badges: from now on, hear about changes as they happen
        void stream();
        return getBadges(cachedOnly === true);
    });
    ipcMain.handle(IPC.BADGES_ADMIN_AVAILABLE, () => !!adminToken());
    ipcMain.handle(IPC.BADGES_ADMIN, (e, input: BadgeAdminAction) => admin(input, e.sender));
    ipcMain.handle(IPC.BADGES_SET_PREFS, (_, userId: unknown, prefs: Partial<BadgePrefs>) => setPrefs(userId, prefs));
}
