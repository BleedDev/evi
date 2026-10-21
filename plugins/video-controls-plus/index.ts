/**
 * Video Controls+: playback speed (0.25x to 3x, remembered), loop, frame stepping and
 * picture-in-picture for videos in chat and the media viewer, plus keyboard shortcuts while a
 * video is hovered or focused.
 *
 * No source patches. Discord's chat video player (data-testid "discord-web-video-player-container",
 * checked against the cached web chunks) keeps its own controls; we watch pointer events on the
 * document, and for the hovered player's <video> show one small control strip. The strip lives in
 * <body> (or the fullscreen element) and is positioned over the video every frame while shown, so
 * nothing is inserted into React's DOM. Play/pause, mute and fullscreen click Discord's own buttons
 * when the player has them so its UI stays in sync; speed, loop, seeking, frame steps and PiP set
 * the <video> directly (Discord only writes playbackRate from its own speed menu).
 *
 * The logic that doesn't need the DOM is in controls.ts.
 */
import { definePlugin, exitDone } from "@evi/api";
import type { PluginContext } from "@evi/api";

import {
    Action, actionForKey, clampSeekSeconds, clampSpeed, estimateFps, formatPosition, formatSpeed, frameStepTime, isArrowAction, seekTime,
    SPEEDS, stepSpeed, withShortcut,
} from "./controls";
import { t } from "./strings";

type Settings = typeof settings;
const settings = {
    rememberSpeed: {
        type: "boolean",
        get label() { return t("settings.rememberSpeed"); },
        get description() { return t("settings.rememberSpeed.description"); },
        default: true,
    },
    showStrip: {
        type: "boolean",
        get label() { return t("settings.showStrip"); },
        get description() { return t("settings.showStrip.description"); },
        default: true,
    },
    shortcuts: {
        type: "boolean",
        get label() { return t("settings.shortcuts"); },
        get description() { return t("settings.shortcuts.description"); },
        default: true,
    },
    seekSeconds: {
        type: "number",
        get label() { return t("settings.seekSeconds"); },
        get description() { return t("settings.seekSeconds.description"); },
        default: 5,
        min: 1,
        max: 60,
        step: 1,
    },
} as const;

/** Discord's chat / media viewer video player (verified in the cached web chunks) */
const PLAYER = "[data-testid=\"discord-web-video-player-container\"]";
const PLAYER_BUTTON = (name: string) => `[data-testid="discord-web-video-player-${name}-btn"]`;
/** Plain <video> elements elsewhere in a message (older embeds) */
const MESSAGE_SCOPE = "[id^=\"chat-messages-\"], [id^=\"message-accessories-\"]";
const EDITABLE = "input, textarea, select, [contenteditable=\"\"], [contenteditable=\"true\"], [role=\"textbox\"]";
const LAST_SPEED_KEY = "lastSpeed";
const IDLE_MS = 2500;
const FLASH_MS = 900;
const MIN_STRIP_WIDTH = 180;

let ctx: PluginContext<Settings> | undefined;

/** What we changed on a video, undone on stop */
interface Touched { rate?: boolean; loop?: boolean; pip?: boolean; }

let events: AbortController | undefined;
/** Videos with our listeners on, which go with `events`: a new set per start */
let attached = new WeakSet<HTMLVideoElement>();
const sped = new WeakSet<HTMLVideoElement>();
const touched = new Map<HTMLVideoElement, Touched>();
const fps = new WeakMap<HTMLVideoElement, number>();
/** Each video's chat scroller (or null), looked up once: the overlay is placed every frame */
const scrollers = new WeakMap<HTMLVideoElement, Element | null>();

/** The video under the pointer */
let hovered: HTMLVideoElement | null = null;
/** The video the overlay belongs to (hovered, or the last one a shortcut acted on) */
let current: HTMLVideoElement | null = null;
let idle = false;
let idleTimer: ReturnType<typeof setTimeout> | undefined;
let flashTimer: ReturnType<typeof setTimeout> | undefined;
let flashing = false;
let menuOpen = false;
let frame = 0;

const storage = () => ctx?.settings as unknown as { get(key: string): unknown; set(key: string, value: unknown): void; } | undefined;

function touch(video: HTMLVideoElement, change: Touched) {
    for (const v of touched.keys()) if (!v.isConnected) touched.delete(v);
    touched.set(video, { ...touched.get(video), ...change });
}

function isEligible(video: HTMLVideoElement): boolean {
    if (!video.isConnected || video.srcObject || video.classList.contains("media-engine-video")) return false;
    if (!(video.currentSrc || video.src || video.querySelector("source"))) return false;
    if (video.closest(PLAYER)) return true;
    if (!video.closest(MESSAGE_SCOPE)) return false;
    // GIFs are silent looping autoplay videos; they don't need controls
    return attached.has(video) || !(video.autoplay && video.loop);
}

/** The eligible video an element belongs to */
function videoFor(target: EventTarget | null): HTMLVideoElement | null {
    if (!(target instanceof Element)) return null;
    if (root?.contains(target)) return current;
    if (target instanceof HTMLVideoElement) return isEligible(target) ? target : null;
    const video = target.closest(PLAYER)?.querySelector("video");
    return video && isEligible(video) ? video : null;
}

const playerOf = (video: HTMLVideoElement) => video.closest<HTMLElement>(PLAYER);
const playerButton = (video: HTMLVideoElement, name: string) => playerOf(video)?.querySelector<HTMLElement>(PLAYER_BUTTON(name)) ?? null;

function rememberedSpeed(): number {
    return clampSpeed(storage()?.get(LAST_SPEED_KEY) ?? 1);
}

function setSpeed(video: HTMLVideoElement, speed: number) {
    const s = clampSpeed(speed);
    video.defaultPlaybackRate = s;
    video.playbackRate = s;
    touch(video, { rate: true });
}

/** A video's first play starts at the remembered speed */
function applyRememberedSpeed(video: HTMLVideoElement) {
    if (sped.has(video)) return;
    sped.add(video);
    if (!ctx?.settings.get("rememberSpeed")) return;
    const speed = rememberedSpeed();
    if (speed !== 1 && video.playbackRate === 1) setSpeed(video, speed);
}

/** Measures the frame rate from presented frames the first time a video plays at normal speed */
function sampleFps(video: HTMLVideoElement) {
    if (fps.has(video) || typeof video.requestVideoFrameCallback !== "function") return;
    const signal = events?.signal;
    const deltas: number[] = [];
    let last: number | undefined;
    const onFrame = (_now: number, meta: VideoFrameCallbackMetadata) => {
        if (signal?.aborted || fps.has(video)) return;
        // Above 1x frames get skipped, which would read as a lower frame rate
        if (video.playbackRate <= 1 && last !== undefined) deltas.push(meta.mediaTime - last);
        last = meta.mediaTime;
        if (deltas.length >= 24) {
            const estimate = estimateFps(deltas);
            if (estimate) return void fps.set(video, estimate);
        }
        if (deltas.length < 120 && !video.paused) video.requestVideoFrameCallback(onFrame);
    };
    video.requestVideoFrameCallback(onFrame);
}

function attach(video: HTMLVideoElement) {
    if (attached.has(video) || !events) return;
    attached.add(video);
    const { signal } = events;
    video.addEventListener("ratechange", () => {
        if (ctx?.settings.get("rememberSpeed")) {
            const speed = clampSpeed(video.playbackRate);
            if (speed !== rememberedSpeed()) storage()?.set(LAST_SPEED_KEY, speed);
        }
        if (video === current) sync();
    }, { signal });
    for (const type of ["play", "pause", "enterpictureinpicture", "leavepictureinpicture"]) {
        video.addEventListener(type, () => {
            if (type === "play") sampleFps(video);
            if (video === current) {
                sync();
                if (type === "pause") setIdle(false);
                else armIdle();
            }
        }, { signal });
    }
    if (!video.paused) sampleFps(video);
}

function togglePlay(video: HTMLVideoElement) {
    const button = playerButton(video, "play-pause");
    if (button) return button.click();
    // A player that hasn't started yet starts on a click
    if (playerOf(video)) return video.click();
    if (video.paused) video.play().catch(() => { });
    else video.pause();
}

function pause(video: HTMLVideoElement) {
    if (video.paused) return;
    const button = playerButton(video, "play-pause");
    if (button) button.click();
    if (!video.paused) video.pause();
}

function toggleMute(video: HTMLVideoElement) {
    const button = playerButton(video, "volume");
    if (button) button.click();
    else video.muted = !video.muted;
    flash(t(video.muted || video.volume === 0 ? "flash.muted" : "flash.unmuted"));
}

function toggleFullscreen(video: HTMLVideoElement) {
    const button = playerButton(video, "fullscreen");
    if (button) return button.click();
    if (document.fullscreenElement) document.exitFullscreen().catch(() => { });
    else (playerOf(video) ?? video).requestFullscreen().catch(() => { });
}

function toggleLoop(video: HTMLVideoElement) {
    video.loop = !video.loop;
    touch(video, { loop: true });
    flash(t(video.loop ? "flash.loopOn" : "flash.loopOff"));
    sync();
}

async function togglePip(video: HTMLVideoElement) {
    if (!document.pictureInPictureEnabled) return flash(t("flash.pipUnavailable"));
    try {
        if (document.pictureInPictureElement === video) return void await document.exitPictureInPicture();
        if (video.readyState < HTMLMediaElement.HAVE_METADATA) return flash(t("flash.playFirst"));
        // Discord renders its player with disablePictureInPicture
        if (video.disablePictureInPicture) {
            video.disablePictureInPicture = false;
            touch(video, { pip: true });
        }
        await video.requestPictureInPicture();
    } catch (err) {
        ctx?.logger.warn("Picture-in-picture failed", err);
        flash(t("flash.pipFailed"));
    }
}

function seek(video: HTMLVideoElement, delta: number) {
    video.currentTime = seekTime(video.currentTime, delta, video.duration);
    flash(formatPosition(video.currentTime, video.duration));
}

function stepFrame(video: HTMLVideoElement, direction: 1 | -1) {
    pause(video);
    video.currentTime = frameStepTime(video.currentTime, direction, fps.get(video), video.duration);
    flash(t(direction > 0 ? "flash.nextFrame" : "flash.previousFrame", { position: formatPosition(video.currentTime, video.duration) }));
}

function changeSpeed(video: HTMLVideoElement, speed: number) {
    setSpeed(video, speed);
    flash(formatSpeed(video.playbackRate));
    sync();
}

function perform(action: Action, video: HTMLVideoElement) {
    const step = clampSeekSeconds(ctx?.settings.get("seekSeconds"));
    switch (action) {
        case "togglePlay": return togglePlay(video);
        case "seekBack": return seek(video, -step);
        case "seekForward": return seek(video, step);
        case "mute": return toggleMute(video);
        case "fullscreen": return toggleFullscreen(video);
        case "speedDown": return changeSpeed(video, stepSpeed(video.playbackRate, -1));
        case "speedUp": return changeSpeed(video, stepSpeed(video.playbackRate, 1));
        case "pip": return void togglePip(video);
        case "frameBack": return stepFrame(video, -1);
        case "frameForward": return stepFrame(video, 1);
    }
}

/** Actions that toggle something, which a held key shouldn't repeat */
const NO_REPEAT: ReadonlySet<Action> = new Set(["togglePlay", "mute", "fullscreen", "pip"]);

let root: HTMLDivElement | undefined;
let strip: HTMLDivElement | undefined;
let menu: HTMLDivElement | undefined;
let flashEl: HTMLDivElement | undefined;
let speedButton: HTMLButtonElement | undefined;
let loopButton: HTMLButtonElement | undefined;
let pipButton: HTMLButtonElement | undefined;

const svg = (d: string) =>
    `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true"><path d="${d}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

const ICONS = {
    frameBack: "M18 6l-7 6 7 6M7 6v12",
    frameForward: "M6 6l7 6-7 6M17 6v12",
    loop: "M17 3l3 3-3 3M4 11V9a3 3 0 013-3h13M7 21l-3-3 3-3M20 13v2a3 3 0 01-3 3H4",
    pip: "M4 5h16a1 1 0 011 1v12a1 1 0 01-1 1H4a1 1 0 01-1-1V6a1 1 0 011-1zM12 12h6v5h-6z",
};

function button(act: string, label: string, content: string): HTMLButtonElement {
    const el = document.createElement("button");
    el.type = "button";
    el.className = "evi-vcp-btn";
    el.dataset.act = act;
    el.title = label;
    el.setAttribute("aria-label", label);
    el.innerHTML = content;
    return el;
}

function buildOverlay() {
    root = document.createElement("div");
    root.className = "evi-vcp";
    root.dataset.visible = "false";

    strip = document.createElement("div");
    strip.className = "evi-vcp-strip";
    strip.setAttribute("role", "toolbar");

    speedButton = button("speed", "", "1×");
    speedButton.classList.add("evi-vcp-speed");
    speedButton.setAttribute("aria-haspopup", "menu");
    speedButton.setAttribute("aria-expanded", "false");
    loopButton = button("loop", "", svg(ICONS.loop));
    loopButton.setAttribute("aria-pressed", "false");
    pipButton = button("pip", "", svg(ICONS.pip));
    pipButton.hidden = !document.pictureInPictureEnabled;
    const sep = document.createElement("span");
    sep.className = "evi-vcp-sep";
    strip.append(
        button("frameBack", "", svg(ICONS.frameBack)),
        speedButton,
        button("frameForward", "", svg(ICONS.frameForward)),
        sep,
        loopButton,
        pipButton,
    );

    menu = document.createElement("div");
    menu.className = "evi-vcp-menu evi-popout";
    menu.setAttribute("role", "menu");
    menu.hidden = true;
    for (const speed of SPEEDS) {
        const item = document.createElement("button");
        item.type = "button";
        item.className = "evi-vcp-item";
        item.setAttribute("role", "menuitemradio");
        item.dataset.speed = String(speed);
        item.textContent = formatSpeed(speed);
        menu.append(item);
    }

    flashEl = document.createElement("div");
    flashEl.className = "evi-vcp-flash";
    flashEl.setAttribute("role", "status");
    flashEl.setAttribute("aria-live", "polite");

    root.append(strip, menu, flashEl);
    root.addEventListener("click", onOverlayClick);
    root.addEventListener("keydown", onOverlayKey);
    labelOverlay();
    document.body.append(root);
}

function onOverlayClick(e: MouseEvent) {
    const video = current;
    const target = e.target instanceof Element ? e.target : null;
    if (!video || !target) return;
    const item = target.closest<HTMLElement>(".evi-vcp-item");
    if (item) {
        changeSpeed(video, Number(item.dataset.speed));
        setMenu(false, true);
        return;
    }
    switch (target.closest<HTMLElement>(".evi-vcp-btn")?.dataset.act) {
        case "speed": return setMenu(!menuOpen, false);
        case "loop": return toggleLoop(video);
        case "pip": return void togglePip(video);
        case "frameBack": return stepFrame(video, -1);
        case "frameForward": return stepFrame(video, 1);
    }
}

function onOverlayKey(e: KeyboardEvent) {
    if (!menuOpen || !menu) return;
    const items = [...menu.querySelectorAll<HTMLElement>(".evi-vcp-item")];
    const index = items.indexOf(document.activeElement as HTMLElement);
    const move = (to: number) => items[(to + items.length) % items.length]?.focus();
    switch (e.key) {
        case "Escape": setMenu(false, true); break;
        case "ArrowRight": case "ArrowDown": move(index + 1); break;
        case "ArrowLeft": case "ArrowUp": move(index - 1); break;
        case "Home": move(0); break;
        case "End": move(items.length - 1); break;
        default: return;
    }
    e.preventDefault();
    e.stopPropagation();
}

function setMenu(open: boolean, refocus: boolean) {
    if (!menu || !speedButton) return;
    menuOpen = open;
    if (open) {
        menu.removeAttribute("data-closing");
        menu.hidden = false;
    } else if (!menu.hidden) {
        // Fades out, then hides, unless it was opened again meanwhile
        const el = menu;
        el.setAttribute("data-closing", "");
        void exitDone(el).then(() => {
            if (menuOpen || !el.hasAttribute("data-closing")) return;
            el.removeAttribute("data-closing");
            el.hidden = true;
        });
    }
    speedButton.setAttribute("aria-expanded", String(open));
    if (open) {
        sync();
        setIdle(false);
        const active = menu.querySelector<HTMLElement>("[aria-checked=\"true\"]") ?? menu.querySelector<HTMLElement>(".evi-vcp-item");
        active?.focus({ preventScroll: true });
    } else if (refocus) {
        speedButton.focus({ preventScroll: true });
    }
    update();
}

/** Names and tooltips, read now so they follow Discord's language */
function labelOverlay() {
    if (!strip || !menu) return;
    const name = (el: Element | null | undefined, label: string) => {
        if (!el) return;
        (el as HTMLElement).title = label;
        el.setAttribute("aria-label", label);
    };
    strip.setAttribute("aria-label", t("label.controls"));
    menu.setAttribute("aria-label", t("label.speedMenu"));
    name(speedButton, t("label.speed"));
    name(pipButton, withShortcut(t("label.pip"), "P"));
    name(strip.querySelector("[data-act=\"frameBack\"]"), withShortcut(t("label.previousFrame"), ","));
    name(strip.querySelector("[data-act=\"frameForward\"]"), withShortcut(t("label.nextFrame"), "."));
    name(loopButton, t("label.loop"));
}

/** Buttons reflect the current video */
function sync() {
    const video = current;
    if (!video || !speedButton || !loopButton || !pipButton || !menu) return;
    labelOverlay();
    const speed = clampSpeed(video.playbackRate);
    speedButton.textContent = formatSpeed(speed);
    speedButton.dataset.changed = String(speed !== 1);
    loopButton.setAttribute("aria-pressed", String(video.loop));
    loopButton.title = t(video.loop ? "label.loopOn" : "label.loopOff");
    pipButton.setAttribute("aria-pressed", String(document.pictureInPictureElement === video));
    for (const item of menu.querySelectorAll<HTMLElement>(".evi-vcp-item")) {
        item.setAttribute("aria-checked", String(Math.abs(Number(item.dataset.speed) - speed) < 1e-6));
    }
}

function flash(text: string) {
    if (!flashEl) return;
    flashEl.textContent = text;
    flashEl.dataset.shown = "true";
    flashing = true;
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => {
        flashing = false;
        if (flashEl) flashEl.dataset.shown = "false";
        update();
    }, FLASH_MS);
    update();
}

function setIdle(value: boolean) {
    clearTimeout(idleTimer);
    if (idle !== value) {
        idle = value;
        update();
    }
}

/** Hides the strip after a while without pointer movement, while the video plays */
function armIdle() {
    setIdle(false);
    idleTimer = setTimeout(() => {
        const focusInside = !!root?.contains(document.activeElement);
        if (current && !current.paused && !menuOpen && !focusInside) setIdle(true);
    }, IDLE_MS);
}

function stripVisible() {
    return !!current && (menuOpen || (hovered === current && !idle)) && ctx?.settings.get("showStrip") !== false;
}

/** The part of the video that's on screen: inside the viewport and its scroller */
function visibleRect(video: HTMLVideoElement) {
    const box = (playerOf(video) ?? video).getBoundingClientRect();
    let top = Math.max(box.top, 0), left = Math.max(box.left, 0);
    let bottom = Math.min(box.bottom, window.innerHeight), right = Math.min(box.right, window.innerWidth);
    if (!document.fullscreenElement) {
        let el = scrollers.get(video);
        if (el === undefined || (el && !el.isConnected)) scrollers.set(video, el = video.closest("[class*=\"scroller\"]"));
        const scroller = el?.getBoundingClientRect();
        if (scroller) {
            top = Math.max(top, scroller.top);
            bottom = Math.min(bottom, scroller.bottom);
        }
    }
    return { top, left, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
}

/** Sets an attribute only when it changes: an unchanged write would still restyle the overlay every frame */
function setData(el: HTMLElement, key: string, value: string) {
    if (el.dataset[key] !== value) el.dataset[key] = value;
}

/** Where the overlay was last put, so a frame where nothing moved writes nothing */
let placed = "";

/** Keeps the overlay on its video while anything of it is showing */
function update() {
    if (!root || !strip) return;
    const video = current;
    const showStrip = stripVisible();
    const active = !!video?.isConnected && (showStrip || flashing);
    setData(root, "visible", String(active));
    setData(strip, "visible", String(showStrip));
    if (!active || !video) {
        if (menuOpen && !video?.isConnected) setMenu(false, false);
        cancelAnimationFrame(frame);
        frame = 0;
        return;
    }

    // In fullscreen the overlay has to be inside the fullscreen element to be seen
    const host = document.fullscreenElement?.contains(video) ? document.fullscreenElement : document.body;
    if (root.parentElement !== host) host.append(root);

    const rect = visibleRect(video);
    const place = `${rect.left},${rect.top},${rect.width},${rect.height}`;
    if (place !== placed) {
        placed = place;
        root.style.transform = `translate(${rect.left}px, ${rect.top}px)`;
        root.style.width = `${rect.width}px`;
        root.style.height = `${rect.height}px`;
        setData(root, "compact", String(rect.width < MIN_STRIP_WIDTH || rect.height < 64));
    }

    if (!frame) {
        frame = requestAnimationFrame(() => {
            frame = 0;
            update();
        });
    }
}

function show(video: HTMLVideoElement) {
    if (current !== video) {
        if (menuOpen) setMenu(false, false);
        current = video;
    }
    sync();
    armIdle();
    // armIdle only redraws when idle changes; in chat nothing else would (fullscreen has its own event)
    update();
}

function setHovered(video: HTMLVideoElement | null) {
    if (video === hovered) return;
    hovered = video;
    if (video) {
        attach(video);
        show(video);
    } else {
        update();
    }
}

function onPointerOver(e: PointerEvent) {
    if (root?.contains(e.target as Node)) return;
    setHovered(videoFor(e.target));
}

let lastMove = 0;
function onPointerMove(e: PointerEvent) {
    if (!current || (hovered !== current && !root?.contains(e.target as Node))) return;
    // Re-arming on every event would churn timers
    if (!idle && e.timeStamp - lastMove < 200) return;
    lastMove = e.timeStamp;
    armIdle();
}

function onPointerDown(e: PointerEvent) {
    if (menuOpen && !menu?.contains(e.target as Node) && !speedButton?.contains(e.target as Node)) setMenu(false, false);
}

function onMouseOut(e: MouseEvent) {
    // Pointer left the window
    if (!e.relatedTarget) setHovered(null);
}

function onPlay(e: Event) {
    const video = e.target;
    if (!(video instanceof HTMLVideoElement) || !isEligible(video)) return;
    attach(video);
    applyRememberedSpeed(video);
}

function isEditable(el: Element | null) {
    return !!el?.closest(EDITABLE);
}

/** The video a key press is for: a focused player, else the hovered video unless typing somewhere */
function keyTarget(e: KeyboardEvent): HTMLVideoElement | null {
    const active = document.activeElement;
    const focused = active && active !== document.body ? videoFor(active) : null;
    if (focused) return focused;
    if (!hovered?.isConnected || isEditable(active)) return null;
    // Arrow keys move between items in the media viewer, so leave them unless the player has focus
    if (isArrowAction(e) && hovered.closest("[role=\"dialog\"]")) return null;
    return hovered;
}

function onKeyDown(e: KeyboardEvent) {
    if (!ctx?.settings.get("shortcuts") || e.defaultPrevented) return;
    const action = actionForKey(e);
    if (!action) return;
    // Space and Enter work the overlay's own buttons
    if (root?.contains(document.activeElement) && (e.key === " " || menuOpen)) return;
    const video = keyTarget(e);
    if (!video) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (e.repeat && NO_REPEAT.has(action)) return;
    attach(video);
    show(video);
    try {
        perform(action, video);
    } catch (err) {
        ctx.logger.error(`Couldn't ${action}`, err);
    }
}

function restore() {
    for (const [video, change] of touched) {
        if (!video.isConnected) continue;
        try {
            if (change.rate) {
                video.defaultPlaybackRate = 1;
                video.playbackRate = 1;
            }
            if (change.loop) video.loop = false;
            if (change.pip) {
                if (document.pictureInPictureElement === video) document.exitPictureInPicture().catch(() => { });
                video.disablePictureInPicture = true;
            }
        } catch {
            // The element may be mid-teardown
        }
    }
    touched.clear();
}

export default definePlugin({
    settings,

    css: `
        .evi-vcp { position: fixed; left: 0; top: 0; z-index: 10000; pointer-events: none; overflow: visible;
            font-family: var(--font-primary, inherit); color: var(--white, #fff); }
        .evi-vcp[data-visible="false"] { visibility: hidden; transition: visibility 0s linear 0.15s; }
        .evi-vcp-strip { position: absolute; top: 8px; right: 8px; display: flex; align-items: center; gap: 2px; padding: 2px;
            border-radius: var(--radius-sm, 8px); background: rgb(0 0 0 / 0.6); backdrop-filter: blur(6px);
            box-shadow: var(--shadow-low, 0 1px 3px rgb(0 0 0 / 0.3)); pointer-events: auto;
            opacity: 1; transition: opacity 0.15s ease-out; }
        .evi-vcp-strip[data-visible="false"] { opacity: 0; pointer-events: none; }
        .evi-vcp[data-compact="true"] .evi-vcp-strip { display: none; }
        .evi-vcp-btn, .evi-vcp-item { display: flex; align-items: center; justify-content: center; border: 0; padding: 0;
            color: inherit; background: transparent; border-radius: calc(var(--radius-sm, 8px) - 2px); cursor: pointer;
            font: inherit; transition: background-color 0.12s ease-out; }
        .evi-vcp-btn { width: 30px; height: 30px; }
        .evi-vcp-btn[hidden] { display: none; }
        .evi-vcp-speed { width: auto; min-width: 44px; padding: 0 6px; font-size: 13px; font-weight: 600; font-variant-numeric: tabular-nums; }
        .evi-vcp-speed[data-changed="true"] { color: var(--text-brand, var(--brand-360, #949cf7)); }
        .evi-vcp-btn:hover, .evi-vcp-item:hover { background: rgb(255 255 255 / 0.16); }
        .evi-vcp-btn[aria-pressed="true"] { color: var(--text-brand, var(--brand-360, #949cf7)); background: rgb(255 255 255 / 0.12); }
        .evi-vcp button:focus-visible { outline: 2px solid var(--focus-primary, #00b0f4); outline-offset: 1px; }
        .evi-vcp-sep { width: 1px; height: 18px; margin: 0 3px; background: rgb(255 255 255 / 0.25); }
        .evi-vcp-menu { position: absolute; top: 46px; right: 8px; display: grid; grid-template-columns: repeat(5, auto); gap: 2px;
            padding: 4px; border-radius: var(--radius-sm, 8px); pointer-events: auto;
            background: var(--background-floating, var(--background-surface-highest, #111214)); color: var(--text-default, var(--text-normal, #dbdee1));
            border: 1px solid var(--border-subtle, rgb(255 255 255 / 0.08)); box-shadow: var(--shadow-high, 0 8px 16px rgb(0 0 0 / 0.24)); }
        .evi-vcp-menu[hidden] { display: none; }
        .evi-vcp-item { min-width: 48px; height: 28px; padding: 0 6px; font-size: 13px; font-weight: 500; font-variant-numeric: tabular-nums; }
        .evi-vcp-item:hover { background: var(--background-modifier-hover, rgb(255 255 255 / 0.08)); }
        .evi-vcp-item[aria-checked="true"] { background: var(--brand-500, #5865f2); color: var(--white, #fff); }
        .evi-vcp-flash { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); padding: 6px 12px; max-width: calc(100% - 16px);
            border-radius: var(--radius-sm, 8px); background: rgb(0 0 0 / 0.7); font-size: 14px; font-weight: 600;
            font-variant-numeric: tabular-nums; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
            opacity: 0; transition: opacity 0.15s ease-out; }
        .evi-vcp-flash[data-shown="true"] { opacity: 1; transition-duration: 0.05s; }
        @media (prefers-reduced-motion: reduce) {
            .evi-vcp, .evi-vcp[data-visible="false"], .evi-vcp-strip, .evi-vcp-btn, .evi-vcp-item, .evi-vcp-flash { transition: none; }
        }
    `,

    start(context) {
        ctx = context;
        events = new AbortController();
        const { signal } = events;
        buildOverlay();

        const capture = { capture: true, signal };
        document.addEventListener("pointerover", onPointerOver, capture);
        document.addEventListener("pointermove", onPointerMove, { capture: true, passive: true, signal });
        document.addEventListener("pointerdown", onPointerDown, capture);
        document.addEventListener("mouseout", onMouseOut, capture);
        // Media events don't bubble, but they do go through the capture phase
        document.addEventListener("play", onPlay, capture);
        window.addEventListener("keydown", onKeyDown, capture);
        document.addEventListener("fullscreenchange", () => update(), { signal });
        window.addEventListener("resize", () => update(), { signal });

        context.settings.onChange(() => {
            sync();
            update();
        });

        context.onDispose(() => {
            events?.abort();
            events = undefined;
            // Their listeners are gone: the next start attaches them again
            attached = new WeakSet();
            cancelAnimationFrame(frame);
            frame = 0;
            clearTimeout(idleTimer);
            clearTimeout(flashTimer);
            idleTimer = flashTimer = undefined;
            root?.remove();
            placed = "";
            root = strip = menu = flashEl = speedButton = loopButton = pipButton = undefined;
            restore();
            hovered = current = null;
            idle = flashing = menuOpen = false;
            ctx = undefined;
        });
    },
});
