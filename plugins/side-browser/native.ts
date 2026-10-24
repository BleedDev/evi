/**
 * Main-process side of Side Browser: the page itself. Most sites refuse to be framed
 * (X-Frame-Options, CSP frame-ancestors), so the panel can't hold an <iframe>. The page is a
 * WebContentsView attached to Discord's window instead, laid over the panel's body at the rectangle
 * the renderer reports. A native view draws above everything in Discord's page, so it's hidden
 * until the renderer says the panel is clear (setVisible), and hidden here too while the window is
 * minimized. The renderer learns about the page (title, address, back/forward, crashes) by waiting
 * on nextEvent, the same loop Pretty Notifications uses.
 *
 * The page gets nothing of Discord's: its own in-memory session (no cookies or storage shared with
 * Discord's, so no token, all of it gone when Discord quits), a sandboxed renderer with context
 * isolation, no Node and no preload. Every permission is refused (camera, microphone, location,
 * notifications, fullscreen, opening other apps), popups load in the panel, downloads open in the
 * default browser, and only http(s) pages are loaded; Discord's own links go back to Discord.
 *
 * Closing the panel destroys the view and its renderer process: nothing is kept around.
 */
import type { NativeContext, NativePlugin } from "@evi/api/native";
import * as electron from "electron";
import { BrowserWindow, clipboard, Menu, session, shell } from "electron";
import type { Event as ElectronEvent, Session, WebContents } from "electron";

import { classifyUrl, toViewBounds } from "./links";
import type { Rect } from "./links";

/** In-memory: no "persist:" prefix */
const PARTITION = "evi-side-browser";
const SNAPSHOT_TIMEOUT_MS = 250;

/** What the renderer learns about the page */
export type SideEvent =
    | { type: "state"; url: string; title: string; canGoBack: boolean; canGoForward: boolean; loading: boolean; }
    | { type: "discord"; url: string; }
    | { type: "download"; url: string; }
    | { type: "gone"; url: string; };

const LABEL_KEYS = ["back", "forward", "reload", "cut", "copy", "paste", "copyLink", "openLink", "openPage", "failed"] as const;
type Labels = Record<typeof LABEL_KEYS[number], string>;

interface Holder {
    wc: WebContents;
    win: BrowserWindow;
    setBounds(rect: Rect): void;
    setVisible(visible: boolean): void;
    destroy(): void;
}

let ctx: NativeContext | null = null;
let holder: Holder | null = null;
/** The renderer's say: the panel is on screen with nothing over it */
let wanted = false;
let bounds: Rect | null = null;
let shown = false;
/** A page that failed to load shows an error page; this is the address it was for */
let failedUrl: string | null = null;
let labels: Labels = {
    back: "Back", forward: "Forward", reload: "Reload", cut: "Cut", copy: "Copy", paste: "Paste",
    copyLink: "Copy Link", openLink: "Open Link in Browser", openPage: "Open in Browser", failed: "This page couldn't be opened.",
};
let preparedSession: Session | null = null;
let lastExternal = 0;
let unhookWindow: (() => void) | null = null;

let events: SideEvent[] = [];
let waiting: ((event: SideEvent | null) => void) | null = null;

function push(event: SideEvent) {
    if (waiting) {
        const resolve = waiting;
        waiting = null;
        resolve(event);
        return;
    }
    // Only the latest state matters
    if (event.type === "state" && events[events.length - 1]?.type === "state") events[events.length - 1] = event;
    else events.push(event);
    if (events.length > 20) events.shift();
}

function discordWindow(): BrowserWindow | null {
    const id = (globalThis as any).mainWindowId;
    const main = typeof id === "number" ? BrowserWindow.fromId(id) : null;
    return main && !main.isDestroyed() ? main : null;
}

/** The page's address; the error page (a data: URL) stands for the address that failed, or for none */
function currentUrl(wc: WebContents) {
    if (failedUrl) return failedUrl;
    const url = wc.getURL();
    return classifyUrl(url).kind === "refused" ? "" : url;
}

function canGo(wc: WebContents, direction: "Back" | "Forward"): boolean {
    const history = (wc as any).navigationHistory;
    return !!(history?.[`canGo${direction}`]?.() ?? (wc as any)[`canGo${direction}`]?.() ?? false);
}

function stateOf(wc: WebContents): SideEvent {
    const url = currentUrl(wc);
    return {
        type: "state",
        url,
        title: failedUrl || !url ? "" : wc.getTitle(),
        canGoBack: canGo(wc, "Back"),
        canGoForward: canGo(wc, "Forward"),
        loading: wc.isLoading(),
    };
}

/** Chrome's own user agent: some sites refuse sign-in to anything that says Electron */
function cleanUserAgent(agent: string) {
    return agent.replace(/\s(?:Electron|discord)\/\S+/gi, "");
}

function onDownload(event: ElectronEvent, item: Electron.DownloadItem) {
    event.preventDefault();
    const link = classifyUrl(item.getURL());
    // blob: and data: downloads exist only in the page: refused. One a second at most, so a page can't open tab after tab
    if (link.kind !== "web" || Date.now() - lastExternal < 1000) return;
    lastExternal = Date.now();
    void shell.openExternal(link.href!).catch(() => { });
    push({ type: "download", url: link.href! });
}

function prepareSession(): Session {
    const ses = session.fromPartition(PARTITION);
    if (preparedSession === ses) return ses;
    preparedSession = ses;
    // Copying text the page asks to copy is the one thing it may do
    ses.setPermissionRequestHandler((_wc, permission, callback) => callback(permission === "clipboard-sanitized-write"));
    ses.setPermissionCheckHandler((_wc, permission) => permission === "clipboard-sanitized-write");
    ses.setDevicePermissionHandler?.(() => false);
    ses.setUserAgent(cleanUserAgent(ses.getUserAgent()));
    ses.on("will-download", onDownload);
    return ses;
}

function createHolder(win: BrowserWindow, background: string | undefined): Holder {
    const ses = prepareSession();
    const webPreferences: Electron.WebPreferences = {
        session: ses,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        nodeIntegrationInSubFrames: false,
        nodeIntegrationInWorker: false,
        webviewTag: false,
        safeDialogs: true,
        navigateOnDragDrop: false,
        devTools: false,
        autoplayPolicy: "document-user-activation-required",
    };
    const WebContentsView = (electron as any).WebContentsView;
    if (typeof WebContentsView === "function" && (win as any).contentView) {
        const view = new WebContentsView({ webPreferences });
        view.setVisible(false);
        if (background) view.setBackgroundColor?.(background);
        (win as any).contentView.addChildView(view);
        return {
            wc: view.webContents,
            win,
            setBounds: rect => view.setBounds(rect),
            setVisible: visible => view.setVisible(visible),
            destroy() {
                try {
                    if (!win.isDestroyed()) (win as any).contentView.removeChildView(view);
                } catch { }
                // A WebContentsView's page isn't closed with the view: this ends its renderer process
                if (!view.webContents.isDestroyed()) view.webContents.close();
            },
        };
    }

    // Electron before 30: a BrowserView, hidden by giving it no size
    const BrowserView = (electron as any).BrowserView;
    const view = new BrowserView({ webPreferences });
    if (background) view.setBackgroundColor?.(background);
    win.addBrowserView(view);
    let visible = false;
    let rect: Rect = { x: 0, y: 0, width: 0, height: 0 };
    const apply = () => view.setBounds(visible ? rect : { x: 0, y: 0, width: 0, height: 0 });
    apply();
    return {
        wc: view.webContents,
        win,
        setBounds: next => void (rect = next, apply()),
        setVisible: next => void (visible = next, apply()),
        destroy() {
            try {
                if (!win.isDestroyed()) win.removeBrowserView(view);
            } catch { }
            if (!view.webContents.isDestroyed()) view.webContents.close?.();
        },
    };
}

/** Shows the view when the renderer wants it, it has a place, and the window is on screen */
function apply() {
    if (!holder) return;
    const { win, wc } = holder;
    const next = wanted && !!bounds && !win.isDestroyed() && win.isVisible() && !win.isMinimized();
    if (next === shown) return;
    shown = next;
    if (bounds) holder.setBounds(bounds);
    holder.setVisible(next);
    // Hidden with the keyboard in it: give the keyboard back to Discord
    if (!next && !wc.isDestroyed() && wc.isFocused() && !win.isDestroyed()) win.webContents.focus();
}

function escapeHtml(text: string) {
    return text.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
}

function errorPage(description: string) {
    return "data:text/html;charset=utf-8," + encodeURIComponent(`<!doctype html><meta charset="utf-8"><meta name="color-scheme" content="light dark">
<style>html,body{height:100%;margin:0}body{display:grid;place-items:center;font:14px/1.4 system-ui,sans-serif;color:#80848e;text-align:center;padding:24px;box-sizing:border-box}b{display:block;margin-bottom:4px;color:CanvasText;font-size:16px}</style>
<div><b>${escapeHtml(labels.failed)}</b>${escapeHtml(description)}</div>`);
}

/** Navigations the page starts: http(s) stays, Discord's own links go to Discord, the rest is refused */
function guardNavigation(event: ElectronEvent & { url?: string; isMainFrame?: boolean; }, legacyUrl?: string) {
    if (event.isMainFrame === false) return;
    const target = event.url ?? legacyUrl;
    const link = classifyUrl(target);
    if (link.kind === "web") return;
    event.preventDefault();
    if (link.kind === "discord") push({ type: "discord", url: link.href! });
}

function popupMenu(wc: WebContents, win: BrowserWindow, params: Electron.ContextMenuParams) {
    const items: Electron.MenuItemConstructorOptions[] = [];
    const link = params.linkURL ? classifyUrl(params.linkURL) : null;
    if (link && link.kind !== "refused") {
        items.push(
            { label: labels.openLink, click: () => void shell.openExternal(link.href!).catch(() => { }) },
            { label: labels.copyLink, click: () => clipboard.writeText(link.href!) },
            { type: "separator" },
        );
    }
    if (params.isEditable) {
        items.push(
            { label: labels.cut, role: "cut", enabled: params.editFlags.canCut },
            { label: labels.copy, role: "copy", enabled: params.editFlags.canCopy },
            { label: labels.paste, role: "paste", enabled: params.editFlags.canPaste },
            { type: "separator" },
        );
    } else if (params.selectionText.trim()) {
        items.push({ label: labels.copy, role: "copy" }, { type: "separator" });
    }
    items.push(
        { label: labels.back, enabled: canGo(wc, "Back"), click: () => go("back") },
        { label: labels.forward, enabled: canGo(wc, "Forward"), click: () => go("forward") },
        { label: labels.reload, click: () => go("reload") },
    );
    const page = classifyUrl(currentUrl(wc));
    if (page.kind === "web") items.push({ type: "separator" }, { label: labels.openPage, click: () => void shell.openExternal(page.href!).catch(() => { }) });
    Menu.buildFromTemplate(items).popup({ window: win });
}

function wire(h: Holder) {
    const { wc, win } = h;
    const state = () => {
        if (holder === h && !wc.isDestroyed()) push(stateOf(wc));
    };

    // Popups load here, Discord's links go to Discord, nothing gets a window of its own
    wc.setWindowOpenHandler(({ url }) => {
        const link = classifyUrl(url);
        if (link.kind === "web") setImmediate(() => holder === h && load(link.href!));
        else if (link.kind === "discord") push({ type: "discord", url: link.href! });
        return { action: "deny" };
    });
    wc.on("will-navigate", guardNavigation as any);
    wc.on("will-redirect", guardNavigation as any);
    wc.on("did-start-loading", state);
    wc.on("did-stop-loading", state);
    wc.on("did-navigate", state);
    wc.on("did-navigate-in-page", state);
    wc.on("page-title-updated", state);
    wc.on("did-fail-load", (_event, code, description, url, isMainFrame) => {
        // -3 is a navigation replaced by another one
        if (!isMainFrame || code === -3 || holder !== h) return;
        failedUrl = url || failedUrl;
        void wc.loadURL(errorPage(description || String(code))).catch(() => { });
        state();
    });
    wc.on("render-process-gone", () => {
        if (holder !== h) return;
        const url = currentUrl(wc);
        destroyView();
        push({ type: "gone", url });
    });
    wc.on("context-menu", (_event, params) => popupMenu(wc, win, params));
    wc.on("before-input-event", (event, input) => {
        if (input.type !== "keyDown") return;
        const mod = process.platform === "darwin" ? input.meta : input.control;
        const action = input.alt && input.key === "ArrowLeft" ? "back"
            : input.alt && input.key === "ArrowRight" ? "forward"
                : input.key === "F5" || mod && input.key.toLowerCase() === "r" ? "reload"
                    : null;
        if (!action) return;
        event.preventDefault();
        go(action);
    });

    // Discord's window: hidden while minimized, gone with the window or a reload of Discord's page
    const onWindow = () => apply();
    const onClosed = () => destroyView();
    const onDiscordNavigation = (details: any, _url?: string, inPlace?: boolean, mainFrame?: boolean) => {
        const isMain = details?.isMainFrame ?? mainFrame;
        const sameDocument = details?.isSameDocument ?? inPlace;
        if (isMain && !sameDocument) destroyView();
    };
    win.on("minimize", onWindow);
    win.on("restore", onWindow);
    win.on("hide", onWindow);
    win.on("show", onWindow);
    win.on("closed", onClosed);
    // Kept: a closed window's webContents can't be read any more
    const discord = win.webContents;
    discord.on("did-start-navigation", onDiscordNavigation);
    discord.on("render-process-gone", onClosed);
    unhookWindow = () => {
        if (!win.isDestroyed()) {
            win.removeListener("minimize", onWindow);
            win.removeListener("restore", onWindow);
            win.removeListener("hide", onWindow);
            win.removeListener("show", onWindow);
            win.removeListener("closed", onClosed);
        }
        if (!discord.isDestroyed()) {
            discord.removeListener("did-start-navigation", onDiscordNavigation);
            discord.removeListener("render-process-gone", onClosed);
        }
    };
}

function destroyView() {
    const h = holder;
    holder = null;
    shown = false;
    wanted = false;
    bounds = null;
    failedUrl = null;
    unhookWindow?.();
    unhookWindow = null;
    if (!h) return;
    const focused = !h.wc.isDestroyed() && h.wc.isFocused();
    try {
        h.destroy();
    } catch (err) {
        console.error("[Side Browser] Couldn't close the page", err);
    }
    if (focused && !h.win.isDestroyed()) h.win.webContents.focus();
}

function load(href: string) {
    if (!holder) return;
    failedUrl = null;
    // Rejects when the load fails or is replaced; did-fail-load handles what matters
    void holder.wc.loadURL(href).catch(() => { });
}

function go(action: unknown) {
    const wc = holder?.wc;
    if (!wc || wc.isDestroyed()) return;
    const history = (wc as any).navigationHistory;
    if (action === "back") {
        failedUrl = null;
        history?.goBack ? history.goBack() : (wc as any).goBack?.();
    } else if (action === "forward") {
        failedUrl = null;
        history?.goForward ? history.goForward() : (wc as any).goForward?.();
    } else if (action === "reload") {
        if (failedUrl) load(failedUrl);
        else wc.reload();
    } else if (action === "stop") {
        wc.stop();
    }
}

function cleanLabels(raw: unknown) {
    if (!raw || typeof raw !== "object") return;
    const next = { ...labels };
    for (const key of LABEL_KEYS) {
        const value = (raw as Record<string, unknown>)[key];
        if (typeof value === "string" && value.trim()) next[key] = value.slice(0, 200);
    }
    labels = next;
}

/** Colours Electron takes: #rgb to #aarrggbb, or rgb()/rgba() */
function cleanColor(raw: unknown): string | undefined {
    if (typeof raw !== "string") return undefined;
    const color = raw.trim();
    return /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(color) || /^rgba?\(\s*[\d.]+%?\s*,\s*[\d.]+%?\s*,\s*[\d.]+%?\s*(?:,\s*[\d.]+%?\s*)?\)$/i.test(color) ? color : undefined;
}

export default {
    start(context) {
        ctx = context;
    },

    stop() {
        destroyView();
        if (preparedSession) preparedSession.removeListener("will-download", onDownload);
        preparedSession = null;
        events = [];
        waiting?.(null);
        waiting = null;
        ctx = null;
    },

    /** Loads a page in the view, creating it (hidden) first. False for anything that isn't an http(s) page */
    open(url: unknown, options: unknown): boolean {
        const link = classifyUrl(url);
        if (!ctx || link.kind !== "web") return false;
        const opts = (options ?? {}) as Record<string, unknown>;
        cleanLabels(opts.labels);
        if (!holder) {
            const win = discordWindow();
            if (!win) return false;
            holder = createHolder(win, cleanColor(opts.background));
            shown = false;
            wire(holder);
        }
        load(link.href!);
        push(stateOf(holder.wc));
        return true;
    },

    go(action: unknown) {
        go(action);
    },

    /** The panel's body in CSS pixels, with the page's width: { x, y, width, height, viewportWidth } */
    setBounds(raw: unknown) {
        if (!holder || holder.win.isDestroyed()) return;
        const content = holder.win.getContentBounds();
        const next = toViewBounds(raw, content, holder.win.webContents.getZoomFactor());
        if (!next) {
            bounds = null;
            apply();
            return;
        }
        bounds = next;
        holder.setBounds(next);
        apply();
    },

    setVisible(visible: unknown) {
        wanted = visible === true;
        apply();
    },

    /** The page as it looks now, a JPEG data URL, for the panel to show while the view is hidden */
    async snapshot(): Promise<string | null> {
        const wc = holder?.wc;
        if (!wc || wc.isDestroyed() || !shown) return null;
        try {
            const image = await Promise.race([
                wc.capturePage(),
                new Promise<null>(resolve => setTimeout(() => resolve(null), SNAPSHOT_TIMEOUT_MS)),
            ]);
            if (!image || image.isEmpty()) return null;
            return "data:image/jpeg;base64," + image.toJPEG(85).toString("base64");
        } catch {
            return null;
        }
    },

    /** Destroys the view and its renderer process */
    close() {
        destroyView();
    },

    /** An http(s) link in the default browser; Discord's own links too, when Discord had no use for one */
    openExternal(url: unknown): boolean {
        const link = classifyUrl(url);
        if (link.kind === "refused") return false;
        void shell.openExternal(link.href!).catch(() => { });
        return true;
    },

    /** The page's state now, or null without one (for the renderer after a hot reload) */
    state(): SideEvent | null {
        return holder && !holder.wc.isDestroyed() ? stateOf(holder.wc) : null;
    },

    /** The renderer's loop waits here for the next event; null means stop waiting */
    nextEvent(): Promise<SideEvent | null> {
        // A newer loop (after a reload) takes over from an older one
        waiting?.(null);
        waiting = null;
        const next = events.shift();
        if (next) return Promise.resolve(next);
        return new Promise(resolve => waiting = resolve);
    },

    cancelWait() {
        waiting?.(null);
        waiting = null;
    },
} satisfies NativePlugin;
