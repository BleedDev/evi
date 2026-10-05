/**
 * Dynamic Wallpaper: shows the image or video main copied into Evi's folder (src/main/wallpaper.ts)
 * in a fixed layer under #app-mount, with a stylesheet that makes Discord's panels see-through
 * (shared/wallpaper.ts). The file comes over IPC as bytes and is shown from a blob: URL, never from
 * a path. A video pauses on battery (when asked to) and for reduced motion.
 *
 * Discord's CSP may not allow blob: for images or media. An image that fails to load falls back to a
 * data: URL; a video can't sensibly (hundreds of MB as base64), so the tab says it's blocked instead.
 * Which of these Discord allows is checked by the lead in the web test (scripts/test-web.ts).
 */
import { isOverlayWindow } from "@shared/appHosts";
import type { WallpaperPickResult } from "@shared/ipc";
import { buildWallpaperCss, normalizeWallpaper, WALLPAPER_LAYER_ID, WallpaperKind, wallpaperKind } from "@shared/wallpaper";

import { t } from "./i18n";
import { Logger } from "./logger";
import { Native } from "./native";
import { SafeMode } from "./safeMode";
import { Settings } from "./settings";
import { createStyle, ManagedStyle, QUICK_CSS_ID } from "./styles";

const logger = new Logger("Wallpaper");

export interface WallpaperState {
    /** `off`: nothing to show (turned off, no file, or safe mode) */
    status: "off" | "loading" | "shown" | "error";
    /** What the tab's preview shows: a blob: URL, or a data: URL when blob: was blocked */
    url?: string;
    kind?: WallpaperKind;
    error?: string;
    onBattery: boolean;
    /** A video is loaded but held still: on battery, or reduced motion */
    paused: boolean;
}

interface Loaded {
    file: string;
    kind: WallpaperKind;
    blob: Blob;
    url: string;
    /** Already fell back from blob: to data: */
    dataUrl: boolean;
}

let state: WallpaperState = { status: "off", onBattery: false, paused: false };
const listeners = new Set<() => void>();
let loaded: Loaded | undefined;
/** Bumped per load, so an answer for a file no longer wanted is dropped */
let loadToken = 0;
let loadingFile: string | undefined;
let style: ManagedStyle | undefined;
let layer: HTMLDivElement | undefined;
let media: HTMLImageElement | HTMLVideoElement | undefined;
/** Tabs showing a preview: keeps the file loaded while the wallpaper itself is off */
let previews = 0;
/** What apply() last acted on, so unrelated settings changes cost nothing */
let lastKey = "";

const motionQuery = matchMedia("(prefers-reduced-motion: reduce)");
const reducedMotion = () => motionQuery.matches || document.documentElement.classList.contains("reduce-motion");

function set(next: Partial<WallpaperState>) {
    state = { ...state, ...next };
    for (const listener of listeners) listener();
}

function whenBody(cb: () => void) {
    if (document.body) cb();
    else document.addEventListener("DOMContentLoaded", cb, { once: true });
}

function unmount() {
    // Stop a video's decoding right away rather than when it's collected
    if (media instanceof HTMLVideoElement) {
        media.pause();
        media.removeAttribute("src");
        media.load();
    }
    layer?.remove();
    layer = media = undefined;
}

function unload() {
    unmount();
    if (loaded && !loaded.dataUrl) URL.revokeObjectURL(loaded.url);
    loaded = undefined;
    loadingFile = undefined;
    loadToken++;
}

const toDataUrl = (blob: Blob) => new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
});

/** Takes down the layer and the see-through stylesheet */
function hide() {
    unmount();
    style?.remove();
    style = undefined;
}

function fail(error: string) {
    // Nothing behind the see-through panels otherwise
    hide();
    set({ status: "error", error });
}

async function onMediaError(current: Loaded) {
    if (loaded !== current) return;
    if (current.kind === "video") return fail(t("wallpaper.videoBlocked"));
    if (current.dataUrl) return fail(t("wallpaper.imageFailed"));
    // Probably Discord's CSP refusing blob: images
    logger.warn("The image didn't load from a blob: URL, trying a data: URL");
    try {
        const url = await toDataUrl(current.blob);
        if (loaded !== current) return;
        URL.revokeObjectURL(current.url);
        current.url = url;
        current.dataUrl = true;
        unmount();
        set({ url });
        apply(true);
    } catch {
        fail(t("wallpaper.imageFailed"));
    }
}

function updatePlayback() {
    if (!(media instanceof HTMLVideoElement)) return set({ paused: false });
    const w = normalizeWallpaper(Settings.data.wallpaper);
    const paused = (w.pauseOnBattery && state.onBattery) || reducedMotion();
    if (paused) media.pause();
    else media.play().catch(() => { });
    if (paused !== state.paused) set({ paused });
}

function mount(current: Loaded) {
    if (layer && media?.dataset.src === current.url) return;
    unmount();
    const el = document.createElement("div");
    el.id = WALLPAPER_LAYER_ID;
    el.setAttribute("aria-hidden", "true");

    let m: HTMLImageElement | HTMLVideoElement;
    if (current.kind === "video") {
        const video = document.createElement("video");
        // Muted and inline, or Chromium won't autoplay it
        video.muted = true;
        video.loop = true;
        video.playsInline = true;
        video.addEventListener("loadeddata", () => loaded === current && set({ status: "shown", error: undefined }));
        m = video;
    } else {
        const img = document.createElement("img");
        img.alt = "";
        img.decoding = "async";
        img.addEventListener("load", () => loaded === current && set({ status: "shown", error: undefined }));
        m = img;
    }
    m.className = "evi-wallpaper-media";
    m.dataset.src = current.url;
    m.addEventListener("error", () => void onMediaError(current));
    m.src = current.url;

    // The picture turns inside a box the window's size, which zooms (shared/wallpaper.ts buildMediaCss)
    const zoom = document.createElement("div");
    zoom.className = "evi-wallpaper-zoom";
    zoom.append(m);
    const dim = document.createElement("div");
    dim.className = "evi-wallpaper-dim";
    el.append(zoom, dim);
    layer = el;
    media = m;
    whenBody(() => layer === el && document.body.prepend(el));
    updatePlayback();
}

async function load(file: string) {
    const token = ++loadToken;
    loadingFile = file;
    set({ status: "loading", error: undefined });
    const result = await Native.readWallpaper().catch(err => ({ ok: false as const, error: String(err?.message ?? err) }));
    if (token !== loadToken) return;
    loadingFile = undefined;
    if (!result.ok) return fail(result.error);
    // Settings name a file main no longer has, e.g. restored from a backup made on another computer
    if (result.file !== file) return fail(t("wallpaper.missing"));

    const kind = wallpaperKind(file) ?? "image";
    const blob = new Blob([result.bytes as Uint8Array<ArrayBuffer>], { type: result.mime });
    loaded = { file, kind, blob, url: URL.createObjectURL(blob), dataUrl: false };
    set({ url: loaded.url, kind });
    apply(true);
}

function apply(force = false) {
    const w = normalizeWallpaper(Settings.data.wallpaper);
    // The login screen can show it while the wallpaper in Discord's app is off
    const show = (w.enabled || w.login.show) && !!w.file && !SafeMode.active;
    const wanted = !SafeMode.active && w.file && (show || previews > 0) ? w.file : undefined;
    const key = JSON.stringify([w, show, wanted]);
    if (!force && key === lastKey) return;
    lastKey = key;

    if (loaded && loaded.file !== wanted) unload();
    if (!wanted) {
        hide();
        loadToken++;
        loadingFile = undefined;
        return set({ status: "off", url: undefined, kind: undefined, error: undefined, paused: false });
    }
    if (!loaded) {
        if (loadingFile !== wanted) void load(wanted);
        return;
    }

    if (!show) {
        hide();
        if (state.status !== "error") set({ status: "off" });
        return;
    }
    // Stays down until something changes the file: the tab shows why
    if (state.status === "error") return;
    const css = buildWallpaperCss(w, { inApp: w.enabled });
    // Before Quick CSS, which should still win
    if (style) style.update(css);
    else style = createStyle(css, "evi-wallpaper-style", QUICK_CSS_ID);
    mount(loaded);
    updatePlayback();
}

export const Wallpaper = {
    init() {
        if (SafeMode.active || !Native.readWallpaper) return;
        // The in-game overlay is a see-through window over the game: a wallpaper there hides the game
        if (isOverlayWindow(location.href, window.name)) return;
        Settings.subscribe(() => apply());
        motionQuery.addEventListener("change", updatePlayback);
        // A main older than this renderer (dev, after Ctrl+R) has none of these
        Native.onPowerChange?.(onBattery => {
            set({ onBattery });
            updatePlayback();
        });
        Native.onBattery?.().then(onBattery => {
            set({ onBattery });
            updatePlayback();
        }, () => { });
        apply();
    },

    getSnapshot: () => state,

    subscribe(listener: () => void) {
        listeners.add(listener);
        return () => void listeners.delete(listener);
    },

    /** While a tab shows the preview, the file stays loaded even if the wallpaper is off */
    watchPreview() {
        previews++;
        apply(true);
        return () => {
            previews--;
            apply(true);
        };
    },

    /** Opens the file picker; the chosen file is shown right away */
    async pick(): Promise<WallpaperPickResult> {
        const result = await Native.pickWallpaper();
        if (result.ok) Settings.update(d => {
            d.wallpaper = { ...normalizeWallpaper(d.wallpaper), enabled: true, file: result.file, kind: result.kind };
        });
        return result;
    },

    async remove() {
        await Native.removeWallpaper();
        Settings.update(d => {
            d.wallpaper = { ...normalizeWallpaper(d.wallpaper), enabled: false, file: undefined, kind: undefined };
        });
    },
};
