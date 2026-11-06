import { afterEach, describe, expect, test } from "bun:test";

import { conflictingPlugins, isConflictOnly } from "../src/renderer/patching/diagnose";
import { applySourcePatches, getPatchRecords, registerPatches, SourcePatch, unregisterPatches } from "../src/renderer/patching/source";

const MODULE = 'function(e,t,n){t.A=function(e){return e.isSystemDM()?"badge":null}}';
const run = (rerun = false) => applySourcePatches("10", (() => { }) as any, () => MODULE, rerun);

// Wraps the badge in a list, like Platform Indicators+ on the DM row
const wrap: SourcePatch = { find: "isSystemDM", replace: { match: /return (\i\.isSystemDM\(\)\?"badge":null)/, with: "return [$self.extra,$1]" } };
// Looks for the badge right after `return`, which only Discord's own code has
const strict: SourcePatch = { find: "isSystemDM", replace: { match: /return (\i\.isSystemDM\(\)\?)/, with: "return 0||$1" } };

const record = (plugin: string) => getPatchRecords(plugin)[0];

afterEach(() => {
    for (const plugin of ["wrapper", "strict", "evi"]) unregisterPatches(plugin);
});

describe("patch conflicts", () => {
    test("a patch that fails because another plugin's patch changed the code first names that plugin", () => {
        registerPatches("wrapper", [wrap]);
        registerPatches("strict", [strict]);
        expect(run().patchedBy).toEqual(["wrapper"]);
        expect(record("wrapper").state).toBe("applied");
        expect(record("wrapper").conflicts).toBeUndefined();

        const r = record("strict");
        expect(r.state).toBe("failed");
        expect(r.conflicts).toEqual([{ plugin: "wrapper", module: "10", replacement: 0 }]);
        expect(r.errors[0]).toContain("conflicts with wrapper");
        expect(isConflictOnly(r)).toBe(true);
        expect(conflictingPlugins(getPatchRecords("strict"))).toEqual(["wrapper"]);
    });

    test("alone, the same patch applies", () => {
        registerPatches("strict", [strict]);
        expect(run().patchedBy).toEqual(["strict"]);
        expect(record("strict").state).toBe("applied");
        expect(record("strict").conflicts).toBeUndefined();
    });

    test("in the other order both apply, and nothing is a conflict", () => {
        registerPatches("strict", [strict]);
        registerPatches("wrapper", [{ ...wrap, replace: { match: /(\i\.isSystemDM\(\)\?"badge":null)/, with: "[$self.extra,$1]" } }]);
        expect(run().patchedBy).toEqual(["strict", "wrapper"]);
        expect(record("strict").state).toBe("applied");
        expect(record("wrapper").state).toBe("applied");
    });

    test("a match that isn't in Discord's code either is an ordinary failure, not a conflict", () => {
        registerPatches("wrapper", [wrap]);
        registerPatches("strict", [{ find: "isSystemDM", replace: { match: "notInDiscord", with: "x" } }]);
        run();
        const r = record("strict");
        expect(r.state).toBe("failed");
        expect(r.conflicts).toBeUndefined();
        expect(r.errors[0]).toContain("matched nothing");
        expect(isConflictOnly(r)).toBe(false);
    });

    test("a patch with a real failure and a conflict isn't conflict-only", () => {
        registerPatches("wrapper", [wrap]);
        registerPatches("strict", [{ find: "isSystemDM", replace: [strict.replace as any, { match: "notInDiscord", with: "x" }] }]);
        run();
        const r = record("strict");
        expect(r.state).toBe("failed");
        expect(r.conflicts).toEqual([{ plugin: "wrapper", module: "10", replacement: 0 }]);
        expect(isConflictOnly(r)).toBe(false);
    });

    test("a plugin's own earlier patch isn't a conflict", () => {
        registerPatches("strict", [wrap, strict]);
        run();
        const r = getPatchRecords("strict")[1];
        expect(r.state).toBe("failed");
        expect(r.conflicts).toBeUndefined();
    });

    test("Evi's own patches are named as evi", () => {
        registerPatches("evi", [wrap]);
        registerPatches("strict", [strict]);
        run();
        expect(record("strict").conflicts?.[0].plugin).toBe("evi");
    });

    test("a live re-run keeps one conflict per module, not one per run", () => {
        registerPatches("wrapper", [wrap]);
        registerPatches("strict", [strict]);
        run();
        run(true);
        expect(record("strict").conflicts).toHaveLength(1);
    });
});
