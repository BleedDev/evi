import { describe, expect, test } from "bun:test";
import type { Session } from "electron";

import { addRequestFilter } from "../src/main/requests";

type Listener = ((details: any, callback: (res: object) => void) => void) | null;
type Call = { urls?: string[]; listener: Listener; };

/** Records what the listener is registered with, like Electron's onBeforeRequest([filter,] listener) */
function fakeSession(validate = (_: string) => true) {
    const calls: Call[] = [];
    const onBeforeRequest = (a: { urls: string[]; } | Listener, b?: Listener) => {
        if (b === undefined) return void calls.push({ listener: a as Listener });
        const { urls } = a as { urls: string[]; };
        const bad = urls.find(u => !validate(u));
        if (bad) throw new Error(`Invalid url pattern ${bad}`);
        calls.push({ urls, listener: b });
    };
    const session = { webRequest: { onBeforeRequest } } as unknown as Session;
    return { session, calls, current: () => calls.at(-1)?.listener ?? null, urls: () => calls.at(-1)?.urls };
}

const run = (listener: Listener, url: string) => {
    let answer: object | undefined;
    listener!({ url }, res => void (answer = res));
    return answer;
};

describe("shared request listener", () => {
    test("is installed once, for every filter", () => {
        const { session, calls, current } = fakeSession();
        const removeA = addRequestFilter(session, d => d.url.includes("a") ? { cancel: true } : undefined);
        const removeB = addRequestFilter(session, d => d.url.includes("b") ? { cancel: true } : undefined);
        expect(calls.length).toBe(1);
        expect(run(current(), "https://x/a")).toEqual({ cancel: true });
        expect(run(current(), "https://x/b")).toEqual({ cancel: true });
        expect(run(current(), "https://x/c")).toEqual({});
        removeA();
        removeB();
    });

    test("comes off once the last filter is removed, and back with the next", () => {
        const { session, calls, current } = fakeSession();
        const removeA = addRequestFilter(session, () => ({ cancel: true }));
        const removeB = addRequestFilter(session, () => undefined);
        removeA();
        expect(current()).not.toBeNull();
        removeB();
        expect(current()).toBeNull();
        // A second call (stop also runs the plugin's disposers) changes nothing
        removeB();
        expect(calls.length).toBe(2);

        const removeC = addRequestFilter(session, () => ({ cancel: true }));
        expect(calls.length).toBe(3);
        expect(run(current(), "https://x/")).toEqual({ cancel: true });
        removeC();
        expect(current()).toBeNull();
    });

    test("is registered for the URLs the filters name, every URL as soon as one names none", () => {
        const { session, calls, current, urls } = fakeSession();
        const removeA = addRequestFilter(session, d => d.url.includes("a") ? { cancel: true } : undefined, ["https://*.a.com/*", "https://*.b.com/x*"]);
        expect(urls()).toEqual(["https://*.a.com/*", "https://*.b.com/x*"]);
        const removeB = addRequestFilter(session, () => undefined, ["https://*.b.com/x*", "https://*.c.com/*"]);
        expect(urls()).toEqual(["https://*.a.com/*", "https://*.b.com/x*", "https://*.c.com/*"]);
        // Every filter sees whatever arrives, and checks it itself
        expect(run(current(), "https://www.a.com/")).toEqual({ cancel: true });
        expect(run(current(), "https://c.com/")).toEqual({});

        const removeAll = addRequestFilter(session, () => undefined, []);
        expect(urls()).toBeUndefined();
        removeAll();
        expect(urls()).toEqual(["https://*.a.com/*", "https://*.b.com/x*", "https://*.c.com/*"]);
        removeB();
        expect(urls()).toEqual(["https://*.a.com/*", "https://*.b.com/x*"]);
        // Removing one that's already gone doesn't register again
        const registered = calls.length;
        removeB();
        expect(calls.length).toBe(registered);
        removeA();
        expect(current()).toBeNull();
    });

    test("a pattern Electron refuses means every request, so no filter misses any", () => {
        const { session, current, urls } = fakeSession(u => !u.includes("bad"));
        const error = console.error;
        console.error = () => { };
        try {
            const removeA = addRequestFilter(session, d => d.url.includes("a") ? { cancel: true } : undefined, ["https://*.a.com/*"]);
            const removeB = addRequestFilter(session, () => undefined, ["bad"]);
            expect(current()).not.toBeNull();
            expect(urls()).toBeUndefined();
            expect(run(current(), "https://a.com/")).toEqual({ cancel: true });
            removeB();
            expect(urls()).toEqual(["https://*.a.com/*"]);
            removeA();
        } finally {
            console.error = error;
        }
    });
});
