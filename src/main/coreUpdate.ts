/**
 * Installing an update from evi-core.json, the few-MB file Evi Setup downloads, rather than running
 * the whole installer: the loader in Discord's app.asar already points at <data>/core, so updating Evi
 * means writing new files there. The same as Evi Setup's prepare_core (installer/src/ops.rs): the core
 * is replaced whole, official plugins someone already has are refreshed (not ones they removed or
 * installed from the store, and nothing new is added), and retired ones go.
 *
 * The new core is written beside the old one and swapped in by renaming, so a failure halfway leaves
 * the running Evi as it was.
 */
import { parseRemovedPlugins, REMOVED_PLUGINS_FILE, RETIRED_PLUGINS, STORE_MARKER } from "@shared/store";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "fs";
import { join } from "path";

import { DATA_DIR, PLUGINS_DIR } from "./paths";

interface CorePayload {
    version: string;
    core: Record<string, string>;
    plugins?: Record<string, Record<string, string>>;
    retired?: string[];
}

const SAFE = /^[A-Za-z0-9][\w.-]*$/;
const safe = (name: string) => SAFE.test(name) && !name.includes("..");

/** The payload, checked: every file name plain, every file text */
export function parseCorePayload(text: string): CorePayload {
    const json = JSON.parse(text);
    const files = (v: unknown): v is Record<string, string> =>
        !!v && typeof v === "object" && !Array.isArray(v) && Object.entries(v).every(([k, c]) => safe(k) && typeof c === "string");
    if (!json || typeof json.version !== "string" || !files(json.core) || !json.core["main.js"]) throw new Error("evi-core.json isn't an Evi core");
    const plugins = json.plugins ?? {};
    if (typeof plugins !== "object" || Object.entries(plugins).some(([id, f]) => !safe(id) || !files(f))) throw new Error("evi-core.json has an unsafe plugin");
    return { version: json.version, core: json.core, plugins, retired: Array.isArray(json.retired) ? json.retired.filter((id: unknown) => typeof id === "string" && safe(id)) : [] };
}

function writeDir(dir: string, files: Record<string, string>) {
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content);
}

/** Writes the payload's core and plugins into the data folder. Synchronous: it also runs as Discord quits */
export function applyCorePayload(payload: CorePayload) {
    const core = join(DATA_DIR, "core");
    const next = `${core}.next`;
    const old = `${core}.old`;
    writeDir(next, { ...payload.core, "package.json": JSON.stringify({ type: "commonjs" }) });
    rmSync(old, { recursive: true, force: true });
    if (existsSync(core)) renameSync(core, old);
    try {
        renameSync(next, core);
    } catch (err) {
        // Put the running core back rather than leave none
        if (existsSync(old) && !existsSync(core)) renameSync(old, core);
        throw err;
    }
    rmSync(old, { recursive: true, force: true });

    let removed = new Set<string>();
    try {
        removed = parseRemovedPlugins(readFileSync(join(DATA_DIR, REMOVED_PLUGINS_FILE), "utf8"));
    } catch { }
    for (const [id, files] of Object.entries(payload.plugins ?? {})) {
        const dir = join(PLUGINS_DIR, id);
        if (removed.has(id) || !existsSync(join(dir, "manifest.json")) || existsSync(join(dir, STORE_MARKER))) continue;
        writeDir(dir, files);
    }
    // The core is already in: a folder that can't go now (a file held open) goes on the next start (plugins.ts)
    for (const id of [...RETIRED_PLUGINS, ...payload.retired ?? []]) {
        const dir = join(PLUGINS_DIR, id);
        if (!existsSync(dir) || existsSync(join(dir, STORE_MARKER))) continue;
        try {
            rmSync(dir, { recursive: true, force: true });
        } catch (err) {
            console.warn(`[Evi] Couldn't remove the retired plugin folder ${id}`, err);
        }
    }
}
