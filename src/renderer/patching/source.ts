/**
 * Source patches rewrite a module's code before it first runs. They can change anything, at the
 * cost of depending on Discord's minified code. Prefer export hooks when they can do the job.
 *
 * Matching conveniences:
 *   \i      in a RegExp (find or match) matches any identifier (minified names change every build)
 *   $self   in a replacement refers to the plugin's definition object at runtime
 */
import { Logger } from "../logger";
import type { ModuleFactory } from "../webpack/runtime";
import { FindCache, findKey } from "./findCache";

export interface Replacement {
    match: string | RegExp;
    /** Same semantics as String.prototype.replace */
    with: string | ((substring: string, ...args: any[]) => string);
}

export interface SourcePatch {
    /** A string or RegExp that only the target module's source contains */
    find: string | RegExp;
    replace: Replacement | Replacement[];
    /** Patch every module matching `find` instead of only the first */
    all?: boolean;
    /** If one replacement fails, apply none of them */
    group?: boolean;
    /**
     * Don't report this patch as broken when nothing matches. With `all`, a module whose
     * replacements change nothing is also skipped quietly instead of counting as a failure.
     */
    optional?: boolean;
    /** Skip the patch when this returns false. Evaluated when a matching module loads. */
    predicate?: () => boolean;
    /**
     * Whether the target module may be re-run in place when this patch changes after the module
     * already executed (see live.ts). Default: decided by a safety check. `false` always asks for a
     * reload, `true` skips the check (for modules you know are safe to run twice).
     */
    live?: boolean;
}

export type PatchState = "pending" | "applied" | "partial" | "failed";

export interface PatchRecord {
    plugin: string;
    index: number;
    patch: SourcePatch;
    state: PatchState;
    /** Modules this patch was applied to */
    modules: string[];
    errors: string[];
}

const logger = new Logger("SourcePatcher", "#f7a072");
const records: PatchRecord[] = [];

/** Which modules each find matches, from an earlier start on this build (findIndex.ts) */
let findCache: FindCache | undefined;
export const setFindCache = (cache: FindCache | undefined) => void (findCache = cache);

/** findKey of each record's find, by position in `records` */
const findKeys: string[] = [];

const IDENT = String.raw`(?:[A-Za-z_$][\w$]*)`;

/** Expands `\i` in a RegExp match into the identifier pattern. Strings are matched literally. */
export function canonicalizeMatch(match: string | RegExp) {
    if (typeof match === "string") return match;
    const source = match.source.replace(/(?<!\\)\\i/g, IDENT);
    return new RegExp(source, match.flags);
}

/** Expands `$self` in a replacement into a reference to the plugin at runtime */
export function canonicalizeReplace(replace: Replacement["with"], plugin: string): Replacement["with"] {
    const self = `Evi.$(${JSON.stringify(plugin)})`;
    if (typeof replace === "string") return replace.replaceAll("$self", self);
    return (...args) => replace(...args).replaceAll("$self", self);
}

/** RegExp finds with `\i` expanded, made once per find: it's tested against every module */
const canonicalFinds = new WeakMap<RegExp, RegExp>();

export function matchesFind(code: string, find: string | RegExp) {
    if (typeof find === "string") return code.includes(find);
    let canonical = canonicalFinds.get(find);
    if (!canonical) {
        const expanded = canonicalizeMatch(find) as RegExp;
        // Without \i it's the find itself
        canonicalFinds.set(find, canonical = expanded.source === find.source ? find : expanded);
    }
    canonical.lastIndex = 0;
    return canonical.test(code);
}

/** Method shorthand factories like `123(e,t,n){...}` are not expressions, turn them into functions */
export function normalizeFactorySource(code: string) {
    if (/^(?:function\b|async\b|\()/.test(code)) return code;
    return code.replace(/^(?:[\w$]+|"(?:[^"\\]|\\.)*")(?=\s*\()/, "function");
}

export type CompileResult = { ok: true; factory: ModuleFactory; } | { ok: false; error: string; };

/** Compiles normalized factory source without running it */
export function tryCompile(code: string, moduleId: string): CompileResult {
    try {
        // Indirect eval: global scope, no access to our locals
        return { ok: true, factory: (0, eval)(`0,${code}\n//# sourceURL=evi://modules/${moduleId}.js`) };
    } catch (err) {
        return { ok: false, error: String(err) };
    }
}

export function registerPatches(plugin: string, patches: SourcePatch[]) {
    patches.forEach((patch, index) => {
        records.push({ plugin, index, patch, state: "pending", modules: [], errors: [] });
        findKeys.push(findKey(patch.find));
    });
}

export function unregisterPatches(plugin: string) {
    for (let i = records.length - 1; i >= 0; i--) {
        if (records[i].plugin !== plugin) continue;
        records.splice(i, 1);
        findKeys.splice(i, 1);
    }
}

export function getPatchRecords(plugin?: string) {
    return plugin ? records.filter(r => r.plugin === plugin) : [...records];
}

interface Step {
    record: PatchRecord;
    /** Whether the record already listed this module before this run */
    appliedHere: boolean;
    /** Code before and after this patch */
    before: string;
    next: string;
    replacements: number;
    failed: number;
    errors: string[];
    /** A broad optional patch that turned out to have nothing to do here */
    skipped?: boolean;
}

function runReplacements(step: Step, moduleId: string) {
    const { record: { patch, plugin }, before } = step;
    const replacements = Array.isArray(patch.replace) ? patch.replace : [patch.replace];
    const errors: string[] = [];
    let next = before;
    let failed = 0;

    replacements.forEach((r, i) => {
        const prev = next;
        try {
            next = next.replace(canonicalizeMatch(r.match) as any, canonicalizeReplace(r.with, plugin) as any);
        } catch (err) {
            errors.push(`module ${moduleId}, replacement ${i}: ${err}`);
        }
        if (next === prev) {
            failed++;
            errors.push(`module ${moduleId}, replacement ${i} matched nothing: ${String(r.match)}`);
        }
    });

    // A broad optional patch with nothing to do in this module: neither applied nor failed here
    step.skipped = patch.all && patch.optional && next === before && !step.appliedHere;
    step.next = patch.group && failed ? before : next;
    step.replacements = replacements.length;
    step.failed = failed;
    step.errors = errors;
}

/**
 * Applies every relevant patch to one module factory.
 *
 * @param source  the factory's original source (shared with other consumers, computed lazily)
 * @param rerun   the module already ran and is being re-run by live replacement: patches that were
 *                already applied to it count again, and nothing new is logged for them
 */
export function applySourcePatches(
    moduleId: string,
    factory: ModuleFactory,
    source: () => string,
    rerun = false,
): { factory: ModuleFactory; patchedBy: string[]; } {
    const patchedBy: string[] = [];
    if (!records.length) return { factory, patchedBy };

    let originalCode: string | undefined;
    let code = "";
    const steps: Step[] = [];
    const known = findCache?.lookup(moduleId, source());

    for (let r = 0; r < records.length; r++) {
        const record = records[r];
        const { patch } = record;
        // A single-module patch is done once it found its module
        if (!patch.all && record.modules.length && !(rerun && record.modules.includes(moduleId))) continue;

        // The index knows this module doesn't match: same answer as searching it, without the search
        if (known && !known.has(findKeys[r]) && findCache!.covers(findKeys[r])) continue;
        // Always match against the original, so plugins can't break each other's finds
        if (!matchesFind(source(), patch.find)) continue;
        const appliedHere = record.modules.includes(moduleId);
        if (originalCode === undefined) {
            originalCode = normalizeFactorySource(source());
            code = originalCode;
        }

        try {
            if (patch.predicate && !patch.predicate()) continue;
        } catch (err) {
            record.errors.push(`predicate threw: ${err}`);
            continue;
        }

        const step = { record, appliedHere, before: code } as Step;
        runReplacements(step, moduleId);
        steps.push(step);
        if (step.skipped) continue;
        if (!appliedHere) record.modules.push(moduleId);
        code = step.next;
    }
    if (!steps.length) return { factory, patchedBy };

    // Compiling is the expensive part: once for all patches together, and patch by patch only when
    // that fails, to revert just the patch that breaks the module
    let compiled = code !== originalCode ? tryCompile(code, moduleId) : undefined;
    if (compiled && !compiled.ok) {
        compiled = undefined;
        code = originalCode!;
        for (const step of steps) {
            if (step.before !== code) {
                // An earlier patch was reverted: this one applies to different code now
                const { skipped } = step;
                step.before = code;
                runReplacements(step, moduleId);
                const { modules } = step.record;
                if (step.skipped && !skipped && !step.appliedHere) modules.splice(modules.indexOf(moduleId), 1);
                if (!step.skipped && skipped && !step.appliedHere) modules.push(moduleId);
            }
            if (step.skipped || step.next === code) continue;
            const result = tryCompile(step.next, moduleId);
            if (result.ok) {
                compiled = result;
                code = step.next;
            } else {
                step.failed = step.replacements;
                step.errors.push(`module ${moduleId}: patched code does not compile, patch reverted: ${result.error}`);
                step.next = code;
            }
        }
    }

    for (const { record, before, next, replacements, failed, errors, skipped } of steps) {
        if (skipped) continue;
        if (next !== before) patchedBy.push(record.plugin);
        record.state = failed === 0 ? "applied" : failed < replacements && !record.patch.group ? "partial" : "failed";
        if (!rerun || record.state !== "applied") record.errors.push(...errors);
        if (record.state !== "applied" && !rerun) {
            logger.warn(`Patch ${record.index} of ${record.plugin} ${record.state} on module ${moduleId}`, errors);
        }
    }

    return { factory: compiled?.ok ? compiled.factory : factory, patchedBy };
}
