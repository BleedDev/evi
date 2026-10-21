import { definePlugin, Dispatcher, findStore } from "@evi/api";
import type { PluginContext } from "@evi/api";

import { t } from "./strings";

const settings = {
    lazyImages: {
        type: "boolean",
        get label() { return t("settings.lazyImages"); },
        get description() { return t("settings.lazyImages.description"); },
        default: false,
    },
    stillNameplates: {
        type: "boolean",
        get label() { return t("settings.stillNameplates"); },
        get description() { return t("settings.stillNameplates.description"); },
        default: false,
    },
} as const;

/**
 * Two of Discord's own apex experiments, off by default, that hold less in memory. Checked against
 * Discord's code on 2026-10-21:
 * - LazyImage reads 2026-02-lazy-load-all-images on mount: variant 1 waits for its IntersectionObserver
 *   instead of preloading every image in the message window.
 * - Nameplates read 2026-09-nameplate-video-preload-none on render: variant 1 gives their <video>
 *   preload "none" instead of "auto".
 * Neither has anything to do with calls, voice or streaming.
 *
 * Turned on as session overrides (APEX_EXPERIMENT_SESSION_OVERRIDE_CREATE): never saved, no exposure
 * tracked. They beat the Experiments tab's own overrides, so an experiment the user set there is left
 * alone. Discord wipes session overrides when assignments arrive (connecting, a fetch) and on logout,
 * so they're applied again after those, once the dispatch is over: dispatching inside one throws.
 */
const EXPERIMENTS = {
    lazyImages: "2026-02-lazy-load-all-images",
    stillNameplates: "2026-09-nameplate-video-preload-none",
} as const satisfies Record<keyof typeof settings, string>;
const VARIANT = 1;

let ctx: PluginContext<typeof settings> | undefined;
/** Session overrides made here: only these are ever taken back */
const ours = new Set<string>();

function dispatch(action: { type: string; experimentName: string; variantId?: number; }) {
    try {
        void Promise.resolve(Dispatcher.dispatch(action as any)).catch(() => { });
    } catch (e) {
        ctx?.logger.warn("Couldn't set an experiment", e);
    }
}

const wanted = () => !!ctx && Object.keys(EXPERIMENTS).some(key => ctx!.settings.get(key as keyof typeof EXPERIMENTS));

/** Makes Discord's session overrides match the settings. With both off and nothing set here, does nothing. */
function apply() {
    if (!ours.size && !wanted()) return;
    const store = findStore("ApexExperimentStore");
    if (typeof store?.getExperimentSessionOverride !== "function") return;
    for (const key of Object.keys(EXPERIMENTS) as (keyof typeof EXPERIMENTS)[]) {
        const name = EXPERIMENTS[key];
        const want = !!ctx?.settings.get(key) && !store.getExperimentClientOverride?.(name);
        const set = store.getExperimentSessionOverride(name)?.variantId === VARIANT;
        if (want) {
            if (set) continue;
            dispatch({ type: "APEX_EXPERIMENT_SESSION_OVERRIDE_CREATE", experimentName: name, variantId: VARIANT });
            ours.add(name);
        } else if (ours.delete(name) && set) {
            dispatch({ type: "APEX_EXPERIMENT_SESSION_OVERRIDE_DELETE", experimentName: name });
        }
    }
}

/** From a Flux handler: after the dispatch, and only when there's something to keep in sync */
function later() {
    if (ctx && (ours.size || wanted())) ctx.setTimeout(apply, 0);
}

/**
 * Source patch example. DeveloperExperimentStore defines
 *     Object.defineProperties(this, { isDeveloper: { configurable: !1, get: () => c, ... } })
 * and we make that getter return true.
 */
export default definePlugin({
    settings,

    patches: [
        {
            find: "Object.defineProperties(this,{isDeveloper",
            replace: {
                match: /(?<=isDeveloper:\{[^}]*?get:\(\)=>)\i/,
                with: "true",
            },
        },
    ],

    flux: {
        // These wipe session overrides
        CONNECTION_OPEN: later,
        CONNECTION_OPEN_STATE_UPDATE: later,
        APEX_EXPERIMENTS_FETCH_SUCCESS: later,
        APEX_EXPERIMENT_CLEAR_FOR_TESTS: later,
        LOGOUT: later,
        // The user setting (or clearing) an experiment in the Experiments tab
        APEX_EXPERIMENT_OVERRIDE_CREATE: later,
        APEX_EXPERIMENT_OVERRIDE_DELETE: later,
        APEX_EXPERIMENT_OVERRIDE_CLEAR: later,
    },

    start(context) {
        ctx = context;
        context.setTimeout(apply, 0);
        context.settings.onChange(() => apply());
    },

    stop() {
        ctx = undefined;
        // Nothing is wanted now: takes back only what was set here, outside any dispatch
        if (ours.size) setTimeout(apply, 0);
    },
});
