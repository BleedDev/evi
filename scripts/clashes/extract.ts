// node scripts/clashes/extract.ts <chunksDir> <modules.json>
// Discord's webpack modules from a downloaded web build, as JSON ({ id: factory source }), for the clash
// checker. The web.* entry keeps its modules in the runtime's own object literal (read with acorn);
// every other chunk pushes { id: factory } into webpackChunkdiscord_app, caught by a stub that lives
// inside a fresh vm context per chunk, like the plugins' sandbox: nothing of the host goes in.
// Node, not Bun: Bun's vm can crash on a timeout.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import vm from "node:vm";

import { parseExpressionAt } from "acorn";

const [dir, out] = process.argv.slice(2);
if (!dir || !out) {
    console.error("usage: node scripts/clashes/extract.ts <chunksDir> <modules.json>");
    process.exit(2);
}

const CATCH = `var __out = []; var self = globalThis; var window = globalThis;
var webpackChunkdiscord_app = { push(x) { __out.push(x); return __out.length; } };`;
// Factories as source text; a method shorthand factory is left as written (the checker normalizes it like the patcher)
const COLLECT = `JSON.stringify(Object.fromEntries(__out.flatMap(p => Object.entries((p && p[1]) || {})).map(([id, fn]) => [id, String(fn)])))`;

const modules: Record<string, string> = {};
let chunks = 0, failed = 0;
for (const f of readdirSync(dir)) {
    if (!f.endsWith(".js")) continue;
    const text = readFileSync(`${dir}/${f}`, "utf8");
    const ctx = vm.createContext(Object.create(null));
    try {
        vm.runInContext(CATCH, ctx, { timeout: 1_000 });
        if (f.startsWith("web.")) {
            // The entry's runtime: I={id(e,t,n){...},...}
            for (const m of text.matchAll(/[,;\s{(][A-Za-z_$]=\{\d+\(/g)) {
                const start = text.indexOf("{", m.index);
                try {
                    let node: any = parseExpressionAt(text, start, { ecmaVersion: "latest" });
                    if (node.type === "SequenceExpression") node = node.expressions[0];
                    vm.runInContext(`__out.push([[], (${text.slice(start, node.end)})]);`, ctx, { timeout: 5_000 });
                } catch { }
            }
        } else {
            vm.runInContext(text, ctx, { timeout: 5_000 });
        }
        const found = vm.runInContext(COLLECT, ctx, { timeout: 10_000 });
        if (typeof found === "string") Object.assign(modules, JSON.parse(found));
        chunks++;
    } catch {
        failed++;
    }
}
writeFileSync(out, JSON.stringify(modules));
console.log(`modules: ${Object.keys(modules).length} from ${chunks} chunks${failed ? ` (${failed} unreadable)` : ""}`);
