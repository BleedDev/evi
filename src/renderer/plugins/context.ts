import type { PluginManifest } from "@shared/ipc";
import type { ReactNode } from "react";

import { Keybinds } from "../keybinds";
import { Logger } from "../logger";
import { Native } from "../native";
import { ProfileBadgeProvider, ProfileBadges } from "../profileBadges";
import { hook, HookCallback, HookKind } from "../patching/hooks";
import { Perf } from "../perf";
import { Settings } from "../settings";
import { createStyle, ManagedStyle } from "../styles";
import { CommandDefinition, registerCommand } from "../toolkit/commands";
import { addContextMenuPatch, ContextMenuCallback } from "../toolkit/contextMenu";
import { addPanelToggle, ensurePanelPatch, PanelToggle } from "../toolkit/panel";
import { showToast, ToastOptions } from "../toolkit/toasts";
import { Dispatcher, FluxAction, React } from "../webpack/common";
import { Filter, FoundExport, waitFor } from "../webpack/find";
import { PluginActivity } from "./activity";
import { PluginGuard } from "./guard";
import { fixedLookup } from "./hotfixes";
import { diagnoseLookups, isLookupProblem, LOOKUP_GRACE_MS, trackLookup, untrackLookup } from "./lookups";
import type { SettingsSchema, SettingsValues } from "./types";
import { PluginUsage } from "./usage";

export class PluginSettings<S extends SettingsSchema> {
    constructor(
        private readonly id: string,
        readonly schema: S,
        private readonly onDispose: (fn: () => void) => void = () => { },
    ) { }

    private stored() {
        return Settings.plugin(this.id).settings ?? {};
    }

    get<K extends keyof S & string>(key: K): SettingsValues<S>[K] {
        const stored = this.stored();
        return (key in stored ? stored[key] : this.schema[key]?.default) as SettingsValues<S>[K];
    }

    set<K extends keyof S & string>(key: K, value: SettingsValues<S>[K]) {
        Settings.update(d => {
            const entry = d.plugins[this.id] ??= {};
            (entry.settings ??= {})[key] = value;
        });
    }

    /** Current values with defaults filled in */
    get all(): SettingsValues<S> {
        const stored = this.stored();
        const values: Record<string, unknown> = {};
        for (const key in this.schema) values[key] = key in stored ? stored[key] : this.schema[key].default;
        return values as SettingsValues<S>;
    }

    private current?: SettingsValues<S>;

    /**
     * Current values, the same object until one of this plugin's settings changes. Every Evi settings
     * write (another plugin saving its data, a toggle) notifies every subscriber, so this is what
     * keeps those writes from re-rendering and re-running every plugin's settings consumers.
     */
    readonly snapshot = (): SettingsValues<S> => {
        const next = this.all;
        if (this.current && sameValues(this.current, next)) return this.current;
        return this.current = next;
    };

    /** Calls back with the new values whenever this plugin's settings change. Removed on stop. */
    onChange(callback: (values: SettingsValues<S>) => void) {
        let last = this.snapshot();
        const unsubscribe = Settings.subscribe(() => {
            const now = this.snapshot();
            if (now === last) return;
            last = now;
            // A copy: callbacks may keep or change what they're given, React shares `now`
            callback(this.all);
        });
        this.onDispose(unsubscribe);
        return unsubscribe;
    }

    /** React hook: current values, re-renders only when one of them changes */
    use(): SettingsValues<S> {
        return React.useSyncExternalStore(Settings.subscribe, this.snapshot);
    }
}

/** Setting values are primitives: equal key by key is equal */
function sameValues(a: Record<string, unknown>, b: Record<string, unknown>) {
    for (const key in b) if (!Object.is(a[key], b[key])) return false;
    return true;
}

/**
 * Contexts the plugin manager started for a plugin with a native module. Plugin code can build its
 * own PluginContext (`new ctx.constructor(...)`) with any id; only these may call main.
 */
const nativeGrants = new WeakSet<PluginContext<any>>();
export const grantNative = (ctx: PluginContext<any>) => void nativeGrants.add(ctx);

/** Who hears that part of a context's plugin only works after a Discord reload (the plugin manager) */
const reloadReporters = new WeakMap<PluginContext<any>, (reason: string) => void>();
export const onReloadNeeded = (ctx: PluginContext<any>, report: (reason: string) => void) => void reloadReporters.set(ctx, report);

/**
 * Everything a plugin registers goes through its context, which undoes all of it on stop.
 * That's what makes disabling and hot-reloading a plugin safe without a Discord reload.
 */
export class PluginContext<S extends SettingsSchema = SettingsSchema> {
    readonly logger: Logger;
    readonly settings: PluginSettings<S>;
    private disposers: (() => void)[] = [];
    /**
     * Stopped. An async start can still be running after its plugin was turned off or reloaded: what
     * it registers from then on is undone at once instead of staying on until Discord restarts.
     */
    private disposed = false;
    private lookupCheck?: ReturnType<typeof setTimeout>;
    /** Holds what it registers to the permissions it declares (guard.ts) */
    private readonly guard: PluginGuard;
    /**
     * Who this context speaks for, fixed at start. Plugin code gets the context, and a `readonly`
     * field is writable at runtime: without this, swapping `manifest` would let a plugin call another
     * plugin's native module under its id.
     */
    readonly #id: string;
    declare readonly manifest: PluginManifest;

    constructor(manifest: PluginManifest, schema: S) {
        manifest = Object.freeze({ ...manifest });
        Object.defineProperty(this, "manifest", { value: manifest, enumerable: true });
        this.#id = manifest.id;
        this.logger = new Logger(manifest.name);
        this.guard = new PluginGuard(manifest);
        this.settings = new PluginSettings(manifest.id, schema, fn => this.onDispose(fn));
        // A context per start: what this run registers is what its details show
        PluginUsage.reset(manifest.id);
    }

    get id() {
        return this.#id;
    }

    /** Register cleanup to run when the plugin stops, or now if it already has */
    onDispose(fn: () => void) {
        if (!this.disposed) this.disposers.push(fn);
        else {
            try {
                fn();
            } catch (err) {
                this.logger.error("Cleanup threw", err);
            }
        }
        return fn;
    }

    private addHook(target: any, key: PropertyKey, kind: HookKind, callback: HookCallback) {
        this.guard.hook(target, key);
        PluginUsage.add(this.id, "hooks", String(key));
        return this.onDispose(hook(target, key, kind, callback, this.id));
    }

    /** Hook a function on an object. Returns an unhook function (also called on stop). */
    readonly hook = {
        before: <T extends object>(target: T, key: keyof T, cb: HookCallback) => this.addHook(target, key, "before", cb),
        after: <T extends object>(target: T, key: keyof T, cb: HookCallback) => this.addHook(target, key, "after", cb),
        instead: <T extends object>(target: T, key: keyof T, cb: HookCallback) => this.addHook(target, key, "instead", cb),
    };

    /**
     * Hook a webpack export as soon as it exists, whether its module is already loaded or lazy.
     *   hookExport("after", filters.componentByCode("..."), cb)          hooks the matched export itself
     *   hookExport("before", filters.byProps("sendMessage"), "sendMessage", cb)   hooks a method on it
     */
    hookExport(kind: HookKind, filter: Filter, callback: HookCallback): void;
    hookExport(kind: HookKind, filter: Filter, method: string, callback: HookCallback): void;
    hookExport(kind: HookKind, lookupFilter: Filter, methodOrCallback: string | HookCallback, maybeCallback?: HookCallback) {
        const callback = maybeCallback ?? methodOrCallback as HookCallback;
        // Evi's hotfix may point it somewhere else after a Discord update, method name included
        const { filter, method } = fixedLookup(this.id, lookupFilter, typeof methodOrCallback === "string" ? methodOrCallback : undefined);

        this.lookup(filter, method, (value, found: FoundExport) => {
            if (method) return void this.addHook(value, method, kind, callback);
            if (found.key === undefined) {
                this.logger.error("hookExport: the filter matched a whole module, pass a method name to hook one of its functions");
                return;
            }
            this.addHook(found.exports, found.key, kind, callback);
        });
    }

    /** Like webpack waitFor, cancelled on stop. A target that never shows up is reported (see lookups.ts). */
    waitFor<T = any>(filter: Filter, callback: (value: T, found: FoundExport<T>) => void) {
        return this.lookup(fixedLookup(this.id, filter).filter, undefined, callback);
    }

    private lookup<T>(filter: Filter, method: string | undefined, callback: (value: T, found: FoundExport<T>) => void) {
        let active = true;
        const record = trackLookup(this.id, filter, method);
        const unsubscribe = waitFor<T>(filter, (value, found) => {
            if (!active) return;
            record.found = true;
            try {
                callback(value, found);
            } catch (err) {
                this.logger.error("waitFor callback threw", err);
            }
        });
        if (!record.found) this.scheduleLookupCheck();
        return this.onDispose(() => {
            active = false;
            unsubscribe();
            untrackLookup(record);
        });
    }

    /** Once Discord has had time to load, says in the console which lookups never found their target */
    private scheduleLookupCheck() {
        if (this.lookupCheck) return;
        this.lookupCheck = setTimeout(() => {
            for (const d of diagnoseLookups(this.id)) {
                if (!isLookupProblem(d.health)) continue;
                this.logger.warn(d.health === "broken"
                    ? `Couldn't find ${d.target}. Discord probably changed it, this part of the plugin won't work.`
                    : `Couldn't find ${d.target} yet. If you've used the part of Discord it's for, Discord probably changed it.`);
            }
        }, LOOKUP_GRACE_MS + 100);
        this.onDispose(() => clearTimeout(this.lookupCheck));
    }

    readonly flux = {
        subscribe: (type: string, handler: (action: FluxAction) => void) => {
            this.guard.flux(type);
            const site = Perf.site(this.id, "flux", type);
            const safe = (action: FluxAction) => {
                const start = Perf.begin(site);
                try {
                    handler(action);
                } catch (err) {
                    this.logger.error(`Flux handler for ${type} threw`, err);
                } finally {
                    Perf.end(site, start);
                }
            };
            PluginUsage.add(this.id, "flux", type);
            Dispatcher.subscribe(type, safe);
            return this.onDispose(() => Dispatcher.unsubscribe(type, safe));
        },
        dispatch: (action: FluxAction) => Dispatcher.dispatch(action),
    };

    readonly native = {
        call: <T = unknown>(method: string, ...args: unknown[]): Promise<T> => {
            if (!nativeGrants.has(this)) throw new Error(`${this.id} has no native module`);
            // Which full-access method it ran, never the arguments (activity.ts)
            const settle = PluginActivity.nativeCall(this.id, String(method));
            const pending: Promise<T> = Native.callNative(this.id, method, args);
            pending.then(() => settle(true), () => settle(false));
            return pending;
        },
    };

    addStyle(css: string): ManagedStyle {
        PluginUsage.addStyle(this.id);
        const style = createStyle(css, `evi-plugin-${this.id}`);
        this.onDispose(style.remove);
        return style;
    }

    /** Shows one of Discord's toasts */
    toast(message: ReactNode, options?: ToastOptions) {
        return showToast(message, options);
    }

    /**
     * Adds items to Discord's menus: `callback(children, props)` runs each time the menu with this
     * navId renders ("message", "user-context", "guild-context", "channel-context"... or "*").
     * Push Menu.Item / Menu.Group elements (from @evi/api) into `children`. Removed on stop.
     */
    contextMenu(navId: string | string[], callback: ContextMenuCallback) {
        const ids = [navId].flat();
        for (const id of ids) PluginUsage.add(this.id, "menus", id);
        // Charged to this plugin, not to Evi's shared Menu hook it runs in
        return this.onDispose(addContextMenuPatch(navId, Perf.measure(Perf.site(this.id, "menu", ids.join(", ")), callback)));
    }

    /** Registers a slash command that runs locally, listed with Discord's built-ins. Removed on stop. */
    command(definition: CommandDefinition) {
        PluginUsage.add(this.id, "commands", definition.name);
        return this.onDispose(registerCommand(this.guard.command(definition), this.id));
    }

    /**
     * A switch in the user panel, beside mute and deafen. One plugin's switch gets a button of its
     * own; with several, they share one Evi button that opens a menu of them. Removed on stop.
     */
    panelToggle(toggle: PanelToggle) {
        // One switch per plugin: a stopped run's would replace the running one's, then take it away
        if (this.disposed) return () => { };
        // Turned on after the user panel loaded, and it can't be re-run with Evi's spot
        const reloadReason = ensurePanelPatch();
        if (reloadReason) reloadReporters.get(this)?.(reloadReason);
        return this.onDispose(addPanelToggle(this.id, toggle));
    }

    /**
     * Badges this plugin adds to profiles: `provider(userId)` returns them, asked on every render. They show
     * after Evi's own on the profile and in Discord's badge directory ("Your badges"). Removed on stop.
     */
    profileBadges(provider: ProfileBadgeProvider) {
        // Kept by provider: a stopped run adding the same one would take away the running one's
        if (this.disposed) return () => { };
        return this.onDispose(ProfileBadges.add(this.manifest.name, Perf.measure(Perf.site(this.id, "badges", "profile badges"), provider)));
    }

    /**
     * Runs `handler` when the shortcut in the `keybind` setting `key` is pressed, anywhere in Discord.
     * Reads the setting on every press, so a new shortcut applies at once. Removed on stop.
     */
    keybind(key: keyof S & string, handler: () => void) {
        const definition = this.settings.schema[key];
        if (definition?.type !== "keybind") throw new Error(`${this.id}: "${key}" isn't a keybind setting`);
        return this.onDispose(Keybinds.add(this.id, definition.label, () => String(this.settings.get(key) ?? ""), handler));
    }

    setInterval(fn: () => void, ms: number) {
        const handle = setInterval(Perf.measure(Perf.site(this.id, "timer", `setInterval ${ms} ms`), fn), ms);
        return this.onDispose(() => clearInterval(handle));
    }

    setTimeout(fn: () => void, ms: number) {
        const handle = setTimeout(Perf.measure(Perf.site(this.id, "timer", "setTimeout"), fn), ms);
        return this.onDispose(() => clearTimeout(handle));
    }

    /** @internal */
    dispose() {
        this.disposed = true;
        for (const fn of this.disposers.splice(0).reverse()) {
            try {
                fn();
            } catch (err) {
                this.logger.error("Cleanup threw", err);
            }
        }
    }
}
