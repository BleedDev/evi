/**
 * Which plugins you have, for the store's clash warnings (shared/clashes.ts): evi.rest's check
 * covers store versions only, so a dev build (loaded from a folder you build into) never counts.
 * Pure, so the store and the tests share it.
 */
export interface HadPlugin {
    id: string;
    /** Missing for a plugin whose version isn't known: it can't match a checked version */
    version?: string;
    /** Loaded from a dev build rather than the plugins folder */
    dev?: boolean;
}

/** id -> the version you have, every plugin but `except` and dev builds; the first listing of an id wins */
export function versionsYouHave(plugins: Iterable<HadPlugin>, except?: string): Map<string, string> {
    const out = new Map<string, string>();
    const dev = new Set<string>();
    for (const p of plugins) {
        if (p.dev) dev.add(p.id);
        else if (p.id !== except && p.version && !out.has(p.id)) out.set(p.id, p.version);
    }
    for (const id of dev) out.delete(id);
    return out;
}
