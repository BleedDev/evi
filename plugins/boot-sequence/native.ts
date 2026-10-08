import type { NativeContext, NativePlugin } from "@evi/api/native";
import { app, BrowserWindow, screen } from "electron";
import { mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import { join } from "path";

import {
    type BootConfig, type BootEvent, type BootState, type BootStrings, initialState, isDiscordAppUrl, isSplashUrl, orderPlugins, parseReport, reduce,
    sanitizeConfig, sanitizeStrings, splashCss, splashScript, view, windowSize,
} from "./boot";

/** How long Discord's splash may wait for the boot screen before it shows anyway */
const SHOW_WAIT_MS = 400;

let dir = "";
let dataDir = "";

/**
 * The order Evi starts plugins in: the order its main process read their folders, its own plugins
 * folder and then a dev folder, an id seen twice keeping its first place (src/main/plugins.ts).
 */
function startOrder(): string[] {
    const order: string[] = [];
    for (const root of [join(dataDir, "plugins"), process.env.EVI_DEV_PLUGINS ?? process.env.DELIGHT_DEV_PLUGINS]) {
        if (!root) continue;
        let entries: import("fs").Dirent[] = [];
        try {
            entries = readdirSync(root, { withFileTypes: true });
        } catch {
            continue;
        }
        for (const entry of entries) {
            if (!entry.isDirectory()) continue;
            let id = entry.name;
            try {
                const manifest = JSON.parse(readFileSync(join(root, entry.name, "manifest.json"), "utf8"));
                if (typeof manifest.id === "string") id = manifest.id;
            } catch {
                continue;
            }
            if (!order.includes(id)) order.push(id);
        }
    }
    return order;
}

const savedFile = () => join(dir, "config.json");

function readSaved(): { config: BootConfig; strings: BootStrings; } {
    let raw: any;
    try {
        raw = JSON.parse(readFileSync(savedFile(), "utf8"));
    } catch { }
    return { config: sanitizeConfig(raw?.config), strings: sanitizeStrings(raw?.strings) };
}

/** Discord's version, from the file Discord itself reads it from */
function discordVersion(): string | null {
    try {
        const info = JSON.parse(readFileSync(join(process.resourcesPath, "build_info.json"), "utf8"));
        return typeof info.version === "string" ? info.version.slice(0, 24) : null;
    } catch {
        return null;
    }
}

/** When Discord's process started, for the header's clock */
const processStart = () => Date.now() - process.uptime() * 1000;

interface Session {
    win: BrowserWindow;
    state: BootState;
    config: BootConfig;
    strings: BootStrings;
    /** The boot screen is in the page and can render */
    ready: boolean;
    pending: boolean;
    manual: boolean;
    cleanup: (() => void)[];
}

let session: Session | undefined;

function send(s: Session, code: string) {
    if (s.win.isDestroyed()) return;
    s.win.webContents.executeJavaScript(code).catch(() => { });
}

/** Renders the latest state, at most once a tick however many events arrive */
function schedule(s: Session) {
    if (!s.ready || s.pending) return;
    s.pending = true;
    setImmediate(() => {
        s.pending = false;
        if (session !== s) return;
        send(s, `window.__eviBoot && window.__eviBoot.render(${JSON.stringify(view(s.state, s.strings, s.config))})`);
    });
}

function feed(event: BootEvent) {
    const s = session;
    if (!s) return;
    s.state = reduce(s.state, event);
    if (event.t === "discord") setManual(s, event.state?.status === "update-manually");
    schedule(s);
}

/**
 * Discord's "a new version, download it yourself" screen (Linux) is a form: it gets its own look and
 * size back.
 */
function setManual(s: Session, on: boolean) {
    if (s.manual === on || s.win.isDestroyed()) return;
    s.manual = on;
    try {
        place(s.win, on ? { width: 300, height: process.platform === "win32" ? 350 : 300 } : windowSize(s.config));
    } catch { }
    if (s.ready) send(s, `window.__eviBoot && window.__eviBoot.manual(${on})`);
}

function place(win: BrowserWindow, size: { width: number; height: number; }) {
    const area = screen.getDisplayMatching(win.getBounds()).workArea;
    win.setBounds({
        x: Math.round(area.x + (area.width - size.width) / 2),
        y: Math.round(area.y + (area.height - size.height) / 2),
        width: size.width,
        height: size.height,
    });
}

/** Turns Discord's splash into the boot screen. Any failure leaves Discord's own splash as it was. */
function dress(win: BrowserWindow) {
    const { config, strings } = readSaved();
    const s: Session = { win, state: initialState(discordVersion()), config, strings, ready: false, pending: false, manual: false, cleanup: [] };
    session = s;
    const wc = win.webContents;

    let release: () => void = () => { };
    const ready = new Promise<void>(resolve => {
        release = resolve;
        setTimeout(resolve, SHOW_WAIT_MS);
    });
    try {
        win.setBackgroundColor("#0b0b0c");
        place(win, windowSize(config));
        for (const method of ["show", "showInactive"] as const) {
            const original = win[method].bind(win);
            win[method] = () => void ready.then(() => !win.isDestroyed() && original());
        }
    } catch (err) {
        console.error("[Evi] Boot Sequence couldn't size the splash", err);
    }

    wc.once("dom-ready", () => {
        if (win.isDestroyed()) return release();
        Promise.all([wc.insertCSS(splashCss(config)), wc.executeJavaScript(splashScript(processStart()))])
            .then(() => {
                s.ready = true;
                if (s.manual) send(s, "window.__eviBoot && window.__eviBoot.manual(true)");
                // The first frame goes out before Discord may show the window
                return wc.executeJavaScript(`window.__eviBoot && window.__eviBoot.render(${JSON.stringify(view(s.state, s.strings, s.config))})`);
            })
            .catch(err => console.error("[Evi] Boot Sequence couldn't dress the splash", err))
            .finally(release);
    });

    win.once("closed", () => {
        if (session === s) session = undefined;
        for (const fn of s.cleanup.splice(0)) {
            try { fn(); } catch { }
        }
    });
}

/** Reads the page's reports while the splash is up */
function listen(win: BrowserWindow) {
    const s = session;
    if (!s) return;
    const wc = win.webContents;
    const onMessage = (...args: any[]) => {
        // Electron 36+ passes one event with .message; older ones (event, level, message)
        const message = typeof args[0]?.message === "string" ? args[0].message : args[2];
        if (typeof message !== "string" || !message.startsWith("[evi-boot]")) return;
        if (!isDiscordAppUrl(wc.getURL())) return;
        const event = parseReport(message);
        if (event?.t === "hello") {
            try {
                event.plugins = orderPlugins(event.plugins, startOrder());
            } catch { }
        }
        if (event) feed(event);
    };
    wc.on("console-message", onMessage);
    s.cleanup.push(() => !wc.isDestroyed() && wc.removeListener("console-message", onMessage));
}

function onWindow(_: unknown, win: BrowserWindow) {
    try {
        const wc = win.webContents;
        // A splash in progress: any window made now may be Discord's main one, whose page reports
        if (session && !session.win.isDestroyed()) listen(win);

        // Discord tells its splash how updating goes; heard on the way, before the page has it.
        // Only until the window turns out not to be the splash
        const original = wc.send;
        wc.send = function (channel: string, ...rest: any[]) {
            if (channel === "DISCORD_SPLASH_UPDATE_STATE" && session?.win === win) {
                try { feed({ t: "discord", state: rest[0] ?? {} }); } catch { }
            }
            return original.call(this, channel, ...rest);
        };

        let seen = false;
        const check = (...args: any[]) => {
            const url = args[0]?.url ?? args[1];
            if (seen || typeof url !== "string") return;
            seen = true;
            wc.removeListener("did-start-navigation", check);
            if (!isSplashUrl(url)) {
                // Back to Electron's own
                delete (wc as any).send;
                return;
            }
            dress(win);
        };
        wc.on("did-start-navigation", check);
    } catch (err) {
        console.error("[Evi] Boot Sequence", err);
    }
}

// ---- Preview: the boot screen with made-up steps, in a window the size of the real one ------------

let preview: BrowserWindow | undefined;

function previewEvents(plugins: { id: string; name: string; }[], themes: string[], evi: string): [number, BootEvent][] {
    const out: [number, BootEvent][] = [];
    let at = 300;
    const add = (ms: number, e: BootEvent) => out.push([at += ms, e]);
    add(0, { t: "discord", state: { status: "checking-for-updates" } });
    for (let i = 0; i <= 10; i++) add(i ? 70 : 500, { t: "discord", state: { status: "downloading-updates", current: 1, total: 1, progress: i * 10 } });
    add(160, { t: "discord", state: { status: "installing-updates", current: 1, total: 1, progress: 100 } });
    add(320, { t: "discord", state: { status: "launching" } });
    add(420, { t: "hello", evi, themes, safe: false, plugins });
    for (const p of plugins) add(40 + Math.round(Math.random() * 90), { t: "plugin", id: p.id, ok: true });
    return out;
}

export default {
    start(ctx: NativeContext) {
        dataDir = ctx.dataDir;
        dir = join(ctx.dataDir, "boot-sequence");
        // Registered synchronously: Discord creates its splash right after app ready
        app.on("browser-window-created", onWindow);
        ctx.onDispose(() => {
            app.removeListener("browser-window-created", onWindow);
            if (preview && !preview.isDestroyed()) preview.close();
        });
    },

    /** The page's settings and texts, for the next start */
    save(raw: unknown) {
        const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
        const data = { config: sanitizeConfig(r.config), strings: sanitizeStrings(r.strings) };
        mkdirSync(dir, { recursive: true });
        const tmp = `${savedFile()}.tmp`;
        writeFileSync(tmp, JSON.stringify(data));
        renameSync(tmp, savedFile());
        return true;
    },

    async preview(raw: unknown) {
        const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, any>;
        const config = sanitizeConfig(r.config);
        const strings = sanitizeStrings(r.strings);
        const hello = parseReport(`[evi-boot] ${JSON.stringify({ t: "hello", evi: r.evi, themes: r.themes, plugins: r.plugins })}`);
        if (hello?.t !== "hello") return false;

        if (preview && !preview.isDestroyed()) preview.close();
        const size = windowSize(config);
        const parent = BrowserWindow.getFocusedWindow() ?? undefined;
        const win = preview = new BrowserWindow({
            ...size,
            frame: false,
            resizable: false,
            minimizable: false,
            maximizable: false,
            skipTaskbar: true,
            show: false,
            parent,
            backgroundColor: "#0b0b0c",
            webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
        });
        const close = () => !win.isDestroyed() && win.close();
        win.on("blur", close);
        win.webContents.on("before-input-event", (_, input) => input.type === "keyDown" && close());
        await win.loadURL("data:text/html;charset=utf-8,<!DOCTYPE html><html><head><meta charset=utf-8><title>Boot Sequence</title></head><body></body></html>");
        await win.webContents.insertCSS(splashCss(config));
        await win.webContents.executeJavaScript(splashScript(Date.now()));
        await win.webContents.executeJavaScript(`document.addEventListener("click", () => window.close())`);

        let state = initialState(discordVersion());
        const render = () => !win.isDestroyed() && win.webContents.executeJavaScript(`window.__eviBoot.render(${JSON.stringify(view(state, strings, config))})`).catch(() => { });
        render();
        win.show();

        const events = previewEvents(hello.plugins, hello.themes, hello.evi);
        const timers = events.map(([at, event]) => setTimeout(() => {
            state = reduce(state, event);
            render();
        }, at));
        // Then the hard cut, like Discord's
        timers.push(setTimeout(close, events[events.length - 1][0] + 700));
        win.on("closed", () => timers.forEach(clearTimeout));
        return true;
    },
} satisfies NativePlugin;
