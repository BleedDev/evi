/**
 * Evi's styles in Discord's popout windows. Discord copies the main window's <link> stylesheets into
 * its popouts but not <style> elements, and Evi's are all <style>s (styles.ts createStyle).
 */
import { installCssFixes } from "./cssFixes";

/**
 * The main window's <style>s a popout gets: themes (and the theme editor's preview), the neutral
 * tint, Quick CSS, dialog motion and the typing dots. Not plugin styles: plugins never start in a
 * popout. Not the wallpaper either, which only shows behind Discord's main window.
 */
export function isMirroredStyle(id: string) {
    return /^evi-(theme-.+|neutral-discord-tint|quickcss|layer-motion|typing-dots)$/.test(id);
}

/**
 * Keeps copies of `from`'s styles that `keep` picks at the end of `to`'s <head>, in the same order,
 * updated as they change. `to` may not have a <head> yet: the copies go in once it does. Returns
 * what stops it and takes the copies out.
 */
export function mirrorStyles(from: Document, to: Document, keep: (id: string) => boolean = isMirroredStyle): () => void {
    const copies = new Map<HTMLStyleElement, HTMLStyleElement>();
    let order: HTMLStyleElement[] = [];
    let stopped = false;

    const sync = () => {
        const head = to.head;
        if (stopped || !head) return;
        const next: HTMLStyleElement[] = [];
        for (const style of Array.from(from.head?.querySelectorAll<HTMLStyleElement>("style[id^=\"evi-\"]") ?? [])) {
            if (!keep(style.id)) continue;
            let copy = copies.get(style);
            if (!copy) {
                copies.set(style, copy = to.createElement("style"));
                copy.id = style.id;
            }
            if (copy.textContent !== style.textContent) copy.textContent = style.textContent;
            if (copy.media !== style.media) copy.media = style.media;
            next.push(copy);
        }
        const kept = new Set(next);
        for (const [style, copy] of copies) {
            if (kept.has(copy)) continue;
            copy.remove();
            copies.delete(style);
        }
        // Moving a stylesheet restyles the window, so only when one came or the order changed
        if (next.length !== order.length || next.some((copy, i) => copy !== order[i] || !copy.isConnected)) head.append(...next);
        order = next;
    };

    const observer = new MutationObserver(sync);
    if (from.head) observer.observe(from.head, { childList: true, subtree: true, characterData: true });
    if (to.head) sync();
    else to.addEventListener("DOMContentLoaded", sync, { once: true });

    return () => {
        stopped = true;
        observer.disconnect();
        to.removeEventListener("DOMContentLoaded", sync);
        for (const copy of copies.values()) copy.remove();
        copies.clear();
        order = [];
    };
}

/**
 * Starts a popout window `win` off its opener, Discord's main window: the fixes to Discord's
 * stylesheets (before Discord copies its first one in) and Evi's styles. Nothing when Evi isn't
 * running in the opener; safe mode applies no CSS, these fixes included.
 */
export function startPopout(win: Window, fixCss: () => void = installCssFixes) {
    let evi: Window["Evi"] | undefined;
    let main: Document | undefined;
    try {
        evi = win.opener?.Evi;
        main = win.opener?.document;
    } catch {
        return;
    }
    if (!evi || !main) return;
    if (!evi.safeMode?.active) fixCss();
    const stop = mirrorStyles(main, win.document);
    win.addEventListener("pagehide", stop, { once: true });
}
