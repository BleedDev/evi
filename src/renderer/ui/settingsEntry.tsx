/**
 * Adds a "Evi" section to Discord's own settings sidebar.
 *
 * Discord describes its settings as a tree of layout nodes (ROOT > SECTION > SIDEBAR_ITEM > PANEL >
 * CATEGORY > CUSTOM), each with a lazy `buildLayout()`. We wrap the `$Root` node's buildLayout to
 * insert our section, using export hooks only, no source patches.
 */
import { useLocale } from "../i18n";
import { Logger } from "../logger";
import { hook } from "../patching/hooks";
import { findExport, filters, waitFor } from "../webpack/find";
import { ErrorBoundary } from "./components";
import { ensureStyles } from "./index";
import { Page, pages, PageView } from "./pages";

interface LayoutNode {
    key: string;
    type: number;
    buildLayout?(): LayoutNode[];
    [prop: string]: unknown;
}

type NodeTypes = Record<"SECTION" | "SIDEBAR_ITEM" | "PANEL" | "CATEGORY" | "CUSTOM", number>;

const logger = new Logger("SettingsEntry", "#8ab4f8");
const SECTION_KEY = "evi_section";
/** Our section goes right above this one */
const ANCHOR_KEY = "billing_section";
const SYM_WRAPPED = Symbol("evi.rootWrapped");

const iconPaths: Record<string, string> = {
    plugins: "M10 3a2 2 0 0 1 4 0v2h3a2 2 0 0 1 2 2v3h-2a2 2 0 0 0 0 4h2v3a2 2 0 0 1-2 2h-3v-2a2 2 0 0 0-4 0v2H7a2 2 0 0 1-2-2v-3h2a2 2 0 0 0 0-4H5V7a2 2 0 0 1 2-2h3z",
    themes: "M7 14a3 3 0 0 0-3 3c0 1.3-1.2 2-2 2 .9 1.2 2.5 2 4 2a4 4 0 0 0 4-4 3 3 0 0 0-3-3zm13.7-9.4-1.3-1.3a1 1 0 0 0-1.4 0L9 12.3l2.8 2.7 8.9-8.9a1 1 0 0 0 0-1.4z",
    // Sliders
    general: "M4 5a1 1 0 0 0 0 2h7.17a3 3 0 0 0 5.66 0H20a1 1 0 1 0 0-2h-3.17a3 3 0 0 0-5.66 0H4Zm0 12a1 1 0 1 0 0 2h3.17a3 3 0 0 0 5.66 0H20a1 1 0 1 0 0-2h-7.17a3 3 0 0 0-5.66 0H4Zm-1-5a1 1 0 0 1 1-1h11.17a3 3 0 0 1 5.66 0H21a1 1 0 1 1 0 2h-.17a3 3 0 0 1-5.66 0H4a1 1 0 0 1-1-1Z",
    // Three bars
    developers: "M4 21a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H4Zm7 0a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1h-2Zm7 0a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1h-2Z",
    // Wrench
    advanced: "M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.8-3.8a6 6 0 0 1-7.9 7.9l-6.9 6.9a2.1 2.1 0 0 1-3-3l6.9-6.9a6 6 0 0 1 7.9-7.9l-3.8 3.8z",
};

function makeIcon(path: string) {
    return function EviIcon({ className, width, height, size }: { className?: string; width?: number; height?: number; size?: unknown; }) {
        const px = width ?? height ?? (typeof size === "number" ? size : 20);
        return (
            <svg className={className} width={px} height={px} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d={path} />
            </svg>
        );
    };
}

function Embedded({ page }: { page: Page; }) {
    useLocale();
    return <div className="dl-root dl-embedded"><ErrorBoundary><PageView page={page} /></ErrorBoundary></div>;
}

function buildSection(types: NodeTypes): LayoutNode {
    // Discord calls useTitle and useSearchTerms like hooks, but from components that also call its own
    // nodes' ones, and those use no hooks. So these mustn't either: a hook here changed how many hooks
    // Discord's header rendered when it moved onto an Evi page, and React crashed Discord (error #310).
    // They read the language as they're called; Discord redraws its settings when its language changes.
    const entry = (page: Page): LayoutNode => {
        const key = page.id;
        const title = () => page.label();
        const Component = () => <Embedded page={page} />;
        // Discord's settings search finds a page by its tabs too ("Quick CSS", "Backup"...)
        const useSearchTerms = () => ["Evi", title(), ...page.tabs.map(tab => tab.label())];
        const custom: LayoutNode = { key: `evi_${key}_custom`, type: types.CUSTOM, Component, useSearchTerms };
        const category: LayoutNode = { key: `evi_${key}_category`, type: types.CATEGORY, buildLayout: () => [custom] };
        const panel: LayoutNode = { key: `evi_${key}_panel`, type: types.PANEL, useTitle: title, buildLayout: () => [category] };
        return {
            key: `evi_${key}_sidebar_item`,
            type: types.SIDEBAR_ITEM,
            useTitle: title,
            icon: makeIcon(iconPaths[key] ?? iconPaths.advanced),
            buildLayout: () => [panel],
        };
    };

    const items = pages.map(page => ({ page, node: entry(page) }));

    // Asked each time Discord builds its settings, so the Developers page comes and goes with the account
    return { key: SECTION_KEY, type: types.SECTION, useTitle: () => "Evi", buildLayout: () => items.filter(i => i.page.visible?.() ?? true).map(i => i.node) };
}

function wrapRoot(root: LayoutNode, types: NodeTypes) {
    if ((root as any)[SYM_WRAPPED] || typeof root.buildLayout !== "function") return;
    (root as any)[SYM_WRAPPED] = true;

    const section = buildSection(types);
    hook(root, "buildLayout", "after", ({ result }) => {
        if (!Array.isArray(result) || result.some(n => n?.key === SECTION_KEY)) return;
        const anchor = result.findIndex(n => n?.key === ANCHOR_KEY);
        const layout = [...result];
        layout.splice(anchor === -1 ? 1 : anchor, 0, section);
        return layout;
    }, "evi-settings");
    logger.info("Added Evi to Discord settings");
}

const isRoot = (v: any) => v?.key === "$Root" && typeof v.buildLayout === "function";

export function installSettingsEntry() {
    ensureStyles();
    waitFor<NodeTypes>(filters.byProps("SECTION", "SIDEBAR_ITEM", "PANEL", "CATEGORY", "CUSTOM"), types => {
        // Discord doesn't export the root node, but passes it through this tree builder every time settings open
        waitFor(filters.byCode('"buildLayout"in', ".buildLayout().map("), (_, found) => {
            if (!found.key) return;
            hook(found.exports, found.key, "before", ({ args }) => {
                if (isRoot(args[0])) wrapRoot(args[0], types);
            }, "evi-settings");
        });
    });

    // Tell us if Discord reshaped its settings, instead of failing silently
    setTimeout(() => {
        if (!findExport(filters.byProps("SECTION", "SIDEBAR_ITEM", "PANEL", "CUSTOM"))) {
            logger.warn("Settings layout types not found, Evi isn't in Discord settings. Ctrl+Shift+D still works.");
        }
    }, 30_000);
}
