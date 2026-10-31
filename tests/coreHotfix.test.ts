import { afterEach, describe, expect, test } from "bun:test";

import { CORE_HOTFIX_ID, Hotfix, HotfixInput, HOTFIX_LIMITS, parseHotfixes, validateHotfixInput } from "../src/shared/hotfixes";
import { CoreHotfix } from "../src/renderer/coreHotfix";
import { CORE_PATCH_SLOTS, coreOriginalPatch, getPatchRecords, refixCorePatches, registerPatches, SourcePatch, unregisterPatches } from "../src/renderer/patching/source";
import { filters, pendingWaiters, waitFor } from "../src/renderer/webpack/find";

const core = (extra: Record<string, unknown> = {}) => ({ plugin: CORE_HOTFIX_ID, from: "3.2.0", to: "3.2.0", note: "The user panel switches show again.", ...extra });

const published = (extra: Record<string, unknown>, id = 1, revision = 1): Hotfix =>
    ({ id, revision, at: 1000, ...(validateHotfixInput(core(extra)) as { hotfix: HotfixInput; }).hotfix });

afterEach(() => {
    CoreHotfix.init([], false, "0.0.0");
    unregisterPatches(CORE_HOTFIX_ID);
});

describe("hotfixes for Evi itself and CSS: what an admin can publish", () => {
    test("CSS alone is a hotfix, kept as written", () => {
        const css = ".dl-plugin-grid {\n    align-items: stretch;\n}";
        expect(validateHotfixInput(core({ css }))).toEqual({ hotfix: { ...core(), patches: [], lookups: [], css } });
    });
    test("a plugin's hotfix can carry CSS too, next to its patches", () => {
        const checked = validateHotfixInput({ plugin: "fake-deafen", note: "Fixed.", patches: [{ index: 0, find: "x" }], css: "a{color:red}" });
        expect("hotfix" in checked && checked.hotfix.css).toBe("a{color:red}");
    });
    test("blank CSS with nothing else isn't a hotfix; too much or control characters is refused", () => {
        expect(validateHotfixInput(core({ css: "   " }))).toHaveProperty("error");
        expect(validateHotfixInput(core({ css: "a".repeat(HOTFIX_LIMITS.css + 1) }))).toHaveProperty("error");
        expect(validateHotfixInput(core({ css: "a{}\u0000" }))).toHaveProperty("error");
        expect(validateHotfixInput(core({ css: 12 }))).toHaveProperty("error");
    });
    test("Evi's own patches need the find they have now", () => {
        expect(validateHotfixInput(core({ patches: [{ index: 2, find: "\"new\"" }] }))).toHaveProperty("error");
        expect(validateHotfixInput(core({ patches: [{ index: 2, was: "\"old\"", find: "\"new\"" }] }))).toHaveProperty("hotfix");
    });
    test("Evis before 3.2.0 get nothing they could misread: a CSS-only fix has no patches or lookups (their check drops it)", () => {
        const [fix] = parseHotfixes({ hotfixes: [{ id: 1, revision: 1, at: 1, ...core({ css: "a{}" }) }] });
        expect(fix.patches).toEqual([]);
        expect(fix.lookups).toEqual([]);
    });
});

describe("hotfixes for Evi itself: which one Evi takes", () => {
    test("by Evi's version, and only outside safe mode", () => {
        const fix = published({ css: "a{}" });
        CoreHotfix.init([fix], true, "3.2.0");
        expect(CoreHotfix.get()).toEqual(fix);
        CoreHotfix.init([fix], true, "3.2.1");
        expect(CoreHotfix.get()).toBeUndefined();
        CoreHotfix.init([fix], false, "3.2.0");
        expect(CoreHotfix.get()).toBeUndefined();
    });
    test("a plugin's hotfix is never Evi's", () => {
        CoreHotfix.init([{ ...published({ css: "a{}" }), plugin: "fake-deafen" }], true, "3.2.0");
        expect(CoreHotfix.get()).toBeUndefined();
    });
    test("a change tells its listeners once: a new revision, then a withdrawal", () => {
        CoreHotfix.init([], true, "3.2.0");
        let heard = 0;
        const off = CoreHotfix.subscribe(() => heard++);
        expect(CoreHotfix.set([published({ css: "a{}" })])).toBe(true);
        expect(CoreHotfix.set([published({ css: "a{}" })])).toBe(false);
        expect(CoreHotfix.set([published({ css: "b{}" }, 1, 2)])).toBe(true);
        expect(CoreHotfix.set([])).toBe(true);
        off();
        expect(heard).toBe(3);
    });
});

describe("hotfixes for Evi itself: its patches", () => {
    const panel: SourcePatch = { find: "\".GREEN,positionKeyStemOverride:\"", replace: { match: /old/, with: "new" } };
    const menu: SourcePatch = { find: "menuArgs", replace: { match: /a/, with: "b" } };
    const fixPanel = (find: string, revision = 1) => published({
        patches: [{ index: CORE_PATCH_SLOTS.panel, was: "\".GREEN,positionKeyStemOverride:\"", find, replace: [{ match: { regex: "old2" }, with: "new2" }] }],
    }, 1, revision);

    test("each has its own slot, so the Patches tab and a hotfix tell them apart", () => {
        CoreHotfix.init([], true, "3.2.0");
        registerPatches(CORE_HOTFIX_ID, [menu], CORE_PATCH_SLOTS.contextMenu);
        registerPatches(CORE_HOTFIX_ID, [panel], CORE_PATCH_SLOTS.panel);
        expect(getPatchRecords(CORE_HOTFIX_ID).map(r => r.index)).toEqual([CORE_PATCH_SLOTS.contextMenu, CORE_PATCH_SLOTS.panel]);
        expect(coreOriginalPatch(CORE_PATCH_SLOTS.panel)).toBe(panel);
    });
    test("Evi's fix goes in when the patch registers, for its slot only", () => {
        CoreHotfix.init([fixPanel("\"PanelButtonV2\"")], true, "3.2.0");
        registerPatches(CORE_HOTFIX_ID, [menu], CORE_PATCH_SLOTS.contextMenu);
        registerPatches(CORE_HOTFIX_ID, [panel], CORE_PATCH_SLOTS.panel);
        const [menuRecord, panelRecord] = getPatchRecords(CORE_HOTFIX_ID);
        expect(menuRecord.patch).toBe(menu);
        expect(panelRecord.patch.find).toBe("\"PanelButtonV2\"");
        expect([panelRecord.patch.replace].flat()[0].match).toEqual(/old2/);
    });
    test("a fix whose `was` isn't the patch's find now leaves it alone", () => {
        CoreHotfix.init([published({ patches: [{ index: CORE_PATCH_SLOTS.panel, was: "something else", find: "x" }] })], true, "3.2.0");
        registerPatches(CORE_HOTFIX_ID, [panel], CORE_PATCH_SLOTS.panel);
        expect(getPatchRecords(CORE_HOTFIX_ID)[0].patch).toBe(panel);
    });
    test("a changed fix replaces only the patches it changes, in their place; withdrawing it brings back the patch as written", () => {
        CoreHotfix.init([], true, "3.2.0");
        registerPatches(CORE_HOTFIX_ID, [menu], CORE_PATCH_SLOTS.contextMenu);
        registerPatches(CORE_HOTFIX_ID, [panel], CORE_PATCH_SLOTS.panel);

        CoreHotfix.set([fixPanel("\"PanelButtonV2\"")]);
        const first = refixCorePatches();
        expect(first.replaced.map(r => r.index)).toEqual([CORE_PATCH_SLOTS.panel]);
        expect(first.patches[0].find).toBe("\"PanelButtonV2\"");
        expect(getPatchRecords(CORE_HOTFIX_ID).map(r => [r.index, r.state])).toEqual([[CORE_PATCH_SLOTS.contextMenu, "pending"], [CORE_PATCH_SLOTS.panel, "pending"]]);

        // A new revision with the same fix changes nothing
        CoreHotfix.set([fixPanel("\"PanelButtonV2\"", 2)]);
        expect(refixCorePatches().replaced).toEqual([]);

        CoreHotfix.set([]);
        const back = refixCorePatches();
        expect(back.patches).toEqual([panel]);
        expect(getPatchRecords(CORE_HOTFIX_ID)[1].patch).toBe(panel);
    });
});

describe("hotfixes for Evi itself: its lookups", () => {
    test("anything waiting for a target Evi fixed waits for the new one, and goes back when it's withdrawn", () => {
        const fix = published({ lookups: [{ target: "props eviTestOldName", kind: "props", args: ["eviTestNewName"] }] });
        CoreHotfix.init([fix], true, "3.2.0");
        const stop = waitFor(filters.byProps("eviTestOldName"), () => { });
        expect(pendingWaiters()).toContain("props eviTestNewName");
        expect(pendingWaiters()).not.toContain("props eviTestOldName");

        CoreHotfix.set([]);
        expect(pendingWaiters()).toContain("props eviTestOldName");
        expect(pendingWaiters()).not.toContain("props eviTestNewName");

        CoreHotfix.set([fix]);
        expect(pendingWaiters()).toContain("props eviTestNewName");
        stop();
        expect(pendingWaiters().some(w => w.includes("eviTest"))).toBe(false);
    });
});
