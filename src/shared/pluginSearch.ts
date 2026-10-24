/**
 * The Plugins tab's search, over what a plugin is (name, description, id, authors) and over its
 * settings: "blur" finds Streamer Mode+ by its "Blur images" setting, even though its name doesn't say.
 * Discord's own settings search finds plugins and settings with the same tests (settingsSearch.ts).
 */

export interface SearchableSetting {
    type: string;
    label: string;
    description?: string;
    options?: readonly { label: string; }[];
}

export interface SearchablePlugin {
    name: string;
    description?: string;
    id: string;
    authors: string[];
    settings?: Record<string, SearchableSetting>;
}

/** What's typed in a search box, as `q` below always is: lowercase and trimmed */
export const normalizeQuery = (query: string) => query.trim().toLowerCase();

export const includesQuery = (text: string | undefined, q: string) => !!text && text.toLowerCase().includes(q);

/** Whether `q` finds a setting, by its label, description or an option's label */
export const settingMatches = (s: SearchableSetting, q: string) =>
    includesQuery(s.label, q) || includesQuery(s.description, q) || !!s.options?.some(o => includesQuery(o.label, q));

/** Keys of the settings `q` finds */
export function matchingSettings(settings: SearchablePlugin["settings"], q: string): string[] {
    if (!q || !settings) return [];
    return Object.entries(settings).filter(([, s]) => settingMatches(s, q)).map(([key]) => key);
}

/** Whether `q` finds the plugin itself (name, description, id, authors), leaving its settings out */
export const matchesPluginInfo = (p: SearchablePlugin, q: string) =>
    includesQuery(`${p.name} ${p.description ?? ""} ${p.id} ${p.authors.join(" ")}`, q);

export function matchesPlugin(p: SearchablePlugin, q: string): boolean {
    if (!q) return true;
    return matchesPluginInfo(p, q) || matchingSettings(p.settings, q).length > 0;
}

export interface KeybindOwner {
    pluginId: string;
    pluginName: string;
    key: string;
    label: string;
    value: string;
}

/**
 * Who else has `value` as their shortcut, as "Plugin: Setting". Only turned-on plugins count: a
 * shortcut in a plugin that's off doesn't run.
 */
export function keybindConflict(owners: KeybindOwner[], value: string, self: { pluginId: string; key: string; }): string | undefined {
    const other = owners.find(o => o.value === value && !(o.pluginId === self.pluginId && o.key === self.key));
    return other && `${other.pluginName}: ${other.label}`;
}
