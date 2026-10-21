import { afterEach, describe, expect, test } from "bun:test";

import { buildFindIndex, FindCache, FindCacheData, findKey, fingerprint, indexSaver, MAX_FIND_CACHE_BYTES, parseFindCache, textHash } from "../src/renderer/patching/findCache";
import { applySourcePatches, getPatchRecords, matchesFind, registerPatches, setFindCache, SourcePatch, unregisterPatches } from "../src/renderer/patching/source";

const BUILD = "build-a";

const modules: Record<string, string> = {
    "1": 'function(e,t,n){t.A=function(){return"alpha"}}',
    "2": 'function(e,t,n){t.A=function(){return"beta"}}',
    "3": 'function(e,t,n){t.A=function(){return"alpha beta"}}',
};
const sources = (mods: Record<string, string>) => Object.entries(mods).map(([id, src]) => [id, () => src] as [string, () => string]);

function index(finds: (string | RegExp)[], mods = modules, old?: FindCache, build = BUILD): FindCacheData {
    const steps = buildFindIndex(old, build, sources(mods), new Map(finds.map(f => [findKey(f), f])), matchesFind);
    let step = steps.next();
    while (!step.done) step = steps.next();
    return step.value;
}

const patched = (id: string, patch: SourcePatch, plugin = "cache-test") => {
    registerPatches(plugin, [patch]);
    try {
        return { ...applySourcePatches(id, (() => { }) as any, () => modules[id]), record: getPatchRecords(plugin)[0] };
    } finally {
        unregisterPatches(plugin);
    }
};

afterEach(() => setFindCache(undefined));

describe("find cache: the index", () => {
    test("records which modules each find matches", () => {
        const data = index(['"alpha', /return"beta"/]);
        expect(data.build).toBe(BUILD);
        expect(Object.keys(data.modules).sort()).toEqual(["1", "2", "3"]);
        expect(data.finds[findKey('"alpha')]).toEqual(["1", "3"]);
        expect(data.finds[findKey(/return"beta"/)]).toEqual(["2"]);
    });

    test("strings and RegExps with the same text are different finds", () => {
        expect(findKey("a.b")).not.toBe(findKey(/a.b/));
        expect(findKey(/a/g)).not.toBe(findKey(/a/));
    });

    test("fingerprints tell modules apart, also at the same length", () => {
        expect(fingerprint(modules["1"])).toBe(fingerprint(String(modules["1"])));
        expect(fingerprint(modules["1"])).not.toBe(fingerprint(modules["1"].replace("alpha", "gamma")));
    });

    test("only covers what it indexed, on the build it indexed", () => {
        const cache = new FindCache(index(['"alpha']), () => BUILD);
        expect([...cache.lookup("1", modules["1"])!]).toEqual([findKey('"alpha')]);
        expect(cache.lookup("2", modules["2"])!.size).toBe(0);
        // Another module under a known id, an unknown id, a find it never searched
        expect(cache.lookup("1", modules["2"])).toBeUndefined();
        expect(cache.lookup("4", modules["1"])).toBeUndefined();
        expect(cache.covers(findKey('"beta'))).toBe(false);

        const otherBuild = new FindCache(index(['"alpha']), () => "build-b");
        expect(otherBuild.lookup("1", modules["1"])).toBeUndefined();
        // Discord's build isn't known yet: nothing is answered, until it is
        let build: string | undefined;
        const early = new FindCache(index(['"alpha']), () => build);
        expect(early.lookup("1", modules["1"])).toBeUndefined();
        build = BUILD;
        expect(early.lookup("1", modules["1"])).toBeDefined();
    });

    test("asks to be indexed again when something wasn't covered, and keeps what ran uncovered", () => {
        let misses = 0;
        const cache = new FindCache(index(['"alpha']), () => BUILD, () => misses++);
        cache.lookup("1", modules["1"]);
        expect(misses).toBe(0);
        cache.lookup("9", "function(){}");
        cache.covers(findKey("other"));
        expect(misses).toBe(2);
        expect(cache.takeUnindexed().map(([id, src]) => [id, src()])).toEqual([["9", "function(){}"]]);
        expect(cache.takeUnindexed()).toEqual([]);
    });

    test("a second module under a taken id gets its own entry", () => {
        const steps = buildFindIndex(undefined, BUILD, [...sources(modules), ["1", () => modules["2"]]], new Map([[findKey('"beta'), '"beta']]), matchesFind);
        let step = steps.next();
        while (!step.done) step = steps.next();
        const cache = new FindCache(step.value, () => BUILD);
        expect(cache.lookup("1", modules["1"])!.size).toBe(0);
        expect([...cache.lookup("1", modules["2"])!]).toEqual([findKey('"beta')]);
    });

    test("reuses the old index's answers, and keeps modules that aren't loaded now while it answers every find", () => {
        const old = new FindCache(index(['"alpha']), () => BUILD);
        let searched = 0;
        const counting = (src: string, find: string | RegExp) => (searched++, matchesFind(src, find));
        const steps = buildFindIndex(old, BUILD, sources({ "1": modules["1"] }), new Map([[findKey('"alpha'), '"alpha']]), counting);
        let step = steps.next();
        while (!step.done) step = steps.next();
        expect(searched).toBe(0);
        expect(Object.keys(step.value.modules).sort()).toEqual(["1", "2", "3"]);
        expect(step.value.finds[findKey('"alpha')]).toEqual(["1", "3"]);

        // A new find: modules not loaded now were never searched for it, so they're dropped
        const fresh = index(['"alpha', '"beta'], { "1": modules["1"] }, old);
        expect(Object.keys(fresh.modules)).toEqual(["1"]);
        // Another build: nothing carries over
        expect(Object.keys(index(['"alpha'], { "1": modules["1"] }, old, "build-b").modules)).toEqual(["1"]);
    });

    test("a saved index that isn't one is ignored", () => {
        expect(parseFindCache(undefined)).toBeUndefined();
        expect(parseFindCache("{")).toBeUndefined();
        expect(parseFindCache(JSON.stringify({ v: 2, build: BUILD, modules: {}, finds: {} }))).toBeUndefined();
        expect(parseFindCache(JSON.stringify({ v: 1, build: BUILD, modules: {}, finds: { x: 1 } }))).toBeUndefined();
        const data = index(['"alpha']);
        expect(parseFindCache(JSON.stringify(data))).toEqual(data);
    });
});

describe("find cache: patching with it", () => {
    const patch: SourcePatch = { find: '"alpha', replace: { match: '"alpha', with: '"ALPHA' }, all: true };

    test("modules the index says don't match are skipped, the rest are searched and patched as before", () => {
        setFindCache(new FindCache(index(['"alpha']), () => BUILD));
        expect(patched("1", patch).patchedBy).toEqual(["cache-test"]);
        expect(patched("2", patch).patchedBy).toEqual([]);
        expect(String(patched("3", patch).factory)).toContain('"ALPHA beta');
    });

    test("a module the index covers is only searched for the finds it matches", () => {
        const find = /"alpha/;
        const test = find.test.bind(find);
        let searched = 0;
        find.test = (s: string) => (searched++, test(s));
        setFindCache(new FindCache(index([find]), () => BUILD));
        searched = 0;
        const counted: SourcePatch = { ...patch, find };
        expect(patched("2", counted).patchedBy).toEqual([]);
        expect(searched).toBe(0);
        expect(patched("1", counted).patchedBy).toEqual(["cache-test"]);
        expect(searched).toBe(1);
    });

    test("never skips a module the index doesn't know, or a find it never searched", () => {
        // The index was made on modules without "alpha" in module 2, which now has it
        const changed = { ...modules, "2": 'function(e,t,n){t.A=function(){return"alpha!"}}' };
        setFindCache(new FindCache(index(['"alpha'], { "1": modules["1"], "2": modules["2"] }), () => BUILD));
        const original = modules["2"];
        modules["2"] = changed["2"];
        try {
            expect(patched("2", patch).patchedBy).toEqual(["cache-test"]);
            expect(patched("3", patch).patchedBy).toEqual(["cache-test"]);
        } finally {
            modules["2"] = original;
        }
        const other: SourcePatch = { find: '"beta', replace: { match: '"beta', with: '"BETA' } };
        expect(patched("2", other).patchedBy).toEqual(["cache-test"]);
    });

    test("a match the index remembers is still confirmed against the source", () => {
        const data = index(['"alpha']);
        data.finds[findKey('"alpha')].push("2");
        setFindCache(new FindCache(data, () => BUILD));
        expect(patched("2", patch).patchedBy).toEqual([]);
    });

    test("on another build every module is searched", () => {
        const data = index(['"alpha']);
        data.finds[findKey('"alpha')] = [];
        setFindCache(new FindCache(data, () => "build-b"));
        expect(patched("1", patch).patchedBy).toEqual(["cache-test"]);
    });
});

describe("patching: compiling once", () => {
    const source = 'function(e,t,n){t.A=function(){return"alpha"};t.B=function(){return 1}}';
    const run = (patches: SourcePatch[]) => {
        registerPatches("compile-a", patches.slice(0, 1));
        registerPatches("compile-b", patches.slice(1));
        try {
            const result = applySourcePatches("7", (() => { }) as any, () => source);
            return { ...result, a: getPatchRecords("compile-a")[0], b: getPatchRecords("compile-b") };
        } finally {
            unregisterPatches("compile-a");
            unregisterPatches("compile-b");
        }
    };

    test("several patches on one module compile it once", () => {
        const realEval = globalThis.eval;
        let compiles = 0;
        globalThis.eval = (code: string) => (compiles++, realEval(code));
        try {
            const { patchedBy, factory } = run([
                { find: '"alpha"', replace: { match: '"alpha"', with: '"one"' } },
                { find: "return 1", replace: { match: "return 1", with: "return 2" } },
            ]);
            expect(patchedBy).toEqual(["compile-a", "compile-b"]);
            expect(String(factory)).toContain('"one"');
            expect(String(factory)).toContain("return 2");
        } finally {
            globalThis.eval = realEval;
        }
        expect(compiles).toBe(1);
    });

    test("a patch that breaks the module is reverted alone, and the ones after it apply to the code without it", () => {
        const { patchedBy, factory, a, b } = run([
            { find: '"alpha"', replace: { match: "return 1", with: "return 1+" } },
            { find: "return 1", replace: { match: /return 1(\+?)/, with: "return 3$1" } },
        ]);
        expect(a.state).toBe("failed");
        expect(a.errors.some(e => e.includes("does not compile, patch reverted"))).toBe(true);
        expect(b[0].state).toBe("applied");
        expect(b[0].errors).toEqual([]);
        expect(patchedBy).toEqual(["compile-b"]);
        expect(String(factory)).toContain("return 3}");
    });

    test("a broad optional patch with nothing left to do after a revert stays quiet", () => {
        const { a, b, patchedBy } = run([
            { find: '"alpha"', replace: { match: "return 1", with: "return 1+(" } },
            { find: "return", replace: { match: "1+(", with: "1+((" }, all: true, optional: true },
        ]);
        expect(a.state).toBe("failed");
        expect(b[0].state).toBe("pending");
        expect(b[0].modules).toEqual([]);
        expect(patchedBy).toEqual([]);
    });

    test("a broad optional patch that only has something to do once a broken patch is reverted applies", () => {
        const { a, b, patchedBy, factory } = run([
            { find: '"alpha"', replace: { match: "return 1", with: "return 1+" } },
            { find: "return", replace: { match: "return 1}", with: "return 4}" }, all: true, optional: true },
        ]);
        expect(a.state).toBe("failed");
        expect(b[0].state).toBe("applied");
        expect(b[0].modules).toEqual(["7"]);
        expect(patchedBy).toEqual(["compile-b"]);
        expect(String(factory)).toContain("return 4}");
    });

    test("nothing compiles: the original factory runs", () => {
        const original = (() => { }) as any;
        registerPatches("compile-a", [{ find: '"alpha"', replace: { match: "return 1", with: "return 1+" } }]);
        try {
            expect(applySourcePatches("7", original, () => source).factory).toBe(original);
        } finally {
            unregisterPatches("compile-a");
        }
    });
});

describe("saving the index", () => {
    test("the hash covers every character", () => {
        const text = JSON.stringify({ v: 1, build: "b", modules: { 1: "x", 2: "y" }, finds: {} });
        expect(textHash(text)).toBe(textHash(text.slice()));
        // One character in the middle, which the module fingerprint's sampling would skip
        const changed = text.slice(0, 20) + (text[20] === "a" ? "b" : "a") + text.slice(21);
        expect(textHash(changed)).not.toBe(textHash(text));
        expect(textHash(text + " ")).not.toBe(textHash(text));
    });

    test("an index the same as the one read at start isn't saved again; a changed one is, once", () => {
        const saves: string[] = [];
        const save = indexSaver("{\"a\":1}", data => saves.push(data));
        expect(save("{\"a\":1}")).toBe("same");
        expect(save("{\"a\":2}")).toBe("saved");
        expect(save("{\"a\":2}")).toBe("same");
        expect(save("{\"a\":1}")).toBe("saved");
        expect(saves).toEqual(["{\"a\":2}", "{\"a\":1}"]);
    });

    test("nothing read at start: the first index is saved; a too big one never", () => {
        const saves: string[] = [];
        const save = indexSaver(undefined, data => saves.push(data));
        expect(save("x".repeat(MAX_FIND_CACHE_BYTES + 1))).toBe("tooBig");
        expect(save("{}")).toBe("saved");
        expect(saves).toEqual(["{}"]);
    });
});
