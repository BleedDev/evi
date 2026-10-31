/**
 * An author's numbers (GET /v1/me/author/stats, server/src/authorStats.ts), as Evi's Author page
 * reads them. The same kind of numbers Evi's developers get on their page, for the author's own
 * plugins: counts per day, trouble per Discord build, ratings and reviews. Never which installs.
 * Anything malformed becomes zero or is left out.
 */
import { HealthProblem, parseProblems } from "./health";

export const AUTHOR_STATS_DAYS = { min: 7, max: 90, default: 30 } as const;

export interface AuthorBuildTrouble {
    /** Discord's build number */
    build: string;
    /** Installs that reported any trouble on this build, this week */
    installs: number;
    /** Of those: a lookup came back empty, a patch didn't apply, the plugin didn't start */
    lookups: number;
    patches: number;
    start: number;
}

export interface AuthorReview {
    id: number;
    rating: number;
    body: string;
    version: string;
    user: { id: string; name: string; avatar: string | null; };
    createdAt: number;
}

export interface AuthorPluginStats {
    id: string;
    name: string;
    version: string;
    /** In the store as someone else's, crediting this author after its owner */
    coAuthored: boolean;
    /** Installs that had it on, and had it at all, on the last finished day */
    activeNow: number;
    installedNow: number;
    /** Oldest first */
    history: { day: string; installed: number; active: number; }[];
    stars: number;
    rating: { average: number; count: number; counts: [number, number, number, number, number]; };
    /** Newest first, visible ones only */
    reviews: AuthorReview[];
    openReports: number;
    crashes: { unresolved: number; /** Crash rate of the newest version seen, 0–1, null while too few installs */ latestRate: number | null; };
    /** problems: what failed in the store's version this week, by how many installs, most first */
    health: { installsReporting: number; lastReportAt: number | null; state: string | null; builds: AuthorBuildTrouble[]; problems: HealthProblem[]; };
    pull: { versions: string[] | "all"; reason: string; at: number; removed: boolean; } | null;
    hotfixes: { id: number; note: string; at: number; }[];
}

export interface AuthorStats {
    author: { slug: string; name: string; };
    days: number;
    at: number;
    plugins: AuthorPluginStats[];
}

const n = (v: unknown) => typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0;
const int = (v: unknown) => Math.floor(n(v));
const str = (v: unknown, max: number) => typeof v === "string" ? v.slice(0, max) : "";
const list = (v: unknown, max: number): any[] => Array.isArray(v) ? v.slice(0, max) : [];
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

function parsePlugin(p: any): AuthorPluginStats {
    const counts = list(p?.rating?.counts, 5).map(int);
    const latestRate = p?.crashes?.latestRate;
    const versions = p?.pull?.versions;
    return {
        id: str(p?.id, 64),
        name: str(p?.name, 100) || str(p?.id, 64),
        version: str(p?.version, 40),
        coAuthored: p?.coAuthored === true,
        activeNow: int(p?.activeNow),
        installedNow: int(p?.installedNow),
        history: list(p?.history, 400).filter(d => DAY_RE.test(d?.day)).map(d => ({ day: d.day, installed: int(d.installed), active: int(d.active) })),
        stars: int(p?.stars),
        rating: {
            average: Math.min(5, n(p?.rating?.average)),
            count: int(p?.rating?.count),
            counts: [counts[0] ?? 0, counts[1] ?? 0, counts[2] ?? 0, counts[3] ?? 0, counts[4] ?? 0],
        },
        reviews: list(p?.reviews, 20).map(r => ({
            id: int(r?.id),
            rating: Math.min(5, Math.max(1, int(r?.rating))),
            body: str(r?.body, 2000),
            version: str(r?.version, 40),
            user: { id: str(r?.user?.id, 32), name: str(r?.user?.name, 64) || "?", avatar: typeof r?.user?.avatar === "string" ? str(r.user.avatar, 64) : null },
            createdAt: int(r?.createdAt),
        })),
        openReports: int(p?.openReports),
        crashes: { unresolved: int(p?.crashes?.unresolved), latestRate: typeof latestRate === "number" && latestRate >= 0 && latestRate <= 1 ? latestRate : null },
        health: {
            installsReporting: int(p?.health?.installsReporting),
            lastReportAt: typeof p?.health?.lastReportAt === "number" ? int(p.health.lastReportAt) : null,
            state: typeof p?.health?.state === "string" ? str(p.health.state, 20) : null,
            builds: list(p?.health?.builds, 8).map(b => ({ build: str(b?.build, 20) || "?", installs: int(b?.installs), lookups: int(b?.lookups), patches: int(b?.patches), start: int(b?.start) })),
            problems: parseProblems(p?.health?.problems),
        },
        pull: p?.pull && typeof p.pull === "object"
            ? { versions: versions === "all" ? "all" : list(versions, 20).map(v => str(v, 40)), reason: str(p.pull.reason, 500), at: int(p.pull.at), removed: p.pull.removed === true }
            : null,
        hotfixes: list(p?.hotfixes, 20).map(h => ({ id: int(h?.id), note: str(h?.note, 300), at: int(h?.at) })),
    };
}

export function parseAuthorStats(raw: any): AuthorStats {
    return {
        author: { slug: str(raw?.author?.slug, 64), name: str(raw?.author?.name, 64) },
        days: Math.min(AUTHOR_STATS_DAYS.max, Math.max(AUTHOR_STATS_DAYS.min, int(raw?.days) || AUTHOR_STATS_DAYS.default)),
        at: int(raw?.at),
        plugins: list(raw?.plugins, 200).map(parsePlugin).filter(p => p.id),
    };
}

/** The days to ask for: a whole number within the limits, the default otherwise */
export function clampDays(raw: unknown): number {
    const v = typeof raw === "string" ? Number(raw) : raw;
    if (typeof v !== "number" || !Number.isFinite(v)) return AUTHOR_STATS_DAYS.default;
    return Math.min(AUTHOR_STATS_DAYS.max, Math.max(AUTHOR_STATS_DAYS.min, Math.round(v)));
}

/** What Evi's Author page gets: the numbers, or why not (not linked, not an author, offline) */
export type AuthorStatsResult = { ok: true; value: AuthorStats; } | { ok: false; error: string; unlinked?: boolean; notAuthor?: boolean; };

/** evi.rest's refusal for an account that isn't a verified author starts like this (server/src/app.ts) */
export const NOT_AUTHOR = /^Only verified authors/;

/** Pages on the website the Author page links to, by name: main opens only these */
export const AUTHOR_LINKS = { publish: "/dashboard#plugins", docs: "/docs" } as const;
export type AuthorLink = keyof typeof AUTHOR_LINKS;
