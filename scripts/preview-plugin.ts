/**
 * A plugin's store page before it's in the store, and what the store would say about it.
 *
 *   bun run preview-plugin my-plugin [--open] [--no-build] [--offline]
 *
 * Builds (unless --no-build), then:
 *  - runs evi.rest's upload checks on the built files (src/shared/submissionChecks.ts) and the app's
 *    own checks on the registry entry they'd make (buildEntry), and prints what they find;
 *  - writes dist/preview/<id>.html: the store page people would see, with what the plugin asks for,
 *    what its code can reach, its changelog and the checks. --open opens it in your browser.
 *
 * The version the store has now comes from evi.rest's registry, so a version that isn't newer is
 * caught too; --offline skips that. Exits 1 when an upload would be refused.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "fs";
import { join, relative, resolve } from "path";
import { parseArgs } from "util";

import pkg from "../package.json";
import { readPermissions } from "../src/shared/declaredPermissions";
import type { PluginManifest } from "../src/shared/ipc";
import { en } from "../src/shared/locales/en";
import { analyzePermissions, RISK_LABELS, riskSummary } from "../src/shared/pluginPermissions";
import { buildEntry } from "../src/shared/registryEntry";
import { DEFAULT_REGISTRY_URL, type RegistryEntry, type StoreFileName } from "../src/shared/store";
import { checkSubmission, type Finding } from "../src/shared/submissionChecks";

const ROOT = resolve(import.meta.dir, "..");

const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
        open: { type: "boolean" },
        "no-build": { type: "boolean" },
        offline: { type: "boolean" },
    },
});

function fail(message: string): never {
    console.error(`✗ ${message}`);
    process.exit(1);
}

const id = positionals[0];
if (!id) fail("Which plugin? bun run preview-plugin my-plugin");
const source = ["userplugins", "plugins"].map(root => join(ROOT, root, id)).find(dir => existsSync(join(dir, "manifest.json")));
if (!source) fail(`No plugin called ${id} in userplugins/ or plugins/`);
const official = source.startsWith(join(ROOT, "plugins"));

if (!values["no-build"] && Bun.spawnSync([process.execPath, join(ROOT, "scripts", "build.ts")], { stderr: "inherit" }).exitCode !== 0) {
    fail("The build failed, see above");
}

// The build names its output after the manifest's id, which can differ from the folder's name
const builtId: string = JSON.parse(readFileSync(join(source, "manifest.json"), "utf8")).id ?? id;
const out = join(ROOT, "dist", "plugins", builtId);
const read = (name: StoreFileName) => existsSync(join(out, name)) ? readFileSync(join(out, name)) : undefined;
const files: Partial<Record<StoreFileName, Buffer>> = {};
for (const name of ["manifest.json", "index.js", "native.js"] as const) {
    const data = read(name);
    if (data) files[name] = data;
}
if (!files["manifest.json"] || !files["index.js"]) fail(`dist/plugins/${builtId} isn't built: run without --no-build`);

const manifest: PluginManifest = JSON.parse(files["manifest.json"].toString("utf8"));
const code = files["index.js"].toString("utf8");
const nativeCode = files["native.js"]?.toString("utf8");

async function publishedVersion(): Promise<string | undefined> {
    if (values.offline) return;
    try {
        const res = await fetch(DEFAULT_REGISTRY_URL, { signal: AbortSignal.timeout(8000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const registry = await res.json() as { plugins?: { id: string; version: string; }[]; };
        return registry.plugins?.find(p => p.id === builtId)?.version;
    } catch (err) {
        console.warn(`! Couldn't read the store's registry (${err instanceof Error ? err.message : err}), so the version isn't compared with the store's`);
    }
}

const officialManifests = readdirSync(join(ROOT, "plugins"))
    .map(dir => join(ROOT, "plugins", dir, "manifest.json"))
    .filter(existsSync)
    .map(path => JSON.parse(readFileSync(path, "utf8")) as PluginManifest);
const published = await publishedVersion();

const findings: Finding[] = checkSubmission({ manifest, code, nativeCode }, {
    // An official plugin is checked as itself, not as a community plugin taking Evi's names
    officialIds: new Set(official ? [] : officialManifests.map(m => m.id)),
    officialNames: new Set(official ? [] : officialManifests.map(m => m.name.trim().toLowerCase())),
    publishedVersion: published,
});

const today = new Date().toISOString().slice(0, 10);
const built = await buildEntry(files, { base: "https://evi.rest/store/plugins", today, eviVersion: pkg.version });
if ("error" in built) findings.unshift({ level: "error", message: `Evi wouldn't list it: ${built.error}` });
const entry: RegistryEntry = "entry" in built ? built.entry : {
    id, name: manifest.name ?? id, description: manifest.description ?? "", authors: manifest.authors ?? [], version: manifest.version ?? "?",
    tags: manifest.tags ?? [], native: !!manifest.native, screenshots: manifest.screenshots ?? [], changelog: manifest.changelog ?? [],
    files: {} as RegistryEntry["files"], permissions: readPermissions(manifest.permissions),
};
const report = analyzePermissions({ code, manifest, native: entry.native });

const esc = (s: unknown) => Bun.escapeHTML(s ?? "");
/** **Bold** lead-ins, like the app's changelogs */
const rich = (s: string) => esc(s).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
const plural = (value: { one?: string; other: string; } | string, count: number) =>
    (typeof value === "string" ? value : count === 1 && value.one ? value.one : value.other).replaceAll("{count}", String(count));

function declaredList() {
    const p = entry.permissions;
    if (!p) return `<p class="warn">${esc(en["declared.undeclared"])}. ${esc(en["declared.undeclaredHint"])}</p>`;
    const rows: string[] = [];
    if (p.network.length) rows.push(row(plural(en["declared.network"], p.network.length), `${en["declared.networkHint"]} ${p.network.join(", ")}`));
    if (p.readMessages) rows.push(row(en["declared.readMessages"], en["declared.readMessagesHint"]));
    if (p.sendMessages) rows.push(row(en["declared.sendMessages"], en["declared.sendMessagesHint"]));
    if (p.changeSettings) rows.push(row(en["declared.changeSettings"], en["declared.changeSettingsHint"]));
    if (entry.native) rows.push(row(RISK_LABELS.high, en["declared.nativeHint"]));
    return rows.length ? `<ul class="rows">${rows.join("")}</ul>` : `<p>${esc(en["declared.nothing"])}</p>`;
}

const row = (title: string, hint: string, details: string[] = [], risk?: string) => `
    <li${risk ? ` data-risk="${risk}"` : ""}>
        <div class="row-title">${esc(title)}${risk ? ` <span class="pill">${esc(RISK_LABELS[risk as keyof typeof RISK_LABELS])}</span>` : ""}</div>
        <p>${esc(hint)}</p>
        ${details.length ? `<ul class="details">${details.map(d => `<li><code>${esc(d)}</code></li>`).join("")}</ul>` : ""}
    </li>`;

const errors = findings.filter(f => f.level === "error");
const warnings = findings.filter(f => f.level === "warning");
const checks = findings.length
    ? `<ul class="checks">${findings.map(f => `<li data-level="${f.level}"><span class="sr">${f.level === "error" ? "Would be refused:" : "Worth fixing:"}</span>${f.level === "error" ? "✕" : "!"} ${esc(f.message)}</li>`).join("")}</ul>`
    : `<p class="ok">✓ Nothing the store would refuse or ask about.</p>`;

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(entry.name)}: store preview</title>
<style>
    :root { color-scheme: dark; --bg: #1a1a1e; --panel: #242429; --line: rgb(151 151 159 / 0.12); --text: #dbdee1; --strong: #f2f3f5;
        --subtle: #b5bac1; --muted: #949ba4; --brand: #5865f2; --warn: #f0b232; --danger: #f23f43; --ok: #23a55a; }
    * { box-sizing: border-box; }
    body { margin: 0; padding-block: 40px; padding-inline: 24px; background: var(--bg); color: var(--text);
        font: 16px/1.375 "gg sans", "Noto Sans", system-ui, sans-serif; -webkit-font-smoothing: antialiased; }
    main { max-inline-size: 760px; margin-inline: auto; display: flex; flex-direction: column; gap: 24px; }
    .note { margin: 0; color: var(--muted); font-size: 14px; }
    section { padding: 20px; border: 1px solid var(--line); border-radius: 16px; background: var(--panel); }
    h1, h2, h3, p { margin: 0; }
    h2 { margin-block-end: 12px; color: var(--strong); font-size: 16px; font-weight: 600; }
    header { display: flex; gap: 16px; align-items: center; }
    .glyph { display: grid; place-items: center; flex: none; inline-size: 64px; block-size: 64px; border-radius: 12px;
        background: var(--brand); color: #fff; font-size: 28px; font-weight: 700; }
    h1 { color: var(--strong); font-size: 24px; font-weight: 700; line-height: 1.25; }
    .byline { color: var(--muted); font-size: 14px; font-variant-numeric: tabular-nums; }
    .badge { display: inline-block; margin-inline-start: 8px; padding: 2px 6px; border-radius: 4px; background: rgb(151 151 159 / 0.2);
        color: var(--subtle); font-size: 12px; font-weight: 600; vertical-align: middle; }
    .badge[data-tone="warning"] { color: var(--warn); }
    .desc { margin-block-start: 16px; color: var(--subtle); text-wrap: pretty; }
    .tags { display: flex; flex-wrap: wrap; gap: 8px; margin: 16px 0 0; padding: 0; list-style: none; }
    .tags li { padding: 2px 10px; border-radius: 999px; background: rgb(151 151 159 / 0.16); color: var(--subtle); font-size: 13px; }
    .shots { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 8px; margin-block-start: 16px; }
    .shots img { inline-size: 100%; border-radius: 8px; outline: 1px solid rgb(255 255 255 / 0.08); outline-offset: -1px; }
    .rows, .checks, .details, .changelog ul { margin: 0; padding: 0; list-style: none; }
    .rows { display: flex; flex-direction: column; gap: 16px; }
    .row-title { color: var(--strong); font-weight: 500; }
    .rows p { color: var(--subtle); font-size: 14px; }
    .details { display: flex; flex-wrap: wrap; gap: 4px; margin-block-start: 8px; }
    code { padding: 1px 6px; border-radius: 4px; background: #121214; font: 13px ui-monospace, Consolas, monospace; overflow-wrap: anywhere; }
    .pill { padding: 1px 6px; border-radius: 4px; background: rgb(151 151 159 / 0.16); font-size: 12px; font-weight: 600; }
    [data-risk="high"] .pill { color: var(--danger); }
    [data-risk="medium"] .pill { color: var(--warn); }
    .summary { margin-block-end: 12px; color: var(--subtle); font-size: 14px; }
    .checks { display: flex; flex-direction: column; gap: 8px; }
    .checks li { padding: 8px 12px; border-radius: 8px; font-size: 14px; }
    .checks [data-level="error"] { background: rgb(209 46 56 / 0.12); color: var(--strong); }
    .checks [data-level="warning"] { background: rgb(247 163 0 / 0.1); color: var(--strong); }
    .ok { color: var(--ok); }
    .warn { color: var(--warn); }
    .changelog { display: flex; flex-direction: column; gap: 12px; }
    .changelog h3 { color: var(--strong); font-size: 14px; font-weight: 600; font-variant-numeric: tabular-nums; }
    .changelog li { color: var(--subtle); font-size: 14px; }
    .changelog li::before { content: "• "; color: var(--muted); }
    .sr { position: absolute; inline-size: 1px; block-size: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
    footer { color: var(--muted); font-size: 13px; font-variant-numeric: tabular-nums; }
</style>
</head>
<body>
<main>
    <p class="note">Store preview of <code>${esc(relative(ROOT, source).replaceAll("\\", "/"))}</code>, built ${esc(today)}. This is how its page would read in Evi's store.</p>

    <section aria-labelledby="checks">
        <h2 id="checks">${errors.length ? `The store would refuse it (${errors.length})` : warnings.length ? `Ready, with ${warnings.length} thing${warnings.length === 1 ? "" : "s"} to look at` : "Ready for the store"}</h2>
        ${checks}
    </section>

    <section aria-labelledby="name">
        <header>
            <div class="glyph" aria-hidden="true">${esc([...entry.name.trim()][0]?.toUpperCase() ?? "?")}</div>
            <div>
                <h1 id="name">${esc(entry.name)}<span class="badge">${official ? "Evi" : "Community"}</span>${entry.native ? `<span class="badge" data-tone="warning">Full access</span>` : ""}</h1>
                <div class="byline">v${esc(entry.version)} · by ${esc(entry.authors.join(", "))}${entry.minEviVersion ? ` · Evi ${esc(entry.minEviVersion)} or newer` : ""}</div>
            </div>
        </header>
        <p class="desc">${esc(entry.description) || `<span class="warn">No description</span>`}</p>
        ${entry.tags.length ? `<ul class="tags" aria-label="Tags">${entry.tags.map(t => `<li>${esc(t)}</li>`).join("")}</ul>` : ""}
        ${entry.screenshots.length ? `<div class="shots">${entry.screenshots.map((s, i) => `<img src="${esc(s)}" alt="Screenshot ${i + 1} of ${esc(entry.name)}">`).join("")}</div>` : ""}
    </section>

    <section aria-labelledby="asks">
        <h2 id="asks">${esc(en["declared.title"])}</h2>
        ${declaredList()}
    </section>

    <section aria-labelledby="reach">
        <h2 id="reach">${esc(en["declared.codeTitle"])}</h2>
        <p class="summary">${esc(riskSummary(report))}</p>
        ${report.capabilities.length ? `<ul class="rows">${report.capabilities.map(c => row(c.title, c.description, c.details, c.risk)).join("")}</ul>` : ""}
    </section>

    <section aria-labelledby="changes">
        <h2 id="changes">Changelog</h2>
        ${entry.changelog.length
        ? `<div class="changelog">${entry.changelog.map(c => `<div><h3>v${esc(c.version)}</h3><ul>${c.notes.map(n => `<li>${rich(n)}</li>`).join("")}</ul></div>`).join("")}</div>`
        : `<p class="warn">No changelog</p>`}
    </section>

    <footer>index.js ${(files["index.js"]!.length / 1024).toFixed(1)} KB${files["native.js"] ? ` · native.js ${(files["native.js"].length / 1024).toFixed(1)} KB` : ""}${published ? ` · the store has v${esc(published)}` : ""}</footer>
</main>
</body>
</html>
`;

const previewDir = join(ROOT, "dist", "preview");
mkdirSync(previewDir, { recursive: true });
const page = join(previewDir, `${id}.html`);
writeFileSync(page, html);

for (const f of findings) console.log(`${f.level === "error" ? "✗" : "!"} ${f.message}`);
if (!findings.length) console.log("✓ Nothing the store would refuse or ask about");
console.log(`\nStore page: ${relative(ROOT, page).replaceAll("\\", "/")}`);
if (!errors.length && !official) console.log(`Upload it with bun run plugin upload ${id}, or from your dashboard on evi.rest: the files in dist/plugins/${builtId}`);

if (values.open) {
    Bun.spawnSync(process.platform === "win32" ? ["cmd", "/c", "start", "", page] : [process.platform === "darwin" ? "open" : "xdg-open", page]);
}
process.exit(errors.length ? 1 : 0);
