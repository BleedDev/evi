import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { clean as cleanSheet, compoundsOf, isAnchored, isSmallBlur, isStateOf, isUnanchoredHas, raiseTint, splitSelectorList, TINT_ALPHA, unblur } from "../src/renderer/cssFixes";

// Every :has() selector in Discord's web stylesheets (crawled 2026-10-03)
import discordHas from "./fixtures/discord-has-selectors.json";

describe("selectors", () => {
    test("lists split on top-level commas only", () => {
        expect(splitSelectorList(".a:is(.b, .c), [data-x=\"1,2\"] .d")).toEqual([".a:is(.b, .c)", "[data-x=\"1,2\"] .d"]);
    });

    test("compounds keep their combinators", () => {
        expect(compoundsOf(".a > .b:has(+ .c) ~ d e")).toEqual([
            { combinator: "", compound: ".a" },
            { combinator: ">", compound: ".b:has(+ .c)" },
            { combinator: "~", compound: "d" },
            { combinator: " ", compound: "e" },
        ]);
    });

    test("anchored by a class, id, attribute, tag or the root", () => {
        for (const c of [".a:has(*)", "#x:has(*)", "[data-x]:has(*)", "footer:has(> .b)", ":root:has(.modal)", ":where(.a):has(.b)", ":is(.a, b):has(*)"]) expect(isAnchored(c)).toBe(true);
        for (const c of [":has(*)", ":not(:has(*)):not(:empty)", ":not(.a):has(*)", "*:has(.a)", ":is(.a, :hover):has(*)"]) expect(isAnchored(c)).toBe(false);
    });
});

describe("unanchored :has()", () => {
    test("catches Discord's staff text highlighter", () => {
        expect(isUnanchoredHas("[data-text-variant] :not(:has(*)):not(:empty)")).toBe(true);
        expect(isUnanchoredHas(":not([data-text-variant]):not([data-mana-composed] *):not(:has(*)):not(:empty):not(script)")).toBe(true);
    });

    test("catches universal subjects anywhere in the chain", () => {
        expect(isUnanchoredHas(":has(.a)")).toBe(true);
        expect(isUnanchoredHas(".app :has(> img)")).toBe(true);
        expect(isUnanchoredHas("*:has(.a) .b")).toBe(true);
        // A child of something itself unanchored is no better
        expect(isUnanchoredHas(":hover > :has(.a)")).toBe(true);
    });

    test("leaves children and siblings of an anchored compound alone", () => {
        expect(isUnanchoredHas(".container > :has(.editButton)")).toBe(false);
        expect(isUnanchoredHas(".a + :has(.b)")).toBe(false);
        expect(isUnanchoredHas(".a > b > :has(.c)")).toBe(false);
    });

    test("keeps every one of Discord's other :has() rules", () => {
        const flagged = (discordHas as string[]).flatMap(splitSelectorList).filter(isUnanchoredHas);
        expect(flagged).toHaveLength(2);
        expect(flagged.every(s => s.includes(":not(:has(*))"))).toBe(true);
        expect((discordHas as string[]).length).toBeGreaterThan(90);
    });
});

/** A CSSStyleDeclaration's surface, enough for the blur fix */
function declarations(init: Record<string, string>) {
    const values = new Map<string, { value: string; priority: string; }>();
    for (const [k, v] of Object.entries(init)) {
        const [value, priority = ""] = v.split(" !");
        values.set(k, { value, priority });
    }
    return {
        values,
        getPropertyValue: (p: string) => values.get(p)?.value ?? "",
        getPropertyPriority: (p: string) => values.get(p)?.priority ?? "",
        setProperty(p: string, value: string | null, priority?: string) {
            values.set(p, { value: value ?? "", priority: priority ?? "" });
        },
        removeProperty(p: string) {
            const old = values.get(p)?.value ?? "";
            values.delete(p);
            return old;
        },
    };
}
const supportsColor = (v: string) => /^(rgba?\(|#|black|white)/.test(v);

describe("backdrop blur over video", () => {
    test("only a small blur on its own", () => {
        expect(isSmallBlur("blur(4px)")).toBe(true);
        expect(isSmallBlur("blur(2px)")).toBe(true);
        expect(isSmallBlur("blur(8px)")).toBe(false);
        expect(isSmallBlur("brightness(60%) blur(4px)")).toBe(false);
        expect(isSmallBlur("blur(var(--x))")).toBe(false);
        expect(isSmallBlur("blur(0px)")).toBe(false);
    });

    test("the user panel's muted button over a nameplate: blur out, the same color near-opaque, still !important", () => {
        const style = declarations({ "backdrop-filter": "blur(4px)", "-webkit-backdrop-filter": "blur(4px)", "background-color": "var(--custom-nameplate-neutral) !important" });
        expect(unblur(style, supportsColor)).toBe(true);
        expect(style.values.has("backdrop-filter")).toBe(false);
        expect(style.values.has("-webkit-backdrop-filter")).toBe(false);
        expect(style.values.get("background-color")).toEqual({ value: `rgb(from var(--custom-nameplate-neutral) r g b / max(alpha, ${TINT_ALPHA}))`, priority: "important" });
    });

    test("a stream tile's control: the background shorthand", () => {
        const style = declarations({ "backdrop-filter": "blur(2px)", background: "var(--background-scrim)" });
        expect(unblur(style, supportsColor)).toBe(true);
        expect(style.getPropertyValue("background")).toBe(`rgb(from var(--background-scrim) r g b / max(alpha, ${TINT_ALPHA}))`);
    });

    test("leaves blurs without a plain background alone: nothing to stand in for them", () => {
        const none = declarations({ "backdrop-filter": "blur(4px)" });
        expect(unblur(none, supportsColor)).toBe(false);
        expect(none.getPropertyValue("backdrop-filter")).toBe("blur(4px)");
        const gradient = declarations({ "backdrop-filter": "blur(4px)", background: "linear-gradient(red, blue)" });
        expect(unblur(gradient, supportsColor)).toBe(false);
        const big = declarations({ "backdrop-filter": "blur(12px)", background: "var(--x)" });
        expect(unblur(big, supportsColor)).toBe(false);
    });

    test("plain colors count, mixes and images don't", () => {
        const plain = declarations({ "background-color": "rgba(0, 0, 0, 0.22)" });
        expect(raiseTint(plain, supportsColor)).toBe(true);
        expect(raiseTint(declarations({ background: "url(x.png)" }), supportsColor)).toBe(false);
        expect(raiseTint(declarations({ background: "color-mix(in oklab, var(--a) 50%, transparent)" }), supportsColor)).toBe(false);
    });

    test("the states of an unblurred rule", () => {
        expect(isStateOf(".plateMuted_x:hover", ".plateMuted_x")).toBe(true);
        expect(isStateOf(".a::after", ".a")).toBe(false);
        expect(isStateOf(".a .b:hover", ".a")).toBe(false);
        expect(isStateOf(".ab:hover", ".a")).toBe(false);
        expect(isStateOf(".a", ".a")).toBe(false);
    });
});

describe("cleaning a stylesheet", () => {
    /** Just enough CSSOM for clean(): style rules, @media, @scope and deleting */
    class FakeRule {
        parentRule: FakeGroup | null = null;
        parentStyleSheet: FakeSheet | null = null;
    }
    class FakeStyleRule extends FakeRule {
        reads = 0;
        private _selector: string;
        private _style: ReturnType<typeof declarations>;
        constructor(selector: string, style: Record<string, string> = {}) {
            super();
            this._selector = selector;
            this._style = declarations(style);
        }
        get selectorText() { this.reads++; return this._selector; }
        set selectorText(value: string) { this._selector = value; }
        get style() { return this._style; }
    }
    class FakeScopeRule extends FakeRule {
        constructor(public start: string) { super(); }
    }
    const adopt = (rules: FakeRule[], sheet: FakeSheet, parent: FakeGroup | null) => {
        for (const rule of rules) {
            rule.parentStyleSheet = sheet;
            rule.parentRule = parent;
            if (rule instanceof FakeGroup) adopt(rule.cssRules, sheet, rule);
        }
    };
    const drop = (list: FakeRule[], index: number) => {
        const [rule] = list.splice(index, 1);
        rule.parentStyleSheet = null;
        rule.parentRule = null;
    };
    class FakeGroup extends FakeRule {
        constructor(public cssRules: FakeRule[]) { super(); }
        deleteRule(index: number) { drop(this.cssRules, index); }
    }
    class FakeSheet {
        href = "https://discord.com/assets/web.css";
        constructor(public cssRules: FakeRule[]) { adopt(cssRules, this, null); }
        deleteRule(index: number) { drop(this.cssRules, index); }
    }

    const g = globalThis as any;
    const saved = { CSSStyleRule: g.CSSStyleRule, CSSScopeRule: g.CSSScopeRule, CSS: g.CSS, requestIdleCallback: g.requestIdleCallback };
    let idle: (() => void)[] = [];
    beforeEach(() => {
        g.CSSStyleRule = FakeStyleRule;
        g.CSSScopeRule = FakeScopeRule;
        g.CSS = { supports: (_: string, v: string) => v.startsWith("rgb(from") || supportsColor(v) };
        idle = [];
        g.requestIdleCallback = (cb: () => void) => void idle.push(cb);
    });
    afterEach(() => Object.assign(g, saved));

    const clean = (sheet: FakeSheet, deferBlur = false) => cleanSheet(sheet as unknown as CSSStyleSheet, deferBlur);
    const selectors = (rules: FakeRule[]): string[] => rules.flatMap(r => r instanceof FakeGroup ? selectors(r.cssRules) : r instanceof FakeStyleRule ? [r.selectorText] : ["@scope"]);

    test(":has() and the staff highlighter go before the sheet is released, nested ones too; each selector is read once", () => {
        const kept = new FakeStyleRule(".a:has(.b)");
        const sheet = new FakeSheet([
            kept,
            new FakeStyleRule(":has(.x)"),
            new FakeGroup([new FakeStyleRule(".c"), new FakeStyleRule(".d :has(> img), .e")]),
            new FakeScopeRule(".highlight-mana-text"),
            new FakeScopeRule(".other"),
        ]);
        clean(sheet, true);
        expect(selectors(sheet.cssRules)).toEqual([".a:has(.b)", ".c", ".e", "@scope"]);
        expect((sheet.cssRules[1] as FakeGroup).cssRules.length).toBe(2);
        // Once by clean, once by this test
        expect(kept.reads).toBe(2);
    });

    test("deferred, the blur fix waits for idle time, and skips rules taken out since", () => {
        const tile = new FakeStyleRule(".tile", { "backdrop-filter": "blur(4px)", "background-color": "rgba(0, 0, 0, .5)" });
        const gone = new FakeStyleRule(".gone", { "backdrop-filter": "blur(2px)", "background-color": "rgba(0, 0, 0, .5)" });
        const sheet = new FakeSheet([tile, gone]);
        clean(sheet, true);
        expect(tile.style.getPropertyValue("backdrop-filter")).toBe("blur(4px)");
        expect(idle.length).toBe(1);

        sheet.deleteRule(1);
        idle[0]();
        expect(tile.style.getPropertyValue("backdrop-filter")).toBe("");
        expect(tile.style.getPropertyValue("background-color")).toBe(`rgb(from rgba(0, 0, 0, .5) r g b / max(alpha, ${TINT_ALPHA}))`);
        expect(gone.style.getPropertyValue("backdrop-filter")).toBe("blur(2px)");
    });

    test("not deferred, it's done before clean returns; a state of a rule :has() rewrote matches by its new selector", () => {
        const base = new FakeStyleRule(".plate, :has(.x)", { "backdrop-filter": "blur(4px)", "background": "rgba(1, 2, 3, .4)" });
        const hover = new FakeStyleRule(".plate:hover", { "background": "rgba(1, 2, 3, .6)" });
        const other = new FakeStyleRule(".other:hover", { "background": "rgba(1, 2, 3, .6)" });
        clean(new FakeSheet([base, hover, other]));
        expect(idle.length).toBe(0);
        expect(base.selectorText).toBe(".plate");
        expect(base.style.getPropertyValue("backdrop-filter")).toBe("");
        expect(hover.style.getPropertyValue("background")).toBe(`rgb(from rgba(1, 2, 3, .6) r g b / max(alpha, ${TINT_ALPHA}))`);
        expect(other.style.getPropertyValue("background")).toBe("rgba(1, 2, 3, .6)");
    });
});
