/**
 * Exports plugins wait for through their context (ctx.waitFor, ctx.hookExport). A lookup whose
 * target never shows up throws nowhere: the plugin keeps running without that part. After a Discord
 * update that looks exactly like a working plugin, so every lookup is tracked here and diagnosed the
 * way source patches are (see patching/diagnose.ts).
 */
import { describeFilter, Filter, findModuleIds } from "../webpack/find";
import { wreq } from "../webpack/runtime";

export type LookupHealth =
    | "found"    // its export exists, the callback ran
    | "waiting"  // not yet, but its module exists and hasn't loaded, or Discord is still starting
    | "broken"   // no module's code matches the lookup, or its module ran without a matching export
    | "missing"; // nothing Discord has loaded so far matches, and no module still to load looks like it

export interface LookupRecord {
    plugin: string;
    /** What it looks for, e.g. `props sendMessage, editMessage`, with the hooked method if any */
    target: string;
    filter: Filter;
    /** performance.now() when the plugin asked */
    since: number;
    found: boolean;
}

export interface LookupDiagnosis extends LookupRecord {
    health: LookupHealth;
    /** Ids of modules whose code matches the lookup's code hint */
    candidates: string[];
}

/**
 * Discord's startup code has loaded well before this. A lookup still unanswered after it either
 * targets code that loads later (a voice call, a settings page...) or code Discord changed.
 */
export const LOOKUP_GRACE_MS = 20_000;

const records: LookupRecord[] = [];

export function trackLookup(plugin: string, filter: Filter, method?: string): LookupRecord {
    const record: LookupRecord = {
        plugin,
        target: describeFilter(filter) + (method ? `, method ${method}` : ""),
        filter,
        since: performance.now(),
        found: false,
    };
    records.push(record);
    return record;
}

export function untrackLookup(record: LookupRecord) {
    const i = records.indexOf(record);
    if (i !== -1) records.splice(i, 1);
}

export function getLookupRecords(plugin?: string) {
    return plugin ? records.filter(r => r.plugin === plugin) : [...records];
}

export const isLookupProblem = (health: LookupHealth) => health === "broken" || health === "missing";

/**
 * A code scan walks every module factory Discord has registered (about 20 ms). The Plugins tab
 * diagnoses each visible card on every re-render, so a lookup's scan is reused for this long.
 */
export const SCAN_TTL_MS = 10_000;

const scans = new WeakMap<LookupRecord, { at: number; ids: string[]; }>();

/** The record's last scan if it's younger than maxAge, otherwise a new one */
export function scanFor(record: LookupRecord, now: number, maxAge: number, scan: () => string[]) {
    const last = scans.get(record);
    if (last && maxAge > 0 && now - last.at < maxAge) return last.ids;
    const ids = scan();
    scans.set(record, { at: now, ids });
    return ids;
}

/**
 * Checks unanswered lookups against every module factory Discord has registered so far. A lookup's
 * code scan is reused for up to maxAge ms, pass 0 for a fresh one.
 */
export function diagnoseLookups(plugin?: string, now = performance.now(), maxAge = SCAN_TTL_MS): LookupDiagnosis[] {
    return getLookupRecords(plugin).map(record => {
        const { $code, $hint } = record.filter;
        const code = $code ?? $hint;
        if (record.found) return { ...record, health: "found" as const, candidates: [] };
        if (!wreq || now - record.since < LOOKUP_GRACE_MS) return { ...record, health: "waiting" as const, candidates: [] };
        const candidates = code ? scanFor(record, now, maxAge, () => findModuleIds(...code)) : [];
        return { ...record, health: lookupHealth(code ? (!!$code ? "code" : "hint") : "none", candidates, id => !!wreq!.c[id]), candidates };
    });
}

/**
 * An unanswered lookup past its grace period, by what its filter says about its module's code and the
 * modules whose code matches it. A candidate that already ran and still didn't match is no better than
 * none. A hint (byProps' property names) only tells "its module hasn't loaded yet", like the search
 * actions Discord loads when search first opens; without that it says no more than having no hint.
 */
export function lookupHealth(code: "code" | "hint" | "none", candidates: string[], loaded: (id: string) => boolean): LookupHealth {
    if (candidates.some(id => !loaded(id))) return "waiting";
    return code === "code" ? "broken" : "missing";
}
