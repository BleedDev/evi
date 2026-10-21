import type { NativeContext, NativePlugin } from "@evi/api/native";
import { BootPlugin, EviSettings, IPC, isPluginEnabled, PluginChange, PluginManifest, PluginPayload } from "@shared/ipc";
import { pullFor } from "@shared/pulls";
import { parseRemovedPlugins, REMOVED_PLUGINS_FILE, RETIRED_PLUGINS, STORE_MARKER } from "@shared/store";
import { app, ipcMain, session, WebContents } from "electron";
import { existsSync, FSWatcher, readdirSync, readFileSync, renameSync, rmSync, watch, writeFileSync } from "fs";
import { join, resolve, sep } from "path";

import { confirmWithUser } from "./confirm";
import { mt } from "./locale";
import { DATA_DIR, PLUGINS_DIR } from "./paths";
import { currentPulls, onPullsChange } from "./reports";
import { addRequestFilter } from "./requests";
import { SafeMode } from "./safeMode";
import { settings } from "./settings";
import { broadcast } from "./util";

interface LoadedPlugin extends PluginPayload {
    dir: string;
    /** Everything that makes up the plugin on disk, to skip reloads when nothing changed */
    signature: string;
}

interface NativeInstance {
    module: NativePlugin;
    running: boolean;
    disposers: (() => void)[];
}

type Source = PluginPayload["source"];

const roots: { dir: string; source: Source; }[] = [{ dir: PLUGINS_DIR, source: "user" }];
// DELIGHT_DEV_PLUGINS: set by dev loaders installed before the rename to Evi
const devPlugins = process.env.EVI_DEV_PLUGINS ?? process.env.DELIGHT_DEV_PLUGINS;
if (devPlugins) roots.push({ dir: devPlugins, source: "dev" });

const plugins = new Map<string, LoadedPlugin>();
const natives = new Map<string, NativeInstance>();

const REMOVED_FILE = join(DATA_DIR, REMOVED_PLUGINS_FILE);
let removed: Set<string> | undefined;

function removedPlugins() {
    if (!removed) {
        try {
            removed = parseRemovedPlugins(readFileSync(REMOVED_FILE, "utf8"));
        } catch {
            removed = new Set();
        }
    }
    return removed;
}

/** Remembers (or forgets) that the user removed a plugin, so Evi's updates don't bring it back */
export function setRemoved(id: string, isRemoved: boolean) {
    const list = removedPlugins();
    if (list.has(id) === isRemoved) return;
    if (isRemoved) list.add(id);
    else list.delete(id);
    try {
        writeFileSync(REMOVED_FILE + ".tmp", JSON.stringify([...list].sort(), null, 4));
        renameSync(REMOVED_FILE + ".tmp", REMOVED_FILE);
    } catch (err) {
        console.error("[Evi] Couldn't save the removed plugins list", err);
    }
}

/**
 * Whether a plugin read from disk should be skipped: an official one that's now part of Evi (unless
 * the store installed it), or, in the dev build output, one the user removed. The dev output is the
 * repo's own build, so it can't be deleted from here; it's hidden instead.
 */
function skipped(id: string, dir: string, source: Source) {
    if (RETIRED_PLUGINS.includes(id) && !existsSync(join(dir, STORE_MARKER))) return true;
    return source === "dev" && removedPlugins().has(id);
}

/** Where a loaded plugin came from, for removing it */
export function pluginLocation(id: string) {
    const plugin = plugins.get(id);
    return plugin && { dir: plugin.dir, source: plugin.source, version: plugin.manifest.version };
}

/** Takes a dev build plugin out of the page, after it's been marked removed */
export function hideDevPlugin(id: string) {
    const plugin = plugins.get(id);
    if (plugin?.source !== "dev") return;
    stopNative(id);
    natives.delete(id);
    plugins.delete(id);
    announce({ type: "remove", id });
}

function readPlugin(dir: string, source: Source): LoadedPlugin | null {
    const manifestPath = join(dir, "manifest.json");
    if (!existsSync(manifestPath)) return null;

    try {
        const manifest: PluginManifest = JSON.parse(readFileSync(manifestPath, "utf8"));
        if (skipped(manifest.id, dir, source)) return null;
        const code = readFileSync(join(dir, manifest.main ?? "index.js"), "utf8");
        const native = manifest.native ? readFileSync(join(dir, manifest.native), "utf8") : "";
        return { manifest, code, source, dir, signature: JSON.stringify(manifest) + code + native };
    } catch (err) {
        console.error(`[Evi] Failed to read plugin at ${dir}`, err);
        return null;
    }
}

function toPayload({ dir: _, signature: __, ...payload }: LoadedPlugin): PluginPayload {
    return payload;
}

/** Turned off by Evi on every install (shared/pulls.ts). Dev builds are the developer's own, never pulled. */
function isPulled({ manifest, source }: { manifest: PluginManifest; source: Source; }) {
    return source !== "dev" && !!pullFor(currentPulls(), manifest.id, manifest.version);
}

/**
 * Whether main lets a plugin's native side run: turned on in the settings main holds (not what the
 * page says), not pulled, and not in safe mode. The page only asks; plugins run there too, and one
 * could otherwise start or call another plugin's native module.
 */
function mayRunNative(plugin: LoadedPlugin) {
    return !SafeMode.active && isPluginEnabled(settings, plugin.manifest) && !isPulled(plugin);
}

function loadNative(plugin: LoadedPlugin) {
    if (!plugin.manifest.native) return;

    const existing = natives.get(plugin.manifest.id);
    if (existing) return existing;

    const file = resolve(plugin.dir, plugin.manifest.native);
    delete require.cache[file];
    try {
        const mod = require(file);
        const instance: NativeInstance = { module: mod.default ?? mod, running: false, disposers: [] };
        natives.set(plugin.manifest.id, instance);
        return instance;
    } catch (err) {
        console.error(`[Evi] Failed to load native module of ${plugin.manifest.id}`, err);
    }
}

function startNative(id: string) {
    const plugin = plugins.get(id);
    // Plugins are listed in safe mode, but none of their code runs. Not even loaded: loading runs its top-level code.
    if (!plugin || !mayRunNative(plugin)) return;
    const native = loadNative(plugin);
    if (!native || native.running) return;

    const ctx: NativeContext = {
        pluginId: id,
        pluginDir: plugin.dir,
        dataDir: DATA_DIR,
        onBeforeRequest: filter => {
            const remove = addRequestFilter(session.defaultSession, filter);
            native.disposers.push(remove);
            return remove;
        },
        onDispose: fn => void native.disposers.push(fn),
    };

    native.running = true;
    try {
        native.module.start?.(ctx);
    } catch (err) {
        console.error(`[Evi] Native start of ${id} failed`, err);
        stopNative(id);
    }
}

function stopNative(id: string) {
    const native = natives.get(id);
    if (!native?.running) return;

    native.running = false;
    try {
        native.module.stop?.();
    } catch (err) {
        console.error(`[Evi] Native stop of ${id} failed`, err);
    }
    for (const dispose of native.disposers.splice(0).reverse()) {
        try { dispose(); } catch { }
    }
}

const announce = (change: PluginChange) => broadcast(IPC.PLUGIN_CHANGED, change);

/** Which root a plugin folder is in: later roots (dev) win over earlier ones (user) for the same id */
const rootRank = (dir: string) => roots.findIndex(r => dir.startsWith(r.dir + sep));

/** Takes a plugin out of main, its native side stopped. Whether that was running */
function unload(plugin: LoadedPlugin) {
    const { id } = plugin.manifest;
    const running = natives.get(id)?.running ?? false;
    stopNative(id);
    natives.delete(id);
    plugins.delete(id);
    return running;
}

function load(plugin: LoadedPlugin, restartNative: boolean, action: "installed" | "updated") {
    plugins.set(plugin.manifest.id, plugin);
    SafeMode.recordChange({ kind: "plugin", id: plugin.manifest.id, action });
    // Plugins added or re-enabled while Discord runs need their native side started too
    if (restartNative || isPluginEnabled(settings, plugin.manifest)) startNative(plugin.manifest.id);
    announce({ type: "upsert", plugin: toPayload(plugin) });
}

/** Another folder with this id, the one startup would pick: from the last root, the last of its folders */
function findOther(id: string, except: string) {
    for (const { dir: root, source } of roots.toReversed()) {
        if (!existsSync(root)) continue;
        for (const entry of readdirSync(root, { withFileTypes: true }).reverse()) {
            const dir = join(root, entry.name);
            if (!entry.isDirectory() || dir === except) continue;
            try {
                if (JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"))?.id !== id) continue;
            } catch {
                continue;
            }
            const plugin = readPlugin(dir, source);
            if (plugin?.manifest.id === id) return plugin;
        }
    }
}

function reloadFolder(root: string, source: Source, folder: string) {
    const dir = join(root, folder);
    const previous = [...plugins.values()].find(p => p.dir === dir);
    let next = readPlugin(dir, source);

    // Another folder has this id already ("foo - Copy" beside foo, the user's beside a dev build):
    // a later root takes it over, as at startup; otherwise the one running stays
    const owner = next && plugins.get(next.manifest.id);
    if (next && owner && owner.dir !== dir && rootRank(owner.dir) >= rootRank(dir)) {
        console.warn(`[Evi] ${dir} has the same id as ${owner.dir} (${next.manifest.id}), skipped`);
        next = null;
    }
    // Editors and builds touch files without changing them, don't restart plugins for that
    if (previous && next && previous.signature === next.signature) return;

    let restartNative = false;
    if (next && owner && owner.dir !== dir) restartNative = unload(owner);
    if (previous) {
        const { id } = previous.manifest;
        const running = unload(previous);
        if (next?.manifest.id === id) restartNative ||= running;
        else {
            // Its folder went, or now has another id: a copy elsewhere takes over, if there is one
            const other = findOther(id, dir);
            if (other) load(other, running, "updated");
            else announce({ type: "remove", id });
        }
    }

    if (next) load(next, restartNative, previous || owner ? "updated" : "installed");
}

/** Re-reads every plugin folder under a root, including ones that disappeared */
function rescanRoot(root: string, source: Source) {
    const folders = new Set(existsSync(root) ? readdirSync(root) : []);
    for (const plugin of plugins.values()) {
        if (plugin.dir.startsWith(root + sep)) folders.add(plugin.dir.slice(root.length + 1).split(sep)[0]);
    }
    for (const folder of folders) reloadFolder(root, source, folder);
}

function watchRoot(root: string, source: Source) {
    const pending = new Map<string, ReturnType<typeof setTimeout>>();

    const start = () => {
        let watcher: FSWatcher;
        try {
            watcher = watch(root, { recursive: true }, (_event, filename) => {
                if (!filename) return;
                const folder = filename.split(sep)[0];
                // Builds write several files in a row, reload once they settle
                clearTimeout(pending.get(folder));
                pending.set(folder, setTimeout(() => {
                    pending.delete(folder);
                    reloadFolder(root, source, folder);
                }, 150));
            });
        } catch {
            return void setTimeout(start, 2000);
        }

        // On Windows, deleting a watched subfolder errors the watcher and it stops for good.
        // Without this handler the error was swallowed and hot reload silently died.
        watcher.on("error", err => {
            console.warn("[Evi] Plugin watcher failed, restarting it", err);
            watcher.close();
            setTimeout(() => {
                rescanRoot(root, source);
                start();
            }, 500);
        });
    };

    start();
}

/**
 * Plugins the user just said yes to in main (a confirmed store install), with when that runs out.
 * The page turns them on right after, which doesn't need asking again.
 */
const consented = new Map<string, number>();
const CONSENT_FOR = 2 * 60 * 1000;
/** Questions on screen, by plugin id: saves that arrive meanwhile wait for the same answer */
const asking = new Map<string, Promise<boolean>>();

/** The user agreed to run this plugin with full access, in a dialog main showed */
export function consentToRun(id: string) {
    consented.set(id, Date.now() + CONSENT_FOR);
}

/** Native code or Chromium switches: what a plugin gets beyond Discord's page when it's on */
function reachesBeyondPage(manifest: PluginManifest) {
    return !!manifest.native || (!!manifest.chromiumSwitches && Object.keys(manifest.chromiumSwitches).length > 0);
}

/**
 * Plugins a settings save from the page turns on that reach beyond it. The page can't be trusted to
 * say the user did that (a plugin could save settings too, then restart Discord), so main asks first.
 * Only plugins main has loaded: one that isn't there yet is checked when it's installed (the store
 * asks before installing native code).
 */
export function enablesNeedingConsent(prev: EviSettings, next: EviSettings): PluginManifest[] {
    const now = Date.now();
    return [...plugins.values()]
        .map(p => p.manifest)
        .filter(m => reachesBeyondPage(m) && !isPluginEnabled(prev, m) && isPluginEnabled(next, m) && !((consented.get(m.id) ?? 0) > now));
}

/** Asks the user, from main, whether to turn a plugin on. One question per plugin at a time. */
export function askToEnable(manifest: PluginManifest, sender: WebContents | undefined): Promise<boolean> {
    const pending = asking.get(manifest.id);
    if (pending) return pending;

    const { name } = manifest;
    const switches = Object.keys(manifest.chromiumSwitches ?? {}).map(s => `--${s}`).join(", ");
    const answer = confirmWithUser(sender, manifest.native ? {
        message: mt("main.enable.native.message", { name }),
        detail: mt("main.enable.native.detail", { name }),
        confirm: mt("main.enable.confirm"),
        pageSaid: true,
    } : {
        message: mt("main.enable.switches.message", { name }),
        detail: mt("main.enable.switches.detail", { name, switches }),
        confirm: mt("main.enable.confirm"),
        pageSaid: true,
    }).catch(err => {
        console.error(`[Evi] Couldn't ask about turning on ${manifest.id}`, err);
        return false;
    }).finally(() => asking.delete(manifest.id));
    asking.set(manifest.id, answer);
    return answer;
}

/**
 * Runs before Electron is ready, the only time command line switches still apply.
 * Reads manifests directly since the plugin host starts later.
 */
export function applyChromiumSwitches() {
    if (SafeMode.active) return;
    for (const { dir, source } of roots) {
        if (!existsSync(dir)) continue;
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
            if (!entry.isDirectory()) continue;
            try {
                const manifest: PluginManifest = JSON.parse(readFileSync(join(dir, entry.name, "manifest.json"), "utf8"));
                if (!manifest.chromiumSwitches || !isPluginEnabled(settings, manifest) || isPulled({ manifest, source })) continue;
                for (const [name, value] of Object.entries(manifest.chromiumSwitches)) {
                    if (value === true) app.commandLine.appendSwitch(name);
                    else app.commandLine.appendSwitch(name, value);
                    console.log(`[Evi] ${manifest.id}: --${name}${value === true ? "" : "=" + value}`);
                }
            } catch { }
        }
    }
}

/** Picks up a change to a folder in the user plugins dir now, without waiting for the watcher */
export function refreshUserPlugin(folder: string) {
    reloadFolder(PLUGINS_DIR, "user", folder);
}

export function getPluginPayloads() {
    return [...plugins.values()].map(toPayload);
}

/**
 * What the page boots with: code only for plugins that run now (the same test as for their native
 * side). The rest is most of it, and parsing it every start cost more than everything else plugins
 * do at boot; the page asks for one's code (PLUGIN_CODE) once it's turned on or its settings opened.
 */
export function getBootPlugins(): BootPlugin[] {
    return [...plugins.values()].map(plugin => mayRunNative(plugin) ? toPayload(plugin) : { manifest: plugin.manifest, source: plugin.source });
}

export function initPlugins() {
    // Left over from before these became part of Evi; a store-installed copy stays
    for (const id of RETIRED_PLUGINS) {
        const dir = join(PLUGINS_DIR, id);
        if (!existsSync(dir) || existsSync(join(dir, STORE_MARKER))) continue;
        // A file in it held open (Explorer, an antivirus scan) stops this, not every plugin: it's skipped when read
        try {
            rmSync(dir, { recursive: true, force: true });
        } catch (err) {
            console.warn(`[Evi] Couldn't remove the retired plugin folder ${id}`, err);
        }
    }

    for (const { dir, source } of roots) {
        if (!existsSync(dir)) continue;
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
            if (!entry.isDirectory()) continue;
            // Later roots (dev) win over earlier ones (user) for the same id
            const plugin = readPlugin(join(dir, entry.name), source);
            if (plugin) plugins.set(plugin.manifest.id, plugin);
        }
        watchRoot(dir, source);
    }

    // Natives of enabled plugins start immediately so things like request blocking cover startup
    for (const plugin of plugins.values()) {
        if (isPluginEnabled(settings, plugin.manifest)) startNative(plugin.manifest.id);
    }
    // Discord crashed repeatedly while running: whatever native code is running goes too
    SafeMode.onEnter(() => {
        for (const id of natives.keys()) stopNative(id);
    });
    // Evi pulled a plugin while it runs. Lifting a pull starts it again from the page, like switching it on.
    onPullsChange(() => {
        for (const id of natives.keys()) {
            const plugin = plugins.get(id);
            if (plugin && isPulled(plugin)) stopNative(id);
        }
    });

    ipcMain.on(IPC.PLUGIN_CODE, (e, id: unknown) => {
        e.returnValue = typeof id === "string" ? plugins.get(id)?.code ?? null : null;
    });

    // Starting is checked in startNative; stopping is always fine
    ipcMain.handle(IPC.PLUGIN_NATIVE_STATE, (_, id: unknown, running: unknown) => {
        if (typeof id !== "string") return;
        running === true ? startNative(id) : stopNative(id);
    });

    ipcMain.handle(IPC.PLUGIN_NATIVE_CALL, (_, id: unknown, method: unknown, args: unknown) => {
        const plugin = typeof id === "string" ? plugins.get(id) : undefined;
        if (SafeMode.active) throw new Error(`Plugin ${id} can't run in safe mode`);
        if (plugin && isPulled(plugin)) throw new Error(`Plugin ${id} was turned off by Evi`);
        if (plugin && !isPluginEnabled(settings, plugin.manifest)) throw new Error(`Plugin ${id} is turned off`);
        if (typeof method !== "string" || !Array.isArray(args)) throw new Error(`Plugin ${id} has no native method ${method}`);
        const native = plugin && loadNative(plugin);
        const fn = native?.module[method];
        if (!native || typeof fn !== "function" || method === "start" || method === "stop") {
            throw new Error(`Plugin ${id} has no native method ${method}`);
        }
        return fn.apply(native.module, args);
    });
}
