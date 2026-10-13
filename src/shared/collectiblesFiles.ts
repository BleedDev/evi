/**
 * Where Evi keeps the collectibles' files and where it fetches them from (main/collectibles.ts),
 * apart from Electron so the tests can check it.
 */
import { COLLECTIBLES_ORIGIN, isCollectibleUrl } from "./collectibles";

/** Largest file Evi takes: a profile effect layer is the biggest, an APNG of a few MB */
export const MAX_COLLECTIBLE_BYTES = 16 * 1024 * 1024;

/** The version a file's URL carries (?v=), or "0" for none: a new version is a new file on disk */
export function fileVersion(url: string): string {
    const v = new URL(url).searchParams.get("v");
    return v && /^[\w-]{1,40}$/.test(v) ? v : "0";
}

/**
 * Where a file goes in the cache folder: "<bundle>/<name>.<version>.<ext>". Only evi.rest's own
 * collectible URLs have one, so nothing from a document can name a path outside the folder.
 */
export function cacheName(url: unknown): { dir: string; file: string; name: string; ext: string; } | undefined {
    if (!isCollectibleUrl(url)) return undefined;
    const [, , bundle, file] = new URL(url).pathname.split("/");
    const dot = file.lastIndexOf(".");
    const name = file.slice(0, dot), ext = file.slice(dot + 1);
    return { dir: bundle, file: `${name}.${fileVersion(url)}.${ext}`, name, ext };
}

/**
 * The address a file is fetched from: evi.rest's, or the same path on the API's own server when Evi
 * talks to another one (a local evi.rest while developing)
 */
export function fetchUrlFor(url: string, apiBase: string): string {
    const u = new URL(url);
    const api = new URL(apiBase);
    if (api.origin === COLLECTIBLES_ORIGIN) return u.href;
    return api.origin + u.pathname + u.search;
}

/** What the bytes are, by their first bytes: only PNG (APNG too) and WebM are collectibles */
export function sniffMime(bytes: Uint8Array): "image/png" | "video/webm" | undefined {
    if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return "image/png";
    if (bytes.length >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return "video/webm";
    return undefined;
}

/** The type a file's name promises */
export const mimeForExt = (ext: string) => ext === "webm" ? "video/webm" : "image/png";
