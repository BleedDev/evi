import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { isOverlayWindow, isPopoutUrl } from "../src/shared/appHosts";
import { isMirroredStyle, mirrorStyles, startPopout } from "../src/renderer/popoutStyles";
import { mainWindowOnly } from "../plugins/pop-out-chat/chat";

/** Just enough of a document for mirrorStyles: <style>s in a <head>, and DOMContentLoaded */
class FakeStyle {
    id = "";
    textContent = "";
    media = "";
    parent: FakeHead | undefined;
    get isConnected() { return !!this.parent; }
    remove() {
        const parent = this.parent;
        if (!parent) return;
        parent.children.splice(parent.children.indexOf(this), 1);
        this.parent = undefined;
        notify(parent);
    }
}

class FakeHead {
    children: FakeStyle[] = [];
    append(...nodes: FakeStyle[]) {
        for (const node of nodes) {
            node.remove();
            node.parent = this;
            this.children.push(node);
        }
        notify(this);
    }
    querySelectorAll(selector: string) {
        expect(selector).toBe("style[id^=\"evi-\"]");
        return this.children.filter(s => s.id.startsWith("evi-"));
    }
}

class FakeDocument {
    head: FakeHead | null = new FakeHead();
    private listeners = new Map<string, () => void>();
    createElement(tag: string) {
        expect(tag).toBe("style");
        return new FakeStyle();
    }
    addEventListener(type: string, cb: () => void) { this.listeners.set(type, cb); }
    removeEventListener(type: string) { this.listeners.delete(type); }
    fire(type: string) {
        const cb = this.listeners.get(type);
        this.listeners.delete(type);
        cb?.();
    }
}

let observers: { cb: () => void; target?: unknown; }[] = [];
const notify = (head: FakeHead) => observers.forEach(o => o.target === head && o.cb());
/** A change a MutationObserver on the main window's <head> would see, like a style's text */
const changed = () => observers.forEach(o => o.target && o.cb());

const realObserver = globalThis.MutationObserver;
beforeEach(() => {
    observers = [];
    (globalThis as any).MutationObserver = class {
        entry: { cb: () => void; target?: unknown; };
        constructor(cb: () => void) { observers.push(this.entry = { cb }); }
        observe(target: unknown) { this.entry.target = target; }
        disconnect() { this.entry.target = undefined; }
    };
});
afterEach(() => {
    (globalThis as any).MutationObserver = realObserver;
});

function style(id: string, css: string) {
    const s = new FakeStyle();
    s.id = id;
    s.textContent = css;
    return s;
}

const ids = (doc: FakeDocument) => doc.head!.children.map(s => s.id);
const mirror = (main: FakeDocument, popout: FakeDocument) => mirrorStyles(main as unknown as Document, popout as unknown as Document);

describe("which styles a popout gets", () => {
    test("themes, the neutral tint, Quick CSS, dialog motion and typing dots", () => {
        for (const id of ["evi-theme-dark.css", "evi-theme-preview", "evi-neutral-discord-tint", "evi-quickcss", "evi-layer-motion", "evi-typing-dots"]) expect(isMirroredStyle(id)).toBe(true);
    });

    test("not plugin styles, the wallpaper, Evi's UI or anything else", () => {
        for (const id of ["evi-plugin-fast-lists", "evi-wallpaper-style", "evi-ui", "evi-panel", "evi-toast-fallback", "evi-theme-", "quickcss", ""]) expect(isMirroredStyle(id)).toBe(false);
    });

    test("Pop Out Chat still copies those (after Discord's stylesheets), and only leaves out the wallpaper", () => {
        expect(mainWindowOnly("evi-wallpaper-style")).toBe(true);
        for (const id of ["evi-theme-dark.css", "evi-quickcss", "evi-neutral-discord-tint", "evi-layer-motion", "evi-typing-dots", "evi-plugin-fast-lists", "evi-ui", "evi-panel", ""]) expect(mainWindowOnly(id)).toBe(false);
    });
});

describe("mirrorStyles", () => {
    test("copies the main window's styles in order, after the popout's own", () => {
        const main = new FakeDocument(), popout = new FakeDocument();
        main.head!.append(style("evi-layer-motion", "a"), style("evi-plugin-x", "p"), style("evi-theme-t.css", "t"), style("evi-quickcss", "q"));
        popout.head!.append(style("discord", "d"));
        mirror(main, popout);
        expect(ids(popout)).toEqual(["discord", "evi-layer-motion", "evi-theme-t.css", "evi-quickcss"]);
        expect(popout.head!.children.map(s => s.textContent)).toEqual(["d", "a", "t", "q"]);
    });

    test("follows text changes, new styles, order and removals", () => {
        const main = new FakeDocument(), popout = new FakeDocument();
        const quick = style("evi-quickcss", "q");
        const theme = style("evi-theme-t.css", "t");
        main.head!.append(theme, quick);
        mirror(main, popout);
        const [themeCopy, quickCopy] = popout.head!.children;

        quick.textContent = "q2";
        changed();
        expect(quickCopy.textContent).toBe("q2");
        // Same elements, same order: nothing moved
        expect(popout.head!.children[0]).toBe(themeCopy);

        // A theme added before Quick CSS: one batch of mutations, as an observer gets them
        const added = style("evi-theme-u.css", "u");
        added.parent = main.head!;
        main.head!.children.splice(1, 0, added);
        changed();
        expect(ids(popout)).toEqual(["evi-theme-t.css", "evi-theme-u.css", "evi-quickcss"]);
        expect(popout.head!.children[2]).toBe(quickCopy);

        theme.remove();
        expect(ids(popout)).toEqual(["evi-theme-u.css", "evi-quickcss"]);
        expect(themeCopy.isConnected).toBe(false);
    });

    test("waits for the popout's <head>", () => {
        const main = new FakeDocument(), popout = new FakeDocument();
        popout.head = null;
        main.head!.append(style("evi-quickcss", "q"));
        mirror(main, popout);
        changed();
        popout.head = new FakeHead();
        popout.fire("DOMContentLoaded");
        expect(ids(popout)).toEqual(["evi-quickcss"]);
    });

    test("stopping takes the copies out and stops following", () => {
        const main = new FakeDocument(), popout = new FakeDocument();
        main.head!.append(style("evi-quickcss", "q"));
        const stop = mirror(main, popout);
        stop();
        expect(ids(popout)).toEqual([]);
        main.head!.append(style("evi-theme-t.css", "t"));
        expect(ids(popout)).toEqual([]);
    });
});

describe("startPopout", () => {
    function popoutWindow(opener: unknown) {
        const doc = new FakeDocument();
        const listeners: Record<string, () => void> = {};
        return {
            doc,
            listeners,
            win: { opener, document: doc, addEventListener: (type: string, cb: () => void) => void (listeners[type] = cb) } as unknown as Window,
        };
    }

    test("fixes Discord's stylesheets and mirrors Evi's styles; pagehide stops it", () => {
        const main = new FakeDocument();
        main.head!.append(style("evi-quickcss", "q"));
        const { win, doc, listeners } = popoutWindow({ Evi: { safeMode: { active: false } }, document: main });
        let fixed = 0;
        startPopout(win, () => fixed++);
        expect(fixed).toBe(1);
        expect(ids(doc)).toEqual(["evi-quickcss"]);
        listeners.pagehide();
        expect(ids(doc)).toEqual([]);
    });

    test("safe mode: no CSS fixes", () => {
        const { win } = popoutWindow({ Evi: { safeMode: { active: true } }, document: new FakeDocument() });
        let fixed = 0;
        startPopout(win, () => fixed++);
        expect(fixed).toBe(0);
    });

    test("nothing when Evi isn't running in the opener, or there's none", () => {
        let fixed = 0;
        startPopout(popoutWindow({ document: new FakeDocument() }).win, () => fixed++);
        startPopout(popoutWindow(null).win, () => fixed++);
        expect(fixed).toBe(0);
        expect(observers).toEqual([]);
    });
});

describe("popout windows", () => {
    test("/popout on Discord, and nothing else", () => {
        expect(isPopoutUrl("https://discord.com/popout")).toBe(true);
        expect(isPopoutUrl("https://canary.discord.com/popout/")).toBe(true);
        expect(isPopoutUrl("https://discord.com/popouts")).toBe(false);
        expect(isPopoutUrl("https://discord.com/channels/@me")).toBe(false);
        expect(isPopoutUrl("not a url")).toBe(false);
    });

    test("the newer overlay's popout is the overlay, which gets nothing", () => {
        expect(isOverlayWindow("https://discord.com/popout", "DISCORD_OutOfProcessOverlay")).toBe(true);
        expect(isOverlayWindow("https://discord.com/popout", "DISCORD_CHANNEL_CALL_POPOUT")).toBe(false);
    });
});
