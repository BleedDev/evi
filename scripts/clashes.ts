/**
 * The clash checker (src/shared/clashes.ts): which store plugins don't work together on Discord's
 * current web build. Run on a schedule by .github/workflows/clashes.yml, or by hand:
 *
 *   bun scripts/clashes.ts [--force] [--out clashes.json] [--dir <work dir>] [--api <url>]
 *
 * Fetches Discord's web build and every store plugin's stable index.js (checked against the
 * registry's sha256), pulls Discord's modules out of the build, then applies the plugins' patches two
 * at a time in a sandbox (scripts/clashes/sandbox.ts, under Node). Writes the report to --out for
 * scripts/clashes/post.ts to send; writes nothing when neither Discord's build nor any store plugin
 * changed since evi.rest's last report (--force runs anyway). The plugins' code is untrusted: it only
 * runs in the sandbox, in a Node process given no secrets.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";

import { type ClashReport, type PluginClash, validateClashReport } from "../src/shared/clashes";
import { DEFAULT_API_URL } from "../src/shared/stars";
import { parseRegistry, sha256Hex } from "../src/shared/store";

const args = process.argv.slice(2);
const flag = (name: string) => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 ? args[i + 1] : undefined;
};
const FORCE = args.includes("--force");
const API = String(flag("api") ?? process.env.EVI_API_URL ?? DEFAULT_API_URL).replace(/\/+$/, "");
const OUT = resolve(flag("out") ?? "clashes.json");
const DISCORD = "https://discord.com";
const ROOT = resolve(import.meta.dir, "..");

async function fetchRetry(url: string, tries = 3): Promise<Response | null> {
    for (let i = 0; i < tries; i++) {
        try {
            const res = await fetch(url, { headers: { "user-agent": "evi-clash-checker (+https://evi.rest)" } });
            if (res.ok || res.status === 404) return res;
        } catch { }
        await Bun.sleep(500 * (i + 1));
    }
    return null;
}

/** Discord's web build: its entry scripts from /app, and the build's name (the web.* entry) */
async function discordBuild() {
    const res = await fetchRetry(`${DISCORD}/app`);
    if (!res?.ok) throw new Error("discord.com/app didn't answer");
    const html = await res.text();
    const entry = [...html.matchAll(/src="(\/assets\/[^"]+\.js)"/g)].map(m => m[1]);
    const web = entry.map(p => p.split("/").pop()!).find(f => /^web\.[0-9a-f]+\.js$/.test(f));
    if (!web) throw new Error("No web.*.js entry on discord.com/app");
    return { entry, build: web.slice(0, -3) };
}

/** Every script of the build into `dir`, following the chunk maps (both of the URL forms Discord uses) */
async function downloadBuild(entry: string[], dir: string) {
    const seen = new Set<string>();
    const queue = [...entry];
    let files = 0, missing = 0;
    const worker = async () => {
        while (queue.length) {
            const p = queue.shift()!;
            if (seen.has(p)) continue;
            seen.add(p);
            const res = await fetchRetry(DISCORD + p);
            if (!res?.ok) {
                missing++;
                continue;
            }
            const text = await res.text();
            writeFileSync(join(dir, p.split("/").pop()!), text);
            files++;
            if (entry.includes(p) || (text.length > 200_000 && /\.js"/.test(text))) {
                // Lazy chunks: {id:"hash"} maps (/assets/<hash>.js), and "id"===e?""+e+".hash.js" ternaries
                for (const m of text.matchAll(/(\d+):"([0-9a-f]{16,20})"/g)) {
                    const q = `/assets/${m[2]}.js`;
                    if (!seen.has(q)) queue.push(q);
                }
                for (const m of text.matchAll(/"(\d+)"===e\?""\+e\+"\.([0-9a-f]{16,20})\.js"/g)) {
                    const q = `/assets/${m[1]}.${m[2]}.js`;
                    if (!seen.has(q)) queue.push(q);
                }
            }
        }
    };
    // Workers that find the queue empty while others still fetch would quit early: go round until nothing's left
    while (queue.length) await Promise.all(Array.from({ length: 32 }, worker));
    return { files, missing };
}

/** Runs a step with Node and no secrets: only what Node needs to start */
function node(script: string, ...rest: string[]) {
    const keep = ["PATH", "Path", "SystemRoot", "SYSTEMROOT", "TEMP", "TMP", "TMPDIR", "HOME", "USERPROFILE", "LANG"];
    const env = Object.fromEntries(keep.flatMap(k => process.env[k] ? [[k, process.env[k]!]] : []));
    const r = Bun.spawnSync(["node", "--max-old-space-size=6144", join(ROOT, "scripts", "clashes", script), ...rest], { env, stdout: "inherit", stderr: "inherit" });
    if (r.exitCode !== 0) throw new Error(`${script} failed (exit ${r.exitCode})`);
}

const { entry, build } = await discordBuild();
const registryRes = await fetchRetry(new URL("/registry.json", API).toString());
if (!registryRes?.ok) throw new Error("The store's registry didn't load");
const parsed = parseRegistry(await registryRes.json());
if ("error" in parsed) throw new Error(`The store's registry: ${parsed.error}`);
const { registry } = parsed;
const listed = registry.plugins.filter(p => p.files["index.js"]);
const lastRes = await fetchRetry(`${API}/clashes`);
const last = lastRes?.ok ? ((await lastRes.json()) as { report?: ClashReport | null; }).report ?? null : null;

const versions = Object.fromEntries(listed.map(p => [p.id, p.version]));
const unchanged = !!last && last.discordBuild === build
    && Object.keys(versions).length === Object.keys(last.plugins).length
    && Object.entries(versions).every(([id, v]) => last.plugins[id] === v);
if (unchanged && !FORCE) {
    console.log(`Nothing to do: Discord's build ${build} and every store plugin are as evi.rest's last report has them`);
    process.exit(0);
}
console.log(`Discord build ${build}, ${listed.length} store plugins${last ? ` (last report: ${last.discordBuild})` : ""}`);

const work = resolve(flag("dir") ?? join(tmpdir(), `evi-clashes-${build}`));
const chunks = join(work, "chunks"), plugins = join(work, "plugins");
for (const d of [chunks, plugins]) mkdirSync(d, { recursive: true });

const got = await downloadBuild(entry, chunks);
console.log(`Discord: ${got.files} scripts${got.missing ? `, ${got.missing} didn't download` : ""}`);

const checked: Record<string, string> = {};
await Promise.all(listed.map(async p => {
    const file = p.files["index.js"]!;
    const res = await fetchRetry(file.url);
    if (!res?.ok) return console.log(`  ${p.id}: index.js didn't download`);
    const data = new Uint8Array(await res.arrayBuffer());
    if (await sha256Hex(data) !== file.sha256) return console.log(`  ${p.id}: index.js doesn't match the registry's sha256, left out`);
    writeFileSync(join(plugins, `${p.id}.js`), data);
    checked[p.id] = p.version;
}));
console.log(`Plugins: ${Object.keys(checked).length} downloaded`);

const modules = join(work, "modules.json"), raw = join(work, "raw.json");
node("extract.ts", chunks, modules);
node("check.ts", modules, plugins, raw);

const found = (JSON.parse(readFileSync(raw, "utf8")) as { clashes: Omit<PluginClash, "byVersion" | "breaksVersion">[]; }).clashes;
const seen = new Set<string>();
const clashes: PluginClash[] = [];
for (const c of found) {
    if (!checked[c.by] || !checked[c.breaks]) continue;
    const clash: PluginClash = { by: c.by, byVersion: checked[c.by], breaks: c.breaks, breaksVersion: checked[c.breaks], kind: c.kind, module: c.module, ...(c.patch !== undefined && { patch: c.patch }) };
    const key = `${clash.by}>${clash.breaks}#${clash.module}:${clash.kind}`;
    if (seen.has(key)) continue;
    seen.add(key);
    clashes.push(clash);
}
const checkedReport = validateClashReport({ discordBuild: build, plugins: Object.fromEntries(Object.entries(checked).sort(([a], [b]) => a.localeCompare(b))), clashes });
if ("error" in checkedReport) throw new Error(`The report isn't valid: ${checkedReport.error}`);
writeFileSync(OUT, JSON.stringify(checkedReport.report, null, 2));
console.log(`Wrote ${OUT}: ${clashes.length} clashes on ${build}`);
if (!flag("dir") && existsSync(work)) rmSync(work, { recursive: true, force: true });
