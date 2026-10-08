import type { NativePlugin } from "@evi/api/native";
import { BrowserWindow, ipcMain, Menu, Tray } from "electron";
import type { MenuItemConstructorOptions } from "electron";

import { type Action, type Click, extraItems, mergeInto, parseTrayData, type TrayData } from "./menu";

/**
 * Discord builds its tray menu in its own main-process module (systemTray) and hands it to
 * tray.setContextMenu on every change: strings, the call, mute and deafen. Wrapping that one method
 * catches its tray and its menu, so ours is merged into each new menu Discord makes, and Discord's
 * own items (Check for Updates, Quit…) stay as they are.
 *
 * Mute and Deafen send the same messages Discord's own tray items send. Status and opening a DM need
 * the page: it waits on nextAction() for clicks, and pushes the menu's data with update().
 */

const MAX_QUEUE = 10;

let original: Tray["setContextMenu"] | undefined;
let tray: Tray | undefined;
/** Discord's last menu, as it made it */
let discordMenu: Menu | null = null;
let data: TrayData | null = null;
let connected = false;
let lastApplications: unknown[] | undefined;

let waiter: ((action: Action | null) => void) | undefined;
const queue: Action[] = [];

const discordMain = () => {
    const id = (globalThis as any).mainWindowId;
    const win = typeof id === "number" ? BrowserWindow.fromId(id) : null;
    return win && !win.isDestroyed() ? win : null;
};

/** Discord's own tray menu ends with Quit, a role item: that's how we tell it from any other menu */
const isDiscordMenu = (menu: Menu | null) => !!menu?.items.some(item => item.role === "quit");

function send(action: Action) {
    if (waiter) {
        const resolve = waiter;
        waiter = undefined;
        resolve(action);
    } else {
        queue.push(action);
        if (queue.length > MAX_QUEUE) queue.shift();
    }
}

/** Like clicking Discord's tray icon: shown, unminimized and focused */
function showMain() {
    const win = discordMain();
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
    win.webContents.send("DISCORD_MAIN_WINDOW_FOCUS");
}

function onClick(click: Click) {
    try {
        if (click.type === "mute" || click.type === "deafen") {
            discordMain()?.webContents.send(click.type === "mute" ? "DISCORD_SYSTEM_TRAY_TOGGLE_MUTE" : "DISCORD_SYSTEM_TRAY_TOGGLE_DEAFEN");
            return;
        }
        if (click.type === "open") showMain();
        send(click);
    } catch (err) {
        console.error("[Tray Menu Plus] Click failed", err);
    }
}

function merged(menu: Menu | null) {
    if (!menu || !data || !isDiscordMenu(menu)) return menu;
    const ours = extraItems(data, connected, onClick) as MenuItemConstructorOptions[];
    if (!ours.length) return menu;
    // Discord's items as they are (clicks and all); buildFromTemplate drops doubled separators
    return Menu.buildFromTemplate(mergeInto<any>(menu.items, ours));
}

/** Puts our items into the tray's current menu, after something of ours changed */
function refresh() {
    if (!tray || tray.isDestroyed() || !original || !discordMenu) return;
    try {
        original.call(tray, merged(discordMenu));
    } catch (err) {
        console.error("[Tray Menu Plus] Couldn't update the tray menu", err);
    }
}

function onStates(_: unknown, states: any) {
    const next = states?.connected === true;
    if (next === connected) return;
    connected = next;
    // Discord rebuilds its menu for this too. Its listener may have run first, with our old state
    refresh();
}

function onApplications(_: unknown, applications: unknown) {
    if (Array.isArray(applications)) lastApplications = applications;
}

export default {
    start(ctx) {
        const proto = Tray.prototype;
        original = proto.setContextMenu;
        const ours = function (this: Tray, menu: Menu | null) {
            if (!isDiscordMenu(menu)) return original!.call(this, menu);
            tray = this;
            discordMenu = menu;
            let result: Menu | null = menu;
            try {
                result = merged(menu);
            } catch (err) {
                console.error("[Tray Menu Plus] Couldn't add to the tray menu", err);
            }
            return original!.call(this, result);
        };
        proto.setContextMenu = ours;

        ipcMain.on("DISCORD_SYSTEM_TRAY_SET_STATES", onStates);
        ipcMain.on("DISCORD_SYSTEM_TRAY_SET_APPLICATIONS", onApplications);

        ctx.onDispose(() => {
            if (proto.setContextMenu === ours) proto.setContextMenu = original!;
            ipcMain.removeListener("DISCORD_SYSTEM_TRAY_SET_STATES", onStates);
            ipcMain.removeListener("DISCORD_SYSTEM_TRAY_SET_APPLICATIONS", onApplications);
            // Discord's menu back, without ours
            if (tray && !tray.isDestroyed() && discordMenu) {
                try { original!.call(tray, discordMenu); } catch { }
            }
            waiter?.(null);
            waiter = undefined;
            queue.length = 0;
            tray = undefined;
            discordMenu = null;
            data = null;
        });
    },

    /** The page's data for the menu: labels in Discord's language, status, recent DMs, mute and deafen */
    update(raw: unknown) {
        const parsed = parseTrayData(raw);
        if (!parsed) throw new Error("Bad tray data");
        const first = !data;
        data = parsed;
        if (!tray && first && discordMain()) {
            // Turned on after Discord made its tray: ask it to rebuild the menu, which lands in our
            // wrapper. Its applications list goes back as it was (empty in today's Discord)
            ipcMain.emit("DISCORD_SYSTEM_TRAY_SET_APPLICATIONS", {}, lastApplications ?? []);
            return;
        }
        refresh();
    },

    /** Waits for the next click the page has to handle. A page that (re)starts replaces the old waiter. */
    nextAction(): Promise<Action | null> {
        waiter?.(null);
        waiter = undefined;
        const queued = queue.shift();
        if (queued) return Promise.resolve(queued);
        return new Promise(resolve => void (waiter = resolve));
    },
} satisfies NativePlugin;
