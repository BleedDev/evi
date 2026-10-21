import { getUnhooked } from "../patching/hooks";
import { lazy } from "../utils/lazy";
import { getOriginalFactory, moduleListeners, stats, WebpackRequire, wreq } from "./runtime";

export type Filter = ((value: any) => boolean) & {
    /**
     * Snippets the defining module's source must contain. A function's source is part of its
     * module's source, so waitFor can skip every other module with one string search instead of
     * stringifying each exported function.
     */
    $code?: CodeMatcher[];
    /** What the filter looks for, in words, for diagnostics */
    $label?: string;
};
export type CodeMatcher = string | RegExp;

export interface FoundExport<T = any> {
    /** Module id */
    id: string;
    /** The module's exports object */
    exports: any;
    /** The export key holding `value`, or undefined when `value` is the exports object itself */
    key: string | undefined;
    value: T;
}

const sourceCache = new WeakMap<Function, string>();

export function functionSource(fn: Function) {
    // A hooked function is our wrapper: finders must see the code of what it wraps, otherwise
    // hooking an export makes it unfindable by code for every other plugin
    fn = getUnhooked(fn);
    let src = sourceCache.get(fn);
    if (src === undefined) {
        try {
            src = Function.prototype.toString.call(fn);
        } catch {
            src = "";
        }
        sourceCache.set(fn, src);
    }
    return src;
}

export function matchesAll(source: string, code: CodeMatcher[]) {
    return code.every(c => {
        if (typeof c === "string") return source.includes(c);
        // A global or sticky RegExp starts where its last test ended, often in another source
        c.lastIndex = 0;
        return c.test(source);
    });
}

/** Unwraps React.memo / forwardRef / lazy wrappers down to the render function */
function unwrapComponent(value: any): Function | undefined {
    if (typeof value === "function") return value;
    if (value?.$$typeof) return unwrapComponent(value.render ?? value.type);
}

const showCode = (code: CodeMatcher[]) => code.map(c => typeof c === "string" ? JSON.stringify(c) : String(c)).join(", ");
const withCode = (code: CodeMatcher[], filter: Filter): Filter => Object.assign(filter, { $code: code });
const labeled = (label: string, filter: Filter): Filter => Object.assign(filter, { $label: label });

/**
 * Filters built by `filters` from equal arguments look for the same thing: waiters holding them test
 * each module once between them (Evi's own UI alone waits for byProps("createRoot") several times).
 */
const filterArgs = new WeakMap<Filter, [kind: string, args: string | CodeMatcher[]]>();
const keyed = (kind: string, args: string | CodeMatcher[], filter: Filter): Filter => (filterArgs.set(filter, [kind, args]), filter);

function filterKey(filter: Filter): unknown {
    const made = filterArgs.get(filter);
    const key = made && argsKey(made[1]);
    return key === undefined ? filter : made![0] + key;
}

/**
 * A key equal for equal strings and RegExps, or undefined for anything else (plain JS callers can pass
 * anything) and for global or sticky RegExps, whose every test depends on the last.
 */
function argsKey(args: string | CodeMatcher[]) {
    const parts: (string | string[])[] = [];
    for (const arg of [args].flat()) {
        if (typeof arg === "string") parts.push(arg);
        else if (arg instanceof RegExp && !arg.global && !arg.sticky) parts.push([arg.source, arg.flags]);
        else return undefined;
    }
    return JSON.stringify(parts);
}

export const filters = {
    /** Objects that have every one of these properties */
    byProps: (...props: string[]): Filter => keyed("props", props, labeled(`props ${props.join(", ")}`, v => props.every(p => v[p] !== undefined))),
    /** Functions whose source contains every snippet */
    byCode: (...code: CodeMatcher[]): Filter => keyed("code", code, labeled(`code ${showCode(code)}`, withCode(code, v => typeof v === "function" && matchesAll(functionSource(v), code)))),
    /** React components (including memo / forwardRef) whose render source contains every snippet */
    componentByCode: (...code: CodeMatcher[]): Filter => keyed("component", code, labeled(`component ${showCode(code)}`, withCode(code, v => {
        const fn = unwrapComponent(v);
        return !!fn && matchesAll(functionSource(fn), code);
    }))),
    /** Flux stores by name, e.g. "UserStore" */
    byStoreName: (name: string): Filter => keyed("store", name, labeled(`store ${name}`, v =>
        v?.constructor?.displayName === name || (typeof v?.getName === "function" && "_dispatchToken" in v && v.getName() === name))),
};

/** What a filter looks for, in words. Hand-written filters without a label show their code hint or source. */
export function describeFilter(filter: Filter) {
    if (filter.$label) return filter.$label;
    if (filter.$code) return `code ${showCode(filter.$code)}`;
    return `filter ${String(filter).replace(/\s+/g, " ").slice(0, 80)}`;
}

// Some Discord exports are Proxies that answer every property access; they'd match any byProps filter
const CANARY = "__eviCanary__";

function isSearchable(value: any) {
    if (value == null) return false;
    const type = typeof value;
    if (type !== "object" && type !== "function") return false;
    // Runs for every export value: a function can't be one of these, so it skips reading document twice
    if (type === "object" && (value === window || value === document || value === document.documentElement)) return false;
    try {
        return value[CANARY] === undefined;
    } catch {
        return false;
    }
}

function test(filter: Filter, value: any) {
    try {
        return filter(value);
    } catch {
        return false;
    }
}

type Candidate = [value: any, key: string | undefined];

/** Exports worth testing: the exports object itself, then each export value */
function collectCandidates(exports: any): Candidate[] {
    if (!isSearchable(exports)) return [];
    const out: Candidate[] = [[exports, undefined]];
    if (typeof exports !== "object") return out;
    for (const key in exports) {
        let value;
        try {
            value = exports[key];
        } catch {
            continue;
        }
        if (isSearchable(value)) out.push([value, key]);
    }
    return out;
}

function searchExports<T>(id: string, exports: any, filter: Filter): FoundExport<T> | undefined {
    if (!isSearchable(exports)) return;
    if (test(filter, exports)) return { id, exports, key: undefined, value: exports };
    if (typeof exports !== "object") return;

    for (const key in exports) {
        let value;
        try {
            value = exports[key];
        } catch {
            continue;
        }
        if (isSearchable(value) && test(filter, value)) return { id, exports, key, value };
    }
}

function requireWreq() {
    if (!wreq) throw new Error("Webpack is not ready yet. Use waitFor or a lazy finder.");
    return wreq;
}

/** Whether module `id` can contain what a code filter looks for, without touching its exports */
function mayContain(wreq: WebpackRequire, id: string, filter: Filter) {
    if (!filter.$code) return true;
    const factory = getOriginalFactory(wreq.m[id]);
    return !factory || matchesAll(functionSource(factory), filter.$code);
}

/** First loaded export matching the filter, with where it lives */
export function findExport<T = any>(filter: Filter): FoundExport<T> | undefined {
    const wreq = requireWreq();
    const { c } = wreq;
    for (const id in c) {
        if (!mayContain(wreq, id, filter)) continue;
        const found = searchExports<T>(id, c[id]?.exports, filter);
        if (found) return found;
    }
}

export function findAllExports<T = any>(filter: Filter): FoundExport<T>[] {
    const wreq = requireWreq();
    const { c } = wreq;
    const results: FoundExport<T>[] = [];
    for (const id in c) {
        if (!mayContain(wreq, id, filter)) continue;
        const found = searchExports<T>(id, c[id]?.exports, filter);
        if (found) results.push(found);
    }
    return results;
}

export const find = <T = any>(filter: Filter) => findExport<T>(filter)?.value;
export const findAll = <T = any>(filter: Filter) => findAllExports<T>(filter).map(f => f.value);
export const findByProps = <T = any>(...props: string[]) => find<T>(filters.byProps(...props));
export const findByCode = <T = any>(...code: CodeMatcher[]) => find<T>(filters.byCode(...code));
export const findComponent = <T = any>(...code: CodeMatcher[]) => find<T>(filters.componentByCode(...code));
/**
 * Stores by name. Plugins ask on every message, row render and presence update, and finding one
 * walks every loaded module (~10k, 10-20 ms), so the first lookup walks once and files every store it
 * passes, and modules that run after that are filed by the next lookup that misses: every later lookup,
 * for any store, is a map read, and new modules' exports are only read for stores when one is missing.
 * Safe to keep: stores are singletons, and live replacement never re-runs a module that holds one
 * (patching/live.ts).
 * A store that still isn't there is searched for the old way at most once a second, and only once more
 * modules have run since: a store Discord renamed would otherwise cost a full walk every second, forever.
 */
const stores = new Map<string, unknown>();
const missing = new Map<string, { at: number; modules: number; }>();
const MISS_RETRY_MS = 1000;
let storesIndexed = false;
/** Exports of modules that ran since the stores were last filed, in the order they ran */
const unfiled: any[] = [];

/** Files a Flux store under its names (see filters.byStoreName). The first one of a name wins, like find. */
function fileStore(value: any) {
    try {
        if (typeof value !== "object" || !("_dispatchToken" in value)) return;
        const displayName = value.constructor?.displayName;
        if (typeof displayName === "string" && !stores.has(displayName)) stores.set(displayName, value);
        const name = typeof value.getName === "function" ? value.getName() : undefined;
        if (typeof name === "string" && !stores.has(name)) stores.set(name, value);
    } catch { }
}

/** Files the stores among a module's candidates (collectCandidates) */
function fileStores(candidates: Candidate[]) {
    for (const [value] of candidates) fileStore(value);
}

function indexStores() {
    if (storesIndexed) {
        for (let i = 0; i < unfiled.length; i++) fileStores(collectCandidates(unfiled[i]));
        unfiled.length = 0;
        return;
    }
    const { c } = requireWreq();
    storesIndexed = true;
    for (const id in c) fileStores(collectCandidates(c[id]?.exports));
}

export function findStore<T = any>(name: string): T | undefined {
    const cached = stores.get(name);
    if (cached) return cached as T;
    indexStores();
    const indexed = stores.get(name);
    if (indexed) return indexed as T;
    const miss = missing.get(name);
    if (miss && (miss.modules === stats.modules || performance.now() - miss.at < MISS_RETRY_MS)) return undefined;
    const store = find<T>(filters.byStoreName(name));
    if (store) {
        stores.set(name, store);
        missing.delete(name);
    } else {
        missing.set(name, { at: performance.now(), modules: stats.modules });
    }
    return store;
}

/**
 * Names of every Flux store loaded so far, sorted (a store with both a class name and a getName()
 * is listed under both). Indexes the loaded modules on first use, like findStore.
 */
export function listStores(): string[] {
    indexStores();
    return [...stores.keys()].sort((a, b) => a.localeCompare(b));
}

interface Waiter {
    filter: Filter;
    callback: (value: any, found: FoundExport) => void;
    /** See filterKey */
    key: unknown;
    /** The same for filter.$code: undefined without one, null when a stateful RegExp makes it unshareable */
    codeKey: string | null | undefined;
}

const waiters = new Set<Waiter>();
/** Pending waitFor filters, for diagnostics */
export const pendingWaiters = () => [...waiters].map(w => describeFilter(w.filter));

/**
 * One listener serves every waiter: each new module's exports are read once, code-based waiters
 * skip modules whose source can't contain their target, and waiters looking for the same thing
 * share one source search and one filter run per module. It also queues modules for the store index.
 */
moduleListeners.add((exports, id, source) => {
    if (!waiters.size && !storesIndexed) return;
    let candidates: Candidate[] | undefined;

    if (waiters.size) {
        let codeHits: Map<string, boolean> | undefined;
        let matches: Map<unknown, number> | undefined;
        for (const waiter of waiters) {
            const { filter, key, codeKey } = waiter;
            if (codeKey === null) {
                if (!matchesAll(source(), filter.$code!)) continue;
            } else if (codeKey !== undefined) {
                let hit = codeHits?.get(codeKey);
                if (hit === undefined) (codeHits ??= new Map()).set(codeKey, hit = matchesAll(source(), filter.$code!));
                if (!hit) continue;
            }

            candidates ??= collectCandidates(exports);
            let index = matches?.get(key);
            if (index === undefined) (matches ??= new Map()).set(key, index = candidates.findIndex(([value]) => test(filter, value)));
            if (index === -1) continue;

            const [value, exportKey] = candidates[index];
            waiters.delete(waiter);
            const t = performance.now();
            try {
                waiter.callback(value, { id, exports, key: exportKey, value });
            } catch (err) {
                console.error("[Evi] waitFor callback threw", err);
            }
            // Callback work (plugin startup, hooking) isn't per-module overhead, account for it separately
            stats.callbackMs += performance.now() - t;
        }
    }

    if (storesIndexed) unfiled.push(exports);
});

/**
 * Calls back once a matching export exists, immediately if it's already loaded.
 * Returns an unsubscribe function.
 */
export function waitFor<T = any>(filter: Filter, callback: (value: T, found: FoundExport<T>) => void): () => void {
    const existing = wreq && findExport<T>(filter);
    if (existing) {
        callback(existing.value, existing);
        return () => { };
    }

    const waiter: Waiter = {
        filter,
        callback,
        key: filterKey(filter),
        codeKey: filter.$code && (argsKey(filter.$code) ?? null),
    };
    waiters.add(waiter);
    return () => void waiters.delete(waiter);
}

export function waitForExport<T = any>(filter: Filter): Promise<FoundExport<T>> {
    return new Promise(resolve => waitFor<T>(filter, (_, found) => resolve(found)));
}

/** A proxy that resolves the export on first use. Safe to create before webpack is ready. */
export function findLazy<T = any>(filter: Filter, description = "export"): T {
    return lazy(() => {
        const value = wreq && find<T>(filter);
        if (value == null) throw new Error(`Evi: could not find ${description}`);
        return value;
    });
}

export const findByPropsLazy = <T = any>(...props: string[]) => findLazy<T>(filters.byProps(...props), `props ${props.join(", ")}`);
export const findByCodeLazy = <T = any>(...code: CodeMatcher[]) => findLazy<T>(filters.byCode(...code), `code ${code.join(", ")}`);
export const findComponentLazy = <T = any>(...code: CodeMatcher[]) => findLazy<T>(filters.componentByCode(...code), `component ${code.join(", ")}`);
export const findStoreLazy = <T = any>(name: string) => findLazy<T>(filters.byStoreName(name), `store ${name}`);

/** Ids of module factories whose source contains every snippet, loaded or not */
export function findModuleIds(...code: CodeMatcher[]) {
    const { m } = requireWreq();
    const ids: string[] = [];
    for (const id in m) {
        const factory = getOriginalFactory(m[id]);
        if (factory && matchesAll(functionSource(factory), code)) ids.push(id);
    }
    return ids;
}

/** Runs (if needed) and returns a module's exports by id */
export function requireModule<T = any>(id: PropertyKey): T {
    return requireWreq()(id);
}
