/**
 * Discord's own settings search finding Evi: its tabs, the installed plugins and every plugin setting.
 *
 * Discord's search filters its settings tree: a node shows when the query is in its useTitle or
 * useSearchTerms (or in a parent's), and never when its usePredicate says no. Each result is one of
 * Discord's NAVIGATOR nodes in its Evi page's panel, so Discord finds, groups and draws it like its
 * own: the sidebar lists the page under the Evi heading, the panel the matching rows. A result's
 * predicate asks Evi's matcher (shared/settingsSearch.ts) about the query in Discord's search store,
 * so it only shows for a query that finds it. Choosing one goes through Discord's settings navigator,
 * which is hooked to leave the search and open Evi there instead.
 */
import { createFinder, SearchEntry, searchEntries, SearchGroup, SearchTarget } from "@shared/settingsSearch";

import { I18n, t } from "../i18n";
import { Logger } from "../logger";
import { hook } from "../patching/hooks";
import { PluginManager } from "../plugins/manager";
import { inModulesWith } from "../toolkit/shared";
import { filters, waitFor } from "../webpack/find";
import { openPlugin, showTab } from "./nav";
import { visiblePages } from "./pages";
import { searchablePlugin } from "./PluginsTab";
import type { LayoutNode, NodeTypes } from "./settingsEntry";

const logger = new Logger("SettingsSearch", "#8ab4f8");

/** Discord's settings search box, a small store of its own (query, isActive, isFocused, selected) */
interface SearchStore {
    getField(key: "query"): string;
    setState(state: { query: string; }): void;
}

let searchStore: SearchStore | undefined;
const searchQuery = () => searchStore?.getField("query") ?? "";

/** Each result's node key: what choosing it opens, and the node holding its page's content */
const results = new Map<string, { target: SearchTarget; home: string; }>();

const groupTitles: Record<SearchGroup, (() => string) | undefined> = {
    // Under the page's own title, which already says where they are
    tabs: undefined,
    plugins: () => t("tabs.plugins"),
    settings: () => t("settingsSearch.pluginSettings"),
};

export interface SearchResults {
    /**
     * The result groups for a page's panel, after its content (`home`, the node choosing a result
     * goes to). Discord drops the groups nothing in shows.
     */
    categories(page: string, home: string): LayoutNode[];
}

/**
 * The results for Discord's settings to hold, listed when Discord builds them (each time they open)
 * from the plugins installed then. Matching waits until something is typed.
 */
export function searchResults(types: NodeTypes): SearchResults | undefined {
    const { NAVIGATOR } = types;
    if (NAVIGATOR === undefined) return;
    results.clear();
    const entries = searchEntries(visiblePages(), PluginManager.getSnapshot().map(searchablePlugin));
    const found = createFinder(entries);

    // Discord calls these like hooks, so they use none (see settingsEntry.tsx)
    const node = (entry: SearchEntry, home: string): LayoutNode => {
        const key = `evi_search:${entry.key}`;
        results.set(key, { target: entry.target, home });
        return {
            key,
            type: NAVIGATOR,
            // Itself: Discord draws the row with its page's icon and sends a click here, to the hook below
            destinationKey: key,
            useTitle: entry.title,
            useSubtitle: entry.subtitle,
            usePredicate: () => found(searchQuery(), I18n.locale).has(entry.key),
            // Evi's matcher decides, in usePredicate: Discord's own test (the query's letters in order)
            // would also pass what it finds, except for spaces around the query and matches on what
            // the row doesn't show, like a setting's description
            useSearchTerms: () => [searchQuery()],
        };
    };

    return {
        categories(page, home) {
            return (Object.keys(groupTitles) as SearchGroup[]).flatMap(group => {
                const inGroup = entries.filter(e => e.page === page && e.group === group);
                if (!inGroup.length) return [];
                const title = groupTitles[group];
                return [{
                    key: `evi_${page}_search_${group}`,
                    type: types.CATEGORY,
                    ...title && { useTitle: title },
                    buildLayout: () => inGroup.map(entry => node(entry, home)),
                }];
            });
        },
    };
}

function open(target: SearchTarget) {
    if ("plugin" in target) openPlugin(target.plugin, target.setting);
    else showTab(target.page, target.tab);
}

export function installSettingsSearch() {
    waitFor<SearchStore>(inModulesWith(['query:"",isActive:!1,isFocused:!1,selected:null'], v =>
        typeof v?.getField === "function" && typeof v.setState === "function" && typeof v.getField("query") === "string"), store => searchStore = store);

    // The settings navigator: a click on a NAVIGATOR row calls navigate(destinationKey)
    waitFor(filters.byProps("navigate", "scrollToTarget", "getNextCategoryKey"), nav => {
        hook(nav, "navigate", "before", ({ args }) => {
            const result = results.get(args[0]);
            if (!result) return;
            // Out of the search, the way Discord leaves it for a setting on another page, and on to
            // the page's content, now on the result's tab
            searchStore?.setState({ query: "" });
            open(result.target);
            args[0] = result.home;
        }, "evi-settings");
        logger.info("Evi is in Discord's settings search");
    });
}
