/**
 * Evi's settings as four pages, each with its tabs along the top, so the sidebar stays short. The
 * Evi section in Discord's settings and the Ctrl+Shift+D panel both show these.
 */
import type { ComponentType } from "react";

import { t, useLocale } from "../i18n";
import { Developer } from "../developer";
import { Inbox } from "../inbox";
import { Store } from "../store";
import { AccountTab } from "./AccountTab";
import { PublishButton } from "./author/Author";
import { BackupTab } from "./BackupTab";
import { AnnouncementsTab } from "./developers/Announcements";
import { Live } from "./developers/data";
import { OverviewTab } from "./developers/Overview";
import { PeopleTab } from "./developers/People";
import { PluginsTab as DevPluginsTab } from "./developers/Plugins";
import { ReviewTab } from "./developers/Review";
import { DevToolsTab } from "./DevToolsTab";
import { ErrorBoundary, IconName, TabBar, useStore } from "./components";
import { selectedTab, showTab, subscribeTabs } from "./nav";
import { InboxTab } from "./InboxTab";
import { PatchesTab } from "./PatchesTab";
import { PatchHelperTab } from "./PatchHelperTab";
import { PerformanceTab } from "./PerformanceTab";
import { InstalledPlugins } from "./PluginsTab";
import { QuickCssTab } from "./QuickCssTab";
import { StoreView } from "./Store";
import { ThemeEditorTab } from "./ThemeEditor";
import { InstalledThemes } from "./ThemesTab";
import { UpdatesTab } from "./UpdatesTab";
import { WallpaperTab } from "./WallpaperTab";

export interface PageTab {
    id: string;
    label(): string;
    /** Next to the label, so tabs are told apart at a glance */
    icon: IconName;
    Component: ComponentType;
    /** Things waiting on you in this tab, shown as a pill */
    count?(): number;
}

export interface Page {
    id: string;
    label(): string;
    icon: IconName;
    tabs: PageTab[];
    /** Left out unless this says yes (see visiblePages) */
    visible?(): boolean;
    /** At the right end of the page's tab bar, e.g. Plugins' "Publish your own" */
    action?: ComponentType;
}

const pluginUpdates = () => Store.getSnapshot().plugins.filter(p => Store.pluginAction(p.id) === "update").length;
const themeUpdates = () => Store.getSnapshot().themes.filter(p => Store.themeAction(p.id) === "update").length;

const PluginStore = () => <StoreView kind="plugin" />;
const ThemeStore = () => <StoreView kind="theme" />;

export const pages: readonly Page[] = [
    {
        id: "plugins",
        label: () => t("tabs.plugins"),
        icon: "puzzle",
        action: PublishButton,
        tabs: [
            { id: "installed", label: () => t("tabs.installed"), icon: "circleCheck", Component: InstalledPlugins },
            { id: "store", label: () => t("common.store"), icon: "store", Component: PluginStore, count: pluginUpdates },
            { id: "inbox", label: () => t("inbox.tab"), icon: "bell", Component: InboxTab, count: () => Inbox.unread() },
        ],
    },
    {
        id: "themes",
        label: () => t("tabs.themes"),
        icon: "palette",
        tabs: [
            { id: "installed", label: () => t("tabs.installed"), icon: "circleCheck", Component: InstalledThemes },
            { id: "store", label: () => t("common.store"), icon: "store", Component: ThemeStore, count: themeUpdates },
            { id: "editor", label: () => t("themeEditor.tab"), icon: "pencil", Component: ThemeEditorTab },
            { id: "wallpaper", label: () => t("wallpaper.tab"), icon: "image", Component: WallpaperTab },
            { id: "quickcss", label: () => "Quick CSS", icon: "code", Component: QuickCssTab },
        ],
    },
    {
        id: "general",
        label: () => t("tabs.general"),
        icon: "settings",
        tabs: [
            { id: "updates", label: () => t("tabs.updates"), icon: "download", Component: UpdatesTab },
            { id: "account", label: () => t("tabs.account"), icon: "people", Component: AccountTab },
            { id: "backup", label: () => t("tabs.backup"), icon: "folder", Component: BackupTab },
        ],
    },
    {
        // For when something's wrong, and for plugin authors
        id: "advanced",
        label: () => t("tabs.advanced"),
        icon: "wrench",
        tabs: [
            { id: "patches", label: () => t("tabs.patches"), icon: "wrench", Component: PatchesTab },
            { id: "performance", label: () => t("tabs.performance"), icon: "clock", Component: PerformanceTab },
            { id: "patchhelper", label: () => "Patch Helper", icon: "beaker", Component: PatchHelperTab },
            { id: "devtools", label: () => t("devtools.tab"), icon: "terminal", Component: DevToolsTab },
        ],
    },
    {
        // Only on an Evi linked to one of Evi's developers
        id: "developers",
        label: () => t("dev.page"),
        icon: "analytics",
        visible: Developer.isDev,
        tabs: [
            { id: "overview", label: () => t("dev.tab"), icon: "analytics", Component: OverviewTab },
            { id: "plugins", label: () => t("tabs.plugins"), icon: "puzzle", Component: DevPluginsTab },
            { id: "review", label: () => t("dev.reviewTab"), icon: "circleCheck", Component: ReviewTab, count: Live.waiting },
            { id: "announcements", label: () => t("dev.announcementsTab"), icon: "bell", Component: AnnouncementsTab },
            { id: "people", label: () => t("dev.people"), icon: "people", Component: PeopleTab },
        ],
    },
];

/** The pages this Evi shows; changes when Developer does */
export const visiblePages = () => pages.filter(p => p.visible?.() ?? true);

/** A page's tab bar and the tab it's on */
export function PageView({ page }: { page: Page; }) {
    useLocale();
    const selected = useStore(subscribeTabs, () => selectedTab(page.id));
    // Update counts follow the store, the inbox's its notifications
    useStore(Store.subscribe, Store.getSnapshot);
    useStore(Inbox.subscribe, Inbox.getSnapshot);
    // and the Developers page's Review pill, what waits on evi.rest
    useStore(Live.subscribe, Live.get);
    const current = page.tabs.find(tab => tab.id === selected) ?? page.tabs[0];
    const barId = `dl-subtab-${page.id}`;

    return (
        <div className="dl-page-view">
            <div className="dl-page-head" data-action={page.action ? "" : undefined}>
                <TabBar
                    id={barId}
                    label={page.label()}
                    tabs={page.tabs.map(tab => ({ id: tab.id, label: tab.label(), icon: tab.icon, count: tab.count?.() }))}
                    value={current.id}
                    onChange={tab => showTab(page.id, tab)}
                />
                {page.action && <div className="dl-page-action"><page.action /></div>}
            </div>
            <div role="tabpanel" id={`${barId}-panel`} aria-labelledby={`${barId}-${current.id}`}>
                <ErrorBoundary resetKey={current.id}><current.Component /></ErrorBoundary>
            </div>
        </div>
    );
}
