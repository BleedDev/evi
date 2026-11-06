/**
 * The clash checker (scripts/clashes): its sandbox keeps store plugins' code away from the machine,
 * and it finds which plugins break each other's patches. The sandbox runs under Node (Bun's vm can
 * crash on a timeout), so these run scripts/clashes/check.ts with Node on small made-up plugins and
 * modules.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";

import { clashingWith, parseClashes, validateClashReport } from "../src/shared/clashes";

const ROOT = resolve(import.meta.dir, "..");
const dirs: string[] = [];
afterAll(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

/** Runs the checker on these plugins (id -> index.js) and modules (id -> factory source) */
function check(plugins: Record<string, string>, modules: Record<string, string>) {
    const dir = mkdtempSync(join(tmpdir(), "evi-clash-test-"));
    dirs.push(dir);
    mkdirSync(join(dir, "plugins"));
    for (const [id, code] of Object.entries(plugins)) writeFileSync(join(dir, "plugins", `${id}.js`), code);
    writeFileSync(join(dir, "modules.json"), JSON.stringify(modules));
    const r = Bun.spawnSync(["node", join(ROOT, "scripts", "clashes", "check.ts"), join(dir, "modules.json"), join(dir, "plugins"), join(dir, "out.json")], {
        env: { PATH: process.env.PATH ?? "", SystemRoot: process.env.SystemRoot ?? "" },
        stdout: "pipe",
        stderr: "pipe",
    });
    if (r.exitCode !== 0) throw new Error(`check.ts exit ${r.exitCode}: ${r.stderr.toString()}`);
    return { dir, ...(JSON.parse(readFileSync(join(dir, "out.json"), "utf8")) as { clashes: any[]; plugins: Record<string, { ok: boolean; error?: string; patches?: number; }>; }) };
}

const plugin = (patches: string) => `module.exports = { default: { name: "x", patches: [${patches}] } };`;
const MODULE = `function(e,t,n){n.d(t,{A:()=>r});let MARK=1;function r(a){return a.isSystemDM()?u(a):null}}`;

describe("the sandbox", () => {
    test("a plugin can't reach the machine, and one that hangs is left out", () => {
        const pwned = join(tmpdir(), `evi-clash-pwned-${process.pid}`);
        const escape = `
            let seen = [];
            try { seen.push(typeof this.constructor.constructor("return process")()); } catch (e) { seen.push("threw"); }
            try { seen.push(typeof ({}).constructor.constructor("return typeof process + typeof Bun + typeof require")()); } catch (e) { seen.push("threw"); }
            try { require("fs").writeFileSync(${JSON.stringify(pwned)}, "x"); } catch (e) { }
            try { process.exit(9); } catch (e) { }
            try { globalThis.__load = () => "hijacked"; } catch (e) { }
            module.exports = { default: { patches: [{ find: "MARK", replace: { match: String(({}).constructor.constructor("return typeof process")()), with: "x" } }] } };`;
        const out = check({
            "a-hang": "while (true) {}",
            "b-escape": escape,
            "c-microtask": `Promise.resolve().then(() => { while (true) {} }); module.exports = { default: { patches: [] } };`,
            "d-normal": plugin(`{ find: "MARK", replace: { match: /\\i\\.isSystemDM\\(\\)/, with: "false" } }`),
        }, { 1: MODULE });
        expect(existsSync(pwned)).toBe(false);
        expect(out.plugins["a-hang"]).toMatchObject({ ok: false });
        expect(out.plugins["c-microtask"]).toMatchObject({ ok: false });
        // The escape loaded, but found no process: its match is the text "undefined"
        expect(out.plugins["b-escape"]).toMatchObject({ ok: true, patches: 1 });
        // Plugins after them still load: the sandbox survived, and its own functions weren't replaced
        expect(out.plugins["d-normal"]).toMatchObject({ ok: true, patches: 1 });
    }, 30_000);

    test("a plugin that replaces built-ins doesn't change the checker's answers", () => {
        const out = check({
            a: plugin(`{ find: "MARK", replace: { match: /(\\i)\\.isSystemDM\\(\\)\\?u\\(\\i\\):null/, with: "[$self.x(),$1]" } }`),
            b: `String.prototype.replace = function () { return "nothing"; }; JSON.stringify = () => "[]"; ${plugin(`{ find: "MARK", replace: { match: "a.isSystemDM()?u(a):null", with: "u(a)" } }`)}`,
        }, { 1: MODULE });
        expect(out.clashes).toContainEqual({ by: "a", breaks: "b", kind: "patch", module: "1", patch: 0 });
    });
});

describe("finding clashes", () => {
    test("one plugin's replacement eats the code another looks for; alone each applies", () => {
        const out = check({
            first: plugin(`{ find: "MARK", replace: { match: /(\\i)\\.isSystemDM\\(\\)\\?(\\i)\\(\\i\\):null/, with: "$1.isSystemDM()?$self.badge($2):null" } }`),
            second: plugin(`{ find: "MARK", replace: { match: "?u(a):null", with: "?u(a):null||$self.icon()" } }`),
            elsewhere: plugin(`{ find: "OTHER", replace: { match: "q", with: "w" } }`),
        }, { 1: MODULE, 2: "function(){OTHER;q}" });
        expect(out.clashes).toEqual([{ by: "first", breaks: "second", kind: "patch", module: "1", patch: 0 }]);
    });

    test("plugins that change different parts of the same module don't clash", () => {
        const out = check({
            a: plugin(`{ find: "MARK", replace: { match: "let MARK=1", with: "let MARK=2" } }`),
            b: plugin(`{ find: "MARK", replace: { match: /\\i\\.isSystemDM\\(\\)/, with: "false" } }`),
        }, { 1: MODULE });
        expect(out.clashes).toEqual([]);
    });

    test("two plugins that only don't compile together", () => {
        const out = check({
            a: plugin(`{ find: "MARK", replace: { match: "return a.isSystemDM()", with: "return (a.isSystemDM()" } }`),
            b: plugin(`{ find: "MARK", replace: { match: ":null}}", with: ":null)}}" } }`),
        }, { 1: MODULE });
        // Each alone leaves an unbalanced bracket, so neither compiles alone: not a clash
        expect(out.clashes).toEqual([]);
        const fine = check({
            a: plugin(`{ find: "MARK", replace: { match: "let MARK=1;", with: "let MARK=1;let dup=1;" } }`),
            b: plugin(`{ find: "MARK", replace: { match: "let MARK=1;", with: "let MARK=1;let dup=2;" } }`),
        }, { 1: MODULE });
        // Together: two let dup in one scope; each alone compiles
        expect(fine.clashes).toContainEqual({ by: "a", breaks: "b", kind: "compile", module: "1" });
    });

    test("a plugin's own patches never clash with themselves", () => {
        const out = check({
            solo: plugin(`{ find: "MARK", replace: { match: "?u(a):null", with: "?v(a):null" } }, { find: "MARK", replace: { match: "?u(a):null", with: "?w(a):null" } }`),
        }, { 1: MODULE });
        expect(out.clashes).toEqual([]);
    });

    test("an optional all-patch with nothing to do here isn't broken by anyone", () => {
        const out = check({
            a: plugin(`{ find: "MARK", replace: { match: "?u(a):null", with: "?v(a):null" } }`),
            b: plugin(`{ find: "MARK", all: true, optional: true, replace: { match: "nowhere", with: "x" } }`),
        }, { 1: MODULE });
        expect(out.clashes).toEqual([]);
    });
});

describe("the report", () => {
    const clash = { by: "platform-indicators-plus", byVersion: "1.0.3", breaks: "platform-indicators", breaksVersion: "2.1.0", kind: "patch" as const, module: "589158", patch: 0 };

    test("is checked before it's sent", () => {
        expect(validateClashReport({ discordBuild: "web.abc123", plugins: { "platform-indicators": "2.1.0" }, clashes: [clash] })).toMatchObject({ report: { clashes: [clash] } });
        expect(validateClashReport({ discordBuild: "web.abc123", plugins: {}, clashes: [clash, clash] })).toHaveProperty("error");
        expect(validateClashReport({ discordBuild: "web abc", plugins: {}, clashes: [] })).toHaveProperty("error");
        expect(parseClashes([clash, { ...clash, by: "Not An Id" }])).toEqual([clash]);
    });

    test("says which plugins you have don't work with one, at the versions checked", () => {
        expect(clashingWith([clash], "platform-indicators", "2.1.0", new Map([["platform-indicators-plus", "1.0.3"]]))).toEqual(["platform-indicators-plus"]);
        expect(clashingWith([clash], "platform-indicators-plus", "1.0.3", new Map([["platform-indicators", "2.1.0"]]))).toEqual(["platform-indicators"]);
        expect(clashingWith([clash], "platform-indicators", "2.1.0", new Map([["platform-indicators-plus", "1.0.4"]]))).toEqual([]);
    });
});
