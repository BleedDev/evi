import { describe, expect, test } from "bun:test";

import {
    assign, CategoryState, categoryOf, cleanName, createCategory, deleteCategory, EMPTY, layout, LIST_PATCH, locate, MAX_CATEGORIES, MAX_CHANNELS,
    isPlaceholder, moveCategory, nameError, parseState, PLAIN, renameCategory, rowIndex, rowOffset, sectionCategory, sectionSizes, setCollapsed,
} from "../plugins/dm-categories/categories";
import type { Layout } from "../plugins/dm-categories/categories";
import type { Replacement } from "../src/renderer/patching/source";
import { canonicalizeMatch, matchesFind } from "../src/renderer/patching/source";

// Verbatim from Discord's web build (September 2026), trimmed to the DM list class's methods the
// patch touches; the "Direct Messages" header's children and render's list props are cut down
const LIST_SOURCE = "class q{"
    + "scrollToChannel(e){if(null==this._list)return;let{padding:t}=this.props,{preRenderedChildren:n}=this.state,i=null!=e?this.props.privateChannelIds.indexOf(e):-1,r=0;i<0||null==e?this._list.scrollTo({to:r}):(r+=44*(i+n)+t,this._list.scrollIntoViewRect({start:Math.max(r-8,0),end:r+44+8}))}"
    + "getSectionHeight=e=>24*(0!==e);"
    + 'renderDM=(e,t)=>{let{privateChannelIds:n,channels:r,selectedChannelId:a}=this.props,{totalRowCount:s,preRenderedChildren:l}=this.state,o=r[n[t]];return null==o?null:(0,i.jsx)(K.Ay,{channel:o,selected:o.id===a,"aria-posinset":l+t+1,"aria-setsize":s},o.id)};'
    + 'renderRow=e=>{let{section:t,row:n}=e,{privateChannelIds:r}=this.props;return 0===t?this.renderChild(n):0===n&&0===r.length?(0,i.jsx)(X,{},"no-private-channels"):this.renderDM(t,n)};'
    + 'renderSection=e=>{let{section:t}=e;return 0===t?null:(0,i.jsxs)(S.A,{className:z._e,children:"Direct Messages"},t)};'
    + "renderChild=e=>({child:e});"
    + "getRowHeight=(e,t)=>0===e?40:44;"
    + "render(){let{privateChannelIds:e,padding:t}=this.props,{preRenderedChildren:n}=this.state;return{sections:[n,Math.max(e.length,1)]}}"
    + "}";

const replacements = ([] as Replacement[]).concat(LIST_PATCH.replace);
const patch = (code: string) => replacements.reduce((next, r) => next.replace(canonicalizeMatch(r.match) as RegExp, (r.with as string).replaceAll("$self", "P")), code);

function withCategories(...names: string[]) {
    let state: CategoryState = EMPTY;
    names.forEach((name, i) => void (state = createCategory(state, name, `c${i}`).state));
    return state;
}

describe("dm categories: category CRUD", () => {
    test("create trims names and rejects empty, duplicate (case-insensitive) and too many", () => {
        const a = createCategory(EMPTY, "  Friends  ", "a");
        expect(a.category).toEqual({ id: "a", name: "Friends", collapsed: false, channels: [] });
        expect(createCategory(a.state, "FRIENDS", "b").category).toBeUndefined();
        expect(createCategory(a.state, "FRIENDS", "b").state).toBe(a.state);
        expect(createCategory(a.state, "  ", "b").category).toBeUndefined();
        expect(createCategory(a.state, "Other", "a").category).toBeUndefined();
        expect(nameError(a.state, "friends")).toBeTruthy();
        expect(nameError(a.state, "friends", "a")).toBeNull();
        expect(cleanName("x".repeat(100)).length).toBe(32);
        const full = withCategories(...Array.from({ length: MAX_CATEGORIES }, (_, i) => `n${i}`));
        expect(createCategory(full, "One more").category).toBeUndefined();
    });

    test("rename, delete and move", () => {
        const state = withCategories("A", "B", "C");
        expect(renameCategory(state, "c0", "b")).toBe(state);
        expect(renameCategory(state, "c0", "A")).toBe(state);
        expect(renameCategory(state, "c0", "Work").categories[0].name).toBe("Work");
        expect(deleteCategory(state, "c1").categories.map(c => c.id)).toEqual(["c0", "c2"]);
        expect(deleteCategory(withCategories("A"), "c0")).toBe(EMPTY);
        expect(deleteCategory(state, "nope")).toBe(state);
        expect(moveCategory(state, "c2", -1).categories.map(c => c.id)).toEqual(["c0", "c2", "c1"]);
        expect(moveCategory(state, "c0", 1).categories.map(c => c.id)).toEqual(["c1", "c0", "c2"]);
        expect(moveCategory(state, "c0", -1)).toBe(state);
        expect(moveCategory(state, "c2", 1)).toBe(state);
        expect(setCollapsed(state, "c0", false)).toBe(state);
        expect(setCollapsed(state, "c0", true).categories[0].collapsed).toBe(true);
    });

    test("a DM is in one category at most, newest first", () => {
        let state = withCategories("A", "B");
        state = assign(state, "1", "c0");
        state = assign(state, "2", "c0");
        expect(state.categories[0].channels).toEqual(["2", "1"]);
        state = assign(state, "1", "c1");
        expect(state.categories[0].channels).toEqual(["2"]);
        expect(state.categories[1].channels).toEqual(["1"]);
        expect(categoryOf(state, "1")?.id).toBe("c1");
        expect(assign(state, "1", "c1")).toBe(state);
        expect(assign(state, "3", "missing")).toBe(state);
        state = assign(state, "1", null);
        expect(categoryOf(state, "1")).toBeUndefined();
    });

    test("adding past the cap drops the oldest addition", () => {
        let state = withCategories("A");
        state = { categories: [{ ...state.categories[0], channels: Array.from({ length: MAX_CHANNELS }, (_, i) => String(i)) }] };
        state = assign(state, "new", "c0");
        expect(state.categories[0].channels.length).toBe(MAX_CHANNELS);
        expect(state.categories[0].channels[0]).toBe("new");
        expect(state.categories[0].channels).not.toContain(String(MAX_CHANNELS - 1));
    });

    test("parseState keeps what's valid", () => {
        expect(parseState(null)).toBe(EMPTY);
        expect(parseState({ categories: "no" })).toBe(EMPTY);
        expect(parseState({
            categories: [
                { id: "a", name: " A ", collapsed: true, channels: ["1", "1", "x", 5, "2"] },
                { id: "a", name: "Dup id", channels: [] },
                { id: "b", name: "", channels: [] },
                { id: "c", name: "C", collapsed: "yes", channels: ["2", "3"] },
                null,
            ],
        })).toEqual({
            categories: [
                { id: "a", name: "A", collapsed: true, channels: ["1", "2"] },
                { id: "c", name: "C", collapsed: false, channels: ["3"] },
            ],
        });
        const state = assign(withCategories("A", "B"), "9", "c1");
        expect(parseState(JSON.parse(JSON.stringify(state)))).toEqual(state);
    });
});

describe("dm categories: laying out the list", () => {
    const ids = ["10", "11", "12", "13", "14"];
    let state = withCategories("Work", "Friends");
    state = assign(state, "13", "c0");
    state = assign(state, "11", "c0");
    state = assign(state, "12", "c1");
    state = assign(state, "99", "c1"); // a closed DM

    test("plain without categories or DMs", () => {
        expect(layout(ids, EMPTY)).toBe(PLAIN);
        expect(layout([], state)).toBe(PLAIN);
        expect(sectionSizes(PLAIN, 3, 0)).toEqual([3, 1]);
        expect(sectionSizes(PLAIN, 3, 7)).toEqual([3, 7]);
    });

    test("categories take their DMs out of Direct Messages, in Discord's order", () => {
        const l = layout(ids, state);
        expect(l.categories.map(c => c.rows)).toEqual([[1, 3], [2]]);
        expect(l.categories.map(c => c.size)).toEqual([2, 1]);
        expect(l.rest).toEqual([0, 4]);
        expect(sectionSizes(l, 3, ids.length)).toEqual([3, 2, 1, 2]);
        expect(sectionCategory(l, 1)?.category.name).toBe("Work");
        expect(sectionCategory(l, 3)).toBeUndefined();
        expect(rowIndex(l, 0, 0)).toBeUndefined();
        expect(rowIndex(l, 1, 1)).toBe(3);
        expect(rowIndex(l, 3, 1)).toBe(4);
        expect(rowIndex(l, 3, 2)).toBe(-1);
    });

    test("a comparator orders inside categories", () => {
        const names: Record<string, string> = { 11: "zed", 13: "amy" };
        const l = layout(ids, state, (a, b) => names[a].localeCompare(names[b]));
        expect(l.categories[0].rows).toEqual([3, 1]);
    });

    test("collapsed categories keep the DMs `keep` accepts", () => {
        const collapsed = setCollapsed(state, "c0", true);
        expect(layout(ids, collapsed).categories[0]).toMatchObject({ rows: [], size: 2 });
        const l = layout(ids, collapsed, undefined, id => id === "13");
        expect(l.categories[0].rows).toEqual([3]);
        expect(locate(l, ids, "13")).toEqual({ section: 1, row: 0 });
        expect(locate(l, ids, "11")).toBe("collapsed");
        expect(locate(l, ids, "14")).toEqual({ section: 3, row: 1 });
        expect(locate(l, ids, "404")).toBeUndefined();
    });

    test("a category showing no DMs keeps one placeholder row, so its header stays", () => {
        const l = layout(ids, setCollapsed(state, "c0", true));
        expect(sectionSizes(l, 3, ids.length)).toEqual([3, 1, 1, 2]);
        expect(isPlaceholder(l, 1, 0)).toBe(true);
        expect(rowIndex(l, 1, 0)).toBe(-1);
        expect(isPlaceholder(l, 2, 0)).toBe(false);
        expect(isPlaceholder(l, 3, 0)).toBe(false);
        expect(isPlaceholder(layout(ids, state), 1, 0)).toBe(false);
    });

    test("every DM in a category leaves Direct Messages with no rows", () => {
        let all = withCategories("All");
        for (const id of ids) all = assign(all, id, "c0");
        const l = layout(ids, all);
        expect(sectionSizes(l, 2, ids.length)).toEqual([2, 5, 0]);
    });

    test("row offsets count headers and rows above", () => {
        const l = layout(ids, state);
        const sizes = sectionSizes(l, 2, ids.length);
        const header = (s: number) => s === 0 ? 0 : s <= 2 ? 32 : 24;
        const row = (s: number) => s === 0 ? 40 : 44;
        // padding 8, section 0 (2 rows of 40), Work header 32 + 2 rows, Friends header 32 + 1 row, DM header 24, then row 1
        expect(rowOffset(l, ids, "14", sizes, 8, header, row)).toEqual({ top: 8 + 80 + 32 + 88 + 32 + 44 + 24 + 44, height: 44 });
        expect(rowOffset(l, ids, "13", sizes, 8, header, row)).toEqual({ top: 8 + 80 + 32 + 44, height: 44 });
        expect(rowOffset(layout(ids, setCollapsed(state, "c0", true)), ids, "13", sizes, 8, header, row)).toBe("collapsed");
        expect(rowOffset(l, ids, "404", sizes, 8, header, row)).toBeUndefined();
    });
});

describe("dm categories: DM list patch", () => {
    test("matches Discord's DM list, each replacement once, and still parses", () => {
        expect(matchesFind(LIST_SOURCE, LIST_PATCH.find)).toBe(true);
        let next = LIST_SOURCE;
        for (const r of replacements) {
            const re = canonicalizeMatch(r.match) as RegExp;
            expect(LIST_SOURCE.match(new RegExp(re.source, "g"))?.length).toBe(1);
            const before = next;
            next = next.replace(re, (r.with as string).replaceAll("$self", "P"));
            expect(next).not.toBe(before);
        }
        expect(() => new Function(`return ${next}`)).not.toThrow();
    });

    const jsx = (type: unknown, props: any, key?: string) => ({ type, props, key });
    const deps = { i: { jsx, jsxs: jsx }, K: { Ay: "DMRow" }, X: "Empty", S: { A: "Header" }, z: {} };

    function mount(P: unknown, ids: string[]) {
        const Cls = new Function("i", "K", "X", "S", "z", "P", `return ${patch(LIST_SOURCE)}`)(deps.i, deps.K, deps.X, deps.S, deps.z, P);
        const list = new Cls();
        const scrolled: unknown[] = [];
        list.props = { privateChannelIds: ids, channels: Object.fromEntries(ids.map(id => [id, { id }])), padding: 8, selectedChannelId: null };
        list.state = { preRenderedChildren: 2, totalRowCount: ids.length + 2 };
        list._list = { scrollTo: (x: unknown) => scrolled.push(["top", x]), scrollIntoViewRect: (x: unknown) => scrolled.push(x) };
        return { list, scrolled };
    }

    /** What DM Categories' index.tsx does with the patched-in calls */
    function plugin(state: CategoryState) {
        let current: Layout = PLAIN;
        let ids: string[] = [];
        let sizes: number[] = [];
        return {
            sections(_: unknown, list: string[], pinned: number) {
                current = layout(list, state);
                ids = list;
                return current.plain ? undefined : sizes = sectionSizes(current, pinned, list.length);
            },
            rowIndex: (s: number, r: number) => rowIndex(current, s, r),
            renderSection: (s: number) => sectionCategory(current, s) ? { header: sectionCategory(current, s)!.category.name } : undefined,
            sectionHeight: (s: number) => sectionCategory(current, s) ? 32 : undefined,
            scrollToChannel(list: any, id: string) {
                const where = rowOffset(current, ids, id, sizes, list.props.padding, s => list.getSectionHeight(s), (s, r) => list.getRowHeight(s, r));
                if (where === "collapsed") return true;
                if (!where) return false;
                list._list.scrollIntoViewRect({ start: where.top - 8, end: where.top + where.height + 8 });
                return true;
            },
        };
    }

    test("patched list renders categories with Discord's own DM rows", () => {
        let state = withCategories("Work");
        state = assign(state, "12", "c0");
        const { list, scrolled } = mount(plugin(state), ["10", "11", "12"]);
        expect(list.render().sections).toEqual([2, 1, 2]);
        expect(list.renderSection({ section: 1 })).toEqual({ header: "Work" });
        expect(list.renderSection({ section: 2 }).props.children).toBe("Direct Messages");
        expect(list.renderRow({ section: 1, row: 0 })).toMatchObject({ type: "DMRow", key: "12" });
        expect(list.renderRow({ section: 2, row: 0 })).toMatchObject({ type: "DMRow", key: "10" });
        expect(list.renderRow({ section: 2, row: 1 })).toMatchObject({ type: "DMRow", key: "11" });
        expect(list.renderRow({ section: 0, row: 1 })).toEqual({ child: 1 });
        expect(list.getSectionHeight(1)).toBe(32);
        expect(list.getSectionHeight(2)).toBe(24);
        list.scrollToChannel("11");
        // padding 8 + 2 rows of 40 + header 32 + row 44 + DM header 24 + row 44
        expect(scrolled.pop()).toEqual({ start: 8 + 80 + 32 + 44 + 24 + 44 - 8, end: 8 + 80 + 32 + 44 + 24 + 44 + 44 + 8 });
    });

    test("with the plugin off the list is exactly Discord's", () => {
        const { list, scrolled } = mount(undefined, ["10", "11"]);
        expect(list.render().sections).toEqual([2, 2]);
        expect(list.renderRow({ section: 1, row: 1 })).toMatchObject({ type: "DMRow", key: "11" });
        expect(list.renderSection({ section: 1 }).props.children).toBe("Direct Messages");
        expect(list.getSectionHeight(1)).toBe(24);
        list.scrollToChannel("11");
        expect(scrolled.pop()).toEqual({ start: 44 * 3 + 8 - 8, end: 44 * 3 + 8 + 44 + 8 });
        const empty = mount(undefined, []);
        expect(empty.list.render().sections).toEqual([2, 1]);
        expect(empty.list.renderRow({ section: 1, row: 0 })).toMatchObject({ type: "Empty", key: "no-private-channels" });
    });
});
