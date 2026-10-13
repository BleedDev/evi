import { afterEach, describe, expect, test } from "bun:test";

/**
 * Which of the runtimes sharing Discord's chunk global Evi treats as Discord's main one. discord.com
 * loads four, in this order: libdiscore-wasm-fetch (with a module cache), fast-connect and sentry
 * (without one) and the app itself. Each scenario gets its own copy of runtime.ts and its own page.
 */
const g = globalThis as any;
let scenario = 0;

type Runtime = typeof import("../src/renderer/webpack/runtime");

async function freshPage(): Promise<Runtime> {
    g.window = g;
    g.document = { documentElement: {}, currentScript: null };
    const runtime: Runtime = await import(`../src/renderer/webpack/runtime.ts?scenario=${scenario++}` as string);
    runtime.interceptWebpack();
    return runtime;
}

afterEach(() => {
    delete g.webpackChunkdiscord_app;
    delete g.window;
    delete g.document;
});

let nextId = 1;

/** Module factories that only count how often they ran */
function modules(count: number) {
    const factories: Record<string, (module: any) => void> = {};
    for (let i = 0; i < count; i++) factories[`m${nextId++}`] = module => void (module.exports = { ran: true });
    return factories;
}

/**
 * A minimal rspack runtime, as its file ends: it installs the chunks already in the global and chains
 * its push onto the previous one (installing and running a chunk's callback before calling the parent).
 * `cache: false` is a runtime built without __webpack_require__.c, like fast-connect and sentry.
 */
function loadRuntime(name: string, { cache, inline = {} }: { cache: boolean; inline?: Record<string, any>; }) {
    const m: Record<string, any> = { ...inline };
    const c: Record<string, any> = {};
    const installed: Record<PropertyKey, 0> = {};
    const req: any = (id: string) => {
        if (c[id]) return c[id].exports;
        const module = c[id] = { id, loaded: false, exports: {} };
        m[id].call(module.exports, module, module.exports, req);
        module.loaded = true;
        return module.exports;
    };
    Object.assign(req, { m, o: (o: object, k: PropertyKey) => Object.prototype.hasOwnProperty.call(o, k), d() { }, runtimeName: name });
    if (cache) req.c = c;
    const push = (parent: ((data: unknown) => void) | 0, data: [PropertyKey[], Record<string, any>, ((r: unknown) => void)?]) => {
        const [ids, factories, callback] = data;
        if (ids.some(id => installed[id] !== 0)) {
            Object.assign(m, factories);
            callback?.(req);
        }
        if (parent) parent(data);
        for (const id of ids) installed[id] = 0;
    };
    // The page's script element, while the runtime's file runs
    g.document.currentScript = { src: `https://discord.com/assets/${name}.0123456789abcdef.js` };
    const chunks = g.window.webpackChunkdiscord_app = g.window.webpackChunkdiscord_app || [];
    chunks.forEach(push.bind(null, 0));
    chunks.push = push.bind(null, chunks.push.bind(chunks));
    g.document.currentScript = null;
    /** Runs modules the way the runtime's entry does: through its own require */
    const run = (ids: string[]) => ids.forEach(id => req(id));
    return { req, run };
}

/** A chunk script: registers modules with every runtime loaded so far */
function pushChunk(factories: Record<string, any>) {
    (g.window.webpackChunkdiscord_app = g.window.webpackChunkdiscord_app || []).push([[`chunk${nextId++}`], factories]);
    return Object.keys(factories);
}

describe("main runtime", () => {
    test("discord.com's order: the app wins, never fast-connect or sentry, which have no module cache", async () => {
        const runtime = await freshPage();
        const polyfills = pushChunk(modules(5));
        const libdiscore = loadRuntime("libdiscore-wasm-fetch", { cache: true });
        libdiscore.run(polyfills.slice(0, 3));
        expect(runtime.wreq).toBe(libdiscore.req);

        const fastConnectModules = pushChunk(modules(20));
        const fastConnect = loadRuntime("fast-connect", { cache: false });
        fastConnect.run(fastConnectModules);
        const sentryModules = pushChunk(modules(40));
        const sentry = loadRuntime("sentry", { cache: false });
        sentry.run(sentryModules);
        // They ran more modules than libdiscore, but nothing can be found in a runtime without a cache
        expect(runtime.wreq).toBe(libdiscore.req);

        const appInline = modules(300);
        const app = loadRuntime("web", { cache: true, inline: appInline });
        expect(runtime.allRuntimes.size).toBe(4);
        app.run(Object.keys(appInline));
        expect(runtime.wreq).toBe(app.req);
        expect(Object.keys(runtime.wreq!.c).length).toBe(300);
    });

    test("the app's chunks never arriving leaves a runtime that can be searched, not a cacheless helper", async () => {
        const runtime = await freshPage();
        const libdiscore = loadRuntime("libdiscore-wasm-fetch", { cache: true });
        libdiscore.run(pushChunk(modules(2)));
        const sentry = loadRuntime("sentry", { cache: false });
        sentry.run(pushChunk(modules(30)));
        // The app's runtime loads, but its entry waits for chunks that failed to load
        loadRuntime("web", { cache: true, inline: modules(100) });
        expect(runtime.wreq).toBe(libdiscore.req);
        expect(typeof runtime.wreq!.c).toBe("object");
    });

    test("helpers that load after the app, and run modules later, never take over", async () => {
        const runtime = await freshPage();
        const appInline = modules(200);
        const app = loadRuntime("web", { cache: true, inline: appInline });
        app.run(Object.keys(appInline));
        expect(runtime.wreq).toBe(app.req);

        const late = loadRuntime("libdiscore-wasm-fetch", { cache: true });
        late.run(pushChunk(modules(150)));
        const lateNoCache = loadRuntime("sentry", { cache: false });
        lateNoCache.run(pushChunk(modules(250)));
        expect(runtime.wreq).toBe(app.req);
    });

    test("a helper that runs first is main only until the app has run more modules", async () => {
        const runtime = await freshPage();
        const appInline = modules(50);
        const app = loadRuntime("web", { cache: true, inline: appInline });
        const helper = loadRuntime("libdiscore-wasm-fetch", { cache: true });
        expect(runtime.wreq).toBe(app.req);
        helper.run(pushChunk(modules(10)));
        expect(runtime.wreq).toBe(helper.req);

        const ids = Object.keys(appInline);
        app.run(ids.slice(0, 10));
        expect(runtime.wreq).toBe(helper.req);
        app.run(ids.slice(10, 11));
        expect(runtime.wreq).toBe(app.req);
        // More of the helper's work later doesn't take it back while the app is ahead
        app.run(ids.slice(11));
        helper.run(pushChunk(modules(30)));
        expect(runtime.wreq).toBe(app.req);
    });

    test("with no module cache anywhere, the busiest runtime is still picked", async () => {
        const runtime = await freshPage();
        const a = loadRuntime("a", { cache: false });
        a.run(pushChunk(modules(3)));
        const b = loadRuntime("b", { cache: false });
        b.run(pushChunk(modules(5)));
        expect(runtime.wreq).toBe(b.req);
    });

    test("every runtime runs Evi's wrapped factories, whichever order they loaded in", async () => {
        const runtime = await freshPage();
        const seen: string[] = [];
        runtime.moduleListeners.add((_, id) => void seen.push(id));
        const early = pushChunk(modules(2));
        const helper = loadRuntime("libdiscore-wasm-fetch", { cache: true });
        const app = loadRuntime("web", { cache: true, inline: modules(1) });
        const late = pushChunk(modules(2));
        helper.run([early[0]]);
        app.run([early[1], ...late, ...Object.keys(app.req.m).filter(id => !early.includes(id) && !late.includes(id))]);
        expect(seen.sort()).toEqual([...early, ...late, ...Object.keys(app.req.m).filter(id => !early.includes(id) && !late.includes(id))].sort());
    });
});
