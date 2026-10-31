/**
 * Evi's hotfix for itself (shared/hotfixes.ts, plugin id CORE_HOTFIX_ID, ranged by Evi's version):
 * a Discord update broke one of Evi's own patches or lookups, or Evi's CSS is wrong, and Evi's team
 * repaired it on evi.rest without a new Evi.
 *
 *  - Patches: registerPatches swaps the fix in by slot (patching/source.ts CORE_PATCH_SLOTS), so a
 *    fix for a patch that already ran applies from the next Discord start.
 *  - Lookups: resolved through webpack/find.ts, so any not answered yet take a fix at once.
 *  - CSS: right after Evi's stylesheet (ui/stylesheet.ts), so it wins over Evi's rules while themes and
 *    Quick CSS still win over it. Swapped as soon as the hotfix changes.
 *
 * Nothing here in safe mode. Kept free of other renderer modules: the patcher and the finders read it.
 */
import { CORE_HOTFIX_ID, Hotfix, hotfixFor, hotfixTag } from "@shared/hotfixes";

let current: Hotfix | undefined;
let enabled = false;
let version: string | undefined;
const listeners = new Set<() => void>();

export const CoreHotfix = {
    /** At boot, before Evi registers its patches; `on` is false in safe mode. `eviVersion` is for tests. */
    init(hotfixes: readonly Hotfix[] | undefined, on: boolean, eviVersion = EVI_VERSION) {
        enabled = on;
        version = eviVersion;
        current = on ? hotfixFor(hotfixes, CORE_HOTFIX_ID, version) : undefined;
    },
    /** evi.rest said Evi's hotfixes changed. Whether Evi's own changed. */
    set(hotfixes: readonly Hotfix[]) {
        if (!enabled) return false;
        const next = hotfixFor(hotfixes, CORE_HOTFIX_ID, version);
        if ((next ? hotfixTag(next) : "") === (current ? hotfixTag(current) : "")) return false;
        current = next;
        for (const listener of listeners) listener();
        return true;
    },
    get: () => current,
    subscribe(listener: () => void) {
        listeners.add(listener);
        return () => void listeners.delete(listener);
    },
};
