import { afterAll, beforeEach, expect, mock, test } from "bun:test";

const LAZY = "2026-02-lazy-load-all-images";
const NAMEPLATES = "2026-09-nameplate-video-preload-none";

/** Discord's ApexExperimentStore, as far as the plugin uses it: session overrides beat client ones */
const session: Record<string, { variantId: number; }> = {};
const client: Record<string, { variantId: number; }> = {};
const dispatched: string[] = [];
let lookups = 0;
const store = {
    getExperimentSessionOverride: (name: string) => session[name],
    getExperimentClientOverride: (name: string) => client[name],
};

// The rest of @evi/api stays real, and all of it comes back afterwards: other test files share the module
const real = { ...await import("@evi/api") };
afterAll(() => void mock.module("@evi/api", () => real));

mock.module("@evi/api", () => ({
    ...real,
    definePlugin: (plugin: unknown) => plugin,
    findStore: (name: string) => (lookups++, name === "ApexExperimentStore" ? store : undefined),
    Dispatcher: {
        dispatch(action: { type: string; experimentName: string; variantId?: number; }) {
            dispatched.push(`${action.type.replace("APEX_EXPERIMENT_SESSION_OVERRIDE_", "")} ${action.experimentName}`);
            if (action.type === "APEX_EXPERIMENT_SESSION_OVERRIDE_CREATE") session[action.experimentName] = { variantId: action.variantId! };
            else delete session[action.experimentName];
        },
    },
}));

const plugin: any = (await import("../plugins/experiments/index")).default;

const tick = () => new Promise(r => setTimeout(r, 5));

function start(values: Record<string, boolean>) {
    const listeners: (() => void)[] = [];
    const ctx = {
        settings: { get: (key: string) => values[key], onChange: (fn: () => void) => listeners.push(fn) },
        setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
        logger: console,
    };
    plugin.start(ctx);
    return { set: (key: string, on: boolean) => (values[key] = on, listeners.forEach(fn => fn())) };
}

beforeEach(async () => {
    plugin.stop();
    await tick();
    for (const o of [session, client]) for (const k in o) delete o[k];
    dispatched.length = 0;
    lookups = 0;
});

test("with both off, nothing is looked up or dispatched, even on Flux events", async () => {
    start({ lazyImages: false, stillNameplates: false });
    plugin.flux.CONNECTION_OPEN();
    await tick();
    expect(lookups).toBe(0);
    expect(dispatched).toEqual([]);
});

test("turning one on sets only that experiment, once; turning it off takes it back", async () => {
    const s = start({ lazyImages: false, stillNameplates: false });
    s.set("lazyImages", true);
    s.set("lazyImages", true);
    expect(dispatched).toEqual([`CREATE ${LAZY}`]);
    s.set("lazyImages", false);
    expect(dispatched).toEqual([`CREATE ${LAZY}`, `DELETE ${LAZY}`]);
});

test("set again after Discord wipes session overrides, once the dispatch is over", async () => {
    start({ lazyImages: true, stillNameplates: true });
    await tick();
    expect(dispatched).toEqual([`CREATE ${LAZY}`, `CREATE ${NAMEPLATES}`]);
    delete session[LAZY];
    delete session[NAMEPLATES];
    plugin.flux.CONNECTION_OPEN_STATE_UPDATE();
    expect(dispatched.length).toBe(2);
    await tick();
    expect(dispatched).toEqual([`CREATE ${LAZY}`, `CREATE ${NAMEPLATES}`, `CREATE ${LAZY}`, `CREATE ${NAMEPLATES}`]);
});

test("an experiment the user set in the Experiments tab is left alone", async () => {
    client[NAMEPLATES] = { variantId: 0 };
    start({ lazyImages: true, stillNameplates: true });
    await tick();
    expect(dispatched).toEqual([`CREATE ${LAZY}`]);
    // Set while ours is on: ours goes, so theirs counts
    client[LAZY] = { variantId: 0 };
    plugin.flux.APEX_EXPERIMENT_OVERRIDE_CREATE();
    await tick();
    expect(dispatched).toEqual([`CREATE ${LAZY}`, `DELETE ${LAZY}`]);
});

test("stopping takes back only what the plugin set", async () => {
    session[NAMEPLATES] = { variantId: 1 };
    start({ lazyImages: true, stillNameplates: true });
    await tick();
    expect(dispatched).toEqual([`CREATE ${LAZY}`]);
    plugin.stop();
    await tick();
    expect(dispatched).toEqual([`CREATE ${LAZY}`, `DELETE ${LAZY}`]);
    expect(session[NAMEPLATES]).toEqual({ variantId: 1 });
});
