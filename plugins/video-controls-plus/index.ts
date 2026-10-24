/**
 * Video Controls+: playback speed (0.25x to 3x, remembered), loop, frame stepping and
 * picture-in-picture for videos in chat and the media viewer, keyboard shortcuts while a video is
 * hovered or focused, a corner player that follows you when you scroll away from a playing video
 * (Sticky Video), and muted previews while you hover a video (Hover Play).
 *
 * No source patches. Discord's chat video player (data-testid "discord-web-video-player-container",
 * checked against the cached web chunks) keeps its own controls; we watch pointer events on the
 * document, and for the hovered player's <video> show one small control strip. The strip lives in
 * <body> (or the fullscreen element) and is positioned over the video every frame while shown, so
 * nothing is inserted into React's DOM. Play/pause, mute and fullscreen click Discord's own buttons
 * when the player has them so its UI stays in sync; speed, loop, seeking, frame steps and PiP set
 * the <video> directly (Discord only writes playbackRate from its own speed menu).
 *
 * Sticky Video never moves the playing element (an iframe would reload): the player stays where
 * React put it and is switched to `position: fixed` in a corner, its parent keeping the message's
 * size. Ancestors that would trap a fixed element (containment, will-change, translateZ(0)) have
 * that switched off while it's pinned; when one can't be (a real transform, a filter), a <video>
 * goes to the top layer as a manual popover instead. One IntersectionObserver watches the playing
 * video's place, and only while one plays.
 *
 * Discord's player doesn't follow native play and pause events (it keeps its own state and calls
 * play() itself, checked in the cached web chunks), so a Hover Play preview is invisible to it:
 * muted with `muted` (Discord mutes with volume 0) and looping (so Discord never sees it end). A
 * click on a previewing player pauses the preview first, so Discord's own click handler then
 * starts it as a normal video, with sound.
 *
 * The logic that doesn't need the DOM is in controls.ts and sticky.ts.
 */
import { definePlugin, exitDone } from "@evi/api";
import type { PluginContext } from "@evi/api";

import {
    Action, actionForKey, clampSeekSeconds, clampSpeed, estimateFps, formatPosition, formatSpeed, frameStepTime, isArrowAction, seekTime,
    SPEEDS, stepSpeed, withShortcut,
} from "./controls";
import {
    canHoverPlay, containingBlockLift, HOVER_DELAY_MS, type Lift, miniPosition, miniSize, nextSticky, type Size, STICKY_THRESHOLDS,
    stoppedEmbedUrl,
} from "./sticky";
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
    stickyVideo: {
        type: "boolean",
        get label() { return t("settings.stickyVideo"); },
        get description() { return t("settings.stickyVideo.description"); },
        default: true,
    },
    hoverPlay: {
        type: "boolean",
        get label() { return t("settings.hoverPlay"); },
        get description() { return t("settings.hoverPlay.description"); },
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
const MESSAGE_ACCESSORIES = "[id^=\"message-accessories-\"]";
const DIALOG = "[role=\"dialog\"]";
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
    // The corner player is small and has its own buttons where the strip would go
    if (sticky && sticky.state !== "watching" && sticky.media === current) return false;
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
    armHoverPlay(video);
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
    // A preview isn't the user playing it: no remembered speed yet, and nothing to follow
    if (previewPlays.delete(video)) return;
    played.add(video);
    applyRememberedSpeed(video);
    watch(video);
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
    // Discord's player has its own F for fullscreen, used when our shortcuts are off
    if (e.key === "f" || e.key === "F") beforeFullscreen(e.target);
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
        if (action === "fullscreen") beforeFullscreen(video);
        // Play or unmute on a preview means watching it: Discord plays it from there, with sound
        if (preview?.video === video && (action === "togglePlay" || action === "mute")) {
            endPreview("handover");
            return togglePlay(video);
        }
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

const reducedMotion = () => document.documentElement.classList.contains("reduce-motion");

// Hover Play

/** A muted preview playing while the pointer rests on a video, and what it changed */
interface Preview { video: HTMLVideoElement; muted: boolean; loop: boolean; }

let preview: Preview | undefined;
let hoverTimer: ReturnType<typeof setTimeout> | undefined;
/** Videos the user started themselves: hovering them again leaves them where they are */
const played = new WeakSet<HTMLVideoElement>();
/** Videos whose next play event is a preview's own */
const previewPlays = new WeakSet<HTMLVideoElement>();

function hoverPlayable(video: HTMLVideoElement): boolean {
    if (!ctx?.settings.get("hoverPlay") || !video.isConnected || !video.closest(MESSAGE_SCOPE) || video.closest(DIALOG)) return false;
    return canHoverPlay({
        paused: video.paused,
        currentTime: video.currentTime,
        played: played.has(video),
        reducedMotion: reducedMotion(),
        fullscreen: !!document.fullscreenElement || !!document.pictureInPictureElement,
    });
}

/** Called when the hovered video changes: ends the last preview, and starts this one after a moment */
function armHoverPlay(video: HTMLVideoElement | null) {
    clearTimeout(hoverTimer);
    hoverTimer = undefined;
    if (preview && preview.video !== video) endPreview("reset");
    if (!video || preview || !hoverPlayable(video)) return;
    hoverTimer = setTimeout(() => {
        hoverTimer = undefined;
        if (hovered === video && !preview && hoverPlayable(video)) startPreview(video);
    }, HOVER_DELAY_MS);
}

function startPreview(video: HTMLVideoElement) {
    preview = { video, muted: video.muted, loop: video.loop };
    // `muted`, not volume: Discord mutes with volume 0, so its own setting is left as it was
    video.muted = true;
    // Looping, so Discord never sees it end and shows its replay screen
    video.loop = true;
    previewPlays.add(video);
    // Its preload is "none" until now (Discord's, until a player is first clicked): nothing loads before the hover
    video.play().catch(() => {
        previewPlays.delete(video);
        if (preview?.video === video) endPreview("reset");
    });
}

/**
 * Ends the preview. "reset" puts it back at the start, as it was before the hover; "handover"
 * leaves it where it is, unmuted, for the user's click or key to play it properly.
 */
function endPreview(how: "reset" | "handover") {
    const p = preview;
    if (!p) return;
    preview = undefined;
    const { video } = p;
    try {
        // Paused directly: Discord never knew it was playing
        video.pause();
        video.muted = p.muted;
        video.loop = p.loop;
        if (how === "reset") video.currentTime = 0;
    } catch {
        // The element may be mid-teardown
    }
}

/** A click on a previewing player: hand it to Discord, whose own handler then plays it (or doesn't) */
function handOver(video: HTMLVideoElement) {
    endPreview("handover");
    // A click that didn't start it (a volume button, the media viewer opening) leaves it as before the hover
    setTimeout(() => {
        if (ctx && video.paused && !played.has(video)) {
            try {
                video.currentTime = 0;
            } catch { }
        }
    }, 0);
}

// Sticky Video

const STICKY_ATTR = "data-evi-vcp-sticky";
const CLOSING_ATTR = "data-evi-vcp-closing";
const RETURN_ATTR = "data-evi-vcp-return";
const LIFT_ATTR = "data-evi-vcp-lift";
const PLACE_VARS = ["--evi-vcp-left", "--evi-vcp-top", "--evi-vcp-width", "--evi-vcp-height"] as const;

type StickyMedia = HTMLVideoElement | HTMLIFrameElement;

/** The video playing in chat, watched so it can follow the user to a corner */
interface Sticky {
    media: StickyMedia;
    /** What goes to the corner: the player around a video (its controls come along), or the iframe */
    anchor: HTMLElement;
    /** The anchor's parent, which keeps the message's size while the anchor is away */
    holder: HTMLElement;
    state: "watching" | "pinned" | "unpinning";
    /** How much of its place was on screen at the last check, 0 to 1 */
    ratio: number;
    /** The anchor's size in chat, for the corner player's shape */
    natural: Size;
    /** "popover" when an ancestor traps fixed positioning and it went to the top layer instead */
    mode?: "fixed" | "popover";
    /** The chat's scroller, whose bottom right corner it goes to */
    area: Element | null;
    lifted: HTMLElement[];
    holderStyle?: [string, string];
    unmount?: MutationObserver;
    /** The chat area changing size without the window (the member list opening): the corner moves with it */
    resize?: ResizeObserver;
    /** Discord removed the message while it was in the corner */
    orphan?: boolean;
    /** Bumped by each pin and unpin, so a finished exit animation knows it's stale */
    token: number;
}

let sticky: Sticky | undefined;
/** Pinned videos playing their exit, released on stop */
const leaving = new Set<Sticky>();
let stickyObserver: IntersectionObserver | undefined;
let mini: HTMLDivElement | undefined;
let embedTimer: ReturnType<typeof setTimeout> | undefined;
let recheckTimer: ReturnType<typeof setTimeout> | undefined;

/** What goes to the corner for a video: Discord's player, the older player, or the bare <video> */
function anchorFor(media: StickyMedia): HTMLElement {
    if (media instanceof HTMLIFrameElement) return media;
    const scope = media.closest(MESSAGE_SCOPE);
    const player = media.closest<HTMLElement>(PLAYER) ?? media.closest<HTMLElement>("[data-fullscreen]");
    return player && scope?.contains(player) ? player : media;
}

/** Starts watching a video that just started playing in chat (or an embed that was just opened) */
function watch(media: StickyMedia) {
    if (!ctx?.settings.get("stickyVideo") || sticky?.media === media) return;
    if (!media.isConnected || !media.closest(MESSAGE_SCOPE) || media.closest(DIALOG)) return;
    const anchor = anchorFor(media);
    const holder = anchor.parentElement;
    if (!holder) return;
    // One at a time: the one in the corner stops when another starts
    drop({ stop: true });
    sticky = { media, anchor, holder, state: "watching", ratio: 1, natural: { width: 0, height: 0 }, area: null, lifted: [], token: 0 };
    stickyObserver ??= new IntersectionObserver(onIntersect, { threshold: STICKY_THRESHOLDS });
    stickyObserver.observe(holder);
}

/**
 * Stops watching. A video in the corner leaves it with its exit animation; `stop` also pauses it
 * (or stops the embed) so it doesn't go on playing out of sight.
 */
function drop({ stop = false, instant = false } = {}) {
    const s = sticky;
    if (!s) return;
    sticky = undefined;
    stickyObserver?.unobserve(s.holder);
    if (s.state === "watching") return;
    if (stop && s.media instanceof HTMLVideoElement) pause(s.media);
    const stopEmbed = () => {
        // Loading it again without autoplay is the one way to stop a cross-origin player
        if (stop && s.media instanceof HTMLIFrameElement && s.media.isConnected) s.media.src = stoppedEmbedUrl(s.media.src);
    };
    if (instant) {
        release(s);
        stopEmbed();
    } else {
        unpin(s, "close", stopEmbed);
    }
}

function onIntersect(entries: IntersectionObserverEntry[]) {
    const s = sticky;
    if (!s) return;
    let entry: IntersectionObserverEntry | undefined;
    for (const e of entries) if (e.target === s.holder) entry = e;
    if (!entry) return;
    if (!s.anchor.isConnected) {
        if (s.state === "watching") drop();
        return;
    }
    s.ratio = entry.isIntersecting ? entry.intersectionRatio : 0;
    evaluate();
}

function canPin(s: Sticky): boolean {
    if (!ctx?.settings.get("stickyVideo") || !s.anchor.isConnected) return false;
    if (!(s.media instanceof HTMLVideoElement)) return true;
    if (document.pictureInPictureElement === s.media) return false;
    // A video paused in the corner stays there; one paused in chat isn't followed
    return !s.media.paused || s.state !== "watching";
}

/** Pins or unpins the watched video for where its place is now */
function evaluate() {
    const s = sticky;
    if (!s) return;
    if (document.fullscreenElement) {
        // Fullscreen covers everything: it's back in its place, without an exit, and pinned again after
        if (s.state !== "watching") release(s);
        return;
    }
    const want = nextSticky(s.state === "pinned", s.ratio) && canPin(s);
    if (want && s.state !== "pinned") {
        pin(s);
    } else if (!want && s.state === "pinned") {
        unpin(s, "return", () => {
            if (sticky === s && s.media instanceof HTMLVideoElement && s.media.paused) drop();
        });
    }
}

/** The ancestors to switch containment off on, the chat's scroller, and whether fixed positioning can't work */
function inspectAncestors(anchor: HTMLElement) {
    const lifts: [HTMLElement, Lift[]][] = [];
    let hard = false;
    let area: Element | null = null;
    for (let el = anchor.parentElement; el && el !== document.documentElement; el = el.parentElement) {
        const cs = getComputedStyle(el);
        const v = (name: string) => cs.getPropertyValue(name);
        const r = containingBlockLift({
            transform: v("transform"), translate: v("translate"), rotate: v("rotate"), scale: v("scale"), perspective: v("perspective"),
            filter: v("filter"), backdropFilter: v("backdrop-filter"), clipPath: v("clip-path"), maskImage: v("mask-image"),
            contain: v("contain"), containerType: v("container-type"), contentVisibility: v("content-visibility"), willChange: v("will-change"),
        });
        if (r.hard) hard = true;
        if (r.lift.length) lifts.push([el, r.lift]);
        const overflow = v("overflow-y");
        if (!area && (overflow === "auto" || overflow === "scroll") && el.clientHeight > 0) area = el;
    }
    return { lifts, hard, area };
}

/** Puts the corner player (and its buttons) in the chat's bottom right corner */
function place(s: Sticky) {
    const box = s.area?.getBoundingClientRect();
    const size = miniSize(s.natural.width, s.natural.height, box?.width);
    const rect = miniPosition(size, { width: window.innerWidth, height: window.innerHeight }, box);
    const values = [rect.left, rect.top, rect.width, rect.height];
    for (const el of [s.anchor, mini]) {
        PLACE_VARS.forEach((name, i) => el?.style.setProperty(name, `${values[i]}px`));
    }
}

function pin(s: Sticky) {
    if (s.state === "unpinning") {
        // Scrolled away again while it was leaving: it stays
        s.token++;
        s.state = "pinned";
        s.anchor.removeAttribute(CLOSING_ATTR);
        leaving.delete(s);
        showMini(s);
        return;
    }
    const { lifts, hard, area } = inspectAncestors(s.anchor);
    // An iframe can't go to the top layer: from there its own fullscreen button would fail
    if (hard && (s.media instanceof HTMLIFrameElement || typeof s.anchor.showPopover !== "function")) return;
    const box = s.anchor.getBoundingClientRect();
    const holderBox = s.holder.getBoundingClientRect();
    s.natural = { width: box.width, height: box.height };
    s.area = area;
    s.token++;
    s.holderStyle = [s.holder.style.minWidth, s.holder.style.minHeight];
    s.holder.style.minWidth = `${holderBox.width}px`;
    s.holder.style.minHeight = `${holderBox.height}px`;
    s.mode = hard ? "popover" : "fixed";
    if (!hard) {
        for (const [el, lift] of lifts) {
            el.setAttribute(LIFT_ATTR, lift.join(" "));
            s.lifted.push(el);
        }
    }
    showMini(s);
    place(s);
    s.anchor.setAttribute(STICKY_ATTR, "");
    s.state = "pinned";
    if (hard) {
        try {
            s.anchor.setAttribute("popover", "manual");
            s.anchor.showPopover();
            // Above the player in the top layer: shown after it
            mini?.setAttribute("popover", "manual");
            mini?.showPopover();
        } catch (err) {
            ctx?.logger.warn("Couldn't pin the video", err);
            release(s);
            return;
        }
    }
    // Discord removing the message (another channel, far up the history) shows as a child list change on one of these
    s.unmount = new MutationObserver(() => {
        if (!s.anchor.isConnected) unmounted(s);
    });
    for (let el: HTMLElement | null = s.holder; el; el = el.parentElement) s.unmount.observe(el, { childList: true });
    if (area) {
        s.resize = new ResizeObserver(() => {
            if (s.state === "pinned") place(s);
        });
        s.resize.observe(area);
    }
    update();
}

/** Plays the exit in the corner, then puts it back. `done` runs once it's back. */
function unpin(s: Sticky, how: "return" | "close", done?: () => void) {
    if (s.state !== "pinned") return;
    s.state = "unpinning";
    const token = ++s.token;
    leaving.add(s);
    s.anchor.setAttribute(CLOSING_ATTR, "");
    const buttons = mini;
    buttons?.setAttribute("data-closing", "");
    void Promise.all([exitDone(s.anchor), exitDone(buttons)]).then(() => {
        if (s.token !== token || s.state !== "unpinning") return;
        release(s);
        if (how === "return" && !s.orphan && s.anchor.isConnected) {
            // Fades in in its place, rather than popping back
            s.anchor.setAttribute(RETURN_ATTR, "");
            void exitDone(s.anchor).then(() => s.anchor.removeAttribute(RETURN_ATTR));
        }
        done?.();
    });
}

/** Puts it back at once and undoes everything pinning did */
function release(s: Sticky) {
    s.token++;
    leaving.delete(s);
    s.unmount?.disconnect();
    s.unmount = undefined;
    s.resize?.disconnect();
    s.resize = undefined;
    if (s.mode === "popover" && s.anchor.hasAttribute("popover")) {
        try {
            s.anchor.hidePopover();
        } catch { }
        s.anchor.removeAttribute("popover");
    }
    s.anchor.removeAttribute(STICKY_ATTR);
    s.anchor.removeAttribute(CLOSING_ATTR);
    for (const name of PLACE_VARS) s.anchor.style.removeProperty(name);
    for (const el of s.lifted) el.removeAttribute(LIFT_ATTR);
    s.lifted = [];
    if (s.holderStyle) {
        [s.holder.style.minWidth, s.holder.style.minHeight] = s.holderStyle;
        s.holderStyle = undefined;
    }
    s.mode = undefined;
    s.state = "watching";
    if (s.orphan && s.media instanceof HTMLVideoElement) s.anchor.remove();
    if (!sticky || sticky === s || sticky.state === "watching") hideMini();
    update();
}

/**
 * Discord removed the message while its video was in the corner. Playing on in the corner would
 * need a player of our own outliving the message; it stops instead, like any video in a channel
 * you leave. A <video> is put back for its exit (moving one doesn't reload it); an iframe would
 * load again, so only the buttons fade.
 */
function unmounted(s: Sticky) {
    s.unmount?.disconnect();
    s.unmount = undefined;
    s.resize?.disconnect();
    s.resize = undefined;
    if (sticky === s) {
        sticky = undefined;
        stickyObserver?.unobserve(s.holder);
    }
    s.orphan = true;
    if (s.media instanceof HTMLVideoElement) {
        // A removed popover is hidden for good: it shows again as fixed
        if (s.mode === "popover") s.anchor.removeAttribute("popover");
        s.mode = "fixed";
        document.body.append(s.anchor);
    }
    if (s.state === "pinned") unpin(s, "close");
}

const MINI_ICONS = {
    back: "M15 3h6v6M21 3l-7 7M9 21H3v-6M3 21l7-7",
    close: "M6 6l12 12M18 6L6 18",
};

/** Back to the message and close, over the corner player. In <body>, like the strip. */
function buildMini() {
    mini = document.createElement("div");
    mini.className = "evi-vcp-mini";
    mini.setAttribute("role", "group");
    mini.hidden = true;
    mini.append(button("back", "", svg(MINI_ICONS.back)), button("close", "", svg(MINI_ICONS.close)));
    for (const el of mini.querySelectorAll(".evi-vcp-btn")) el.className = "evi-vcp-mini-btn";
    mini.addEventListener("click", e => {
        const s = sticky;
        const act = (e.target as Element | null)?.closest<HTMLElement>(".evi-vcp-mini-btn")?.dataset.act;
        if (!s || s.state !== "pinned" || !act) return;
        // Scrolling back brings it home: the observer unpins it on the way
        if (act === "back") s.holder.scrollIntoView({ block: "center", behavior: reducedMotion() ? "auto" : "smooth" });
        else drop({ stop: true });
    });
    document.body.append(mini);
}

function showMini(s: Sticky) {
    if (!mini) buildMini();
    if (!mini) return;
    mini.setAttribute("aria-label", t("label.stickyPlayer"));
    const name = (act: string, label: string) => {
        const el = mini?.querySelector<HTMLElement>(`[data-act="${act}"]`);
        if (!el) return;
        el.title = label;
        el.setAttribute("aria-label", label);
    };
    name("back", t("label.backToMessage"));
    name("close", t("label.closePlayer"));
    mini.removeAttribute("data-closing");
    mini.hidden = false;
    if (s.mode !== "popover" && mini.hasAttribute("popover")) {
        try {
            mini.hidePopover();
        } catch { }
        mini.removeAttribute("popover");
    }
}

function hideMini() {
    if (!mini) return;
    if (mini.hasAttribute("popover")) {
        try {
            mini.hidePopover();
        } catch { }
        mini.removeAttribute("popover");
    }
    mini.removeAttribute("data-closing");
    mini.hidden = true;
}

/**
 * Fullscreen can't be requested for an element in the top layer: a popover-pinned player is put
 * back first, inside the same click or key press. Fixed ones go fullscreen as they are.
 */
function beforeFullscreen(target: EventTarget | null) {
    const s = sticky;
    if (s?.mode !== "popover" || s.state === "watching" || !(target instanceof Node) || !s.anchor.contains(target)) return;
    release(s);
    // If it didn't go fullscreen after all (a double click is only sometimes fullscreen), it goes back to the corner
    clearTimeout(recheckTimer);
    recheckTimer = setTimeout(evaluate, 500);
}

/** A click on an embed's thumbnail swaps it for the provider's player: that iframe is the one to watch */
function watchOpenedEmbed(e: MouseEvent, target: Element) {
    const scope = target.closest(MESSAGE_ACCESSORIES);
    if (!scope || !ctx?.settings.get("stickyVideo")) return;
    const before = new Set(scope.querySelectorAll("iframe"));
    const { clientX: x, clientY: y } = e;
    clearTimeout(embedTimer);
    embedTimer = setTimeout(() => {
        embedTimer = undefined;
        if (!ctx || !scope.isConnected) return;
        for (const frame of scope.querySelectorAll("iframe")) {
            if (before.has(frame)) continue;
            const r = frame.getBoundingClientRect();
            if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return watch(frame);
        }
    }, 250);
}

function onClickCapture(e: MouseEvent) {
    const target = e.target instanceof Element ? e.target : null;
    if (!target || root?.contains(target) || mini?.contains(target)) return;
    if (preview && anchorFor(preview.video).contains(target)) handOver(preview.video);
    if (sticky?.mode === "popover" && (e.type === "dblclick" || target.closest(PLAYER_BUTTON("fullscreen")))) beforeFullscreen(target);
    if (e.type === "click") watchOpenedEmbed(e, target);
}

function onPause(e: Event) {
    const video = e.target;
    // Removed from the page also pauses; the unmount check handles that
    if (sticky?.media === video && sticky.state === "watching" && (video as HTMLVideoElement).isConnected) drop();
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

        [data-evi-vcp-sticky] { position: fixed !important; inset: auto !important;
            left: var(--evi-vcp-left) !important; top: var(--evi-vcp-top) !important;
            width: var(--evi-vcp-width) !important; height: var(--evi-vcp-height) !important;
            min-width: 0 !important; min-height: 0 !important; max-width: none !important; max-height: none !important;
            margin: 0 !important; padding: 0 !important; border: 0 !important; z-index: 100;
            overflow: hidden !important; border-radius: var(--radius-md, 12px) !important; background-color: #000;
            box-shadow: var(--shadow-high, 0 8px 16px rgb(0 0 0 / 0.24)); }
        [data-evi-vcp-sticky][popover] { color: inherit; }
        [data-evi-vcp-sticky] video, [data-evi-vcp-sticky] [data-testid="discord-web-video-player-frame"] {
            width: 100% !important; height: 100% !important; max-width: none !important; max-height: none !important; }
        [data-evi-vcp-sticky] video { object-fit: contain; }
        [data-evi-vcp-sticky]:fullscreen { border-radius: 0 !important; box-shadow: none !important; }
        [data-evi-vcp-sticky][data-evi-vcp-closing] { pointer-events: none; }
        [data-evi-vcp-lift~="transform"] { transform: none !important; }
        [data-evi-vcp-lift~="contain"] { contain: none !important; }
        [data-evi-vcp-lift~="content-visibility"] { content-visibility: visible !important; }
        [data-evi-vcp-lift~="will-change"] { will-change: auto !important; }

        .evi-vcp-mini { position: fixed; z-index: 1000; left: var(--evi-vcp-left); top: var(--evi-vcp-top); right: auto; bottom: auto;
            width: var(--evi-vcp-width); height: var(--evi-vcp-height); box-sizing: border-box; margin: 0; padding: 8px;
            display: flex; align-items: flex-start; gap: 4px; pointer-events: none; color: var(--white, #fff); }
        .evi-vcp-mini[hidden] { display: none; }
        .evi-vcp-mini[popover] { border: 0; background: transparent; overflow: visible; }
        .evi-vcp-mini-btn { display: flex; align-items: center; justify-content: center; width: 28px; height: 28px;
            border: 0; padding: 0; border-radius: var(--radius-sm, 8px); background: rgb(0 0 0 / 0.6); color: inherit;
            backdrop-filter: blur(6px); cursor: pointer; pointer-events: auto; transition: background-color 0.12s ease-out; }
        .evi-vcp-mini-btn:hover { background: rgb(0 0 0 / 0.8); }
        .evi-vcp-mini-btn:focus-visible { outline: 2px solid var(--focus-primary, #00b0f4); outline-offset: 1px; }
        .evi-vcp-mini[data-closing] .evi-vcp-mini-btn { pointer-events: none; }

        /* Discord's modal motion (Evi's layer variables): springs in from 90%, shrinks back out */
        @media (prefers-reduced-motion: no-preference) {
            :root:not(.reduce-motion) :is([data-evi-vcp-sticky], .evi-vcp-mini) {
                animation: evi-vcp-pin-in var(--evi-modal-in, 230ms) var(--evi-spring-in, ease-out); }
            :root:not(.reduce-motion) :is([data-evi-vcp-sticky][data-evi-vcp-closing], .evi-vcp-mini[data-closing]) {
                animation: evi-vcp-pin-out var(--evi-modal-out, 200ms) var(--evi-spring-out, ease-in) forwards; }
            :root:not(.reduce-motion) [data-evi-vcp-return] { animation: evi-vcp-return 200ms ease-out; }
        }
        @keyframes evi-vcp-pin-in { from { opacity: 0; scale: 0.9; } }
        @keyframes evi-vcp-pin-out { to { opacity: 0; scale: 0.9; } }
        @keyframes evi-vcp-return { from { opacity: 0; } }
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
        document.addEventListener("pause", onPause, capture);
        document.addEventListener("enterpictureinpicture", () => evaluate(), capture);
        document.addEventListener("leavepictureinpicture", () => evaluate(), capture);
        // Before React's own handlers, which are on Discord's root
        window.addEventListener("click", onClickCapture, capture);
        window.addEventListener("dblclick", onClickCapture, capture);
        window.addEventListener("keydown", onKeyDown, capture);
        document.addEventListener("fullscreenchange", () => {
            evaluate();
            update();
        }, { signal });
        // A popover-pinned player whose fullscreen was refused anyway: back in place, so trying again works
        document.addEventListener("fullscreenerror", e => beforeFullscreen(e.target), capture);
        window.addEventListener("resize", () => {
            if (sticky?.state === "pinned") place(sticky);
            update();
        }, { signal });

        context.settings.onChange(values => {
            if (!values.stickyVideo) drop();
            if (!values.hoverPlay) armHoverPlay(null);
            sync();
            update();
        });

        context.onDispose(() => {
            events?.abort();
            events = undefined;
            clearTimeout(hoverTimer);
            clearTimeout(embedTimer);
            clearTimeout(recheckTimer);
            hoverTimer = embedTimer = recheckTimer = undefined;
            endPreview("reset");
            drop({ instant: true });
            for (const s of [...leaving]) release(s);
            stickyObserver?.disconnect();
            stickyObserver = undefined;
            mini?.remove();
            mini = undefined;
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
