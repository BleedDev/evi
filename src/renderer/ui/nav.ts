/**
 * Which tab each settings page shows, shared by the Evi section in Discord's settings and the
 * Ctrl+Shift+D panel. Kept outside React so a page opens on the tab it was left on, and so one tab
 * can send you to another (a plugin's Update opening its store page).
 */
import type { StoreKind } from "../store";

const selected = new Map<string, string>();
const listeners = new Set<() => void>();

export const subscribeTabs = (l: () => void) => {
    listeners.add(l);
    return () => void listeners.delete(l);
};

export const selectedTab = (page: string) => selected.get(page);

export function showTab(page: string, tab: string) {
    selected.set(page, tab);
    listeners.forEach(l => l());
}

/** A store page to open on, taken by the store when it next shows */
const storeTargets: Partial<Record<StoreKind, string>> = {};

/** Switches to the store tab, on an item's page when there's an id */
export function openStore(kind: StoreKind, id?: string) {
    if (id) storeTargets[kind] = id;
    else delete storeTargets[kind];
    showTab(kind === "plugin" ? "plugins" : "themes", "store");
}

export function takeStoreTarget(kind: StoreKind) {
    const id = storeTargets[kind];
    delete storeTargets[kind];
    return id;
}

export interface PluginTarget {
    id: string;
    /** A setting to open the plugin's settings on, highlighted */
    setting?: string;
}

/** An installed plugin to show, taken by the Plugins tab when it next shows or right away if it's showing */
let pluginTarget: PluginTarget | undefined;

/** Switches to the installed plugins, on the plugin's card, or in its settings on one of them */
export function openPlugin(id: string, setting?: string) {
    pluginTarget = { id, setting };
    showTab("plugins", "installed");
}

export function takePluginTarget() {
    const target = pluginTarget;
    pluginTarget = undefined;
    return target;
}
