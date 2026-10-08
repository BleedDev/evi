/**
 * Boot Sequence's model, as plain data and strings: no Electron, DOM or storage, so the native side,
 * the preview and the tests share it.
 *
 * What it shows only ever comes from something that happened:
 *  - Discord's updater steps, as Discord sends them to its splash (DISCORD_SPLASH_UPDATE_STATE)
 *  - Discord's version, from the build_info.json Discord itself reads
 *  - Evi, the theme and each plugin, reported by the page as Evi's plugin manager starts them
 * Discord closes its splash when its app has loaded, whatever is still starting: the log is cut there.
 */

/** Marks the page's reports in the main window's console, where main reads them */
export const REPORT_PREFIX = "[evi-boot] ";

export const ACCENTS = {
    white: "#f2f2f3",
    green: "#7fc79a",
    blue: "#8c9cff",
    amber: "#e6b66e",
    pink: "#ec9cc0",
} as const;
export type Accent = keyof typeof ACCENTS;

export interface BootConfig {
    showPlugins: boolean;
    accent: Accent;
    compact: boolean;
}

/** Texts the splash shows, in the language Discord was in last time (the page sends them) */
export const EN_STRINGS = {
    checking: "checking for updates",
    downloading: "downloading update {current} of {total}",
    installing: "installing update {current} of {total}",
    updateFailed: "update failed",
    retrying: "retrying in {seconds}s",
    upToDate: "up to date",
    updated: "updates installed",
    discord: "discord",
    evi: "evi",
    theme: "theme",
    safeMode: "safe mode",
    pluginsOff: "plugins off",
    plugins: "plugins",
    count: "{done} of {total}",
    opening: "opening discord",
};
export type BootStrings = typeof EN_STRINGS;
export type StringKey = keyof BootStrings;

export const DEFAULT_CONFIG: BootConfig = { showPlugins: true, accent: "white", compact: false };

const MAX_PLUGINS = 300;
const MAX_NAME = 60;
const MAX_STRING = 120;

const clip = (v: unknown, max: number) => typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, max) : "";

export function sanitizeConfig(raw: unknown): BootConfig {
    const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    return {
        showPlugins: r.showPlugins !== false,
        accent: typeof r.accent === "string" && r.accent in ACCENTS ? r.accent as Accent : DEFAULT_CONFIG.accent,
        compact: r.compact === true,
    };
}

/** The page's texts, checked: every key a string with the same {placeholders} as English */
export function sanitizeStrings(raw: unknown): BootStrings {
    const out = { ...EN_STRINGS };
    if (!raw || typeof raw !== "object") return out;
    for (const key of Object.keys(EN_STRINGS) as StringKey[]) {
        const value = clip((raw as Record<string, unknown>)[key], MAX_STRING);
        const vars = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join();
        if (value && vars(value) === vars(EN_STRINGS[key])) out[key] = value;
    }
    return out;
}

export function format(template: string, vars: Record<string, string | number>) {
    return template.replace(/\{(\w+)\}/g, (all, name) => name in vars ? String(vars[name]) : all);
}

// ---- What happens ---------------------------------------------------------------------------------

export interface DiscordUpdateState {
    status?: unknown;
    current?: unknown;
    total?: unknown;
    progress?: unknown;
    seconds?: unknown;
}

export interface PluginInfo { id: string; name: string; }

export type BootEvent =
    | { t: "discord"; state: DiscordUpdateState; }
    | { t: "hello"; evi: string; themes: string[]; safe: boolean; plugins: PluginInfo[]; }
    | { t: "plugin"; id: string; ok: boolean; };

export interface BootState {
    discord: { status: string; current: number; total: number; progress: number | null; seconds: number | null; updates: number; launched: boolean; };
    version: string | null;
    evi: { version: string; themes: string[]; safe: boolean; } | null;
    /** The plugins that will start, in the order Evi starts them */
    plugins: PluginInfo[] | null;
    /** Plugins that started (ok) or failed, in the order they did */
    results: { id: string; ok: boolean; }[];
}

export function initialState(version: string | null = null): BootState {
    return {
        discord: { status: "checking-for-updates", current: 0, total: 0, progress: null, seconds: null, updates: 0, launched: false },
        version,
        evi: null,
        plugins: null,
        results: [],
    };
}

const num = (v: unknown) => typeof v === "number" && Number.isFinite(v) ? v : null;

/** A report line from the page's console, or null for anything else */
export function parseReport(message: unknown): BootEvent | null {
    if (typeof message !== "string" || !message.startsWith(REPORT_PREFIX)) return null;
    let data: any;
    try {
        data = JSON.parse(message.slice(REPORT_PREFIX.length));
    } catch {
        return null;
    }
    if (data?.t === "plugin" && typeof data.id === "string") return { t: "plugin", id: clip(data.id, 64), ok: data.ok !== false };
    if (data?.t === "hello") {
        const plugins: PluginInfo[] = [];
        for (const p of Array.isArray(data.plugins) ? data.plugins.slice(0, MAX_PLUGINS) : []) {
            const id = clip(p?.id, 64);
            if (id && !plugins.some(q => q.id === id)) plugins.push({ id, name: clip(p?.name, MAX_NAME) || id });
        }
        return {
            t: "hello",
            evi: clip(data.evi, 24),
            themes: (Array.isArray(data.themes) ? data.themes : []).map((n: unknown) => clip(n, MAX_NAME)).filter(Boolean).slice(0, 3),
            safe: data.safe === true,
            plugins,
        };
    }
    return null;
}

/**
 * The page's plugins in the order Evi starts them: the order main read their folders in (`order`,
 * ids). Ones main didn't list keep the page's order, after the rest.
 */
export function orderPlugins(plugins: PluginInfo[], order: readonly string[]): PluginInfo[] {
    const rank = new Map(order.map((id, i) => [id, i]));
    return plugins
        .map((p, i) => ({ p, key: rank.get(p.id) ?? order.length + i }))
        .sort((x, y) => x.key - y.key)
        .map(x => x.p);
}

export function reduce(state: BootState, event: BootEvent): BootState {
    if (event.t === "discord") {
        const s = event.state ?? {};
        const status = typeof s.status === "string" ? s.status : "checking-for-updates";
        const total = num(s.total) ?? 0;
        const updating = status === "downloading-updates" || status === "installing-updates";
        return {
            ...state,
            discord: {
                status,
                current: num(s.current) ?? 0,
                total,
                progress: num(s.progress),
                seconds: num(s.seconds),
                updates: updating ? Math.max(state.discord.updates, total) : state.discord.updates,
                launched: state.discord.launched || status === "launching",
            },
        };
    }
    if (event.t === "hello") {
        // Evi only runs inside a launched Discord
        return {
            ...state,
            discord: { ...state.discord, launched: true },
            evi: { version: event.evi, themes: event.themes, safe: event.safe },
            plugins: event.safe ? [] : event.plugins,
        };
    }
    if (state.results.some(r => r.id === event.id)) return state;
    if (state.plugins && !state.plugins.some(p => p.id === event.id)) return state;
    return { ...state, results: [...state.results, { id: event.id, ok: event.ok }] };
}

// ---- What it looks like ---------------------------------------------------------------------------

export type Mark = "done" | "current" | "fail";
export interface Row { key: string; mark: Mark; label: string; detail: string; }
export interface View {
    rows: Row[];
    /** Segments the bar has, how many are filled, and which of those stand for a plugin that failed */
    bar: { segments: number; filled: number; failed: number[]; };
    count: string;
}

const BAR_SEGMENTS = 24;

export function view(state: BootState, strings: BootStrings, config: BootConfig): View {
    const s = strings;
    const d = state.discord;
    const rows: Row[] = [];

    if (!d.launched) {
        if (d.status === "downloading-updates" || d.status === "installing-updates") {
            const label = format(d.status === "downloading-updates" ? s.downloading : s.installing, { current: d.current, total: d.total });
            rows.push({ key: "updates", mark: "current", label, detail: "" });
        } else if (d.status === "update-failure") {
            rows.push({ key: "updates", mark: "fail", label: s.updateFailed, detail: d.seconds === null ? "" : format(s.retrying, { seconds: d.seconds }) });
        } else {
            rows.push({ key: "updates", mark: "current", label: s.checking, detail: "" });
        }
    } else {
        rows.push({ key: "updates", mark: "done", label: d.updates ? s.updated : s.upToDate, detail: d.updates ? String(d.updates) : "" });
        rows.push({ key: "discord", mark: "done", label: s.discord, detail: state.version ?? "" });
        rows.push({ key: "evi", mark: state.evi ? "done" : "current", label: s.evi, detail: state.evi?.version ?? "" });
    }

    const evi = state.evi;
    if (evi && evi.themes.length) rows.push({ key: "theme", mark: "done", label: s.theme, detail: evi.themes.join(", ") });
    if (evi?.safe) rows.push({ key: "safe", mark: "fail", label: s.safeMode, detail: s.pluginsOff });

    const plugins = state.plugins;
    let bar: View["bar"] = { segments: BAR_SEGMENTS, filled: 0, failed: [] };
    let count = "";

    if (evi && plugins && !evi.safe) {
        const total = plugins.length;
        const done = state.results.length;
        const names = new Map(plugins.map(p => [p.id, p.name]));
        count = total ? format(s.count, { done, total }) : "";
        if (config.showPlugins) {
            for (const r of state.results) rows.push({ key: `p:${r.id}`, mark: r.ok ? "done" : "fail", label: names.get(r.id) ?? r.id, detail: "" });
            const next = plugins.find(p => !state.results.some(r => r.id === p.id));
            if (next) rows.push({ key: `p:${next.id}`, mark: "current", label: next.name, detail: "" });
        } else if (total) {
            rows.push({ key: "plugins", mark: done < total ? "current" : "done", label: s.plugins, detail: count });
        }
        if (done >= total) rows.push({ key: "open", mark: "current", label: s.opening, detail: "" });
        // One segment a plugin, as in the sketch, until there are too many to stay crisp
        bar = total <= 32
            ? { segments: Math.max(total, 1), filled: total ? done : 1, failed: state.results.flatMap((r, i) => r.ok ? [] : [i]) }
            : { segments: 32, filled: Math.floor(done / total * 32), failed: [] };
    } else if (!d.launched && (d.status === "downloading-updates" || d.status === "installing-updates") && d.progress !== null) {
        bar = { segments: BAR_SEGMENTS, filled: Math.round(Math.min(Math.max(d.progress, 0), 100) / 100 * BAR_SEGMENTS), failed: [] };
        count = `${Math.round(d.progress)}%`;
    } else if (d.launched) {
        count = "";
    }
    return { rows, bar, count };
}

// ---- In the splash --------------------------------------------------------------------------------

export function windowSize(config: BootConfig) {
    return config.compact ? { width: 380, height: 236 } : { width: 440, height: 304 };
}

const FONT = `"Cascadia Mono", "SF Mono", Menlo, Consolas, "JetBrains Mono", "DejaVu Sans Mono", ui-monospace, monospace`;

export function splashCss(config: BootConfig): string {
    const accent = ACCENTS[config.accent];
    const c = config.compact;
    return `
html.evi-bs, html.evi-bs body {
    width: 100vw !important;
    height: 100vh !important;
    margin: 0;
    background: #0b0b0c !important;
    overflow: hidden;
}
html.evi-bs #splash-mount { display: none !important; }
html.evi-bs.evi-bs-manual #splash-mount { display: block !important; }
html.evi-bs.evi-bs-manual #evi-bs { display: none; }
#evi-bs {
    --bs-accent: ${accent};
    --bs-text: #ededee;
    --bs-soft: #a3a3a9;
    --bs-dim: #5d5d64;
    --bs-ok: #77b98c;
    --bs-fail: #d27a72;
    --bs-track: #1f1f22;
    position: fixed;
    inset: 0;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    padding: ${c ? "16px 20px 16px" : "22px 26px 22px"};
    border: 1px solid #1c1c1f;
    color: var(--bs-text);
    font-family: ${FONT};
    font-size: ${c ? "11.5px" : "12.5px"};
    line-height: ${c ? "18px" : "20px"};
    --bs-row: ${c ? "18px" : "20px"};
    font-variant-numeric: tabular-nums;
    font-feature-settings: "calt" 0, "liga" 0;
    -webkit-font-smoothing: antialiased;
    -webkit-app-region: drag;
    user-select: none;
    cursor: default;
}
#evi-bs header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    margin-bottom: ${c ? "10px" : "14px"};
}
#evi-bs .bs-brand { font-weight: 700; letter-spacing: -0.02em; color: #fff; }
#evi-bs .bs-time { color: var(--bs-dim); }
#evi-bs ol {
    flex: 1;
    min-height: 0;
    margin: 0;
    padding: 0;
    list-style: none;
    overflow: hidden;
}
#evi-bs ol.bs-fit { flex: none; }
#evi-bs li {
    display: grid;
    height: var(--bs-row);
    grid-template-columns: 14px minmax(0, 1fr) auto;
    column-gap: 10px;
    align-items: center;
    color: var(--bs-soft);
    animation: evi-bs-in 70ms steps(2, jump-start) both;
}
#evi-bs li[data-mark="current"] { color: var(--bs-text); }
#evi-bs li[data-mark="fail"] { color: var(--bs-soft); }
#evi-bs .bs-mark { display: grid; place-items: center; width: 14px; height: 14px; }
#evi-bs .bs-mark svg { display: block; width: 10px; height: 10px; }
#evi-bs li[data-mark="done"] .bs-mark { color: var(--bs-ok); }
#evi-bs li[data-mark="current"] .bs-mark { color: var(--bs-accent); }
#evi-bs li[data-mark="fail"] .bs-mark { color: var(--bs-fail); }
#evi-bs .bs-label { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
#evi-bs .bs-detail { color: var(--bs-dim); white-space: nowrap; max-width: 220px; overflow: hidden; text-overflow: ellipsis; }
#evi-bs li[data-mark="fail"] .bs-detail { color: var(--bs-fail); opacity: 0.8; }
#evi-bs .bs-dots { display: inline-block; width: 3ch; vertical-align: bottom; overflow: hidden; }
#evi-bs .bs-dots::after { content: "..."; display: inline-block; animation: evi-bs-dots 900ms steps(4, jump-none) infinite; clip-path: inset(0 100% 0 0); }
#evi-bs footer {
    display: flex;
    align-items: center;
    gap: 14px;
    margin-top: ${c ? "12px" : "16px"};
}
#evi-bs .bs-bar { flex: 1; display: flex; gap: 2px; height: 3px; }
#evi-bs .bs-bar i { flex: 1; background: var(--bs-track); }
#evi-bs .bs-bar i.on { background: var(--bs-accent); }
#evi-bs .bs-bar i.on.fail { background: var(--bs-fail); }
#evi-bs .bs-count { color: var(--bs-dim); min-width: 8ch; text-align: right; }
@keyframes evi-bs-in {
    from { opacity: 0; transform: translateY(6px); }
    to { opacity: 1; transform: none; }
}
@keyframes evi-bs-dots {
    from { clip-path: inset(0 100% 0 0); }
    to { clip-path: inset(0 0 0 0); }
}
@media (prefers-reduced-motion: reduce) {
    #evi-bs li { animation: none; }
    #evi-bs .bs-dots::after { animation: none; clip-path: none; }
}
`;
}

/**
 * The script run in the splash page (its main world, a file: page): builds the log once and exposes
 * window.__eviBoot.render(view). Idempotent. Plain ES2019 in a string, it isn't bundled.
 *
 * @param startedAt Discord's process start, as Date.now() milliseconds: the header counts from it
 */
export function splashScript(startedAt: number): string {
    return `(() => {
    if (window.__eviBoot) return true;
    const SVG = {
        done: '<svg viewBox="0 0 10 10" aria-hidden="true"><path d="M1.5 5.4 4 7.8 8.6 2.4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="square"/></svg>',
        current: '<svg viewBox="0 0 10 10" aria-hidden="true"><path d="M3.4 1.8 6.6 5 3.4 8.2" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="square"/></svg>',
        fail: '<svg viewBox="0 0 10 10" aria-hidden="true"><path d="M2.2 2.2 7.8 7.8M7.8 2.2 2.2 7.8" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="square"/></svg>',
    };
    const el = (tag, cls, text) => {
        const n = document.createElement(tag);
        if (cls) n.className = cls;
        if (text != null) n.textContent = text;
        return n;
    };
    const root = el("div");
    root.id = "evi-bs";
    root.setAttribute("role", "status");
    const header = el("header");
    const time = el("span", "bs-time");
    header.append(el("span", "bs-brand", "evi"), time);
    const log = el("ol");
    const footer = el("footer");
    const bar = el("div", "bs-bar");
    const count = el("span", "bs-count");
    footer.append(bar, count);
    root.append(header, log, footer);
    document.body.append(root);
    document.documentElement.classList.add("evi-bs");

    const startedAt = ${Number.isFinite(startedAt) ? Math.round(startedAt) : "Date.now()"};
    const tick = () => { time.textContent = Math.max(0, (Date.now() - startedAt) / 1000).toFixed(1) + "s"; };
    tick();
    setInterval(tick, 100);

    const rows = new Map();
    let queue = 0;
    let queueUntil = 0;
    const render = view => {
        const seen = new Set();
        const now = performance.now();
        if (now > queueUntil) queue = 0;
        for (const row of view.rows) {
            seen.add(row.key);
            let li = rows.get(row.key);
            if (!li) {
                li = el("li");
                li.append(el("span", "bs-mark"), el("span", "bs-label"), el("span", "bs-detail"));
                // Several at once (plugins that started before the log could hear) step in one by one, quickly
                li.style.animationDelay = (queue * 26) + "ms";
                queue++;
                queueUntil = now + queue * 26;
                log.append(li);
                rows.set(row.key, li);
            }
            if (li.dataset.mark !== row.mark) {
                li.dataset.mark = row.mark;
                li.children[0].innerHTML = SVG[row.mark] || "";
            }
            const label = li.children[1];
            if (label.dataset.text !== row.label || label.dataset.mark !== row.mark) {
                label.dataset.text = row.label;
                label.dataset.mark = row.mark;
                label.textContent = row.label;
                if (row.mark === "current") label.append(el("span", "bs-dots"));
            }
            if (li.children[2].textContent !== row.detail) li.children[2].textContent = row.detail;
        }
        for (const [key, li] of rows) if (!seen.has(key)) { li.remove(); rows.delete(key); }
        // Whole rows only: the log's height snaps to them, and the newest stays in view
        if (!log.classList.contains("bs-fit")) {
            const row = parseFloat(getComputedStyle(root).getPropertyValue("--bs-row")) || 20;
            const height = Math.floor(log.getBoundingClientRect().height / row) * row;
            if (height > 0) {
                log.style.height = height + "px";
                log.classList.add("bs-fit");
            }
        }
        log.scrollTop = log.scrollHeight;

        if (bar.childElementCount !== view.bar.segments) {
            bar.textContent = "";
            for (let i = 0; i < view.bar.segments; i++) bar.append(el("i"));
        }
        [...bar.children].forEach((seg, i) => {
            seg.classList.toggle("on", i < view.bar.filled);
            seg.classList.toggle("fail", view.bar.failed.includes(i));
        });
        count.textContent = view.count;
    };
    window.__eviBoot = {
        render,
        manual: on => document.documentElement.classList.toggle("evi-bs-manual", !!on),
    };
    return true;
})()`;
}

/** Whether a window is loading Discord's splash, from the URL it navigates to */
export function isSplashUrl(url: unknown): boolean {
    if (typeof url !== "string" || !url.toLowerCase().startsWith("file:")) return false;
    return /\/splash\/index\.html(?:[?#].*)?$/i.test(url.replace(/\\/g, "/"));
}

/** Discord's own app pages, the only ones whose reports count */
export function isDiscordAppUrl(url: unknown): boolean {
    if (typeof url !== "string") return false;
    try {
        const u = new URL(url);
        return u.protocol === "https:" && /^(?:(?:ptb|canary)\.)?discord(?:app)?\.com$/.test(u.hostname);
    } catch {
        return false;
    }
}
