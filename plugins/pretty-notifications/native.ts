/**
 * Main-process side of Pretty Notifications: the toast window. Notifications matter most while
 * Discord is minimized, in the tray or behind a game, when its page can't show anything, so the
 * toasts live in their own small window: transparent, always on top, out of the taskbar and
 * Alt+Tab, never taking focus unless you click Reply, and letting clicks through everywhere but
 * the cards.
 */
import type { NativeContext, NativePlugin } from "@evi/api/native";
import { app, BrowserWindow, screen } from "electron";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";

import type { Corner, Placement, Screen, ToastAction, ToastCommand, ToastMessage, ToastPayload } from "./shared";
import { safeImage } from "./shared";
import { CMD_CHANNEL, MSG_CHANNEL, TOAST_HTML, TOAST_PRELOAD } from "./toastPage";

/** 360px cards plus room for their shadow */
const WIDTH = 392;
const MAX_HEIGHT = 760;
const CORNERS: readonly Corner[] = ["bottom-right", "bottom-left", "top-right", "top-left"];
const SCREENS: readonly Screen[] = ["discord", "primary", "cursor"];

let ctx: NativeContext | null = null;
let preloadPath = "";
let win: BrowserWindow | null = null;
let ready = false;
let queue: ToastCommand[] = [];
let placement: Placement = { corner: "bottom-right", screen: "discord", maxVisible: 3 };

/** Actions waiting for the page side, and the page side's pending nextAction call */
let actions: ToastAction[] = [];
let waiting: ((action: ToastAction | null) => void) | null = null;

function discordWindow(): BrowserWindow | null {
    const id = (globalThis as any).mainWindowId;
    const main = typeof id === "number" ? BrowserWindow.fromId(id) : null;
    return main && !main.isDestroyed() ? main : null;
}

function targetDisplay(which: Screen) {
    if (which === "cursor") return screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    if (which === "discord") {
        const main = discordWindow();
        if (main) return screen.getDisplayMatching(main.isMinimized() ? main.getNormalBounds() : main.getBounds());
    }
    return screen.getPrimaryDisplay();
}

function place(w: BrowserWindow) {
    const area = targetDisplay(placement.screen).workArea;
    const height = Math.min(MAX_HEIGHT, area.height);
    const x = placement.corner.endsWith("right") ? area.x + area.width - WIDTH : area.x;
    const y = placement.corner.startsWith("bottom") ? area.y + area.height - height : area.y;
    w.setBounds({ x: Math.round(x), y: Math.round(y), width: WIDTH, height: Math.round(height) });
}

function send(cmd: ToastCommand) {
    if (!win || win.isDestroyed() || !ready) {
        queue.push(cmd);
        return;
    }
    win.webContents.send(CMD_CHANNEL, cmd);
}

function pushAction(action: ToastAction) {
    if (waiting) {
        const resolve = waiting;
        waiting = null;
        resolve(action);
    } else {
        actions.push(action);
        // Nobody listening (the page side is reloading): keep a short backlog only
        if (actions.length > 50) actions.shift();
    }
}

function setTyping(active: boolean) {
    if (!win || win.isDestroyed()) return;
    if (active) {
        win.setFocusable(true);
        win.focus();
        win.webContents.focus();
    } else {
        win.setFocusable(false);
    }
}

function onMessage(msg: ToastMessage) {
    if (!msg || typeof msg !== "object" || !win) return;
    switch (msg.type) {
        case "ready":
            ready = true;
            for (const cmd of queue.splice(0)) win.webContents.send(CMD_CHANNEL, cmd);
            break;
        case "pointer":
            win.setIgnoreMouseEvents(!msg.inside, { forward: true });
            break;
        case "typing":
            setTyping(!!msg.active);
            break;
        case "empty":
            setTyping(false);
            win.setIgnoreMouseEvents(true, { forward: true });
            win.hide();
            break;
        case "action": {
            const action = msg.action;
            if (!action || typeof action.id !== "string") return;
            if (action.kind === "click") {
                const main = discordWindow();
                if (main) {
                    if (main.isMinimized()) main.restore();
                    main.show();
                    main.focus();
                }
            }
            if (action.kind === "click" || action.kind === "closed") pushAction({ kind: action.kind, id: action.id });
            else if (action.kind === "reply" && typeof action.text === "string") pushAction({ kind: "reply", id: action.id, text: action.text.slice(0, 4000) });
            break;
        }
    }
}

function createWindow(): BrowserWindow {
    ready = false;
    const w = new BrowserWindow({
        width: WIDTH,
        height: 400,
        show: false,
        frame: false,
        transparent: true,
        backgroundColor: "#00000000",
        hasShadow: false,
        resizable: false,
        movable: false,
        minimizable: false,
        maximizable: false,
        fullscreenable: false,
        skipTaskbar: true,
        focusable: false,
        alwaysOnTop: true,
        // Keeps it out of Alt+Tab on Windows; a floating panel on macOS
        type: process.platform === "win32" ? "toolbar" : process.platform === "darwin" ? "panel" : undefined,
        title: "Evi notifications",
        webPreferences: {
            preload: preloadPath,
            sandbox: true,
            contextIsolation: true,
            nodeIntegration: false,
            // Its own in-memory session: no cookies, nothing shared with Discord's page
            partition: "pretty-notifications",
            spellcheck: false,
            devTools: !app.isPackaged,
            backgroundThrottling: false,
        },
    });
    w.setAlwaysOnTop(true, "pop-up-menu");
    w.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false });
    w.setIgnoreMouseEvents(true, { forward: true });
    w.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    w.webContents.on("will-navigate", e => e.preventDefault());
    w.webContents.ipc.on(MSG_CHANNEL, (event, msg: ToastMessage) => {
        if (event.sender === w.webContents) onMessage(msg);
    });
    w.webContents.on("render-process-gone", () => {
        ready = false;
        if (!w.isDestroyed()) w.destroy();
    });
    w.on("closed", () => {
        if (win === w) {
            win = null;
            ready = false;
        }
    });
    void w.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(TOAST_HTML));
    return w;
}

function ensureWindow(): BrowserWindow {
    if (!win || win.isDestroyed()) win = createWindow();
    return win;
}

function destroyWindow() {
    queue = [];
    ready = false;
    if (win && !win.isDestroyed()) win.destroy();
    win = null;
}

function cleanPayload(raw: unknown): ToastPayload | null {
    if (!raw || typeof raw !== "object") return null;
    const p = raw as Record<string, any>;
    const str = (v: unknown, max: number) => typeof v === "string" ? v.slice(0, max) : "";
    if (!str(p.id, 100) || !p.labels || typeof p.labels !== "object") return null;
    const labels = Object.fromEntries(
        ["open", "close", "reply", "placeholder", "send", "sending", "sent", "failed"].map(k => [k, str(p.labels[k], 200)]),
    ) as unknown as ToastPayload["labels"];
    return {
        id: str(p.id, 100),
        avatar: safeImage(p.avatar),
        badge: safeImage(p.badge),
        title: str(p.title, 200),
        context: str(p.context, 200) || undefined,
        body: str(p.body, 1000),
        canReply: p.canReply === true,
        theme: p.theme === "light" ? "light" : "dark",
        duration: Math.min(60_000, Math.max(2000, Number(p.duration) || 6000)),
        labels,
    };
}

function cleanPlacement(raw: unknown): Placement {
    const p = (raw ?? {}) as Record<string, any>;
    return {
        corner: CORNERS.includes(p.corner) ? p.corner : "bottom-right",
        screen: SCREENS.includes(p.screen) ? p.screen : "discord",
        maxVisible: Math.min(6, Math.max(1, Math.round(Number(p.maxVisible) || 3))),
    };
}

const onQuit = () => destroyWindow();

export default {
    start(context) {
        ctx = context;
        try {
            mkdirSync(context.dataDir, { recursive: true });
            preloadPath = join(context.dataDir, "toast-preload.js");
            writeFileSync(preloadPath, TOAST_PRELOAD);
        } catch (err) {
            console.error("[Pretty Notifications] Couldn't write the toast window's preload", err);
        }
        app.on("before-quit", onQuit);
        context.onDispose(() => app.removeListener("before-quit", onQuit));
    },

    stop() {
        destroyWindow();
        actions = [];
        waiting?.(null);
        waiting = null;
        ctx = null;
    },

    /** ctx.native.call("show", toast, placement): shows it, or updates the one with the same id */
    show(raw: unknown, rawPlacement: unknown): boolean {
        const toast = cleanPayload(raw);
        if (!toast || !ctx || !preloadPath) return false;
        const next = cleanPlacement(rawPlacement);
        const w = ensureWindow();
        const moved = next.corner !== placement.corner || next.screen !== placement.screen || !w.isVisible();
        placement = next;
        if (moved) place(w);
        send({ type: "show", toast, corner: placement.corner, maxVisible: placement.maxVisible });
        if (!w.isVisible()) w.showInactive();
        w.setAlwaysOnTop(true, "pop-up-menu");
        return true;
    },

    dismiss(id: unknown) {
        if (typeof id === "string") send({ type: "dismiss", id });
    },

    clear() {
        if (win && !win.isDestroyed()) send({ type: "clear" });
    },

    replyResult(id: unknown, ok: unknown) {
        if (typeof id === "string") send({ type: "replyResult", id, ok: ok === true });
    },

    /** The page side's loop waits here for the next click, reply or close; null means stop waiting */
    nextAction(): Promise<ToastAction | null> {
        // A newer page-side loop (after a reload) takes over from an older one
        waiting?.(null);
        waiting = null;
        const next = actions.shift();
        if (next) return Promise.resolve(next);
        return new Promise(resolve => waiting = resolve);
    },

    cancelWait() {
        waiting?.(null);
        waiting = null;
    },
} satisfies NativePlugin;
