import { describe, expect, mock, test } from "bun:test";

import type { Replacement } from "../src/renderer/patching/source";
import { canonicalizeMatch, matchesFind } from "../src/renderer/patching/source";
import { extraLabel, FetchQueue, PATCHES, pickReactors, reactionKey, shownCount } from "../plugins/who-reacted/reactors";
import type { Scheduler } from "../plugins/who-reacted/reactors";

// Verbatim from Discord's web build (test-results/chunks/dda79f402723bb62.js), the reaction pill's children
const PILL = '(0,i.jsxs)(p.D,{...e,innerRef:eh,className:eU.reactionInner,onClick:eS,"aria-disabled":I,"aria-label":(0,q.mb)(B,e$,x,G),"aria-pressed":B,children:[(0,i.jsx)("div",{className:r()({[eU.burstGlow]:G}),style:{boxShadow:`0 0 16px ${n}`}}),(0,i.jsxs)("div",{children:[G?(0,i.jsxs)(i.Fragment,{children:[ez&&(0,i.jsx)(L,{messageId:j.id,emoji:x,startPosition:et,targetPosition:eW}),eF&&(0,i.jsx)(eV,{count:T,emoji:x,channelId:j.getChannelId(),messageId:j.id,useChatFontScaling:V,color:n,emojiSize:e_.x.NORMAL})]}):null,(0,i.jsx)(g.A,{className:r()({[eU.hideEmoji]:el}),emojiId:x.id,emojiName:x.name,size:C,animated:x.animated})]}),b?null:(0,i.jsx)(E.A,{className:eU.reactionCount,value:e$,color:t,digitWidth:eD}),(0,i.jsx)(z,{count:e$,reactionRef:ep})]})';

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
    /** Timers run when the test says so */
    function manual() {
        let queue: { fn: () => void; ms: number; }[] = [];
        const scheduler: Scheduler = {
            setTimeout: (fn, ms) => {
                const t = { fn, ms };
                queue.push(t);
                return t;
            },
            clearTimeout: t => void (queue = queue.filter(q => q !== t)),
        };
        return { scheduler, tick: () => queue.shift()?.fn(), timers: () => queue.map(q => q.ms) };
    }

    test("one at a time, a gap apart, each key once", () => {
        const { scheduler, tick, timers } = manual();
        const q = new FetchQueue(350, scheduler);
        const ran: string[] = [];
        q.add("a", () => ran.push("a"));
        q.add("b", () => ran.push("b"));
        q.add("a", () => ran.push("a again"));
        expect(timers()).toEqual([0]);
        tick();
        expect(ran).toEqual(["a"]);
        expect(q.has("a")).toBe(true);
        expect(timers()).toEqual([350]);
        tick();
        expect(ran).toEqual(["a", "b"]);
        expect(timers()).toEqual([]);
        q.add("a", () => ran.push("a again"));
        expect(timers()).toEqual([]);
    });

    test("a job removed before its turn never runs", () => {
        const { scheduler, tick } = manual();
        const q = new FetchQueue(350, scheduler);
        const ran: string[] = [];
        q.add("a", () => ran.push("a"));
        q.remove("a");
        tick();
        expect(ran).toEqual([]);
        expect(q.has("a")).toBe(false);
    });

    test("a job that throws doesn't stop the queue", () => {
        const { scheduler, tick } = manual();
        const q = new FetchQueue(350, scheduler);
        const ran: string[] = [];
        q.add("a", () => { throw new Error("no"); });
        q.add("b", () => ran.push("b"));
        expect(() => tick()).toThrow();
        tick();
        expect(ran).toEqual(["b"]);
    });

    test("clear forgets everything", () => {
        const { scheduler, tick, timers } = manual();
        const q = new FetchQueue(350, scheduler);
        q.add("a", () => { });
        tick();
        q.add("b", () => { });
        q.clear();
        expect(timers()).toEqual([]);
        expect(q.has("a")).toBe(false);
    });
});

describe("after stop", () => {
    // Avatars already drawn stay mounted (the patch stays in Discord's code) and re-render on their own
    // when the store changes: they draw nothing, with the same hooks, instead of crashing the message
    test("a drawn Reactors re-renders to nothing once the plugin stopped", async () => {
        const shim = await import("../src/renderer/react/jsx-runtime");
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
            React: {
                useEffect: (fn: () => void) => (hooks.push("effect"), fn()),
                useSyncExternalStore: (_: unknown, snapshot: () => unknown) => (hooks.push("store"), snapshot()),
            },
        }));
        try {
            const plugin: any = (await import("../plugins/who-reacted/index")).default;
            const disposers: (() => void)[] = [];
            const ctx = { settings: { use: () => (hooks.push("store"), { max: 5, showExtra: true }) }, onDispose: (fn: () => void) => disposers.push(fn), logger: console };
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
        }
    });
});
