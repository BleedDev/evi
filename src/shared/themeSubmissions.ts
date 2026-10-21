/**
 * Community themes: what an author sends to evi.rest (from the website, or from Evi's theme editor
 * with a linked account) and the checks it goes through before an admin reviews it. Shared by the
 * server, the app and the tests.
 *
 * The rule that matters most: a community theme loads nothing from the internet. Anything a
 * stylesheet fetches (an @import, a url() image or font) tells whoever serves it that this person
 * has Discord open with that theme, from which address, every time. So @import is refused outright,
 * and every address a theme mentions must be Discord's own CDN, which Discord talks to anyway. Images
 * and fonts can still be embedded as data: URLs, or fonts named when people have them installed.
 * CSS escapes are decoded before looking, so `\75rl(` or `\2f\2f` can't slip one past, and every
 * address is resolved the way the browser does, so https://cdn.discordapp.com@elsewhere is elsewhere.
 */
import { isPluginId, isVersion } from "./store";
import { whyNotCss } from "./themes";
import { englishTr, Tr } from "./tr";

/** The most a reviewer is asked to read, and the most a community theme can be */
export const MAX_COMMUNITY_THEME_BYTES = 512 * 1024;
export const MAX_THEME_SCREENSHOT_BYTES = 1024 * 1024;
export const MAX_THEME_TAGS = 5;
export const MAX_THEME_NOTES = 10;
/** Where a theme may point: Discord's CDN, which Discord already loads from */
export const ALLOWED_THEME_HOSTS: readonly string[] = ["cdn.discordapp.com", "media.discordapp.net"];

export type ScreenshotType = "image/png" | "image/jpeg" | "image/webp";
export const SCREENSHOT_EXTENSIONS: Record<ScreenshotType, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };

/** POST /v1/me/theme-submissions */
export interface ThemeSubmissionInput {
    /** The store id: lowercase letters, digits and dashes, the theme's file name once installed */
    id: string;
    name: string;
    description: string;
    version: string;
    tags: string[];
    /** What changed in this version, a line each */
    notes: string[];
    css: string;
    /** base64; checked against the type by its first bytes on the server */
    screenshot?: { type: ScreenshotType; data: string; };
}

/** What reading a theme found, for its review */
export interface ThemeScan {
    bytes: number;
    lines: number;
    /** @import rules: refused, so only ever seen on uploads from before a rule changed */
    imports: number;
    /** Every host the theme mentions, and whether it may */
    hosts: { host: string; allowed: boolean; count: number; }[];
    /** Embedded images and fonts */
    dataUrls: number;
    /** Font families it brings along with @font-face */
    fontFaces: string[];
    /** !important declarations: many of them usually means it restyles Discord by force, not by variables */
    importants: number;
}

/** CSS with its escapes turned back into the characters they stand for, and comments dropped */
export function decodeCss(css: string) {
    return css
        .replace(/\/\*[\s\S]*?\*\//g, " ")
        .replace(/\\([0-9a-fA-F]{1,6})[ \t\n\r\f]?/g, (_, hex: string) => {
            const code = parseInt(hex, 16);
            return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "�";
        })
        .replace(/\\([^\n0-9a-fA-F])/g, "$1");
}

/**
 * The CSS without the contents of its data: URLs, which load nothing: base64 has slashes in it, and
 * an embedded SVG names its namespace (http://www.w3.org/2000/svg) without fetching it
 */
const withoutDataUrls = (css: string) => css
    .replace(/(["'])data:[\s\S]*?\1/gi, "$1data:$1")
    .replace(/url\(\s*data:[^)]*\)/gi, "url(data:)");

// Runs of characters the tokenizer below takes in one step: inside a "string", a 'string' and an
// unquoted url(), and a name (url, color, -webkit-x): letters, digits, _, - and anything past ASCII
const RUNS = {
    "\"": /[^"\\\n]+/y,
    "'": /[^'\\\n]+/y,
    ")": /[^)\\]+/y,
    name: /[^\0-,./:-@[-^`{-\x7f]+/y,
};
const isNameChar = (c: string | undefined) => !!c && /[^\0-,./:-@[-^`{-\x7f]/.test(c);
/** Where the tokenizer has to look: a comment, a string, an escape, or what may be url( */
const NEXT = /\/\*|["'\\]|url\(/gi;

/**
 * Every string and url() argument in the CSS, read the way the browser reads them: comments skipped
 * (but not inside strings), escapes decoded where they are, so `"\""` stays one string. Any of them
 * could be an address: url(), image-set() and @import all take strings.
 */
function cssStringsAndUrls(input: string): string[] {
    const css = input.replace(/\r\n?|\f/g, "\n");
    const out: string[] = [];
    // Where the next token starts, and where the last one ended
    let i = 0, end = 0;
    const run = (re: RegExp) => {
        re.lastIndex = i;
        const found = re.exec(css)?.[0] ?? "";
        i += found.length;
        return found;
    };
    const isEscape = () => css[i] === "\\" && i + 1 < css.length && css[i + 1] !== "\n";
    // The character the escape at i stands for, moving past it
    const escape = () => {
        i++;
        const hex = /^[0-9a-f]{1,6}/i.exec(css.slice(i, i + 6))?.[0];
        if (!hex) return css[i++] ?? "";
        i += hex.length;
        if (/[ \t\n]/.test(css[i] ?? "")) i++;
        const code = parseInt(hex, 16);
        return code > 0 && code <= 0x10ffff && (code < 0xd800 || code > 0xdfff) ? String.fromCodePoint(code) : "�";
    };
    for (; ; end = i) {
        NEXT.lastIndex = i;
        const next = NEXT.exec(css);
        if (!next) break;
        i = next.index;
        const c = css[i];
        if (c === "/") {
            const close = css.indexOf("*/", i + 2);
            i = close < 0 ? css.length : close + 2;
        } else if (c === "\"" || c === "'") {
            i++;
            let text = "";
            while (i < css.length && css[i] !== c && css[i] !== "\n") {
                if (css[i] !== "\\") text += run(RUNS[c]);
                else if (css[i + 1] === "\n") i += 2;
                else text += escape();
            }
            if (css[i] === c) i++;
            out.push(text);
        } else {
            // An escape or url( can be the middle of a longer name (u\72l, myurl): read all of it
            while (i > end && isNameChar(css[i - 1])) i--;
            const start = i;
            let name = "";
            for (let part = "x"; part;) name += part = isEscape() ? escape() : run(RUNS.name);
            if (i === start) {
                // A backslash that escapes nothing
                i++;
                continue;
            }
            if (css[i] !== "(" || name.toLowerCase() !== "url") continue;
            i++;
            while (/[ \t\n]/.test(css[i] ?? "")) i++;
            // url("…") is a string, read as one next
            if (css[i] === "\"" || css[i] === "'") continue;
            let text = "";
            while (i < css.length && css[i] !== ")") text += css[i] === "\\" ? escape() : run(RUNS[")"]);
            out.push(text.trim());
        }
    }
    return out;
}

/**
 * Where an address in a theme loads from, the way the browser resolves it, so the userinfo in
 * https://cdn.discordapp.com@elsewhere, http:elsewhere and %-escapes in the host can't hide it.
 * Undefined when it loads nothing from anyone but Discord: data:, words, a path on Discord's own page.
 */
function addressHost(text: string): { host: string; hostname: string; allowed: boolean; } | undefined {
    // No scheme and no // or \\: a word, or a path on the page's own host
    if (!/[:/\\]/.test(text)) return;
    let url: URL;
    try {
        // Resolved against two pages: a relative address lands on each page's own host
        url = new URL(text, "https://a.invalid/");
        if (url.host === "a.invalid" && new URL(text, "https://b.invalid/").host === "b.invalid") return;
    } catch {
        return;
    }
    if (!url.host) return;
    const plain = url.protocol === "https:" && !url.username && !url.password;
    const { hostname } = url;
    if (plain) return { host: hostname, hostname, allowed: ALLOWED_THEME_HOSTS.includes(hostname) };
    // Shown as written, so the reviewer sees why: http://, or a name and password before the host
    const user = url.username || url.password ? `${url.username}${url.password ? `:${url.password}` : ""}@` : "";
    return { host: `${url.protocol}//${user}${url.host}`, hostname, allowed: false };
}

export function scanThemeCss(css: string): ThemeScan {
    const decoded = decodeCss(css);
    const hosts = new Map<string, { allowed: boolean; count: number; }>();
    const add = (host: string, allowed: boolean) => hosts.set(host, { allowed, count: (hosts.get(host)?.count ?? 0) + 1 });
    // Every address, as the browser resolves it
    const named = new Set<string>();
    for (const text of cssStringsAndUrls(css)) {
        const found = addressHost(text);
        if (!found) continue;
        named.add(found.hostname);
        add(found.host, found.allowed);
    }
    // And as a second net, any other host it names that isn't Discord's: https://host, //host, inside strings too
    for (const [, host] of withoutDataUrls(decoded).matchAll(/\/\/([a-z0-9](?:[a-z0-9.-]*[a-z0-9])?)(?::\d+)?/gi)) {
        const key = host.toLowerCase();
        if (!named.has(key) && !ALLOWED_THEME_HOSTS.includes(key)) add(key, false);
    }
    const fontFaces = new Set<string>();
    for (const [, block] of decoded.matchAll(/@font-face\s*\{([^}]*)\}/gi)) {
        const family = block.match(/font-family\s*:\s*["']?([^"';}]+)/i)?.[1]?.trim();
        if (family) fontFaces.add(family.slice(0, 64));
    }
    return {
        bytes: new TextEncoder().encode(css).length,
        lines: css.split("\n").length,
        imports: (decoded.match(/@import\b/gi) ?? []).length,
        hosts: [...hosts].map(([host, { allowed, count }]) => ({ host, allowed, count })).sort((a, b) => b.count - a.count),
        dataUrls: (decoded.match(/\bdata:/gi) ?? []).length,
        fontFaces: [...fontFaces],
        importants: (decoded.match(/!\s*important\b/gi) ?? []).length,
    };
}

/** Why CSS can't be a community theme, or undefined when it can */
export function whyNotCommunityCss(css: string, tr: Tr = englishTr): string | undefined {
    const bytes = new TextEncoder().encode(css).length;
    if (bytes > MAX_COMMUNITY_THEME_BYTES) return tr("check.css.tooBig", { kb: Math.ceil(bytes / 1024), max: MAX_COMMUNITY_THEME_BYTES / 1024 });
    const notCss = whyNotCss(css, "text/css", tr);
    if (notCss) return notCss;
    const scan = scanThemeCss(css);
    if (scan.imports) return tr("check.css.import");
    const remote = scan.hosts.find(h => !h.allowed);
    if (remote) return tr("check.css.remote", { host: remote.host });
}

const text = (value: unknown, max: number): value is string => typeof value === "string" && value.length <= max && !/[\0-\x08\x0e-\x1f]/.test(value);

/** An upload, cleaned, or why it can't be sent. The CSS rules are checked separately (whyNotCommunityCss). */
export function validateThemeSubmission(raw: unknown, tr: Tr = englishTr): { input: ThemeSubmissionInput; } | { error: string; } {
    const e = (raw ?? {}) as Record<string, unknown>;
    if (!isPluginId(e.id)) return { error: tr("check.theme.id") };
    if (!text(e.name, 80) || !e.name.trim()) return { error: tr("check.theme.name") };
    if (e.description !== undefined && !text(e.description, 300)) return { error: tr("check.theme.description") };
    if (!isVersion(e.version)) return { error: tr("check.theme.version") };
    const tags = e.tags ?? [];
    if (!Array.isArray(tags) || tags.length > MAX_THEME_TAGS || !tags.every(t => typeof t === "string" && /^[a-z0-9-]{1,24}$/.test(t))) {
        return { error: tr("check.theme.tags", { max: MAX_THEME_TAGS }) };
    }
    const notes = e.notes ?? [];
    if (!Array.isArray(notes) || notes.length > MAX_THEME_NOTES || !notes.every(n => text(n, 300) && n.trim())) {
        return { error: tr("check.theme.notes", { max: MAX_THEME_NOTES }) };
    }
    if (typeof e.css !== "string" || !e.css.trim()) return { error: tr("check.theme.cssMissing") };
    let screenshot: ThemeSubmissionInput["screenshot"];
    if (e.screenshot !== undefined && e.screenshot !== null) {
        const s = e.screenshot as Record<string, unknown>;
        if (!(typeof s.type === "string" && s.type in SCREENSHOT_EXTENSIONS)) return { error: tr("check.theme.shotType") };
        if (typeof s.data !== "string" || !/^[A-Za-z0-9+/]*={0,2}$/.test(s.data)) return { error: "The screenshot must be base64" };
        if (s.data.length > Math.ceil(MAX_THEME_SCREENSHOT_BYTES / 3) * 4) return { error: tr("check.theme.shotSize", { mb: MAX_THEME_SCREENSHOT_BYTES / 1024 / 1024 }) };
        screenshot = { type: s.type as ScreenshotType, data: s.data };
    }
    return {
        input: {
            id: e.id,
            name: e.name.trim(),
            description: typeof e.description === "string" ? e.description.trim() : "",
            version: e.version,
            tags: [...new Set(tags as string[])],
            notes: (notes as string[]).map(n => n.trim()),
            css: e.css,
            ...(screenshot && { screenshot }),
        },
    };
}

/** Whether an image's first bytes say it's what it claims to be */
export function isScreenshotType(data: Uint8Array, type: ScreenshotType) {
    const starts = (...bytes: number[]) => bytes.every((b, i) => data[i] === b);
    if (type === "image/png") return starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
    if (type === "image/jpeg") return starts(0xff, 0xd8, 0xff);
    return starts(0x52, 0x49, 0x46, 0x46) && data[8] === 0x57 && data[9] === 0x45 && data[10] === 0x42 && data[11] === 0x50;
}

/**
 * The CSS as it's published: its own header replaced by one from the verified details, so the name
 * Evi shows once it's installed is the one reviewed and the author is who uploaded it. A @base from
 * the old header (the editor's) is kept.
 */
export function withStoreHeader(css: string, meta: { name: string; description: string; author: string; version: string; }) {
    const clean = (value: string) => value.replace(/\*\//g, "").replace(/\s+/g, " ").replace(/(^|\s)@(?=\w)/g, "$1").trim();
    const header = css.match(/^\s*\/\*[\s\S]*?\*\//)?.[0];
    const isHeader = !!header && /(?:^|\s)@\w+/.test(header);
    const base = isHeader ? header!.match(/(?:^|\s)@base[ \t]+(dark|light)\b/i)?.[1]?.toLowerCase() : undefined;
    const body = (isHeader ? css.slice(header!.length) : css).replace(/^\s+/, "");
    const lines = [
        ["name", clean(meta.name)],
        ["description", clean(meta.description)],
        ["author", clean(meta.author)],
        ["version", meta.version],
        ["base", base ?? ""],
    ].filter(([, v]) => v).map(([k, v]) => ` * @${k} ${v}`);
    return `/**\n${lines.join("\n")}\n */\n\n${body.replace(/\s*$/, "\n")}`;
}
