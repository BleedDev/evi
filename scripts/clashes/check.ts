// node scripts/clashes/check.ts <modules.json> <pluginsDir> <out.json>
// Loads every plugin (<pluginsDir>/<id>.js) into the sandbox (sandbox.ts), finds the Discord modules
// two or more of them patch and which pairs break each other there. Writes { clashes, plugins }, where
// plugins says how each one loaded. Run with Node, with no secrets in the environment: the plugins'
// code is untrusted, and only ever runs inside the sandbox.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";

import { createSandbox } from "./sandbox.ts";
import type { LoadResult, RawClash } from "./sandbox.ts";

const [modulesFile, pluginsDir, out] = process.argv.slice(2);
if (!modulesFile || !pluginsDir || !out) {
    console.error("usage: node scripts/clashes/check.ts <modules.json> <pluginsDir> <out.json>");
    process.exit(2);
}

const sandbox = createSandbox();
const plugins: Record<string, LoadResult & { matched?: boolean; }> = {};
for (const f of readdirSync(pluginsDir).sort()) {
    if (!f.endsWith(".js")) continue;
    const id = f.slice(0, -3);
    const result = sandbox.load(id, readFileSync(`${pluginsDir}/${f}`, "utf8"));
    plugins[id] = result;
    if (!result.ok) console.log(`  ${id}: didn't load (${result.error})`);
}
sandbox.setModules(readFileSync(modulesFile, "utf8"));
for (const id of Object.keys(plugins)) {
    if (!plugins[id].ok || !plugins[id].patches) continue;
    plugins[id].matched = sandbox.match(id);
    if (!plugins[id].matched) console.log(`  ${id}: its finds took too long, left out`);
}
const shared = sandbox.shared();
const clashes: RawClash[] = shared.flatMap(m => sandbox.detect(m));
writeFileSync(out, JSON.stringify({ clashes, plugins, sharedModules: shared.length }, null, 2));
console.log(`modules patched by 2+ plugins: ${shared.length}, clashes: ${clashes.length}`);
for (const c of clashes) console.log(`  module ${c.module}: ${c.by} first breaks ${c.breaks}${c.kind === "compile" ? " (doesn't compile together)" : ` (patch ${c.patch})`}`);
