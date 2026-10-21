import { describe, expect, test } from "bun:test";

import { detectPluginUpdates, entriesBetween, mergeUpdates } from "../src/shared/pluginChangelog";

const changelog = [
    { version: "1.3.0", notes: ["c"] },
    { version: "1.2.0", notes: ["b"] },
    { version: "1.1.0", notes: ["a"] },
    { version: "1.0.0", notes: ["First release."] },
];

const plugin = (id: string, version: string | undefined, log = changelog) => ({ id, name: id[0].toUpperCase() + id.slice(1), version, changelog: log });

describe("plugin changelogs: entries between versions", () => {
    test("everything after the version last seen, up to the installed one, newest first", () => {
        expect(entriesBetween(changelog, "1.0.0", "1.3.0").map(e => e.version)).toEqual(["1.3.0", "1.2.0", "1.1.0"]);
        expect(entriesBetween(changelog, "1.1.0", "1.2.0").map(e => e.version)).toEqual(["1.2.0"]);
    });

    test("sorted even when the manifest isn't", () => {
        const shuffled = [changelog[2], changelog[0], changelog[3], changelog[1]];
        expect(entriesBetween(shuffled, "1.0.0", "1.3.0").map(e => e.version)).toEqual(["1.3.0", "1.2.0", "1.1.0"]);
    });

    test("semver order, prereleases included", () => {
        const log = [{ version: "1.10.0", notes: ["ten"] }, { version: "1.9.0", notes: ["nine"] }, { version: "2.0.0-beta", notes: ["beta"] }];
        expect(entriesBetween(log, "1.8.0", "2.0.0").map(e => e.version)).toEqual(["2.0.0-beta", "1.10.0", "1.9.0"]);
        expect(entriesBetween(log, "1.9.0", "1.10.0").map(e => e.version)).toEqual(["1.10.0"]);
    });

    test("nothing without a version seen, for the same version, a downgrade, or bad input", () => {
        expect(entriesBetween(changelog, undefined, "1.3.0")).toEqual([]);
        expect(entriesBetween(changelog, "1.3.0", "1.3.0")).toEqual([]);
        expect(entriesBetween(changelog, "1.3.0", "1.1.0")).toEqual([]);
        expect(entriesBetween(changelog, "nope", "1.3.0")).toEqual([]);
        expect(entriesBetween(undefined, "1.0.0", "1.3.0")).toEqual([]);
        expect(entriesBetween([{ version: "1.2.0", notes: [] }, { version: "x", notes: ["?"] }], "1.0.0", "1.3.0")).toEqual([]);
    });
});

describe("plugin changelogs: detecting updates", () => {
    test("first run and first installs are only remembered", () => {
        const result = detectPluginUpdates([plugin("alpha", "1.3.0"), plugin("beta", "1.0.0")], undefined);
        expect(result.updates).toEqual([]);
        expect(result.seen).toEqual({ alpha: "1.3.0", beta: "1.0.0" });
        expect(result.changed).toBe(true);

        const later = detectPluginUpdates([plugin("alpha", "1.3.0"), plugin("gamma", "1.2.0")], result.seen);
        expect(later.updates).toEqual([]);
        expect(later.seen.gamma).toBe("1.2.0");
    });

    test("updated plugins come back in one batch, sorted by name, with what changed", () => {
        const seen = { zeta: "1.1.0", alpha: "1.0.0", same: "1.3.0" };
        const result = detectPluginUpdates([plugin("zeta", "1.3.0"), plugin("alpha", "1.2.0"), plugin("same", "1.3.0")], seen);
        expect(result.updates.map(u => [u.id, u.from, u.to, u.entries.map(e => e.version)])).toEqual([
            ["alpha", "1.0.0", "1.2.0", ["1.2.0", "1.1.0"]],
            ["zeta", "1.1.0", "1.3.0", ["1.3.0", "1.2.0"]],
        ]);
        expect(result.seen).toEqual({ zeta: "1.3.0", alpha: "1.2.0", same: "1.3.0" });
    });

    test("an update without notes for its versions is remembered but not shown", () => {
        const result = detectPluginUpdates([plugin("alpha", "1.4.0")], { alpha: "1.3.0" });
        expect(result.updates).toEqual([]);
        expect(result.seen.alpha).toBe("1.4.0");
    });

    test("downgrades are remembered silently, so the next upgrade shows from there", () => {
        const down = detectPluginUpdates([plugin("alpha", "1.1.0")], { alpha: "1.3.0" });
        expect(down.updates).toEqual([]);
        expect(down.seen.alpha).toBe("1.1.0");
        const up = detectPluginUpdates([plugin("alpha", "1.3.0")], down.seen);
        expect(up.updates[0].entries.map(e => e.version)).toEqual(["1.3.0", "1.2.0"]);
    });

    test("plugins without a valid version aren't tracked; removed plugins keep their entry", () => {
        const result = detectPluginUpdates([plugin("nover", undefined), plugin("bad", "latest")], { gone: "1.0.0" });
        expect(result.seen).toEqual({ gone: "1.0.0" });
        expect(result.changed).toBe(false);
    });

    test("nothing changed, nothing to save", () => {
        expect(detectPluginUpdates([plugin("alpha", "1.3.0")], { alpha: "1.3.0" }).changed).toBe(false);
    });
});

describe("plugin changelogs: batching", () => {
    test("updates arriving one after another join the popup that's up", () => {
        const first = detectPluginUpdates([plugin("beta", "1.2.0")], { beta: "1.0.0" }).updates;
        const second = detectPluginUpdates([plugin("alpha", "1.3.0"), plugin("beta", "1.3.0")], { alpha: "1.2.0", beta: "1.2.0" }).updates;
        const merged = mergeUpdates(first, second);
        expect(merged.map(u => u.id)).toEqual(["alpha", "beta"]);
        const beta = merged.find(u => u.id === "beta")!;
        expect([beta.from, beta.to]).toEqual(["1.0.0", "1.3.0"]);
        expect(beta.entries.map(e => e.version)).toEqual(["1.3.0", "1.2.0", "1.1.0"]);
    });
});
