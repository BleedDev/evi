import { functionSource } from "../webpack/find";
import { getOriginalFactory, wreq } from "../webpack/runtime";
import { getPatchRecords, matchesFind, PatchRecord } from "./source";

export type PatchHealth =
    | "applied"   // every replacement worked
    | "partial"   // some replacements matched nothing
    | "failed"    // found its module, but no replacement worked or the result didn't compile
    | "waiting"   // its module exists but hasn't been loaded yet (lazy chunk)
    | "broken"    // no module matches `find`, most likely Discord changed
    | "ambiguous"; // `find` matches several modules but the patch isn't marked `all`

export interface PatchDiagnosis extends PatchRecord {
    health: PatchHealth;
    candidates: string[];
}

/** [id, original source] of every module factory Discord has registered so far, loaded or not */
export function moduleSources(): [id: string, source: string][] {
    const sources: [string, string][] = [];
    if (wreq) {
        for (const id in wreq.m) {
            const factory = getOriginalFactory(wreq.m[id]);
            if (factory) sources.push([id, functionSource(factory)]);
        }
    }
    return sources;
}

/** Checks every registered patch against all module factories Discord has registered so far */
export function diagnosePatches(): PatchDiagnosis[] {
    const sources = moduleSources();

    return getPatchRecords().map(record => {
        const candidates = sources.filter(([, src]) => matchesFind(src, record.patch.find)).map(([id]) => id);

        let health: PatchHealth;
        if (record.state !== "pending") health = record.state;
        else if (!candidates.length) health = "broken";
        else health = "waiting";

        if (!record.patch.all && candidates.length > 1 && (health === "waiting" || health === "applied")) health = "ambiguous";

        return { ...record, health, candidates };
    });
}

/**
 * A patch that failed only because other plugins' patches changed the same code first: a clash
 * between plugins on this install, not Discord changing. Every miss of it is a conflict.
 */
export function isConflictOnly(record: PatchRecord) {
    return !!record.conflicts?.length && record.errors.length === record.conflicts.length;
}

/** The plugins whose patches got in the way of these, each once, in the order they were found */
export function conflictingPlugins(records: PatchRecord[]): string[] {
    return [...new Set(records.flatMap(r => r.conflicts?.map(c => c.plugin) ?? []))];
}

/**
 * Whether any of a plugin's patches is failed, partial or broken, as diagnosePatches would say.
 * Health checks run this in the background: applied and failed patches need no module search, and
 * a waiting one stops at the first module that matches instead of reading every module for every
 * patch of every plugin, which held up Discord for seconds on a big client.
 */
export function hasPatchProblems(plugin: string): boolean {
    const records = getPatchRecords(plugin);
    if (records.some(r => r.state === "failed" || r.state === "partial")) return true;
    // A patch still waiting isn't a problem, optional or not: its module may be in a chunk Discord
    // loads on demand and only registers on first use (the image viewer; Volume Booster patches the
    // user right-click menu, and every install that hadn't opened one yet reported it broken). A patch
    // that doesn't fit once its module loads shows up above as failed or partial.
    return false;
}
