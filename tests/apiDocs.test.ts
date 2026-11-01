import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";

import { jsDocSummary } from "../scripts/api-docs";
import { API_CHANGELOG } from "../src/shared/apiChangelog";
import { apiDoc, ApiDoc, highlightApi, searchApiDocs } from "../src/shared/apiDocs";

describe("api docs", () => {
    test("apiDocs.json is up to date with the source (run node scripts/api-docs.ts)", () => {
        const run = Bun.spawnSync(["node", resolve(import.meta.dir, "../scripts/api-docs.ts"), "--check"], { stderr: "pipe" });
        expect(run.exitCode, run.stderr.toString()).toBe(0);
    }, 30_000);

    test("the most used calls are there, with examples", () => {
        for (const name of ["definePlugin", "ctx.hookExport", "ctx.contextMenu", "ctx.command", "ctx.keybind", "findByProps", "showToast", "$self"]) {
            const doc = apiDoc(name);
            expect(doc, name).toBeDefined();
            expect(doc!.signature.length, name).toBeGreaterThan(0);
            expect(doc!.example, name).toBeTruthy();
        }
        // Overloads list each signature; private members stay out
        expect(apiDoc("ctx.hookExport")!.signature.split("\n")).toHaveLength(2);
        expect(apiDoc("ctx.addHook")).toBeUndefined();
        expect(apiDoc("ctx.dispose")).toBeUndefined();
        expect(apiDoc("ctx.settings.schema")).toBeDefined();
    });

    test("JSDoc summaries: first paragraph, tags dropped, examples keep their lines", () => {
        expect(jsDocSummary("/**\n * Shows a toast.\n * Returns false otherwise.\n *\n * More.\n * @param x it\n */")).toBe("Shows a toast. Returns false otherwise.");
        expect(jsDocSummary("/** One line */")).toBe("One line");
        expect(jsDocSummary("/**\n * Hooks it.\n *   hook(\"a\")    first\n *   hook(\"b\")    second\n */")).toBe("Hooks it.\n  hook(\"a\")    first\n  hook(\"b\")    second");
    });
});

describe("highlighting API names in code", () => {
    const docs = new Map<string, ApiDoc>(
        ["findByProps", "ctx.settings", "ctx.settings.get", "$self", "hook", "abc"].map(name => [name, { name, kind: "function", signature: `${name}()`, doc: "" }]),
    );
    const lookup = (name: string) => docs.get(name);
    const marked = (code: string) => highlightApi(code, lookup).filter(s => s.doc).map(s => s.text);

    test("segments join back into the code", () => {
        const code = "const x = findByProps(\"a\"); ctx.settings.get(\"k\").length; $self.run(e)";
        expect(highlightApi(code, lookup).map(s => s.text).join("")).toBe(code);
    });

    test("marks known names, $self and the longest documented ctx chain", () => {
        expect(marked("findByProps(\"a\"); ctx.settings.get(\"k\").length; $self.run(e)")).toEqual(["findByProps", "ctx.settings.get", "$self"]);
        expect(marked("ctx.settings.all")).toEqual(["ctx.settings"]);
    });

    test("leaves property accesses, partial words and short names alone", () => {
        expect(marked("e.findByProps(1); findByPropsLazy(2); myfindByProps; abc(3)")).toEqual([]);
        expect(marked("hook(3)")).toEqual(["hook"]);
        expect(marked("$selfish")).toEqual([]);
    });

    test("what $self becomes in patched code points at $self", () => {
        const segments = highlightApi("return Evi.$(\"my-plugin\").render(e)", lookup);
        expect(segments.find(s => s.doc)?.text).toBe("Evi.$(\"my-plugin\")");
        expect(segments.find(s => s.doc)?.doc?.name).toBe("$self");
    });

    test("the real reference marks real names", () => {
        expect(highlightApi("ctx.hookExport(\"after\", filters.byProps(\"x\"), cb)").filter(s => s.doc).map(s => s.text)).toEqual(["ctx.hookExport", "filters"]);
    });
});

describe("searching the API", () => {
    test("names first, exact name first of all", () => {
        const results = searchApiDocs("hook").map(d => d.name);
        expect(results[0]).toBe("hook");
        expect(results).toContain("ctx.hookExport");
        // Mentioned in a doc but not named for it: after every name match
        const firstByText = results.findIndex(name => !name.toLowerCase().includes("hook"));
        expect(firstByText === -1 || results.slice(firstByText).every(name => !name.toLowerCase().includes("hook"))).toBe(true);
    });

    test("falls back to signatures and docs", () => {
        expect(searchApiDocs("shortcut").map(d => d.name)).toContain("ctx.keybind");
        expect(searchApiDocs("nothing-like-this-exists")).toEqual([]);
    });
});

describe("API changelog", () => {
    test("newest first, dated, and every change says something", () => {
        const versions = API_CHANGELOG.map(r => r.version);
        expect(versions[0]).toBe("1.3.1");
        for (let i = 1; i < versions.length; i++) {
            expect(Bun.semver.order(versions[i - 1], versions[i])).toBe(1);
        }
        for (const release of API_CHANGELOG) {
            expect(release.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
            for (const change of release.changes) {
                expect(["added", "changed", "deprecated", "removed"]).toContain(change.kind);
                expect(change.symbol.length).toBeGreaterThan(0);
                expect(change.description.length).toBeGreaterThan(20);
            }
        }
    });

    test("1.3.1 adds panel switches", () => {
        expect(API_CHANGELOG[0].changes.map(c => c.symbol)).toContain("ctx.panelToggle");
    });

    test("1.1.0 lists translations for plugins", () => {
        expect(API_CHANGELOG.find(r => r.version === "1.1.0")!.changes.map(c => c.symbol)).toEqual(expect.arrayContaining(["locales", "settings"]));
    });

    test("1.0.0 lists what plugins gained", () => {
        const symbols = API_CHANGELOG.find(r => r.version === "1.0.0")!.changes.map(c => c.symbol);
        expect(symbols).toEqual(expect.arrayContaining(["ctx.keybind", "ctx.settings.schema", "new-plugin", "preview-plugin"]));
        // What it names exists
        expect(apiDoc("ctx.keybind")).toBeDefined();
        expect(apiDoc("ctx.settings.schema")).toBeDefined();
    });
});
