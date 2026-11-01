import { describe, expect, test } from "bun:test";

import { collectFiles, dropFiles, swapUploadFile, uploadFile } from "../plugins/strip-metadata/args";
import { detectImage, orientationSegment, randomFileName, readExifOrientation, stripMetadata } from "../plugins/strip-metadata/strip";

const bytes = (...parts: (number[] | string | Uint8Array)[]) => {
    const flat: number[] = [];
    for (const p of parts) {
        if (typeof p === "string") for (const c of p) flat.push(c.charCodeAt(0));
        else flat.push(...p);
    }
    return new Uint8Array(flat);
};
const contains = (hay: Uint8Array, needle: string) => Buffer.from(hay).includes(Buffer.from(needle, "latin1"));

const u32be = (n: number) => [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const u32le = (n: number) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, n >>> 24];
const seg = (marker: number, payload: Uint8Array) => bytes([0xff, marker, (payload.length + 2) >> 8, (payload.length + 2) & 255], payload);

/** EXIF with Orientation and a GPS-looking string */
function exif(orientation: number) {
    const tiff = bytes("MM", [0, 42], u32be(8), [0, 1], [0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, orientation, 0, 0], u32be(0), "GPS 52.5200N 13.4050E");
    return bytes("Exif\0\0", tiff);
}

const APP0 = seg(0xe0, bytes("JFIF\0", [1, 1, 0, 0, 1, 0, 1, 0, 0]));
const DQT = seg(0xdb, bytes([0], new Array(64).fill(1)));
const SCAN = bytes([0xff, 0xda, 0, 8, 1, 1, 0, 0, 0x3f, 0], [0x12, 0x34, 0xff, 0x00, 0x56], [0xff, 0xd9]);

function jpeg(...segments: Uint8Array[]) {
    return bytes([0xff, 0xd8], ...segments, SCAN);
}

describe("JPEG", () => {
    test("removes EXIF, XMP, IPTC and comments, keeps image data byte for byte", () => {
        const input = jpeg(
            APP0,
            seg(0xe1, exif(1)),
            seg(0xe1, bytes("http://ns.adobe.com/xap/1.0/\0<x:xmpmeta>secret</x:xmpmeta>")),
            seg(0xed, bytes("Photoshop 3.0\0IPTC")),
            seg(0xfe, bytes("a comment")),
            DQT,
        );
        const { data, changed, kind } = stripMetadata(input);
        expect(kind).toBe("jpeg");
        expect(changed).toBe(true);
        expect(data).toEqual(jpeg(APP0, DQT));
        expect(contains(data, "GPS")).toBe(false);
        expect(contains(data, "xmpmeta")).toBe(false);
    });

    test("keeps the orientation as a minimal EXIF block after APP0", () => {
        const { data } = stripMetadata(jpeg(APP0, seg(0xe1, exif(6)), DQT));
        expect(data).toEqual(jpeg(APP0, orientationSegment(6), DQT));
        expect(readExifOrientation(orientationSegment(6).subarray(4))).toBe(6);
        expect(contains(data, "GPS")).toBe(false);
    });

    test("keeps ICC profiles and Adobe segments", () => {
        const icc = seg(0xe2, bytes("ICC_PROFILE\0", [1, 1, 9, 9]));
        const adobe = seg(0xee, bytes("Adobe", [0, 100, 0, 0, 0, 0, 1]));
        const { data } = stripMetadata(jpeg(APP0, seg(0xe1, exif(1)), icc, adobe, DQT));
        expect(data).toEqual(jpeg(APP0, icc, adobe, DQT));
    });

    test("a clean JPEG is returned as is", () => {
        const input = jpeg(APP0, DQT);
        const result = stripMetadata(input);
        expect(result.changed).toBe(false);
        expect(result.data).toBe(input);
    });

    test("drops MPF secondary images and anything else after the image's EOI", () => {
        const mpf = seg(0xe2, bytes("MPF\0", "MM", [0, 42], u32be(8)));
        const secondary = bytes([0xff, 0xd8], seg(0xe1, exif(1)), DQT, SCAN);
        const { data, changed } = stripMetadata(bytes(jpeg(APP0, seg(0xe1, exif(1)), mpf, DQT), secondary, "ftypmp42 motion photo video"));
        expect(changed).toBe(true);
        expect(data).toEqual(jpeg(APP0, DQT));
        expect(contains(data, "GPS")).toBe(false);
        expect(contains(data, "motion")).toBe(false);
    });

    test("a clean JPEG with data appended after EOI is cut there", () => {
        const { data, changed } = stripMetadata(bytes(jpeg(APP0, DQT), "GPS 52.5200N"));
        expect(changed).toBe(true);
        expect(data).toEqual(jpeg(APP0, DQT));
    });

    test("keeps every scan of a progressive JPEG, with restart markers, stuffing and tables between", () => {
        const dht = seg(0xc4, bytes([0], new Array(16).fill(0)));
        const scans = bytes(
            [0xff, 0xda, 0, 8, 1, 1, 0, 0, 0x3f, 0], [0x12, 0xff, 0x00, 0x34, 0xff, 0xd0, 0x56, 0xff, 0xff, 0xd1, 0x78],
            dht,
            [0xff, 0xda, 0, 8, 1, 1, 0, 1, 0x3f, 0], [0x9a, 0xff, 0x00, 0xbc],
            [0xff, 0xd9],
        );
        const input = bytes([0xff, 0xd8], APP0, seg(0xe1, exif(1)), DQT, scans);
        const { data, changed } = stripMetadata(input);
        expect(changed).toBe(true);
        expect(data).toEqual(bytes([0xff, 0xd8], APP0, DQT, scans));
    });

    test("a broken segment after the first scan keeps the rest as it is", () => {
        const scan = bytes([0xff, 0xda, 0, 8, 1, 1, 0, 0, 0x3f, 0], [0x12, 0x34]);
        const rest = bytes([0xff, 0xc4, 0xff, 0xf0, 1, 2, 3], [0xff, 0xd9]);
        const { data, changed } = stripMetadata(bytes([0xff, 0xd8], APP0, seg(0xe1, exif(1)), DQT, scan, rest));
        expect(changed).toBe(true);
        expect(data).toEqual(bytes([0xff, 0xd8], APP0, DQT, scan, rest));
    });

    test("a bogus marker or a lone FF after the first scan keeps the rest and still strips", () => {
        const scan = bytes([0xff, 0xda, 0, 8, 1, 1, 0, 0, 0x3f, 0], [1, 2, 3]);
        for (const rest of [bytes([0xff, 0xc4, 0, 4, 9, 9, 0x55, 0x66], [0xff, 0xd9]), bytes([0xff])]) {
            const { data, changed } = stripMetadata(bytes([0xff, 0xd8], APP0, seg(0xe1, exif(1)), DQT, scan, rest));
            expect(changed).toBe(true);
            expect(data).toEqual(bytes([0xff, 0xd8], APP0, DQT, scan, rest));
            expect(contains(data, "GPS")).toBe(false);
        }
    });

    test("a truncated JPEG is left untouched and marked failed", () => {
        const input = bytes([0xff, 0xd8], [0xff, 0xe1, 0x10, 0x00], "Exif");
        expect(stripMetadata(input)).toEqual({ data: input, changed: false, kind: "jpeg", failed: true });
    });

    test("a JPEG that ends before any image data is marked failed", () => {
        const input = bytes([0xff, 0xd8], APP0, seg(0xe1, exif(1)), DQT);
        expect(stripMetadata(input)).toEqual({ data: input, changed: false, kind: "jpeg", failed: true });
    });

    test("a clean JPEG isn't marked failed", () => {
        expect(stripMetadata(jpeg(APP0, DQT)).failed).toBe(false);
        expect(stripMetadata(jpeg(APP0, seg(0xe1, exif(6)), DQT)).failed).toBe(false);
    });
});

function chunk(type: string, data: Uint8Array) {
    // CRC isn't checked by the stripper, a fixed value keeps the test readable
    return bytes(u32be(data.length), type, data, [1, 2, 3, 4]);
}
const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const IHDR = chunk("IHDR", bytes(u32be(1), u32be(1), [8, 2, 0, 0, 0]));
const IDAT = chunk("IDAT", bytes([0x78, 0x9c, 1, 2, 3]));
const IEND = chunk("IEND", new Uint8Array());

describe("PNG", () => {
    test("removes text, EXIF and time chunks, keeps the rest", () => {
        const input = bytes(
            PNG_SIG, IHDR,
            chunk("tEXt", bytes("Author\0Jane")),
            chunk("iTXt", bytes("XML:com.adobe.xmp\0\0\0\0\0<xmp/>")),
            chunk("zTXt", bytes("Comment\0\0xx")),
            chunk("eXIf", bytes("MM", [0, 42], "GPS")),
            chunk("tIME", bytes([7, 234, 1, 1, 0, 0, 0])),
            IDAT, IEND,
        );
        const { data, changed, kind } = stripMetadata(input);
        expect(kind).toBe("png");
        expect(changed).toBe(true);
        expect(data).toEqual(bytes(PNG_SIG, IHDR, IDAT, IEND));
    });

    test("drops data hidden after IEND", () => {
        const { data } = stripMetadata(bytes(PNG_SIG, IHDR, IDAT, IEND, "hidden"));
        expect(data).toEqual(bytes(PNG_SIG, IHDR, IDAT, IEND));
    });

    test("a clean PNG is returned as is", () => {
        const input = bytes(PNG_SIG, IHDR, IDAT, IEND);
        expect(stripMetadata(input)).toEqual({ data: input, changed: false, kind: "png", failed: false });
    });

    test("drops C2PA (caBX) chunks", () => {
        const { data, changed } = stripMetadata(bytes(PNG_SIG, IHDR, chunk("caBX", bytes("jumb c2pa manifest")), IDAT, IEND));
        expect(changed).toBe(true);
        expect(data).toEqual(bytes(PNG_SIG, IHDR, IDAT, IEND));
    });

    test("a truncated PNG is left untouched and marked failed", () => {
        const full = bytes(PNG_SIG, IHDR, chunk("eXIf", bytes("MM", [0, 42], "GPS")), IDAT, IEND);
        for (const input of [full.subarray(0, full.length - 20), full.subarray(0, 30)]) {
            const result = stripMetadata(input);
            expect(result.failed).toBe(true);
            expect(result.changed).toBe(false);
            expect(result.data).toBe(input);
        }
    });
});

describe("WebP", () => {
    const riff = (...chunks: Uint8Array[]) => {
        const body = bytes(...chunks);
        return bytes("RIFF", u32le(body.length + 4), "WEBP", body);
    };
    const wchunk = (type: string, data: Uint8Array) => bytes(type, u32le(data.length), data, data.length & 1 ? [0] : []);

    test("removes EXIF and XMP chunks and their VP8X flags", () => {
        const vp8x = (flags: number) => wchunk("VP8X", bytes([flags, 0, 0, 0, 0, 0, 0, 0, 0, 0]));
        const image = wchunk("VP8 ", bytes([1, 2, 3, 4, 5]));
        const input = riff(vp8x(0x08 | 0x04 | 0x10), image, wchunk("EXIF", exif(1)), wchunk("XMP ", bytes("<x/>")));
        const { data, changed } = stripMetadata(input);
        expect(changed).toBe(true);
        expect(data).toEqual(riff(vp8x(0x10), image));
    });

    test("removes C2PA chunks and anything after the RIFF", () => {
        const image = wchunk("VP8 ", bytes([1, 2, 3, 4, 5]));
        const { data, changed } = stripMetadata(bytes(riff(image, wchunk("C2PA", bytes("manifest"))), "GPS hidden"));
        expect(changed).toBe(true);
        expect(data).toEqual(riff(image));
    });

    test("a WebP whose chunk runs past its end is marked failed", () => {
        const input = riff(wchunk("VP8 ", bytes([1, 2, 3, 4, 5])), wchunk("EXIF", exif(1))).subarray(0, 30);
        const result = stripMetadata(input);
        expect(result.failed).toBe(true);
        expect(result.data).toBe(input);
    });
});

describe("GIF", () => {
    const sub = (data: Uint8Array) => bytes([data.length], data, [0]);
    const HEAD = bytes("GIF89a", [1, 0, 1, 0, 0x80, 0, 0], [0, 0, 0, 255, 255, 255]); // 1x1, 2 colour global table
    const LOOP = bytes([0x21, 0xff, 11], "NETSCAPE2.0", [3, 1, 0, 0, 0]);
    const GCE = bytes([0x21, 0xf9, 4, 0, 0, 0, 0, 0]);
    const FRAME = bytes([0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0], [2], sub(bytes([0x44, 0x01])));
    const COMMENT = bytes([0x21, 0xfe], sub(bytes("shot at 52.52N 13.40E")));
    const XMP = bytes([0x21, 0xff, 11], "XMP DataXMP", sub(bytes("<x:xmpmeta>GPS</x:xmpmeta>")));
    const gif = (...blocks: Uint8Array[]) => bytes(HEAD, ...blocks, [0x3b]);

    test("removes comments and XMP, keeps looping, frames and anything that draws", () => {
        const { data, changed, kind } = stripMetadata(gif(LOOP, COMMENT, XMP, GCE, FRAME, COMMENT, GCE, FRAME));
        expect(kind).toBe("gif");
        expect(changed).toBe(true);
        expect(data).toEqual(gif(LOOP, GCE, FRAME, GCE, FRAME));
        expect(contains(data, "GPS")).toBe(false);
        expect(contains(data, "52.52")).toBe(false);
    });

    test("frames with a local colour table, and data after the trailer goes", () => {
        const local = bytes([0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0x80], [1, 2, 3, 4, 5, 6], [2], sub(bytes([7, 8])));
        const { data } = stripMetadata(bytes(gif(GCE, local), "hidden"));
        expect(data).toEqual(gif(GCE, local));
    });

    test("a clean GIF is returned as is, one cut short after its frames too", () => {
        for (const input of [gif(LOOP, GCE, FRAME), bytes(HEAD, GCE, FRAME)]) {
            expect(stripMetadata(input)).toEqual({ data: input, changed: false, kind: "gif", failed: false });
        }
    });

    test("a GIF cut inside a block, or with an unknown block, is marked failed", () => {
        for (const input of [gif(COMMENT).subarray(0, HEAD.length + 6), bytes(HEAD, [0x99, 1, 2, 3])]) {
            const result = stripMetadata(input);
            expect(result.failed).toBe(true);
            expect(result.data).toBe(input);
        }
    });
});

describe("images we can't rewrite", () => {
    const ftyp = (brand: string) => bytes(u32be(24), "ftyp", brand, u32be(0), "mif1heic", "Exif GPS");

    test("HEIC, AVIF, TIFF and JPEG XL are recognised and always marked failed", () => {
        const cases: [Uint8Array, string][] = [
            [ftyp("heic"), "heif"],
            [ftyp("mif1"), "heif"],
            [ftyp("avif"), "avif"],
            [bytes("II*\0", u32le(8), "GPS"), "tiff"],
            [bytes("MM\0*", u32be(8), "GPS"), "tiff"],
            [bytes([0xff, 0x0a], "GPS"), "jxl"],
            [bytes([0, 0, 0, 0x0c, 0x4a, 0x58, 0x4c, 0x20, 0x0d, 0x0a, 0x87, 0x0a], "GPS"), "jxl"],
        ];
        for (const [input, kind] of cases) {
            expect(detectImage(input)).toBe(kind as any);
            expect(stripMetadata(input)).toEqual({ data: input, changed: false, kind: kind as any, failed: true });
        }
    });

    test("videos in the same container aren't images", () => {
        for (const brand of ["isom", "mp42", "qt  "]) expect(detectImage(ftyp(brand))).toBeNull();
    });
});

describe("other files", () => {
    test("non-images are never touched", () => {
        for (const input of [bytes("%PDF-1.7 GPS"), bytes("PK\x03\x04"), bytes("hello"), new Uint8Array()]) {
            expect(detectImage(input)).toBeNull();
            const result = stripMetadata(input);
            expect(result.changed).toBe(false);
            expect(result.failed).toBe(false);
            expect(result.data).toBe(input);
        }
    });
});

describe("taking files out of upload calls", () => {
    const a = new File(["a"], "a.jpg");
    const b = new File(["b"], "b.heic");
    const c = new File(["c"], "c.png");

    test("finds files in lists, upload items and arguments", () => {
        const args = [{ files: [{ file: a, platform: 1 }, { file: b, platform: 1 }], channelId: "1" }, [c]];
        expect(collectFiles(args).map(f => f.file)).toEqual([a, b, c]);
    });

    test("removes queued upload items and files in lists", () => {
        const items = [{ file: a, platform: 1 }, { file: b, platform: 1 }, { file: c, platform: 1 }];
        const args: unknown[] = [{ files: items, channelId: "1", draftType: 0 }];
        expect(dropFiles(args, new Set([b]))).toBe(true);
        expect(items.map(i => i.file)).toEqual([a, c]);
        const list = [a, b, c];
        expect(dropFiles([list, "channel"], new Set([a, c]))).toBe(true);
        expect(list).toEqual([b]);
    });

    test("a file passed on its own or as a single item can't be taken out", () => {
        expect(dropFiles(["channel", "id", 0, b], new Set([b]))).toBe(false);
        expect(dropFiles([{ file: { id: "x", file: b, platform: 1 }, channelId: "1" }], new Set([b]))).toBe(false);
        expect(dropFiles([{ file: { id: "x", file: a, platform: 1 }, channelId: "1" }], new Set([b]))).toBe(true);
    });
});

describe("uploads made without the queue", () => {
    /** Discord's CloudUpload, as much of it as a swap touches */
    const cloudUpload = (file: unknown) => ({
        item: { file, platform: 1 }, currentSize: file instanceof File ? file.size : 0, filename: file instanceof File ? file.name : "",
        setFilename(name: string) { this.filename = name; },
    });

    test("reads the file an upload is about to send", () => {
        const file = new File(["abc"], "photo.jpg");
        expect(uploadFile(cloudUpload(file))).toBe(file);
        expect(uploadFile(cloudUpload("not a file"))).toBeUndefined();
        expect(uploadFile(null)).toBeUndefined();
        expect(uploadFile({})).toBeUndefined();
    });

    test("the cleaned file replaces it, with its size and name, as Discord's own conversion does", () => {
        const upload = cloudUpload(new File(["a much longer original"], "IMG_0001.jpg"));
        const clean = new File(["short"], "k3j9x2.jpg");
        swapUploadFile(upload, clean);
        expect(upload.item.file).toBe(clean);
        expect(upload.currentSize).toBe(5);
        expect(upload.filename).toBe("k3j9x2.jpg");
    });
});

describe("random file names", () => {
    test("keep the extension and nothing else", () => {
        const name = randomFileName("IMG_2041 at home.JPG");
        expect(name).toMatch(/^[a-z0-9]{12}\.JPG$/);
        expect(name).not.toContain("IMG");
        expect(randomFileName("archive.tar.gz")).toMatch(/^[a-z0-9]{12}\.gz$/);
    });

    test("names without an extension get none", () => {
        expect(randomFileName("README")).toMatch(/^[a-z0-9]{12}$/);
        expect(randomFileName(".bashrc")).toMatch(/^[a-z0-9]{12}$/);
        expect(randomFileName("weird.ext with spaces")).toMatch(/^[a-z0-9]{12}$/);
    });

    test("are random", () => {
        expect(randomFileName("a.png")).not.toBe(randomFileName("a.png"));
        expect(randomFileName("a.png", () => 0)).toBe("aaaaaaaaaaaa.png");
    });
});
