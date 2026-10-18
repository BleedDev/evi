import type { SourcePatch } from "@evi/api";

/**
 * Pure pieces of DM Categories: the category data, every change to it, and how the DM list is laid
 * out with it. Free of Discord and Evi runtime imports so tests can run them. Every change returns a
 * new state (or the same object when nothing changed) and never mutates its input.
 *
 * A category holds DM and group DM channel ids. A DM is in at most one category, since being in one
 * moves it out of Direct Messages. Ids of closed DMs are kept: reopening a DM gives it the same id,
 * so it comes back in its category.
 */

export interface Category {
    id: string;
    name: string;
    collapsed: boolean;
    /** Channel ids, most recently added first */
    channels: string[];
}

export interface CategoryState {
    categories: Category[];
}

export const EMPTY: CategoryState = { categories: [] };
export const MAX_NAME_LENGTH = 32;
export const MAX_CATEGORIES = 50;
/** Across every category. Adding past it drops the oldest additions */
export const MAX_CHANNELS = 2000;

export function makeId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/** A trimmed, length-capped category name, or "" when there is nothing usable */
export function cleanName(name: unknown) {
    return typeof name === "string" ? name.replace(/\s+/g, " ").trim().slice(0, MAX_NAME_LENGTH) : "";
}

/** A valid state from whatever was stored: drops broken categories, duplicate ids and channels in two categories */
export function parseState(raw: unknown): CategoryState {
    const list = (raw as CategoryState | null)?.categories;
    if (!Array.isArray(list)) return EMPTY;
    const ids = new Set<string>();
    const seen = new Set<string>();
    const categories: Category[] = [];
    for (const item of list) {
        if (!item || typeof item !== "object" || categories.length >= MAX_CATEGORIES) continue;
        const { id, name, collapsed, channels } = item as Partial<Category>;
        const clean = cleanName(name);
        if (typeof id !== "string" || !id || ids.has(id) || !clean) continue;
        ids.add(id);
        const kept: string[] = [];
        for (const channel of Array.isArray(channels) ? channels : []) {
            if (typeof channel !== "string" || !/^\d{1,20}$/.test(channel) || seen.has(channel) || seen.size >= MAX_CHANNELS) continue;
            seen.add(channel);
            kept.push(channel);
        }
        categories.push({ id, name: clean, collapsed: collapsed === true, channels: kept });
    }
    return categories.length ? { categories } : EMPTY;
}

export const getCategory = (state: CategoryState, id: string | null | undefined) => id ? state.categories.find(c => c.id === id) : undefined;
export const categoryOf = (state: CategoryState, channelId: string) => state.categories.find(c => c.channels.includes(channelId));

/** Why a name can't be used, or null when it can. Names are unique, ignoring case */
export function nameError(state: CategoryState, name: unknown, exceptId?: string): "empty" | "taken" | null {
    const clean = cleanName(name);
    if (!clean) return "empty";
    const taken = state.categories.some(c => c.id !== exceptId && c.name.toLowerCase() === clean.toLowerCase());
    return taken ? "taken" : null;
}

function update(state: CategoryState, id: string, change: (c: Category) => Category): CategoryState {
    let changed = false;
    const categories = state.categories.map(c => {
        if (c.id !== id) return c;
        const next = change(c);
        if (next !== c) changed = true;
        return next;
    });
    return changed ? { categories } : state;
}

export function createCategory(state: CategoryState, name: string, id = makeId()): { state: CategoryState; category?: Category; } {
    if (nameError(state, name) || getCategory(state, id) || state.categories.length >= MAX_CATEGORIES) return { state };
    const category: Category = { id, name: cleanName(name), collapsed: false, channels: [] };
    return { state: { categories: [...state.categories, category] }, category };
}

export function renameCategory(state: CategoryState, id: string, name: string): CategoryState {
    if (nameError(state, name, id)) return state;
    const clean = cleanName(name);
    return update(state, id, c => c.name === clean ? c : { ...c, name: clean });
}

export function deleteCategory(state: CategoryState, id: string): CategoryState {
    if (!getCategory(state, id)) return state;
    const categories = state.categories.filter(c => c.id !== id);
    return categories.length ? { categories } : EMPTY;
}

/** Moves a category up (-1) or down (+1) in the list */
export function moveCategory(state: CategoryState, id: string, by: number): CategoryState {
    const from = state.categories.findIndex(c => c.id === id);
    const to = from + by;
    if (from < 0 || to < 0 || to >= state.categories.length || to === from) return state;
    const categories = [...state.categories];
    const [moved] = categories.splice(from, 1);
    categories.splice(to, 0, moved);
    return { categories };
}

export function setCollapsed(state: CategoryState, id: string, collapsed: boolean): CategoryState {
    return update(state, id, c => c.collapsed === collapsed ? c : { ...c, collapsed });
}

/** Puts a channel in a category, taking it out of any other; null takes it out of every category */
export function assign(state: CategoryState, channelId: string, categoryId: string | null): CategoryState {
    const current = categoryOf(state, channelId);
    if ((current?.id ?? null) === categoryId) return state;
    if (categoryId && !getCategory(state, categoryId)) return state;
    let total = 0;
    for (const c of state.categories) total += c.channels.length;
    const full = !current && total >= MAX_CHANNELS;
    const categories = state.categories.map(c => {
        let channels = c.channels;
        if (c.id === current?.id) channels = channels.filter(id => id !== channelId);
        if (c.id === categoryId) channels = [channelId, ...channels];
        return channels === c.channels ? c : { ...c, channels };
    });
    // Over the cap: drop the oldest addition, from whichever category holds the most
    if (full) {
        const biggest = categories.reduce((a, b) => b.channels.length > a.channels.length ? b : a);
        const i = categories.indexOf(biggest);
        categories[i] = { ...biggest, channels: biggest.channels.slice(0, -1) };
    }
    return { categories };
}

export interface LaidOutCategory {
    category: Category;
    /** Indexes into the DM list's channel ids, in display order. While collapsed, only the ones it keeps showing */
    rows: number[];
    /** How many of its DMs are open, collapsed or not */
    size: number;
}

export interface Layout {
    /** Nothing to change: no categories, or no DMs at all (Discord's empty list illustration shows) */
    plain: boolean;
    categories: LaidOutCategory[];
    /** Indexes of the DMs in no category, in Discord's order */
    rest: number[];
}

export const PLAIN: Layout = { plain: true, categories: [], rest: [] };

/**
 * Splits the DM list's ids (Discord's order: latest message first) into categories and the rest.
 * `compare` orders the DMs inside a category; without it they keep Discord's order. A collapsed
 * category still shows the DMs `keep` accepts (the open one, unread ones), like Discord's channel
 * categories do.
 */
export function layout(
    ids: readonly string[],
    state: CategoryState,
    compare?: (a: string, b: string) => number,
    keep?: (id: string) => boolean,
): Layout {
    if (!state.categories.length || !ids.length) return PLAIN;
    const index = new Map<string, number>();
    ids.forEach((id, i) => index.set(id, i));
    const grouped = new Set<number>();
    const categories = state.categories.map(category => {
        const rows: number[] = [];
        for (const id of category.channels) {
            const i = index.get(id);
            if (i === undefined || grouped.has(i)) continue;
            grouped.add(i);
            rows.push(i);
        }
        rows.sort(compare ? (a, b) => compare(ids[a], ids[b]) || a - b : (a, b) => a - b);
        const shown = category.collapsed ? keep ? rows.filter(i => keep(ids[i])) : [] : rows;
        return { category, rows: shown, size: rows.length };
    });
    const rest: number[] = [];
    for (let i = 0; i < ids.length; i++) if (!grouped.has(i)) rest.push(i);
    return { plain: false, categories, rest };
}

/**
 * The list's sections: Discord's own rows (Friends, Nitro...) first, one per category, then Direct
 * Messages. Direct Messages keeps one row when it's the only thing there, for Discord's empty
 * illustration; when categories hold every DM it has none, and just its header shows.
 * Discord's list drops a section with no rows, header and all, so a category showing no DMs
 * (collapsed, or every DM closed) keeps one empty row, which `isPlaceholder` gives no height.
 */
export function sectionSizes(l: Layout, pinnedRows: number, dmCount: number): number[] {
    if (l.plain) return [pinnedRows, Math.max(dmCount, 1)];
    return [pinnedRows, ...l.categories.map(c => Math.max(c.rows.length, 1)), l.rest.length];
}

/** The empty row that keeps a category with no DMs showing on the list */
export const isPlaceholder = (l: Layout, section: number, row: number) =>
    !l.plain && row === 0 && l.categories[section - 1]?.rows.length === 0;

/** The category a section shows, or undefined for Discord's sections */
export const sectionCategory = (l: Layout, section: number) => l.plain ? undefined : l.categories[section - 1];

/** The DM list index a row shows, -1 for nothing, or undefined to leave the row to Discord */
export function rowIndex(l: Layout, section: number, row: number): number | undefined {
    if (l.plain || section === 0) return;
    const category = l.categories[section - 1];
    if (category) return category.rows[row] ?? -1;
    return section === l.categories.length + 1 ? l.rest[row] ?? -1 : -1;
}

/** Where a DM is: its section and row, "collapsed" when its category is, or undefined when it isn't in the list */
export function locate(l: Layout, ids: readonly string[], channelId: string): { section: number; row: number; } | "collapsed" | undefined {
    const i = ids.indexOf(channelId);
    if (l.plain || i < 0) return;
    for (let s = 0; s < l.categories.length; s++) {
        const { category, rows } = l.categories[s];
        const row = rows.indexOf(i);
        if (row >= 0) return { section: s + 1, row };
        if (category.collapsed && category.channels.includes(channelId)) return "collapsed";
    }
    const row = l.rest.indexOf(i);
    return row >= 0 ? { section: l.categories.length + 1, row } : undefined;
}

/**
 * Where a DM's row sits in the list, in pixels from the top, for scrolling to it: "collapsed" when
 * its category hides it, undefined when it isn't in the list. `sizes` are the list's section sizes.
 */
export function rowOffset(
    l: Layout,
    ids: readonly string[],
    channelId: string,
    sizes: readonly number[],
    padding: number,
    sectionHeight: (section: number) => number,
    rowHeight: (section: number, row: number) => number,
): { top: number; height: number; } | "collapsed" | undefined {
    const where = locate(l, ids, channelId);
    if (!where || where === "collapsed") return where;
    let top = padding;
    for (let s = 0; s <= where.section; s++) {
        top += sectionHeight(s);
        const rows = s === where.section ? where.row : sizes[s] ?? 0;
        for (let r = 0; r < rows; r++) top += rowHeight(s, r);
    }
    return { top, height: rowHeight(where.section, where.row) };
}

/**
 * Discord's DM list (checked September 2026) is a class component rendering a sectioned list:
 * section 0 holds the rows above the DMs, section 1 the DMs, under a "Direct Messages" header.
 *
 *   renderRow=e=>{let{section:t,row:n}=e,{privateChannelIds:r}=this.props;return 0===t?this.renderChild(n):…this.renderDM(t,n)};
 *   renderSection=e=>{let{section:t}=e;return 0===t?null:(…"Direct Messages" header…)};
 *   getSectionHeight=e=>24*(0!==e);
 *   scrollToChannel(e){…r+=44*(i+n)+t…}
 *   sections:[n,Math.max(e.length,1)]
 *
 * The patches add a section per category between the two. Rows still render through Discord's own
 * renderDM(section, index), which only uses the index into privateChannelIds, so every DM row is
 * exactly Discord's. All-or-nothing (`group`): a list with sections but no headers would be worse
 * than no categories.
 */
export const LIST_PATCH: SourcePatch = {
    find: '"no-private-channels"',
    group: true,
    replace: [
        {
            match: /sections:\[(\i),Math\.max\((\i)\.length,1\)\]/,
            with: "sections:$self?.sections?.(this,$2,$1)??[$1,Math.max($2.length,1)]",
        },
        {
            match: /renderRow=(\i)=>\{let\{section:(\i),row:(\i)\}=\1,\{privateChannelIds:\i\}=this\.props;/,
            with: "$&{let eviRow=$self?.rowIndex?.($2,$3);if(eviRow!==void 0)return eviRow<0?null:this.renderDM($2,eviRow)}",
        },
        {
            match: /renderSection=(\i)=>\{let\{section:(\i)\}=\1;/,
            with: "$&{let eviHeader=$self?.renderSection?.($2);if(eviHeader!==void 0)return eviHeader}",
        },
        {
            match: /getSectionHeight=(\i)=>(24\*\(0!==\1\))/,
            with: "getSectionHeight=$1=>$self?.sectionHeight?.($1)??$2",
        },
        {
            match: /scrollToChannel\((\i)\)\{/,
            with: "$&if($self?.scrollToChannel?.(this,$1))return;",
        },
    ],
};
