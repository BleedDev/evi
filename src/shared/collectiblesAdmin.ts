/**
 * The Developers page's Collectibles tab, as it reads evi.rest's admin answers (server/src/sparks.ts):
 * prices per bundle, codes, someone's wallet with its ledger, and the monthly Sparks per supporter
 * level. Like shared/devAdmin.ts, anything malformed is dropped or becomes empty.
 */
import { CollectibleKind, isBundleId, KINDS, parsePrices, parseWallet, PriceKey, Prices, Wallet } from "./collectibles";

const n = (v: unknown) => typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0;
const int = (v: unknown) => Number.isInteger(v) ? v as number : 0;
const s = (v: unknown, max = 500) => typeof v === "string" ? v.slice(0, max) : "";
const time = (v: unknown) => typeof v === "number" && Number.isFinite(v) && v > 0 ? v : undefined;
const kindsOf = (v: unknown): CollectibleKind[] => Array.isArray(v) ? KINDS.filter(k => v.includes(k)) : [];
const rows = (raw: unknown, key: string) => {
    const v = (raw as Record<string, unknown> | null)?.[key];
    return Array.isArray(v) ? v.filter(x => x && typeof x === "object") as Record<string, any>[] : [];
};

/** A bundle as the prices list shows it */
export interface PricedBundle {
    id: string;
    name: string;
    tier: "free" | "supporter";
    parts: CollectibleKind[];
    prices: Prices;
    /** What the whole bundle costs someone who owns none of it */
    cost?: number;
    /** People who own some of it */
    owners: number;
}

export function parsePriceList(raw: unknown): PricedBundle[] {
    return rows(raw, "bundles").filter(b => isBundleId(b.id)).map(b => ({
        id: b.id,
        name: s(b.name, 60) || b.id,
        tier: b.tier === "supporter" ? "supporter" : "free",
        parts: kindsOf(b.parts),
        prices: parsePrices(b.prices) ?? {},
        cost: Number.isInteger(b.cost) ? b.cost : undefined,
        owners: n(b.owners),
    }));
}

/** The PUT body for a bundle's prices from the form's fields: a blank field isn't for sale (null) */
export function pricesBody(fields: Partial<Record<PriceKey, string>>, keys: PriceKey[]): Record<string, number | null> | { error: PriceKey; } {
    const body: Record<string, number | null> = {};
    for (const key of keys) {
        const text = (fields[key] ?? "").trim();
        if (!text) {
            body[key] = null;
            continue;
        }
        if (!/^\d{1,7}$/.test(text) || Number(text) > 1_000_000) return { error: key };
        body[key] = Number(text);
    }
    return body;
}

export interface CodeItem {
    bundle: string;
    /** Missing: every part the bundle has */
    kinds?: CollectibleKind[];
}

export type CodeState = "active" | "disabled" | "expired" | "used_up";

export interface AdminCode {
    code: string;
    sparks: number;
    items: CodeItem[];
    /** Unlimited when missing */
    maxUses?: number;
    uses: number;
    perUserOnce: boolean;
    expiresAt?: number;
    note: string;
    createdBy?: string;
    createdAt: number;
    disabled: boolean;
    state: CodeState;
}

function codeItems(v: unknown): CodeItem[] {
    return (Array.isArray(v) ? v : []).slice(0, 50).flatMap((i: any) => {
        if (!isBundleId(i?.bundle)) return [];
        const kinds = kindsOf(i.kinds);
        return [Array.isArray(i.kinds) && kinds.length ? { bundle: i.bundle as string, kinds } : { bundle: i.bundle as string }];
    });
}

export function parseCode(r: any): AdminCode | undefined {
    if (!r || typeof r !== "object" || typeof r.code !== "string") return undefined;
    const state: CodeState = (["active", "disabled", "expired", "used_up"] as const).find(x => x === r.state) ?? (r.disabled ? "disabled" : "active");
    return {
        code: s(r.code, 40),
        sparks: n(r.sparks),
        items: codeItems(r.items),
        maxUses: Number.isInteger(r.maxUses) && r.maxUses > 0 ? r.maxUses : undefined,
        uses: n(r.uses),
        perUserOnce: r.perUserOnce !== false,
        expiresAt: time(r.expiresAt),
        note: s(r.note, 200),
        createdBy: typeof r.createdBy === "string" ? r.createdBy.slice(0, 32) : undefined,
        createdAt: n(r.createdAt),
        disabled: r.disabled === true,
        state,
    };
}

export const parseCodes = (raw: unknown): AdminCode[] => rows(raw, "codes").map(parseCode).filter((c): c is AdminCode => !!c);

/** The POST body for a new code, from the form; an error names the field that's wrong */
export interface CodeForm {
    code: string;
    sparks: string;
    items: CodeItem[];
    maxUses: string;
    perUserOnce: boolean;
    /** YYYY-MM-DD, or blank for never */
    expires: string;
    note: string;
}

export function codeBody(form: CodeForm, now = Date.now()): Record<string, unknown> | { error: "code" | "sparks" | "maxUses" | "expires" | "empty"; } {
    const body: Record<string, unknown> = { perUserOnce: form.perUserOnce, note: form.note.trim().slice(0, 200) };
    const code = form.code.trim();
    if (code) {
        if (!/^[A-Za-z0-9-]{4,40}$/.test(code)) return { error: "code" };
        body.code = code.toUpperCase();
    }
    const sparks = form.sparks.trim();
    if (sparks && (!/^\d{1,7}$/.test(sparks) || Number(sparks) > 1_000_000)) return { error: "sparks" };
    body.sparks = sparks ? Number(sparks) : 0;
    body.items = form.items;
    if (!body.sparks && !form.items.length) return { error: "empty" };
    const uses = form.maxUses.trim();
    if (uses) {
        if (!/^\d{1,7}$/.test(uses) || Number(uses) < 1) return { error: "maxUses" };
        body.maxUses = Number(uses);
    } else body.maxUses = null;
    if (form.expires) {
        // The end of that day, in the admin's own time
        const at = new Date(`${form.expires}T23:59:59`).getTime();
        if (!Number.isFinite(at) || at <= now) return { error: "expires" };
        body.expiresAt = at;
    } else body.expiresAt = null;
    return body;
}

/** One row of someone's Sparks history */
export interface LedgerRow {
    id: number;
    delta: number;
    balance: number;
    /** buy, redeem, admin, admin-grant, admin-revoke, allowance, … */
    reason: string;
    /** What it was about: a bundle and its parts, a code, a note */
    ref?: string;
    actor?: string;
    at: number;
}

export interface AdminWallet {
    wallet: Wallet;
    parts: { bundle: string; kind: CollectibleKind; source: string; at: number; }[];
    ledger: LedgerRow[];
    allowance: { level?: string; perMonth: number; lastMonth?: string; };
}

export function parseAdminWallet(raw: unknown): AdminWallet | undefined {
    const r = raw as Record<string, any> | null;
    const wallet = parseWallet(r?.wallet);
    if (!r || !wallet) return undefined;
    return {
        wallet,
        parts: rows(r, "parts").flatMap(p => isBundleId(p.bundle) && KINDS.includes(p.kind) ? [{ bundle: p.bundle as string, kind: p.kind as CollectibleKind, source: s(p.source, 80), at: n(p.at) }] : []),
        ledger: rows(r, "ledger").slice(0, 200).map(l => ({
            id: int(l.id),
            delta: int(l.delta),
            balance: n(l.balance),
            reason: s(l.reason, 40),
            ref: typeof l.ref === "string" && l.ref ? l.ref.slice(0, 200) : undefined,
            actor: typeof l.actor === "string" && l.actor ? l.actor.slice(0, 32) : undefined,
            at: n(l.at),
        })),
        allowance: {
            level: typeof r.allowance?.level === "string" ? r.allowance.level.slice(0, 64) : undefined,
            perMonth: n(r.allowance?.perMonth),
            lastMonth: typeof r.allowance?.lastMonth === "string" ? r.allowance.lastMonth.slice(0, 7) : undefined,
        },
    };
}

/** A signed whole number of Sparks to give (+) or take (-), as typed */
export function parseDelta(text: string): number | undefined {
    const t = text.trim().replace(/^\+/, "");
    if (!/^-?\d{1,7}$/.test(t)) return undefined;
    const v = Number(t);
    return v !== 0 && Math.abs(v) <= 1_000_000 ? v : undefined;
}

export interface AllowanceLevel {
    id: string;
    name: string;
    /** Supporter days it takes */
    days: number;
    sparks: number;
}

export function parseAllowance(raw: unknown): AllowanceLevel[] {
    const r = raw as Record<string, any> | null;
    const levels = rows(r, "levels").filter(l => typeof l.id === "string").map(l => ({ id: s(l.id, 64), name: s(l.name, 64) || s(l.id, 64), days: n(l.days), sparks: n(l.sparks) }));
    if (levels.length) return levels;
    // An older answer: only the table
    const per = r?.perLevel && typeof r.perLevel === "object" ? r.perLevel as Record<string, unknown> : {};
    return Object.entries(per).map(([id, v]) => ({ id: id.slice(0, 64), name: id.slice(0, 64), days: 0, sparks: n(v) }));
}
