/**
 * DM Categories: sort DMs and group DMs into collapsible categories at the top of the DM list.
 *
 * Discord's DM list is a sectioned list: its own rows (Friends, Nitro...), then the DMs under
 * "Direct Messages". LIST_PATCH (categories.ts) gives it a section per category in between and
 * maps each of their rows back to an index into Discord's channel ids, so every DM row is still
 * rendered by Discord's own renderDM. Only the category headers are ours.
 *
 * Like Discord's channel categories, a collapsed category still shows the DM you have open and any
 * DM with unread messages. The list only re-renders when its props change, so read state changes
 * re-render it from here, when they change what a collapsed category shows.
 *
 * Categories live in this plugin's settings entry, under a key the settings panel doesn't show.
 * DMs are added from their right-click menu ("user-context" for DMs, "gdm-context" for group DMs);
 * a category's header has its own menu for renaming, reordering and deleting it.
 */
import { definePlugin, Dispatcher, filters, find, getStore, Menu, openLayer, React } from "@evi/api";
import type { CloseLayer, PluginContext } from "@evi/api";
import type { FormEvent, MouseEvent as ReactMouseEvent, ReactNode } from "react";

import {
    assign, Category, CategoryState, categoryOf, createCategory, deleteCategory, EMPTY, getCategory, isPlaceholder, LaidOutCategory, layout, Layout, LIST_PATCH,
    MAX_NAME_LENGTH, moveCategory, nameError, parseState, PLAIN, renameCategory, rowIndex, rowOffset, sectionCategory, sectionSizes, setCollapsed,
} from "./categories";
import { t } from "./strings";

const STORAGE_KEY = "categories";
/** A category header's height, which the list needs to know up front */
const HEADER_HEIGHT = 32;
const DM = 1;
const GROUP_DM = 3;

type Settings = typeof settings;
const settings = {
    order: {
        type: "select",
        get label() { return t("settings.order"); },
        default: "recent",
        options: [
            { get label() { return t("settings.order.recent"); }, value: "recent" },
            { get label() { return t("settings.order.name"); }, value: "name" },
        ],
    },
    showCounts: {
        type: "boolean",
        get label() { return t("settings.showCounts"); },
        get description() { return t("settings.showCounts.description"); },
        default: true,
    },
} as const;

let ctx: PluginContext<Settings> | undefined;
let state: CategoryState = EMPTY;

type Storage = { get(key: string): unknown; set(key: string, value: unknown): void; };
const storage = () => ctx?.settings as unknown as Storage | undefined;

interface DmList {
    props: { padding?: number; selectedChannelId?: string | null; privateChannelIds?: string[]; };
    _list?: { scrollIntoViewRect?(rect: { start: number; end: number; }): void; } | null;
    getSectionHeight(section: number): number;
    getRowHeight(section: number, row: number): number;
    forceUpdate(): void;
    eviDmcRowHeight?: true;
}

/** Gives a category's placeholder row (see sectionSizes) no height; every other row keeps Discord's */
function wrapRowHeight(instance: DmList | undefined) {
    if (!instance || instance.eviDmcRowHeight || typeof instance.getRowHeight !== "function") return;
    const own = instance.getRowHeight;
    instance.getRowHeight = (section, row) => ctx && isPlaceholder(current, section, row) ? 0 : own.call(instance, section, row);
    instance.eviDmcRowHeight = true;
}

/** The mounted DM list and what it last rendered */
let list: DmList | undefined;
let current: Layout = PLAIN;
let currentIds: readonly string[] = [];
let currentSizes: number[] = [];
/** Which DMs the collapsed categories showed, to tell when read state changes that */
let shownWhileCollapsed = "";

const listeners = new Set<() => void>();

/** Re-renders the DM list, and the category headers with it */
function refresh() {
    list ??= findMountedList();
    wrapRowHeight(list);
    for (const listener of listeners) listener();
    try {
        list?.forceUpdate();
    } catch { /* unmounted */ }
}

/**
 * The DM list on screen, before it has rendered through the patch (the plugin was just turned on):
 * up the React tree from its scroller to the class with Discord's renderDM and scrollToChannel.
 */
function findMountedList(): DmList | undefined {
    const node = document.querySelector('[data-list-id^="private-channels-"]');
    if (!node) return;
    const key = Object.keys(node).find(k => k.startsWith("__reactFiber$"));
    for (let fiber = key ? (node as any)[key] : null, depth = 0; fiber && depth < 40; fiber = fiber.return, depth++) {
        const instance = fiber.stateNode;
        if (typeof instance?.renderDM === "function" && typeof instance.scrollToChannel === "function") return instance;
    }
}

function commit(next: CategoryState) {
    if (next === state) return;
    state = next;
    storage()?.set(STORAGE_KEY, state);
    refresh();
}

const hasUnread = (channelId: string) => {
    try {
        return !!getStore("ReadStateStore")?.hasUnread?.(channelId);
    } catch {
        return false;
    }
};

const collator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });

/** A DM's name as the list shows it: the group DM's name, or its people's nicknames or names */
function channelName(channelId: string): string {
    const channel = getStore("ChannelStore")?.getChannel?.(channelId);
    if (!channel) return "";
    if (channel.name) return channel.name;
    const users = getStore("UserStore");
    const relationships = getStore("RelationshipStore");
    const ids: string[] = channel.recipients ?? [];
    return ids.map(id => {
        const user = users?.getUser?.(id);
        return relationships?.getNickname?.(id) || user?.globalName || user?.global_name || user?.username || "";
    }).filter(Boolean).join(", ");
}

function compareByName(): (a: string, b: string) => number {
    const names = new Map<string, string>();
    const name = (id: string) => {
        let n = names.get(id);
        if (n === undefined) names.set(id, n = channelName(id));
        return n;
    };
    return (a, b) => collator.compare(name(a), name(b));
}

function laidOut(ids: readonly string[], selected: string | null | undefined): Layout {
    const compare = ctx?.settings.get("order") === "name" ? compareByName() : undefined;
    return layout(ids, state, compare, id => id === selected || hasUnread(id));
}

/** A key for which DMs the collapsed categories show right now */
function collapsedKey(l: Layout) {
    return l.categories.filter(c => c.category.collapsed).map(c => c.rows.join(",")).join(";");
}

/** Read state changed: re-render the list if that changes what a collapsed category shows */
function onReadState() {
    if (!list || current.plain || !state.categories.some(c => c.collapsed)) return;
    const next = laidOut(currentIds, list.props.selectedChannelId);
    if (collapsedKey(next) !== shownWhileCollapsed) refresh();
}

type OpenContextMenu = (event: ReactMouseEvent, render: (props: any) => ReactNode) => void;
const openContextMenu = (): OpenContextMenu | undefined => find(filters.byCode("enableSpellCheck", "renderLazy"));
const MenuRoot = (): React.ComponentType<any> | undefined => find(filters.componentByCode("Menu API only allows Items"));
const closeContextMenu = () => void Dispatcher.dispatch({ type: "CONTEXT_MENU_CLOSE" });

function openHeaderMenu(event: ReactMouseEvent, category: Category) {
    const open = openContextMenu();
    const Root = MenuRoot();
    if (!open || !Root) return;
    const index = state.categories.findIndex(c => c.id === category.id);
    open(event, () => (
        <Root navId="evi-dm-category" onClose={closeContextMenu} aria-label={t("header.aria", { name: category.name })} onSelect={undefined}>
            <Menu.Group>
                <Menu.Item id="evi-dmc-rename" label={t("menu.rename")} action={() => openNameDialog({ category })} />
                <Menu.Item id="evi-dmc-up" label={t("menu.moveUp")} disabled={index <= 0} action={() => commit(moveCategory(state, category.id, -1))} />
                <Menu.Item
                    id="evi-dmc-down"
                    label={t("menu.moveDown")}
                    disabled={index < 0 || index >= state.categories.length - 1}
                    action={() => commit(moveCategory(state, category.id, 1))}
                />
            </Menu.Group>
            <Menu.Group>
                <Menu.Item id="evi-dmc-new-empty" label={t("menu.new")} action={() => openNameDialog({})} />
                <Menu.Item
                    id="evi-dmc-delete"
                    label={t("menu.delete")}
                    color="danger"
                    subtext={category.channels.length ? t("menu.delete.subtext") : undefined}
                    action={() => commit(deleteCategory(state, category.id))}
                />
            </Menu.Group>
        </Root>
    ));
}

function useStateVersion() {
    const [, rerender] = React.useReducer((n: number) => n + 1, 0);
    React.useEffect(() => {
        listeners.add(rerender);
        return () => void listeners.delete(rerender);
    }, []);
}

function CategoryHeader({ entry }: { entry: LaidOutCategory; }) {
    useStateVersion();
    const showCounts = ctx?.settings.get("showCounts") ?? true;
    // The entry is from the list's last render; the state may be newer
    const category = getCategory(state, entry.category.id) ?? entry.category;
    const expanded = !category.collapsed;
    return (
        <li className="evi-dmc-header" role="none">
            <button
                type="button"
                className="evi-dmc-toggle"
                aria-expanded={expanded}
                title={category.name.length > 20 ? category.name : undefined}
                onClick={() => commit(setCollapsed(state, category.id, expanded))}
                onContextMenu={e => openHeaderMenu(e, category)}
            >
                <span className="evi-dmc-name">{category.name}</span>
                {showCounts && <span className="evi-dmc-count" aria-label={t("header.count", { count: entry.size })}>{entry.size}</span>}
                <svg className="evi-dmc-chevron" viewBox="0 0 24 24" width="12" height="12" aria-hidden="true">
                    <path d="M5.3 9.3a1 1 0 0 1 1.4 0L12 14.58l5.3-5.3a1 1 0 1 1 1.4 1.42l-6 6a1 1 0 0 1-1.4 0l-6-6a1 1 0 0 1 0-1.42Z" fill="currentColor" />
                </svg>
            </button>
        </li>
    );
}

let closeOpen: CloseLayer | undefined;

/** Names a new category (and puts `channelId` in it), or renames `category` */
function openNameDialog(options: { category?: Category; channelId?: string; }) {
    closeOpen?.();
    const close = openLayer(close => <NameDialog {...options} onClose={() => close()} />, {
        onClosed: () => void (closeOpen === close && (closeOpen = undefined)),
    });
    closeOpen = close;
}

function NameDialog({ category, channelId, onClose }: { category?: Category; channelId?: string; onClose(): void; }) {
    const [name, setName] = React.useState(category?.name ?? "");
    const [error, setError] = React.useState<string | null>(null);
    const input = React.useRef<HTMLInputElement>(null);
    const renaming = !!category;

    React.useEffect(() => {
        const previous = document.activeElement as HTMLElement | null;
        input.current?.focus();
        input.current?.select();
        const onKey = (e: KeyboardEvent) => {
            if (e.key !== "Escape") return;
            e.preventDefault();
            e.stopImmediatePropagation();
            onClose();
        };
        window.addEventListener("keydown", onKey, true);
        return () => {
            window.removeEventListener("keydown", onKey, true);
            previous?.focus?.();
        };
    }, []);

    function submit(e: FormEvent) {
        e.preventDefault();
        const problem = nameError(state, name, category?.id);
        if (problem) {
            setError(t(problem === "empty" ? "error.empty" : "error.taken"));
            input.current?.focus();
            return;
        }
        if (category) {
            commit(renameCategory(state, category.id, name));
        } else {
            const created = createCategory(state, name);
            if (!created.category) {
                setError(t("error.max"));
                return;
            }
            commit(channelId ? assign(created.state, channelId, created.category.id) : created.state);
        }
        onClose();
    }

    return (
        <div className="evi-dmc-scrim evi-scrim" onMouseDown={e => e.target === e.currentTarget && onClose()}>
            <div className="evi-dmc-modal evi-modal" role="dialog" aria-modal="true" aria-labelledby="evi-dmc-title">
                <header className="evi-dmc-head">
                    <h2 id="evi-dmc-title">{renaming ? t("dialog.rename") : t("dialog.new")}</h2>
                    <button type="button" className="evi-dmc-close" aria-label={t("dialog.close")} onClick={onClose}>
                        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
                    </button>
                </header>
                <form className="evi-dmc-body" onSubmit={submit} noValidate>
                    {!renaming && <p className="evi-dmc-hint">{t("dialog.hint")}</p>}
                    <label className="evi-dmc-label" htmlFor="evi-dmc-name">{t("dialog.label")}</label>
                    <input
                        id="evi-dmc-name"
                        ref={input}
                        className="evi-dmc-input"
                        type="text"
                        inputMode="text"
                        value={name}
                        maxLength={MAX_NAME_LENGTH}
                        placeholder={t("dialog.placeholder")}
                        autoComplete="off"
                        spellCheck={false}
                        aria-invalid={!!error}
                        aria-describedby={error ? "evi-dmc-error" : undefined}
                        onChange={e => {
                            setName(e.currentTarget.value);
                            setError(null);
                        }}
                    />
                    {error && <p id="evi-dmc-error" className="evi-dmc-error" role="alert">{error}</p>}
                    <footer className="evi-dmc-foot">
                        <button type="button" className="evi-dmc-button" data-variant="secondary" onClick={onClose}>{t("dialog.cancel")}</button>
                        <button type="submit" className="evi-dmc-button">{renaming ? t("dialog.rename") : t("dialog.create")}</button>
                    </footer>
                </form>
            </div>
        </div>
    );
}

function dmMenuItems(channelId: string): ReactNode {
    const inCategory = categoryOf(state, channelId);
    if (!state.categories.length) {
        return <Menu.Item id="evi-dmc-add-new" label={t("menu.addNew")} action={() => openNameDialog({ channelId })} />;
    }
    const choices: ReactNode[] = state.categories.map(c => (
        <Menu.CheckboxItem
            key={c.id}
            id={`evi-dmc-to-${c.id}`}
            label={c.name}
            checked={c.id === inCategory?.id}
            action={() => commit(assign(state, channelId, c.id === inCategory?.id ? null : c.id))}
        />
    ));
    choices.push(
        <Menu.Separator key="evi-dmc-sep" />,
        <Menu.Item key="evi-dmc-add-new" id="evi-dmc-add-new" label={t("menu.new")} action={() => openNameDialog({ channelId })} />,
    );
    const items = [<Menu.Item key="evi-dmc-add" id="evi-dmc-add" label={inCategory ? t("menu.moveTo") : t("menu.addTo")}>{choices}</Menu.Item>];
    if (inCategory) {
        items.push(
            <Menu.Item key="evi-dmc-remove" id="evi-dmc-remove" label={t("menu.remove", { name: inCategory.name })} action={() => commit(assign(state, channelId, null))} />,
        );
    }
    return items;
}

export default definePlugin({
    settings,
    patches: [LIST_PATCH],

    css: `
.evi-dmc-header { list-style: none; box-sizing: border-box; height: ${HEADER_HEIGHT}px; padding: 8px 4px 4px 8px; }
.evi-dmc-toggle {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    height: 20px;
    padding: 0 8px;
    border: 0;
    border-radius: 4px;
    background: none;
    color: var(--channels-default, var(--text-muted, #949ba4));
    font: inherit;
    font-size: 14px;
    font-weight: 500;
    line-height: 18px;
    text-align: start;
    cursor: pointer;
}
@media (hover: hover) { .evi-dmc-toggle:hover { color: var(--interactive-text-hover, var(--interactive-hover, #dbdee1)); } }
.evi-dmc-toggle:focus-visible { outline: 2px solid var(--focus-primary, #5865f2); outline-offset: 0; }
.evi-dmc-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.evi-dmc-count { flex-shrink: 0; font-size: 12px; font-variant-numeric: tabular-nums; opacity: .75; }
.evi-dmc-chevron { flex-shrink: 0; }
.evi-dmc-toggle[aria-expanded="false"] .evi-dmc-chevron { rotate: -90deg; }
@media (prefers-reduced-motion: no-preference) { .evi-dmc-chevron { transition: rotate 150ms ease-out; } }

.evi-dmc-scrim { position: fixed; inset: 0; z-index: 10000; display: grid; place-items: center; background: rgba(0,0,0,.7); }
.evi-dmc-modal { width: min(420px, calc(100vw - 32px)); border-radius: 12px;
  background: var(--modal-background, var(--background-base-low, #313338)); color: var(--text-default, var(--text-normal, #dbdee1));
  border: 1px solid var(--border-subtle, transparent); box-shadow: var(--shadow-high, 0 8px 24px rgba(0,0,0,.4)); font-family: var(--font-primary); }
.evi-dmc-head { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 16px 16px 0 20px; }
.evi-dmc-head h2 { margin: 0; font-size: 20px; line-height: 24px; font-weight: 600; color: var(--text-strong, var(--header-primary, #f2f3f5)); }
.evi-dmc-close { display: grid; place-items: center; width: 32px; height: 32px; border: 0; border-radius: 8px; background: none; color: var(--interactive-normal, #b5bac1); cursor: pointer; }
@media (hover: hover) { .evi-dmc-close:hover { background: var(--background-modifier-hover, rgba(255,255,255,.06)); color: var(--interactive-hover, #dbdee1); } }
.evi-dmc-body { display: flex; flex-direction: column; padding: 8px 20px 20px; }
.evi-dmc-hint { margin: 0 0 8px; font-size: 14px; line-height: 18px; color: var(--text-muted, #949ba4); text-wrap: pretty; }
.evi-dmc-label { margin: 8px 0 8px; font-size: 14px; font-weight: 500; color: var(--text-default, #dbdee1); }
.evi-dmc-input { width: 100%; box-sizing: border-box; height: 40px; padding: 0 10px; border-radius: 8px; font: inherit; font-size: 15px;
  border: 1px solid var(--input-border, var(--border-subtle, rgba(255,255,255,.08))); background: var(--input-background, var(--background-tertiary, #1e1f22)); color: inherit; }
.evi-dmc-input::placeholder { color: var(--text-muted, #949ba4); }
.evi-dmc-input:focus { outline: 2px solid var(--focus-primary, #5865f2); outline-offset: -1px; }
.evi-dmc-input[aria-invalid="true"] { border-color: var(--status-danger, #f23f43); }
.evi-dmc-error { margin: 8px 0 0; font-size: 14px; line-height: 18px; color: var(--text-feedback-critical, var(--status-danger, #f23f43)); }
.evi-dmc-foot { display: flex; justify-content: flex-end; gap: 8px; margin-top: 24px; }
.evi-dmc-button { height: 38px; padding: 0 16px; border: 0; border-radius: 8px; font: inherit; font-size: 14px; font-weight: 500; white-space: nowrap; cursor: pointer;
  background: var(--button-filled-brand-background, var(--brand-500, #5865f2)); color: var(--white, #fff); transition: background-color 150ms ease-out, scale 200ms ease-out; }
@media (hover: hover) {
  .evi-dmc-button:hover { background: var(--button-filled-brand-background-hover, var(--brand-560, #4752c4)); }
  .evi-dmc-button[data-variant="secondary"]:hover { background: var(--button-secondary-background-hover, rgba(255,255,255,.12)); }
}
.evi-dmc-button:active { scale: .97; }
.evi-dmc-button[data-variant="secondary"] { background: var(--button-secondary-background, rgba(255,255,255,.08)); color: var(--text-default, #dbdee1); }
.evi-dmc-button:focus-visible, .evi-dmc-close:focus-visible { outline: 2px solid var(--focus-primary, #5865f2); outline-offset: 2px; }
@media (prefers-reduced-motion: reduce) { .evi-dmc-button { transition: none; } .evi-dmc-button:active { scale: none; } }
`,

    /** Patched in: the list's section sizes, or undefined for Discord's own */
    sections(instance: DmList, ids: string[], pinnedRows: number) {
        list = instance;
        wrapRowHeight(instance);
        try {
            if (!ctx || !Array.isArray(ids)) return void (current = PLAIN);
            current = laidOut(ids, instance.props.selectedChannelId);
            currentIds = ids;
            shownWhileCollapsed = collapsedKey(current);
            if (current.plain) return;
            return currentSizes = sectionSizes(current, pinnedRows, ids.length);
        } catch (err) {
            ctx?.logger.error("Couldn't lay out the DM list", err);
            current = PLAIN;
        }
    },

    /** Patched in: the index into the DM ids a row shows, -1 for none, undefined for Discord's rows */
    rowIndex(section: number, row: number) {
        return ctx ? rowIndex(current, section, row) : undefined;
    },

    /** Patched in: a category's header, undefined for Discord's headers */
    renderSection(section: number) {
        const entry = ctx && sectionCategory(current, section);
        if (!entry) return;
        return <CategoryHeader key={`evi-dmc-${entry.category.id}`} entry={entry} />;
    },

    sectionHeight(section: number) {
        return ctx && sectionCategory(current, section) ? HEADER_HEIGHT : undefined;
    },

    /** Patched in: scrolls to a DM wherever the categories put it. False leaves it to Discord */
    scrollToChannel(instance: DmList, channelId: string | null) {
        if (!ctx || current.plain || channelId == null || instance !== list) return false;
        try {
            const where = rowOffset(
                current, currentIds, channelId, currentSizes, instance.props.padding ?? 8,
                s => instance.getSectionHeight(s), (s, r) => instance.getRowHeight(s, r),
            );
            if (where === "collapsed") return true;
            if (!where || !instance._list?.scrollIntoViewRect) return false;
            instance._list.scrollIntoViewRect({ start: Math.max(where.top - 8, 0), end: where.top + where.height + 8 });
            return true;
        } catch (err) {
            ctx.logger.error("Couldn't scroll to the DM", err);
            return false;
        }
    },

    start(context) {
        ctx = context;
        state = parseState(storage()?.get(STORAGE_KEY));
        context.settings.onChange(refresh);

        const readStates = getStore("ReadStateStore");
        if (readStates?.addChangeListener) {
            readStates.addChangeListener(onReadState);
            context.onDispose(() => readStates.removeChangeListener?.(onReadState));
        }

        // A DM in the list (or its chat): the menu is the other person's, with the DM as its channel
        context.contextMenu("user-context", (children, props) => {
            const channel = props?.channel;
            if (channel?.id && channel.type === DM && !channel.guild_id) children.push(<Menu.Group key="evi-dmc">{dmMenuItems(channel.id)}</Menu.Group>);
        });
        context.contextMenu("gdm-context", (children, props) => {
            const channel = props?.channel;
            if (channel?.id && channel.type === GROUP_DM) children.push(<Menu.Group key="evi-dmc">{dmMenuItems(channel.id)}</Menu.Group>);
        });

        // Discord's list is back to its own sections once the plugin is off
        context.onDispose(() => {
            closeOpen?.({ instant: true });
            ctx = undefined;
            current = PLAIN;
            try {
                list?.forceUpdate();
            } catch { /* unmounted */ }
            list = undefined;
        });
        refresh();
    },
});
