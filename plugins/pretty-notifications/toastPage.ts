/**
 * The toast window: one small page, no network beyond Discord's image hosts, no text of its own
 * (every label arrives with the toast, in Discord's language). It talks to native.ts through the
 * two functions TOAST_PRELOAD exposes.
 */

export const CMD_CHANNEL = "pretty-notifications:cmd";
export const MSG_CHANNEL = "pretty-notifications:msg";

export const TOAST_PRELOAD = `"use strict";
const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("prettyNotifications", {
    send: msg => ipcRenderer.send(${JSON.stringify(MSG_CHANNEL)}, msg),
    onCommand: cb => { ipcRenderer.on(${JSON.stringify(CMD_CHANNEL)}, (_e, cmd) => cb(cmd)); },
});
`;

const CSS = String.raw`
:root {
    font-family: "gg sans", "Segoe UI Variable Text", "Segoe UI", system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
    --ease-out: cubic-bezier(0.22, 1, 0.36, 1);
    --ease-in: cubic-bezier(0.55, 0, 1, 0.45);
    --enter: 240ms;
    --exit: 180ms;
}
html, body { margin: 0; height: 100%; background: transparent; overflow: hidden; }
body { user-select: none; }
#stack {
    position: fixed; inset: 0; box-sizing: border-box; padding: 10px 16px;
    display: flex; flex-direction: column;
}
body[data-corner^="bottom"] #stack { justify-content: flex-end; }
body[data-corner$="right"] #stack { align-items: flex-end; --from: 28px; }
body[data-corner$="left"] #stack { align-items: flex-start; --from: -28px; }

.slot { display: grid; grid-template-rows: 1fr; }
.clip { min-height: 0; }
.slot.leaving > .clip { overflow: hidden; }

.toast {
    --bg: #ffffff;
    --text: #1f2023;
    --text-2: #5c5f66;
    --border: rgb(0 0 0 / 0.07);
    --chip: #f0f1f3;
    --chip-hover: #e6e7ea;
    --field: #f6f6f7;
    --accent: #6b4fd6;
    --on-accent: #ffffff;
    --danger: #c4314b;
    --success: #1f8a4c;
    --img-outline: rgb(0 0 0 / 0.08);
    --shadow: 0 1px 2px rgb(0 0 0 / 0.06), 0 8px 24px -6px rgb(0 0 0 / 0.18);

    position: relative; box-sizing: border-box; width: 360px; margin-block: 6px;
    padding: 12px; border-radius: 18px;
    background: var(--bg); color: var(--text);
    border: 1px solid var(--border); box-shadow: var(--shadow);
}
.toast[data-theme="dark"] {
    --bg: #26272b;
    --text: #f2f3f5;
    --text-2: #a9acb3;
    --border: rgb(255 255 255 / 0.08);
    --chip: #34353b;
    --chip-hover: #3d3e45;
    --field: #1d1e21;
    --accent: #8a72f0;
    --on-accent: #ffffff;
    --danger: #ff7a8c;
    --success: #5fd08e;
    --img-outline: rgb(255 255 255 / 0.08);
    --shadow: 0 1px 2px rgb(0 0 0 / 0.3), 0 10px 28px -8px rgb(0 0 0 / 0.55);
}

button { font: inherit; color: inherit; }
button:focus-visible, textarea:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

.open {
    display: grid; grid-template-columns: 40px minmax(0, 1fr); column-gap: 12px; align-items: start;
    width: 100%; padding: 0; padding-inline-end: 22px; margin: 0;
    background: none; border: 0; border-radius: 10px; text-align: start; cursor: pointer;
}
.avatar { position: relative; width: 40px; height: 40px; }
.avatar img, .avatar .initial {
    width: 40px; height: 40px; border-radius: 50%; display: block; object-fit: cover;
    outline: 1px solid var(--img-outline); outline-offset: -1px;
}
.avatar .initial {
    display: grid; place-items: center; background: var(--accent); color: var(--on-accent);
    font-size: 17px; font-weight: 600;
}
.avatar .badge {
    position: absolute; inset-inline-end: -4px; inset-block-end: -4px;
    width: 18px; height: 18px; border-radius: 6px; object-fit: cover;
    box-shadow: 0 0 0 2px var(--bg);
}
.text { min-width: 0; }
.name {
    display: block; font-size: 14px; line-height: 18px; font-weight: 600;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.context {
    display: block; font-size: 12px; line-height: 16px; color: var(--text-2);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.body {
    margin-block-start: 4px; font-size: 13.5px; line-height: 19px; white-space: pre-line;
    overflow-wrap: anywhere; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 3; overflow: hidden;
}

.close {
    position: absolute; inset-block-start: 8px; inset-inline-end: 8px;
    width: 26px; height: 26px; display: grid; place-items: center;
    border: 0; border-radius: 9px; background: transparent; color: var(--text-2); cursor: pointer;
    opacity: 0;
}
.toast:hover .close, .close:focus-visible { opacity: 1; }
@media (hover: hover) { .close:hover { background: var(--chip); color: var(--text); } }

.actions, .reply, .done { padding-inline-start: 52px; margin-block-start: 10px; }
.chip {
    display: inline-flex; align-items: center; gap: 6px; height: 30px; padding: 0 12px;
    border: 0; border-radius: 999px; background: var(--chip); font-size: 13px; font-weight: 600; cursor: pointer;
}
@media (hover: hover) { .chip:hover { background: var(--chip-hover); } }

.reply { display: none; gap: 8px; align-items: flex-end; }
.toast.replying .reply { display: flex; }
.toast.replying .actions { display: none; }
textarea {
    flex: 1; min-width: 0; box-sizing: border-box; resize: none; height: 36px; max-height: 96px;
    padding: 8px 12px; border-radius: 12px; border: 1px solid var(--border);
    background: var(--field); color: var(--text); font: inherit; font-size: 14px; line-height: 18px;
    user-select: text; outline: none;
}
textarea::placeholder { color: var(--text-2); }
.send {
    flex: none; width: 36px; height: 36px; display: grid; place-items: center;
    border: 0; border-radius: 50%; background: var(--accent); color: var(--on-accent); cursor: pointer;
}
.send:disabled { opacity: 0.5; cursor: default; }
.status { padding-inline-start: 52px; margin-block-start: 6px; font-size: 12px; line-height: 16px; display: none; align-items: center; gap: 6px; }
.toast.failed .status { display: flex; color: var(--danger); }
.done { display: none; align-items: center; gap: 6px; font-size: 13px; font-weight: 600; color: var(--success); }
.toast.sent .done { display: flex; }
.toast.sent .reply, .toast.sent .actions { display: none; }

@media (prefers-reduced-motion: no-preference) {
    .chip, .send { transition: scale 200ms ease-out; }
    .chip:active, .send:active:not(:disabled) { scale: 0.96; }
    .slot.entering { animation: grow var(--enter) var(--ease-out); }
    .slot.entering .toast { animation: enter var(--enter) var(--ease-out); }
    .slot.leaving { grid-template-rows: 0fr; transition: grid-template-rows var(--exit) var(--ease-in) 60ms; }
    .slot.leaving .toast {
        opacity: 0; translate: var(--from) 0;
        transition: opacity var(--exit) var(--ease-in), translate var(--exit) var(--ease-in);
    }
    .close { transition: opacity 150ms ease-out; }
}
@media (prefers-reduced-motion: reduce) {
    .slot.entering .toast { animation: fade 150ms ease-out; }
}
@keyframes grow { from { grid-template-rows: 0fr; } to { grid-template-rows: 1fr; } }
@keyframes enter { from { opacity: 0; translate: var(--from) 0; scale: 0.98; } }
@keyframes fade { from { opacity: 0; } }
`;

const ICONS = {
    close: '<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
    reply: '<svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path d="M6.5 3.5L2.5 7.5l4 4M3 7.5h6.5a4 4 0 014 4v1" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    send: '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 13V3.5M3.5 8L8 3.5 12.5 8" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    check: '<svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8.5l3.2 3L13 4.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    alert: '<svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.3" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M8 4.8v3.8" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><circle cx="8" cy="11.2" r="1" fill="currentColor"/></svg>',
};

// Plain ES2020 that runs in the toast window. No template literals in here: it lives inside one.
const SCRIPT = String.raw`
"use strict";
const bridge = window.prettyNotifications;
const ICONS = __ICONS__;
const IMAGE_HOSTS = ["cdn.discordapp.com", "media.discordapp.net", "discord.com"];
const stack = document.getElementById("stack");
const toasts = new Map();
let corner = "bottom-right";
let maxVisible = 3;
let pointerInside = false;
let typing = null;

function send(msg) { if (bridge) bridge.send(msg); }

function safeImage(url) {
    if (typeof url !== "string") return null;
    if (/^data:image\/(png|jpe?g|webp|gif);base64,[a-z0-9+/=]+$/i.test(url)) return url;
    try {
        const u = new URL(url);
        return u.protocol === "https:" && IMAGE_HOSTS.indexOf(u.hostname) !== -1 ? u.href : null;
    } catch (e) { return null; }
}

function el(tag, cls, text) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
}

function icon(name) {
    const span = el("span");
    span.style.display = "contents";
    span.innerHTML = ICONS[name];
    return span;
}

function live() {
    const out = [];
    toasts.forEach(t => { if (!t.leaving) out.push(t); });
    return out;
}

function paused() { return pointerInside || typing !== null; }

function arm(t) {
    clearTimeout(t.timer);
    t.timer = 0;
    if (t.leaving || paused() || t.state === "sending") return;
    t.startedAt = Date.now();
    t.timer = setTimeout(() => leave(t.id, "timeout"), Math.max(800, t.remaining));
}

function pauseAll() {
    toasts.forEach(t => {
        if (!t.timer) return;
        clearTimeout(t.timer);
        t.timer = 0;
        t.remaining -= Date.now() - t.startedAt;
    });
}

function resumeAll() { if (!paused()) toasts.forEach(arm); }

function avatarNode(payload) {
    const wrap = el("div", "avatar");
    const src = safeImage(payload.avatar);
    const initial = () => {
        const node = el("div", "initial", (payload.title || "?").trim().charAt(0).toUpperCase() || "?");
        node.setAttribute("aria-hidden", "true");
        return node;
    };
    if (src) {
        const img = el("img");
        img.alt = "";
        img.src = src;
        img.addEventListener("error", () => img.replaceWith(initial()), { once: true });
        wrap.append(img);
    } else wrap.append(initial());
    const badge = safeImage(payload.badge);
    if (badge) {
        const img = el("img", "badge");
        img.alt = "";
        img.src = badge;
        img.addEventListener("error", () => img.remove(), { once: true });
        wrap.append(img);
    }
    return wrap;
}

function build(t) {
    const p = t.payload;
    const card = el("article", "toast");
    card.dataset.theme = p.theme === "light" ? "light" : "dark";
    card.setAttribute("aria-label", p.title);

    const open = el("button", "open");
    open.type = "button";
    open.title = p.labels.open;
    const text = el("div", "text");
    text.append(el("span", "name", p.title));
    if (p.context) text.append(el("span", "context", p.context));
    text.append(el("div", "body", p.body));
    open.append(avatarNode(p), text);
    open.addEventListener("click", () => {
        if (t.state === "sending") return;
        send({ type: "action", action: { kind: "click", id: t.id } });
        leave(t.id, "click");
    });

    const close = el("button", "close");
    close.type = "button";
    close.setAttribute("aria-label", p.labels.close);
    close.append(icon("close"));
    close.addEventListener("click", () => leave(t.id, "closed"));

    card.append(open, close);

    if (p.canReply) {
        const actions = el("div", "actions");
        const replyButton = el("button", "chip");
        replyButton.type = "button";
        replyButton.append(icon("reply"), el("span", null, p.labels.reply));
        actions.append(replyButton);

        const form = el("form", "reply");
        const field = el("textarea");
        field.rows = 1;
        field.placeholder = p.labels.placeholder;
        field.setAttribute("aria-label", p.labels.placeholder);
        field.maxLength = 4000;
        const submit = el("button", "send");
        submit.type = "submit";
        submit.setAttribute("aria-label", p.labels.send);
        submit.append(icon("send"));
        form.append(field, submit);

        const status = el("div", "status");
        status.setAttribute("role", "alert");
        status.append(icon("alert"), el("span", null, p.labels.failed));
        const done = el("div", "done");
        done.setAttribute("role", "status");
        done.append(icon("check"), el("span", null, p.labels.sent));

        const fit = () => {
            field.style.height = "36px";
            field.style.height = Math.min(96, field.scrollHeight + 2) + "px";
        };
        const startTyping = () => {
            if (typing === t.id) return;
            typing = t.id;
            pauseAll();
            send({ type: "typing", active: true });
        };
        const stopTyping = () => {
            if (typing !== t.id) return;
            typing = null;
            send({ type: "typing", active: false });
            resumeAll();
        };
        t.stopTyping = stopTyping;

        replyButton.addEventListener("click", () => {
            card.classList.add("replying");
            startTyping();
            // The window becomes focusable a moment after asking
            requestAnimationFrame(() => field.focus());
            setTimeout(() => field.focus(), 80);
        });
        field.addEventListener("mousedown", startTyping);
        field.addEventListener("input", () => {
            fit();
            card.classList.remove("failed");
        });
        field.addEventListener("keydown", e => {
            if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
                e.preventDefault();
                form.requestSubmit();
            } else if (e.key === "Escape") {
                e.preventDefault();
                card.classList.remove("replying", "failed");
                field.value = "";
                fit();
                stopTyping();
            }
        });
        form.addEventListener("submit", e => {
            e.preventDefault();
            const value = field.value.trim();
            if (!value || t.state === "sending") return;
            t.state = "sending";
            card.classList.remove("failed");
            field.readOnly = true;
            submit.disabled = true;
            submit.setAttribute("aria-label", p.labels.sending);
            send({ type: "action", action: { kind: "reply", id: t.id, text: value } });
        });
        t.replyResult = ok => {
            field.readOnly = false;
            submit.disabled = false;
            submit.setAttribute("aria-label", p.labels.send);
            if (ok) {
                t.state = "sent";
                card.classList.remove("replying");
                card.classList.add("sent");
                stopTyping();
                setTimeout(() => leave(t.id, "sent"), 1400);
            } else {
                t.state = "";
                card.classList.add("failed");
                field.focus();
            }
        };
        card.append(actions, form, status, done);
    }
    return card;
}

function show(cmd) {
    corner = cmd.corner;
    maxVisible = Math.max(1, cmd.maxVisible | 0);
    document.body.dataset.corner = corner;
    const payload = cmd.toast;
    const old = toasts.get(payload.id);
    if (old && !old.leaving) {
        old.payload = payload;
        const card = build(old);
        old.clip.replaceChildren(card);
        old.remaining = payload.duration;
        arm(old);
        return;
    }
    const t = { id: payload.id, payload, remaining: payload.duration, timer: 0, startedAt: 0, leaving: false, state: "" };
    const slot = el("div", "slot entering");
    const clip = el("div", "clip");
    slot.append(clip);
    t.slot = slot;
    t.clip = clip;
    clip.append(build(t));
    slot.addEventListener("animationend", e => { if (e.target === slot) slot.classList.remove("entering"); });
    toasts.set(t.id, t);
    if (corner.startsWith("top")) stack.prepend(slot);
    else stack.append(slot);

    const shown = live();
    for (let i = 0; shown.length - i > maxVisible && i < shown.length; i++) {
        if (shown[i].id !== typing) leave(shown[i].id, "overflow");
    }
    arm(t);
}

function leave(id, reason) {
    const t = toasts.get(id);
    if (!t || t.leaving) return;
    t.leaving = true;
    clearTimeout(t.timer);
    if (t.stopTyping) t.stopTyping();
    if (reason !== "click" && reason !== "remote") send({ type: "action", action: { kind: "closed", id } });
    const remove = () => {
        if (!t.slot.isConnected) return;
        t.slot.remove();
        toasts.delete(id);
        if (toasts.size === 0) send({ type: "empty" });
    };
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return remove();
    t.slot.classList.remove("entering");
    t.slot.classList.add("leaving");
    setTimeout(remove, 320);
    updatePointer(lastPoint);
}

let lastPoint = null;
function updatePointer(e) {
    lastPoint = e;
    let inside = false;
    if (e) {
        const hit = document.elementFromPoint(e.clientX, e.clientY);
        const card = hit && hit.closest(".slot");
        inside = !!card && !card.classList.contains("leaving");
    }
    if (inside === pointerInside) return;
    pointerInside = inside;
    send({ type: "pointer", inside });
    if (inside) pauseAll();
    else resumeAll();
}
document.addEventListener("mousemove", updatePointer);
document.addEventListener("mouseleave", () => updatePointer(null));
window.addEventListener("blur", () => {
    // Clicked away while replying: keep what was typed, give the keyboard back
    if (typing !== null) {
        const t = toasts.get(typing);
        if (t && t.stopTyping) t.stopTyping();
    }
});

if (bridge) bridge.onCommand(cmd => {
    if (cmd.type === "show") show(cmd);
    else if (cmd.type === "dismiss") leave(cmd.id, "remote");
    else if (cmd.type === "replyResult") { const t = toasts.get(cmd.id); if (t && t.replyResult) t.replyResult(cmd.ok); }
    else if (cmd.type === "clear") toasts.forEach(t => leave(t.id, "remote"));
});
window.__prettyNotifications = { show, leave, toasts };
send({ type: "ready" });
`;

export const TOAST_HTML = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https://cdn.discordapp.com https://media.discordapp.net https://discord.com data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
<style>${CSS}</style>
</head>
<body data-corner="bottom-right">
<div id="stack" aria-live="polite"></div>
<script>${SCRIPT.replace("__ICONS__", JSON.stringify(ICONS))}</script>
</body>
</html>`;
