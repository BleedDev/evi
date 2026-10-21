/**
 * Takes rules out of Discord's own stylesheets that cost a lot and do nothing for the user.
 *
 * Chromium flags an element the first time it's tested against a `:has()` rule, and the flag stays
 * for the element's lifetime. After that, changes inside it make Chromium check the rule again. A
 * rule whose subject is any element flags `html`, `body` and every app wrapper, which Discord never
 * recreates, so in a voice call every speaking ring restyled all ~7000 elements, ~100ms a few times
 * a second. Deleting such a rule later doesn't clear the flags: it has to go before any element was
 * ever tested against it.
 *
 * So every Discord stylesheet is held back (`media="not all"`) from the moment it's added until it
 * has loaded and been cleaned, then released. Rules are recognised by what they are, never by
 * Discord's hashed class names.
 */
import { Logger } from "./logger";

const logger = new Logger("CssFixes");

/** Splits where `at` is true, outside (), [] and strings */
function splitTopLevel(text: string, at: (c: string) => boolean): string[] {
    const parts: string[] = [];
    let depth = 0, quote = "", start = 0;
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (c === "\\") i++;
        else if (quote) {
            if (c === quote) quote = "";
        } else if (c === "\"" || c === "'") quote = c;
        else if (c === "(" || c === "[") depth++;
        else if (c === ")" || c === "]") depth--;
        else if (depth === 0 && at(c)) {
            parts.push(text.slice(start, i));
            start = i + 1;
        }
    }
    parts.push(text.slice(start));
    return parts;
}

/** A selector list's selectors */
export function splitSelectorList(list: string): string[] {
    return splitTopLevel(list, c => c === ",").map(s => s.trim()).filter(Boolean);
}

interface Compound {
    /** How it joins the one before: " ", ">", "+" or "~"; "" for the first */
    combinator: string;
    compound: string;
}

/** A complex selector's compounds */
export function compoundsOf(selector: string): Compound[] {
    const out: Compound[] = [];
    // The split drops the combinators themselves: read them from between the compounds
    let rest = selector.trim();
    for (const compound of splitTopLevel(rest, c => /[\s>+~]/.test(c)).filter(Boolean)) {
        const at = rest.indexOf(compound);
        out.push({ combinator: out.length ? rest.slice(0, at).trim() || " " : "", compound });
        rest = rest.slice(at + compound.length);
    }
    return out;
}

function closingParen(text: string, open: number): number {
    let depth = 0;
    for (let i = open; i < text.length; i++) {
        if (text[i] === "\\") i++;
        else if (text[i] === "(") depth++;
        else if (text[i] === ")" && --depth === 0) return i;
    }
    return text.length;
}

/**
 * Whether a compound narrows what it matches by something of the element's own: a class, id,
 * attribute or tag, or being the root. `:is()` and `:where()` count when every selector in them does.
 */
export function isAnchored(compound: string): boolean {
    if (/^[a-z\\|]/i.test(compound) || /^:(root|scope|host)\b/i.test(compound)) return true;
    let depth = 0;
    for (let i = 0; i < compound.length; i++) {
        const c = compound[i];
        if (c === "\\") i++;
        else if (c === "(") depth++;
        else if (c === ")") depth--;
        else if (depth > 0) continue;
        else if (c === "." || c === "#" || c === "[") return true;
        else if (c === ":") {
            const m = /^:(is|where|matches|-webkit-any)\(/i.exec(compound.slice(i));
            if (!m) continue;
            const open = i + m[0].length - 1;
            const inner = splitSelectorList(compound.slice(open + 1, closingParen(compound, open)));
            if (inner.length && inner.every(s => {
                const last = compoundsOf(s).pop();
                return !!last && isAnchored(last.compound);
            })) return true;
        }
    }
    return false;
}

/**
 * Whether a selector tests `:has()` on elements nothing narrows down: a compound with `:has()` and
 * nothing of the element's own, first in the selector or a descendant of the rest. Every element in
 * the app (or under some wrapper) would get flagged for good. A child or sibling of an anchored
 * compound is narrowed by it (`.list > :has(.button)`), and so are `footer:has()`, `[data-x]:has()`.
 */
export function isUnanchoredHas(selector: string): boolean {
    const parts = compoundsOf(selector);
    return parts.some(({ compound }, i) => {
        if (!/:has\(/i.test(compound) || isAnchored(compound)) return false;
        for (let j = i; j > 0 && parts[j].combinator !== " ";) {
            if (isAnchored(parts[--j].compound)) return false;
        }
        return true;
    });
}

/** Backdrop blurs this small read as a frosted tint, and Discord puts them over video */
const SMALL_BLUR_PX = 4;
/** How opaque their tint gets instead, so what's behind stays about as hidden */
export const TINT_ALPHA = 0.85;

type Declarations = Pick<CSSStyleDeclaration, "getPropertyValue" | "getPropertyPriority" | "setProperty" | "removeProperty">;

/** `blur(4px)` alone, at most SMALL_BLUR_PX */
export function isSmallBlur(value: string): boolean {
    const m = /^blur\(\s*(\d*\.?\d+)px\s*\)$/.exec(value.trim());
    return !!m && Number(m[1]) > 0 && Number(m[1]) <= SMALL_BLUR_PX;
}

/** A plain color or a custom property, not an image or a gradient */
function isColor(value: string, supportsColor: (v: string) => boolean) {
    return /^var\(--[\w-]+\)$/.test(value) || (!/\(/.test(value.replace(/^(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/i, "")) && supportsColor(value));
}

/** Raises the background's alpha to TINT_ALPHA, in the property it's declared in. False without one. */
export function raiseTint(style: Declarations, supportsColor: (v: string) => boolean): boolean {
    for (const property of ["background-color", "background"]) {
        const value = style.getPropertyValue(property).trim();
        if (!value || !isColor(value, supportsColor)) continue;
        style.setProperty(property, `rgb(from ${value} r g b / max(alpha, ${TINT_ALPHA}))`, style.getPropertyPriority(property));
        return true;
    }
    return false;
}

/**
 * Swaps a small backdrop blur for a near-opaque tint. Chromium blurs again for every frame of the
 * video behind it: the stream tiles' controls, and the user panel's buttons over an animated nameplate.
 */
export function unblur(style: Declarations, supportsColor: (v: string) => boolean): boolean {
    if (!isSmallBlur(style.getPropertyValue("backdrop-filter") || style.getPropertyValue("-webkit-backdrop-filter"))) return false;
    if (!raiseTint(style, supportsColor)) return false;
    style.removeProperty("backdrop-filter");
    style.removeProperty("-webkit-backdrop-filter");
    return true;
}

/** Whether `selector` is `base` in some state, like `base:hover` */
export function isStateOf(selector: string, base: string): boolean {
    return selector.length > base.length && selector.startsWith(base) && /^(:[\w-]+(\([^()]*\))?)+$/.test(selector.slice(base.length));
}

const supportsColor = (v: string) => CSS.supports("color", v);
let relativeColors: boolean | undefined;
const hasRelativeColors = () => relativeColors ??= CSS.supports("color", "rgb(from red r g b / max(alpha, .5))");

/**
 * Discord's internal "highlight text variants" tool, for staff. It only ever draws inside
 * `.highlight-mana-text`, but its `:not(:has(*))` rules have any element as their subject.
 * Measured in a 7-person call: main thread busy 1558 -> 451ms per 3s, longest task 99 -> 15ms.
 */
const isStaffHighlighter = (rule: CSSRule) => typeof CSSScopeRule !== "undefined" && rule instanceof CSSScopeRule && rule.start?.trim() === ".highlight-mana-text";

/**
 * The same :has() mistake anywhere else, caught before it ships: only the selectors that make it go.
 * "delete" when none is left, the selector it now has when some went, undefined when it stays as is.
 */
function fixHas(rule: CSSStyleRule, selector: string): "delete" | string | undefined {
    const selectors = splitSelectorList(selector);
    const kept = selectors.filter(s => !isUnanchoredHas(s));
    if (kept.length === selectors.length) return;
    logger.debug("Dropped a :has() selector that would test every element:", selectors.filter(s => !kept.includes(s)).join(", "));
    if (!kept.length) return "delete";
    return rule.selectorText = kept.join(", ");
}

/**
 * Small backdrop blurs over video, swapped for a near-opaque tint; then their hover and other
 * states set the tint again, without the blur under it now. Reads each rule's style once.
 */
function unblurRules(rules: [CSSStyleRule, string][]) {
    const unblurred: string[] = [];
    const plain: [CSSStyleDeclaration, string][] = [];
    for (const [rule, selector] of rules) {
        // Taken out of its sheet since
        if (!rule.parentStyleSheet) continue;
        const { style } = rule;
        if (unblur(style, supportsColor)) unblurred.push(...splitSelectorList(selector));
        else if (!style.getPropertyValue("backdrop-filter")) plain.push([style, selector]);
    }
    if (!unblurred.length) return;
    for (const [style, selector] of plain) {
        if (splitSelectorList(selector).every(s => unblurred.some(base => isStateOf(s, base)))) raiseTint(style, supportsColor);
    }
}

const HELD = "data-evi-held";
const cleaned = new WeakSet<CSSStyleSheet>();

/**
 * Takes the :has() rules out, in one pass that reads each rule's selector once; the blur fix, which
 * doesn't have to land before the sheet is first used, goes after. With `deferBlur`, in idle time
 * rather than before the sheet is released.
 * @internal Exported for tests
 */
export function clean(sheet: CSSStyleSheet, deferBlur = false) {
    if (cleaned.has(sheet)) return;
    cleaned.add(sheet);
    let rules: CSSRuleList;
    try {
        rules = sheet.cssRules;
    } catch {
        // Cross-origin: not Discord's
        return;
    }
    const name = (sheet.href ?? "").split("/").pop();
    const t0 = performance.now();
    const doomed: CSSRule[] = [];
    /** Style rules that stay, with the selector they end up with */
    const styled: [CSSStyleRule, string][] = [];
    let count = 0;
    // Every rule, and inside @media, @supports and @layer. Not inside @scope, removed whole.
    const visit = (list: CSSRuleList) => {
        for (let i = 0; i < list.length; i++) {
            const rule = list[i];
            count++;
            if (rule instanceof CSSStyleRule) {
                let selector = rule.selectorText;
                if (/:has\(/i.test(selector)) {
                    const fixed = fixHas(rule, selector);
                    if (fixed === "delete") {
                        doomed.push(rule);
                        continue;
                    }
                    if (fixed !== undefined) selector = fixed;
                }
                styled.push([rule, selector]);
            } else if (typeof CSSScopeRule !== "undefined" && rule instanceof CSSScopeRule) {
                if (isStaffHighlighter(rule)) {
                    doomed.push(rule);
                    logger.info(`Removed Discord's staff text highlighter (${name})`);
                }
            } else if ("cssRules" in rule) {
                visit((rule as CSSGroupingRule).cssRules);
            }
        }
    };
    visit(rules);
    for (const rule of doomed) {
        const parent = rule.parentRule as CSSGroupingRule | null;
        const list = parent ? parent.cssRules : rules;
        const index = Array.prototype.indexOf.call(list, rule);
        if (index === -1) continue;
        if (parent) parent.deleteRule(index);
        else sheet.deleteRule(index);
    }
    const blocked = performance.now() - t0;

    if (!hasRelativeColors()) return void logger.debug(`${name}: ${count} rules, ${blocked.toFixed(1)}ms`);
    const blurPass = () => {
        const t1 = performance.now();
        unblurRules(styled);
        logger.debug(`${name}: ${count} rules, ${blocked.toFixed(1)}ms${deferBlur ? " before release" : ""}, blur fix ${(performance.now() - t1).toFixed(1)}ms`);
    };
    if (!deferBlur) blurPass();
    else if (typeof requestIdleCallback === "function") requestIdleCallback(blurPass, { timeout: 1000 });
    else setTimeout(blurPass, 0);
}

function isStylesheet(node: Node): node is HTMLLinkElement {
    return node instanceof HTMLLinkElement && node.rel === "stylesheet";
}

/** Holds the link back until its rules are cleaned. Its own `load` listeners (webpack's) still fire as usual. */
function hold(link: HTMLLinkElement) {
    if (link.hasAttribute(HELD)) return;
    if (link.sheet) {
        // Already loaded: clean it now, nothing has rendered with it yet this early
        clean(link.sheet);
        return;
    }
    // Discord's main stylesheets, in the page's own HTML: their blur fix waits for idle time, at most
    // a second, long before Discord can be in a call. Anything added later (lazily loaded CSS, a
    // popout's copies, a call's own styles) gets it before it's released, as always.
    const deferBlur = document.readyState === "loading";
    link.setAttribute(HELD, link.media);
    link.media = "not all";
    const release = () => {
        link.removeEventListener("load", release);
        link.removeEventListener("error", release);
        if (link.sheet) clean(link.sheet, deferBlur);
        const media = link.getAttribute(HELD)!;
        link.removeAttribute(HELD);
        if (media) link.media = media;
        else link.removeAttribute("media");
    };
    link.addEventListener("load", release);
    link.addEventListener("error", release);
}

/** Before Discord's first stylesheet: from boot, which runs before Discord's own scripts */
export function installCssFixes() {
    if (typeof CSSScopeRule === "undefined") return;
    for (const link of document.querySelectorAll("link")) if (isStylesheet(link)) hold(link);
    // The initial HTML's links are parsed into <head>, lazily loaded ones appended to it. Watching
    // the whole document only until <head> is done parsing keeps this to one cheap childList
    // observer on <head> for the rest of the session.
    const observer = new MutationObserver(records => {
        for (const record of records) for (const node of record.addedNodes) if (isStylesheet(node)) hold(node);
    });
    observer.observe(document, { childList: true, subtree: true });
    const narrow = () => {
        observer.disconnect();
        observer.observe(document.head, { childList: true });
        for (const link of document.head.querySelectorAll("link")) if (isStylesheet(link)) hold(link);
    };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", narrow, { once: true });
    else narrow();
}

/**
 * Discord's UI fonts load on first use, and a face arriving makes Chromium lay out all text in that
 * family again: 64ms of the first settings open. They're a few small files, so load them once the
 * app is up, when the browser is idle.
 */
const UI_FONTS = /^(gg sans|ABC Ginto)/i;

export function warmUiFonts() {
    const faces: FontFace[] = [];
    document.fonts.forEach(face => {
        if (face.status === "unloaded" && UI_FONTS.test(face.family.replace(/["']/g, ""))) faces.push(face);
    });
    const next = () => {
        const face = faces.shift();
        if (!face) return;
        // One at a time, each in its own idle period: nothing competes with what the user is doing
        face.load().catch(() => { }).finally(() => requestIdleCallback(next, { timeout: 5000 }));
    };
    requestIdleCallback(next, { timeout: 5000 });
}
