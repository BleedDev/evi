/**
 * Evi's own toast, for when Discord's toast system can't be found (./toasts): a stand-in made to look
 * and move like Discord's, so plugin toasts aren't silently lost after Discord rebuilds its toasts.
 *
 * Measured from Discord's toasts (2026-10-13): centred at the top of the window, 8px below the title
 * bar (or above the chat box when asked for the bottom), one at a time with the rest queued. A pill of
 * at most 280px on the highest surface colour, 12px padding and corners, an 18px icon 8px before the
 * text; success and critical ones are tinted with Discord's toast colours. They slide in from off-screen
 * over 300ms and back out, and only fade when motion is reduced. Colours are Discord's CSS variables,
 * so themes restyle these too.
 */
import type { ReactNode } from "react";

import { createStyle } from "../styles";
import { DiscordContext } from "../ui/discordContext";
import { createRoot, React } from "../webpack/common";
import { exitDone } from "./layer";
import type { ToastOptions } from "./toasts";

const CHECK = "M12 23a11 11 0 1 0 0-22 11 11 0 0 0 0 22Zm4.3-14.7a1 1 0 0 1 1.4 1.4l-7 7a1 1 0 0 1-1.4 0l-3-3a1 1 0 1 1 1.4-1.4l2.3 2.29 6.3-6.3Z";
const CROSS = "M12 23a11 11 0 1 0 0-22 11 11 0 0 0 0 22Zm3.3-15.7a1 1 0 0 1 1.4 1.4L13.42 12l3.3 3.3a1 1 0 0 1-1.42 1.4L12 13.42l-3.3 3.3a1 1 0 0 1-1.4-1.42L10.58 12l-3.3-3.3a1 1 0 0 1 1.42-1.4L12 10.58l3.3-3.3Z";

export const toastFallbackCss = `
.evi-toasts {
    position: fixed;
    inset-inline: 0;
    z-index: 4999;
    display: grid;
    justify-items: center;
    padding-inline: var(--space-8, 8px);
    pointer-events: none;
}
.evi-toasts[data-position="top"] { top: calc(var(--custom-app-top-bar-height, 0px) + var(--space-8, 8px)); --evi-toast-offscreen: -100%; }
.evi-toasts[data-position="bottom"] { bottom: calc(132px + var(--space-8, 8px)); --evi-toast-offscreen: 100%; }
.evi-toast {
    grid-area: 1 / 1;
    position: relative;
    box-sizing: border-box;
    display: inline-flex;
    align-items: center;
    gap: var(--space-8, 8px);
    width: fit-content;
    max-width: min(var(--toast-max-width, 280px), 100%);
    padding: var(--space-12, 12px);
    border-radius: var(--radius-md, 12px);
    background-color: var(--background-surface-highest, #2b2d31);
    box-shadow: var(--shadow-high, 0 12px 24px rgb(0 0 0 / 0.24));
    color: var(--text-strong, #fff);
    font-family: var(--font-primary, "gg sans", "Noto Sans", sans-serif);
    font-size: 16px;
    line-height: 20px;
    animation: evi-toast-fade-in 300ms linear both;
}
.evi-toast::before {
    content: "";
    position: absolute;
    inset: 0;
    border: 1px solid var(--border-normal, rgb(255 255 255 / 0.08));
    border-radius: inherit;
}
.evi-toast:is([data-type="success"], [data-type="failure"]) { background-color: var(--background-base-low, #1e1f22); }
.evi-toast[data-type="success"]::before { background-color: var(--toast-success-background, rgb(0 133 69 / 0.12)); border-color: var(--toast-success-border, #34995b); }
.evi-toast[data-type="failure"]::before { background-color: var(--toast-critical-background, rgb(218 55 60 / 0.12)); border-color: var(--toast-critical-border, #da373c); }
.evi-toast-icon { position: relative; flex-shrink: 0; width: 18px; height: 18px; }
.evi-toast[data-type="success"] .evi-toast-icon { color: var(--icon-feedback-positive, #3ba55c); }
.evi-toast[data-type="failure"] .evi-toast-icon { color: var(--icon-feedback-critical, #da373c); }
.evi-toast-text { position: relative; min-width: 0; overflow: hidden; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow-wrap: anywhere; }
.evi-toast[data-closing] { animation-name: evi-toast-fade-out; }
@media (prefers-reduced-motion: no-preference) {
    :root:not(.reduce-motion) .evi-toast { animation-name: evi-toast-slide-in; }
    :root:not(.reduce-motion) .evi-toast[data-closing] { animation-name: evi-toast-slide-out; }
}
@keyframes evi-toast-fade-in { 0% { opacity: 0; } }
@keyframes evi-toast-fade-out { 100% { opacity: 0; } }
@keyframes evi-toast-slide-in { 0% { opacity: 0; transform: translateY(var(--evi-toast-offscreen)); } }
@keyframes evi-toast-slide-out { 100% { opacity: 0; transform: translateY(var(--evi-toast-offscreen)); } }
`;

interface Pending {
    toast: HTMLElement;
    root: ReturnType<typeof createRoot> | undefined;
    duration: number;
    position: "top" | "bottom";
}

const queue: Pending[] = [];
let showing = false;
let host: HTMLElement | undefined;
let styled = false;

/** The container, a polite live region screen readers announce each toast from */
function getHost() {
    if (!styled) {
        styled = true;
        createStyle(toastFallbackCss, "evi-toast-fallback");
    }
    if (!host?.isConnected) {
        host = document.createElement("div");
        host.className = "evi-toasts";
        host.setAttribute("role", "status");
        host.setAttribute("aria-live", "polite");
        document.body.append(host);
    }
    return host;
}

function icon(type: string) {
    const d = type === "success" ? CHECK : type === "failure" ? CROSS : undefined;
    if (!d) return;
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "evi-toast-icon");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("fill", "currentColor");
    path.setAttribute("fill-rule", "evenodd");
    path.setAttribute("d", d);
    svg.append(path);
    return svg;
}

/** The toast's element, built up front so a message that can't render is reported to the caller */
function build(message: ReactNode, options: ToastOptions): Pending {
    const type = options.type === "success" || options.type === "failure" ? options.type : "message";
    const toast = document.createElement("div");
    toast.className = "evi-toast";
    toast.dataset.type = type;
    // Failures interrupt, like Discord's (assertive); the rest wait their turn in the polite host
    if (type === "failure") toast.setAttribute("role", "alert");
    const svg = icon(type);
    if (svg) toast.append(svg);
    const text = document.createElement("div");
    text.className = "evi-toast-text";
    toast.append(text);

    let root: ReturnType<typeof createRoot> | undefined;
    if (typeof message === "string" || typeof message === "number") text.textContent = String(message);
    else {
        root = createRoot(text);
        root.render(React.createElement(DiscordContext, null, message));
    }
    return { toast, root, duration: Math.max(options.duration ?? 3000, 1000), position: options.position === "bottom" ? "bottom" : "top" };
}

/** Shows the next queued toast, then takes it away once its time is up */
function next() {
    const item = queue.shift();
    showing = !!item;
    if (!item) return;
    const { toast, root, duration, position } = item;
    const parent = getHost();
    parent.dataset.position = position;
    parent.append(toast);

    setTimeout(() => {
        toast.setAttribute("data-closing", "");
        void exitDone(toast, 600).then(() => {
            try {
                root?.unmount();
            } catch { }
            toast.remove();
            next();
        });
    }, duration);
}

/** Shows a toast drawn by Evi. Returns false if it couldn't (no page yet, or no React for a non-text message). */
export function showEviToast(message: ReactNode, options: ToastOptions = {}): boolean {
    if (typeof document === "undefined" || !document.body) return false;
    try {
        queue.push(build(message, options));
    } catch {
        return false;
    }
    if (!showing) next();
    return true;
}
