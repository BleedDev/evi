/**
 * Pure logic for Sticky Video and Hover Play: when to pin a video to the corner, how big the
 * corner player is and where it goes, what keeps `position: fixed` from working on an element,
 * stopping an embed, and when a hovered video may start. No DOM here, so it can be tested with
 * bun test.
 */

/** Pinned once less than this much of the video is on screen */
export const STICK_BELOW = 0.25;
/** Back in its place once this much is on screen again; the gap keeps it from flapping at one edge */
export const UNSTICK_AT = 0.6;
/** The IntersectionObserver thresholds the two above need */
export const STICKY_THRESHOLDS = [0, STICK_BELOW, UNSTICK_AT];

/** Whether the video should be in the corner, given how much of its place is visible (0 to 1) */
export function nextSticky(sticky: boolean, ratio: number): boolean {
    const r = Number.isFinite(ratio) ? ratio : 0;
    return sticky ? r < UNSTICK_AT : r < STICK_BELOW;
}

export const MINI_WIDTH = 320;
export const MINI_MAX_HEIGHT = 240;
export const MINI_MIN_WIDTH = 160;
export const MINI_MARGIN = 16;

export interface Size { width: number; height: number; }
export interface Rect extends Size { left: number; top: number; }

/**
 * The corner player's size: MINI_WIDTH wide with the video's shape, no taller than
 * MINI_MAX_HEIGHT (portrait videos get narrower instead), and narrower than `areaWidth` so it
 * fits the chat with a margin. An unknown shape is 16:9.
 */
export function miniSize(width: number, height: number, areaWidth = Infinity): Size {
    const ratio = width > 0 && height > 0 && Number.isFinite(width / height) ? width / height : 16 / 9;
    const room = Number.isFinite(areaWidth) && areaWidth > 0 ? areaWidth - 2 * MINI_MARGIN : Infinity;
    let w = Math.max(MINI_MIN_WIDTH, Math.min(MINI_WIDTH, room));
    let h = w / ratio;
    if (h > MINI_MAX_HEIGHT) {
        h = MINI_MAX_HEIGHT;
        w = h * ratio;
    }
    return { width: Math.round(w), height: Math.round(h) };
}

/**
 * Where the corner player goes: the bottom right of `area` (the chat's visible box), kept inside
 * the window. Without an area it's the window's bottom right.
 */
export function miniPosition(size: Size, viewport: Size, area?: Rect | null): Rect {
    const right = Math.min(viewport.width, area && area.width > 0 ? area.left + area.width : viewport.width);
    const bottom = Math.min(viewport.height, area && area.height > 0 ? area.top + area.height : viewport.height);
    const left = Math.max(0, right - MINI_MARGIN - size.width);
    const top = Math.max(0, bottom - MINI_MARGIN - size.height);
    return { left: Math.round(left), top: Math.round(top), width: size.width, height: size.height };
}

/** The computed styles that decide whether an ancestor traps `position: fixed` descendants */
export interface BlockStyle {
    transform?: string;
    translate?: string;
    rotate?: string;
    scale?: string;
    perspective?: string;
    filter?: string;
    backdropFilter?: string;
    clipPath?: string;
    maskImage?: string;
    contain?: string;
    containerType?: string;
    contentVisibility?: string;
    willChange?: string;
}

/** Properties that can be switched off on an ancestor without changing how anything looks */
export type Lift = "transform" | "contain" | "content-visibility" | "will-change";

const isNone = (value: string | undefined) => !value || value === "none" || value === "normal" || value === "auto" || value === "visible";

/** "none", "matrix(1, 0, 0, 1, 0, 0)" and the 3D identity (translateZ(0)) move nothing */
export function isIdentityTransform(transform: string | undefined): boolean {
    if (isNone(transform)) return true;
    const m = /^matrix(3d)?\(([^)]*)\)$/.exec(transform!.trim());
    if (!m) return false;
    const values = m[2].split(",").map(Number);
    const identity = m[1] ? [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] : [1, 0, 0, 1, 0, 0];
    return values.length === identity.length && values.every((v, i) => Math.abs(v - identity[i]) < 1e-6);
}

/**
 * What an ancestor does to a `position: fixed` element inside it. `lift` lists what makes it the
 * element's containing block but can be switched off while the video is pinned without changing
 * the page (containment, will-change, an identity transform). `hard` is set when something can't
 * be switched off without moving or restyling things (a real transform, a filter, a clip, a
 * container query box): the video then goes to the top layer instead.
 */
export function containingBlockLift(style: BlockStyle): { lift: Lift[]; hard: boolean; } {
    const lift: Lift[] = [];
    let hard = false;
    if (!isNone(style.transform)) {
        if (isIdentityTransform(style.transform)) lift.push("transform");
        else hard = true;
    }
    for (const value of [style.translate, style.rotate, style.scale, style.perspective, style.filter, style.backdropFilter, style.clipPath, style.maskImage]) {
        if (!isNone(value)) hard = true;
    }
    if (!isNone(style.containerType)) hard = true;
    if (/\b(layout|paint|strict|content)\b/.test(style.contain ?? "")) lift.push("contain");
    if (style.contentVisibility === "auto" || style.contentVisibility === "hidden") lift.push("content-visibility");
    if (/\b(transform|translate|rotate|scale|perspective|filter|backdrop-filter|contain)\b/.test(style.willChange ?? "")) lift.push("will-change");
    return { lift, hard };
}

/**
 * The same embed with autoplay off, so loading it again stops it: YouTube's autoplay=1 and
 * auto_play=1, Twitch's autoplay=true. Anything that isn't a URL comes back as it was.
 */
export function stoppedEmbedUrl(src: string): string {
    let url: URL;
    try {
        url = new URL(src);
    } catch {
        return src;
    }
    for (const [key, value] of [...url.searchParams]) {
        const name = key.toLowerCase();
        if (name !== "autoplay" && name !== "auto_play") continue;
        if (value === "1") url.searchParams.set(key, "0");
        else if (value.toLowerCase() === "true") url.searchParams.set(key, "false");
    }
    return url.toString();
}

/** How long the pointer rests on a video before it starts, so moving across chat starts nothing */
export const HOVER_DELAY_MS = 300;

export interface HoverState {
    /** Not playing */
    paused: boolean;
    /** At (or within a frame of) the start: a video someone watched part of keeps its place */
    currentTime: number;
    /** Started by the user before, through Discord's own controls or a shortcut */
    played: boolean;
    /** Discord's Reduced Motion is on */
    reducedMotion: boolean;
    /** It, or something else, is fullscreen or in picture-in-picture */
    fullscreen: boolean;
}

/** Whether a hovered video may start a muted preview */
export function canHoverPlay(s: HoverState): boolean {
    return s.paused && !s.played && !s.reducedMotion && !s.fullscreen && !(s.currentTime > 0.05);
}
