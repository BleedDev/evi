/**
 * Live module replacement: apply source patch changes to modules that already ran, without a reload.
 *
 * A module that already executed is re-run with the current set of patches, into a fresh module
 * object. Its new exports are then moved into the *existing* exports object. Discord's code reads
 * imports through that object at call time (`(0, r.A)(...)`), so every importer switches to the
 * patched code at once. Export hooks on the old values are carried over to the new ones.
 *
 * Re-running a module is only safe when running it twice has no lasting side effects, so modules
 * are checked first and anything unsafe falls back to "reload required":
 *   - exports that aren't a plain object (a bare function can't be swapped in place)
 *   - exports holding a Flux store (a second instance would double-register and lose state)
 *   - modules that subscribe to Flux actions when they run: detected by diffing the dispatcher's
 *     subscriptions around the re-run, and the new subscriptions are removed again
 * Patches can override the check with `live: true` / `live: false`.
 */
import { Logger } from "../logger";
import { Dispatcher, React } from "../webpack/common";
import { getOriginalFactory, Module, wreq } from "../webpack/runtime";
import { rebaseHooks } from "./hooks";
import { applySourcePatches, getPatchRecords, matchesFind, refixCorePatches, SourcePatch } from "./source";

export interface LiveOutcome {
    id: string;
    ok: boolean;
    reason?: string;
}

const logger = new Logger("LiveReplace", "#e0af68");

function isStore(value: any) {
    try {
        return !!value && typeof value === "object" && "_dispatchToken" in value;
    } catch {
        return false;
    }
}

/** Every patch currently registered that targets this module */
function patchesFor(source: string): SourcePatch[] {
    return getPatchRecords().map(r => r.patch).filter(p => matchesFind(source, p.find));
}

function unsafeReason(module: Module, patches: SourcePatch[]): string | undefined {
    if (patches.some(p => p.live === false)) return "a patch opted out of live replacement";
    if (patches.some(p => p.live === true)) return;

    const { exports } = module;
    if (!exports || typeof exports !== "object") return "its exports can't be swapped in place";
    for (const key of Object.keys(exports)) {
        let value;
        try {
            value = exports[key];
        } catch {
            continue;
        }
        if (isStore(value)) return "it defines a Flux store";
    }
}

type SubscriptionSnapshot = Map<string, Set<Function>>;

function snapshotSubscriptions(): SubscriptionSnapshot | undefined {
    const subs = (Dispatcher as any)._subscriptions as Record<string, Set<Function>> | undefined;
    if (!subs) return;
    return new Map(Object.entries(subs).map(([type, set]) => [type, new Set(set)]));
}

/** Removes subscriptions added since the snapshot, returns how many there were */
function revertNewSubscriptions(before: SubscriptionSnapshot) {
    const subs = (Dispatcher as any)._subscriptions as Record<string, Set<Function>>;
    let added = 0;
    for (const [type, set] of Object.entries(subs)) {
        const old = before.get(type);
        for (const handler of [...set]) {
            if (old?.has(handler)) continue;
            added++;
            Dispatcher.unsubscribe(type, handler as any);
        }
    }
    return added;
}

/** Moves `fresh` exports into `target`, keeping the target object's identity */
function transplant(target: any, fresh: any) {
    const oldValues = new Map<PropertyKey, unknown>();
    for (const key of Reflect.ownKeys(target)) {
        try {
            oldValues.set(key, target[key]);
        } catch { }
    }

    for (const key of Reflect.ownKeys(fresh)) {
        const desc = Reflect.getOwnPropertyDescriptor(fresh, key)!;
        try {
            Object.defineProperty(target, key, { ...desc, configurable: true });
        } catch {
            // __esModule and toStringTag are defined non-configurable, and identical anyway
        }
    }
    for (const key of Reflect.ownKeys(target)) {
        if (!Reflect.has(fresh, key)) {
            try {
                delete target[key];
            } catch { }
        }
    }

    rebaseHooks(target, oldValues);
}

function replaceModule(id: string, removed: SourcePatch[]): LiveOutcome {
    const req = wreq!;
    const module = req.c[id];
    if (!module) return { id, ok: true };

    const original = getOriginalFactory(req.m[id]);
    if (!original) return { id, ok: false, reason: "its factory is gone" };
    const source = Function.prototype.toString.call(original);

    const reason = unsafeReason(module, [...patchesFor(source), ...removed.filter(p => matchesFind(source, p.find))]);
    if (reason) return { id, ok: false, reason };

    const { factory } = applySourcePatches(id, original, () => source, true);
    const fresh: Module = { id, loaded: false, exports: {} };
    const subscriptions = snapshotSubscriptions();

    try {
        factory.call(fresh.exports, fresh, fresh.exports, req);
    } catch (err) {
        logger.error(`Re-running module ${id} threw`, err);
        // What the half-run copy subscribed before it threw would handle every action next to the real module's
        if (subscriptions) revertNewSubscriptions(subscriptions);
        return { id, ok: false, reason: `re-running it threw: ${err}` };
    }

    if (subscriptions) {
        const added = revertNewSubscriptions(subscriptions);
        if (added) return { id, ok: false, reason: `it subscribes to ${added} Flux action(s) when it runs` };
    }

    if (!fresh.exports || typeof fresh.exports !== "object") {
        return { id, ok: false, reason: "its new exports can't be swapped in place" };
    }

    transplant(module.exports, fresh.exports);
    return { id, ok: true };
}

/** Loaded modules that any of these patches target */
export function loadedModulesMatching(patches: SourcePatch[]): string[] {
    if (!wreq || !patches.length) return [];
    const ids: string[] = [];
    for (const id in wreq.c) {
        const factory = getOriginalFactory(wreq.m[id]);
        if (!factory) continue;
        // Not cached: a slice of the script's source, about as cheap as a lookup, and nothing is kept
        const source = Function.prototype.toString.call(factory);
        if (patches.some(p => matchesFind(source, p.find))) ids.push(id);
    }
    return ids;
}

/**
 * Re-runs these already-loaded modules with the currently registered patches.
 * Returns one outcome per module; anything not ok needs a Discord reload.
 *
 * @param removed  patches just unregistered: their `live` still decides for the modules they patched
 */
export function replaceLive(ids: Iterable<string>, removed: SourcePatch[] = []): LiveOutcome[] {
    const outcomes = [...new Set(ids)].map(id => replaceModule(id, removed));
    const replaced = outcomes.filter(o => o.ok).length;
    if (replaced) {
        logger.info(`Live-replaced ${replaced} module(s)`);
        refreshReactTree();
    }
    return outcomes;
}

/**
 * Evi's hotfix for itself changed (coreHotfix.ts): its patches whose fix changed are registered again,
 * and the loaded modules the old or new ones touch re-run with them. Anything not ok gets the fix
 * when Discord next starts.
 */
export function applyCorePatchFixes(): LiveOutcome[] {
    const { replaced, patches } = refixCorePatches();
    if (!wreq || !replaced.length) return [];
    const affected = new Set([...replaced.flatMap(r => r.modules).filter(m => wreq!.c[m]), ...loadedModulesMatching(patches)]);
    return affected.size ? replaceLive(affected, replaced.map(r => r.patch)) : [];
}

/**
 * Re-renders mounted class components so UI built from replaced modules updates now instead of on
 * its next natural render. Memoized subtrees with unchanged props still wait for their next update.
 */
export function refreshReactTree() {
    const container = document.getElementById("app-mount");
    const key = container && Object.keys(container).find(k => k.startsWith("__reactContainer$"));
    let fiber = key ? (container as any)[key] : undefined;
    if (!fiber) return;

    const components: React.Component[] = [];
    const stack = [fiber];
    let visited = 0;
    while (stack.length && visited++ < 50_000) {
        fiber = stack.pop();
        if (fiber.stateNode instanceof React.Component) components.push(fiber.stateNode);
        if (fiber.sibling) stack.push(fiber.sibling);
        if (fiber.child) stack.push(fiber.child);
    }
    // As a transition: re-rendering all of Discord at once froze it for a moment on every plugin
    // toggle. This way React renders it in slices and keeps clicks and scrolling going in between.
    React.startTransition(() => {
        for (const component of components) {
            try {
                component.forceUpdate();
            } catch { }
        }
    });
}
