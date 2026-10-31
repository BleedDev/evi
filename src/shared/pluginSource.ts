/**
 * A plugin's source for its author or co-author ("Download source" on the Author page, main/authorSource.ts).
 * Evi's own plugins are built from plugins/<id> in Evi's public repository, so that folder is their
 * source, read through GitHub's contents API. Community plugins only exist as their author published
 * them, so theirs is the store's files. Everything here is public already.
 */
import { RELEASE_REPO } from "./release";

/** Where Evi's own plugins live in its repository */
export const sourceDir = (id: string) => `plugins/${id}`;
export const contentsUrl = (path: string, ref = "main") => `https://api.github.com/repos/${RELEASE_REPO}/contents/${path}?ref=${encodeURIComponent(ref)}`;

/** A plugin's source is a few files: more than this is something else */
export const MAX_SOURCE_FILES = 60;
export const MAX_SOURCE_BYTES = 8 * 1024 * 1024;
const MAX_DEPTH = 3;

export interface SourceFile {
    /** Relative to the plugin's folder, with / between folders */
    path: string;
    url: string;
    size: number;
}

const NAME = /^(?!\.{1,2}$)[\w.@ -]{1,100}$/;
const RAW_PREFIX = `https://raw.githubusercontent.com/${RELEASE_REPO}/`;

/**
 * One folder of GitHub's contents API, cleaned: its files (raw.githubusercontent.com links into Evi's
 * repository only) and the folders in it to read next. Names that could climb out of the plugin's
 * folder, or aren't plain names, are left out.
 */
export function parseListing(raw: unknown, prefix: string, depth: number): { files: SourceFile[]; dirs: { path: string; prefix: string; }[]; } {
    const files: SourceFile[] = [];
    const dirs: { path: string; prefix: string; }[] = [];
    if (!Array.isArray(raw)) return { files, dirs };
    for (const e of raw) {
        if (!e || typeof e !== "object" || typeof e.name !== "string" || !NAME.test(e.name)) continue;
        const path = `${prefix}${e.name}`;
        if (e.type === "file" && typeof e.download_url === "string" && e.download_url.startsWith(RAW_PREFIX) && typeof e.size === "number") {
            files.push({ path, url: e.download_url, size: e.size });
        } else if (e.type === "dir" && typeof e.path === "string" && depth < MAX_DEPTH) {
            dirs.push({ path: e.path, prefix: `${path}/` });
        }
    }
    return { files, dirs };
}

/** The folder it's saved in: `<id>-<version>`, numbered when that's taken */
export function sourceFolderName(id: string, version: string, taken: (name: string) => boolean): string {
    const base = `${id}-${version}`;
    for (let n = 1; ; n++) {
        const name = n === 1 ? base : `${base} (${n})`;
        if (!taken(name)) return name;
    }
}

export type SourceResult =
    | { ok: true; folder: string; version: string; /** From Evi's repository rather than the store */ repo: boolean; }
    | { ok: false; error: string; }
    | { ok: false; canceled: true; };
