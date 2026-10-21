import { describe, expect, test } from "bun:test";
import type { Session } from "electron";

import { addRequestFilter } from "../src/main/requests";

type Listener = ((details: any, callback: (res: object) => void) => void) | null;

function fakeSession() {
    const calls: Listener[] = [];
    const session = { webRequest: { onBeforeRequest: (listener: Listener) => void calls.push(listener) } } as unknown as Session;
    return { session, calls, current: () => calls.at(-1) ?? null };
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
});
