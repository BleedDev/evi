/**
 * What Evi's Developers page may ask evi.rest's admin API for, and the answers as it reads them.
 * evi.rest answers an Evi linked to an admin (server/src/app.ts); main also checks every call
 * against this list, so nothing else in Discord's page can use the bridge for other routes.
 * Anything malformed in an answer is dropped or becomes empty.
 */

export type AdminMethod = "GET" | "POST" | "PUT" | "DELETE";

const ID = "\\d{1,15}";
const PLUGIN = "[a-z0-9][a-z0-9-]{0,63}";
const STATUS = "(?:\\?status=[a-z]{1,16})?";
const USER = "\\d{17,20}";
/** Badge ids are like plugin ids (badges.ts checks them the same way) */
const BADGE = PLUGIN;

/** Paths relative to /v1, query included */
const ROUTES: [AdminMethod, RegExp][] = [
    ["GET", /^\/admin\/(?:stats|pulls|hotfixes|announcements|collections|health)$/],
    ["GET", /^\/admin\/people\?page=\d{1,6}&size=\d{1,3}(?:&q=[^&#]{0,200})?$/],
    ["GET", /^\/admin\/badges$/],
    ["GET", new RegExp(`^/admin/users/${USER}$`)],
    ["PUT", new RegExp(`^/admin/users/${USER}/ban$`)],
    ["DELETE", new RegExp(`^/admin/users/${USER}/ban$`)],
    ["PUT", new RegExp(`^/admin/users/${USER}/badges/${BADGE}$`)],
    ["DELETE", new RegExp(`^/admin/users/${USER}/badges/${BADGE}$`)],
    ["PUT", new RegExp(`^/admin/badges/${BADGE}(?:/icon)?$`)],
    ["DELETE", new RegExp(`^/admin/badges/${BADGE}$`)],
    ["PUT", new RegExp(`^/admin/supporters/${USER}$`)],
    ["DELETE", new RegExp(`^/admin/supporters/${USER}$`)],
    ["POST", new RegExp(`^/admin/supporters/${USER}/time$`)],
    ["GET", new RegExp(`^/admin/(?:submissions|theme-submissions|reports|reviews)${STATUS}$`)],
    ["GET", new RegExp(`^/admin/theme-submissions/${ID}/preview$`)],
    ["POST", new RegExp(`^/admin/(?:submissions|theme-submissions)/${ID}/(?:approve|reject)$`)],
    ["POST", new RegExp(`^/admin/reports/${ID}/(?:resolve|dismiss)$`)],
    ["POST", new RegExp(`^/admin/reviews/${ID}/(?:hide|restore)$`)],
    ["POST", /^\/admin\/announcements$/],
    ["DELETE", new RegExp(`^/admin/announcements/${ID}$`)],
    ["POST", new RegExp(`^/admin/plugins/${PLUGIN}/pull$`)],
    ["DELETE", new RegExp(`^/admin/plugins/${PLUGIN}/pull(?:\\?version=[\\w.+-]{1,32})?$`)],
    ["DELETE", new RegExp(`^/admin/hotfixes/${ID}$`)],
    ["GET", /^\/admin\/required-version$/],
    ["PUT", /^\/admin\/required-version$/],
    ["DELETE", /^\/admin\/required-version$/],
];

export function isAdminRoute(method: unknown, path: unknown): method is AdminMethod {
    return typeof method === "string" && typeof path === "string" && path.length <= 300
        && ROUTES.some(([m, re]) => m === method && re.test(path));
}

const n = (v: unknown) => typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0;
const s = (v: unknown, max = 500) => typeof v === "string" ? v.slice(0, max) : "";
const opt = (v: unknown, max = 500) => typeof v === "string" && v ? v.slice(0, max) : undefined;
const strings = (v: unknown, max = 50) => Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, max).map(x => x.slice(0, 200)) : [];
const list = (raw: unknown, key: string) => {
    const v = (raw as Record<string, unknown> | null)?.[key];
    return Array.isArray(v) ? v.filter(x => x && typeof x === "object") as Record<string, any>[] : [];
};

export interface AdminUser {
    id: string;
    name: string;
    username?: string;
    avatar?: string;
}

function user(raw: any): AdminUser | undefined {
    if (!raw || typeof raw !== "object" || typeof raw.id !== "string") return;
    const username = opt(raw.username, 64);
    return { id: raw.id.slice(0, 32), name: opt(raw.globalName, 64) ?? opt(raw.name, 64) ?? username ?? raw.id.slice(0, 32), username, avatar: opt(raw.avatar, 64) };
}

/** What reading a plugin's code found, the parts a reviewer looks at first */
export interface ScanSummary {
    patches: number;
    domains: string[];
    /** eval, new Function, import(): code it builds as it runs */
    dynamicCode: string[];
    clipboardRead: boolean;
    stores: number;
}

function scan(raw: any): ScanSummary | undefined {
    if (!raw || typeof raw !== "object") return;
    return {
        patches: n(raw.patchCount) || (Array.isArray(raw.patchFinds) ? raw.patchFinds.length : 0),
        domains: strings(raw.domains, 20),
        dynamicCode: strings(raw.dynamicCode, 10),
        clipboardRead: raw.clipboardRead === true,
        stores: Array.isArray(raw.stores) ? raw.stores.length : 0,
    };
}

export interface Submission {
    id: number;
    kind: "plugin" | "theme";
    /** Plugin or theme id */
    item: string;
    name: string;
    version: string;
    /** The version in the store now; none for something new */
    published?: string;
    beta: boolean;
    author: string;
    createdAt: number;
    /** index.js, or the theme's CSS, as much as evi.rest shows */
    code: string;
    codeTruncated: boolean;
    /** Plugins with native.js run it with full access */
    nativeCode?: string;
    scan?: ScanSummary;
    nativeScan?: ScanSummary;
    /** Themes: every host its CSS names, and whether a theme may load from it */
    hosts: { host: string; allowed: boolean; }[];
}

const hosts = (v: any) => (Array.isArray(v?.hosts) ? v.hosts : []).filter((h: any) => typeof h?.host === "string")
    .slice(0, 30).map((h: any) => ({ host: s(h.host, 200), allowed: h.allowed === true }));

export function parseSubmissions(raw: unknown, kind: "plugin" | "theme"): Submission[] {
    return list(raw, "submissions").filter(r => Number.isInteger(r.id) && r.status === "pending").map(r => ({
        id: r.id,
        kind,
        item: s(kind === "plugin" ? r.plugin : r.theme, 64),
        name: s(r.name, 100) || s(kind === "plugin" ? r.plugin : r.theme, 64),
        version: s(r.version, 32),
        published: opt(r.published, 32),
        beta: r.channel === "beta",
        author: s(r.author?.name, 64) || s(r.author?.slug, 64),
        createdAt: n(r.createdAt),
        code: s(kind === "plugin" ? r.code : r.css, 2_000_000),
        codeTruncated: r.codeTruncated === true,
        nativeCode: kind === "plugin" && typeof r.nativeCode === "string" ? r.nativeCode.slice(0, 2_000_000) : undefined,
        scan: kind === "plugin" ? scan(r.scan) : undefined,
        nativeScan: kind === "plugin" ? scan(r.nativeScan) : undefined,
        hosts: kind === "theme" ? hosts(r.scan) : [],
    }));
}

export interface PluginReport {
    id: number;
    plugin: string;
    kind: "plugin" | "theme";
    version?: string;
    reason: string;
    details: string;
    reporter?: AdminUser;
    /** Open reports about the same plugin, this one included */
    openForPlugin: number;
    createdAt: number;
}

export function parseReports(raw: unknown): PluginReport[] {
    return list(raw, "reports").filter(r => /^\d{1,15}$/.test(String(r.id)) && r.status === "open").map(r => ({
        id: Number(r.id),
        plugin: s(r.plugin, 64),
        kind: r.kind === "theme" ? "theme" : "plugin",
        version: opt(r.version, 32),
        reason: s(r.reason, 64),
        details: s(r.details, 2000),
        reporter: user(r.reporter),
        openForPlugin: n(r.openForPlugin),
        createdAt: n(r.createdAt),
    }));
}

export interface ReportedReview {
    id: number;
    plugin: string;
    rating: number;
    body: string;
    user?: AdminUser;
    reports: number;
    hidden: boolean;
    createdAt: number;
}

export function parseReviews(raw: unknown): ReportedReview[] {
    return list(raw, "reviews").filter(r => Number.isInteger(r.id)).map(r => ({
        id: r.id,
        plugin: s(r.plugin, 64),
        rating: Math.min(5, Math.round(n(r.rating))),
        body: s(r.body, 2000),
        user: user(r.user),
        reports: n(r.reports),
        hidden: r.status !== "visible",
        createdAt: n(r.createdAt),
    }));
}

/** A ban on an evi.rest account (server/src/bans.ts); `until` undefined is for good */
export interface Ban {
    reason: string;
    until?: number;
    at: number;
    by?: AdminUser;
}

function ban(raw: any): Ban | undefined {
    if (!raw || typeof raw !== "object") return;
    return {
        reason: s(raw.reason, 500),
        until: typeof raw.until === "number" ? raw.until : undefined,
        at: n(raw.at),
        by: typeof raw.by === "string" ? { id: raw.by.slice(0, 32), name: raw.by.slice(0, 32) } : user(raw.by),
    };
}

export interface Person {
    user: AdminUser;
    createdAt: number;
    lastLogin: number;
    /** Evis linked to the account */
    installs: number;
    /** Badge ids in the order they arranged them, their supporter level among them */
    badges: string[];
    admin: boolean;
    banned?: Ban;
}

export interface PeoplePage {
    people: Person[];
    total: number;
    page: number;
    size: number;
}

export function parsePeople(raw: unknown): PeoplePage {
    const r = raw as Record<string, unknown> | null;
    return {
        people: list(raw, "people").flatMap(p => {
            const u = user(p.user);
            return u ? [{
                user: u,
                createdAt: n(p.createdAt),
                lastLogin: n(p.lastLogin),
                installs: n(p.installs),
                badges: strings(p.badges, 30),
                admin: p.admin === true,
                banned: ban(p.banned),
            }] : [];
        }),
        total: n(r?.total),
        page: Math.max(1, n(r?.page)),
        size: Math.max(1, n(r?.size) || 25),
    };
}

/** A badge evi.rest can give (GET /admin/badges) */
export interface AdminBadge {
    id: string;
    name: string;
    description: string;
    /** Empty until an icon is uploaded: then it doesn't show to anyone */
    icon: string;
    holders: number;
    /** A supporter level: held by supporter time, not given by hand */
    supporter: boolean;
    /** Given by evi.rest itself (Plugin Author) */
    automatic: boolean;
}

/** Badge icons come from evi.rest itself, over https (a local test server is plain http), or inline as an image */
const iconUrl = (v: unknown) => typeof v === "string" && (/^https:\/\//.test(v) || /^http:\/\/(?:localhost|127\.0\.0\.1)[:/]/.test(v) || /^data:image\/(?:png|gif|webp|jpeg|svg\+xml)[;,]/.test(v))
    ? v.slice(0, 20_000)
    : "";

export function parseAdminBadges(raw: unknown): AdminBadge[] {
    return list(raw, "badges").filter(b => typeof b.id === "string").map(b => ({
        id: s(b.id, 64),
        name: s(b.name, 100) || s(b.id, 64),
        description: s(b.description, 300),
        icon: iconUrl(b.icon),
        holders: n(b.holders),
        supporter: b.supporter === true,
        automatic: b.automatic === true,
    }));
}

export interface PersonDetail {
    user: AdminUser;
    createdAt: number;
    lastLogin: number;
    logins: number;
    installs: number;
    admin: boolean;
    /** Badges given by hand (or by evi.rest), in their order; supporter levels are in `supporter` */
    badges: { id: string; position: number; grantedAt: number; }[];
    supporter?: { level: string; since: number; days: number; startedAt: number; grantedDays: number; next?: { level: string; at: number; }; };
    author?: { slug: string; name: string; plugins: { id: string; name: string; }[]; };
    banned?: Ban;
    banLog: (Ban & { action: "ban" | "unban"; })[];
}

export function parsePersonDetail(raw: unknown): PersonDetail | undefined {
    const r = raw as Record<string, any> | null;
    const u = user(r?.user);
    if (!r || !u) return;
    const sup = r.supporter && typeof r.supporter === "object" ? r.supporter : undefined;
    const auth = r.author && typeof r.author === "object" && typeof r.author.slug === "string" ? r.author : undefined;
    return {
        user: u,
        createdAt: n(r.createdAt),
        lastLogin: n(r.lastLogin),
        logins: n(r.logins),
        installs: n(r.installs),
        admin: r.admin === true,
        badges: list(r, "badges").filter(b => typeof b.id === "string").slice(0, 50).map(b => ({ id: s(b.id, 64), position: n(b.position), grantedAt: n(b.grantedAt) })),
        supporter: sup ? {
            level: s(sup.level, 64),
            since: n(sup.since),
            days: n(sup.days),
            startedAt: n(sup.startedAt),
            grantedDays: typeof sup.grantedDays === "number" && Number.isFinite(sup.grantedDays) ? sup.grantedDays : 0,
            next: sup.next && typeof sup.next.level === "string" ? { level: s(sup.next.level, 64), at: n(sup.next.at) } : undefined,
        } : undefined,
        author: auth ? {
            slug: s(auth.slug, 64),
            name: s(auth.name, 100) || s(auth.slug, 64),
            plugins: (Array.isArray(auth.plugins) ? auth.plugins : []).filter((p: any) => typeof p?.id === "string").slice(0, 100).map((p: any) => ({ id: s(p.id, 64), name: s(p.name, 100) || s(p.id, 64) })),
        } : undefined,
        banned: ban(r.banned),
        banLog: list(r, "banLog").slice(0, 50).flatMap(l => {
            const b = ban(l);
            return b && (l.action === "ban" || l.action === "unban") ? [{ ...b, action: l.action as "ban" | "unban" }] : [];
        }),
    };
}

export interface SentAnnouncement {
    id: number;
    title: string;
    body: string;
    link?: string;
    at: number;
    withdrawnAt?: number;
    by?: AdminUser;
}

export function parseSentAnnouncements(raw: unknown): SentAnnouncement[] {
    return list(raw, "announcements").filter(r => Number.isInteger(r.id)).map(r => ({
        id: r.id,
        title: s(r.title, 200),
        body: s(r.body, 2000),
        link: opt(r.link, 2000),
        at: n(r.at),
        withdrawnAt: typeof r.withdrawnAt === "number" ? r.withdrawnAt : undefined,
        by: user(r.by),
    }));
}

export interface PluginHealth {
    id: string;
    name: string;
    /** Installs that sent a health report lately */
    installsReporting: number;
    /** Of them, how many have patches that don't find their place in Discord */
    brokenPatches: number;
    lastReportAt?: number;
}

export interface Pull {
    plugin: string;
    versions: string[] | "all";
    reason: string;
    removed: boolean;
    at: number;
}

export interface Health {
    plugins: PluginHealth[];
    pulls: Pull[];
}

function pulls(raw: unknown): Pull[] {
    // Either { pulled: { id: {...} } } (GET /admin/pulls) or a list
    const map = (raw as any)?.pulled ?? raw;
    const entries: [string, any][] = Array.isArray(map) ? map.map((p: any) => [p?.plugin ?? p?.id, p]) : map && typeof map === "object" ? Object.entries(map) : [];
    return entries.filter(([id, p]) => typeof id === "string" && p && typeof p === "object").map(([id, p]) => ({
        plugin: id.slice(0, 64),
        versions: p.versions === "all" ? "all" : strings(p.versions, 50),
        reason: s(p.reason, 500),
        removed: p.removed === true,
        at: n(p.at),
    }));
}

export function parseHealth(raw: unknown): Health {
    return {
        plugins: list(raw, "plugins").filter(p => typeof p.id === "string").map(p => ({
            id: s(p.id, 64),
            name: s(p.name, 100) || s(p.id, 64),
            installsReporting: n(p.installsReporting),
            brokenPatches: n(p.brokenPatches),
            lastReportAt: typeof p.lastReportAt === "number" ? p.lastReportAt : undefined,
        })),
        pulls: pulls((raw as any)?.pulls),
    };
}
