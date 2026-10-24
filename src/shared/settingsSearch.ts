/**
 * What Discord's own settings search finds in Evi: Evi's tabs, the installed plugins and each plugin
 * setting, and whether a query finds them. ui/settingsSearch.ts lists these in Discord's settings.
 * Plugins and settings are matched by the Plugins tab's own tests (pluginSearch.ts), so typing the
 * same words in either search finds the same things.
 */
import { includesQuery, matchesPluginInfo, normalizeQuery, SearchablePlugin, settingMatches } from "./pluginSearch";

export interface SearchablePage {
    id: string;
    label(): string;
    tabs: readonly { id: string; label(): string; }[];
}

/** Where choosing a result goes: a page's tab, or the Plugins tab on a plugin, with one of its settings open */
export type SearchTarget = { page: string; tab: string; } | { plugin: string; setting?: string; };

/** Results are grouped like this in their page's panel */
export type SearchGroup = "tabs" | "plugins" | "settings";

export interface SearchEntry {
    /**
     * Unique among the entries: ids are URI-encoded, so ":" only ever separates them. No quotes either,
     * as Discord's navigation puts node keys in a CSS attribute selector.
     */
    key: string;
    /** The Evi page it's listed under */
    page: string;
    group: SearchGroup;
    /** Read as Discord draws the result, so they follow the language */
    title(): string;
    subtitle?(): string;
    target: SearchTarget;
    /** Whether `q` (see normalizeQuery) finds it */
    matches(q: string): boolean;
}

/** The page plugins and their settings are listed under */
export const PLUGINS_PAGE = "plugins";

/**
 * Every tab of `pages` (the ones this Evi shows), then each plugin followed by its settings. Pass a
 * plugin's settings only when it has a settings dialog to open them in.
 */
export function searchEntries(pages: readonly SearchablePage[], plugins: readonly SearchablePlugin[]): SearchEntry[] {
    const entries: SearchEntry[] = [];
    for (const page of pages) {
        for (const tab of page.tabs) {
            entries.push({
                key: `tab:${page.id}:${tab.id}`,
                page: page.id,
                group: "tabs",
                title: tab.label,
                target: { page: page.id, tab: tab.id },
                matches: q => includesQuery(tab.label(), q),
            });
        }
    }
    if (!pages.some(p => p.id === PLUGINS_PAGE)) return entries;

    for (const plugin of plugins) {
        const { description } = plugin;
        const id = encodeURIComponent(plugin.id);
        entries.push({
            key: `plugin:${id}`,
            page: PLUGINS_PAGE,
            group: "plugins",
            title: () => plugin.name,
            subtitle: description ? () => description : undefined,
            target: { plugin: plugin.id },
            matches: q => matchesPluginInfo(plugin, q),
        });
        for (const [key, setting] of Object.entries(plugin.settings ?? {})) {
            entries.push({
                key: `setting:${id}:${encodeURIComponent(key)}`,
                page: PLUGINS_PAGE,
                group: "settings",
                title: () => setting.label,
                // Which plugin it's in: labels like "Enabled" say nothing on their own
                subtitle: () => plugin.name,
                target: { plugin: plugin.id, setting: key },
                matches: q => settingMatches(setting, q),
            });
        }
    }
    return entries;
}

/**
 * The keys of the entries a query finds, worked out once per query and language (tabs are found by
 * their label in it): Discord asks each result whether it shows every time it draws its settings.
 * An empty query finds nothing.
 */
export function createFinder(entries: readonly SearchEntry[]) {
    let last = "";
    let found: ReadonlySet<string> = new Set();
    return (query: string, language = ""): ReadonlySet<string> => {
        const q = normalizeQuery(query);
        const key = `${language}\n${q}`;
        if (key !== last) {
            last = key;
            found = new Set(q ? entries.filter(e => e.matches(q)).map(e => e.key) : []);
        }
        return found;
    };
}
