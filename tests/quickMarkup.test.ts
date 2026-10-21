import { describe, expect, test } from "bun:test";

import { addNoise, arrowHead, BLOCK_NOISE, blockFor, blockGrid, canMarkUp, isTiny, outputType, rectFrom, seeded, strokeFor } from "../plugins/quick-markup/draw";

describe("Quick Markup", () => {
    const size = { w: 1000, h: 500 };

    test("a drag in any direction is the same rectangle, kept inside the picture", () => {
        expect(rectFrom({ x: 10, y: 20 }, { x: 110, y: 70 }, size)).toEqual({ x: 10, y: 20, w: 100, h: 50 });
        expect(rectFrom({ x: 110, y: 70 }, { x: 10, y: 20 }, size)).toEqual({ x: 10, y: 20, w: 100, h: 50 });
        expect(rectFrom({ x: -50, y: 400 }, { x: 1200, y: 900 }, size)).toEqual({ x: 0, y: 400, w: 1000, h: 100 });
        expect(isTiny(rectFrom({ x: 5, y: 5 }, { x: 7, y: 30 }, size))).toBe(true);
    });

    test("blur blocks are big enough to hide text, lines scale with the picture", () => {
        expect(blockFor({ x: 0, y: 0, w: 300, h: 30 })).toBe(16);
        expect(blockFor({ x: 0, y: 0, w: 300, h: 120 })).toBe(60);
        // A name in Discord's chat: one row of blocks taller than the letters, each wider than two of them
        expect(blockGrid({ x: 0, y: 0, w: 120, h: 20 })).toEqual({ cols: 7, rows: 1 });
        expect(blockGrid({ x: 0, y: 0, w: 300, h: 120 })).toEqual({ cols: 5, rows: 2 });
        expect(blockGrid({ x: 0, y: 0, w: 10, h: 6 })).toEqual({ cols: 1, rows: 1 });
        expect(strokeFor({ w: 400, h: 300 })).toBe(3);
        expect(strokeFor({ w: 3840, h: 2160 })).toBe(15);
    });

    test("blur blocks get the same random brightness shift on each channel, the same for a seed", () => {
        const blocks = () => new Uint8ClampedArray([100, 100, 100, 255, 0, 0, 0, 255, 255, 255, 255, 128, 40, 60, 80, 255]);
        const a = blocks(), b = blocks(), c = blocks();
        addNoise(a, seeded(1));
        addNoise(b, seeded(1));
        addNoise(c, seeded(2));
        expect(a).toEqual(b);
        expect(a).not.toEqual(c);
        const shift = a[0] - 100;
        expect(Math.abs(shift)).toBeLessThanOrEqual(BLOCK_NOISE);
        expect([a[1], a[2], a[3]]).toEqual([100 + shift, 100 + shift, 255]);
        expect(a[11]).toBe(128);
        expect(a[13] - a[12]).toBe(20);
    });

    test("noise varies between blocks", () => {
        const random = seeded(42);
        const shifts = new Set(Array.from({ length: 50 }, () => Math.round((random() * 2 - 1) * BLOCK_NOISE)));
        expect(shifts.size).toBeGreaterThan(10);
    });

    test("the arrow head points back along the line", () => {
        const [l, r] = arrowHead({ x: 0, y: 0 }, { x: 100, y: 0 }, 20);
        expect(l.x).toBeLessThan(100);
        expect(r.x).toBeLessThan(100);
        expect(Math.sign(l.y)).toBe(-Math.sign(r.y));
    });

    test("PNG, JPEG and WebP keep their type; still pictures only", () => {
        expect(outputType("image/jpeg", "a.jpg")).toEqual({ type: "image/jpeg", name: "a.jpg" });
        expect(outputType("image/bmp", "shot.bmp")).toEqual({ type: "image/png", name: "shot.png" });
        expect(outputType("image/png", "shot.png")).toEqual({ type: "image/png", name: "shot.png" });
        expect(canMarkUp({ type: "image/png", name: "a.png" })).toBe(true);
        expect(canMarkUp({ type: "image/gif", name: "a.gif" })).toBe(false);
        expect(canMarkUp({ type: "video/mp4", name: "a.mp4" })).toBe(false);
    });
});
