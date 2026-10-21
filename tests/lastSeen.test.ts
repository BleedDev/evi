import { describe as group, expect, test } from "bun:test";

import {
    describe, deserialize, formatRelative, formatSpan, isIgnored, lineText, merge, observeActivity, observeMessage, observePresence, pack, prune, RESTAMP_MS, seenText, serialize,
} from "../plugins/last-seen/track";
import { load, save, state } from "../plugins/last-seen/state";
import type { Tracker } from "../plugins/last-seen/track";

const H = 3600_000;
const D = 24 * H;

group("observePresence", () => {
    test("online marks seen now, going offline records the transition", () => {
        const t: Tracker = new Map();
        expect(observePresence(t, "a", "online", 1000)).toBe(true);
        expect(t.get("a")).toEqual({ online: true, seen: 1000 });
        expect(observePresence(t, "a", "idle", 1000 + RESTAMP_MS)).toBe(true);
        expect(t.get("a")!.seen).toBe(1000 + RESTAMP_MS);
        const off = 5000 + RESTAMP_MS;
        expect(observePresence(t, "a", "offline", off)).toBe(true);
        expect(t.get("a")).toEqual({ online: false, seen: off });
        // Staying offline changes nothing
        expect(observePresence(t, "a", "offline", off + 4000)).toBe(false);
        expect(t.get("a")!.seen).toBe(off);
    });

    test("staying online restamps at most every RESTAMP_MS, but still counts as a recent touch", () => {
        const t: Tracker = new Map();
        observePresence(t, "a", "online", 1000);
        observePresence(t, "b", "online", 1500);
        expect(observePresence(t, "a", "idle", 2000)).toBe(false);
        expect(t.get("a")).toEqual({ online: true, seen: 1000 });
        expect([...t.keys()]).toEqual(["b", "a"]);
        // Going offline is always stamped
        expect(observePresence(t, "a", "offline", 3000)).toBe(true);
        expect(t.get("a")).toEqual({ online: false, seen: 3000 });
    });

    test("someone never seen online isn't recorded", () => {
        const t: Tracker = new Map();
        expect(observePresence(t, "b", "offline", 1000)).toBe(false);
        expect(observePresence(t, "b", undefined, 1000)).toBe(false);
        expect(observePresence(t, "b", "invisible", 1000)).toBe(false);
        expect(t.size).toBe(0);
    });

    test("dnd counts as online, invisible as offline", () => {
        const t: Tracker = new Map();
        observePresence(t, "c", "dnd", 10);
        expect(t.get("c")!.online).toBe(true);
        observePresence(t, "c", "invisible", 20);
        expect(t.get("c")).toEqual({ online: false, seen: 20 });
    });

    test("a restored approximate time is replaced by the next real observation", () => {
        const t = deserialize({ v: 2, savedAt: 1000, rows: [["a", 100, 0, 1, 0, "", "", 0]] });
        expect(t.get("a")).toEqual({ seen: 1000, approx: true });
        // Not online after the restore, so an offline update isn't a transition
        expect(observePresence(t, "a", "offline", 2000)).toBe(false);
        expect(t.get("a")!.approx).toBe(true);
        observePresence(t, "a", "online", 3000);
        expect(t.get("a")).toEqual({ online: true, seen: 3000 });
    });
});

group("observeActivity", () => {
    test("keeps the latest activity time", () => {
        const t: Tracker = new Map();
        expect(observeActivity(t, "a", 500)).toBe(true);
        expect(observeActivity(t, "a", 300)).toBe(false);
        expect(t.get("a")).toEqual({ active: 500 });
        expect(observeActivity(t, "a", 900)).toBe(true);
        expect(t.get("a")!.active).toBe(900);
    });
});

group("observeMessage", () => {
    test("keeps the latest message time", () => {
        const t: Tracker = new Map();
        expect(observeMessage(t, "a", 500)).toBe(true);
        expect(observeMessage(t, "a", 300)).toBe(false);
        expect(t.get("a")!.message).toBe(500);
        expect(observeMessage(t, "a", 900)).toBe(true);
        expect(t.get("a")!.message).toBe(900);
    });

    test("stores where, and clears it when a newer message doesn't say", () => {
        const t: Tracker = new Map();
        observeMessage(t, "a", 500, { channelId: "c1", messageId: "m1" });
        expect(t.get("a")).toEqual({ message: 500, channelId: "c1", messageId: "m1" });
        observeMessage(t, "a", 600, { channelId: "c2" });
        expect(t.get("a")).toEqual({ message: 600, channelId: "c2" });
        observeMessage(t, "a", 700);
        expect(t.get("a")).toEqual({ message: 700 });
    });

    test("older messages from history neither overwrite nor count as a recent touch", () => {
        const t: Tracker = new Map();
        observeMessage(t, "a", 900, { channelId: "c1", messageId: "m1" });
        observeMessage(t, "b", 100);
        expect(observeMessage(t, "a", 300, { channelId: "c0", messageId: "m0" })).toBe(false);
        expect(t.get("a")).toEqual({ message: 900, channelId: "c1", messageId: "m1" });
        expect([...t.keys()]).toEqual(["a", "b"]);
    });
});

group("prune", () => {
    test("drops least recently touched first", () => {
        const t: Tracker = new Map();
        const opts = { cap: 3 };
        observeMessage(t, "a", 1, {}, opts);
        observeMessage(t, "b", 2, {}, opts);
        observeMessage(t, "c", 3, {}, opts);
        observeMessage(t, "a", 4, {}, opts); // a is now most recent
        observeMessage(t, "d", 5, {}, opts); // b goes
        expect([...t.keys()]).toEqual(["c", "a", "d"]);
        expect(prune(t, 1)).toBe(2);
        expect([...t.keys()]).toEqual(["d"]);
    });

    test("presence observations prune too", () => {
        const t: Tracker = new Map();
        for (let i = 0; i < 10; i++) observePresence(t, `u${i}`, "online", i, { cap: 5 });
        expect(t.size).toBe(5);
        expect(t.has("u0")).toBe(false);
        expect(t.has("u9")).toBe(true);
    });

    test("protected people are skipped while anyone else can go", () => {
        const t: Tracker = new Map();
        const opts = { cap: 3, keep: (id: string) => id === "friend" };
        observeActivity(t, "friend", 1, opts);
        for (let i = 0; i < 10; i++) observeActivity(t, `s${i}`, i + 2, opts);
        expect(t.size).toBe(3);
        // Skipped protected people move to the back, so the next prune doesn't walk past them again
        expect([...t.keys()]).toEqual(["s8", "friend", "s9"]);
    });

    test("with slack, nothing goes until the cap plus slack is passed, then back down to the cap at once", () => {
        const t: Tracker = new Map();
        const opts = { cap: 10, slack: 5 };
        for (let i = 0; i < 15; i++) observeActivity(t, `u${i}`, i + 1, opts);
        expect(t.size).toBe(15);
        observeActivity(t, "u15", 100, opts);
        expect(t.size).toBe(10);
        expect([...t.keys()]).toEqual(["u6", "u7", "u8", "u9", "u10", "u11", "u12", "u13", "u14", "u15"]);
        // And again only after another five
        for (let i = 16; i < 21; i++) observeActivity(t, `u${i}`, i + 100, opts);
        expect(t.size).toBe(15);
    });

    test("prune with slack returns how many went", () => {
        const t: Tracker = new Map(Array.from({ length: 20 }, (_, i) => [`u${i}`, { seen: i }]));
        expect(prune(t, 10, undefined, 10)).toBe(0);
        expect(prune(t, 10, undefined, 9)).toBe(10);
        expect(t.size).toBe(10);
    });

    test("protected people at the front are only scanned once across prunes", () => {
        const t: Tracker = new Map();
        for (let i = 0; i < 100; i++) t.set(`f${i}`, { seen: i });
        for (let i = 0; i < 100; i++) t.set(`s${i}`, { seen: 100 + i });
        let asked = 0;
        const keep = (id: string) => (asked++, id.startsWith("f"));
        expect(prune(t, 150, keep)).toBe(50);
        expect(asked).toBe(150);
        // The friends moved behind the strangers still left: the next prune starts on strangers
        expect([...t.keys()].slice(0, 3)).toEqual(["s50", "s51", "s52"]);
        for (let i = 0; i < 10; i++) t.set(`n${i}`, { seen: 300 + i });
        asked = 0;
        expect(prune(t, 150, keep)).toBe(10);
        expect(asked).toBe(10);
        expect(t.has("f0")).toBe(true);
        expect(t.has("s59")).toBe(false);
        expect(t.has("s60")).toBe(true);
    });

    test("protected people keep their order among themselves when they have to go too", () => {
        const t: Tracker = new Map([["a", { seen: 1 }], ["x", { seen: 2 }], ["b", { seen: 3 }], ["c", { seen: 4 }]]);
        expect(prune(t, 2, id => id !== "x")).toBe(2);
        expect([...t.keys()]).toEqual(["b", "c"]);
    });

    test("protected people go too once everyone left is protected", () => {
        const t: Tracker = new Map();
        const opts = { cap: 2, keep: () => true };
        observeActivity(t, "a", 1, opts);
        observeActivity(t, "b", 2, opts);
        observeActivity(t, "c", 3, opts);
        expect([...t.keys()]).toEqual(["b", "c"]);
    });

    test("under the cap nothing is removed", () => {
        const t: Tracker = new Map([["a", { seen: 1 }]]);
        expect(prune(t, 5)).toBe(0);
        expect(t.size).toBe(1);
    });
});

group("isIgnored", () => {
    test("you and missing ids are never tracked", () => {
        expect(isIgnored("me", undefined, "me", false)).toBe(true);
        expect(isIgnored(undefined, undefined, "me", false)).toBe(true);
        expect(isIgnored("", false, "me", true)).toBe(true);
    });

    test("only an explicit bot flag counts as a bot", () => {
        expect(isIgnored("a", true, "me", true)).toBe(true);
        expect(isIgnored("a", false, "me", true)).toBe(false);
        // Raw payloads (presence, typing, voice) often leave the flag out: not a bot
        expect(isIgnored("a", undefined, "me", true)).toBe(false);
    });

    test("bots are tracked when ignoring them is off", () => {
        expect(isIgnored("a", true, "me", false)).toBe(false);
    });

    test("before your id is known, everyone else counts", () => {
        expect(isIgnored("a", undefined, undefined, true)).toBe(false);
    });
});

group("serialize / deserialize", () => {
    test("round trips and turns stale online flags into approximate last seen at save time", () => {
        const t: Tracker = new Map();
        observePresence(t, "on", "online", 100);
        observePresence(t, "off", "online", 100);
        observePresence(t, "off", "offline", 200);
        observeMessage(t, "msg", 300);
        const saved = serialize(t, 1000);
        expect(saved.v).toBe(2);
        const back = deserialize(JSON.parse(JSON.stringify(saved)));
        expect(back.get("on")).toEqual({ seen: 1000, approx: true });
        expect(back.get("off")).toEqual({ seen: 200 });
        expect(back.get("msg")).toEqual({ message: 300 });
        expect([...back.keys()]).toEqual(["on", "off", "msg"]);
    });

    test("round trips activity, where and the approx flag", () => {
        const t: Tracker = new Map([
            ["a", { seen: 100, approx: true, active: 150, message: 200, channelId: "c1", messageId: "m1" }],
            ["b", { active: 50 }],
        ]);
        const back = deserialize(JSON.parse(JSON.stringify(serialize(t, 1000))));
        expect(back.get("a")).toEqual({ seen: 100, approx: true, active: 150, message: 200, channelId: "c1", messageId: "m1" });
        expect(back.get("b")).toEqual({ active: 50 });
    });

    test("migrates v1 data", () => {
        const back = deserialize({ v: 1, savedAt: 500, rows: [["x", 100, 0, 1], ["y", 50, 60, 0], ["z", 0, 70, 0]] });
        expect(back.get("x")).toEqual({ seen: 500, approx: true });
        expect(back.get("y")).toEqual({ seen: 50, message: 60 });
        expect(back.get("z")).toEqual({ message: 70 });
    });

    test("where is only kept with a message", () => {
        const back = deserialize({ v: 2, savedAt: 0, rows: [["a", 5, 0, 0, 0, "c1", "m1", 0]] });
        expect(back.get("a")).toEqual({ seen: 5 });
    });

    test("tolerates junk and applies the cap", () => {
        expect(deserialize(null).size).toBe(0);
        expect(deserialize({ rows: "nope" }).size).toBe(0);
        const back = deserialize({ v: 1, savedAt: 0, rows: [[1, 2, 3, 0], ["a", 5, 0, 0], ["b", 0, 0, 0], ["c", 0, 7, 0], ["d", 9, 9, 0]] }, { cap: 2 });
        expect([...back.keys()]).toEqual(["c", "d"]);
    });
});

group("pack (the stored format)", () => {
    test("round trips everything serialize does, in the same order", () => {
        const t: Tracker = new Map([
            ["1", { seen: 100, approx: true, active: 150, message: 200, channelId: "c1", messageId: "m1" }],
            ["2", { active: 50 }],
            ["3", { seen: 70, online: true }],
            ["4", { message: 1_700_000_000_123 }],
        ]);
        const packed = pack(t, 1000);
        expect(packed.v).toBe(3);
        expect(packed.seen).toBeInstanceOf(Float64Array);
        const back = deserialize(structuredClone(packed));
        expect([...back.keys()]).toEqual(["1", "2", "3", "4"]);
        expect(back).toEqual(deserialize(JSON.parse(JSON.stringify(serialize(t, 1000)))));
        expect(back.get("3")).toEqual({ seen: 1000, approx: true });
        expect(back.get("4")).toEqual({ message: 1_700_000_000_123 });
    });

    test("empty, junk and ids that would misalign the columns", () => {
        expect(deserialize(pack(new Map(), 5)).size).toBe(0);
        expect(deserialize({ v: 3, ids: "1,2", seen: [1, 2] }).size).toBe(0);
        expect(deserialize({ v: 3, ids: "1", seen: new Float64Array(2), message: new Float64Array(2), active: new Float64Array(2), flags: new Uint8Array(2) }).size).toBe(0);
        const t: Tracker = new Map([["a,b", { seen: 1 }], ["c", { seen: 2, message: 3, channelId: "x,y" }], ["d", { seen: 4 }]]);
        const back = deserialize(pack(t, 10));
        expect([...back.entries()]).toEqual([["d", { seen: 4 }]]);
    });

    test("applies the cap", () => {
        const t: Tracker = new Map([["a", { seen: 1 }], ["b", { seen: 2 }], ["c", { seen: 3 }]]);
        expect([...deserialize(pack(t, 10), { cap: 2 }).keys()]).toEqual(["b", "c"]);
    });
});

group("merge", () => {
    test("takes newer fields from each side", () => {
        expect(merge({ seen: 100, message: 50, channelId: "c1" }, { seen: 200, online: true, active: 300 }))
            .toEqual({ seen: 200, online: true, active: 300, message: 50, channelId: "c1" });
    });

    test("keeps the older side's newer values", () => {
        expect(merge({ seen: 500, active: 900, message: 800, channelId: "c1" }, { seen: 100, online: false, active: 10, message: 20, channelId: "c2" }))
            .toEqual({ seen: 500, active: 900, message: 800, channelId: "c1" });
    });

    test("a live online observation wins and clears approx", () => {
        expect(merge({ seen: 1000, approx: true }, { seen: 900, online: true })).toEqual({ seen: 900, online: true });
    });

    test("a newer message replaces where, dropping ids it doesn't have", () => {
        expect(merge({ message: 1, channelId: "a", messageId: "m" }, { message: 5 })).toEqual({ message: 5 });
    });

    test("nothing to merge into", () => {
        expect(merge(undefined, { message: 5, channelId: "c" })).toEqual({ message: 5, channelId: "c" });
    });
});

group("formatRelative / formatSpan", () => {
    const now = 1_000 * D;
    test.each([
        [now - 10_000, "just now"],
        [now - 5 * 60_000, "5m ago"],
        [now - 3 * H - 59 * 60_000, "3h ago"],
        [now - 2 * D, "2d ago"],
        [now - 15 * D, "2w ago"],
        [now - 70 * D, "2mo ago"],
        [now - 800 * D, "2y ago"],
        [now + 5000, "just now"],
    ])("%p", (then, expected) => {
        expect(formatRelative(then, now)).toBe(expected);
    });

    test("span has no suffix and is null under a minute", () => {
        expect(formatSpan(now - 3 * H, now)).toBe("3h");
        expect(formatSpan(now - 30_000, now)).toBeNull();
    });
});

group("seenText / lineText", () => {
    const now = 10 * D;
    test("exact and approximate last seen", () => {
        expect(seenText({ seen: now - 3 * H }, now)).toBe("Last seen 3h ago");
        expect(seenText({ seen: now - 3 * H, approx: true }, now)).toBe("Last seen in the last 3h");
        expect(seenText({ seen: now - 10_000, approx: true }, now)).toBe("Last seen just now");
        expect(seenText({ message: now }, now)).toBeNull();
    });

    test("the newer of last seen and last active", () => {
        expect(lineText({ seen: now - 3 * H, active: now - H }, now)).toBe("Active 1h ago");
        expect(lineText({ seen: now - H, active: now - 3 * H }, now)).toBe("Last seen 1h ago");
        expect(lineText({ active: now - 2 * D }, now)).toBe("Active 2d ago");
        expect(lineText({ message: now - H }, now)).toBeNull();
        expect(lineText(undefined, now)).toBeNull();
    });
});

group("describe", () => {
    const now = 10 * D;
    test("combines last seen and last message", () => {
        expect(describe({ seen: now - 3 * H, message: now - 2 * D }, false, now)).toBe("Last seen 3h ago · Last message 2d ago");
    });
    test("says where the last message was", () => {
        expect(describe({ seen: now - 3 * H, message: now - 2 * D }, false, now, "#general")).toBe("Last seen 3h ago · Last message 2d ago in #general");
    });
    test("approximate last seen", () => {
        expect(describe({ seen: now - 3 * H, approx: true }, false, now)).toBe("Last seen in the last 3h");
    });
    test("activity only when newer than last seen", () => {
        expect(describe({ seen: now - 3 * H, active: now - H }, false, now)).toBe("Last seen 3h ago · Active 1h ago");
        expect(describe({ seen: now - H, active: now - 3 * H }, false, now)).toBe("Last seen 1h ago");
        expect(describe({ active: now - H }, false, now)).toBe("Active 1h ago");
    });
    test("online now wins over the stored time and hides activity", () => {
        expect(describe({ seen: now - 3 * H, message: now - 60_000 }, true, now)).toBe("Online now · Last message 1m ago");
        expect(describe({ seen: now - 3 * H, active: now - H }, true, now)).toBe("Online now");
        expect(describe(undefined, true, now)).toBe("Online now");
    });
    test("nothing known", () => {
        expect(describe(undefined, false, now)).toBeNull();
        expect(describe({}, false, now)).toBeNull();
    });
});

group("loading the saved data", () => {
    test("a failed read is tried again, and nothing is saved over the data until it loads", async () => {
        const timers: Array<() => void> = [];
        const ctx = { logger: { error() { } }, setTimeout: (fn: () => void) => void timers.push(fn) } as any;
        const saved: Tracker = new Map([["old", { seen: 1000 }]]);
        let reads = 0;
        const read = () => ++reads === 1 ? Promise.reject(new Error("backing store")) : Promise.resolve(pack(saved, 2000));

        state.context = ctx;
        state.loaded = false;
        state.dirty = true;
        state.tracker = new Map([["new", { online: true, seen: 3000 }]]);
        let loaded = 0;
        await load(ctx, () => loaded++, read);
        expect(state.loaded).toBe(false);
        expect(loaded).toBe(0);
        expect(timers.length).toBe(1);
        // save() waits for the load instead of writing only this session's people
        await save();
        expect(state.dirty).toBe(true);

        timers.shift()!();
        await new Promise(r => setTimeout(r, 0));
        expect(state.loaded).toBe(true);
        expect(loaded).toBe(1);
        expect([...state.tracker.keys()].sort()).toEqual(["new", "old"]);
        state.context = undefined;
    });

    test("a load that finishes after everything was replaced, or after stop, changes nothing", async () => {
        const ctx = { logger: { error() { } }, setTimeout() { throw new Error("no retry expected"); } } as any;
        state.context = ctx;
        state.loaded = true;
        state.tracker = new Map();
        let loaded = 0;
        await load(ctx, () => loaded++, () => Promise.resolve(pack(new Map([["old", { seen: 1 }]]), 2)));
        await load(ctx, () => loaded++, () => Promise.reject(new Error("x")));
        state.loaded = false;
        state.context = undefined;
        await load(ctx, () => loaded++, () => Promise.reject(new Error("x")));
        expect(loaded).toBe(0);
        expect(state.tracker.size).toBe(0);
    });
});
