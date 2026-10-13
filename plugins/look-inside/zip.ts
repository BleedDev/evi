/**
 * Reading a zip's list of files from its end, and what in that list is worth a warning. Pure, so
 * tests/lookInside.test.ts can run it on zips it makes.
 *
 * A zip ends with its central directory: one record per file (name, sizes, flags), then an end record
 * saying where the directory starts. So the last few KB of the file are enough to list it, without
 * downloading the rest. Zip64 (over 4 GB or 65535 files) adds a second end record before the first.
 */

/** Files whose list Look Inside reads: zips, and formats that are zips under another name */
export const ARCHIVE_EXTENSIONS = new Set([
    "zip", "jar", "apk", "aab", "xpi", "whl", "nupkg", "vsix", "cbz", "ipa",
    "mcpack", "mcaddon", "mcworld", "mctemplate",
]);

export function extensionOf(name: string) {
    const base = name.split(/[\\/]/).pop() ?? "";
    const dot = base.lastIndexOf(".");
    return dot > 0 ? base.slice(dot + 1).toLowerCase() : "";
}

export const isArchive = (fileName: unknown) => typeof fileName === "string" && ARCHIVE_EXTENSIONS.has(extensionOf(fileName));

/** The end record is 22 bytes plus a comment of up to 65535; zip64's records sit just before it */
export const TAIL_BYTES = 22 + 65535 + 20 + 56;
/** A directory bigger than this isn't read: that's over 100,000 files */
export const MAX_DIRECTORY_BYTES = 8 * 1024 * 1024;

export interface Entry {
    path: string;
    /** Unpacked size */
    size: number;
    packed: number;
    dir: boolean;
    encrypted: boolean;
}

export type Listing =
    | { kind: "list"; entries: Entry[]; }
    | { kind: "tooBig"; count: number; }
    | { kind: "notZip"; };

/** Reads bytes [start, end) of the file */
export type Reader = (start: number, end: number) => Promise<Uint8Array>;

const SIG = { end: 0x06054b50, end64: 0x06064b50, locator64: 0x07064b50, entry: 0x02014b50 } as const;

const u16 = (b: Uint8Array, at: number) => b[at] | b[at + 1] << 8;
const u32 = (b: Uint8Array, at: number) => (b[at] | b[at + 1] << 8 | b[at + 2] << 16 | b[at + 3] << 24) >>> 0;
/** Exact up to 2^53, far past any attachment */
const u64 = (b: Uint8Array, at: number) => u32(b, at) + u32(b, at + 4) * 2 ** 32;

/** Code page 437's upper half: zips that don't say they're UTF-8 (old Windows tools) use it */
const CP437 = "ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■\u00a0";
const utf8 = new TextDecoder("utf-8", { fatal: true });

export function decodeName(bytes: Uint8Array, flaggedUtf8: boolean) {
    if (flaggedUtf8) return new TextDecoder().decode(bytes);
    // Many tools write UTF-8 without setting the flag; real CP437 names rarely happen to be valid UTF-8
    try {
        return utf8.decode(bytes);
    } catch {
        let out = "";
        for (const c of bytes) out += c < 128 ? String.fromCharCode(c) : CP437[c - 128];
        return out;
    }
}

/** Lists a zip of `size` bytes, reading its end and then its directory */
export async function listZip(read: Reader, size: number): Promise<Listing> {
    const tailStart = Math.max(0, size - TAIL_BYTES);
    const tail = await read(tailStart, size);
    const at = (abs: number) => abs - tailStart;

    // The end record: the last signature whose comment runs exactly to the end of the file
    let end = -1;
    for (let i = tail.length - 22; i >= 0; i--) {
        if (u32(tail, i) === SIG.end && i + 22 + u16(tail, i + 20) === tail.length) {
            end = i;
            break;
        }
    }
    if (end < 0) return { kind: "notZip" };

    let count = u16(tail, end + 10);
    let dirSize = u32(tail, end + 12);
    // Where the directory ends: right before the end record, or before zip64's record when there is one
    let dirEnd = tailStart + end;

    if (count === 0xffff || dirSize === 0xffffffff || u32(tail, end + 16) === 0xffffffff) {
        const loc = end - 20;
        if (loc < 0 || u32(tail, loc) !== SIG.locator64) return { kind: "notZip" };
        const rec = u64(tail, loc + 8);
        const record = rec >= tailStart && at(rec) + 56 <= tail.length ? tail.subarray(at(rec), at(rec) + 56) : await read(rec, rec + 56);
        if (record.length < 56 || u32(record, 0) !== SIG.end64) return { kind: "notZip" };
        count = u64(record, 32);
        dirSize = u64(record, 40);
        dirEnd = rec;
    }

    if (dirSize > MAX_DIRECTORY_BYTES) return { kind: "tooBig", count };
    // From where it ends, not the offset it states: that offset is wrong when something was put in
    // front of the zip (self-extracting archives)
    const dirStart = dirEnd - dirSize;
    if (dirStart < 0) return { kind: "notZip" };
    const dir = dirStart >= tailStart ? tail.subarray(at(dirStart), at(dirEnd)) : await read(dirStart, dirEnd);

    const entries: Entry[] = [];
    let p = 0;
    while (p + 46 <= dir.length && u32(dir, p) === SIG.entry && entries.length < count) {
        const flags = u16(dir, p + 8);
        let packed = u32(dir, p + 20);
        let unpacked = u32(dir, p + 24);
        const nameLen = u16(dir, p + 28);
        const extraLen = u16(dir, p + 30);
        const commentLen = u16(dir, p + 32);
        const external = u32(dir, p + 38);
        const path = decodeName(dir.subarray(p + 46, p + 46 + nameLen), (flags & 0x800) !== 0);

        // Zip64 sizes: in the 0x0001 extra field, only for the fields that are 0xffffffff, unpacked first
        let e = p + 46 + nameLen;
        const extraEnd = e + extraLen;
        while (e + 4 <= extraEnd) {
            const id = u16(dir, e), len = u16(dir, e + 2);
            if (id === 0x0001) {
                let f = e + 4;
                if (unpacked === 0xffffffff && f + 8 <= e + 4 + len) { unpacked = u64(dir, f); f += 8; }
                if (packed === 0xffffffff && f + 8 <= e + 4 + len) packed = u64(dir, f);
            }
            e += 4 + len;
        }

        entries.push({
            path,
            size: unpacked,
            packed,
            // MS-DOS's directory bit, for tools that don't end folder names with /
            dir: /[\\/]$/.test(path) || (external & 0x10) !== 0,
            encrypted: (flags & 1) !== 0,
        });
        p += 46 + nameLen + extraLen + commentLen;
    }
    return { kind: "list", entries };
}

/** Run when opened: Windows programs and scripts, then macOS's and Linux's */
const PROGRAMS = new Set([
    "exe", "scr", "com", "pif", "msi", "msix", "msixbundle", "appx", "appxbundle", "bat", "cmd", "vbs", "vbe",
    "js", "jse", "wsf", "wsh", "hta", "ps1", "psm1", "lnk", "reg", "cpl", "scf", "jar", "application", "msc", "chm",
    "command", "pkg", "dmg", "sh", "appimage", "run", "desktop",
]);
/** What a disguised program pretends to be */
const HARMLESS = new Set([
    "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "txt", "rtf", "odt", "csv",
    "jpg", "jpeg", "png", "gif", "webp", "bmp", "mp3", "wav", "mp4", "mov", "avi", "mkv",
]);
/** Can't be looked into from here */
const NESTED = new Set(["zip", "rar", "7z", "tar", "gz", "tgz", "xz", "bz2", "cab", "iso", "img", "vhd", "vhdx"]);
/** Unicode's direction controls: they make "photo\u202egnp.exe" show as "photoexe.png" */
const BIDI = /[\u200e\u200f\u202a-\u202e\u2066-\u2069]/;

const baseName = (path: string) => path.replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? path;

export type Kind = "program" | "disguised" | "escape" | "locked" | "nested";

/** What one entry is, if it's worth pointing out (the worst thing it is) */
export function kindOf(entry: Entry): Kind | null {
    const path = entry.path;
    if (/^([\\/]|[a-z]:)/i.test(path) || path.split(/[\\/]/).includes("..")) return "escape";
    const name = baseName(path);
    if (BIDI.test(name)) return "disguised";
    // A macOS app is a folder
    if (entry.dir) return /\.app$/i.test(name) ? "program" : null;
    const ext = extensionOf(name);
    if (PROGRAMS.has(ext)) {
        const inner = name.slice(0, -(ext.length + 1));
        // "invoice.pdf.exe", or the real ending pushed out of sight by spaces
        if (HARMLESS.has(extensionOf(inner.trimEnd())) || /\s{3,}$/.test(inner)) return "disguised";
        return "program";
    }
    if (entry.encrypted) return "locked";
    if (NESTED.has(ext)) return "nested";
    return null;
}

export interface Review {
    files: number;
    folders: number;
    size: number;
    packed: number;
    /** Paths by what they are, in the zip's order */
    found: Partial<Record<Kind, string[]>>;
    /** Unpacks to far more than it takes to send: a zip bomb */
    bomb: boolean;
}

/** Over 1 GB unpacked at more than 100 times its packed size: a zip bomb, not a lot of text */
const BOMB_BYTES = 1024 ** 3;
const BOMB_RATIO = 100;

export function review(entries: Entry[]): Review {
    const out: Review = { files: 0, folders: 0, size: 0, packed: 0, found: {}, bomb: false };
    const folders = new Set<string>();
    for (const entry of entries) {
        const parts = entry.path.split(/[\\/]/).filter(Boolean);
        // Folders that only show up in their files' paths count too
        for (let i = 1; i < parts.length + (entry.dir ? 1 : 0); i++) folders.add(parts.slice(0, i).join("/"));
        if (!entry.dir) {
            out.files++;
            out.size += entry.size;
            out.packed += entry.packed;
        }
        const kind = kindOf(entry);
        if (kind) (out.found[kind] ??= []).push(entry.path);
        // A password hides what a program is from virus scanners: say it too
        if (kind && kind !== "locked" && entry.encrypted) (out.found.locked ??= []).push(entry.path);
    }
    out.folders = folders.size;
    out.bomb = out.size > BOMB_BYTES && out.size > out.packed * BOMB_RATIO;
    return out;
}

/** How serious a review is: danger (red), warning (yellow) or nothing to say */
export function level(r: Review): "danger" | "warning" | null {
    if (r.bomb || r.found.disguised || r.found.escape) return "danger";
    if (r.found.program || r.found.locked) return "warning";
    return null;
}

export interface TreeNode {
    name: string;
    path: string;
    dir: boolean;
    size: number;
    kind: Kind | null;
    children: TreeNode[];
}

/** The entries as folders and files, folders first, then by name */
export function toTree(entries: Entry[]): TreeNode[] {
    const root: TreeNode = { name: "", path: "", dir: true, size: 0, kind: null, children: [] };
    const byPath = new Map<string, TreeNode>([["", root]]);
    const folder = (path: string): TreeNode => {
        let node = byPath.get(path);
        if (node) return node;
        const cut = path.lastIndexOf("/");
        const parent = folder(cut < 0 ? "" : path.slice(0, cut));
        node = { name: path.slice(cut + 1), path, dir: true, size: 0, kind: null, children: [] };
        parent.children.push(node);
        byPath.set(path, node);
        return node;
    };
    for (const entry of entries) {
        const path = entry.path.split(/[\\/]/).filter(p => p && p !== ".").join("/");
        if (!path) continue;
        const kind = kindOf(entry);
        if (entry.dir) {
            folder(path).kind ??= kind;
            continue;
        }
        const cut = path.lastIndexOf("/");
        const parent = folder(cut < 0 ? "" : path.slice(0, cut));
        parent.children.push({ name: path.slice(cut + 1), path, dir: false, size: entry.size, kind, children: [] });
    }
    const sort = (node: TreeNode): number => {
        node.children.sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name, undefined, { numeric: true }));
        if (node.dir) node.size = node.children.reduce((sum, c) => sum + sort(c), 0);
        return node.size;
    };
    sort(root);
    // A folder holding only one folder shows as one row, "assets/minecraft/textures"
    const compact = (node: TreeNode): TreeNode => {
        while (node.dir && !node.kind && node.children.length === 1 && node.children[0].dir) {
            const only = node.children[0];
            node = { ...only, name: `${node.name}/${only.name}` };
        }
        node.children = node.children.map(compact);
        return node;
    };
    return root.children.map(compact);
}
