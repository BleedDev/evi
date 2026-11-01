import { describe, expect, mock, test } from "bun:test";

import type { Replacement } from "../src/renderer/patching/source";
import { canonicalizeMatch, matchesFind } from "../src/renderer/patching/source";
import { matchesAll } from "../src/renderer/webpack/find";
import { FetchQueue, rateLimitWait } from "../plugins/who-reacted/queue";
import type { Clock, Limits } from "../plugins/who-reacted/queue";
import { extraLabel, FETCH_REACTORS, PATCHES, pickReactors, reactionKey, shownCount } from "../plugins/who-reacted/reactors";

// Verbatim from Discord's web build (test-results/chunks/dda79f402723bb62.js), the reaction pill's children
const PILL = '(0,i.jsxs)(p.D,{...e,innerRef:eh,className:eU.reactionInner,onClick:eS,"aria-disabled":I,"aria-label":(0,q.mb)(B,e$,x,G),"aria-pressed":B,children:[(0,i.jsx)("div",{className:r()({[eU.burstGlow]:G}),style:{boxShadow:`0 0 16px ${n}`}}),(0,i.jsxs)("div",{children:[G?(0,i.jsxs)(i.Fragment,{children:[ez&&(0,i.jsx)(L,{messageId:j.id,emoji:x,startPosition:et,targetPosition:eW}),eF&&(0,i.jsx)(eV,{count:T,emoji:x,channelId:j.getChannelId(),messageId:j.id,useChatFontScaling:V,color:n,emojiSize:e_.x.NORMAL})]}):null,(0,i.jsx)(g.A,{className:r()({[eU.hideEmoji]:el}),emojiId:x.id,emojiName:x.name,size:C,animated:x.animated})]}),b?null:(0,i.jsx)(E.A,{className:eU.reactionCount,value:e$,color:t,digitWidth:eD}),(0,i.jsx)(z,{count:e$,reactionRef:ep})]})';

// Verbatim from Discord's web build (test-results/chunks/web.js, 2026-11-02): the action getReactions calls
// to ask the API, hooked for its answer, and the store's handler for what it dispatches, which mustn't match
const FETCH = 'async function O(e){let t,{channelId:n,messageId:i,emoji:a,limit:l,after:o,type:c}=e,u=c===d.v.VOTE?(t=a.id??a.name,T.Rsh.POLL_ANSWER_VOTERS(n,i,t)):C({channelId:n,messageId:i,emoji:a}),_=await r.Bo.get({url:u,query:{limit:l,after:o,type:c},oldFormErrors:!0,rejectWithError:(0,r.fT)()}),E=c===d.v.VOTE?_.body.users:_.body;return s.h.dispatch({type:"MESSAGE_REACTION_ADD_USERS",channelId:n,messageId:i,users:E,emoji:a,reactionType:c}),E}';
const HANDLER = 'MESSAGE_REACTION_ADD_USERS:function(e){let{messageId:t,users:n,emoji:i,reactionType:r}=e,a=A.ensure(t,i,r);n.forEach(e=>a.users.set(e.id,new o.A(e)))}';

function apply(code: string, self = "S") {
    const patch = PATCHES.pill;
    expect(matchesFind(code, patch.find)).toBe(true);
    let next = code;
    for (const r of ([] as Replacement[]).concat(patch.replace)) {
        const re = canonicalizeMatch(r.match) as RegExp;
        expect(code.match(new RegExp(re.source, "g"))?.length).toBe(1);
        next = next.replace(re, (r.with as string).replaceAll("$self", self));
    }
    return next;
}

describe("patch", () => {
    test("the avatars go right after the count, with the pill's props", () => {
        const out = apply(PILL);
        expect(out).toContain("digitWidth:eD}),S?.renderUsers?.(arguments[0]),(0,i.jsx)(z,{count:e$,reactionRef:ep})]})");
        expect(() => new Function("return " + out)).not.toThrow();
    });

    test("runs: renderUsers gets the props the pill was called with", () => {
        const out = apply(PILL);
        const jsx = (type: unknown, props: any) => ({ type, props });
        const calls: unknown[] = [];
        const S = { renderUsers: (p: unknown) => (calls.push(p), "USERS") };
        const pill = new Function("i", "p", "q", "r", "g", "E", "eU", "e_", "S", `return function(){return ${out}}`)(
            { jsx, jsxs: jsx, Fragment: "F" }, { D: "Pill" }, { mb: () => "label" }, () => () => "", { A: "Emoji" }, { A: "Count" }, {}, { x: {} }, S,
        );
        const props = { message: { id: "1" } };
        // The pill's locals the snippet reads
        const locals = { e: {}, eh: 0, eS: 0, I: 0, B: 0, e$: 3, x: {}, G: false, n: "", ez: 0, et: 0, eW: 0, eF: 0, T: 0, j: {}, V: 0, el: 0, C: 0, b: false, t: "", eD: 12, z: "Confetti", ep: 0, L: 0, eV: 0 };
        Object.assign(globalThis, locals);
        let tree: any;
        try {
            tree = pill.call(null, props);
        } finally {
            for (const key in locals) delete (globalThis as any)[key];
        }
        expect(calls).toEqual([props]);
        expect(tree.props.children.map((c: any) => c?.type ?? c)).toEqual(["div", "div", "Count", "USERS", "Confetti"]);
    });
});

test("the hooked action is the one that asks for who reacted", () => {
    expect(matchesAll(FETCH, FETCH_REACTORS)).toBe(true);
    expect(matchesAll(HANDLER, FETCH_REACTORS)).toBe(false);
});

describe("reactors", () => {
    const users = (...ids: string[]) => ids.map(id => ({ id }));
    const none = () => false;

    test("the first to react, up to the limit, and how many more", () => {
        expect(pickReactors(users("a", "b", "c"), 3, 5, none)).toEqual({ shown: users("a", "b", "c"), extra: 0 });
        expect(pickReactors(users("a", "b", "c"), 40, 2, none)).toEqual({ shown: users("a", "b"), extra: 38 });
    });

    test("leaves out blocked people, and doesn't count them as more", () => {
        const blocked = (id: string) => id === "b";
        expect(pickReactors(users("a", "b", "c"), 3, 5, blocked)).toEqual({ shown: users("a", "c"), extra: 0 });
        expect(pickReactors(users("b"), 1, 5, blocked)).toEqual({ shown: [], extra: 0 });
    });

    test("a store a reaction ahead of the count never goes negative", () => {
        expect(pickReactors(users("a", "b"), 1, 5, none)).toEqual({ shown: users("a", "b"), extra: 0 });
    });

    test("keys, counts and labels", () => {
        expect(reactionKey("1", { name: "👍" }, 0)).toBe("1:👍::0");
        expect(reactionKey("1", { name: "cat", id: "9" }, 1)).toBe("1:cat:9:1");
        expect(shownCount({ type: 0, count: 4, burst_count: 1 })).toBe(4);
        expect(shownCount({ type: 1, count: 4, burst_count: 1 })).toBe(1);
        expect(shownCount({})).toBe(0);
        expect(extraLabel(12)).toBe("+12");
        expect(extraLabel(250)).toBe("+99+");
    });
});

describe("fetch queue", () => {
    const LIMITS: Limits = { gapMs: 1000, perMinute: 20, backoffMs: 30_000, maxBackoffMs: 300_000 };

    /** A clock that moves when the test says so: tick() jumps to the next timer and runs it */
    function manual() {
        let now = 0;
        let timers: { fn: () => void; at: number; }[] = [];
        const clock: Clock = {
            now: () => now,
            setTimeout: (fn, ms) => {
                const t = { fn, at: now + ms };
                timers.push(t);
                return t;
            },
            clearTimeout: t => void (timers = timers.filter(q => q !== t)),
        };
        const tick = () => {
            timers.sort((a, b) => a.at - b.at);
            const t = timers.shift();
            if (!t) return false;
            now = Math.max(now, t.at);
            t.fn();
            return true;
        };
        return { clock, tick, now: () => now, waits: () => timers.map(t => t.at - now) };
    }

    /** Lets the answers' callbacks run */
    const settle = () => new Promise(r => setTimeout(r, 0));
    /** What Discord's client rejects with on a 429 */
    const tooMany = (retryAfter?: number) => Object.assign(new Error("GET /channels/xxx/messages/xxx/reactions/x [429]"), {
        name: "HTTPResponseError", status: 429, retryAfter, body: { message: "You are being rate limited.", retry_after: retryAfter },
    });

    test("one at a time, a second apart, each key once", () => {
        const { clock, tick, waits } = manual();
        const q = new FetchQueue(LIMITS, clock);
        const ran: string[] = [];
        q.add("a", () => ran.push("a"));
        q.add("b", () => ran.push("b"));
        q.add("a", () => ran.push("a again"));
        expect(waits()).toEqual([0]);
        tick();
        expect(ran).toEqual(["a"]);
        expect(q.has("a")).toBe(true);
        expect(waits()).toEqual([1000]);
        tick();
        expect(ran).toEqual(["a", "b"]);
        expect(waits()).toEqual([]);
        q.add("a", () => ran.push("a again"));
        expect(waits()).toEqual([]);
    });

    test("a reaction added right after another still waits out the gap", () => {
        const { clock, tick, waits } = manual();
        const q = new FetchQueue(LIMITS, clock);
        q.add("a", () => { });
        tick();
        q.add("b", () => { });
        expect(waits()).toEqual([1000]);
    });

    test("no more than the cap in any minute", () => {
        const { clock, tick, now } = manual();
        const q = new FetchQueue(LIMITS, clock);
        const at: number[] = [];
        for (let i = 0; i < 25; i++) q.add(`k${i}`, () => at.push(now()));
        while (tick());
        expect(at).toHaveLength(25);
        expect(at.slice(0, 20)).toEqual(Array.from({ length: 20 }, (_, i) => i * 1000));
        // The 21st waits for the first to be a minute old, then one a second as the window slides
        expect(at.slice(20)).toEqual([60_000, 61_000, 62_000, 63_000, 64_000]);
        for (let i = 0; i + 20 < at.length; i++) expect(at[i + 20] - at[i]).toBeGreaterThanOrEqual(60_000);
    });

    test("a job removed before its turn never runs", () => {
        const { clock, tick } = manual();
        const q = new FetchQueue(LIMITS, clock);
        const ran: string[] = [];
        q.add("a", () => ran.push("a"));
        q.remove("a");
        tick();
        expect(ran).toEqual([]);
        expect(q.has("a")).toBe(false);
    });

    test("a job that throws doesn't stop the queue", () => {
        const { clock, tick } = manual();
        const q = new FetchQueue(LIMITS, clock);
        const ran: string[] = [];
        q.add("a", () => { throw new Error("no"); });
        q.add("b", () => ran.push("b"));
        expect(() => tick()).toThrow();
        tick();
        expect(ran).toEqual(["b"]);
    });

    test("a 429 pauses the queue at least 30 s, then asks that reaction again first", async () => {
        const { clock, tick, now, waits } = manual();
        const q = new FetchQueue(LIMITS, clock);
        const at: [string, number][] = [];
        let fail = true;
        q.add("a", () => (at.push(["a", now()]), fail ? Promise.reject(tooMany(2)) : Promise.resolve()));
        q.add("b", () => void at.push(["b", now()]));
        tick();
        await settle();
        fail = false;
        expect(q.has("a")).toBe(false);
        // Discord said 2 s, the queue waits 30
        expect(waits()).toEqual([30_000]);
        while (tick()) await settle();
        expect(at).toEqual([["a", 0], ["a", 30_000], ["b", 31_000]]);
        expect(q.has("a")).toBe(true);
    });

    test("Discord's retry_after wins when it's longer, and 429s in a row back off further", async () => {
        const { clock, tick, waits } = manual();
        const q = new FetchQueue(LIMITS, clock);
        q.add("a", () => Promise.reject(tooMany(90)));
        tick();
        await settle();
        expect(waits()).toEqual([90_000]);
        tick();
        await settle();
        // Second in a row is 60 s, Discord's 90 still wins
        expect(waits()).toEqual([90_000]);
        q.clear();
        q.add("b", () => Promise.reject(tooMany()));
        for (const expected of [30_000, 60_000, 120_000, 240_000, 300_000, 300_000]) {
            tick();
            await settle();
            expect(waits()).toEqual([expected]);
        }
    });

    test("an answer resets the back-off", async () => {
        const { clock, tick, waits } = manual();
        const q = new FetchQueue(LIMITS, clock);
        let fails = 2;
        q.add("a", () => fails-- > 0 ? Promise.reject(tooMany()) : Promise.resolve());
        q.add("b", () => Promise.reject(tooMany()));
        tick();
        await settle();
        tick();
        await settle();
        expect(waits()).toEqual([60_000]);
        // a gets its answer, then b's 429 starts over at 30 s
        tick();
        await settle();
        tick();
        await settle();
        expect(waits()).toEqual([30_000]);
    });

    test("a reaction that scrolled away while asked isn't asked again after a 429, until it's back", async () => {
        const { clock, tick } = manual();
        const q = new FetchQueue(LIMITS, clock);
        const ran: string[] = [];
        q.add("a", () => (ran.push("a"), Promise.reject(tooMany())));
        tick();
        q.remove("a");
        await settle();
        while (tick()) await settle();
        expect(ran).toEqual(["a"]);
        q.add("a", () => void ran.push("a again"));
        tick();
        expect(ran).toEqual(["a", "a again"]);
    });

    test("other errors don't pause it, and that reaction isn't asked again", async () => {
        const { clock, tick, waits } = manual();
        const q = new FetchQueue(LIMITS, clock);
        q.add("a", () => Promise.reject(Object.assign(new Error("forbidden"), { status: 403 })));
        q.add("b", () => { });
        tick();
        await settle();
        expect(waits()).toEqual([1000]);
        expect(q.has("a")).toBe(true);
    });

    test("clear forgets everything", () => {
        const { clock, tick, waits } = manual();
        const q = new FetchQueue(LIMITS, clock);
        q.add("a", () => { });
        tick();
        q.add("b", () => { });
        q.clear();
        expect(waits()).toEqual([]);
        expect(q.has("a")).toBe(false);
        q.add("c", () => { });
        expect(waits()).toEqual([0]);
    });

    test("rate limits in each shape Discord's client rejects with", () => {
        expect(rateLimitWait(tooMany(1.5))).toBe(1500);
        // The bare response, when rejectWithError is off
        expect(rateLimitWait({ ok: false, status: 429, headers: { "retry-after": "4" }, body: {} })).toBe(4000);
        // A route the client already knows is limited
        expect(rateLimitWait({ status: 429, body: { message: "You are being rate limited.", retry_after: 3 } })).toBe(3000);
        expect(rateLimitWait({ status: 429 })).toBe(0);
        expect(rateLimitWait({ status: 403, body: { retry_after: 3 } })).toBeUndefined();
        expect(rateLimitWait(new Error("offline"))).toBeUndefined();
        expect(rateLimitWait(undefined)).toBeUndefined();
    });
});

describe("after stop", () => {
    // Avatars already drawn stay mounted (the patch stays in Discord's code) and re-render on their own
    // when the store changes: they draw nothing, with the same hooks, instead of crashing the message
    test("a drawn Reactors re-renders to nothing once the plugin stopped", async () => {
        const shim = await import("../src/renderer/react/jsx-runtime");
        const realApi = { ...await import("@evi/api") };
        const hooks: string[] = [];
        const jsx = (type: unknown, props: any) => ({ type, props });
        const runtime = { jsx, jsxs: jsx, jsxDEV: jsx, Fragment: "F" };
        mock.module("react/jsx-runtime", () => runtime);
        mock.module("react/jsx-dev-runtime", () => runtime);
        const stores: Record<string, unknown> = {
            MessageReactionsStore: { getReactions: () => new Map([["1", {}], ["2", {}]]), addChangeListener() { }, removeChangeListener() { } },
            UserStore: { getUser: (id: string) => ({ getAvatarURL: () => `avatar-${id}` }) },
        };
        mock.module("@evi/api", () => ({
            definePlugin: (plugin: unknown) => plugin,
            defineStrings: () => (key: string) => key,
            findStore: (name: string) => stores[name],
            filters: { byCode: () => () => false },
            React: {
                useRef: (current: unknown) => (hooks.push("ref"), { current }),
                useEffect: (fn: () => void) => (hooks.push("effect"), fn()),
                useSyncExternalStore: (_: unknown, snapshot: () => unknown) => (hooks.push("store"), snapshot()),
            },
        }));
        try {
            const plugin: any = (await import("../plugins/who-reacted/index")).default;
            const disposers: (() => void)[] = [];
            const ctx = { settings: { use: () => (hooks.push("store"), { max: 5, showExtra: true }) }, onDispose: (fn: () => void) => disposers.push(fn), hookExport() { }, logger: console };
            plugin.start(ctx);
            const el = plugin.renderUsers({ message: { id: "m", getChannelId: () => "c" }, emoji: { name: "x" }, count: 2 });
            const render = () => {
                hooks.length = 0;
                return { out: el.type(el.props), hooks: [...hooks] };
            };
            render();
            await new Promise(r => setTimeout(r, 5)); // the queue asks for this reaction
            const drawn = render();
            expect(drawn.out.props.className).toBe("evi-who-reacted");
            for (const fn of disposers) fn();
            const stopped = render();
            expect(stopped.out).toBeNull();
            expect(stopped.hooks).toEqual(drawn.hooks);
        } finally {
            mock.module("react/jsx-runtime", () => shim);
            mock.module("react/jsx-dev-runtime", () => shim);
            mock.module("@evi/api", () => realApi);
        }
    });
});
