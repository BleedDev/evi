import * as api from "@evi/api";
import { BootPlugin, EviSettings, isPluginEnabled, PluginChange, PluginManifest, PluginPayload } from "@shared/ipc";
import { applyPatchFixes, Hotfix, hotfixFor, hotfixTag } from "@shared/hotfixes";
import { localizePlugin } from "@shared/pluginLocales";
import { PulledPlugin, PulledPlugins, pullFor } from "@shared/pulls";

import { I18n } from "../i18n";
import { Logger } from "../logger";
import { Native } from "../native";
import { loadedModulesMatching, replaceLive } from "../patching/live";
import { getPatchRecords, registerPatches, SourcePatch, unregisterPatches } from "../patching/source";
import { Perf } from "../perf";
import * as JsxRuntime from "../react/jsx-runtime";
import { SafeMode } from "../safeMode";
import { Settings } from "../settings";
import { React, ReactDOM } from "../webpack/common";
import { wreq } from "../webpack/runtime";
import { PluginActivity } from "./activity";
import { grantNative, PluginContext } from "./context";
import { PluginGuard } from "./guard";
import { AppliedHotfixes } from "./hotfixes";
import type { PluginDefinition } from "./types";

export interface PluginState {
    manifest: PluginManifest;
    source: PluginPayload["source"];
    definition?: PluginDefinition;
    ctx?: PluginContext;
    running: boolean;
    /** Evaluation or start error */
    error?: string;
    /** Source patch changes that couldn't be applied live, see patching/live.ts */
    needsReload: boolean;
    reloadReason?: string;
    patchesRegistered: boolean;
    /** The renderer bundle as loaded, scanned for what the plugin can touch (ui/PluginPermissions.tsx) */
    code?: string;
    /**
     * Evi turned this version off on every install (shared/pulls.ts). It doesn't run whatever its
     * switch says, and the switch is left alone: it runs again once the pull is lifted or a version
     * that isn't pulled is installed.
     */
    pulled?: PulledPlugin;
    /**
     * Evi's fix for this version after a Discord update broke it (shared/hotfixes.ts), in its patches
     * and lookups since it last started. One Evi withdraws stays until the plugin next starts.
     */
    hotfix?: Hotfix;
}

const logger = new Logger("Plugins", "#ff6fae");
const plugins = new Map<string, PluginState>();
const listeners = new Set<() => void>();
let snapshot: PluginState[] = [];
let ready = false;
let pulls: PulledPlugins = {};
let hotfixes: Hotfix[] = [];

/** Manifests as they came: `manifest` is in Discord's language, which can change after they load */
const rawManifests = new WeakMap<PluginState, PluginManifest>();
let followingLocale = false;

function setManifest(state: PluginState, manifest: PluginManifest) {
    rawManifests.set(state, manifest);
    state.manifest = localizePlugin(manifest, I18n.discordLocale);
    if (followingLocale) return;
    followingLocale = true;
    I18n.subscribe(() => {
        for (const p of plugins.values()) {
            const raw = rawManifests.get(p);
            if (raw) p.manifest = localizePlugin(raw, I18n.discordLocale);
        }
        emit();
    });
}

function emit() {
    snapshot = [...plugins.values()].sort((a, b) => a.manifest.name.localeCompare(b.manifest.name));
    for (const listener of listeners) listener();
}

const requireMap: Record<string, unknown> = {
    "@evi/api": api,
    // Plugins built before the rename to Evi
    "@delight/api": api,
    "react": React,
    "react-dom": ReactDOM,
    "react/jsx-runtime": JsxRuntime,
    "react/jsx-dev-runtime": JsxRuntime,
};

function evaluate({ manifest, code }: Pick<PluginPayload, "manifest" | "code">): PluginDefinition {
    const module = { exports: {} as any };
    // Held to the permissions it declares, in its own copy of the API and its network globals (guard.ts)
    const guard = new PluginGuard(manifest);
    const scopedApi = guard.api();
    const require = (name: string) => {
        if (name === "@evi/api" || name === "@delight/api") return scopedApi;
        if (name in requireMap) return requireMap[name];
        throw new Error(`${manifest.id} tried to require "${name}". Only @evi/api and react are provided, bundle anything else.`);
    };

    // Its own fetch, XMLHttpRequest, WebSocket and EventSource, which note what it contacts (activity.ts)
    // and refuse what it doesn't declare. They're an outer function's parameters so a bundle declaring
    // its own `const fetch` still evaluates, and the wrapper starts on the bundle's first line so stack
    // line numbers don't move.
    const net = PluginActivity.networkScope(manifest.id, guard.checkRequest);
    const outer = new Function("fetch", "XMLHttpRequest", "WebSocket", "EventSource", `return function (module, exports, require) {${code}\n};\n//# sourceURL=evi://plugins/${manifest.id}.js`);
    const fn = outer(net.fetch, net.XMLHttpRequest, net.WebSocket, net.EventSource);
    fn(module, module.exports, require);

    const definition = module.exports?.default ?? module.exports;
    if (!definition || typeof definition !== "object") throw new Error("Plugin has no default export");
    return definition;
}

interface Deferred {
    code?: string;
    definition?: PluginDefinition;
    evaluated: boolean;
}
const deferred = new WeakMap<PluginState, Deferred>();

/**
 * A plugin's code and definition, read on first use rather than when it loads: most installed plugins
 * are off, and evaluating them all at every start cost more than anything else plugins did then. Code
 * the boot data left out (main/plugins.ts getBootPlugins) comes from main. Turning a plugin on reads
 * its definition (enablePatches), and so does anything showing its settings or permissions. Safe mode
 * never evaluates. Assigning either one keeps what's assigned.
 */
function defer(state: PluginState, code: string | undefined) {
    const lazy: Deferred = { code, evaluated: false };
    deferred.set(state, lazy);
    // Not enumerable: spreading a state (publicState) doesn't evaluate it
    Object.defineProperties(state, {
        code: {
            configurable: true,
            get: () => lazy.code ??= Native.pluginCode?.(state.manifest.id) ?? undefined,
            set: (value: string | undefined) => void (lazy.code = value),
        },
        definition: {
            configurable: true,
            get: () => {
                if (!lazy.evaluated && !SafeMode.active) {
                    lazy.evaluated = true;
                    lazy.definition = evaluateDeferred(state);
                }
                return lazy.definition;
            },
            set: (value: PluginDefinition | undefined) => {
                lazy.evaluated = true;
                lazy.definition = value;
            },
        },
    });
}

function evaluateDeferred(state: PluginState) {
    const manifest = rawManifests.get(state) ?? state.manifest;
    try {
        const { code } = state;
        if (code === undefined) throw new Error(`${manifest.id}'s code isn't available`);
        return evaluate({ manifest, code });
    } catch (err) {
        logger.error(`Failed to evaluate ${manifest.id}`, err);
        state.error = String(err);
        // Possibly read while React renders: listeners hear about it after
        queueMicrotask(emit);
    }
}

function patchesSignature(patches: SourcePatch[] | undefined) {
    return JSON.stringify(patches ?? [], (_, v) => v instanceof RegExp || typeof v === "function" ? String(v) : v);
}

/**
 * Swaps a plugin's registered source patches for `next` (undefined = none), then live-replaces every
 * already-loaded module that the old or new patches touch, in a single re-run per module.
 */
function setPatches(state: PluginState, next: SourcePatch[] | undefined) {
    const { id } = state.manifest;
    const previous = state.patchesRegistered ? getPatchRecords(id) : [];
    const previouslyPatched = previous.flatMap(r => r.modules);

    if (state.patchesRegistered) unregisterPatches(id);
    state.patchesRegistered = !!next?.length;
    if (next?.length) registerPatches(id, next);

    // Before webpack exists (boot) nothing has run yet, patches simply apply as modules load
    if (!wreq) return;
    const affected = new Set([...previouslyPatched.filter(m => wreq!.c[m]), ...loadedModulesMatching(next ?? [])]);
    if (!affected.size) return;

    // The old patches' live: false (or true) still counts for the modules they patched
    const failures = replaceLive(affected, previous.map(r => r.patch)).filter(o => !o.ok);
    if (failures.length) {
        state.needsReload = true;
        state.reloadReason = [...new Set(failures.map(f => f.reason))].join(", ");
        logger.warn(`${state.manifest.name} needs a reload`, failures);
    }
}

function enablePatches(state: PluginState) {
    if (state.patchesRegistered) return;
    // A start from off takes Evi's fixes as they are now: a withdrawn one isn't applied again
    if (!state.running) takeHotfix(state, hotfixOf(state));
    setPatches(state, patchesOf(state));
}

function disablePatches(state: PluginState) {
    if (state.patchesRegistered) setPatches(state, undefined);
}

/** The pull that keeps this plugin off, if any. Dev builds are the developer's own and never pulled. */
function pullOf({ manifest, source }: Pick<PluginState, "manifest" | "source">) {
    return source === "dev" ? undefined : pullFor(pulls, manifest.id, manifest.version);
}

/** Evi's fix for this plugin's version, if any. Dev builds are the developer's own, like with pulls. */
function hotfixOf({ manifest, source }: Pick<PluginState, "manifest" | "source">) {
    return source === "dev" ? undefined : hotfixFor(hotfixes, manifest.id, manifest.version);
}

const tagOf = (hotfix: Hotfix | undefined) => hotfix ? hotfixTag(hotfix) : "";

/** What the plugin runs with from now on: its patches and, through its context, its lookups */
function takeHotfix(state: PluginState, hotfix: Hotfix | undefined) {
    state.hotfix = hotfix;
    AppliedHotfixes.set(state.manifest.id, hotfix);
}

/** The plugin's source patches with Evi's fixes in place. Its definition keeps its own. */
function patchesOf(state: PluginState): SourcePatch[] | undefined {
    return applyPatchFixes(state.definition?.patches, state.hotfix);
}

/** Turned on, and not pulled by Evi */
function shouldRun(state: PluginState, settings = Settings.data) {
    return isPluginEnabled(settings, state.manifest) && !state.pulled;
}

async function start(state: PluginState) {
    const { definition } = state;
    if (!definition || state.running) return;

    const ctx = new PluginContext(state.manifest, definition.settings ?? {});
    if (state.manifest.native) grantNative(ctx);
    state.ctx = ctx;
    state.running = true;
    state.error = undefined;

    try {
        if (definition.css) ctx.addStyle(definition.css);
        for (const [type, handler] of Object.entries(definition.flux ?? {})) ctx.flux.subscribe(type, handler.bind(definition));
        // Only until start() returns: an async start's awaits don't hold up Discord
        const startSite = Perf.site(state.manifest.id, "start", "start()");
        const began = Perf.begin(startSite);
        let started: void | Promise<void>;
        try {
            started = definition.start?.(ctx);
        } finally {
            Perf.end(startSite, began);
        }
        await started;
        // Turned off or reloaded while it awaited: this run is over, its context undid everything
        if (state.ctx !== ctx) return;
        logger.info(`Started ${state.manifest.name}`);
    } catch (err) {
        logger.error(`Failed to start ${state.manifest.name}`, err);
        // Only this run's error: a later one (turned off and on while it awaited) keeps going
        if (state.ctx !== ctx) return;
        state.error = String(err);
        stop(state);
    }
    emit();
}

function stop(state: PluginState) {
    const { definition, ctx } = state;
    if (!ctx) return;

    try {
        definition?.stop?.(ctx);
    } catch (err) {
        logger.error(`${state.manifest.name} threw while stopping`, err);
    }
    ctx.dispose();
    state.ctx = undefined;
    state.running = false;
}

function load(payload: BootPlugin): PluginState {
    const state: PluginState = {
        manifest: payload.manifest,
        source: payload.source,
        running: false,
        needsReload: false,
        patchesRegistered: false,
    };
    setManifest(state, payload.manifest);
    state.pulled = pullOf(state);
    defer(state, payload.code);
    plugins.set(payload.manifest.id, state);
    // Evaluated now, before Discord's code, so its patches apply as modules first load. Safe mode lists
    // plugins so they can be turned off, but never runs their code, not even top-level.
    if (!SafeMode.active && shouldRun(state)) enablePatches(state);
    return state;
}

function upsert(payload: PluginPayload) {
    const { id } = payload.manifest;
    const previous = plugins.get(id);
    // A pulled version stays off; a newer one that isn't pulled runs like any other
    const pulled = pullOf(payload);
    const enabled = isPluginEnabled(Settings.data, payload.manifest) && !pulled;

    if (SafeMode.active) {
        if (previous) {
            Object.assign(previous, { code: payload.code, pulled });
            setManifest(previous, payload.manifest);
        }
        else load(payload);
        return emit();
    }

    if (!previous) {
        const state = load(payload);
        if (ready && enabled) start(state);
        return emit();
    }

    stop(previous);
    if (!enabled && !previous.patchesRegistered) {
        // Nothing of it runs: the new code is evaluated once something needs it, like at boot
        setManifest(previous, payload.manifest);
        defer(previous, payload.code);
        previous.error = undefined;
        previous.pulled = pulled;
        takeHotfix(previous, hotfixOf(previous));
        logger.info(`Hot reloaded ${payload.manifest.name}`);
        return emit();
    }

    const sameShape = patchesSignature(patchesOf(previous));
    const hadPatches = previous.patchesRegistered;

    let definition: PluginDefinition | undefined;
    try {
        definition = evaluate(payload);
    } catch (err) {
        logger.error(`Failed to reload ${id}`, err);
        previous.error = String(err);
        return emit();
    }

    setManifest(previous, payload.manifest);
    previous.code = payload.code;
    previous.definition = definition;
    previous.error = undefined;
    previous.pulled = pulled;
    // A new version may have no fix, or its own
    takeHotfix(previous, hotfixOf(previous));

    // Unchanged patches keep their records; modules patched earlier call $self, which now resolves to the new definition
    if (patchesSignature(patchesOf(previous)) !== sameShape && (hadPatches || enabled)) {
        setPatches(previous, enabled ? patchesOf(previous) : undefined);
    } else if (enabled) {
        // The version it replaces was pulled, so its patches were off
        enablePatches(previous);
    } else {
        // This version is pulled
        disablePatches(previous);
    }

    if (ready && enabled) start(previous);
    logger.info(`Hot reloaded ${payload.manifest.name}`);
    emit();
}

function remove(id: string) {
    const state = plugins.get(id);
    if (!state) return;
    stop(state);
    disablePatches(state);
    plugins.delete(id);
    emit();
}

/** How long startAll waits for async starts to finish */
const START_WAIT_MS = 10_000;

/** Native code or Chromium switches: turning it on takes the user's yes in main (main/index.ts) */
const reachesBeyondPage = ({ native, chromiumSwitches }: PluginManifest) => !!native || Object.keys(chromiumSwitches ?? {}).length > 0;

async function applyEnabled(state: PluginState, enabled: boolean) {
    const { manifest } = state;

    if (enabled) {
        // On disk before any of its code runs: if it crashes Discord, safe mode can name it. And main
        // starts a native side only for a plugin its own copy of the settings has on, so that goes first.
        if (!reachesBeyondPage(manifest)) Settings.flush();
        else if ((await Settings.save()).includes(manifest.id)) {
            logger.info(`${manifest.name} stays off: turning it on wasn't confirmed`);
            return;
        }
        if (manifest.native) Native.setNativeRunning(manifest.id, true);
        enablePatches(state);
        if (ready) await start(state);
    } else {
        stop(state);
        disablePatches(state);
        if (manifest.native) {
            // Main refuses calls to a native side that's off in its settings: tell it now (after the
            // plugin's own stop had its last calls), not when the debounced save gets there
            Settings.flush();
            Native.setNativeRunning(manifest.id, false);
        }
    }
}

export const PluginManager = {
    /** Evaluate enabled plugins and register their source patches. Runs before Discord's code. */
    boot(payloads: BootPlugin[], pulled: PulledPlugins = {}, fixes: Hotfix[] = []) {
        pulls = pulled;
        // Before any patch registers, so fixed patches apply as Discord's modules first load
        hotfixes = fixes;
        for (const payload of payloads) load(payload);
        Native.onPluginChange((change: PluginChange) => {
            if (change.type === "upsert") upsert(change.plugin);
            else remove(change.id);
        });
        Native.onPullsChange?.(next => void PluginManager.setPulls(next));
        Native.onHotfixesChange?.(next => void PluginManager.setHotfixes(next));
        emit();
    },

    /**
     * Start enabled plugins, once Discord's core modules exist. Resolves when they've all started, or
     * after START_WAIT_MS if an async start is still going.
     */
    async startAll() {
        ready = true;
        if (SafeMode.active) return emit();
        // Side by side: an async start that waits (a lookup Discord removed, a slow fetch) doesn't hold up
        // the plugins after it, and the healthy-start report only so long: starts without one end in safe mode
        const starts = [...plugins.values()].filter(state => shouldRun(state)).map(state => start(state));
        let timer: ReturnType<typeof setTimeout> | undefined;
        await Promise.race([Promise.allSettled(starts), new Promise(resolve => timer = setTimeout(resolve, START_WAIT_MS))]);
        clearTimeout(timer);
        emit();
    },

    async setEnabled(id: string, enabled: boolean) {
        const state = plugins.get(id);
        if (!state) return;

        Settings.update(d => void ((d.plugins[id] ??= {}).enabled = enabled));
        // Only remembered in safe mode, it applies once the user leaves it
        if (SafeMode.active) return emit();
        // Remembered for a pulled plugin too: it applies once the pull is lifted
        await applyEnabled(state, shouldRun(state));
        emit();
    },

    /** Starts and stops plugins to match settings that were replaced wholesale (a restored backup) */
    async syncEnabled(previous: EviSettings) {
        if (SafeMode.active) return emit();
        for (const state of plugins.values()) {
            const enabled = shouldRun(state);
            if (enabled !== shouldRun(state, previous)) await applyEnabled(state, enabled);
        }
        emit();
    },

    /**
     * Evi pulled plugins or lifted pulls (main heard from evi.rest): newly pulled ones stop right away,
     * ones no longer pulled start again if they're turned on. Nobody's switch changes.
     */
    async setPulls(next: PulledPlugins) {
        if (JSON.stringify(next) === JSON.stringify(pulls)) return;
        pulls = next;
        for (const state of plugins.values()) {
            const was = state.pulled;
            state.pulled = pullOf(state);
            if (!was === !state.pulled) continue;
            if (state.pulled) logger.warn(`Evi turned ${state.manifest.name} off: ${state.pulled.reason}`);
            else logger.info(`Evi lifted the pull on ${state.manifest.name}`);
            if (SafeMode.active || !isPluginEnabled(Settings.data, state.manifest)) continue;
            await applyEnabled(state, !state.pulled);
        }
        emit();
    },

    /**
     * Evi's hotfixes changed (main heard from evi.rest). A plugin that's on and has a new or changed
     * fix restarts with it, like a hot reload: its fixed patches re-run the modules they touch that
     * already loaded (or ask for a reload when one can't run twice), and its lookups look again. A
     * withdrawn fix stays in a running plugin until it next starts: pulling it out now could break
     * what it's fixing mid-session.
     */
    async setHotfixes(next: Hotfix[]) {
        if (JSON.stringify(next) === JSON.stringify(hotfixes)) return;
        hotfixes = next;
        for (const state of plugins.values()) {
            const fix = hotfixOf(state);
            if (tagOf(fix) === tagOf(state.hotfix)) continue;
            const active = state.running || state.patchesRegistered;
            if (!active || SafeMode.active) {
                // Nothing of it runs: the fix is simply there when it starts
                takeHotfix(state, fix);
                continue;
            }
            if (!fix) continue;
            logger.info(`Evi fixed ${state.manifest.name} for Discord's latest update (hotfix ${hotfixTag(fix)}): ${fix.note}`);
            const wasRunning = state.running;
            stop(state);
            const before = patchesSignature(patchesOf(state));
            takeHotfix(state, fix);
            if (patchesSignature(patchesOf(state)) !== before) setPatches(state, patchesOf(state));
            if (ready && wasRunning) await start(state);
        }
        emit();
    },

    /** What Evi pulled, by plugin id */
    pulls: () => pulls,

    get(id: string) {
        return plugins.get(id);
    },

    /** The plugin once main has announced it, or undefined if it doesn't arrive within `timeoutMs` */
    whenLoaded(id: string, timeoutMs = 5000): Promise<PluginState | undefined> {
        const loaded = plugins.get(id);
        if (loaded) return Promise.resolve(loaded);
        return new Promise(resolve => {
            const done = () => {
                clearTimeout(timer);
                listeners.delete(check);
                resolve(plugins.get(id));
            };
            const check = () => void (plugins.has(id) && done());
            const timer = setTimeout(done, timeoutMs);
            listeners.add(check);
        });
    },

    /** Stable snapshot for React's useSyncExternalStore */
    getSnapshot: () => snapshot,

    subscribe(listener: () => void) {
        listeners.add(listener);
        return () => void listeners.delete(listener);
    },

    /** Target of $self in source patches: the definition, its functions measured (perf.ts) */
    self(id: string) {
        const definition = plugins.get(id)?.definition;
        return definition && Perf.measuredSelf(id, definition);
    },
};

/** A plugin's state as page code sees it: without its context, definition or code */
export type PublicPluginState = Omit<PluginState, "ctx" | "definition" | "code"> & { evaluated: boolean; };
const publicState = (state: PluginState | undefined): PublicPluginState | undefined => {
    if (!state) return undefined;
    // Code and definition aren't enumerable (defer): the spread leaves them out without evaluating anything
    const { ctx: _ctx, ...rest } = state;
    return { ...rest, evaluated: !!deferred.get(state)?.definition };
};

/**
 * `window.Evi.plugins`. Every plugin shares the page with every other, so what's here is what any of
 * them can reach: never a context (its native bridge, settings, patches) or a definition.
 */
export const PublicPlugins = {
    get: (id: string) => publicState(PluginManager.get(id)),
    whenLoaded: (id: string, timeoutMs?: number) => PluginManager.whenLoaded(id, timeoutMs).then(publicState),
    getSnapshot: () => PluginManager.getSnapshot().map(s => publicState(s)!),
    subscribe: PluginManager.subscribe,
    setEnabled: PluginManager.setEnabled,
    pulls: PluginManager.pulls,
};
