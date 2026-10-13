import { describe, expect, test } from "bun:test";

import { decodeName, type Entry, isArchive, kindOf, level, listZip, review, TAIL_BYTES, toTree } from "../plugins/look-inside/zip";

interface File { name: string | Uint8Array; data?: number; size?: number; dir?: boolean; encrypted?: boolean; utf8Flag?: boolean; }

/**
 * A zip's directory and end records, as a real zip lays them out (file contents left as zeros: only
 * their length matters here). `zip64` writes the sizes and counts the zip64 way, `prefix` puts bytes
 * in front like a self-extracting archive, `comment` adds an archive comment.
 */
function makeZip(files: File[], { zip64 = false, prefix = 0, comment = "" } = {}) {
    const enc = new TextEncoder();
    const chunks: number[] = new Array(prefix).fill(0x4d);
    const dir: number[] = [];
    const u16 = (a: number[], v: number) => a.push(v & 0xff, v >> 8 & 0xff);
    const u32 = (a: number[], v: number) => a.push(v & 0xff, v >> 8 & 0xff, v >> 16 & 0xff, v >>> 24 & 0xff);
    const u64 = (a: number[], v: number) => { u32(a, v % 2 ** 32); u32(a, Math.floor(v / 2 ** 32)); };

    for (const f of files) {
        const name = typeof f.name === "string" ? enc.encode(f.name) : f.name;
        const offset = chunks.length;
        const data = f.data ?? 0;
        // Local header (its contents aren't read) and the data
        u32(chunks, 0x04034b50);
        chunks.push(...new Array(26 + name.length + data).fill(0));

        const extra: number[] = [];
        if (zip64) {
            u16(extra, 0x0001);
            u16(extra, 16);
            u64(extra, f.size ?? data);
            u64(extra, data);
        }
        u32(dir, 0x02014b50);
        u16(dir, 20); u16(dir, 20);
        u16(dir, (f.encrypted ? 1 : 0) | (f.utf8Flag ? 0x800 : 0));
        u16(dir, 8); u32(dir, 0); u32(dir, 0);
        u32(dir, zip64 ? 0xffffffff : data);
        u32(dir, zip64 ? 0xffffffff : f.size ?? data);
        u16(dir, name.length); u16(dir, extra.length); u16(dir, 0);
        u16(dir, 0); u16(dir, 0);
        u32(dir, f.dir ? 0x10 : 0);
        u32(dir, offset - prefix);
        dir.push(...name, ...extra);
    }

    const dirOffset = chunks.length - prefix;
    chunks.push(...dir);
    const end: number[] = [];
    if (zip64) {
        const rec = chunks.length;
        u32(end, 0x06064b50); u64(end, 44); u16(end, 45); u16(end, 45); u32(end, 0); u32(end, 0);
        u64(end, files.length); u64(end, files.length); u64(end, dir.length); u64(end, dirOffset);
        u32(end, 0x07064b50); u32(end, 0); u64(end, rec - prefix); u32(end, 1);
    }
    const c = enc.encode(comment);
    u32(end, 0x06054b50); u16(end, 0); u16(end, 0);
    u16(end, zip64 ? 0xffff : files.length); u16(end, zip64 ? 0xffff : files.length);
    u32(end, zip64 ? 0xffffffff : dir.length); u32(end, zip64 ? 0xffffffff : dirOffset);
    u16(end, c.length);
    end.push(...c);
    chunks.push(...end);
    return new Uint8Array(chunks);
}

/** Reads from the bytes like the CDN would, and counts what was asked for */
function reader(bytes: Uint8Array) {
    const asked: [number, number][] = [];
    const read = async (start: number, end: number) => {
        asked.push([start, end]);
        return bytes.subarray(start, end);
    };
    return { read, asked };
}

const entry = (path: string, more: Partial<Entry> = {}): Entry => ({ path, size: 10, packed: 5, dir: false, encrypted: false, ...more });

describe("listing a zip from its end", () => {
    test("names, sizes, folders and locked files, from one read of the end", async () => {
        const zip = makeZip([
            { name: "mod/", dir: true },
            { name: "mod/readme.txt", data: 40, size: 100 },
            { name: "mod/setup.exe", data: 7, encrypted: true },
        ], { comment: "made by test" });
        const { read, asked } = reader(zip);
        const listing = await listZip(read, zip.length);
        expect(listing).toEqual({
            kind: "list",
            entries: [
                { path: "mod/", size: 0, packed: 0, dir: true, encrypted: false },
                { path: "mod/readme.txt", size: 100, packed: 40, dir: false, encrypted: false },
                { path: "mod/setup.exe", size: 7, packed: 7, dir: false, encrypted: true },
            ],
        });
        expect(asked).toEqual([[0, zip.length]]);
    });

    test("a big zip: only its end is read, then the directory if it starts before that", async () => {
        const zip = makeZip([{ name: "big.bin", data: 200_000 }, { name: "b.txt" }]);
        const { read, asked } = reader(zip);
        const listing = await listZip(read, zip.length);
        expect(listing.kind === "list" && listing.entries.map(e => e.path)).toEqual(["big.bin", "b.txt"]);
        expect(asked).toEqual([[zip.length - TAIL_BYTES, zip.length]]);

        // A directory longer than the end that was read: one more read, for exactly the directory
        const many = makeZip(Array.from({ length: 2000 }, (_, i) => ({ name: `assets/textures/block_${i}.png` })));
        const r2 = reader(many);
        const l2 = await listZip(r2.read, many.length);
        expect(l2.kind === "list" && l2.entries.length).toBe(2000);
        expect(r2.asked.length).toBe(2);
    });

    test("zip64: sizes over 4 GB and the zip64 end record", async () => {
        const zip = makeZip([{ name: "disk.raw", data: 3, size: 6 * 1024 ** 3 }], { zip64: true });
        const listing = await listZip(reader(zip).read, zip.length);
        expect(listing).toEqual({ kind: "list", entries: [{ path: "disk.raw", size: 6 * 1024 ** 3, packed: 3, dir: false, encrypted: false }] });
    });

    test("a self-extracting archive: the directory is found from where it ends", async () => {
        const zip = makeZip([{ name: "a.txt" }, { name: "b.txt" }], { prefix: 5000 });
        const listing = await listZip(reader(zip).read, zip.length);
        expect(listing.kind === "list" && listing.entries.map(e => e.path)).toEqual(["a.txt", "b.txt"]);
    });

    test("not a zip, and a comment that only looks like an end record", async () => {
        const junk = new Uint8Array(3000).fill(7);
        expect(await listZip(reader(junk).read, junk.length)).toEqual({ kind: "notZip" });

        const zip = makeZip([{ name: "x.txt" }], { comment: "PK\x05\x06 fake" });
        const listing = await listZip(reader(zip).read, zip.length);
        expect(listing.kind === "list" && listing.entries.map(e => e.path)).toEqual(["x.txt"]);
    });

    test("names: UTF-8 with or without its flag, and old Windows code page 437", async () => {
        expect(decodeName(new TextEncoder().encode("über/日本.txt"), true)).toBe("über/日本.txt");
        expect(decodeName(new TextEncoder().encode("über.txt"), false)).toBe("über.txt");
        // "Übung.txt" written by an old Windows zipper: Ü is 0x9a in CP437
        expect(decodeName(new Uint8Array([0x9a, 0x62, 0x75, 0x6e, 0x67]), false)).toBe("Übung");
        const zip = makeZip([{ name: new Uint8Array([0x9a, 0x2e, 0x74, 0x78, 0x74]) }]);
        const listing = await listZip(reader(zip).read, zip.length);
        expect(listing.kind === "list" && listing.entries[0].path).toBe("Ü.txt");
    });
});

describe("what's worth a warning", () => {
    test("which attachments are zips", () => {
        expect(isArchive("pack.ZIP")).toBe(true);
        expect(isArchive("mod.jar")).toBe(true);
        expect(isArchive("world.mcworld")).toBe(true);
        expect(isArchive("photo.png")).toBe(false);
        expect(isArchive("archive.rar")).toBe(false);
        expect(isArchive(undefined)).toBe(false);
    });

    test("programs, disguises, escapes, locked and nested files", () => {
        expect(kindOf(entry("bin/game.exe"))).toBe("program");
        expect(kindOf(entry("run.BAT"))).toBe("program");
        expect(kindOf(entry("Game.app/", { dir: true }))).toBe("program");
        expect(kindOf(entry("invoice.pdf.exe"))).toBe("disguised");
        expect(kindOf(entry("photo.jpg     .scr"))).toBe("disguised");
        expect(kindOf(entry(`photo${String.fromCharCode(0x202e)}gnp.exe`))).toBe("disguised");
        expect(kindOf(entry("../../AppData/Roaming/start.bat"))).toBe("escape");
        expect(kindOf(entry("/etc/passwd"))).toBe("escape");
        expect(kindOf(entry("C:\\Windows\\x.dll"))).toBe("escape");
        expect(kindOf(entry("notes.txt", { encrypted: true }))).toBe("locked");
        expect(kindOf(entry("inner.7z"))).toBe("nested");
        expect(kindOf(entry("readme.md"))).toBe(null);
        expect(kindOf(entry("version.1.2.txt"))).toBe(null);
        expect(kindOf(entry("textures/", { dir: true }))).toBe(null);
    });

    test("a review counts files, folders and sizes, and says how serious it is", () => {
        const r = review([
            entry("mod/", { dir: true, size: 0, packed: 0 }),
            entry("mod/a.txt"),
            entry("mod/deep/b.txt"),
            entry("mod/setup.exe", { encrypted: true }),
        ]);
        expect(r.files).toBe(3);
        expect(r.folders).toBe(2);
        expect(r.size).toBe(30);
        expect(r.packed).toBe(15);
        expect(r.found).toEqual({ program: ["mod/setup.exe"], locked: ["mod/setup.exe"] });
        expect(level(r)).toBe("warning");

        expect(level(review([entry("a.txt"), entry("b.png")]))).toBe(null);
        expect(level(review([entry("cv.docx.exe")]))).toBe("danger");
        expect(level(review([entry("inner.zip")]))).toBe(null);
    });

    test("zip bombs: lots unpacked from little, not just a big zip", () => {
        expect(review([entry("x.bin", { size: 5 * 1024 ** 3, packed: 5 * 1024 ** 2 })]).bomb).toBe(true);
        expect(review([entry("video.mkv", { size: 2 * 1024 ** 3, packed: 2 * 1024 ** 3 - 100 })]).bomb).toBe(false);
        expect(review([entry("log.txt", { size: 500 * 1024 ** 2, packed: 1024 ** 2 })]).bomb).toBe(false);
    });
});

test("the tree: folders first, folders made from paths, sizes added up, lone folders joined", () => {
    const tree = toTree([
        entry("b.txt", { size: 1 }),
        entry("src/z.ts", { size: 2 }),
        entry("src/lib/a.ts", { size: 4 }),
        entry("./a.txt", { size: 8 }),
        entry("src/run.exe", { size: 16 }),
        entry("assets/minecraft/textures/", { dir: true }),
        entry("assets/minecraft/textures/block/dirt.png", { size: 32 }),
        entry("assets/minecraft/textures/block/sand.png", { size: 64 }),
    ]);
    const show = (nodes: ReturnType<typeof toTree>): unknown => nodes.map(n => n.dir ? { [n.name]: show(n.children), size: n.size } : `${n.name}${n.kind ? ` (${n.kind})` : ""}`);
    expect(show(tree)).toEqual([
        { "assets/minecraft/textures/block": ["dirt.png", "sand.png"], size: 96 },
        { src: [{ lib: ["a.ts"], size: 4 }, "run.exe (program)", "z.ts"], size: 22 },
        "a.txt",
        "b.txt",
    ]);
});
