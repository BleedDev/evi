import { describe, expect, test } from "bun:test";

import type { Filter } from "../src/renderer/webpack/find";
import { legacyShowToastFilter, routerShowToastFilter, showToastFilter, toDiscordToast, toLegacyToast } from "../src/renderer/toolkit/toasts";
import fixture from "./fixtures/discord-toasts.json";

type Build = Record<string, string>;
type Store = { getState(): { currentToastMap: Map<string, any>; queuedToastsMap: Map<string, any>; }; };

const icon = (name: string) => Object.defineProperty(() => null, "name", { value: name });
const ICONS = { LinkIcon: icon("LinkIcon"), BookmarkIcon: icon("BookmarkIcon"), ClockIcon: icon("ClockIcon"), StarIcon: icon("StarIcon") };

/**
 * Runs a build's toast modules (verbatim from Discord) the way its webpack runtime would, with stand-ins
 * for what they import: zustand's create, React's batching, Discord's enums, the experiment check and icons.
 */
function run(build: Build, experiment = false) {
    // Each source is a method of webpack's module table, `id(e,t,n){…}`: compiling it is the parse check
    const factories: Record<string, Function> = {};
    for (const [id, src] of Object.entries(build)) factories[id] = new Function(`return {${src}}`)()[id];
    const create = (init: () => any) => {
        let state = init();
        const store: any = (select: (s: any) => any) => select(state);
        store.getState = () => state;
        store.setState = (fn: (s: any) => any) => void (state = { ...state, ...fn(state) });
        return store;
    };
    const stubs: Record<string, any> = {
        888633: { v: create },
        196765: { v: create },
        121894: { r: (cb: () => void) => cb() },
        652215: { BRT: { APP: "APP", OVERLAY: "OVERLAY", POPOUT: "POPOUT", CALL_TILE_POPOUT: "CALL_TILE_POPOUT" } },
        973283: { WD: (name: string) => name === "showToast" && experiment },
        661531: { A: { colors: { ICON_FEEDBACK_POSITIVE: "positive", ICON_BRAND: "brand" } } },
        173936: { LinkIcon: ICONS.LinkIcon }, 606096: { BookmarkIcon: ICONS.BookmarkIcon }, 406810: { ClockIcon: ICONS.ClockIcon }, 27232: { StarIcon: ICONS.StarIcon },
    };
    const cache: Record<string, { exports: any; }> = {};
    const req: any = (id: string) => {
        if (!factories[id]) return stubs[id] ?? {};
        if (cache[id]) return cache[id].exports;
        const module = cache[id] = { exports: {} };
        factories[id].call(module.exports, module, module.exports, req);
        return module.exports;
    };
    req.d = (exports: any, defs: Record<string, () => unknown>) => {
        for (const key in defs) Object.defineProperty(exports, key, { enumerable: true, get: defs[key] });
    };
    for (const id in factories) req(id);
    return cache;
}

/** Every export a filter matches, the way Evi's find tests them: the exports object, then each export */
function matches(modules: Record<string, { exports: any; }>, filter: Filter) {
    const found: { id: string; key: string; value: Function; }[] = [];
    for (const [id, { exports }] of Object.entries(modules)) {
        for (const key in exports) if (filter(exports[key])) found.push({ id, key, value: exports[key] });
    }
    return found;
}

/** The one function a filter finds; a module re-exporting it (858899 re-exports 435462's) is the same function */
function only(modules: Record<string, { exports: any; }>, filter: Filter) {
    const found = matches(modules, filter);
    expect(new Set(found.map(f => f.value)).size).toBe(1);
    return found[0];
}

const store = (modules: Record<string, { exports: any; }>, id: string) => (modules[id].exports.WE as Store).getState();
const B13 = fixture["2026-10-13"] as Build;
const B08 = fixture["2026-10-08"] as Build;

describe("Discord's toasts, 2026-10-13: one store, keyed by surface", () => {
    test("only the current store's showToast matches; the router and the old store are gone", () => {
        const modules = run(B13);
        const found = only(modules, showToastFilter);
        expect(found.id === "435462" || found.id === "858899").toBe(true);
        expect(found.value).toBe(modules["435462"].exports.P0);
        // Not its pop function, which reads the same maps
        expect(found.value).not.toBe(modules["435462"].exports.VD);
        expect(matches(modules, routerShowToastFilter)).toEqual([]);
        expect(matches(modules, legacyShowToastFilter)).toEqual([]);
    });

    test("Evi's toast lands in the app surface in the shape Discord's toast component reads", () => {
        const modules = run(B13);
        const show = only(modules, showToastFilter).value;
        show(toDiscordToast("Saved", { type: "success", duration: 5000 }));
        show(toDiscordToast("Oops", { type: "failure", position: "bottom" }));
        const state = store(modules, "435462");
        expect(state.currentToastMap.get("app").toast).toEqual({ text: "Saved", variant: "success", duration: 5000, position: "top", surface: "app" });
        // One at a time: the second waits in the queue
        expect(state.queuedToastsMap.get("app")[0].toast).toEqual({ text: "Oops", variant: "critical", duration: 3000, position: "bottom", surface: "app" });
    });

    test("types map to Discord's variants and icons, as Discord's own toast playground maps them", () => {
        const lookup = (type: string) => ({ link: ICONS.LinkIcon, clock: ICONS.ClockIcon, bookmark: ICONS.BookmarkIcon, favorite: ICONS.StarIcon } as any)[type];
        expect(toDiscordToast("a", {}).variant).toBe("default");
        expect(toDiscordToast("a", { type: "info" }, lookup).icon).toBeUndefined();
        expect(toDiscordToast("a", { type: "message" }).variant).toBe("default");
        expect(toDiscordToast("a", { type: "link" }, lookup)).toMatchObject({ variant: "default", icon: ICONS.LinkIcon });
        expect(toDiscordToast("a", { type: "favorite" }, lookup).icon).toBe(ICONS.StarIcon);
        // An icon that isn't loaded is left out rather than breaking the toast
        expect("icon" in toDiscordToast("a", { type: "clock" }, () => undefined)).toBe(false);
        expect(toDiscordToast("a", { type: "success" }, lookup).icon).toBeUndefined();
    });
});

describe("Discord's toasts, 2026-10-08: the old store, the new one, and the router between them", () => {
    test("the router is found by its experiment check; the old store by its appContext", () => {
        const modules = run(B08);
        expect(only(modules, routerShowToastFilter)).toMatchObject({ id: "739187", key: "P" });
        expect(only(modules, legacyShowToastFilter)).toMatchObject({ id: "691540", key: "P0" });
        // The new store is in this build too, behind the experiment: it's told apart by its surface
        expect(only(modules, showToastFilter).value).toBe(modules["435462"].exports.P0);
    });

    test("experiment off: the router hands Evi's toast to the old store as is", () => {
        const modules = run(B08, false);
        only(modules, routerShowToastFilter).value(toLegacyToast("Copied", { type: "success" }, "evi-toast-1"));
        expect(store(modules, "691540").currentToastMap.get("APP")).toEqual({ message: "Copied", id: "evi-toast-1", type: "success", options: { position: 0, component: null, duration: 3000, appContext: "APP" } });
        expect(store(modules, "435462").currentToastMap.size).toBe(0);
    });

    test("experiment on: the router converts it for the new store, icons included", () => {
        const modules = run(B08, true);
        const show = only(modules, routerShowToastFilter).value;
        show(toLegacyToast("Gone", { type: "failure", position: "bottom", duration: 6000 }, "evi-toast-2"));
        show(toLegacyToast("Link", { type: "link" }, "evi-toast-3"));
        const state = store(modules, "435462");
        expect(state.currentToastMap.get("app").toast).toEqual({ surface: "app", position: "bottom", duration: 6000, text: "Gone", variant: "critical" });
        expect(state.queuedToastsMap.get("app")[0].toast).toEqual({ surface: "app", position: "top", duration: 3000, text: "Link", variant: "default", icon: ICONS.LinkIcon, iconColor: undefined });
        expect(store(modules, "691540").currentToastMap.size).toBe(0);
    });

    test("Evi's old shape: info is Discord's message type", () => {
        expect(toLegacyToast("a", { type: "info" }, "x").type).toBe("message");
        expect(toLegacyToast("a", {}, "x").type).toBe("message");
        expect(toLegacyToast("a", { type: "clock", position: "bottom" }, "x")).toMatchObject({ type: "clock", options: { position: 1 } });
    });
});
