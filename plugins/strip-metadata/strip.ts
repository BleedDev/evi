/**
 * Byte-level metadata removal, no re-encoding: the image data is copied as is, only metadata
 * containers are dropped. Anything that doesn't parse cleanly is returned untouched and marked
 * `failed`, so the upload can ask before it goes out with its metadata.
 *
 * - JPEG: drops APP1 (EXIF, XMP), APP13 (IPTC/Photoshop), every other APPn and COM segments.
 *   Kept: APP0 (JFIF), APP2 ICC_PROFILE (colours) and APP14 Adobe (needed to decode CMYK/YCCK).
 *   The EXIF Orientation is kept as a minimal 32 byte EXIF block, or phone photos would show sideways.
 *   Anything after the image's EOI goes too: MPF secondary images (previews, gain maps, each with
 *   its own EXIF) and a motion photo's video are appended there.
 * - PNG: drops tEXt, iTXt, zTXt, eXIf, tIME and caBX (C2PA) chunks, and anything after IEND.
 * - WebP: drops EXIF, XMP and C2PA chunks and clears the EXIF/XMP VP8X flags, and anything after the RIFF.
 * - GIF: drops comments and application extensions other than looping (NETSCAPE2.0, ANIMEXTS1.0)
 *   and ICC colours, XMP included, and anything after the trailer.
 * - HEIC/HEIF, AVIF, TIFF (camera raws too) and JPEG XL are recognised but not rewritten: always `failed`.
 */

export type ImageKind = "jpeg" | "png" | "webp" | "gif";
/** Images that carry EXIF and XMP (GPS included) in a container we don't rewrite */
export type UnsupportedImageKind = "heif" | "avif" | "tiff" | "jxl";

export interface StripResult {
    data: Uint8Array;
    /** Whether anything was removed */
    changed: boolean;
    kind: ImageKind | UnsupportedImageKind | null;
    /** An image whose metadata may still be in `data`: a kind we can't rewrite, or one we can that didn't parse */
    failed: boolean;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const PNG_DROP = new Set(["tEXt", "iTXt", "zTXt", "eXIf", "tIME", "caBX"]);
const WEBP_DROP = new Set(["EXIF", "XMP ", "C2PA"]);
const GIF_KEEP_APPS = new Set(["NETSCAPE2.0", "ANIMEXTS1.0", "ICCRGBG1012"]);
/** ISO BMFF major brands: HEIC/HEIF stills and sequences, and AVIF */
const HEIF_BRANDS = new Set(["heic", "heix", "heim", "heis", "hevc", "hevx", "hevm", "hevs", "mif1", "msf1"]);
const AVIF_BRANDS = new Set(["avif", "avis"]);
const JXL_CONTAINER = [0, 0, 0, 0x0c, 0x4a, 0x58, 0x4c, 0x20, 0x0d, 0x0a, 0x87, 0x0a];

/** What a stripper found: the rewritten bytes, nothing to remove, or a file it couldn't follow */
const CLEAN = "clean";
const BROKEN = "broken";
type Outcome = Uint8Array | typeof CLEAN | typeof BROKEN;

const ascii = (b: Uint8Array, start: number, len: number) => String.fromCharCode(...b.subarray(start, start + len));

/** The kind of image from its first bytes (16 are enough), or null */
export function detectImage(b: Uint8Array): ImageKind | UnsupportedImageKind | null {
    if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpeg";
    if (b.length >= 8 && PNG_SIGNATURE.every((v, i) => b[i] === v)) return "png";
    if (b.length >= 12 && ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 4) === "WEBP") return "webp";
    if (b.length >= 6 && (ascii(b, 0, 6) === "GIF87a" || ascii(b, 0, 6) === "GIF89a")) return "gif";
    if (b.length >= 12 && ascii(b, 4, 4) === "ftyp") {
        const brand = ascii(b, 8, 4);
        if (HEIF_BRANDS.has(brand)) return "heif";
        if (AVIF_BRANDS.has(brand)) return "avif";
    }
    if (b.length >= 4 && (ascii(b, 0, 4) === "II*\0" || ascii(b, 0, 4) === "MM\0*")) return "tiff";
    if ((b.length >= 2 && b[0] === 0xff && b[1] === 0x0a) || (b.length >= 12 && JXL_CONTAINER.every((v, i) => b[i] === v))) return "jxl";
    return null;
}

export function stripMetadata(data: Uint8Array): StripResult {
    const kind = detectImage(data);
    const out: Outcome | null = kind === "jpeg" ? stripJpeg(data)
        : kind === "png" ? stripPng(data)
        : kind === "webp" ? stripWebp(data)
        : kind === "gif" ? stripGif(data)
        : kind ? BROKEN : null;
    if (out instanceof Uint8Array) return { data: out, changed: true, kind, failed: false };
    return { data, changed: false, kind, failed: out === BROKEN };
}

function concat(parts: Uint8Array[]) {
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let offset = 0;
    for (const p of parts) {
        out.set(p, offset);
        offset += p.length;
    }
    return out;
}


/** Reads the Orientation tag (0x0112) from an APP1 EXIF payload (after the length bytes) */
export function readExifOrientation(seg: Uint8Array): number | undefined {
    if (seg.length < 14 || ascii(seg, 0, 6) !== "Exif\0\0") return;
    const tiff = seg.subarray(6);
    const order = ascii(tiff, 0, 2);
    if (order !== "II" && order !== "MM") return;
    const view = new DataView(tiff.buffer, tiff.byteOffset, tiff.byteLength);
    const le = order === "II";
    if (view.getUint16(2, le) !== 42) return;
    const ifd = view.getUint32(4, le);
    if (ifd + 2 > tiff.length) return;
    const count = view.getUint16(ifd, le);
    for (let i = 0; i < count; i++) {
        const entry = ifd + 2 + i * 12;
        if (entry + 12 > tiff.length) return;
        if (view.getUint16(entry, le) === 0x0112) {
            const value = view.getUint16(entry + 8, le);
            return value >= 1 && value <= 8 ? value : undefined;
        }
    }
}

/** A whole APP1 segment (marker included) holding only an Orientation tag */
export function orientationSegment(orientation: number) {
    const payload = [
        ...[0x45, 0x78, 0x69, 0x66, 0, 0], // "Exif\0\0"
        0x4d, 0x4d, 0x00, 0x2a, 0, 0, 0, 8, // big endian TIFF header, IFD0 at 8
        0, 1, // one entry
        0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, orientation, 0, 0, // Orientation, SHORT, 1, value
        0, 0, 0, 0, // no next IFD
    ];
    const len = payload.length + 2;
    return new Uint8Array([0xff, 0xe1, len >> 8, len & 0xff, ...payload]);
}

function keepJpegSegment(marker: number, payload: Uint8Array) {
    if (marker === 0xe0) return true; // APP0 JFIF/JFXX
    if (marker === 0xe2) return ascii(payload, 0, 12) === "ICC_PROFILE\0";
    if (marker === 0xee) return ascii(payload, 0, 5) === "Adobe";
    return false;
}

/**
 * Where a scan's entropy-coded data ends: the first FF that starts a marker. FF 00 is a stuffed FF,
 * FF D0-D7 are restart markers and FF FF is fill, all part of the data. The end of the file when none.
 */
function scanEnd(b: Uint8Array, i: number) {
    while ((i = b.indexOf(0xff, i)) !== -1 && i + 1 < b.length) {
        const next = b[i + 1];
        if (next === 0xff) i++;
        else if (next === 0 || (next >= 0xd0 && next <= 0xd7)) i += 2;
        else return i;
    }
    return b.length;
}

function stripJpeg(b: Uint8Array): Outcome {
    const parts: Uint8Array[] = [b.subarray(0, 2)];
    let orientation: number | undefined;
    let removed = false;
    let scanned = false;
    let i = 2;

    while (i < b.length) {
        let markerAt = i;
        while (b[markerAt + 1] === 0xff) markerAt++; // fill bytes
        const marker = b[i] === 0xff ? b[markerAt + 1] : undefined; // none when b[i] is not a marker or the file ends
        if (marker === undefined) {
            if (!scanned) return BROKEN;
            // Already past image data that decodes: the rest stays as it is
            parts.push(b.subarray(i));
            break;
        }

        // End of image: whatever follows isn't this image
        if (marker === 0xd9) {
            parts.push(b.subarray(markerAt, markerAt + 2));
            if (markerAt + 2 < b.length) removed = true;
            break;
        }
        // Standalone markers have no length
        if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
            parts.push(b.subarray(markerAt, markerAt + 2));
            i = markerAt + 2;
            continue;
        }

        const len = markerAt + 4 > b.length ? 0 : (b[markerAt + 2] << 8) | b[markerAt + 3];
        const end = markerAt + 2 + len;
        if (len < 2 || end > b.length) {
            if (!scanned) return BROKEN;
            parts.push(b.subarray(i));
            break;
        }
        const payload = b.subarray(markerAt + 4, end);

        const isMeta = (marker >= 0xe0 && marker <= 0xef) || marker === 0xfe;
        if (isMeta && !keepJpegSegment(marker, payload)) {
            if (marker === 0xe1) orientation ??= readExifOrientation(payload);
            removed = true;
        } else {
            parts.push(b.subarray(markerAt, end));
        }
        i = end;

        // Start of scan: its image data is copied untouched, up to the next marker (another scan's
        // tables or SOS in a progressive JPEG, or EOI)
        if (marker === 0xda) {
            scanned = true;
            i = scanEnd(b, end);
            parts.push(b.subarray(end, i));
        }
    }

    // No image data at all: not a JPEG we can vouch for
    if (!scanned) return BROKEN;
    if (!removed) return CLEAN;
    // Orientation 1 is the default, no need to keep it
    if (orientation && orientation !== 1) {
        // After APP0 when there is one, as JFIF wants to be first
        const at = parts.length > 1 && parts[1][1] === 0xe0 ? 2 : 1;
        parts.splice(at, 0, orientationSegment(orientation));
    }
    return concat(parts);
}


function stripPng(b: Uint8Array): Outcome {
    const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
    const parts: Uint8Array[] = [b.subarray(0, 8)];
    let removed = false;
    let i = 8;

    while (i < b.length) {
        if (i + 12 > b.length) return BROKEN;
        const len = view.getUint32(i);
        const type = ascii(b, i + 4, 4);
        const end = i + 12 + len;
        if (end > b.length) return BROKEN;

        if (PNG_DROP.has(type)) removed = true;
        else parts.push(b.subarray(i, end));
        i = end;

        if (type === "IEND") {
            if (i < b.length) removed = true; // trailing data after the image
            break;
        }
    }

    return removed ? concat(parts) : CLEAN;
}


function stripWebp(b: Uint8Array): Outcome {
    const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
    const riffEnd = Math.min(b.length, 8 + view.getUint32(4, true));
    const parts: Uint8Array[] = [];
    // Anything after the RIFF isn't part of the image
    let removed = riffEnd < b.length;
    let i = 12;

    while (i + 8 <= riffEnd) {
        const type = ascii(b, i, 4);
        const size = view.getUint32(i + 4, true);
        const end = i + 8 + size + (size & 1);
        if (i + 8 + size > riffEnd) return BROKEN;

        if (WEBP_DROP.has(type)) {
            removed = true;
        } else if (type === "VP8X" && size >= 1) {
            const chunk = b.slice(i, Math.min(end, riffEnd));
            chunk[8] &= ~(0x08 | 0x04); // EXIF and XMP present flags
            parts.push(chunk);
        } else {
            parts.push(b.subarray(i, Math.min(end, riffEnd)));
        }
        i = end;
    }
    // Part of a chunk header left over: the file was cut inside the chunk list
    if (i < riffEnd) return BROKEN;

    if (!removed) return CLEAN;
    const body = concat(parts);
    const header = new Uint8Array(12);
    header.set(b.subarray(0, 12));
    new DataView(header.buffer).setUint32(4, body.length + 4, true);
    return concat([header, body]);
}


/** Where a run of GIF data sub-blocks (each a length byte, then that many bytes) ends: after its 0 terminator. -1 if the file ends first */
function subBlocksEnd(b: Uint8Array, i: number) {
    while (i < b.length) {
        const size = b[i];
        if (size === 0) return i + 1;
        i += size + 1;
    }
    return -1;
}

/** Graphic control and plain text extensions draw the image; of application extensions, looping and ICC colours stay */
function keepGifExtension(b: Uint8Array, i: number) {
    const label = b[i + 1];
    if (label === 0xf9 || label === 0x01) return true;
    return label === 0xff && b[i + 2] === 11 && GIF_KEEP_APPS.has(ascii(b, i + 3, 11));
}

function stripGif(b: Uint8Array): Outcome {
    if (b.length < 13) return BROKEN;
    const screen = b[10];
    let i = 13 + (screen & 0x80 ? 3 << ((screen & 7) + 1) : 0); // global colour table
    if (i > b.length) return BROKEN;
    const parts: Uint8Array[] = [b.subarray(0, i)];
    let removed = false;

    // A GIF cut short without its trailer still shows: everything up to there was read
    while (i < b.length) {
        const block = b[i];
        if (block === 0x3b) {
            parts.push(b.subarray(i, i + 1));
            if (i + 1 < b.length) removed = true; // trailing data after the image
            break;
        }
        let end: number;
        if (block === 0x2c) {
            // Image descriptor, local colour table, LZW code size, then the image data
            if (i + 10 > b.length) return BROKEN;
            const packed = b[i + 9];
            end = subBlocksEnd(b, i + 10 + (packed & 0x80 ? 3 << ((packed & 7) + 1) : 0) + 1);
            if (end < 0) return BROKEN;
            parts.push(b.subarray(i, end));
        } else if (block === 0x21) {
            end = subBlocksEnd(b, i + 2);
            if (end < 0) return BROKEN;
            if (keepGifExtension(b, i)) parts.push(b.subarray(i, end));
            else removed = true;
        } else {
            return BROKEN;
        }
        i = end;
    }

    return removed ? concat(parts) : CLEAN;
}


/** A random name keeping the extension: "IMG_2041.JPG" -> "k3v9x0q2m7ab.JPG" */
export function randomFileName(name: string, random: () => number = Math.random) {
    const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
    let base = "";
    for (let i = 0; i < 12; i++) base += chars[Math.floor(random() * chars.length) % chars.length];
    const match = /\.([A-Za-z0-9]{1,10})$/.exec(name);
    // ".bashrc" is a name, not an extension
    return match && match.index > 0 ? `${base}.${match[1]}` : base;
}
