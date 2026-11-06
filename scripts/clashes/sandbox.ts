/**
 * The sandbox the clash checker runs store plugins in (run with Node: Bun's vm crashes on a timed-out
 * microtask). Plugin code is untrusted, so it only ever runs inside a node:vm context that was given
 * no host object: everything it can reach (the @evi/api stub, require, window and friends, and the
 * patcher itself) is defined by code running inside the context. Values cross the boundary only as
 * strings: the host passes plugin code and Discord's modules in through `__arg`, a property locked
 * before any plugin loads, and gets JSON text back. Every call into the context has a timeout, and
 * microtasks run inside it (microtaskMode "afterEvaluate"), so a plugin can't hang the checker either.
 *
 * Inside, patches are applied the way src/renderer/patching/source.ts does: finds match the original
 * module, a patch without `all` takes the first module it matches, replacements chain, `group` drops
 * a patch whose replacements don't all apply, an `all` + `optional` patch with nothing to do is
 * skipped, `\i` matches any identifier and `$self` becomes Evi.$("<id>").
 *
 * Node only, and no imports from src/: Node can't load them.
 */
import vm from "node:vm";

/** What the patcher found for one pair: like shared/clashes.ts PluginClash, without versions */
export interface RawClash {
    by: string;
    breaks: string;
    kind: "patch" | "compile";
    module: string;
    patch?: number;
}

export interface LoadResult {
    ok: boolean;
    /** Patches whose find is a string or RegExp */
    patches?: number;
    error?: string;
}

// Runs inside the context. Captures the built-ins it uses before any plugin loads, so a plugin that
// replaces JSON.stringify or String.prototype.replace can't change what the checker does.
const BOOTSTRAP = String.raw`
"use strict";
const G = globalThis;
const stringify = JSON.stringify, parse = JSON.parse;
const apply = Reflect.apply, defineProperty = Object.defineProperty, keys = Object.keys, isArray = Array.isArray;
const strReplace = String.prototype.replace, strIncludes = String.prototype.includes, strReplaceAll = String.prototype.replaceAll;
const strStartsWith = String.prototype.startsWith, strSlice = String.prototype.slice;
const reTest = RegExp.prototype.test, RE = RegExp, Fn = Function, Str = String, SetC = Set, MapC = Map, ProxyC = Proxy;
const IDENT = "(?:[A-Za-z_$][\\w$]*)";
const canon = m => typeof m === "string" ? m : new RE(apply(strReplace, m.source, [/(?<!\\)\\i/g, IDENT]), m.flags);
const has = (code, find) => {
    if (typeof find === "string") return apply(strIncludes, code, [find]);
    const r = canon(find);
    r.lastIndex = 0;
    return apply(reTest, r, [code]);
};
const selfRef = id => "Evi.$(" + stringify(id) + ")";
const withSelf = (w, id) => typeof w === "string"
    ? apply(strReplaceAll, w, ["$self", selfRef(id)])
    : (...a) => apply(strReplaceAll, Str(w(...a)), ["$self", selfRef(id)]);
const normalize = code => /^(?:function\b|async\b|\()/.test(code) ? code : apply(strReplace, code, [/^(?:[\w$]+|"(?:[^"\\]|\\.)*")(?=\s*\()/, "function"]);
const compiles = code => { try { new Fn("return 0," + code); return true; } catch { return false; } };
const errorText = e => { try { return apply(strSlice, Str(e && e.message || e), [0, 200]); } catch { return "error"; } };

// What plugins see: Evi's API, other modules and the page's globals are all an inert stand-in
const proxy = new ProxyC(function () { }, {
    get: (_t, k) => k === Symbol.toPrimitive ? () => "" : k === "then" ? undefined : proxy,
    apply: () => proxy,
    construct: () => proxy,
});
const api = new ProxyC({}, { get: (_t, k) => k === "definePlugin" ? x => x : proxy });
for (const name of ["window", "self", "top", "parent"]) G[name] = G;
for (const name of ["document", "localStorage", "sessionStorage", "navigator", "location", "history", "screen", "console", "performance", "crypto",
    "Element", "HTMLElement", "HTMLInputElement", "HTMLTextAreaElement", "HTMLCanvasElement", "HTMLImageElement", "HTMLVideoElement", "HTMLAudioElement", "SVGElement", "Node", "Text", "Event", "CustomEvent", "KeyboardEvent", "MouseEvent", "EventTarget",
    "MutationObserver", "ResizeObserver", "IntersectionObserver", "CSS", "CSSStyleSheet", "DOMParser", "XMLSerializer", "Image", "Audio", "Blob", "File", "FileReader", "FormData", "Headers", "Request", "Response", "AbortController", "TextEncoder", "TextDecoder",
    "URL", "URLSearchParams", "WebSocket", "Worker", "BroadcastChannel", "Notification", "AudioContext", "OfflineAudioContext", "AudioEncoder", "AudioData", "MediaRecorder", "MediaStream",
    "fetch", "XMLHttpRequest", "getComputedStyle", "matchMedia", "requestAnimationFrame", "cancelAnimationFrame", "requestIdleCallback", "cancelIdleCallback",
    "setTimeout", "clearTimeout", "setInterval", "clearInterval", "queueMicrotask", "structuredClone", "atob", "btoa", "addEventListener", "removeEventListener", "dispatchEvent",
    "DiscordNative", "Evi", "webpackChunkdiscord_app", "GLOBAL_ENV"]) G[name] = proxy;

const PLUGINS = {}; // id -> [{ i, p }]
let MODS = {}; // module id -> its code
let BYMOD = {}; // module id -> [[plugin, patch index]]

function load(id, code) {
    try {
        const module = { exports: {} };
        const require = name => name === "@evi/api" ? api : proxy;
        new Fn("module", "exports", "require", code)(module, module.exports, require);
        const def = module.exports && (module.exports.default || module.exports);
        const raw = def && def.patches;
        const list = [];
        if (isArray(raw)) raw.forEach((p, i) => { if (p && (typeof p.find === "string" || p.find instanceof RE)) list[list.length] = { i, p }; });
        PLUGINS[id] = list;
        return stringify({ ok: true, patches: list.length });
    } catch (e) {
        return stringify({ ok: false, error: errorText(e) });
    }
}

function setModules(json) {
    MODS = parse(json);
    BYMOD = {};
    return "ok";
}

/** Which modules each of a plugin's patches goes to, like the patcher: the first match, or every one with all */
function match(id) {
    let count = 0;
    for (const { i, p } of PLUGINS[id] || []) {
        for (const mid of keys(MODS)) {
            if (!has(MODS[mid], p.find)) continue;
            (BYMOD[mid] || (BYMOD[mid] = []))[BYMOD[mid].length] = [id, i];
            count++;
            if (!p.all) break;
        }
    }
    return stringify(count);
}

function drop(id) {
    delete PLUGINS[id];
    for (const mid of keys(BYMOD)) BYMOD[mid] = BYMOD[mid].filter(x => x[0] !== id);
    return "ok";
}

/** Modules two or more plugins patch */
function shared() {
    return stringify(keys(BYMOD).filter(mid => new SetC(BYMOD[mid].map(x => x[0])).size > 1));
}

/** Runs these patches in order over a module: which replacements matched nothing, and whether the result compiles */
function run(code, entries) {
    const failed = [];
    for (const [id, i] of entries) {
        const p = PLUGINS[id].find(x => x.i === i).p;
        const before = code;
        let next = code;
        const mine = [];
        const reps = isArray(p.replace) ? p.replace : [p.replace];
        reps.forEach((r, j) => {
            const prev = next;
            try { next = apply(strReplace, next, [canon(r.match), withSelf(r.with, id)]); } catch { }
            if (next === prev) mine[mine.length] = id + "#" + i + "." + j;
        });
        // A broad optional patch with nothing to do in this module: neither applied nor failed
        if (p.all && p.optional && next === before) continue;
        for (const k of mine) failed[failed.length] = k;
        code = p.group && mine.length ? before : next;
    }
    return { failed, compiles: compiles(code) };
}

/** Every ordered pair of plugins on a module: the second's patches that work alone but not after the first's */
function detect(mid) {
    const list = BYMOD[mid] || [];
    const code0 = normalize(MODS[mid]);
    const plugins = [...new SetC(list.map(x => x[0]))];
    const of = id => list.filter(x => x[0] === id);
    const alone = new MapC(plugins.map(id => [id, run(code0, of(id))]));
    const out = [];
    for (const a of plugins) for (const b of plugins) {
        if (a === b) continue;
        const together = run(code0, [...of(a), ...of(b)]);
        let first;
        for (const k of together.failed) {
            if (!apply(strStartsWith, k, [b + "#"]) || alone.get(b).failed.includes(k)) continue;
            const i = Number(apply(strSlice, k, [b.length + 1]).split(".")[0]);
            if (first === undefined || i < first) first = i;
        }
        if (first !== undefined) out[out.length] = { by: a, breaks: b, kind: "patch", module: mid, patch: first };
        else if (!together.compiles && alone.get(a).compiles && alone.get(b).compiles) out[out.length] = { by: a, breaks: b, kind: "compile", module: mid };
    }
    return stringify(out);
}

const lock = (name, value, writable) => defineProperty(G, name, { value, writable, configurable: false, enumerable: false });
lock("__arg", undefined, true);
lock("__load", id => load(id, G.__arg), false);
lock("__setModules", () => setModules(G.__arg), false);
lock("__match", match, false);
lock("__drop", drop, false);
lock("__shared", shared, false);
lock("__detect", detect, false);
"ready";
`;

export interface Sandbox {
    load(id: string, code: string): LoadResult;
    /** Discord's modules as JSON text ({ id: code }) */
    setModules(json: string): void;
    /** Finds a plugin's modules; false when it took too long (its finds are dropped) */
    match(id: string): boolean;
    shared(): string[];
    detect(module: string): RawClash[];
}

export function createSandbox({ loadTimeout = 5_000, matchTimeout = 60_000, detectTimeout = 10_000 } = {}): Sandbox {
    // No host object goes in: a null-prototype object, so `this.constructor` leads nowhere
    const ctx = vm.createContext(Object.create(null), { microtaskMode: "afterEvaluate", codeGeneration: { strings: true, wasm: false } });
    vm.runInContext(BOOTSTRAP, ctx, { timeout: 5_000 });
    const call = (code: string, timeout: number): string | undefined => {
        try {
            const out = vm.runInContext(code, ctx, { timeout });
            return typeof out === "string" ? out : undefined;
        } catch {
            return undefined;
        }
    };
    // __arg is locked as a plain data property, so writing it from here runs no plugin code
    const setArg = (value: string) => void ((ctx as Record<string, unknown>).__arg = value);
    return {
        load(id, code) {
            setArg(code);
            const out = call(`__load(${JSON.stringify(id)})`, loadTimeout);
            setArg("");
            if (out === undefined) return { ok: false, error: "took too long to load, or broke the sandbox" };
            try {
                const r = JSON.parse(out) as LoadResult;
                return { ok: r.ok === true, ...(typeof r.patches === "number" && { patches: r.patches }), ...(typeof r.error === "string" && { error: r.error.slice(0, 200) }) };
            } catch {
                return { ok: false, error: "unreadable answer" };
            }
        },
        setModules(json) {
            setArg(json);
            const out = call("__setModules()", 300_000);
            setArg("");
            if (out !== "ok") throw new Error("Discord's modules didn't load into the sandbox");
        },
        match(id) {
            if (call(`__match(${JSON.stringify(id)})`, matchTimeout) !== undefined) return true;
            call(`__drop(${JSON.stringify(id)})`, 5_000);
            return false;
        },
        shared() {
            const out = call("__shared()", 30_000);
            const list = out === undefined ? [] : JSON.parse(out);
            return Array.isArray(list) ? list.filter((m): m is string => typeof m === "string") : [];
        },
        detect(module) {
            const out = call(`__detect(${JSON.stringify(module)})`, detectTimeout);
            if (out === undefined) return [];
            const list = JSON.parse(out);
            if (!Array.isArray(list)) return [];
            return list.flatMap((c): RawClash[] => {
                if (!c || typeof c.by !== "string" || typeof c.breaks !== "string" || (c.kind !== "patch" && c.kind !== "compile")) return [];
                return [{ by: c.by, breaks: c.breaks, kind: c.kind, module, ...(Number.isInteger(c.patch) && { patch: c.patch }) }];
            });
        },
    };
}
