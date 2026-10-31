/**
 * "Download source" on the Author page (shared/pluginSource.ts): a plugin's code, saved into a new
 * folder inside one its author picks, which then opens. Evi's own plugins come from plugins/<id> in
 * Evi's repository (main), the source they're built from, so a co-author can keep working on one
 * and upload new versions; a community plugin comes from the store as published, checked against
 * the registry like an install. Only public files, so evi.rest isn't asked who may.
 */
import { isOfficialListing } from "@shared/authors";
import { IPC } from "@shared/ipc";
import { contentsUrl, MAX_SOURCE_BYTES, MAX_SOURCE_FILES, parseListing, SourceFile, sourceDir, sourceFolderName, SourceResult } from "@shared/pluginSource";
import { isPluginId } from "@shared/store";
import { BrowserWindow, dialog, ipcMain, IpcMainInvokeEvent, net, shell } from "electron";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { dirname, join } from "path";

import { downloadHttps, readCapped } from "./download";
import { mt } from "./locale";
import { downloadVerified, getEntry } from "./store";
import { rateLimit } from "./util";

/** The files under plugins/<id> in Evi's repository, or undefined when it has no such folder */
async function repoFiles(id: string): Promise<SourceFile[] | undefined> {
    const files: SourceFile[] = [];
    const queue = [{ path: sourceDir(id), prefix: "", depth: 0 }];
    while (queue.length) {
        const { path, prefix, depth } = queue.shift()!;
        const res = await net.fetch(contentsUrl(path), { headers: { Accept: "application/vnd.github+json" }, credentials: "omit", signal: AbortSignal.timeout(20_000) });
        if (res.status === 404 && depth === 0) return;
        if (!res.ok) throw new Error(mt("main.source.github", { error: `${res.status} ${res.statusText}`.trim() }));
        const body = await readCapped(res, 512 * 1024);
        if (!body) throw new Error(mt("main.source.tooBig"));
        const listing = parseListing(JSON.parse(new TextDecoder().decode(body)), prefix, depth);
        files.push(...listing.files);
        queue.push(...listing.dirs.map(d => ({ ...d, depth: depth + 1 })));
        if (files.length > MAX_SOURCE_FILES) throw new Error(mt("main.source.tooBig"));
    }
    if (files.reduce((n, f) => n + f.size, 0) > MAX_SOURCE_BYTES) throw new Error(mt("main.source.tooBig"));
    return files;
}

/** Each file's bytes, by its path in the plugin's folder: all downloaded before anything is written */
async function fromRepo(files: SourceFile[]) {
    const out: [string, Uint8Array][] = [];
    for (const file of files) {
        const download = await downloadHttps(file.url, MAX_SOURCE_BYTES, { what: file.path, cache: "no-store" });
        if (!download.ok) throw new Error(`${file.path}: ${download.error}`);
        out.push([file.path, download.body]);
    }
    return out;
}

async function pickFolder(e: IpcMainInvokeEvent, name: string) {
    const win = BrowserWindow.fromWebContents(e.sender);
    const options: Electron.OpenDialogOptions = { title: mt("main.source.pickTitle", { name }), properties: ["openDirectory", "createDirectory"] };
    const { canceled, filePaths } = await (win ? dialog.showOpenDialog(win, options) : dialog.showOpenDialog(options));
    return canceled ? undefined : filePaths[0];
}

/** One folder dialog at a time, and not a stream of them from a page script */
const allowed = rateLimit(6, 60_000);
let busy = false;

async function downloadSource(e: IpcMainInvokeEvent, id: unknown): Promise<SourceResult> {
    if (!isPluginId(id)) return { ok: false, error: mt("main.store.notInStore", { id: String(id) }) };
    if (busy || !allowed()) return { ok: false, canceled: true };
    busy = true;
    try {
        const entry = await getEntry(id);
        // Asked first: the folder dialog shouldn't wait on GitHub
        const base = await pickFolder(e, entry.name);
        if (!base) return { ok: false, canceled: true };

        const listed = isOfficialListing(entry) ? await repoFiles(id) : undefined;
        let files: [string, Uint8Array][];
        let version = entry.version;
        if (listed) {
            files = await fromRepo(listed);
            // The repository may be ahead of the store: the folder says which version it is
            const manifest = files.find(([path]) => path === "manifest.json");
            try {
                const v = manifest && JSON.parse(new TextDecoder().decode(manifest[1])).version;
                if (typeof v === "string" && /^[\w.+-]{1,40}$/.test(v)) version = v;
            } catch { }
        } else {
            files = [];
            for (const [name, file] of Object.entries(entry.files)) if (file) files.push([name, await downloadVerified(name, file)]);
        }

        const folder = join(base, sourceFolderName(id, version, name => existsSync(join(base, name))));
        for (const [path, data] of files) {
            const target = join(folder, ...path.split("/"));
            mkdirSync(dirname(target), { recursive: true });
            writeFileSync(target, data);
        }
        void shell.openPath(folder);
        return { ok: true, folder, version, repo: !!listed };
    } catch (err) {
        return { ok: false, error: (err as Error).message };
    } finally {
        busy = false;
    }
}

export function initAuthorSource() {
    ipcMain.handle(IPC.AUTHOR_SOURCE, (e, id: unknown) => downloadSource(e, id));
}
