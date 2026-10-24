import { describe, expect, test } from "bun:test";

import {
    actionForKey, clampFps, clampSeekSeconds, clampSpeed, DEFAULT_FPS, estimateFps, formatPosition, formatSpeed, formatTime, frameDuration,
    frameStepTime, isArrowAction, MAX_SPEED, MIN_SPEED, seekTime, SPEEDS, stepSpeed, withShortcut,
} from "../plugins/video-controls-plus/controls";
import {
    canHoverPlay, containingBlockLift, HOVER_DELAY_MS, isIdentityTransform, MINI_MARGIN, MINI_MAX_HEIGHT, MINI_MIN_WIDTH, MINI_WIDTH, miniPosition,
    miniSize, nextSticky, STICK_BELOW, STICKY_THRESHOLDS, stoppedEmbedUrl, UNSTICK_AT,
} from "../plugins/video-controls-plus/sticky";

describe("speeds", () => {
    test("the menu covers 0.25x to 3x in order", () => {
        expect(SPEEDS[0]).toBe(0.25);
        expect(SPEEDS[SPEEDS.length - 1]).toBe(3);
        expect([...SPEEDS]).toEqual([...SPEEDS].sort((a, b) => a - b));
        expect(SPEEDS).toContain(1);
    });

    test("clampSpeed keeps speeds in range and rejects garbage", () => {
        expect(clampSpeed(1.5)).toBe(1.5);
        expect(clampSpeed(10)).toBe(MAX_SPEED);
        expect(clampSpeed(0.1)).toBe(MIN_SPEED);
        expect(clampSpeed(0)).toBe(1);
        expect(clampSpeed(-2)).toBe(1);
        expect(clampSpeed(NaN)).toBe(1);
        expect(clampSpeed(undefined)).toBe(1);
        expect(clampSpeed(null)).toBe(1);
        expect(clampSpeed("2")).toBe(2);
        expect(clampSpeed("fast")).toBe(1);
        expect(clampSpeed(1.23456)).toBe(1.23);
    });

    test("stepSpeed moves one step and stops at the ends", () => {
        expect(stepSpeed(1, 1)).toBe(1.25);
        expect(stepSpeed(1, -1)).toBe(0.75);
        expect(stepSpeed(3, 1)).toBe(3);
        expect(stepSpeed(0.25, -1)).toBe(0.25);
        expect(stepSpeed(2, 1)).toBe(2.5);
        expect(stepSpeed(2.5, 1)).toBe(3);
    });

    test("stepSpeed from an off-step speed goes to the nearest step that way", () => {
        expect(stepSpeed(1.1, 1)).toBe(1.25);
        expect(stepSpeed(1.1, -1)).toBe(1);
        expect(stepSpeed(NaN, 1)).toBe(1.25);
    });

    test("formatSpeed", () => {
        expect(formatSpeed(1)).toBe("1×");
        expect(formatSpeed(1.5)).toBe("1.5×");
        expect(formatSpeed(0.25)).toBe("0.25×");
        expect(formatSpeed(99)).toBe("3×");
    });
});

describe("actionForKey", () => {
    test("maps the shortcuts", () => {
        expect(actionForKey({ key: " " })).toBe("togglePlay");
        expect(actionForKey({ key: "k" })).toBe("togglePlay");
        expect(actionForKey({ key: "K" })).toBe("togglePlay");
        expect(actionForKey({ key: "j" })).toBe("seekBack");
        expect(actionForKey({ key: "l" })).toBe("seekForward");
        expect(actionForKey({ key: "ArrowLeft" })).toBe("seekBack");
        expect(actionForKey({ key: "ArrowRight" })).toBe("seekForward");
        expect(actionForKey({ key: "m" })).toBe("mute");
        expect(actionForKey({ key: "f" })).toBe("fullscreen");
        expect(actionForKey({ key: "[" })).toBe("speedDown");
        expect(actionForKey({ key: "]" })).toBe("speedUp");
        expect(actionForKey({ key: "p" })).toBe("pip");
        expect(actionForKey({ key: "," })).toBe("frameBack");
        expect(actionForKey({ key: "." })).toBe("frameForward");
    });

    test("ignores other keys and modified presses", () => {
        expect(actionForKey({ key: "a" })).toBeNull();
        expect(actionForKey({ key: "Enter" })).toBeNull();
        expect(actionForKey({ key: "ArrowUp" })).toBeNull();
        expect(actionForKey({ key: "" })).toBeNull();
        expect(actionForKey({ key: "k", ctrlKey: true })).toBeNull();
        expect(actionForKey({ key: "f", metaKey: true })).toBeNull();
        expect(actionForKey({ key: "m", altKey: true })).toBeNull();
        expect(actionForKey({ key: " ", shiftKey: true })).toBeNull();
    });

    test("isArrowAction", () => {
        expect(isArrowAction({ key: "ArrowLeft" })).toBe(true);
        expect(isArrowAction({ key: "ArrowRight" })).toBe(true);
        expect(isArrowAction({ key: "j" })).toBe(false);
    });
});

describe("frames", () => {
    test("frame duration defaults to 30fps", () => {
        expect(frameDuration()).toBeCloseTo(1 / 30);
        expect(frameDuration(60)).toBeCloseTo(1 / 60);
        expect(frameDuration(0)).toBeCloseTo(1 / DEFAULT_FPS);
        expect(frameDuration(NaN)).toBeCloseTo(1 / DEFAULT_FPS);
        expect(clampFps(1000)).toBe(240);
        expect(clampFps(0.5)).toBe(1);
    });

    test("estimateFps snaps to common rates", () => {
        expect(estimateFps(Array(30).fill(1 / 30))).toBe(30);
        expect(estimateFps(Array(30).fill(1 / 60))).toBe(60);
        expect(estimateFps(Array(30).fill(1001 / 24000))).toBe(23.976);
        expect(estimateFps(Array(30).fill(1 / 25))).toBe(25);
    });

    test("estimateFps ignores dropped frames and bad samples", () => {
        const deltas = [...Array(20).fill(1 / 30), 2 / 30, 3 / 30, 0, -1, NaN, 5];
        expect(estimateFps(deltas)).toBe(30);
        expect(estimateFps([1 / 30, 1 / 30])).toBeUndefined();
        expect(estimateFps([])).toBeUndefined();
    });

    test("estimateFps rounds unusual rates", () => {
        expect(estimateFps(Array(10).fill(1 / 37))).toBe(37);
    });

    test("frameStepTime steps and clamps", () => {
        expect(frameStepTime(1, 1, 30, 10)).toBeCloseTo(1 + 1 / 30);
        expect(frameStepTime(1, -1, 30, 10)).toBeCloseTo(1 - 1 / 30);
        expect(frameStepTime(0, -1, 30, 10)).toBe(0);
        expect(frameStepTime(10, 1, 30, 10)).toBe(10);
        expect(frameStepTime(5, 1, undefined, NaN)).toBeCloseTo(5 + 1 / 30);
    });
});

describe("seeking", () => {
    test("seekTime clamps to the video", () => {
        expect(seekTime(10, 5, 60)).toBe(15);
        expect(seekTime(2, -5, 60)).toBe(0);
        expect(seekTime(58, 5, 60)).toBe(60);
        expect(seekTime(58, 5, Infinity)).toBe(63);
        expect(seekTime(58, 5, NaN)).toBe(63);
        expect(seekTime(NaN, 5, 60)).toBe(5);
    });

    test("clampSeekSeconds", () => {
        expect(clampSeekSeconds(5)).toBe(5);
        expect(clampSeekSeconds(0)).toBe(1);
        expect(clampSeekSeconds(100)).toBe(60);
        expect(clampSeekSeconds(2.6)).toBe(3);
        expect(clampSeekSeconds("x")).toBe(5);
    });
});

describe("time formatting", () => {
    test("formatTime", () => {
        expect(formatTime(0)).toBe("0:00");
        expect(formatTime(5.9)).toBe("0:05");
        expect(formatTime(62)).toBe("1:02");
        expect(formatTime(600)).toBe("10:00");
        expect(formatTime(3723)).toBe("1:02:03");
        expect(formatTime(-3)).toBe("0:00");
        expect(formatTime(NaN)).toBe("0:00");
        expect(formatTime(Infinity)).toBe("0:00");
    });

    test("formatPosition", () => {
        expect(formatPosition(42, 90)).toBe("0:42 / 1:30");
        expect(formatPosition(42, Infinity)).toBe("0:42");
        expect(formatPosition(42)).toBe("0:42");
    });

    test("withShortcut", () => {
        expect(withShortcut("Loop", "L")).toBe("Loop (L)");
        expect(withShortcut("Loop")).toBe("Loop");
    });
});

describe("sticky video", () => {
    test("pins once mostly out of view, and unpins only once mostly back", () => {
        expect(STICK_BELOW).toBeLessThan(UNSTICK_AT);
        expect(STICKY_THRESHOLDS).toEqual([0, STICK_BELOW, UNSTICK_AT]);
        expect(nextSticky(false, 1)).toBe(false);
        expect(nextSticky(false, 0.5)).toBe(false);
        expect(nextSticky(false, 0.1)).toBe(true);
        expect(nextSticky(false, 0)).toBe(true);
        // Between the two it stays as it is, so it doesn't flap at an edge
        expect(nextSticky(true, 0.4)).toBe(true);
        expect(nextSticky(false, 0.4)).toBe(false);
        expect(nextSticky(true, UNSTICK_AT)).toBe(false);
        expect(nextSticky(true, 1)).toBe(false);
        expect(nextSticky(false, NaN)).toBe(true);
    });

    test("miniSize keeps the video's shape within the corner's bounds", () => {
        expect(miniSize(640, 360)).toEqual({ width: MINI_WIDTH, height: 180 });
        expect(miniSize(1920, 1080)).toEqual({ width: 320, height: 180 });
        // Portrait: capped in height, narrower instead
        expect(miniSize(360, 640)).toEqual({ width: 135, height: MINI_MAX_HEIGHT });
        // Square: capped in height
        expect(miniSize(500, 500)).toEqual({ width: 240, height: 240 });
        // Unknown shape is 16:9
        expect(miniSize(0, 0)).toEqual({ width: 320, height: 180 });
        expect(miniSize(NaN, 100)).toEqual({ width: 320, height: 180 });
    });

    test("miniSize fits a narrow chat, but not below the minimum", () => {
        expect(miniSize(640, 360, 300)).toEqual({ width: 300 - 2 * MINI_MARGIN, height: 151 });
        expect(miniSize(640, 360, 100).width).toBe(MINI_MIN_WIDTH);
        expect(miniSize(640, 360, 2000).width).toBe(MINI_WIDTH);
    });

    test("miniPosition is the chat's bottom right corner, inside the window", () => {
        const size = { width: 320, height: 180 };
        const viewport = { width: 1600, height: 900 };
        expect(miniPosition(size, viewport, { left: 300, top: 50, width: 1000, height: 750 }))
            .toEqual({ left: 1300 - MINI_MARGIN - 320, top: 800 - MINI_MARGIN - 180, width: 320, height: 180 });
        // No chat box: the window's corner
        expect(miniPosition(size, viewport, null)).toEqual({ left: 1600 - 16 - 320, top: 900 - 16 - 180, width: 320, height: 180 });
        // A box running past the window is cut to it
        expect(miniPosition(size, viewport, { left: 0, top: 0, width: 5000, height: 5000 })).toEqual({ left: 1264, top: 704, width: 320, height: 180 });
        // Never off the top left
        expect(miniPosition(size, { width: 100, height: 100 }, null)).toEqual({ left: 0, top: 0, width: 320, height: 180 });
    });

    test("isIdentityTransform", () => {
        expect(isIdentityTransform("none")).toBe(true);
        expect(isIdentityTransform(undefined)).toBe(true);
        expect(isIdentityTransform("matrix(1, 0, 0, 1, 0, 0)")).toBe(true);
        expect(isIdentityTransform("matrix3d(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1)")).toBe(true);
        expect(isIdentityTransform("matrix(1, 0, 0, 1, 0, 120)")).toBe(false);
        expect(isIdentityTransform("matrix(0.9, 0, 0, 0.9, 0, 0)")).toBe(false);
        expect(isIdentityTransform("matrix3d(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 1, 1)")).toBe(false);
        expect(isIdentityTransform("rotate(1deg)")).toBe(false);
    });

    test("containingBlockLift switches off what changes nothing on screen", () => {
        const none = {
            transform: "none", translate: "none", rotate: "none", scale: "none", perspective: "none", filter: "none", backdropFilter: "none",
            clipPath: "none", maskImage: "none", contain: "none", containerType: "normal", contentVisibility: "visible", willChange: "auto",
        };
        expect(containingBlockLift(none)).toEqual({ lift: [], hard: false });
        expect(containingBlockLift({})).toEqual({ lift: [], hard: false });
        // Discord's embeds: contain: paint
        expect(containingBlockLift({ ...none, contain: "paint" })).toEqual({ lift: ["contain"], hard: false });
        expect(containingBlockLift({ ...none, contain: "layout size" })).toEqual({ lift: ["contain"], hard: false });
        expect(containingBlockLift({ ...none, contain: "strict" }).lift).toEqual(["contain"]);
        // Size or style containment alone doesn't trap fixed elements
        expect(containingBlockLift({ ...none, contain: "size" })).toEqual({ lift: [], hard: false });
        // translateZ(0) on a scroller
        expect(containingBlockLift({ ...none, transform: "matrix(1, 0, 0, 1, 0, 0)", willChange: "scroll-position" }))
            .toEqual({ lift: ["transform"], hard: false });
        expect(containingBlockLift({ ...none, willChange: "transform, opacity" })).toEqual({ lift: ["will-change"], hard: false });
        expect(containingBlockLift({ ...none, contentVisibility: "auto" })).toEqual({ lift: ["content-visibility"], hard: false });
    });

    test("containingBlockLift calls anything that would move or restyle things hard", () => {
        expect(containingBlockLift({ transform: "matrix(1, 0, 0, 1, 0, 240)" }).hard).toBe(true);
        expect(containingBlockLift({ translate: "0px 10px" }).hard).toBe(true);
        expect(containingBlockLift({ scale: "0.9" }).hard).toBe(true);
        expect(containingBlockLift({ filter: "blur(4px)" }).hard).toBe(true);
        expect(containingBlockLift({ backdropFilter: "blur(6px)" }).hard).toBe(true);
        expect(containingBlockLift({ perspective: "800px" }).hard).toBe(true);
        expect(containingBlockLift({ clipPath: "inset(0px)" }).hard).toBe(true);
        expect(containingBlockLift({ maskImage: "linear-gradient(red, blue)" }).hard).toBe(true);
        expect(containingBlockLift({ containerType: "inline-size" }).hard).toBe(true);
        // What can be lifted still is, alongside
        expect(containingBlockLift({ filter: "blur(4px)", contain: "paint" })).toEqual({ lift: ["contain"], hard: true });
    });

    test("stoppedEmbedUrl turns autoplay off", () => {
        expect(stoppedEmbedUrl("https://www.youtube.com/embed/abc?autoplay=1&auto_play=1&pageType=x"))
            .toBe("https://www.youtube.com/embed/abc?autoplay=0&auto_play=0&pageType=x");
        expect(stoppedEmbedUrl("https://player.twitch.tv/?channel=x&autoplay=true&parent=discord.com"))
            .toBe("https://player.twitch.tv/?channel=x&autoplay=false&parent=discord.com");
        expect(stoppedEmbedUrl("https://player.vimeo.com/video/1")).toBe("https://player.vimeo.com/video/1");
        expect(stoppedEmbedUrl("https://example.com/?autoplay=0")).toBe("https://example.com/?autoplay=0");
        expect(stoppedEmbedUrl("not a url")).toBe("not a url");
    });
});

describe("hover play", () => {
    const fresh = { paused: true, currentTime: 0, played: false, reducedMotion: false, fullscreen: false };

    test("waits a moment before starting", () => {
        expect(HOVER_DELAY_MS).toBeGreaterThanOrEqual(200);
        expect(HOVER_DELAY_MS).toBeLessThanOrEqual(500);
    });

    test("only previews a fresh, paused video", () => {
        expect(canHoverPlay(fresh)).toBe(true);
        expect(canHoverPlay({ ...fresh, currentTime: NaN })).toBe(true);
        expect(canHoverPlay({ ...fresh, paused: false })).toBe(false);
        expect(canHoverPlay({ ...fresh, played: true })).toBe(false);
        // Someone stopped halfway: it keeps its place
        expect(canHoverPlay({ ...fresh, currentTime: 12 })).toBe(false);
    });

    test("respects Reduced Motion, fullscreen and picture-in-picture", () => {
        expect(canHoverPlay({ ...fresh, reducedMotion: true })).toBe(false);
        expect(canHoverPlay({ ...fresh, fullscreen: true })).toBe(false);
    });
});
