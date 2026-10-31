import { CoreHotfix } from "../coreHotfix";
import { createStyle, whenDomReady } from "../styles";
import css from "./styles.css" with { type: "text" };

let styled = false;
/**
 * Our stylesheet, shared by the floating panel, the tabs embedded in Discord settings and the
 * components plugins get through @evi/api. Its own module, so the API doesn't load the panel.
 */
export function ensureStyles() {
    if (styled) return;
    styled = true;
    createStyle(css, "evi-ui");
    // Evi's stylesheet goes in only when its UI first shows: the hotfix's CSS moves after it
    placeHotfixCss();
}

const HOTFIX_CSS_ID = "evi-hotfix";
let hotfixStyle: HTMLStyleElement | undefined;

/** Right after Evi's stylesheet, so it wins over Evi's rules; at the end of <head> until that's there */
function placeHotfixCss() {
    whenDomReady(() => {
        if (!hotfixStyle) return;
        const ui = document.getElementById("evi-ui");
        if (ui?.parentNode === document.head) ui.after(hotfixStyle);
        else document.head.append(hotfixStyle);
    });
}

/**
 * The CSS of Evi's hotfix for itself (coreHotfix.ts), kept up to date as evi.rest changes it: a new
 * revision swaps it, a withdrawn one takes it out.
 */
export function installHotfixCss() {
    const apply = () => {
        const next = CoreHotfix.get()?.css ?? "";
        if (!next) {
            hotfixStyle?.remove();
            hotfixStyle = undefined;
            return;
        }
        if (!hotfixStyle) {
            hotfixStyle = document.createElement("style");
            hotfixStyle.id = HOTFIX_CSS_ID;
        }
        hotfixStyle.textContent = next;
        placeHotfixCss();
    };
    apply();
    CoreHotfix.subscribe(apply);
}
