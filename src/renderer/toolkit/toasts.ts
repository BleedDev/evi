/**
 * Discord's own toasts: the small status pill at the top of the window ("Copied to clipboard").
 *
 * Discord keeps them in a zustand store per surface ("app", "popout"…) and shows one at a time,
 * queueing the rest. It has rebuilt that system twice; Evi knows every form, each by strings in its
 * code that don't depend on minified names, newest first:
 *
 * - From 2026-10-13: one store, whose showToast takes { text, variant, icon, iconColor, duration,
 *   position: "top" | "bottom", surface }. Variants are "default", "success" and "critical"; the other
 *   toast types are a default toast with an icon. Found by `.currentToastMap.has(` + `surface`.
 * - 2026-10-01 to 10-12: that store behind an experiment, next to the old one, and a router between
 *   them that takes the old shape and converts it when the experiment is on. Found by
 *   `("showToast"))return`. The new store's showToast is there too, but only renders with the
 *   experiment on, so the router comes first.
 * - Before: the old store alone, taking { message, id, type, options: { appContext, … } }. Found by
 *   `.currentToastMap.has(` + `appContext`.
 *
 * If none of them is there (Discord rebuilt it again), Evi draws the toast itself, looking and moving
 * like Discord's (./toastFallback), so a toast is never silently lost.
 */
import type { ComponentType, ReactNode } from "react";

import { Logger } from "../logger";
import { filters, find, findModuleIds, requireModule, type Filter } from "../webpack/find";
import { showEviToast } from "./toastFallback";

const logger = new Logger("Toasts", "#5865f2");

/** Discord's toast types. "info" is Evi's name for Discord's plain "message" toast. */
export type ToastType = "info" | "success" | "failure" | "message" | "link" | "clock" | "bookmark" | "favorite";

export interface ToastOptions {
    type?: ToastType;
    /** Milliseconds, Discord's default is 3000 */
    duration?: number;
    position?: "top" | "bottom";
}

/** Discord's current store: function l(e){let t=e?.surface??"app",n={toast:e,key:a++};…currentToastMap.has(t)… */
export const showToastFilter = filters.byCode(".currentToastMap.has(", "surface");
/** The router of 2026-10-01 to 10-12: function d(e){if(!(0,s.WD)("showToast"))return void(0,a.P0)(e);…} */
export const routerShowToastFilter = filters.byCode('("showToast"))return');
/** The old store, from before 2026-10-13: function l(e){let t=e.options?.appContext??a.BRT.APP;…currentToastMap.has(t)… */
export const legacyShowToastFilter = filters.byCode(".currentToastMap.has(", "appContext");

/** What Discord's current store takes */
export interface DiscordToast {
    text: ReactNode;
    variant: "default" | "success" | "critical";
    icon?: ComponentType<any>;
    duration: number;
    position: "top" | "bottom";
    surface: "app";
}

/** What the router and the old store take */
export interface LegacyDiscordToast {
    message: ReactNode;
    id: string;
    type: string;
    options: { position: 0 | 1; component: null; duration: number; appContext: "APP"; };
}

export type ToastBackend = "store" | "router" | "legacy";

/** Newest first; see the top of this file */
const BACKENDS: { kind: ToastBackend; filter: Filter; }[] = [
    { kind: "router", filter: routerShowToastFilter },
    { kind: "store", filter: showToastFilter },
    { kind: "legacy", filter: legacyShowToastFilter },
];

/** Evi's toast type as Discord's type name ("info" is Discord's "message") */
const typeName = (type: ToastType | undefined) => !type || type === "info" ? "message" : type;

/** The old shape, for the router and the old store */
export function toLegacyToast(message: ReactNode, options: ToastOptions, id: string): LegacyDiscordToast {
    return {
        message,
        id,
        type: typeName(options.type),
        options: {
            position: options.position === "bottom" ? 1 : 0,
            component: null,
            duration: options.duration ?? 3000,
            appContext: "APP",
        },
    };
}

/** Icons Discord puts on its plain toasts of these types, by their export names */
const ICON_EXPORTS: Partial<Record<string, string>> = { link: "LinkIcon", clock: "ClockIcon", bookmark: "BookmarkIcon", favorite: "StarIcon" };

/** The current store's shape. `icon` finds Discord's icon for a type, if it's loaded. */
export function toDiscordToast(message: ReactNode, options: ToastOptions, icon?: (type: string) => ComponentType<any> | undefined): DiscordToast {
    const type = typeName(options.type);
    const toast: DiscordToast = {
        text: message,
        variant: type === "success" ? "success" : type === "failure" ? "critical" : "default",
        duration: options.duration ?? 3000,
        position: options.position === "bottom" ? "bottom" : "top",
        surface: "app",
    };
    const component = toast.variant === "default" ? icon?.(type) : undefined;
    if (component) toast.icon = component;
    return toast;
}

const icons = new Map<string, ComponentType<any>>();

/** Discord's icon component for a toast type, when its module has run (it's left out otherwise) */
function discordIcon(type: string) {
    const name = ICON_EXPORTS[type];
    if (!name) return;
    let icon = icons.get(name);
    if (!icon) {
        try {
            icon = find(filters.byProps(name))?.[name];
        } catch { }
        if (typeof icon === "function" || (icon as any)?.$$typeof) icons.set(name, icon!);
        else icon = undefined;
    }
    return icon;
}

let discord: { kind: ToastBackend; show: (toast: unknown) => void; } | undefined;
/** When the last search found nothing: searching every module factory again on each toast is wasted */
let missedAt = -Infinity;

/**
 * Discord's toast function and which form it is: a loaded module first, then (it's in Discord's main
 * bundle, just not run yet) by running the module, which Discord would do itself on first use.
 */
function resolveDiscordToasts() {
    if (discord) return discord;
    if (performance.now() - missedAt < 5000) return;
    missedAt = performance.now();
    try {
        for (const { kind, filter } of BACKENDS) {
            const show = find(filter);
            if (typeof show === "function") return discord = { kind, show };
        }
        for (const { kind, filter } of BACKENDS) {
            for (const id of findModuleIds(...filter.$code!)) {
                const exports = requireModule(id);
                const show = Object.values(exports ?? {}).find(v => typeof v === "function" && filter(v));
                if (show) return discord = { kind, show: show as (toast: unknown) => void };
            }
        }
    } catch (err) {
        logger.warn("Looking for Discord's toasts failed:", err);
    }
}

/** Which of Discord's toast systems Evi uses, or "evi" when it draws them itself. For tests and debugging. */
export function toastBackend(): ToastBackend | "evi" {
    return resolveDiscordToasts()?.kind ?? "evi";
}

let counter = 0;
let warned = false;

/**
 * Shows a toast, through Discord's toasts when Evi finds them and drawn by Evi otherwise. Returns false
 * only if neither could show it.
 */
export function showToast(message: ReactNode, options: ToastOptions = {}): boolean {
    const found = resolveDiscordToasts();
    if (found) {
        try {
            found.show(found.kind === "store" ? toDiscordToast(message, options, discordIcon) : toLegacyToast(message, options, `evi-toast-${++counter}`));
            return true;
        } catch (err) {
            logger.warn("Discord's toasts failed, Evi shows it instead:", err);
        }
    } else if (!warned) {
        warned = true;
        logger.warn("Discord's toasts were not found, Evi shows them itself");
    }
    return showEviToast(message, options);
}
