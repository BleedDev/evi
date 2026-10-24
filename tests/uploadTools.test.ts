import { describe, expect, test } from "bun:test";

import { editAttachments, MAX_ATTACHMENTS, move, nearestSlot, reorderShown, roomFor, shiftedIndex } from "../plugins/upload-tools/order";
import { fraction, overall, secondsLeft, size, SpeedMeter, timeLeft } from "../plugins/upload-tools/progress";

describe("Upload Tools: speed and time left", () => {
    test("the speed is bytes over the last few seconds, shown once there's half a second to go on", () => {
        const meter = new SpeedMeter();
        expect(meter.sample(0, 10_000_000, 0)).toBeUndefined();
        expect(meter.sample(100_000, 10_000_000, 200)).toBeUndefined();
        const first = meter.sample(1_000_000, 10_000_000, 1000)!;
        expect(first.rate).toBe(1_000_000);
        expect(first.secondsLeft).toBe(9);
    });

    test("it changes at most once a second, so it can be read", () => {
        const meter = new SpeedMeter();
        meter.sample(0, 10_000_000, 0);
        const shown = meter.sample(1_000_000, 10_000_000, 1000)!;
        expect(meter.sample(1_900_000, 10_000_000, 1500)).toBe(shown);
        expect(meter.sample(3_000_000, 10_000_000, 2000)!.rate).toBe(1_500_000);
    });

    test("old samples fall out of the window, so a slowdown shows", () => {
        const meter = new SpeedMeter();
        // 1 MB/s for 4 seconds, then nothing for 3
        for (let s = 0; s <= 4; s++) meter.sample(s * 1_000_000, 100_000_000, s * 1000);
        for (let s = 5; s <= 7; s++) meter.sample(4_000_000, 100_000_000, s * 1000);
        expect(meter.sample(4_000_000, 100_000_000, 8000)!.rate).toBe(0);
    });

    test("fewer bytes than before (a file cancelled) starts over", () => {
        const meter = new SpeedMeter();
        meter.sample(0, 10_000_000, 0);
        meter.sample(5_000_000, 10_000_000, 1000);
        expect(meter.sample(1_000_000, 6_000_000, 2000)).toBeUndefined();
        expect(meter.sample(2_000_000, 6_000_000, 3000)!.rate).toBe(1_000_000);
    });

    test("time left reads like people say it, and isn't guessed without a speed", () => {
        expect(secondsLeft(1000, 0)).toBeUndefined();
        expect(secondsLeft(-5, 10)).toBe(0);
        expect(timeLeft(0.2)).toEqual({ unit: "seconds", count: 1 });
        expect(timeLeft(7.1)).toEqual({ unit: "seconds", count: 8 });
        expect(timeLeft(12)).toEqual({ unit: "seconds", count: 15 });
        expect(timeLeft(59.5)).toEqual({ unit: "seconds", count: 55 });
        expect(timeLeft(150)).toEqual({ unit: "minutes", count: 3 });
        expect(timeLeft(5400)).toEqual({ unit: "hours", count: 1.5 });
    });

    test("sizes in Discord's units, one decimal under ten", () => {
        expect(size(0)).toEqual({ unit: "b", value: 0 });
        expect(size(900)).toEqual({ unit: "b", value: 900 });
        expect(size(1536)).toEqual({ unit: "kb", value: 1.5 });
        expect(size(25 * 1024 * 1024)).toEqual({ unit: "mb", value: 25 });
        expect(size(3.25 * 1024 ** 3)).toEqual({ unit: "gb", value: 3.3 });
        expect(size(5000 * 1024 ** 3)).toEqual({ unit: "gb", value: 5000 });
    });

    test("progress as a fraction, and every message sending as one taskbar bar", () => {
        expect(fraction(5, 10)).toBe(0.5);
        expect(fraction(5, 0)).toBe(0);
        expect(fraction(15, 10)).toBe(1);
        expect(overall([])).toBe(-1);
        expect(overall([{ loaded: 0, total: 0 }])).toBe(0);
        expect(overall([{ loaded: 50, total: 100 }, { loaded: 100, total: 100 }])).toBe(0.75);
        expect(overall([{ loaded: 500, total: 100 }])).toBe(1);
    });
});

describe("Upload Tools: reordering", () => {
    const ids = (list: { id: string; }[]) => list.map(u => u.id).join("");
    const up = (id: string) => ({ id });

    test("moving one item, either way, out of range left alone", () => {
        expect(move(["a", "b", "c", "d"], 0, 2)).toEqual(["b", "c", "a", "d"]);
        expect(move(["a", "b", "c", "d"], 3, 0)).toEqual(["d", "a", "b", "c"]);
        expect(move(["a", "b"], 1, 9)).toEqual(["a", "b"]);
        expect(move(["a", "b"], 5, 0)).toEqual(["a", "b"]);
    });

    test("only the shown uploads move; one Discord hides keeps its place", () => {
        const all = ["a", "b", "x", "c"].map(up);
        const shown = ["c", "a", "b"].map(up);
        expect(ids(reorderShown(all, shown))).toBe("caxb");
        // Uploads that changed under the drag: nothing is reordered
        expect(ids(reorderShown(all, ["a", "b"].map(up)))).toBe("abxc");
        expect(ids(reorderShown(all, ["a", "b", "z"].map(up)))).toBe("abxc");
    });

    test("the slot under the pointer, in a row or in rows that wrap", () => {
        const row = [0, 1, 2].map(i => ({ left: i * 110, top: 0, width: 100, height: 100 }));
        expect(nearestSlot(row, 10, 50)).toBe(0);
        expect(nearestSlot(row, 170, 40)).toBe(1);
        expect(nearestSlot(row, 999, 50)).toBe(2);
        const grid = [0, 1, 2, 3].map(i => ({ left: (i % 2) * 110, top: Math.floor(i / 2) * 110, width: 100, height: 100 }));
        expect(nearestSlot(grid, 160, 170)).toBe(3);
        expect(nearestSlot([], 0, 0)).toBe(-1);
    });

    test("while held, the ones between shift by one towards where it came from", () => {
        // Item 1 held over slot 3: 2 and 3 move left
        expect([0, 1, 2, 3, 4].map(i => shiftedIndex(i, 1, 3))).toEqual([0, 3, 1, 2, 4]);
        // Item 3 held over slot 0: 0..2 move right
        expect([0, 1, 2, 3, 4].map(i => shiftedIndex(i, 3, 0))).toEqual([1, 2, 3, 0, 4]);
        expect([0, 1, 2].map(i => shiftedIndex(i, 1, 1))).toEqual([0, 1, 2]);
    });
});

describe("Upload Tools: adding files to an edited message", () => {
    test("room left under Discord's ten files", () => {
        expect(MAX_ATTACHMENTS).toBe(10);
        expect(roomFor(0, 0)).toBe(10);
        expect(roomFor(3, 2)).toBe(5);
        expect(roomFor(9, 4)).toBe(0);
    });

    test("every attachment is kept by id, then the new ones point at what was uploaded", () => {
        expect(editAttachments([{ id: "111" }, { id: "222" }], [
            { filename: "cat.png", uploadedFilename: "abc/cat.png" },
            { filename: "SPOILER_dog.png", uploadedFilename: "abc/dog.png", spoiler: true, description: "A dog" },
        ])).toEqual([
            { id: "111" },
            { id: "222" },
            { id: "0", filename: "cat.png", uploaded_filename: "abc/cat.png" },
            { id: "1", filename: "SPOILER_dog.png", uploaded_filename: "abc/dog.png", is_spoiler: true, description: "A dog" },
        ]);
        expect(editAttachments([], [])).toEqual([]);
    });
});
