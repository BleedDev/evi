/**
 * Plugin clashes: store plugins that don't work together on Discord's current build, because one's
 * source patch changes the code another's looks for (or together the module no longer compiles).
 *
 * Found by scripts/clashes (run on a schedule in CI, never on evi.rest): it applies every store plugin's
 * patches to Discord's current modules the way the patcher does (finds match the original module,
 * replacements chain), two plugins at a time in both orders. The report goes to evi.rest
 * (PUT /v1/clashes), which serves it in GET /v1/health as `clashes`, tells both plugins' authors about a
 * new one, and the store warns before someone installs a plugin that clashes with one they have.
 * Evi itself names the plugin that got there first once a patch fails (patching/source.ts conflicts).
 *
 * Pure: no DOM, no network, shared by the server, the checker, Evi and the tests.
 */
import { isPluginId, isVersion } from "./store";

export interface PluginClash {
    /** The plugin whose patch, run first, changed the code */
    by: string;
    byVersion: string;
    /** The plugin that then doesn't fully apply */
    breaks: string;
    breaksVersion: string;
    /** patch: a replacement of `breaks` matches nothing after `by`'s; compile: together the module doesn't compile */
    kind: "patch" | "compile";
    /** Discord's module id */
    module: string;
    /** The index of `breaks`'s patch that fails, for kind patch */
    patch?: number;
}

export interface ClashReport {
    /** Discord's web build the modules came from (the entry script's hash) */
    discordBuild: string;
    /** Every store plugin checked, by id: the stable version. A plugin that changed since isn't covered. */
    plugins: Record<string, string>;
    /** Epoch ms, when it was worked out */
    at: number;
    clashes: PluginClash[];
}

export const MAX_CLASHES = 500;
export const MAX_CHECKED_PLUGINS = 2000;

const isBuild = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9._-]{1,64}$/.test(v);
const isModule = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9_-]{1,32}$/.test(v);

function parseClash(raw: unknown): PluginClash | undefined {
    const c = (raw ?? {}) as Record<string, unknown>;
    if (!isPluginId(c.by) || !isPluginId(c.breaks) || c.by === c.breaks) return;
    if (!isVersion(c.byVersion) || !isVersion(c.breaksVersion)) return;
    if (c.kind !== "patch" && c.kind !== "compile") return;
    if (!isModule(c.module)) return;
    const patch = Number.isInteger(c.patch) && (c.patch as number) >= 0 && (c.patch as number) < 1000 ? c.patch as number : undefined;
    return { by: c.by, byVersion: c.byVersion, breaks: c.breaks, breaksVersion: c.breaksVersion, kind: c.kind, module: c.module, ...(patch !== undefined && { patch }) };
}

/** A clash list from anywhere untrusted, cleaned: malformed ones left out, duplicates once */
export function parseClashes(raw: unknown): PluginClash[] {
    if (!Array.isArray(raw)) return [];
    const seen = new Set<string>();
    const out: PluginClash[] = [];
    for (const r of raw.slice(0, MAX_CLASHES * 2)) {
        const c = parseClash(r);
        if (!c) continue;
        const key = clashKey(c);
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(c);
        if (out.length >= MAX_CLASHES) break;
    }
    return out;
}

/** PUT /v1/clashes's body, checked */
export function validateClashReport(raw: unknown): { report: Omit<ClashReport, "at">; } | { error: string; } {
    const r = (raw ?? {}) as Record<string, unknown>;
    if (!isBuild(r.discordBuild)) return { error: "discordBuild must be Discord's build id" };
    if (!r.plugins || typeof r.plugins !== "object" || Array.isArray(r.plugins)) return { error: "plugins must map plugin ids to the versions checked" };
    const entries = Object.entries(r.plugins as Record<string, unknown>);
    if (entries.length > MAX_CHECKED_PLUGINS) return { error: `At most ${MAX_CHECKED_PLUGINS} plugins` };
    const plugins: Record<string, string> = {};
    for (const [id, v] of entries) {
        if (!isPluginId(id) || !isVersion(v)) return { error: `plugins: ${id.slice(0, 64)} needs a version like 1.2.3` };
        plugins[id] = v;
    }
    if (!Array.isArray(r.clashes) || r.clashes.length > MAX_CLASHES) return { error: `clashes must be a list of at most ${MAX_CLASHES}` };
    const clashes = parseClashes(r.clashes);
    if (clashes.length !== r.clashes.length) return { error: "Every clash needs by, byVersion, breaks, breaksVersion, kind and module, once each" };
    return { report: { discordBuild: r.discordBuild, plugins, clashes } };
}

/** One per pair of versions and module, whichever way round: what "the same clash" means between runs */
export const clashKey = (c: PluginClash) => `${c.by}@${c.byVersion}>${c.breaks}@${c.breaksVersion}#${c.module}:${c.kind}`;

/** A pair of plugin versions, without direction: for "don't work together" */
export const pairKey = (c: PluginClash) => [`${c.by}@${c.byVersion}`, `${c.breaks}@${c.breaksVersion}`].sort().join("+");

/**
 * The plugins among `others` (id -> the version you have) that don't work together with `id` at
 * `version`, whichever one breaks the other, each once. The same versions as were checked only: a
 * different version of either may be fine.
 */
export function clashingWith(clashes: readonly PluginClash[], id: string, version: string, others: ReadonlyMap<string, string>): string[] {
    const out = new Set<string>();
    for (const c of clashes) {
        const [mine, theirs, theirVersion] = c.by === id && c.byVersion === version
            ? [true, c.breaks, c.breaksVersion]
            : c.breaks === id && c.breaksVersion === version ? [true, c.by, c.byVersion] : [false, "", ""];
        if (mine && theirs !== id && others.get(theirs) === theirVersion) out.add(theirs);
    }
    return [...out];
}
