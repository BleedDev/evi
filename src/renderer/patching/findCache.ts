/**
 * Remembers, per Discord build, which modules each source patch `find` matches, so the next start
 * doesn't search every module's source for every find again (most of the time patching takes).
 *
 * The index covers a set of modules, each with a fingerprint of its source, and a set of finds, and
 * says for every pair whether it matches. A module whose id and fingerprint are in the index only
 * needs the finds the index says it matches checked, and those are still confirmed against its
 * source. Anything the index doesn't cover (a new chunk, a new find, a module whose source differs)
 * is searched as before, and indexed in idle time for the next start (findIndex.ts).
 */

export interface FindCacheData {
    v: 1;
    /** Discord's build the index was made on */
    build: string;
    /**
     * Entry -> fingerprint of the module's source. The entry is the module id, or `id~fingerprint`
     * for another module under an id already taken (Discord's other bundler runtimes reuse ids).
     */
    modules: Record<string, string>;
    /** Find key -> the entries it matches */
    finds: Record<string, string[]>;
}

/** Keeps the file small enough to read on every start; a bigger index isn't saved */
export const MAX_FIND_CACHE_BYTES = 4 * 1024 * 1024;

const EMPTY: ReadonlySet<string> = new Set();

/** Identifies a find by what it matches: the same text in two patches is one search */
export function findKey(find: string | RegExp) {
    return typeof find === "string" ? `s${find}` : `r${find}`;
}

/** Length and a hash of characters sampled across the source: tells a different module under the same id */
export function fingerprint(source: string) {
    const { length } = source;
    let hash = 0x811c9dc5;
    // Taken of every module as it loads: a few dozen characters are enough
    const step = length / 40;
    for (let i = 0; i < 40; i++) hash = Math.imul(hash ^ source.charCodeAt(Math.floor(i * step)), 0x01000193);
    for (let i = Math.max(0, length - 8); i < length; i++) hash = Math.imul(hash ^ source.charCodeAt(i), 0x01000193);
    return `${length.toString(36)}.${(hash >>> 0).toString(36)}`;
}

/** Length and two hashes of every character: tells a changed index from the one saved, without keeping that */
export function textHash(text: string) {
    let a = 0x811c9dc5, b = 5381;
    for (let i = 0; i < text.length; i++) {
        const c = text.charCodeAt(i);
        a = Math.imul(a ^ c, 0x01000193);
        b = (Math.imul(b, 33) + c) | 0;
    }
    return `${text.length.toString(36)}.${(a >>> 0).toString(36)}.${(b >>> 0).toString(36)}`;
}

/**
 * What saves the index: only when it differs from the last one saved (or read at start), and only
 * when it isn't too big. Keeps a hash of it, not the text.
 */
export function indexSaver(raw: string | undefined, save: (data: string) => void) {
    let saved = raw === undefined ? undefined : textHash(raw);
    return (json: string): "same" | "tooBig" | "saved" => {
        const hash = textHash(json);
        if (hash === saved) return "same";
        if (json.length > MAX_FIND_CACHE_BYTES) return "tooBig";
        saved = hash;
        save(json);
        return "saved";
    };
}

export function parseFindCache(raw: string | undefined): FindCacheData | undefined {
    if (!raw) return;
    try {
        const data = JSON.parse(raw);
        if (data?.v !== 1 || typeof data.build !== "string" || !data.modules || typeof data.modules !== "object" || !data.finds || typeof data.finds !== "object") return;
        for (const ids of Object.values(data.finds)) if (!Array.isArray(ids)) return;
        return data;
    } catch {
        return undefined;
    }
}

/** At most this many modules the index missed are kept for the next indexing */
const MAX_UNINDEXED = 20_000;

export class FindCache {
    private finds = new Set<string>();
    private matches = new Map<string, Set<string>>();
    private data: FindCacheData | undefined;
    private resolved = false;
    /** Modules that ran without being covered, for the next indexing: they may not be in any runtime's list */
    private unindexed: [string, () => string][] = [];

    /**
     * @param currentBuild Discord's build, read when the first module loads (it isn't set when Evi starts)
     * @param onMiss       called when something wasn't covered: a reason to index again
     */
    constructor(data: FindCacheData | undefined, private currentBuild: () => string | undefined, public onMiss?: () => void) {
        this.data = data;
    }

    /** The index, once it is known to be for the running build */
    get current(): FindCacheData | undefined {
        if (!this.resolved) {
            const build = this.currentBuild();
            if (build === undefined) return;
            this.resolved = true;
            if (this.data?.build !== build) this.data = undefined;
            if (this.data) this.load(this.data);
        }
        return this.data;
    }

    /** Swaps in a newer index for the same build */
    replace(data: FindCacheData) {
        this.data = data;
        this.resolved = true;
        this.finds.clear();
        this.matches.clear();
        this.load(data);
    }

    private load(data: FindCacheData) {
        for (const key in data.finds) {
            this.finds.add(key);
            for (const entry of data.finds[key]) {
                let set = this.matches.get(entry);
                if (!set) this.matches.set(entry, set = new Set());
                set.add(key);
            }
        }
    }

    /** The index's entry for this module, if it has one */
    entry(id: string, fp: string): string | undefined {
        const modules = this.current?.modules;
        if (!modules) return;
        if (modules[id] === fp) return id;
        const other = `${id}~${fp}`;
        if (modules[other] === fp) return other;
    }

    /** The covered finds this module matches, or undefined when the index doesn't cover the module */
    lookup(id: string, source: string): ReadonlySet<string> | undefined {
        const entry = this.entry(id, fingerprint(source));
        if (entry !== undefined) return this.matches.get(entry) ?? EMPTY;
        if (this.unindexed.length < MAX_UNINDEXED) this.unindexed.push([id, () => source]);
        this.onMiss?.();
    }

    /** Whether the index answers for this find */
    covers(key: string) {
        if (this.finds.has(key)) return true;
        this.onMiss?.();
        return false;
    }

    /** What the index says for one entry and find: true/false, or undefined when it doesn't know */
    knows(entry: string | undefined, key: string): boolean | undefined {
        if (entry === undefined || !this.finds.has(key)) return;
        return this.matches.get(entry)?.has(key) ?? false;
    }

    /** Modules that ran uncovered since the last call */
    takeUnindexed() {
        const taken = this.unindexed;
        this.unindexed = [];
        return taken;
    }
}

/**
 * Builds the index for these modules and finds, one module per step so it can run in idle slices.
 * Answers the old index already has are reused. Modules the old index covered that aren't loaded
 * now are kept when the old index answers every find, so chunks that load later stay covered.
 *
 * @param sources [id, source] of every module to cover
 */
export function* buildFindIndex(
    old: FindCache | undefined,
    build: string,
    sources: Iterable<[id: string, source: () => string]>,
    finds: Map<string, string | RegExp>,
    matches: (source: string, find: string | RegExp) => boolean,
): Generator<void, FindCacheData> {
    const modules: Record<string, string> = Object.create(null);
    const hits = new Map<string, string[]>([...finds.keys()].map(key => [key, []]));

    for (const [id, source] of sources) {
        const src = source();
        const fp = fingerprint(src);
        const entry = !(id in modules) ? id : modules[id] === fp ? undefined : `${id}~${fp}`;
        if (entry === undefined || entry in modules) continue;
        modules[entry] = fp;
        const known = old?.entry(id, fp);
        for (const [key, find] of finds) {
            if (old?.knows(known, key) ?? matches(src, find)) hits.get(key)!.push(entry);
        }
        yield;
    }

    const prev = old?.current;
    if (prev?.build === build && [...finds.keys()].every(key => key in prev.finds)) {
        for (const entry in prev.modules) {
            if (entry in modules) continue;
            modules[entry] = prev.modules[entry];
            for (const key of finds.keys()) if (old!.knows(entry, key)) hits.get(key)!.push(entry);
        }
    }

    const out: Record<string, string[]> = {};
    for (const [key, entries] of hits) out[key] = entries.sort();
    return { v: 1, build, modules: { ...modules }, finds: out };
}
