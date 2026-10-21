/**
 * The kill switch: plugins an admin pulled because they're malicious or badly broken. A pulled plugin
 * is turned off on every install, not just taken out of the store, and the user is told why.
 *
 * Pulls ride along in GET /v1/health as `pulled`, so every install already fetching health gets them.
 * Main keeps the last answer on disk and hands it to the renderer at boot (BootData.pulled), so a
 * pulled plugin never starts, even offline. Pulling a version leaves the setting that turned the
 * plugin on alone: when the pull is lifted, or a newer version that isn't pulled is installed, it
 * runs again.
 */
import { isPluginId, isVersion } from "./store";

export interface PulledPlugin {
    /** The versions pulled; "all" for every version, including future ones until it's lifted */
    versions: string[] | "all";
    /** Shown to users: why it was turned off */
    reason: string;
    /** Epoch ms */
    at: number;
    /** Also taken out of the store: can't be installed, its files aren't served */
    removed: boolean;
}

export type PulledPlugins = Record<string, PulledPlugin>;

/** An admin pulling a plugin (POST /v1/admin/plugins/:id/pull) */
export interface PullInput {
    /** Omit for every version */
    version?: string;
    reason: string;
    /** Take it out of the store too */
    remove: boolean;
}

const clean = (text: string) => !/[\0-\x08\x0e-\x1f]/.test(text);

export function validatePull(raw: unknown): { pull: PullInput; } | { error: string; } {
    const e = (raw ?? {}) as Record<string, unknown>;
    if (e.version !== undefined && e.version !== null && !isVersion(e.version)) return { error: "version must look like 1.2.3, or be left out for every version" };
    if (typeof e.reason !== "string" || !e.reason.trim() || e.reason.length > 300 || !clean(e.reason)) return { error: "The reason must be 1-300 characters: users see it" };
    return { pull: { ...(isVersion(e.version) && { version: e.version }), reason: e.reason.trim(), remove: e.remove === true } };
}

/** `pulled` from GET /v1/health (or its copy on disk), cleaned. Anything malformed is left out. */
export function parsePulled(raw: unknown): PulledPlugins {
    const out: PulledPlugins = {};
    const pulled = (raw as { pulled?: unknown; } | null)?.pulled;
    if (!pulled || typeof pulled !== "object" || Array.isArray(pulled)) return out;
    for (const [id, value] of Object.entries(pulled).slice(0, 5000)) {
        if (!isPluginId(id) || !value || typeof value !== "object") continue;
        const e = value as Record<string, unknown>;
        const versions = e.versions === "all" ? "all" : Array.isArray(e.versions) ? e.versions.filter(isVersion).slice(0, 100) : undefined;
        if (!versions || (Array.isArray(versions) && !versions.length)) continue;
        if (typeof e.reason !== "string" || !e.reason.trim() || typeof e.at !== "number") continue;
        out[id] = { versions, reason: e.reason.slice(0, 300), at: e.at, removed: e.removed === true };
    }
    return out;
}

/** The pull that applies to a plugin at this version, if any */
export function pullFor(pulled: PulledPlugins | undefined, id: string, version: string | undefined): PulledPlugin | undefined {
    // Own keys only: a plugin called "constructor" would otherwise find Object's
    const p = pulled && Object.hasOwn(pulled, id) ? pulled[id] : undefined;
    if (!p) return;
    if (p.versions === "all") return p;
    return version && p.versions.includes(version) ? p : undefined;
}
