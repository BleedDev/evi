/**
 * The hotfix each plugin runs with (shared/hotfixes.ts), for the parts that ask while the plugin is
 * running: its context swaps a lookup Evi fixed for the new target before waiting for it. The manager
 * decides which hotfix a plugin gets and when; this only remembers it.
 */
import { fromPattern, Hotfix, lookupFixFor } from "@shared/hotfixes";

import { describeFilter, Filter, hotfixFilter } from "../webpack/find";

const applied = new Map<string, Hotfix>();

export const AppliedHotfixes = {
    set(plugin: string, hotfix: Hotfix | undefined) {
        if (hotfix) applied.set(plugin, hotfix);
        else applied.delete(plugin);
    },
    get: (plugin: string) => applied.get(plugin),
};

/**
 * What a plugin's lookup should look for: Evi's fix for it when its hotfix has one (matched by the
 * target the Patches tab shows), else what the plugin asked for.
 */
export function fixedLookup(plugin: string, filter: Filter, method?: string): { filter: Filter; method?: string; } {
    const hotfix = applied.get(plugin);
    if (!hotfix?.lookups.length) return { filter, method };
    const fix = lookupFixFor(hotfix, describeFilter(filter) + (method ? `, method ${method}` : ""));
    if (!fix) return { filter, method };
    return { filter: hotfixFilter(fix.kind, fix.args.map(fromPattern)), method: fix.method ?? method };
}
