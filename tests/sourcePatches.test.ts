import { afterEach, describe, expect, test } from "bun:test";

import { applySourcePatches, getPatchRecords, matchesFind, registerPatches, unregisterPatches } from "../src/renderer/patching/source";

const modules: Record<string, string> = {
    "1": 'function(e,t,n){t.A=function(){return"alpha"}}',
    "2": 'function(e,t,n){t.A=function(){return"beta"}}',
    "3": 'function(e,t,n){t.B=function(){return"alpha"}}',
};

const PLUGIN = "source-test";
const run = (id: string, rerun = false) => applySourcePatches(id, (() => { }) as any, () => modules[id], rerun);
const record = () => getPatchRecords(PLUGIN)[0];

afterEach(() => unregisterPatches(PLUGIN));

describe("source patch finds", () => {
    test("\\i in a RegExp find matches any identifier, like in a match", () => {
        expect(matchesFind(modules["1"], /\i\.A=function/)).toBe(true);
        expect(matchesFind(modules["1"], /\i\.Z=function/)).toBe(false);
        // An escaped backslash before the i is a backslash and an i
        expect(matchesFind("a\\i", /a\\i/)).toBe(true);
        // A global find answers the same every time
        const global = /\i\.A=/g;
        expect(matchesFind(modules["1"], global)).toBe(true);
        expect(matchesFind(modules["1"], global)).toBe(true);
    });

    test("a find with \\i patches its module", () => {
        registerPatches(PLUGIN, [{ find: /\i\.B=function/, replace: { match: /return"alpha"/, with: 'return"gamma"' } }]);
        expect(run("1").patchedBy).toEqual([]);
        expect(run("3").patchedBy).toEqual([PLUGIN]);
        expect(record().state).toBe("applied");
    });
});
