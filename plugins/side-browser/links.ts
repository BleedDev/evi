/**
 * Which links Side Browser opens, and the geometry the panel and its native view share. Pure: no
 * Discord, DOM or Electron access, so both sides import it (native.ts checks every navigation with
 * the same rules) and tests/sideBrowser.test.ts covers it.
 */

export type Mode = "all" | "modifier" | "sites";
export const MODES: readonly Mode[] = ["all", "modifier", "sites"];

/**
 * How the link was clicked. "modified" is Ctrl+click (⌘ on macOS), "middle" a middle click, "none"
 * a link opened without a click (Discord's own code calling it, a keyboard Enter on a focused link
 * counts as a click).
 */
export type Gesture = "click" | "modified" | "middle" | "none";

/**
 * Discord's own sites. Their links are Discord's to handle (channels, messages, invites, gifts,
 * templates, the app directory), and a page of theirs in the panel would be logged out anyway.
 * A host covers its subdomains.
 */
export const DISCORD_HOSTS: readonly string[] = [
    "discord.com", "discordapp.com", "discord.gg", "discord.gift", "discord.new", "discord.co",
    "discordapp.net", "discord.media", "discord.dev", "dis.gd",
];

/** Longer links than this aren't real links someone clicked; Discord itself caps messages far lower */
const MAX_URL = 8192;

export type UrlKind = "web" | "discord" | "refused";

export interface Classified {
    kind: UrlKind;
    /** The parsed href, for "web" and "discord" */
    href?: string;
    host?: string;
}

/** `sub.example.com` is covered by `example.com`; `notexample.com` isn't */
export function hostMatches(host: string, rule: string): boolean {
    host = host.toLowerCase().replace(/\.$/, "");
    rule = rule.toLowerCase().replace(/^\*\./, "").replace(/\.$/, "");
    return !!rule && (host === rule || host.endsWith("." + rule));
}

export function isDiscordHost(host: string): boolean {
    return DISCORD_HOSTS.some(rule => hostMatches(host, rule));
}

/** http(s) pages are "web", Discord's own sites "discord", everything else (mailto:, steam:, file:, javascript:...) "refused" */
export function classifyUrl(raw: unknown): Classified {
    if (typeof raw !== "string" || !raw || raw.length > MAX_URL) return { kind: "refused" };
    let url: URL;
    try {
        url = new URL(raw);
    } catch {
        return { kind: "refused" };
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") return { kind: "refused" };
    const host = url.hostname.toLowerCase().replace(/\.$/, "");
    if (!host) return { kind: "refused" };
    return { kind: isDiscordHost(host) ? "discord" : "web", href: url.href, host };
}

export interface SiteRules {
    /** Sites that open in the panel in "Only these sites" mode */
    open: string[];
    /** Sites that never open in the panel, written with a leading `!` */
    never: string[];
}

/** A host from a line of the sites list: `example.com`, `*.example.com`, or a pasted link */
export function ruleHost(line: string): string | null {
    const text = line.trim().toLowerCase().replace(/^\*\./, "");
    if (!text || /\s/.test(text)) return null;
    let host: string;
    try {
        // Unicode names come out as the punycode links have
        host = new URL(/^[a-z][a-z0-9+.-]*:\/\//.test(text) ? text : "http://" + text).hostname.replace(/\.$/, "");
    } catch {
        return null;
    }
    return host.includes(".") || host === "localhost" ? host : null;
}

/** One site per line or separated by commas; `!site` keeps it out of the panel; `#` starts a comment */
export function parseSiteRules(text: unknown): SiteRules {
    const rules: SiteRules = { open: [], never: [] };
    if (typeof text !== "string") return rules;
    for (const raw of text.split(/[\n,]/)) {
        const line = raw.replace(/#.*$/, "").trim();
        const never = line.startsWith("!");
        const host = ruleHost(never ? line.slice(1) : line);
        if (!host) continue;
        const list = never ? rules.never : rules.open;
        if (!list.includes(host)) list.push(host);
    }
    return rules;
}

/**
 * Whether a clicked link opens in the panel. Ctrl+click and middle click are the way to the panel
 * in "modifier" mode, and the way around it (to the browser) in the other two.
 */
export function opensInPanel(url: unknown, options: { mode: Mode; rules: SiteRules; gesture: Gesture; }): boolean {
    const link = classifyUrl(url);
    if (link.kind !== "web" || !link.host) return false;
    const host = link.host;
    if (options.rules.never.some(rule => hostMatches(host, rule))) return false;
    const modified = options.gesture === "modified" || options.gesture === "middle";
    if (options.mode === "modifier") return modified;
    const listed = options.mode === "all" || options.rules.open.some(rule => hostMatches(host, rule));
    return modified ? !listed : listed;
}

/** What the header shows for a page: its host without `www.` */
export function displayHost(url: unknown): string {
    const link = classifyUrl(url);
    return link.host?.replace(/^www\./, "") ?? "";
}

export const MIN_WIDTH = 320;
export const DEFAULT_WIDTH = 480;
/** What the chat keeps at least, next to the panel */
export const MIN_CHAT = 360;

/** The panel's width for what's around it: at least MIN_WIDTH, leaving the chat MIN_CHAT where it can */
export function clampWidth(width: unknown, available: number): number {
    const wanted = typeof width === "number" && Number.isFinite(width) ? width : DEFAULT_WIDTH;
    const max = Math.max(MIN_WIDTH, Math.floor(available) - MIN_CHAT);
    return Math.round(Math.min(max, Math.max(MIN_WIDTH, wanted)));
}

export interface Rect { x: number; y: number; width: number; height: number; }

export function sameRect(a: Rect | null | undefined, b: Rect | null | undefined): boolean {
    return !!a && !!b && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

export function intersects(a: Rect, b: Rect): boolean {
    return a.width > 0 && a.height > 0 && b.width > 0 && b.height > 0
        && a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

/**
 * Points spread over a rectangle (`cols` × `rows`, edges included, inset by `inset`), for asking the
 * page what's drawn on top there.
 */
export function samplePoints(rect: Rect, cols = 5, rows = 7, inset = 2): Array<[number, number]> {
    const points: Array<[number, number]> = [];
    const w = rect.width - inset * 2, h = rect.height - inset * 2;
    if (w <= 0 || h <= 0) return points;
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            points.push([
                rect.x + inset + (cols > 1 ? w * c / (cols - 1) : w / 2),
                rect.y + inset + (rows > 1 ? h * r / (rows - 1) : h / 2),
            ]);
        }
    }
    return points;
}

/** The panel's rectangle as the renderer measures it, in CSS pixels, with the page's width to scale by */
export interface PanelBounds extends Rect { viewportWidth: number; }

/**
 * The native view's bounds in the window's content (device-independent pixels) from the panel's
 * CSS-pixel rectangle. Discord's zoom makes a CSS pixel bigger or smaller than a DIP; the content
 * width over the page's width is that factor, with `fallbackScale` (the zoom factor) when the page
 * didn't say. Kept inside the window, whole pixels.
 */
export function toViewBounds(raw: unknown, content: { width: number; height: number; }, fallbackScale = 1): Rect | null {
    if (!raw || typeof raw !== "object") return null;
    const b = raw as Record<string, unknown>;
    const nums = [b.x, b.y, b.width, b.height].map(Number);
    if (nums.some(n => !Number.isFinite(n))) return null;
    const [x, y, width, height] = nums;
    const viewport = Number(b.viewportWidth);
    let scale = viewport > 0 && Number.isFinite(viewport) ? content.width / viewport : fallbackScale;
    if (!Number.isFinite(scale) || scale <= 0) scale = 1;
    scale = Math.min(5, Math.max(0.2, scale));
    const left = Math.max(0, Math.round(x * scale));
    const top = Math.max(0, Math.round(y * scale));
    const right = Math.min(content.width, Math.round((x + width) * scale));
    const bottom = Math.min(content.height, Math.round((y + height) * scale));
    if (right - left < 1 || bottom - top < 1) return null;
    return { x: left, y: top, width: right - left, height: bottom - top };
}
