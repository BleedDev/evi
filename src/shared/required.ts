/**
 * A required Evi version: Evi's team can say every Evi older than it should update (GET /v1/required,
 * set from the Developers page). It never overrides the person's own update settings: with automatic
 * updates on, Evis below it download the update straight away and restart Discord once nobody's in a
 * call; with them off, Evi only says an update is needed and waits for "Update now". `forcePlugins`
 * likewise only updates store plugins for people who have plugin auto-update on.
 */
import { compareVersions, isVersion } from "./store";

export interface RequiredUpdate {
    version: string;
    /** Shown in the banner, may be empty */
    reason: string;
    forcePlugins: boolean;
    /** When it was set */
    at: number;
}

export const MAX_REASON = 200;

const clean = (v: unknown) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "");

/** What evi.rest sends, or null for "nothing required" / anything malformed */
export function parseRequired(raw: unknown): RequiredUpdate | null {
    const r = (raw as any)?.required ?? raw;
    if (!r || typeof r !== "object" || !isVersion(r.version)) return null;
    return {
        version: r.version,
        reason: clean(r.reason).slice(0, MAX_REASON),
        forcePlugins: r.forcePlugins === true,
        at: typeof r.at === "number" && Number.isFinite(r.at) ? r.at : 0,
    };
}

/** An admin's request to require a version */
export function parseRequiredInput(raw: unknown): { version: string; reason: string; forcePlugins: boolean; } | { error: string; } {
    const r = raw as any;
    const version = clean(r?.version).replace(/^v/, "");
    if (!isVersion(version) || version.includes("-")) return { error: "Give a released version, like 2.0.1" };
    const reason = clean(r?.reason);
    if (reason.length > MAX_REASON) return { error: `Keep the reason under ${MAX_REASON} characters` };
    return { version, reason, forcePlugins: r?.forcePlugins === true };
}

/** The settings a required update has to respect */
export interface UpdateConsent {
    /** Automatic Evi updates (Settings → Updates) */
    silentUpdates?: boolean;
    /** Automatic plugin and theme updates (the store) */
    autoUpdate?: boolean;
}

/** Whether a required update may download and install Evi without asking: only with automatic updates on */
export const mayUpdateEviUnasked = (consent: UpdateConsent) => consent.silentUpdates === true;

/** Whether a required update may update store plugins without asking: only with plugin auto-update on */
export const mayForcePlugins = (required: RequiredUpdate | null | undefined, consent: UpdateConsent) =>
    !!required?.forcePlugins && consent.autoUpdate === true;

/** Whether an Evi on `current` has to update. A beta of the required version or newer counts as there */
export function mustUpdate(required: RequiredUpdate | null | undefined, current: string): boolean {
    if (!required || !isVersion(current)) return false;
    const base = current.replace(/-.*$/, "");
    return compareVersions(base, required.version) < 0;
}
