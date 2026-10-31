/**
 * Hotfixes: when a Discord update breaks a plugin, Evi's team publishes the repair on evi.rest and
 * every install picks it up within minutes. No new plugin version, no waiting for its author.
 *
 * A hotfix is for one plugin and a range of its versions, and swaps out the pieces Discord broke:
 * a source patch's find and/or replacements (by its place in `patches`, guarded by the find it has
 * now so a version that moved its patches around isn't touched), and lookups the plugin waits for
 * through its context (by the target the Patches tab shows, e.g. `component "CHAT_INPUT"`), and can
 * add CSS after the plugin's own. At most one is active per plugin version; changing it publishes a new revision.
 *
 * Evi itself takes hotfixes the same way, as the plugin id CORE_HOTFIX_ID with Evi's versions as the
 * range: its own patches by their slot (renderer/patching/source.ts CORE_PATCH_SLOTS), its own lookups
 * by target, and CSS after Evi's stylesheet (renderer/coreHotfix.ts). Evis before 3.2.0 have no plugin
 * with that id and ignore it.
 *
 * Hotfixes put code into Discord's modules, like the plugin code the store serves, so the same
 * people can publish them: Evi's admins, on evi.rest (server/src/hotfixes.ts). Installs fetch the
 * active ones through main, which keeps the last answer on disk (BootData.hotfixes), and hear about
 * new ones on evi.rest's change stream. Health reports from an install running one carry its
 * revision, so the server can tell a fix that works ("Fixed by Evi") from one that doesn't.
 */
import { compareVersions, isPluginId, isVersion } from "./store";

/** Text to match literally, or a RegExp as its source and flags. Patches may use \i, like in plugins. */
export type HotfixPattern = string | { regex: string; flags?: string; };

export interface HotfixReplacement {
    match: HotfixPattern;
    /** String.prototype.replace's replacement: $1, $&, and $self for the plugin */
    with: string;
}

/** A new find and/or replacements for one of the plugin's source patches */
export interface HotfixPatch {
    /** Its place in the plugin's `patches`, from 0 */
    index: number;
    /** The find it has now: a plugin version whose patch there finds something else is left alone */
    was?: HotfixPattern;
    find?: HotfixPattern;
    /** Every replacement of the patch, in order */
    replace?: HotfixReplacement[];
}

export type HotfixLookupKind = "props" | "code" | "component" | "store";
export const HOTFIX_LOOKUP_KINDS: readonly HotfixLookupKind[] = ["props", "code", "component", "store"];

/** A new target for something the plugin waits for (ctx.waitFor, ctx.hookExport) */
export interface HotfixLookup {
    /** What it looks for now, as the Patches tab shows it: `props sendMessage, editMessage, method sendMessage` */
    target: string;
    /** What to look for instead: filters.byProps / byCode / componentByCode / byStoreName with `args` */
    kind: HotfixLookupKind;
    args: HotfixPattern[];
    /** A hooked method that was renamed */
    method?: string;
}

/** What an admin publishes (POST /v1/admin/hotfixes) */
export interface HotfixInput {
    plugin: string;
    /** The versions it fixes, both ends included; left out, the range is open on that side */
    from?: string;
    to?: string;
    /** Shown to users: what Evi fixed. Plain words, one sentence */
    note: string;
    patches: HotfixPatch[];
    lookups: HotfixLookup[];
    /**
     * Added after the plugin's CSS, or Evi's stylesheet for CORE_HOTFIX_ID. Evis before 3.2.0 drop a
     * hotfix that only has CSS (their check wants a patch or a lookup), and ignore it on one that has both.
     */
    css?: string;
}

/** The plugin id a hotfix for Evi itself has. No plugin can have it: the store refuses it */
export const CORE_HOTFIX_ID = "evi";

/** A published hotfix, as GET /v1/hotfixes hands them out */
export interface Hotfix extends HotfixInput {
    id: number;
    /** Goes up each time it's changed */
    revision: number;
    /** When this revision was published, epoch ms */
    at: number;
}

export const HOTFIX_LIMITS = {
    note: 300,
    patches: 16,
    replacements: 8,
    lookups: 16,
    args: 8,
    /** A find, match or lookup argument */
    pattern: 2000,
    with: 4000,
    target: 500,
    css: 20_000,
    /** Active hotfixes a client takes */
    active: 500,
} as const;

const FLAGS_RE = /^(?!.*(.).*\1)[dgimsuy]*$/;
const METHOD_RE = /^[A-Za-z_$][\w$]{0,99}$/;
const TAG_RE = /^\d{1,9}\.\d{1,9}$/;
const clean = (text: string) => !/[\0-\x08\x0e-\x1f]/.test(text);

const IDENT = String.raw`(?:[A-Za-z_$][\w$]*)`;
/** \i as the patcher expands it (renderer/patching/source.ts canonicalizeMatch) */
const expandIdent = (source: string) => source.replace(/(?<!\\)\\i/g, IDENT);

/** "12.3": hotfix 12, revision 3. What health reports carry. */
export const hotfixTag = (h: Pick<Hotfix, "id" | "revision">) => `${h.id}.${h.revision}`;
export const isHotfixTag = (v: unknown): v is string => typeof v === "string" && TAG_RE.test(v);

/** A pattern as the patcher and finders take it. \i is left for the patcher to expand. */
export function fromPattern(p: HotfixPattern): string | RegExp {
    return typeof p === "string" ? p : new RegExp(p.regex, p.flags ?? "");
}

export function toPattern(v: string | RegExp): HotfixPattern {
    return typeof v === "string" ? v : { regex: v.source, ...(v.flags && { flags: v.flags }) };
}

/** Whether a plugin's find is the one a hotfix expects */
export function samePattern(value: string | RegExp, p: HotfixPattern) {
    if (typeof p === "string") return value === p;
    return value instanceof RegExp && value.source === p.regex && value.flags === (p.flags ?? "");
}

/** Why a pattern can't be used, or undefined. `patch`: \i is expanded first, as the patcher does. */
function whyNotPattern(raw: unknown, patch: boolean): string | undefined {
    if (typeof raw === "string") return raw && raw.length <= HOTFIX_LIMITS.pattern ? undefined : `must be 1-${HOTFIX_LIMITS.pattern} characters`;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return "must be text or { regex, flags }";
    const { regex, flags = "" } = raw as { regex?: unknown; flags?: unknown; };
    if (typeof regex !== "string" || !regex || regex.length > HOTFIX_LIMITS.pattern) return `regex must be 1-${HOTFIX_LIMITS.pattern} characters`;
    if (typeof flags !== "string" || !FLAGS_RE.test(flags)) return "flags must be some of dgimsuy";
    try {
        new RegExp(patch ? expandIdent(regex) : regex, flags);
    } catch (err) {
        return `regex doesn't compile: ${(err as Error).message}`;
    }
}

/** The pattern with nothing extra on it, as stored and sent */
const cleanPattern = (raw: HotfixPattern): HotfixPattern => typeof raw === "string" ? raw : { regex: raw.regex, ...(raw.flags && { flags: raw.flags }) };

function validatePatch(raw: unknown, at: string): { patch: HotfixPatch; } | { error: string; } {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { error: `${at} must be an object` };
    const e = raw as Record<string, unknown>;
    if (!Number.isSafeInteger(e.index) || (e.index as number) < 0 || (e.index as number) > 63) return { error: `${at}.index must be the patch's place in patches, 0-63` };
    const patch: HotfixPatch = { index: e.index as number };
    for (const key of ["was", "find"] as const) {
        if (e[key] === undefined) continue;
        const bad = whyNotPattern(e[key], true);
        if (bad) return { error: `${at}.${key} ${bad}` };
        patch[key] = cleanPattern(e[key] as HotfixPattern);
    }
    if (e.replace !== undefined) {
        if (!Array.isArray(e.replace) || !e.replace.length || e.replace.length > HOTFIX_LIMITS.replacements) return { error: `${at}.replace must be 1-${HOTFIX_LIMITS.replacements} replacements` };
        patch.replace = [];
        for (const [i, r] of e.replace.entries()) {
            const where = `${at}.replace[${i}]`;
            if (!r || typeof r !== "object") return { error: `${where} must be { match, with }` };
            const bad = whyNotPattern(r.match, true);
            if (bad) return { error: `${where}.match ${bad}` };
            if (typeof r.with !== "string" || r.with.length > HOTFIX_LIMITS.with) return { error: `${where}.with must be text, at most ${HOTFIX_LIMITS.with} characters` };
            patch.replace.push({ match: cleanPattern(r.match), with: r.with });
        }
    }
    if (!patch.find && !patch.replace) return { error: `${at} must change the find, the replacements or both` };
    return { patch };
}

function validateLookup(raw: unknown, at: string): { lookup: HotfixLookup; } | { error: string; } {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { error: `${at} must be an object` };
    const e = raw as Record<string, unknown>;
    if (typeof e.target !== "string" || !e.target.trim() || e.target.length > HOTFIX_LIMITS.target || !clean(e.target)) return { error: `${at}.target must be what the Patches tab shows for it` };
    if (!HOTFIX_LOOKUP_KINDS.includes(e.kind as HotfixLookupKind)) return { error: `${at}.kind must be one of ${HOTFIX_LOOKUP_KINDS.join(", ")}` };
    const kind = e.kind as HotfixLookupKind;
    if (!Array.isArray(e.args) || !e.args.length || e.args.length > HOTFIX_LIMITS.args) return { error: `${at}.args must be 1-${HOTFIX_LIMITS.args} items` };
    if (kind === "store" && e.args.length !== 1) return { error: `${at}.args must be one store name` };
    const args: HotfixPattern[] = [];
    for (const [i, arg] of e.args.entries()) {
        // Props and store names are plain names; code can be text or a RegExp, which finders don't expand \i in
        if ((kind === "props" || kind === "store") && typeof arg !== "string") return { error: `${at}.args[${i}] must be a name` };
        const bad = whyNotPattern(arg, false);
        if (bad) return { error: `${at}.args[${i}] ${bad}` };
        args.push(cleanPattern(arg));
    }
    if (e.method !== undefined && (typeof e.method !== "string" || !METHOD_RE.test(e.method))) return { error: `${at}.method must be a function name` };
    return { lookup: { target: e.target.trim(), kind, args, ...(typeof e.method === "string" && { method: e.method }) } };
}

export function validateHotfixInput(raw: unknown): { hotfix: HotfixInput; } | { error: string; } {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { error: "Send { plugin, from?, to?, note, patches?, lookups?, css? }" };
    const e = raw as Record<string, unknown>;
    if (!isPluginId(e.plugin)) return { error: "plugin must be a plugin id" };
    for (const key of ["from", "to"] as const) {
        if (e[key] !== undefined && e[key] !== null && e[key] !== "" && !isVersion(e[key])) return { error: `${key} must look like 1.2.3, or be left out` };
    }
    const from = isVersion(e.from) ? e.from : undefined;
    const to = isVersion(e.to) ? e.to : undefined;
    if (from && to && compareVersions(from, to) > 0) return { error: "from must not be newer than to" };
    if (typeof e.note !== "string" || !e.note.trim() || e.note.length > HOTFIX_LIMITS.note || !clean(e.note)) return { error: `The note must be 1-${HOTFIX_LIMITS.note} characters: people see it` };

    const patchesIn = e.patches ?? [];
    const lookupsIn = e.lookups ?? [];
    if (!Array.isArray(patchesIn) || patchesIn.length > HOTFIX_LIMITS.patches) return { error: `patches must be a list of at most ${HOTFIX_LIMITS.patches}` };
    if (!Array.isArray(lookupsIn) || lookupsIn.length > HOTFIX_LIMITS.lookups) return { error: `lookups must be a list of at most ${HOTFIX_LIMITS.lookups}` };
    if (e.css !== undefined && (typeof e.css !== "string" || e.css.length > HOTFIX_LIMITS.css || !clean(e.css))) return { error: `css must be text, at most ${HOTFIX_LIMITS.css} characters` };
    const css = typeof e.css === "string" && e.css.trim() ? e.css : undefined;
    if (!patchesIn.length && !lookupsIn.length && !css) return { error: "A hotfix must fix at least one patch or lookup, or add CSS" };

    const patches: HotfixPatch[] = [];
    for (const [i, p] of patchesIn.entries()) {
        const checked = validatePatch(p, `patches[${i}]`);
        if ("error" in checked) return checked;
        // Evi's patches are told apart by their slot and their find together
        if (e.plugin === CORE_HOTFIX_ID && !checked.patch.was) return { error: `patches[${i}].was must be the find the patch has now: Evi's own patches need it` };
        if (patches.some(q => q.index === checked.patch.index)) return { error: `patches[${i}]: patch ${checked.patch.index} is already fixed above` };
        patches.push(checked.patch);
    }
    const lookups: HotfixLookup[] = [];
    for (const [i, l] of lookupsIn.entries()) {
        const checked = validateLookup(l, `lookups[${i}]`);
        if ("error" in checked) return checked;
        if (lookups.some(q => q.target === checked.lookup.target)) return { error: `lookups[${i}]: that target is already fixed above` };
        lookups.push(checked.lookup);
    }
    return { hotfix: { plugin: e.plugin, ...(from && { from }), ...(to && { to }), note: e.note.trim(), patches, lookups, ...(css && { css }) } };
}

/** GET /v1/hotfixes (or its copy on disk), cleaned. Anything malformed is left out. */
export function parseHotfixes(raw: unknown): Hotfix[] {
    const list = (raw as { hotfixes?: unknown; } | null)?.hotfixes;
    if (!Array.isArray(list)) return [];
    const out: Hotfix[] = [];
    for (const item of list.slice(0, HOTFIX_LIMITS.active)) {
        const e = item as Record<string, unknown> | null;
        if (!e || !Number.isSafeInteger(e.id) || !Number.isSafeInteger(e.revision) || typeof e.at !== "number") continue;
        if ((e.id as number) < 1 || (e.revision as number) < 1) continue;
        const checked = validateHotfixInput(e);
        if ("error" in checked) continue;
        out.push({ id: e.id as number, revision: e.revision as number, at: e.at, ...checked.hotfix });
    }
    return out;
}

/** Whether a version is in a hotfix's range. A plugin without a version only matches an open range. */
export function inHotfixRange(h: Pick<HotfixInput, "from" | "to">, version: string | undefined) {
    if (!isVersion(version)) return !h.from && !h.to;
    return (!h.from || compareVersions(version, h.from) >= 0) && (!h.to || compareVersions(version, h.to) <= 0);
}

/** Whether two ranges share a version: one plugin version gets one hotfix */
export function hotfixRangesOverlap(a: Pick<HotfixInput, "from" | "to">, b: Pick<HotfixInput, "from" | "to">) {
    if (a.to && b.from && compareVersions(a.to, b.from) < 0) return false;
    if (b.to && a.from && compareVersions(b.to, a.from) < 0) return false;
    return true;
}

/** The hotfix for a plugin at this version, if any */
export function hotfixFor(hotfixes: readonly Hotfix[] | undefined, plugin: string, version: string | undefined): Hotfix | undefined {
    return hotfixes?.find(h => h.plugin === plugin && inHotfixRange(h, version));
}

/** The fix for the patch at `index`, when the hotfix has one and the patch finds what it expects */
export function patchFixFor(hotfix: Hotfix | undefined, index: number, find: string | RegExp): HotfixPatch | undefined {
    const fix = hotfix?.patches.find(p => p.index === index);
    return fix && (!fix.was || samePattern(find, fix.was)) ? fix : undefined;
}

/**
 * A plugin's patches with the hotfix's fixes in place: new objects for the fixed ones, the rest as
 * they are. The plugin's own definition isn't changed, so a withdrawn fix is simply not applied again.
 */
export function applyPatchFixes<P extends { find: string | RegExp; replace: unknown; }>(patches: readonly P[] | undefined, hotfix: Hotfix | undefined): P[] | undefined {
    if (!patches || !hotfix?.patches.length) return patches as P[] | undefined;
    return patches.map((patch, index) => {
        const fix = patchFixFor(hotfix, index, patch.find);
        if (!fix) return patch;
        return {
            ...patch,
            find: fix.find ? fromPattern(fix.find) : patch.find,
            replace: fix.replace ? fix.replace.map(r => ({ match: fromPattern(r.match), with: r.with })) : patch.replace,
        };
    });
}

/** The fix for a lookup, by what it looks for now (`target`, as lookups.ts describes it) */
export function lookupFixFor(hotfix: Hotfix | undefined, target: string): HotfixLookup | undefined {
    return hotfix?.lookups.find(l => l.target === target);
}

/**
 * A hotfix for one patch, filled in from the Patch Helper, to paste into the admin page on evi.rest.
 * The note is left for whoever publishes it.
 */
export function hotfixDraft({ plugin, version, index, was, find, match, replace }: {
    plugin: string;
    version?: string;
    index: number;
    was: string | RegExp;
    find: string | RegExp;
    match: string | RegExp;
    replace: string;
}): HotfixInput {
    const fix: HotfixPatch = { index, was: toPattern(was) };
    if (!samePattern(find, fix.was!)) fix.find = toPattern(find);
    fix.replace = [{ match: toPattern(match), with: replace }];
    return { plugin, ...(isVersion(version) && { from: version, to: version }), note: "", patches: [fix], lookups: [] };
}
