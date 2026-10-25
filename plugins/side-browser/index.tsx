/**
 * Links clicked in chat open in a panel beside it.
 *
 * Which clicks: Discord's link click handler (the one with the "Leaving Discord" warning) is patched
 * in two places, both after its own checks and Link Safety's: where a link it trusts is left to the
 * browser's default action (which opens it outside Discord), and the Visit Site button of its
 * warning. Links Discord handles itself (invites, messages, gifts, the app directory) are dealt with
 * before either and never reach the panel. Links Link Safety warns about open in the browser after
 * "Open anyway", where the browser's own protections apply. A middle click goes through the same
 * handler: it's turned into a click on the link, marked so the decision knows.
 *
 * Where: a second patch renders the panel after the thread sidebar in the channel page (the class
 * that lays out the chat, a call and the sidebars). It's a flex sibling, so the chat gets narrower
 * instead of covered, and it's only there while a chat is: elsewhere links open in the browser.
 *
 * The page: native.ts puts a WebContentsView over the panel's body, at the rectangle reported here
 * (a ResizeObserver, window resizes, and a check every 250ms for moves that change no size). The
 * view draws above all of Discord's page, so it only shows while nothing of Discord's is over the
 * panel: the page is asked what's on top at points across the body (elementFromPoint, which sees
 * dialogs, settings, menus and other plugins' layers), and Discord's popout and tooltip layers are
 * checked for overlap too, since some let clicks through and hit-testing misses those. That runs
 * when a layer opens or closes (observed), on resizes, and every 250ms. Before the view hides, the
 * panel shows a snapshot of the page, so a menu or dialog over it looks like it does over anything
 * else. The snapshot also stands in while the panel is resized and slides out with it on close.
 *
 * Opening and closing move like Discord's dialogs (the spring curves from layer.ts): the panel
 * slides in, and the view is only attached once it has arrived. Closing destroys the view and its
 * renderer process.
 */
import { Components, definePlugin, exitDone, filters, find, React, useLocale } from "@evi/api";
import type { PluginContext } from "@evi/api";
import type { CSSProperties, ReactNode } from "react";

import type { Gesture, Mode, PanelBounds, Rect, SiteRules } from "./links";
import { clampWidth, classifyUrl, DEFAULT_WIDTH, displayHost, intersects, MODES, opensInPanel, parseSiteRules, sameRect, samplePoints } from "./links";
import type { SideEvent } from "./native";
import { t } from "./strings";

type Settings = typeof settings;
const settings = {
    mode: {
        type: "select",
        get label() { return t("settings.mode"); },
        get description() { return t("settings.mode.description"); },
        default: "all",
        options: [
            { get label() { return t("settings.mode.all"); }, value: "all" },
            { get label() { return t("settings.mode.modifier"); }, value: "modifier" },
            { get label() { return t("settings.mode.sites"); }, value: "sites" },
        ],
    },
    sites: {
        type: "string",
        get label() { return t("settings.sites"); },
        get description() { return t("settings.sites.description"); },
        get placeholder() { return t("settings.sites.placeholder"); },
        default: "",
        multiline: true,
    },
} as const;

/** The panel's width, kept with the settings but not shown with them */
const WIDTH_KEY = "width";
/** How often the panel's place and what's over it are checked besides the observers */
const CHECK_MS = 250;
/** Discord's popout, menu and tooltip layers */
const LAYER_CONTAINERS = "[class^=\"layerContainer_\"], [class*=\" layerContainer_\"]";
/** Its full-screen layers (settings), as siblings of the app's own */
const LAYERS = "[class^=\"layers_\"], [class*=\" layers_\"]";

let context: PluginContext<Settings> | undefined;
let mode: Mode = "all";
let rules: SiteRules = { open: [], never: [] };
let generation = 0;
/** Panel spots in Discord's tree right now: none means no chat on screen */
let hosts = 0;
/** Clicks made from middle clicks (see onAuxClick) */
const middleClicks = new WeakSet<Event>();

type Phase = "closed" | "open" | "closing";
interface PanelState {
    phase: Phase;
    url: string;
    title: string;
    canGoBack: boolean;
    canGoForward: boolean;
    loading: boolean;
    crashed: boolean;
}
const CLOSED: PanelState = { phase: "closed", url: "", title: "", canGoBack: false, canGoForward: false, loading: false, crashed: false };

let state = CLOSED;
const listeners = new Set<() => void>();
const subscribe = (fn: () => void) => (listeners.add(fn), () => void listeners.delete(fn));
const usePanel = () => React.useSyncExternalStore(subscribe, () => state);

function setState(patch: Partial<PanelState>) {
    state = { ...state, ...patch };
    for (const fn of [...listeners]) fn();
}

/**
 * Reasons the page stays hidden whatever the overlap check says ("resize", "close"). `resync` is the
 * shown panel's: it checks now and resolves once the view is shown or hidden as it should be.
 */
const holds = new Set<string>();
let resync: (() => Promise<void>) | null = null;

async function hold(reason: string) {
    holds.add(reason);
    await resync?.();
}

function release(reason: string) {
    if (holds.delete(reason)) void resync?.();
}

type Storage = { get(key: string): unknown; set(key: string, value: unknown): void; };
const storage = () => context?.settings as unknown as Storage | undefined;

function call<T = unknown>(method: string, ...args: unknown[]): Promise<T | null> {
    const ctx = context;
    if (!ctx) return Promise.resolve(null);
    return ctx.native.call<T>(method, ...args).catch(err => {
        ctx.logger.warn(`${method} failed`, err);
        return null;
    });
}

function nativeLabels() {
    return {
        back: t("button.back"), forward: t("button.forward"), reload: t("button.reload"),
        cut: t("menu.cut"), copy: t("menu.copy"), paste: t("menu.paste"),
        copyLink: t("menu.copyLink"), openLink: t("menu.openLink"), openPage: t("menu.openPage"),
        failed: t("panel.failed"),
    };
}

/** The panel's background as a colour Electron takes, for the page before it paints */
function panelBackground(): string | undefined {
    const probe = document.createElement("div");
    probe.className = "evi-sbrowser-probe";
    document.body.append(probe);
    const color = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return /^rgba?\(/.test(color) && !/^rgba\(\d+, \d+, \d+, 0\)$/.test(color) ? color : undefined;
}

/** How a link was clicked; null for a click in another window (a popped-out chat), which the panel isn't next to */
function gestureOf(event: any): Gesture | null {
    const native = event?.nativeEvent ?? event;
    if (!native || typeof native !== "object") return "none";
    if (native.view && native.view !== window) return null;
    if (middleClicks.has(native)) return "middle";
    if (native.ctrlKey || native.metaKey) return "modified";
    return "click";
}

function wants(url: unknown, event: unknown, props: any): url is string {
    if (!context || !hosts || typeof url !== "string") return false;
    // A link with its own way of opening (onConfirm) is left to it
    if (typeof props?.onConfirm === "function") return false;
    const gesture = gestureOf(event);
    return !!gesture && opensInPanel(url, { mode, rules, gesture });
}

let closeRun = 0;

/** Opens a link in the panel; false when there's no panel to open it in */
function openInPanel(url: string): boolean {
    const link = classifyUrl(url);
    if (!context || !hosts || link.kind !== "web") return false;
    // A close still on its way out is called off
    closeRun++;
    release("close");
    const href = link.href!;
    const opening = state.phase !== "open";
    void call<boolean>("open", href, { labels: nativeLabels(), background: panelBackground() }).then(async ok => {
        if (ok === true) return;
        // No page after all (no Discord window, or the native side isn't running): the browser, as without the plugin
        void closePanel();
        if (await call<boolean>("openExternal", href) !== true) window.open(href, "_blank", "noopener");
    });
    setState(opening
        ? { ...CLOSED, phase: "open", url: href, loading: true }
        : { url: href, title: "", loading: true, crashed: false });
    return true;
}

/** Freezes the page into its snapshot, slides the panel out, then destroys the view (finishClose) */
async function closePanel() {
    if (state.phase !== "open") return;
    const run = ++closeRun;
    await hold("close");
    if (run !== closeRun || state.phase !== "open") return;
    setState({ phase: "closing" });
}

function finishClose() {
    if (state.phase !== "closing") return;
    holds.delete("close");
    void call("close");
    setState(CLOSED);
}

/** Discord's handler for its own links (invites, messages, gifts...): returns a click handler, or nothing */
const discordLinkFilter = filters.byCode("skipExtensionCheck", "APP_DIRECTORY_PROFILE");
let discordLinks: ((url: string, options?: object) => unknown) | undefined;

/** A Discord link the page tried to open: Discord handles it, or the browser does */
function openDiscordLink(url: string) {
    try {
        discordLinks ??= find(discordLinkFilter);
        const handler = discordLinks?.(url, { analyticsLocations: [] });
        if (typeof handler === "function" && handler(null)) return;
    } catch (err) {
        context?.logger.warn("Discord's link handler failed", err);
    }
    void call("openExternal", url);
}

function handle(ctx: PluginContext<Settings>, event: SideEvent) {
    switch (event.type) {
        case "state":
            if (state.phase !== "open") return;
            setState({ url: event.url || state.url, title: event.title, canGoBack: event.canGoBack, canGoForward: event.canGoForward, loading: event.loading });
            break;
        case "discord":
            openDiscordLink(event.url);
            break;
        case "download":
            ctx.toast(t("toast.download"));
            break;
        case "gone":
            if (state.phase === "open") setState({ crashed: true, loading: false, canGoBack: false, canGoForward: false, url: event.url || state.url });
            break;
    }
}

/** The page's events, one at a time */
async function listen(ctx: PluginContext<Settings>, gen: number) {
    while (gen === generation) {
        let event: SideEvent | null;
        try {
            event = await ctx.native.call<SideEvent | null>("nextEvent");
        } catch {
            if (gen !== generation) return;
            await new Promise(r => setTimeout(r, 3000));
            continue;
        }
        // null: the plugin stopped, or a newer copy of it took over
        if (!event || gen !== generation) return;
        try {
            handle(ctx, event);
        } catch (err) {
            ctx.logger.error("Couldn't handle a page event", err);
        }
    }
}

/**
 * Middle clicks on links normally open them outside Discord without asking. One that would open in
 * the panel becomes a click on the link instead, so Discord's handler (with its warning, and Link
 * Safety's) still decides.
 */
function onAuxClick(event: MouseEvent) {
    if (event.button !== 1 || !context || !hosts) return;
    const anchor = (event.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
    // Only links that open in a new window anyway: a plain click on any other would navigate Discord's page
    if (!anchor || anchor.target !== "_blank" || anchor.closest(".evi-sbrowser")) return;
    if (!opensInPanel(anchor.href, { mode, rules, gesture: "middle" })) return;
    event.preventDefault();
    event.stopPropagation();
    const click = new MouseEvent("click", { bubbles: true, cancelable: true, view: window, button: 0 });
    middleClicks.add(click);
    anchor.dispatchEvent(click);
}

/**
 * Whether `el` or its children (two levels: a layer is often a wrapper around the box) are drawn over
 * the rectangle. Not opacity: a popout fading in starts at 0, and it's over the panel all the same.
 */
function layerOver(el: Element, rect: Rect, depth = 2): boolean {
    if ((el as any).checkVisibility?.({ visibilityProperty: true }) === false) return false;
    const box = el.getBoundingClientRect();
    // A wrapper the size of the window is a frame, not something drawn: what's in it counts. A real dialog
    // or backdrop takes clicks, so the hit test above finds it anyway
    const frame = box.width * box.height >= 0.9 * window.innerWidth * window.innerHeight;
    if (!frame && box.width > 0 && box.height > 0 && intersects(box, rect)) return true;
    if (depth > 1) for (const child of el.children) if (layerOver(child, rect, depth - 1)) return true;
    return false;
}

/** What of Discord's (or another plugin's) is drawn over the rectangle, if anything */
function coverOf(body: HTMLElement, rect: Rect): Element | null {
    for (const [x, y] of samplePoints(rect, 5, 7, 8)) {
        const hit = document.elementFromPoint(x, y);
        if (hit && !body.contains(hit)) return hit;
    }
    // Popouts and tooltips, which may let clicks through
    for (const container of document.querySelectorAll(LAYER_CONTAINERS)) {
        for (const layer of container.children) if (layerOver(layer, rect)) return layer;
    }
    // Evi's and plugins' dialogs on their way out let clicks through too
    for (const child of document.body.children) {
        if (child.hasAttribute("data-closing") && [...child.children].some(layer => layerOver(layer, rect))) return child;
    }
    return null;
}

/** For the log: what kept the page hidden a long time, in case it's something that never goes away */
function describe(el: Element) {
    const classes = typeof el.className === "string" ? el.className.trim().split(/\s+/).slice(0, 3).join(".") : "";
    return el.tagName.toLowerCase() + (el.id ? "#" + el.id : "") + (classes ? "." + classes : "");
}

/**
 * Keeps the native view over `body` while `active`: reports its rectangle, and shows it only once
 * the panel has slid in and while nothing covers it, swapping in a snapshot before it hides.
 */
function useNativeView(root: React.RefObject<HTMLElement | null>, body: React.RefObject<HTMLDivElement | null>, shot: React.RefObject<HTMLImageElement | null>, active: boolean) {
    React.useEffect(() => {
        const panel = root.current, el = body.current;
        if (!active || !context || !panel || !el) return;
        let disposed = false;
        let started = false;
        /** What native was last told, and what it should be */
        let visible = false;
        let want = false;
        let lastBounds: PanelBounds | null = null;
        let running: Promise<void> | null = null;
        let frame = 0;
        let lastCover: Element | null = null;
        let coveredSince = 0;
        let reported = false;

        const showShot = async (src: string | null) => {
            const img = shot.current;
            if (!img) return;
            if (!src) {
                img.hidden = true;
                img.removeAttribute("src");
                return;
            }
            img.src = src;
            await img.decode().catch(() => { });
            img.hidden = false;
        };

        const settle = async () => {
            while (!disposed && visible !== want) {
                if (want) {
                    await call("setVisible", true);
                    visible = true;
                    // The page covers it now
                    if (want) void showShot(null);
                } else {
                    const src = document.visibilityState === "visible" ? await call<string>("snapshot") : null;
                    if (src && !disposed) await showShot(src);
                    await call("setVisible", false);
                    visible = false;
                }
            }
        };
        const kick = (): Promise<void> => {
            running ??= settle().finally(() => {
                running = null;
                if (!disposed && visible !== want) void kick();
            });
            return running;
        };

        const sync = (): Promise<void> => {
            if (disposed || !started) return Promise.resolve();
            const r = el.getBoundingClientRect();
            const bounds: PanelBounds = { x: r.left, y: r.top, width: r.width, height: r.height, viewportWidth: window.innerWidth };
            if (!sameRect(bounds, lastBounds) || bounds.viewportWidth !== lastBounds?.viewportWidth) {
                lastBounds = bounds;
                void call("setBounds", bounds);
            }
            const onScreen = !holds.size && document.visibilityState === "visible" && bounds.width > 0 && bounds.height > 0;
            const cover = onScreen ? coverOf(el, bounds) : null;
            want = onScreen && !cover;
            if (cover !== lastCover) {
                lastCover = cover;
                coveredSince = performance.now();
            } else if (cover && !reported && performance.now() - coveredSince > 15_000) {
                reported = true;
                context?.logger.info("The page has been hidden for a while, behind", describe(cover));
            }
            return kick();
        };
        const schedule = () => {
            if (!frame) frame = requestAnimationFrame(() => {
                frame = 0;
                void sync();
            });
        };

        // Layers opening and closing: on <body>, in Discord's layer containers and its full-screen layers
        const observed = new WeakSet<Element>();
        const mutations = new MutationObserver(schedule);
        const watch = () => {
            for (const target of [document.body, ...document.querySelectorAll(LAYER_CONTAINERS), ...document.querySelectorAll(LAYERS)]) {
                if (observed.has(target)) continue;
                observed.add(target);
                mutations.observe(target, { childList: true });
            }
        };
        watch();
        const resize = new ResizeObserver(schedule);
        resize.observe(el);
        window.addEventListener("resize", schedule);
        document.addEventListener("visibilitychange", schedule);
        const timer = setInterval(() => {
            watch();
            void sync();
        }, CHECK_MS);

        // Only once the panel has slid in: the view can't move with it
        void exitDone(panel).then(() => {
            if (disposed) return;
            started = true;
            resync = sync;
            void sync();
        });

        return () => {
            disposed = true;
            if (resync === sync) resync = null;
            cancelAnimationFrame(frame);
            clearInterval(timer);
            mutations.disconnect();
            resize.disconnect();
            window.removeEventListener("resize", schedule);
            document.removeEventListener("visibilitychange", schedule);
            if (visible || running) void call("setVisible", false);
        };
    }, [active]);
}

const ICONS = {
    back: "M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z",
    forward: "M4 11h12.17l-5.59-5.59L12 4l8 8-8 8-1.41-1.41L16.17 13H4v-2z",
    reload: "M17.65 6.35A7.958 7.958 0 0 0 12 4a8 8 0 1 0 7.73 10h-2.08A6 6 0 1 1 12 6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z",
    close: "M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z",
    link: "M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1zM8 13h8v-2H8v2zm9-6h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1h-4V17h4c2.76 0 5-2.24 5-5s-2.24-5-5-5z",
    external: "M19 19H5V5h7V3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z",
    lock: "M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zM9 8V6c0-1.66 1.34-3 3-3s3 1.34 3 3v2H9z",
};

function Icon({ path, size = 20 }: { path: string; size?: number; }) {
    return <svg aria-hidden="true" viewBox="0 0 24 24" width={size} height={size}><path fill="currentColor" d={path} /></svg>;
}

function HeaderButton({ label, icon, onClick, disabled }: { label: string; icon: string; onClick(): void; disabled?: boolean; }) {
    const button = (
        <button type="button" className="evi-sbrowser-button" aria-label={label} disabled={disabled} onClick={onClick}>
            <Icon path={icon} />
        </button>
    );
    // Above the button: below it, the tooltip would be over the page and hide it
    const Tooltip = Components.Tooltip as any;
    return Tooltip && !disabled ? <Tooltip text={label} position="top">{button}</Tooltip> : button;
}

function storedWidth() {
    const width = storage()?.get(WIDTH_KEY);
    return typeof width === "number" && Number.isFinite(width) ? width : DEFAULT_WIDTH;
}

function SidePanel({ s }: { s: PanelState; }) {
    useLocale();
    const rootRef = React.useRef<HTMLElement>(null);
    const bodyRef = React.useRef<HTMLDivElement>(null);
    const shotRef = React.useRef<HTMLImageElement>(null);
    const [width, setWidth] = React.useState(storedWidth);
    const [available, setAvailable] = React.useState(Infinity);
    const [resizing, setResizing] = React.useState(false);
    const closing = s.phase === "closing";
    const shown = clampWidth(width, available);
    const shownRef = React.useRef(shown);
    shownRef.current = shown;

    useNativeView(rootRef, bodyRef, shotRef, !closing && !s.crashed);

    React.useEffect(() => {
        if (!closing) return;
        let live = true;
        void exitDone(rootRef.current).then(() => live && finishClose());
        return () => void (live = false);
    }, [closing]);

    // The room the panel shares with the chat, for the width's limits. Not the whole row: in DMs and on
    // some pages it also holds the channel list, which the panel mustn't squeeze
    React.useEffect(() => {
        const panel = rootRef.current, parent = panel?.parentElement;
        if (!panel || !parent) return;
        const chat = parent.querySelector<HTMLElement>(":scope > :is([class^=\"chat_\"], [class*=\" chat_\"])");
        const measure = () => {
            const room = chat ? chat.getBoundingClientRect().width + panel.getBoundingClientRect().width : parent.clientWidth;
            // Never more than the window has to give, whatever the row says
            setAvailable(Math.min(room, window.innerWidth - parent.getBoundingClientRect().left));
        };
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(parent);
        if (chat) observer.observe(chat);
        window.addEventListener("resize", measure);
        return () => {
            observer.disconnect();
            window.removeEventListener("resize", measure);
        };
    }, []);

    const resizeTo = (next: number) => setWidth(clampWidth(next, available));
    const save = () => storage()?.set(WIDTH_KEY, shownRef.current);

    const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
        if (e.button !== 0) return;
        e.preventDefault();
        const handle = e.currentTarget;
        const startX = e.clientX, startWidth = shown;
        handle.setPointerCapture(e.pointerId);
        setResizing(true);
        // The view can't follow the pointer (it would take the pointer from Discord's page): snapshot until done
        void hold("resize");
        const move = (ev: PointerEvent) => resizeTo(startWidth + startX - ev.clientX);
        const up = () => {
            handle.removeEventListener("pointermove", move);
            handle.removeEventListener("pointerup", up);
            handle.removeEventListener("pointercancel", up);
            setResizing(false);
            save();
            release("resize");
        };
        handle.addEventListener("pointermove", move);
        handle.addEventListener("pointerup", up);
        handle.addEventListener("pointercancel", up);
    };
    const onKeyDown = (e: React.KeyboardEvent) => {
        const step = e.shiftKey ? 64 : 16;
        if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
        e.preventDefault();
        resizeTo(shown + (e.key === "ArrowLeft" ? step : -step));
    };
    const onKeyUp = (e: React.KeyboardEvent) => {
        if (e.key === "ArrowLeft" || e.key === "ArrowRight") save();
    };

    const host = displayHost(s.url);
    const secure = s.url.startsWith("https:");
    const copy = () => {
        void navigator.clipboard.writeText(s.url).then(() => context?.toast(t("toast.copied"), { type: "success" }), () => { });
    };

    let placeholder: ReactNode = null;
    if (s.crashed) {
        placeholder = (
            <div className="evi-sbrowser-placeholder">
                <p>{t("panel.crashed")}</p>
                <button type="button" className="evi-sbrowser-retry" onClick={() => openInPanel(s.url)}>{t("panel.reload")}</button>
            </div>
        );
    } else if (s.loading) {
        placeholder = <div className="evi-sbrowser-placeholder"><p>{t("panel.loading")}</p></div>;
    }

    return (
        <aside ref={rootRef} className="evi-sbrowser" aria-label={t("panel.label")} style={{ width: shown, "--evi-sbrowser-width": `${shown}px` } as CSSProperties} data-closing={closing ? "" : undefined} data-resizing={resizing ? "" : undefined}>
            <div
                className="evi-sbrowser-resize"
                role="separator"
                aria-orientation="vertical"
                aria-label={t("panel.resize")}
                aria-valuenow={shown}
                tabIndex={0}
                onPointerDown={onPointerDown}
                onKeyDown={onKeyDown}
                onKeyUp={onKeyUp}
            />
            <header className="evi-sbrowser-header">
                <HeaderButton label={t("button.back")} icon={ICONS.back} disabled={!s.canGoBack} onClick={() => void call("go", "back")} />
                <HeaderButton label={t("button.forward")} icon={ICONS.forward} disabled={!s.canGoForward} onClick={() => void call("go", "forward")} />
                {s.loading && !s.crashed
                    ? <HeaderButton label={t("button.stop")} icon={ICONS.close} onClick={() => void call("go", "stop")} />
                    : <HeaderButton label={t("button.reload")} icon={ICONS.reload} onClick={() => s.crashed ? openInPanel(s.url) : void call("go", "reload")} />}
                <div className="evi-sbrowser-titles" title={s.url}>
                    <div className="evi-sbrowser-title">{s.title || host}</div>
                    <div className="evi-sbrowser-host">
                        {secure && <Icon path={ICONS.lock} size={12} />}
                        <span>{host}</span>
                    </div>
                </div>
                <HeaderButton label={t("button.copy")} icon={ICONS.link} disabled={!s.url} onClick={copy} />
                <HeaderButton label={t("button.external")} icon={ICONS.external} disabled={!s.url} onClick={() => void call("openExternal", s.url)} />
                <HeaderButton label={t("button.close")} icon={ICONS.close} onClick={() => void closePanel()} />
                {s.loading && !s.crashed && <div className="evi-sbrowser-progress" aria-hidden="true" />}
            </header>
            <div ref={bodyRef} className="evi-sbrowser-body">
                {placeholder}
                <img ref={shotRef} className="evi-sbrowser-snapshot" alt="" hidden />
            </div>
        </aside>
    );
}

/** Where the patched channel page puts the panel; counts as a chat being on screen while mounted */
function PanelHost() {
    const s = usePanel();
    const markerRef = React.useRef<HTMLElement>(null);
    const [usable, setUsable] = React.useState(false);
    React.useEffect(() => {
        // Next to the chat only if the chat and its sidebars are laid out in a row: otherwise Discord
        // changed its page, and links go to the browser rather than to a panel under the chat
        const parent = markerRef.current?.parentElement;
        const style = parent && getComputedStyle(parent);
        if (!style || !style.display.endsWith("flex") || style.flexDirection !== "row" || parent!.ownerDocument !== document) {
            context?.logger.warn("The chat isn't laid out as expected, links open in the browser", style?.display, style?.flexDirection);
            return;
        }
        hosts++;
        setUsable(true);
        return () => void hosts--;
    }, []);
    return (
        <>
            <i ref={markerRef} className="evi-sbrowser-marker" hidden />
            {usable && s.phase !== "closed" && <SidePanel s={s} />}
        </>
    );
}

const css = `
.evi-sbrowser { position: relative; flex: 0 0 auto; align-self: stretch; display: flex; flex-direction: column; min-width: 0; min-height: 0; overflow: hidden; box-sizing: border-box;
  background: var(--background-base-lower, var(--background-secondary, #2b2d31)); border-left: 1px solid var(--border-subtle, var(--background-modifier-accent, transparent));
  color: var(--text-default, var(--text-normal, #dbdee1)); font-family: var(--font-primary); }
.evi-sbrowser-marker { display: none !important; }
.evi-sbrowser-probe { position: fixed; width: 0; height: 0; background: var(--background-base-lower, var(--background-secondary, #2b2d31)); }
.evi-sbrowser[data-closing] { pointer-events: none; }
@media (prefers-reduced-motion: no-preference) {
  :root:not(.reduce-motion) .evi-sbrowser { animation: evi-sbrowser-in var(--evi-modal-in, 230ms) var(--evi-spring-in, ease-out); }
  :root:not(.reduce-motion) .evi-sbrowser[data-closing] { animation: evi-sbrowser-out var(--evi-modal-out, 200ms) var(--evi-spring-out, ease-in) forwards; }
}
/* It opens and closes by its width, its contents keeping their size: the chat makes room and takes it back,
   and nothing moves past the window's edge (sliding it out made the row scroll) */
@keyframes evi-sbrowser-in { from { width: 0; opacity: 0; } }
@keyframes evi-sbrowser-out { to { width: 0; opacity: 0; } }
.evi-sbrowser > :is(.evi-sbrowser-header, .evi-sbrowser-body) { min-width: var(--evi-sbrowser-width); }
.evi-sbrowser-resize { position: absolute; z-index: 2; top: 0; bottom: 0; left: 0; width: 6px; cursor: ew-resize; touch-action: none; outline: none; }
.evi-sbrowser-resize:focus-visible { box-shadow: inset 2px 0 0 var(--focus-primary, #00b0f4); }
.evi-sbrowser[data-resizing] { user-select: none; }
.evi-sbrowser-header { position: relative; flex: none; display: flex; align-items: center; gap: 2px; height: 48px; padding: 0 8px 0 10px; box-sizing: border-box;
  border-bottom: 1px solid var(--border-subtle, var(--background-modifier-accent, transparent)); }
.evi-sbrowser-button { flex: none; display: grid; place-items: center; width: 32px; height: 32px; padding: 0; border: 0; border-radius: 8px; background: none; cursor: pointer;
  color: var(--interactive-icon-default, var(--interactive-normal, #b5bac1)); }
.evi-sbrowser-button:hover:not(:disabled) { color: var(--interactive-icon-hover, var(--interactive-hover, #dbdee1)); }
.evi-sbrowser-button:active:not(:disabled) { color: var(--interactive-icon-active, var(--interactive-active, #fff)); }
.evi-sbrowser-button:disabled { opacity: .3; cursor: default; }
.evi-sbrowser-button:focus-visible { outline: 2px solid var(--focus-primary, #00b0f4); outline-offset: -2px; }
.evi-sbrowser-titles { flex: 1 1 auto; min-width: 0; padding: 0 6px; display: flex; flex-direction: column; justify-content: center; gap: 1px; }
.evi-sbrowser-title, .evi-sbrowser-host { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.evi-sbrowser-title { font-size: 14px; line-height: 18px; font-weight: 600; color: var(--header-primary, var(--text-strong, #f2f3f5)); }
.evi-sbrowser-host { display: flex; align-items: center; gap: 4px; font-size: 12px; line-height: 16px; color: var(--text-muted, #949ba4); }
.evi-sbrowser-host svg { flex: none; }
.evi-sbrowser-host span { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.evi-sbrowser-progress { position: absolute; left: 0; right: 0; bottom: -1px; height: 2px; overflow: hidden; pointer-events: none; }
.evi-sbrowser-progress::after { content: ""; position: absolute; top: 0; bottom: 0; left: 0; width: 40%; background: var(--brand-500, #5865f2); animation: evi-sbrowser-progress 1.2s ease-in-out infinite; }
@keyframes evi-sbrowser-progress { from { translate: -100% 0; } to { translate: 250% 0; } }
.evi-sbrowser-body { position: relative; flex: 1 1 auto; min-height: 0; overflow: hidden; }
.evi-sbrowser-snapshot { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; object-position: left top; pointer-events: none; }
.evi-sbrowser-snapshot[hidden] { display: none; }
.evi-sbrowser-placeholder { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; padding: 24px;
  text-align: center; font-size: 14px; line-height: 20px; color: var(--text-muted, #949ba4); }
.evi-sbrowser-placeholder p { margin: 0; }
.evi-sbrowser-retry { min-height: 32px; padding: 0 16px; border: 0; border-radius: 8px; font: inherit; font-weight: 500; cursor: pointer;
  background: var(--button-filled-brand-background, var(--brand-500, #5865f2)); color: var(--white, #fff); }
.evi-sbrowser-retry:hover { background: var(--button-filled-brand-background-hover, var(--brand-560, #4752c4)); }
.evi-sbrowser-retry:focus-visible { outline: 2px solid var(--focus-primary, #00b0f4); outline-offset: 2px; }
`;

export default definePlugin({
    settings,

    patches: [
        // Discord's link click handler, checked October 2026 (P is the link, V opens it, the click is
        // arguments[1] and the link's props arguments[0]):
        //   if(!Y&&(H||F.isTrustedDomain(P))||Y&&F.isTrustedProtocol(P))return void(null==t||null!=L&&L?V():...);
        //   if(null!=t&&t.preventDefault(),Y)g.show({...,isProtocol:!0,...});
        //   else{let e=(0,T.W1)(P),t=null!=e?e.displayTarget:P;g.show({url:t,trustUrl:l,onConfirm:V,onCancel:b,isProtocol:!1,...})}
        // A trusted link with a click is left to the browser's default (outside Discord): the panel may
        // take it first. The warning's Visit Site calls V: the panel may stand in for it.
        {
            find: "isProtocol:!0,contextKey:",
            replace: [
                {
                    match: /(\.isTrustedProtocol\((\i)\)\))return void\((?=null==\i\|\|)/,
                    with: "$1return void($self?.openTrusted?.($2,arguments[1],arguments[0])?0:",
                },
                {
                    match: /(?<=let \i=\(0,\i\.\i\)\((\i)\),\i=null!=\i\?\i\.displayTarget:\i;\i\.show\(\{url:\i,trustUrl:\i,onConfirm:)(\i)(?=,onCancel:\i,isProtocol:!1)/,
                    with: "$self?.confirmed?.($2,$1,arguments[1],arguments[0])??$2",
                },
            ],
        },
        // The channel page's render, checked October 2026:
        //   return(0,l.jsxs)(l.Fragment,{children:[(0,l.jsxs)("div",{className:chat,...}),this.renderThreadSidebar()]})
        // The panel goes after the thread sidebar, at the far right.
        {
            find: "this.renderThreadSidebar()]",
            replace: {
                match: /this\.renderThreadSidebar\(\)(?=\])/,
                with: "this.renderThreadSidebar(),$self?.renderPanel?.()",
            },
        },
    ],

    /** The trusted-link path of Discord's click handler: true when the panel took the click */
    openTrusted(url: unknown, event: any, props: unknown): boolean {
        try {
            if (!wants(url, event, props)) return false;
            if (!openInPanel(url)) return false;
            event?.preventDefault?.();
            return true;
        } catch (err) {
            context?.logger.error("Couldn't open the link here", err);
            return false;
        }
    },

    /** What the "Leaving Discord" warning's Visit Site calls instead of `open`, or nothing to keep Discord's */
    confirmed(open: unknown, url: unknown, event: unknown, props: unknown): (() => void) | undefined {
        try {
            if (typeof open !== "function" || !wants(url, event, props)) return undefined;
            return () => {
                try {
                    if (openInPanel(url)) return;
                } catch (err) {
                    context?.logger.error("Couldn't open the link here", err);
                }
                open();
            };
        } catch {
            return undefined;
        }
    },

    renderPanel() {
        return context ? <PanelHost key="evi-side-browser" /> : null;
    },

    start(ctx) {
        context = ctx;
        const apply = (values: { mode: string; sites: string; }) => {
            mode = MODES.includes(values.mode as Mode) ? values.mode as Mode : "all";
            rules = parseSiteRules(values.sites);
        };
        apply({ mode: ctx.settings.get("mode"), sites: ctx.settings.get("sites") });
        ctx.settings.onChange(apply);
        ctx.addStyle(css);
        document.addEventListener("auxclick", onAuxClick, true);

        const gen = ++generation;
        void listen(ctx, gen);
        // A page left from before a hot reload has no panel any more
        void ctx.native.call("close").catch(() => { });

        ctx.onDispose(() => {
            document.removeEventListener("auxclick", onAuxClick, true);
            holds.clear();
            resync = null;
            closeRun++;
            setState(CLOSED);
            context = undefined;
        });
    },

    stop(ctx) {
        generation++;
        ctx.native.call("close").catch(() => { });
        ctx.native.call("cancelWait").catch(() => { });
    },
});
