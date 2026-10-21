/**
 * "What's new in <Plugin>": after an installed plugin updates, the changelog entries of the versions
 * between the one last seen and the one now installed, once. Pure logic, shared with the tests; the
 * popup is src/renderer/ui/PluginChangelog.tsx.
 */
import type { ChangelogEntry } from "./store";
import { compareVersions, isVersion } from "./store";

export interface ChangelogPlugin {
    id: string;
    name: string;
    version?: string;
    changelog?: readonly ChangelogEntry[];
}

export interface PluginUpdate {
    id: string;
    name: string;
    /** The version last seen */
    from: string;
    /** The version installed now */
    to: string;
    /** Newest first, each newer than `from` and no newer than `to` */
    entries: ChangelogEntry[];
}

/**
 * Entries newer than `seen`, up to and including `current`, newest first. Manifests list them newest
 * first by convention, but a hand-written one may not, so they're sorted here. Nothing without `seen`.
 */
export function entriesBetween(changelog: readonly ChangelogEntry[] | undefined, seen: string | undefined, current: string): ChangelogEntry[] {
    if (!seen || !changelog?.length || !isVersion(seen) || !isVersion(current)) return [];
    return changelog
        .filter(e => isVersion(e.version) && compareVersions(e.version, seen) > 0 && compareVersions(e.version, current) <= 0 && e.notes.length > 0)
        .sort((a, b) => compareVersions(b.version, a.version));
}

/**
 * Compares each plugin's version with the one last seen. Returns the updates worth showing (newer,
 * with notes), sorted by name so several make one popup, and the versions to remember from now on.
 *
 *   - never seen (a first install, or the first run of this feature): remembered, nothing shown
 *   - newer: shown if its changelog says what changed, remembered either way
 *   - same or older (a downgrade): remembered, nothing shown
 *
 * Plugins without a valid version aren't tracked. Plugins that are gone keep their entry, so
 * reinstalling a newer version later still tells you what changed.
 */
export function detectPluginUpdates(plugins: readonly ChangelogPlugin[], seen: Readonly<Record<string, string>> | undefined) {
    const next: Record<string, string> = { ...seen };
    const updates: PluginUpdate[] = [];
    let changed = false;

    for (const p of plugins) {
        const current = p.version;
        if (!current || !isVersion(current)) continue;
        const last = seen?.[p.id];
        if (last !== current) {
            next[p.id] = current;
            changed = true;
        }
        if (!last || !isVersion(last) || compareVersions(current, last) <= 0) continue;

        const entries = entriesBetween(p.changelog, last, current);
        if (entries.length) updates.push({ id: p.id, name: p.name, from: last, to: current, entries });
    }

    updates.sort((a, b) => a.name.localeCompare(b.name));
    return { updates, seen: next, changed };
}

/**
 * Adds updates to the ones a popup already shows, so plugins updating one after another (Update all,
 * auto-update) end up in one popup. A plugin that updated twice keeps its oldest `from` and all
 * entries in between.
 */
export function mergeUpdates(shown: readonly PluginUpdate[], incoming: readonly PluginUpdate[]): PluginUpdate[] {
    const byId = new Map(shown.map(u => [u.id, u]));
    for (const u of incoming) {
        const prev = byId.get(u.id);
        if (!prev) {
            byId.set(u.id, u);
            continue;
        }
        const entries = [...new Map([...prev.entries, ...u.entries].map(e => [e.version, e])).values()]
            .sort((a, b) => compareVersions(b.version, a.version));
        byId.set(u.id, { ...u, from: compareVersions(prev.from, u.from) < 0 ? prev.from : u.from, entries });
    }
    return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}
