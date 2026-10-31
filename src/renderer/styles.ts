import { Native } from "./native";
import { SafeMode } from "./safeMode";
import { Settings } from "./settings";

export function whenDomReady(cb: () => void) {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", cb, { once: true });
    else cb();
}

export interface ManagedStyle {
    update(css: string): void;
    remove(): void;
}

/**
 * A <style> element appended to <head>. Created before the DOM exists is fine, it's attached later.
 * With `beforeId`, it goes right before that element instead, when it's there.
 */
export function createStyle(css: string, id?: string, beforeId?: string): ManagedStyle {
    const el = document.createElement("style");
    if (id) el.id = id;
    el.textContent = css;
    let removed = false;
    whenDomReady(() => {
        if (removed) return;
        const anchor = beforeId && document.getElementById(beforeId);
        anchor && anchor.parentNode === document.head ? anchor.before(el) : document.head.append(el);
    });

    return {
        update: next => void (el.textContent = next),
        remove() {
            removed = true;
            el.remove();
        },
    };
}

/** Themes are inserted before this element, so Quick CSS wins over them */
export const QUICK_CSS_ID = "evi-quickcss";

let quickCss: ManagedStyle | undefined;
let quickCssSource = "";
let saveTimer: ReturnType<typeof setTimeout> | undefined;

addEventListener("pagehide", () => QuickCss.flush());

export const QuickCss = {
    get source() {
        return quickCssSource;
    },

    init(initial: string) {
        quickCssSource = initial;
        // Last in <head> so it wins over plugin styles of equal specificity
        quickCss = createStyle(QuickCss.applies() ? initial : "", QUICK_CSS_ID);
        Native.onQuickCssChange(css => {
            quickCssSource = css;
            QuickCss.apply();
        });
    },

    /** On, and not in safe mode. Edits are still saved in safe mode, they apply after it. */
    applies: () => Settings.data.quickCss && !SafeMode.active,

    apply() {
        quickCss?.update(QuickCss.applies() ? quickCssSource : "");
    },

    /** Applies immediately, writes to disk debounced */
    save(css: string) {
        quickCssSource = css;
        QuickCss.apply();
        clearTimeout(saveTimer);
        saveTimer = setTimeout(() => {
            saveTimer = undefined;
            Native.saveQuickCss(css);
        }, 300);
    },

    flush() {
        if (saveTimer === undefined) return;
        clearTimeout(saveTimer);
        saveTimer = undefined;
        Native.saveQuickCssSync(quickCssSource);
    },
};
