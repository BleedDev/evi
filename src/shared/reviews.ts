/**
 * Ratings and short reviews on store plugins. Anyone whose Evi is linked to their Discord account can
 * rate a plugin they have installed, once (editing replaces it). Reviews anyone can report go to Evi's
 * team, who can hide them; a hidden review isn't shown or counted.
 */
import { MAX_SUNSET_NOTE, PluginSunset } from "./health";
import { englishTr, Tr } from "./tr";

export const MAX_REVIEW_CHARS = 500;
export const REVIEWS_PER_PAGE = 10;

export interface ReviewAuthor {
    id: string;
    name: string;
    /** Discord avatar hash, for cdn.discordapp.com/avatars/<id>/<hash>.png */
    avatar: string | null;
}

export interface Review {
    id: number;
    plugin: string;
    /** 1 to 5 */
    rating: number;
    body: string;
    /** The version they had when they wrote it */
    version: string;
    user: ReviewAuthor;
    createdAt: number;
    updatedAt: number;
}

export interface RatingSummary {
    /** Average of visible ratings, one decimal */
    average: number;
    count: number;
    /** How many gave 1, 2, 3, 4 and 5 stars */
    counts: [number, number, number, number, number];
}

/** A review as written, cleaned, or why it can't be sent */
export function validateReview(raw: unknown, tr: Tr = englishTr): { rating: number; body: string; version: string; } | { error: string; } {
    const r = (raw ?? {}) as Record<string, unknown>;
    if (!Number.isInteger(r.rating) || (r.rating as number) < 1 || (r.rating as number) > 5) return { error: tr("check.review.stars") };
    const body = typeof r.body === "string" ? r.body.replace(/\r\n?/g, "\n").trim() : "";
    if (body.length > MAX_REVIEW_CHARS) return { error: tr("check.review.tooLong", { max: MAX_REVIEW_CHARS }) };
    if (/[\0-\x08\x0e-\x1f]/.test(body)) return { error: tr("check.review.badChars") };
    if (/(?:\n\s*){4,}/.test(body)) return { error: tr("check.review.emptyLines") };
    const version = typeof r.version === "string" && r.version.length <= 64 ? r.version : "";
    return { rating: r.rating as number, body, version };
}

export function summarize(ratings: number[]): RatingSummary {
    const counts: RatingSummary["counts"] = [0, 0, 0, 0, 0];
    for (const r of ratings) if (r >= 1 && r <= 5) counts[r - 1]++;
    const count = counts.reduce((a, b) => a + b, 0);
    const total = counts.reduce((sum, n, i) => sum + n * (i + 1), 0);
    return { average: count ? Math.round(total / count * 10) / 10 : 0, count, counts };
}

/**
 * For sorting by rating: an average pulled toward 3 until there are enough ratings to trust, so one
 * five-star rating doesn't beat forty four-and-a-half ones
 */
export function ratingScore(s: RatingSummary | undefined) {
    if (!s?.count) return 0;
    const prior = 5;
    return (s.average * s.count + 3 * prior) / (s.count + prior);
}

export interface PluginIssue {
    /** broken: evi.rest sees it failing on this Discord; status: its author's note; hotfix: Evi's fix is out; pulled: turned off */
    kind: "broken" | "status" | "hotfix" | "pulled";
    text: string;
    since?: number;
}

/** GET /v1/plugins/:id/page: everything on a plugin's store page that isn't in the registry */
export interface PluginPage {
    rating: RatingSummary;
    reviews: Review[];
    /** This install's account's own review, visible or hidden */
    mine: (Review & { hidden: boolean; }) | null;
    /** Plugins people who run this one also run, most first */
    related: string[];
    issues: PluginIssue[];
    /** The author's note on a version, newest version first */
    note: { version: string; text: string; } | null;
    /** Its author plans to retire it ("Deprecated soon"), with why; null when they don't */
    sunset: PluginSunset | null;
    /** How many installs run it, for the page's facts; null while it's too few to say */
    installs: number | null;
}

/** Fewer installs than this are shown as "fewer than 10", so a count can't point at someone */
export const MIN_SHOWN_INSTALLS = 10;

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const cleanText = (v: unknown, max: number) => typeof v === "string" ? v.slice(0, max).replace(/[\0-\x08\x0e-\x1f]/g, "") : "";

export function parseSummary(raw: unknown): RatingSummary | undefined {
    const s = (raw ?? {}) as Record<string, unknown>;
    if (!isNum(s.average) || !isNum(s.count) || !Array.isArray(s.counts) || s.counts.length !== 5 || !s.counts.every(isNum)) return;
    return { average: Math.min(5, Math.max(0, s.average)), count: Math.max(0, s.count), counts: s.counts as RatingSummary["counts"] };
}

/** GET /v1/ratings: { "plugin:id": RatingSummary } */
export function parseRatings(raw: unknown): Record<string, RatingSummary> {
    const out: Record<string, RatingSummary> = {};
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
    for (const [key, value] of Object.entries(raw)) {
        const summary = /^(plugin|theme):[a-z0-9-]{1,64}$/.test(key) ? parseSummary(value) : undefined;
        if (summary) out[key] = summary;
    }
    return out;
}

function parseReview(raw: unknown): Review | undefined {
    const r = (raw ?? {}) as Record<string, unknown>;
    const user = (r.user ?? {}) as Record<string, unknown>;
    if (!isNum(r.id) || typeof r.plugin !== "string" || !isNum(r.rating) || r.rating < 1 || r.rating > 5 || typeof user.id !== "string" || !/^\d{5,25}$/.test(user.id)) return;
    return {
        id: r.id,
        plugin: r.plugin,
        rating: Math.round(r.rating),
        body: cleanText(r.body, MAX_REVIEW_CHARS),
        version: cleanText(r.version, 64),
        user: { id: user.id, name: cleanText(user.name, 80) || "Someone", avatar: typeof user.avatar === "string" && /^(a_)?[0-9a-f]{32}$/.test(user.avatar) ? user.avatar : null },
        createdAt: isNum(r.createdAt) ? r.createdAt : 0,
        updatedAt: isNum(r.updatedAt) ? r.updatedAt : 0,
    };
}

export function parseReviews(raw: unknown): Review[] {
    return Array.isArray(raw) ? raw.map(parseReview).filter((r): r is Review => !!r).slice(0, 50) : [];
}

/** GET /v1/plugins/:id/page, cleaned: nothing the server sends goes to the page unchecked */
export function parsePluginPage(raw: unknown): PluginPage {
    const p = (raw ?? {}) as Record<string, unknown>;
    const mine = p.mine ? parseReview(p.mine) : undefined;
    const note = (p.note ?? null) as Record<string, unknown> | null;
    const sunset = (p.sunset ?? null) as Record<string, unknown> | null;
    const kinds = new Set(["broken", "status", "hotfix", "pulled"]);
    return {
        rating: parseSummary(p.rating) ?? summarize([]),
        reviews: parseReviews(p.reviews),
        mine: mine ? { ...mine, hidden: (p.mine as Record<string, unknown>).hidden === true } : null,
        related: Array.isArray(p.related) ? p.related.filter((id): id is string => typeof id === "string" && /^[a-z0-9-]{1,64}$/.test(id)).slice(0, 6) : [],
        issues: Array.isArray(p.issues)
            ? p.issues.flatMap(i => {
                const issue = (i ?? {}) as Record<string, unknown>;
                // The sunset again, as a status, for Evis from before `sunset`: this page shows it on its own
                if (issue.sunset === true) return [];
                return kinds.has(issue.kind as string) ? [{ kind: issue.kind as PluginIssue["kind"], text: cleanText(issue.text, 500), ...(isNum(issue.since) && { since: issue.since }) }] : [];
            }).slice(0, 5)
            : [],
        note: note && typeof note.version === "string" && typeof note.text === "string" ? { version: cleanText(note.version, 64), text: cleanText(note.text, 500) } : null,
        sunset: sunset && typeof sunset.note === "string" && sunset.note && isNum(sunset.since)
            ? { note: cleanText(sunset.note, MAX_SUNSET_NOTE), since: sunset.since, ...(typeof sunset.setBy === "string" && { setBy: cleanText(sunset.setBy, 40) }) }
            : null,
        installs: isNum(p.installs) ? p.installs : null,
    };
}
