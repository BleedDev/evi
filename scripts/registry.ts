/**
 * Generates the store registry from built plugins and the repo's themes/ folder, so publishing is
 * reproducible: the same build always gives the same files, hashes and registry.json.
 *
 *   bun run build
 *   bun scripts/registry.ts [--base <url>] [--files <dir>] [--out <file>] [--only id,id]
 *
 *   --base   where the published files will be served from, https only. Each plugin's files go to
 *            <base>/<id>/<file>, themes to <base>/../themes/<id>.css.
 *            Default: https://evi.rest/store/plugins
 *   --files  folder the plugin files are copied into, ready to commit or upload. Themes go next to it
 *            in ../themes. Default: store/plugins
 *   --out    registry to write. Default: registry.json
 *   --only   comma-separated plugin ids. Default: every official plugin (plugins/, not userplugins/)
 *
 * Themes are themes/<id>.css with a BetterDiscord-style header (@name, @description, @author,
 * @version, @tags a, b). Changelogs, screenshots and source links come from plugin manifests;
 * updatedAt is kept from the previous registry while a version doesn't change, and set to today when
 * it does.
 *
 * Commit (or upload) the files folder and the registry together: the registry's hashes only match
 * the files copied by the same run. Plugins it didn't build (third-party ones evi.rest published
 * from approved submissions) are kept as they are in the previous registry.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { dirname, join, resolve } from "path";
import { parseArgs } from "util";

import pkg from "../package.json";
import { buildEntry, versionedUrl as versioned } from "../src/shared/registryEntry";
import { compareVersions, parseRegistry, REGISTRY_SCHEMA, RegistryEntry, sha256Hex, STORE_FILES, StoreFileName, storeThemeFile, ThemeEntry, whyNotStoreUrl } from "../src/shared/store";
import { parseThemeMeta, whyNotCss } from "../src/shared/themes";

const ROOT = resolve(import.meta.dir, "..");
const BUILT = join(ROOT, "dist", "plugins");

const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
        base: { type: "string", default: "https://evi.rest/store/plugins" },
        files: { type: "string", default: join(ROOT, "store", "plugins") },
        out: { type: "string", default: join(ROOT, "registry.json") },
        only: { type: "string" },
    },
});

/**
 * Author slugs of an official plugin's co-authors: every name after "Evi" in its manifest, or its
 * "authorIds" after "evi" when a profile's slug isn't the one the name makes ("Kaz" is kazdevger)
 */
function coAuthorSlugs(dir: string): string[] {
    try {
        const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
        if (Array.isArray(manifest.authorIds)) return manifest.authorIds.slice(1).filter((a: unknown): a is string => typeof a === "string");
        const authors: unknown = manifest.authors;
        if (!Array.isArray(authors)) return [];
        return authors.slice(1).filter((a): a is string => typeof a === "string")
            .map(a => a.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")).filter(Boolean);
    } catch {
        return [];
    }
}

function fail(message: string): never {
    console.error(`✗ ${message}`);
    process.exit(1);
}

const base = values.base!.replace(/\/+$/, "");
const badBase = whyNotStoreUrl(base);
if (badBase) fail(`--base ${base}: ${badBase}`);
if (!existsSync(BUILT)) fail("dist/plugins is missing, run `bun run build` first");

const official = new Set(readdirSync(join(ROOT, "plugins"), { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name));
const ids = values.only ? values.only.split(",").map(s => s.trim()).filter(Boolean) : readdirSync(BUILT).filter(id => official.has(id)).sort();

const filesDir = resolve(values.files!);
const themesBase = base.replace(/\/[^/]+$/, "/themes");
const themesDir = join(dirname(filesDir), "themes");
const SOURCE = "https://github.com/BleedDev/evi/tree/main";
const today = new Date().toISOString().slice(0, 10);

// Publish dates survive a rebuild: only a new version gets a new date
const previous = new Map<string, { version: string; updatedAt?: string; }>();
let oldPlugins: RegistryEntry[] = [];
try {
    const old = JSON.parse(readFileSync(resolve(values.out!), "utf8"));
    for (const e of old.plugins ?? []) previous.set(`plugin:${e.id}`, e);
    for (const e of old.themes ?? []) previous.set(`theme:${e.id}`, e);
    oldPlugins = old.plugins ?? [];
} catch { }
const dateFor = (key: string, version: string) => {
    const old = previous.get(key);
    return old?.version === version && old.updatedAt ? old.updatedAt : today;
};

const entries: RegistryEntry[] = [];

for (const id of ids) {
    const dir = join(BUILT, id);
    if (!existsSync(join(dir, "manifest.json"))) fail(`${id} isn't built (no dist/plugins/${id}/manifest.json)`);
    const bytes: Partial<Record<StoreFileName, Uint8Array>> = {};
    for (const name of STORE_FILES) {
        const path = join(dir, name);
        if (existsSync(path)) bytes[name] = readFileSync(path);
    }
    const built = await buildEntry(bytes, {
        base,
        previous: previous.get(`plugin:${id}`),
        today,
        eviVersion: pkg.version,
        source: official.has(id) ? `${SOURCE}/plugins/${id}` : undefined,
        // Official plugins are published by Evi's own author profile on evi.rest; co-authors after it
        // ("authors": ["Evi", "Lodestone"]) link to theirs, by the slug their name makes
        authorIds: official.has(id) ? ["evi", ...coAuthorSlugs(dir)] : undefined,
    });
    if ("error" in built) fail(`${id}: ${built.error}`);
    // A co-author may have published a newer version on evi.rest: never roll it back
    const published = oldPlugins.find(e => e.id === id);
    if (published && compareVersions(published.version, built.entry.version) > 0) {
        fail(`${id}: the store has ${published.version}, newer than ${built.entry.version} here (a co-author's version from evi.rest?). Bring it into plugins/${id} first`);
    }
    entries.push(built.entry);

    // A clean copy, so files from an older build of this plugin don't linger
    rmSync(join(filesDir, id), { recursive: true, force: true });
    mkdirSync(join(filesDir, id), { recursive: true });
    for (const name of Object.keys(built.entry.files)) cpSync(join(dir, name), join(filesDir, id, name));
}

// A full rebuild keeps what it didn't build: third-party plugins published by evi.rest
if (!values.only) {
    for (const old of oldPlugins) if (!official.has(old.id) && !entries.some(e => e.id === old.id)) entries.push(old);
    entries.sort((a, b) => a.id.localeCompare(b.id));
}

const themeEntries: ThemeEntry[] = [];
const themesSrc = join(ROOT, "themes");
const themeFiles = values.only || !existsSync(themesSrc) ? [] : readdirSync(themesSrc).filter(f => f.endsWith(".css")).sort();
// --only publishes some plugins and leaves the themes as they were
if (!values.only) rmSync(themesDir, { recursive: true, force: true });
if (themeFiles.length) mkdirSync(themesDir, { recursive: true });

for (const name of themeFiles) {
    const id = name.replace(/\.css$/, "");
    const raw = readFileSync(join(themesSrc, name));
    const css = raw.toString("utf8");
    const bad = whyNotCss(css);
    if (bad) fail(`themes/${name}: ${bad}`);
    const meta = parseThemeMeta(css, name);
    const tags = css.match(/^\s*\/\*[\s\S]*?@tags[ \t]+(.+)/)?.[1].split(",").map(t => t.trim()).filter(Boolean) ?? [];
    const version = meta.version ?? "1.0.0";
    // A thank-you for supporters (@supporters true): listed for everyone, installable by supporters
    const supporters = /^\s*\/\*[\s\S]*?@supporters[ \t]+true\b/.test(css);
    const sha256 = await sha256Hex(raw);

    themeEntries.push({
        id,
        name: meta.name,
        description: meta.description ?? "",
        authors: meta.author ? meta.author.split(",").map(a => a.trim()) : ["Unknown"],
        version,
        tags,
        updatedAt: dateFor(`theme:${id}`, version),
        source: `${SOURCE}/themes/${name}`,
        screenshots: [],
        changelog: [],
        ...supporters && { supporters: true },
        ...meta.locales && { locales: meta.locales },
        minEviVersion: pkg.version,
        file: { url: versioned(`${themesBase}/${storeThemeFile(id)}`, sha256), sha256 },
    });
    cpSync(join(themesSrc, name), join(themesDir, storeThemeFile(id)));
}

const registry = { schema: REGISTRY_SCHEMA, plugins: entries, themes: themeEntries };
// The app's own validation is the final word on what we publish
const check = parseRegistry(registry);
if ("error" in check) fail(check.error);
if (check.problems.length) fail(check.problems.join("\n  "));

writeFileSync(resolve(values.out!), JSON.stringify(registry, null, 4) + "\n");
console.log(`✓ ${resolve(values.out!)}: ${entries.length} plugins (${entries.map(e => `${e.id}@${e.version}`).join(", ")}), ${themeEntries.length} themes`);
console.log(`✓ files in ${filesDir}, to be served from ${base}/<id>/<file>`);
