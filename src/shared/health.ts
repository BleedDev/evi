/**
 * Live plugin health: which store plugins are known to be broken right now.
 *
 * Installs report a plugin when it can't find parts of Discord, its patches fail or it doesn't start
 * (POST /v1/health/reports: the plugin, its version, Discord's build, the kind of problem and what
 * failed in the plugin's own code, nothing else). Enough installs reporting the same version marks it
 * broken automatically; its author or an admin can also set a status with a message ("Fix coming in 1.0.2"), which always wins.
 * GET /v1/health is the store-wide picture the app shows on store cards and the Plugins list.
 */
import { isHotfixTag } from "./hotfixes";
import { isPluginId, isVersion } from "./store";

export type HealthState = "broken" | "investigating" | "fixed";
export const HEALTH_STATES: readonly HealthState[] = ["broken", "investigating", "fixed"];

export type HealthKind = "lookups" | "patches" | "start";
export const HEALTH_KINDS: readonly HealthKind[] = ["lookups", "patches", "start"];

/** One plugin's status in GET /v1/health */
export interface PluginHealth {
    state: HealthState;
    /** Set by its author or an admin */
    message?: string;
    /** Epoch ms */
    since: number;
    /** The version it's about; a newer one clears it */
    version?: string;
    /** From install reports rather than a person */
    automatic: boolean;
    /** Installs that reported it, for automatic ones */
    reports?: number;
    /** Who set it, for manual ones: the author's name, or "Evi" for admins */
    setBy?: string;
    /**
     * The revision of Evi's hotfix it's about (shared/hotfixes.ts): `fixed` while installs running it
     * are fine, `broken` when enough of them still report problems
     */
    hotfix?: string;
}

export interface HealthReportInput {
    plugin: string;
    version: string;
    /** Discord's build id, from GLOBAL_ENV.SENTRY_TAGS.buildId */
    discordBuild: string;
    kind: HealthKind;
    /** The revision of Evi's hotfix this install runs for the plugin, if any: the problem is still there with it */
    hotfix?: string;
    /**
     * What failed, for its author: a patch's find and why it didn't apply, a lookup's target, or the
     * first line of the error it stopped with (patchDetail, lookupDetail, scrubError). At most
     * MAX_HEALTH_DETAILS lines; Evis before 3.1.0 send none.
     */
    detail?: string[];
}

export const MAX_HEALTH_DETAILS = 5;
export const MAX_HEALTH_DETAIL = 240;

/** A manual status (PUT /v1/plugins/:id/status) */
export interface HealthStatusInput {
    state: HealthState;
    message: string;
}

const BUILD_RE = /^[0-9a-z._-]{1,64}$/i;

export function validateHealthReport(raw: unknown): { report: HealthReportInput; } | { error: string; } {
    const e = (raw ?? {}) as Record<string, unknown>;
    if (!isPluginId(e.plugin)) return { error: "plugin must be a plugin id" };
    if (!isVersion(e.version)) return { error: "version must look like 1.2.3" };
    if (typeof e.discordBuild !== "string" || !BUILD_RE.test(e.discordBuild)) return { error: "discordBuild must be Discord's build id" };
    if (!HEALTH_KINDS.includes(e.kind as HealthKind)) return { error: `kind must be one of ${HEALTH_KINDS.join(", ")}` };
    if (e.hotfix !== undefined && !isHotfixTag(e.hotfix)) return { error: "hotfix must be a hotfix revision like 12.3" };
    const detail = e.detail;
    if (detail !== undefined && (!Array.isArray(detail) || detail.length > MAX_HEALTH_DETAILS
        || !detail.every(d => typeof d === "string" && d.length && d.length <= MAX_HEALTH_DETAIL && !CONTROL.test(d)))) {
        return { error: `detail must be at most ${MAX_HEALTH_DETAILS} lines of at most ${MAX_HEALTH_DETAIL} characters` };
    }
    return {
        report: {
            plugin: e.plugin,
            version: e.version,
            discordBuild: e.discordBuild,
            kind: e.kind as HealthKind,
            ...(isHotfixTag(e.hotfix) && { hotfix: e.hotfix }),
            ...(Array.isArray(detail) && detail.length && { detail: [...new Set(detail as string[])] }),
        },
    };
}

export function validateHealthStatus(raw: unknown): { status: HealthStatusInput; } | { error: string; } {
    const e = (raw ?? {}) as Record<string, unknown>;
    if (!HEALTH_STATES.includes(e.state as HealthState)) return { error: `state must be one of ${HEALTH_STATES.join(", ")}` };
    const message = e.message ?? "";
    if (typeof message !== "string" || message.length > 200 || /[\0-\x08\x0e-\x1f]/.test(message)) return { error: "The message must be at most 200 characters" };
    return { status: { state: e.state as HealthState, message: message.trim() } };
}

const CONTROL = /[\0-\x1f\x7f]/;
/** On one line, and short enough to send */
const line = (text: string) => {
    const one = text.replace(/[\0-\x1f\x7f]+/g, " ").trim();
    return one.length > MAX_HEALTH_DETAIL ? `${one.slice(0, MAX_HEALTH_DETAIL - 1)}…` : one;
};

/**
 * An error message with nothing about the person in it: paths (which name their user folder), links,
 * email addresses and long numbers (Discord ids) are blanked. First line only.
 */
export function scrubError(message: string): string {
    return line((message.split("\n")[0] ?? "")
        .replace(/\b[a-z][\w+.-]*:\/\/\S+/gi, "<url>")
        .replace(/\b[a-z]:[\\/]\S*/gi, "<path>")
        .replace(/\\\\\S+/g, "<path>")
        .replace(/(?:~|\.{1,2})?\/(?:[\w.@$-]+\/)+[\w.@$-]*/g, "<path>")
        .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "<email>")
        .replace(/\d{8,}/g, "<id>"));
}

/** One failing patch as a detail line: which one, what it looks for, and the first reason it gave */
export function patchDetail(index: number, find: string | RegExp, errors: string[]): string {
    const what = typeof find === "string" ? JSON.stringify(find) : String(find);
    // "module 12345, replacement 1 matched nothing: …": the module id changes with every build
    const why = errors[0]?.replace(/^module [\w$-]+(?:, |: )/, "");
    return line(`patches[${index}] find ${what}${why ? `: ${why}` : ""}`);
}

/** One lookup that found nothing, as a detail line */
export const lookupDetail = (target: string) => line(`lookup ${target}`);

/** One thing that failed in a plugin, by how many installs reported it (admin and author dashboards) */
export interface HealthProblem {
    kind: string;
    /** `patches[2] find "…": replacement 0 matched nothing: …`, `lookup props foo`, or a start error */
    detail: string;
    installs: number;
}

export function parseProblems(raw: unknown): HealthProblem[] {
    return (Array.isArray(raw) ? raw : []).slice(0, 8)
        .filter(p => p && typeof p === "object" && typeof p.detail === "string" && p.detail)
        .map(p => ({ kind: typeof p.kind === "string" ? p.kind.slice(0, 20) : "", detail: p.detail.slice(0, 300), installs: typeof p.installs === "number" && p.installs > 0 ? Math.floor(p.installs) : 0 }));
}

/** GET /v1/health, cleaned: statuses by plugin id. Anything malformed is left out. */
export function parseHealth(raw: unknown): Record<string, PluginHealth> {
    const out: Record<string, PluginHealth> = {};
    const plugins = (raw as { plugins?: unknown; } | null)?.plugins;
    if (!plugins || typeof plugins !== "object" || Array.isArray(plugins)) return out;
    for (const [id, value] of Object.entries(plugins).slice(0, 5000)) {
        if (!isPluginId(id) || !value || typeof value !== "object") continue;
        const e = value as Record<string, unknown>;
        if (!HEALTH_STATES.includes(e.state as HealthState) || typeof e.since !== "number") continue;
        out[id] = {
            state: e.state as HealthState,
            since: e.since,
            automatic: e.automatic === true,
            ...(typeof e.message === "string" && e.message && { message: e.message.slice(0, 200) }),
            ...(isVersion(e.version) && { version: e.version }),
            ...(typeof e.reports === "number" && { reports: e.reports }),
            ...(typeof e.setBy === "string" && { setBy: e.setBy.slice(0, 40) }),
            ...(isHotfixTag(e.hotfix) && { hotfix: e.hotfix }),
        };
    }
    return out;
}

/**
 * Whether a status applies to the version someone has: statuses are about one version, and a user
 * already on a newer one isn't affected. "fixed" never warns, and neither does anything that isn't a
 * status: health["constructor"] is Object's, not a plugin's.
 */
export function healthWarns(health: PluginHealth | undefined, installedVersion?: string): boolean {
    if (!health || !HEALTH_STATES.includes(health.state) || health.state === "fixed") return false;
    return !health.version || !installedVersion || health.version === installedVersion;
}
