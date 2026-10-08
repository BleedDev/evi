/**
 * End-to-end check against the real, current Discord web client (logged out, headless Chrome).
 * Injects the built renderer with a fake EviNative, then verifies the core works on Discord's
 * actual bundle: runtime capture, finders, source patches, export hooks, hot reload, and the UI.
 *
 *   node scripts/test-web.ts [--headed]
 *
 * Runs on Node (native TS type stripping): playwright's browser transports hang under Bun on Windows.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync } from "fs";
import { join, resolve } from "path";
import { chromium } from "playwright-core";

import { disablePasskeys } from "./no-passkeys.ts";

import type { BootData, PluginPayload, ThemePayload } from "../src/shared/ipc";

const ROOT = resolve(import.meta.dirname, "..");
const DIST = join(ROOT, "dist");
const OUT = join(ROOT, "test-results");
mkdirSync(OUT, { recursive: true });

// CHROME_PATH overrides (CI sets it); otherwise the usual Windows install locations
const CHROME_PATHS = [
    process.env.CHROME_PATH,
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
];

// The shipped plugins, plus ones only the tests use (dist/test-plugins: Toolkit Demo)
const plugins: PluginPayload[] = ["plugins", "test-plugins"].filter(d => existsSync(join(DIST, d))).flatMap(d => readdirSync(join(DIST, d)).map(id => join(DIST, d, id))).map(dir => {
    const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
    return { manifest, code: readFileSync(join(dir, "index.js"), "utf8"), source: "dev" };
});
// An enabled plugin that uses context menus, so the menu props patch is registered at boot like it
// would be for a user with such a plugin (it's skipped entirely otherwise)
plugins.push({
    manifest: { id: "menu-user", name: "Menu User", enabledByDefault: true },
    code: "module.exports = { default: { start(ctx) { ctx.onDispose(ctx.contextMenu(\"__none__\", () => { })); } } };",
    source: "dev",
});
// Adds a profile badge through ctx.profileBadges, for one made-up user
plugins.push({
    manifest: { id: "badge-user", name: "Badge User", enabledByDefault: true },
    code: "module.exports = { default: { start(ctx) { ctx.profileBadges(id => id === \"999000000000000001\" ? [{ id: \"test-status\", name: \"Testing\", description: \"Testing right now\", iconSrc: \"data:image/png;base64,iVBORw0KGgo=\" }] : []); } } };",
    source: "dev",
});
// Installed from the store, and waits for something Discord doesn't have: it's reported to
// evi.rest's plugin health, and its crash report can go to its author
plugins.push({
    manifest: { id: "store-lookup", name: "Store Lookup", version: "1.0.0", enabledByDefault: true },
    code: "const { filters } = require(\"@evi/api\"); module.exports = { default: { start(ctx) { ctx.waitFor(filters.byProps(\"eviHealthTestNeverInDiscord\"), () => { }); } } };",
    source: "user",
});
// Installed from the store, turned on, and pulled by Evi (the kill switch): it must never start.
// Counts its starts and stops, so the test can see the pull stop it and lifting it start it again.
plugins.push({
    manifest: { id: "store-pulled", name: "Link Preview Plus", version: "1.0.0", enabledByDefault: true },
    code: "module.exports = { default: { start() { window.__test.pulledRuns = (window.__test.pulledRuns ?? 0) + 1; }, stop() { window.__test.pulledStops = (window.__test.pulledStops ?? 0) + 1; } } };",
    source: "user",
});
const PULL_REASON = "It sends the messages you open to a server it doesn't name";
const PULLED_AT = Date.UTC(2026, 8, 26, 12);
// Link Preview Plus 1.0.0 (installed; 1.0.1 in the store isn't pulled) and every version of Free Nitro
const pulled = {
    "store-pulled": { versions: ["1.0.0"], reason: PULL_REASON, at: PULLED_AT, removed: false },
    "store-scam": { versions: "all" as const, reason: "It asks for your Discord password", at: PULLED_AT, removed: false },
};

// Contacts a host its code names and one it builds at runtime, for its details' Activity section.
// Neither exists, so both requests fail; the log keeps host and path, never the query string.
plugins.push({
    manifest: { id: "net-user", name: "Net User", version: "0.0.1", enabledByDefault: true },
    code: "module.exports = { default: { start() { fetch(\"https://api.eviactivity.test/v1/ping?key=hunter2\").catch(() => { }); fetch(\"https://\" + [\"sneaky\", \"eviactivity\", \"test\"].join(\".\") + \"/collect?id=1\", { method: \"POST\", body: \"secret\" }).catch(() => { }); } } };",
    source: "dev",
});

// Fails to start on purpose, for the crash report. Its error logs are expected, see BROKEN below.
const BROKEN = "Broken Plugin";
plugins.push({
    manifest: { id: "broken", name: BROKEN, version: "0.0.1", enabledByDefault: true },
    code: "module.exports = { default: { start() { throw new Error(\"kaboom\"); } } };",
    source: "dev",
});

const boot: BootData = {
    version: "test",
    // Evi.plugins is the plugin manager itself here: the test drives plugins through their contexts
    testHooks: true,
    dataDir: "C:/fake",
    // Last saw an older Evi: What's new shows once at startup
    // Live toasts stay out of the other checks' way until their own turn
    settings: { quickCss: true, liveToasts: false, plugins: { experiments: { enabled: true } }, enabledThemes: [], lastSeenVersion: "0.0.1", tour2Seen: true, pluginVersionsSeen: { "clear-urls": "0.9.0", "no-track": "0.9.0" } },
    plugins,
    pulled,
    quickCss: "",
    themes: [{
        file: "web-test.css",
        name: "Web Test",
        description: "Paints a marker property so the test can see it",
        author: "Evi",
        version: "1.0.0",
        css: ":root { --dl-test-theme: on; }",
    } satisfies ThemePayload],
};

const renderer = readFileSync(join(DIST, "core", "renderer.js"), "utf8");

/** Runs in the page before Discord: stands in for the preload bridge */
function fakeNative(bootData: BootData) {
    if (window !== window.top) return;
    const pluginListeners: ((change: unknown) => void)[] = [];
    const themeListeners: ((change: unknown) => void)[] = [];
    (window as any).__test = { pluginListeners, themeListeners, savedSettings: null, nativeCalls: [] as unknown[], storeInstalls: [] as unknown[], themeInstalls: [] as unknown[], stars: [] as unknown[], badgeAdmin: [] as unknown[], badgePrefs: [] as unknown[], updateChecks: 0, updateInstalls: 0, bootOk: 0, exitedSafeMode: 0, account: { confirmed: false, started: 0, dashboard: 0 } };
    Object.assign((window as any).__test, { healthReports: [] as unknown[], crashReports: [] as unknown[], pluginReports: [] as unknown[], pulled: bootData.pulled ?? {} });
    // Discord deletes window.localStorage once it starts, like Evi the test keeps a reference
    (window as any).__test.storage = window.localStorage;
    (window as any).__test.native = (window as any).EviNative = {
        boot: () => structuredClone(bootData),
        saveSettings: async (s: unknown) => void ((window as any).__test.savedSettings = s),
        saveSettingsSync: (s: unknown) => void ((window as any).__test.savedSettings = structuredClone(s)),
        saveQuickCss: async () => { },
        saveQuickCssSync: () => { },
        reportBootOk: () => void (window as any).__test.bootOk++,
        exitSafeMode: async () => void (window as any).__test.exitedSafeMode++,
        onQuickCssChange: () => { },
        // The wallpaper main copied in: the test hands it the bytes when it turns one on
        readWallpaper: async () => (window as any).__test.wallpaper ?? { ok: false, error: "No wallpaper" },
        removeWallpaper: async () => { },
        memoryUsage: async () => ({ renderer: 1.9 * 1024 ** 3, gpu: 300 * 1024 ** 2 }),
        onPluginChange: (cb: (c: unknown) => void) => void pluginListeners.push(cb),
        onThemeChange: (cb: (c: unknown) => void) => void themeListeners.push(cb),
        // Like main: refuse non-https, otherwise "download" a theme and announce it before resolving
        addThemeFromUrl: async (url: string) => {
            if (!url.startsWith("https://")) return { ok: false, error: "Only https:// links are allowed" };
            const theme = { file: "remote.css", name: "Remote Theme", css: ":root { --dl-remote-theme: on; }" };
            themeListeners.forEach(cb => cb({ type: "upsert", theme }));
            return { ok: true, file: theme.file };
        },
        // Plugin store: a small registry, one plugin installed, one with an update, one native
        storeList: async () => {
            const file = (id: string, name: string) => ({ url: `https://example.com/${id}/${name}`, sha256: "0".repeat(64) });
            const entry = (id: string, name: string, description: string, version: string, native = false, tags: string[] = [], extra: object = {}) => ({
                id, name, description, authors: ["Evi"], version, tags, native, minEviVersion: "0.1.0", screenshots: [], changelog: [],
                files: { "manifest.json": file(id, "manifest.json"), "index.js": file(id, "index.js"), ...(native ? { "native.js": file(id, "native.js") } : {}) },
                ...extra,
            });
            const theme = (id: string, name: string, description: string) => ({
                id, name, description, authors: ["Evi"], version: "1.0.0", tags: ["dark"], screenshots: [], changelog: [], file: file(id, `${id}.css`),
            });
            return {
                ok: true,
                registryUrl: "https://raw.githubusercontent.com/BleedDev/evi/main/registry.json",
                problems: [],
                plugins: [
                    entry("store-clock", "Message Clock", "Shows the exact send time next to every message.", "1.0.0", false, ["messages"], {
                        updatedAt: "2026-09-01",
                        source: "https://github.com/BleedDev/evi",
                        screenshots: ["https://example.com/store-clock/shot.png"],
                        changelog: [{ version: "1.0.0", notes: ["First release, with 12 and 24 hour clocks"] }],
                    }),
                    entry("store-quiet", "Quiet Mode", "Hides typing indicators and read states until you ask for them.", "1.3.0", false, ["privacy"], {
                        updatedAt: "2026-09-20",
                        changelog: [{ version: "1.3.0", notes: ["Read states too"] }, { version: "1.2.0", notes: ["Typing indicators"] }],
                    }),
                    entry("store-rpc", "Local RPC", "Exposes a local API so other apps can read your current channel.", "0.4.0", true, ["integration"]),
                    entry("store-theme-sync", "Theme Sync", "Follows your system's light and dark mode.", "2.1.0"),
                    entry("store-lookup", "Store Lookup", "Waits for a part of Discord that isn't there.", "1.0.0", false, ["messages"], { authorIds: ["evi"] }),
                    // Community plugins: one to install, one Evi pulled at 1.0.0 with a fixed 1.0.1, one pulled for good
                    // A port: its own link points at the plugin it came from
                    entry("store-community", "Emoji Tray", "Keeps your most used emoji one click away.", "1.2.0", false, ["messages"], {
                        authors: ["Mira"], authorIds: ["mira"], source: "https://github.com/Vendicated/Vencord/tree/main/src/plugins/emojiTray",
                    }),
                    entry("store-pulled", "Link Preview Plus", "Bigger link previews in the page's own colors.", "1.0.1", false, ["messages"], {
                        authors: ["Mira"], authorIds: ["mira"],
                        changelog: [{ version: "1.0.1", notes: ["Previews no longer go through a server"] }],
                    }),
                    entry("store-scam", "Free Nitro", "Unlocks Nitro features at no cost.", "1.0.0", false, [], { authors: ["Nitro Giveaways"] }),
                ],
                themes: [
                    theme("midnight", "Midnight", "True black for OLED screens."),
                    theme("paper", "Paper", "Soft light greys."),
                ],
                installed: [{ id: "store-quiet", version: "1.2.0", fromStore: true }, { id: "store-theme-sync", version: "2.1.0", fromStore: true }, { id: "store-lookup", version: "1.0.0", fromStore: true }, { id: "store-pulled", version: "1.0.0", fromStore: true }],
                installedThemes: [],
            };
        },
        storeInstallTheme: async (id: string) => {
            (window as any).__test.themeInstalls.push(id);
            const theme = { file: `${id}.css`, name: id[0].toUpperCase() + id.slice(1), version: "1.0.0", css: `:root { --dl-store-theme: ${id}; }` };
            themeListeners.forEach(cb => cb({ type: "upsert", theme }));
            return { ok: true, id, version: "1.0.0" };
        },
        storeUninstallTheme: async (id: string) => {
            themeListeners.forEach(cb => cb({ type: "remove", file: `${id}.css` }));
            return { ok: true, id, version: "1.0.0" };
        },
        // Account link: not linked until the test confirms the code "on the site"
        accountStatus: async () => ({ ok: true, site: "https://evi.rest", user: (window as any).__test.account.confirmed ? { id: "123456789012345678", username: "evi-tester", globalName: "Evi Tester", avatar: null } : null, admin: !!(window as any).__test.account.admin }),
        // The Author page ("Publish your own"): __test.authorMode picks evi.rest's answer
        authorStats: async (days: number) => {
            const test = (window as any).__test;
            test.authorDays = days;
            if (test.authorMode === "unlinked") return { ok: false, error: "Link this Evi to your Discord account first (Evi settings, Account)", unlinked: true };
            if (test.authorMode === "none") return { ok: false, error: "Only verified authors have plugin stats", notAuthor: true };
            const day = (ago: number) => new Date(Date.now() - ago * 86_400_000).toISOString().slice(0, 10);
            const history = Array.from({ length: days }, (_, i) => ({ day: day(days - i), installed: 900 + i * 14, active: 760 + Math.round(120 * Math.sin(i / 4) ** 2) + i * 12 }));
            const plugin = (id: string, name: string, extra: object) => ({
                id, name, version: "2.1.0", coAuthored: false, activeNow: history.at(-1)!.active, installedNow: history.at(-1)!.installed, history, stars: 214,
                rating: { average: 4.6, count: 38, counts: [1, 1, 2, 8, 26] },
                reviews: [
                    { id: 2, rating: 5, body: "Exactly what I wanted, works great after every Discord update.", version: "2.1.0", user: { id: "223456789012345678", name: "Mira", avatar: null }, createdAt: Date.now() - 3_600_000 },
                    { id: 1, rating: 4, body: "Love it. Would be nice to pick the colour.", version: "2.0.0", user: { id: "323456789012345678", name: "kai", avatar: null }, createdAt: Date.now() - 86_400_000 * 3 },
                ],
                openReports: 1, crashes: { unresolved: 2, latestRate: 0.012 },
                health: { installsReporting: 9, lastReportAt: Date.now() - 600_000, state: null, builds: [{ build: "412345", installs: 7, lookups: 1, patches: 5, start: 1 }, { build: "411902", installs: 2, lookups: 0, patches: 2, start: 0 }] },
                pull: null, hotfixes: [], ...extra,
            });
            return {
                ok: true,
                value: {
                    author: { slug: "kaz", name: "Kaz" }, days, at: Date.now(),
                    plugins: [plugin("stream-dm-guard", "Stream DM Guard", {}), plugin("quiet-mode", "Quiet Mode", { coAuthored: true, hotfixes: [{ id: 3, note: "Discord moved the member list", at: Date.now() }] })],
                },
            };
        },
        authorOpen: async (link: string) => void (window as any).__test.nativeCalls.push(["authorOpen", link]),
        devLive: async () => ({
            ok: true,
            value: {
                at: Date.now(),
                now: { online: 1284, connections: 1301, versions: [{ version: "1.5.0", count: 1102 }, { version: "1.5.1", count: 151 }, { version: "old", count: 31 }] },
                versionDays: [{ day: new Date().toISOString().slice(0, 10), version: "1.5.0", peak: 1102 }],
                today: { active: 3920, peak: 1410 },
                days: Array.from({ length: 30 }, (_, i) => ({ day: new Date(Date.now() - (29 - i) * 86_400_000).toISOString().slice(0, 10), active: 2400 + Math.round(1400 * Math.sin(i / 4) ** 2) + i * 20, peak: 900 + i * 10 })),
                people: { accounts: 812, linked: 1033 },
                topPlugins: [{ id: "view-icons", name: "View Icons", installs: 2210 }, { id: "music-player", name: "Music Player", installs: 1544 }, { id: "quest-blocker", name: "Quest Blocker", installs: 990 }, { id: "fake-deafen", name: "Fake Deafen", installs: 870 }, { id: "clear-urls", name: "Clear URLs", installs: 655 }, { id: "last-seen", name: "Last Seen", installs: 402 }],
                store: { plugins: 64, waiting: 3, reports: 1 },
            },
        }),
        // evi.rest's admin API as the Developers page sees it; calls are kept for the checks
        devAdmin: async (method: string, path: string, body?: unknown) => {
            const test = (window as any).__test;
            (test.devAdmin ??= []).push({ method, path, body });
            const day = 86_400_000, now = Date.now();
            if (method !== "GET") return { ok: true, value: {} };
            const route = path.replace(/\?.*$/, "");
            const value = ({
                "/admin/submissions": { submissions: [{ id: 41, status: "pending", plugin: "cool-plugin", name: "Cool Plugin", version: "1.2.0", published: "1.1.0", channel: "stable", author: { slug: "lodestone", name: "Lodestone" }, createdAt: now - 3 * 3600_000, code: "export default definePlugin({ start() {} });", codeTruncated: false, nativeCode: null, scan: { patchCount: 3, domains: ["api.example.com"], dynamicCode: [], clipboardRead: false, stores: ["UserStore"] } }] },
                "/admin/theme-submissions": { submissions: [{ id: 7, status: "pending", theme: "midnight", name: "Midnight", version: "1.0.0", published: null, author: { slug: "ann", name: "Ann" }, createdAt: now - day, css: ":root { --bg: #000; }", scan: { hosts: [{ host: "fonts.googleapis.com", allowed: true }] } }] },
                "/admin/reports": { reports: [{ id: "12", status: "open", plugin: "music-player", version: "1.0.0", reason: "broken", details: "The player doesn't show after Discord's update.", openForPlugin: 2, createdAt: now - 3600_000, reporter: { id: "1", username: "someone", globalName: "Someone Nice" } }] },
                "/admin/reviews": { reviews: [] },
                "/admin/health": {
                    plugins: [
                        { id: "music-player", name: "Music Player", installsReporting: 1544, brokenPatches: 212, lastReportAt: now - 600_000 },
                        { id: "view-icons", name: "View Icons", installsReporting: 2210, brokenPatches: 0, lastReportAt: now - 120_000 },
                        { id: "quest-blocker", name: "Quest Blocker", installsReporting: 990, brokenPatches: 0, lastReportAt: now - 300_000 },
                    ],
                    pulls: { "old-plugin": { versions: "all", reason: "It crashed Discord after the September update.", removed: true, at: now - 2 * day } },
                },
                "/admin/required-version": { required: null, latest: "9.9.0" },
                "/admin/announcements": { announcements: [{ id: 3, title: "Evi 1.5.0 is out", body: "Live announcements, and plugin notifications work again.", at: now - day, withdrawnAt: null, by: { id: "1", username: "bleed", globalName: "bleed" } }] },
                "/admin/people": {
                    total: 3, page: 1, size: 25,
                    people: [
                        { user: { id: "123456789012345678", username: "evi-tester", globalName: "Evi Tester", avatar: null }, createdAt: now - 40 * day, lastLogin: now - 3600_000, installs: 2, admin: false, badges: ["early-supporter", "plugin-author", "supporter-gold"], banned: null },
                        { user: { id: "223456789012345678", username: "lodestone", globalName: "Lodestone", avatar: null }, createdAt: now - 9 * day, lastLogin: now - day, installs: 1, admin: false, badges: ["plugin-author"], banned: { reason: "Spam reviews", until: now + 6 * day, by: "1", at: now - day } },
                        { user: { id: "323456789012345678", username: "bleed", globalName: "bleed", avatar: null }, createdAt: now - 60 * day, lastLogin: now - 600_000, installs: 3, admin: true, badges: ["developer"], banned: null },
                    ],
                },
                "/admin/badges": { badges: [
                    { id: "developer", name: "Evi Developer", description: "Makes Evi", icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><circle cx='12' cy='12' r='11' fill='%235865F2'/><text x='12' y='16.5' font-size='12' font-family='sans-serif' font-weight='700' text-anchor='middle' fill='white'>D</text></svg>", holders: 1 },
                    { id: "early-supporter", name: "Early Supporter", description: "Here from the start", icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><circle cx='12' cy='12' r='11' fill='%23EB459E'/><text x='12' y='16.5' font-size='12' font-family='sans-serif' font-weight='700' text-anchor='middle' fill='white'>E</text></svg>", holders: 14 },
                    { id: "plugin-author", name: "Plugin Author", description: "Published a plugin", icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><circle cx='12' cy='12' r='11' fill='%23F0883E'/><text x='12' y='16.5' font-size='12' font-family='sans-serif' font-weight='700' text-anchor='middle' fill='white'>P</text></svg>", holders: 6, automatic: true },
                    { id: "supporter-gold", name: "Gold Supporter", description: "", icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><circle cx='12' cy='12' r='11' fill='%23D4A72C'/><text x='12' y='16.5' font-size='12' font-family='sans-serif' font-weight='700' text-anchor='middle' fill='white'>G</text></svg>", holders: 2, supporter: true },
                    { id: "supporter-emerald", name: "Emerald Supporter", description: "", icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><circle cx='12' cy='12' r='11' fill='%232D9C6A'/><text x='12' y='16.5' font-size='12' font-family='sans-serif' font-weight='700' text-anchor='middle' fill='white'>E</text></svg>", holders: 1, supporter: true },
                    { id: "beta-tester", name: "Beta Tester", description: "Tried things first", icon: "", holders: 0 },
                ] },
                "/admin/users/123456789012345678": {
                    user: { id: "123456789012345678", username: "evi-tester", globalName: "Evi Tester", avatar: null },
                    createdAt: now - 40 * day, lastLogin: now - 3600_000, logins: 12, installs: 2, admin: false,
                    badges: [{ id: "early-supporter", position: 0, grantedAt: now - 30 * day }, { id: "plugin-author", position: 1, grantedAt: now - 10 * day }],
                    supporter: { userId: "123456789012345678", level: "supporter-gold", since: now - 200 * day, days: 200, startedAt: now - 200 * day, grantedDays: 0, next: { level: "supporter-emerald", at: now + 165 * day } },
                    author: { slug: "evi-tester", name: "Evi Tester", plugins: [{ id: "store-clock", name: "Store Clock" }] },
                    banned: null,
                    banLog: [{ action: "unban", reason: "", until: null, by: { id: "1", username: "bleed", globalName: "bleed" }, at: now - 50 * day }],
                },
            } as Record<string, unknown>)[route];
            return value === undefined ? { ok: false, error: "Not found" } : { ok: true, value };
        },
        openDashboard: async () => { (window as any).__test.account.dashboard++; },
        // Evi 9.9.0 is out; installing reports progress, then the installer would restart Discord
        checkForUpdate: async () => {
            (window as any).__test.updateChecks++;
            return {
                state: "available", current: "0.2.0", installable: true, checkedAt: Date.now(),
                release: { tag: "v9.9.0", version: "9.9.0", url: "https://github.com/BleedDev/evi/releases/tag/v9.9.0", notes: "## New\n- **Badges** you can hide\n- Updates from the app\n\nThanks for testing.", publishedAt: null, exeUrl: "", checksumUrl: "" },
            };
        },
        installUpdate: async () => {
            (window as any).__test.updateInstalls++;
            (window as any).__test.updateProgress?.({ phase: "downloading", done: 42, total: 100 });
            return { ok: true, version: "9.9.0" };
        },
        onUpdateProgress: (cb: (p: unknown) => void) => void ((window as any).__test.updateProgress = cb),
        linkAccount: async () => {
            (window as any).__test.account.started++;
            return { ok: true, code: "K7PQ-X3MV" };
        },
        // evi.rest: one verified author; Quiet Mode 1.2.0 broken by installs' reports, Store Lookup being looked into
        getAuthors: async () => ({
            ok: true,
            site: "https://evi.rest",
            authors: { evi: { slug: "evi", name: "Evi", bio: "The people who make Evi.", verified: true, userId: "123456789012345678", avatar: null, links: { github: "https://github.com/BleedDev/evi" }, plugins: ["store-clock", "store-lookup"] } },
        }),
        // Pulls ride along with health; __test.setPulls changes them like evi.rest would
        getHealth: async () => ({
            ok: true,
            pulled: (window as any).__test.pulled,
            plugins: {
                "store-quiet": { state: "broken", since: Date.now() - 3 * 3600_000, version: "1.2.0", automatic: true, reports: 12 },
                "store-lookup": { state: "investigating", message: "Fix coming in 1.0.1", setBy: "Evi", since: Date.now() - 5 * 60_000, version: "1.0.0", automatic: false },
            },
        }),
        sendCrashReport: async (input: unknown) => {
            (window as any).__test.crashReports.push(input);
            return { ok: true, author: "Evi" };
        },
        reportHealth: async (input: unknown) => {
            (window as any).__test.healthReports.push(input);
            return { ok: true };
        },
        // Main pushes pulls when evi.rest's health answer changes them
        onPullsChange: (cb: (pulled: unknown) => void) => {
            (window as any).__test.setPulls = (next: unknown) => {
                (window as any).__test.pulled = next;
                cb(next);
            };
        },
        reportPlugin: async (id: string, input: unknown) => {
            (window as any).__test.pluginReports.push({ id, input });
            return { ok: true };
        },
        // Stars: counts for two plugins, this install starred Quiet Mode
        getStars: async () => ({ ok: true, counts: { "plugin:store-clock": 41, "plugin:store-quiet": 7 }, mine: ["plugin:store-quiet"] }),
        setStar: async (kind: string, id: string, starred: boolean) => {
            (window as any).__test.stars.push({ kind, id, starred });
            return { ok: true, starred, count: id === "store-clock" ? (starred ? 42 : 41) : 0 };
        },
        // Badges: one user with the Developer badge who's also a Gold supporter, icons already turned
        // into data URLs by main
        getBadges: async () => ({
            ok: true,
            badges: {
                dev: { name: "Developer", description: "Builds Evi", icon: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==" },
                "supporter-gold": { name: "Gold Supporter", description: "", icon: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==" },
            },
            users: { "123456789012345678": ["dev", "supporter-gold"] },
            supporters: { "123456789012345678": Date.UTC(2026, 2, 5, 12) },
        }),
        setBadgePrefs: async (userId: string, prefs: unknown) => {
            (window as any).__test.badgePrefs.push({ userId, prefs });
            return { ok: true };
        },
        // Main pushes a new list when evi.rest's change stream says so
        onBadgesChange: (cb: (badges: unknown) => void) => void ((window as any).__test.pushBadges = cb),
        badgeAdminAvailable: async () => true,
        badgeAdmin: async (input: any) => {
            (window as any).__test.badgeAdmin.push(input);
            return { ok: true, message: `done: ${input.action}` };
        },
        // A 1x1 PNG, like main hands back after checking the registry lists the URL
        storeImage: async (url: string) => url.startsWith("https://example.com/")
            ? { ok: true, dataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==" }
            : { ok: false, error: "That image isn't in the store" },
        // evi.rest's community side: a front page, ratings, Message Clock's page, and an inbox
        storeHome: async () => ({ ok: true, value: { trending: ["plugin:store-clock", "plugin:store-quiet"], fresh: ["plugin:store-rpc"], collections: [{ id: "staff-picks", title: "Staff picks", description: "Hand-picked by Evi's team", items: ["plugin:store-quiet", "plugin:store-clock"] }], at: 1 } }),
        storeRatings: async () => ({ ok: true, value: { "plugin:store-clock": { average: 4.5, count: 2, counts: [0, 0, 0, 1, 1] } } }),
        pluginPage: async (id: string) => ({
            ok: true,
            value: {
                rating: id === "store-clock" ? { average: 4.5, count: 2, counts: [0, 0, 0, 1, 1] } : { average: 0, count: 0, counts: [0, 0, 0, 0, 0] },
                reviews: id === "store-clock" ? [{ id: 7, plugin: id, rating: 5, body: "Exactly what I wanted.", version: "1.0.0", user: { id: "222222222222222222", name: "Bob", avatar: null }, createdAt: Date.now() - 3600_000, updatedAt: Date.now() - 3600_000 }] : [],
                mine: null,
                related: id === "store-clock" ? ["store-quiet"] : [],
                issues: [],
                note: id === "store-clock" ? { version: "1.0.0", text: "Times follow your clock settings." } : null,
                installs: 1234,
            },
        }),
        setReview: async (id: string, review: unknown) => ((window as any).__test.reviews ??= []).push({ id, review }) && { ok: true, value: {} },
        reportReview: async (reviewId: number) => ((window as any).__test.reviewReports ??= []).push(reviewId) && { ok: true, value: {} },
        following: async () => ({ ok: true, value: [] }),
        follow: async (slug: string, on: boolean) => ({ ok: true, value: { following: on, followers: on ? 1 : 0 } }),
        inbox: async () => ({ ok: true, value: [{ id: "1", kind: "review", title: "New review of Message Clock", body: "★★★★★ Exactly what I wanted.", link: { kind: "plugin", id: "store-clock" }, at: Date.now() - 60_000, read: false }] }),
        markInboxRead: async () => ((window as any).__test.inboxRead = true, { ok: true, value: [{ id: "1", kind: "review", title: "New review of Message Clock", body: "★★★★★ Exactly what I wanted.", link: { kind: "plugin", id: "store-clock" }, at: Date.now() - 60_000, read: true }] }),
        onInboxChange: () => { },
        // evi.rest's announcements: the test sets the list and fires the live event itself
        announcements: async () => ({ ok: true, value: (window as any).__test.announcements ?? [] }),
        onAnnouncementsChange: (cb: () => void) => void ((window as any).__test.announce = cb),
        // A required Evi version (ui/RequiredUpdate.tsx): the test sets it and fires the live event itself
        required: async () => ({ ok: true, value: (window as any).__test.required ?? null }),
        onRequiredChange: (cb: () => void) => void ((window as any).__test.requiredChanged = cb),
        prepareUpdate: async (minimum: string) => {
            const test = (window as any).__test;
            (test.prepared ??= []).push(minimum);
            return { ok: true, version: minimum };
        },
        credits: async () => ({ ok: true, value: { supporters: [{ name: "Mira", avatar: null, userId: "333333333333333333", since: 1, level: "supporter-gold" }] } }),
        credited: async () => ({ ok: true, value: false }),
        setCredited: async (on: boolean) => ({ ok: true, value: on }),
        storePreviewMedia: async () => ({ ok: false, error: "not in this test" }),
        // A store plugin's code, which main downloads and checks against the registry for its page
        storePreview: async (id: string) => id === "store-clock"
            ? { ok: true, code: "module.exports = { default: { start(ctx) { fetch(\"https://time.example.net/now\"); ctx.contextMenu(\"message\", () => {}); } } };", manifest: { native: false } }
            : { ok: false, error: "not in this test" },
        storeInstall: async (id: string, options?: { allowNative?: boolean; }) => {
            (window as any).__test.storeInstalls.push({ id, options });
            if (id === "store-rpc" && !options?.allowNative) return { ok: false, error: "Needs confirmation" };
            const plugin = { source: "user", manifest: { id, name: id, version: "9.9.9" }, code: "module.exports = { default: {} };" };
            pluginListeners.forEach(cb => cb({ type: "upsert", plugin }));
            return { ok: true, id, version: id === "store-quiet" ? "1.3.0" : "1.0.0" };
        },
        storeUninstall: async (id: string) => ({ ok: true, id, version: "1.0.0" }),
        onStoreProgress: () => { },
        callNative: async (...args: unknown[]) => ((window as any).__test.nativeCalls.push(args), 42),
        setNativeRunning: async () => { },
        // Backup: main's dialogs and file IO, answered with a fixed backup that turns the test theme on
        exportBackup: async () => ({ ok: true, path: "C:\\Users\\you\\Documents\\evi-backup-2026-09-26.json" }),
        openBackup: async () => {
            const preview = (mode: string) => ({
                mode,
                pluginsEnabled: ["Toolkit Demo"],
                pluginsDisabled: mode === "replace" ? ["Clear URLs"] : [],
                pluginSettingsChanged: ["Smooth Typing"],
                missingPlugins: [{ id: "spotify-controls", name: "Spotify Controls", source: "user", enabled: true }],
                themesAdded: ["midnight.css"],
                themesOverwritten: ["web-test.css"],
                themesEnabled: ["web-test.css"],
                themesDisabled: [],
                quickCss: mode === "replace" ? "replaced" : "kept",
                changes: 7,
            });
            return {
                ok: true,
                token: "test-token",
                fileName: "evi-backup-2026-09-20.json",
                createdAt: "2026-09-20T18:42:00.000Z",
                eviVersion: "0.1.0",
                previews: { merge: preview("merge"), replace: preview("replace") },
            };
        },
        applyBackup: async (token: string, mode: string) => {
            const current = (window as any).Evi.settings.data;
            const settings = { ...structuredClone(current), enabledThemes: [...current.enabledThemes, "web-test.css"] };
            (window as any).__test.applied = { token, mode };
            return { ok: true, settings, preview: { changes: 7 } };
        },
        openPath: async () => "",
        relaunch: async () => { },
    };
}


const results: { name: string; ok: boolean; detail?: unknown; }[] = [];
/**
 * Closes something with `close`, then reports what closing looked like: whether it was still on the
 * page marked [data-closing] with its exit animations running, and whether it left afterwards.
 */
async function closesWithExit(selector: string, close: () => Promise<unknown>) {
    await close();
    const during = await page.evaluate(sel => {
        const el = document.querySelector(sel);
        const layer = el?.closest("[data-closing]");
        return { closing: !!layer, running: layer ? layer.getAnimations({ subtree: true }).map(a => (a as CSSAnimation).animationName) : [] };
    }, selector);
    const gone = await page.waitForSelector(selector, { state: "detached", timeout: 2000 }).then(() => true, () => false);
    return { ...during, gone };
}

function check(name: string, ok: boolean, detail?: unknown) {
    results.push({ name, ok, detail });
    console.log(`${ok ? "\x1b[32m✓" : "\x1b[31m✗"} ${name}\x1b[0m${detail !== undefined ? `  \x1b[2m${JSON.stringify(detail)}\x1b[0m` : ""}`);
}

const browser = await chromium.launch({
    executablePath: CHROME_PATHS.find(p => !!p && existsSync(p)),
    headless: !process.argv.includes("--headed"),
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

const eviErrors: string[] = [];
page.on("console", msg => {
    const text = msg.text();
    if (text.includes("Evi")) {
        if (msg.type() === "error") eviErrors.push(text);
        if (process.argv.includes("--verbose") || msg.type() !== "log") console.log(`  [page ${msg.type()}] ${text.replace(/%c/g, "").slice(0, 300)}`);
    }
});
page.on("pageerror", err => eviErrors.push(`pageerror: ${err.message}`));

// Before anything else: discord.com would otherwise pop a Windows passkey dialog on the desktop
await page.addInitScript(disablePasskeys);
await page.addInitScript(fakeNative, boot);
await page.addInitScript(renderer);
await page.goto("https://discord.com/login", { waitUntil: "domcontentloaded" });

await page.waitForFunction(() => (window as any).Evi?.plugins.getSnapshot().some((p: any) => p.running), null, { timeout: 60_000 });

const core = await page.evaluate(() => {
    const D = (window as any).Evi;
    const { api } = D;
    return {
        wreq: !!D.wreq,
        factories: Object.keys(D.wreq.m).length,
        loaded: Object.keys(D.wreq.c).length,
        react: api.React.version,
        createRoot: typeof api.createRoot,
        dispatcherSubs: Object.keys(api.Dispatcher._subscriptions ?? {}).length,
        userStore: typeof api.getStore("UserStore")?.getCurrentUser,
        running: D.plugins.getSnapshot().filter((p: any) => p.running).map((p: any) => p.manifest.id),
    };
});
check("captured __webpack_require__", core.wreq, { factories: core.factories, loaded: core.loaded });
check("found React", typeof core.react === "string", core.react);
check("found createRoot", core.createRoot === "function");
check("found Flux dispatcher", core.dispatcherSubs > 10, { subscriptions: core.dispatcherSubs });
check("found UserStore by name", core.userStore === "function");
check("enabled plugins started", ["clear-urls", "experiments", "no-track"].every(id => core.running.includes(id)), core.running);

// What's new (first: it's a modal, so it covers the page until closed)

const whatsNew = await page.waitForSelector(".dl-whats-new[role=dialog]", { timeout: 10_000 }).then(() => page.evaluate(async () => {
    const modal = document.querySelector(".dl-whats-new")!;
    // Measured once its entrance has settled: it springs up from 90%
    await Promise.all(modal.getAnimations().map(an => an.finished));
    const heading = modal.querySelector(".dl-whats-new-title");
    return {
        text: modal.textContent ?? "",
        headings: [...modal.querySelectorAll(".dl-whats-new-title")].map(h => h.textContent),
        headingColor: heading ? getComputedStyle(heading).color : null,
        itemColor: getComputedStyle(modal.querySelector(".dl-whats-new-item")!).color,
        width: modal.getBoundingClientRect().width,
        cover: await (async () => {
            const img = modal.querySelector<HTMLImageElement>(".dl-whats-new-cover");
            if (!img) return null;
            const loaded = await img.decode().then(() => img.naturalWidth > 0, () => false);
            return { loaded, width: img.getBoundingClientRect().width, height: img.getBoundingClientRect().height };
        })(),
        fits: modal.getBoundingClientRect().bottom <= innerHeight,
        seen: (window as any).Evi.settings.data.lastSeenVersion,
        version: (window as any).Evi.version,
    };
}), () => null);
check("What's new shows once after an update, and remembers the version", !!whatsNew && /What’s new in Evi/.test(whatsNew.text) && whatsNew.headings.includes("New") && whatsNew.seen === whatsNew.version, whatsNew);
check("What's new is Evi's own (560px, pill headings in their own color), and fits the window", !!whatsNew && whatsNew.width > 540 && whatsNew.width <= 562 && whatsNew.fits && !!whatsNew.headingColor && whatsNew.headingColor !== whatsNew.itemColor, whatsNew);
check("What's new opens with the release's cover, edge to edge across the top", !!whatsNew?.cover?.loaded && whatsNew.cover.width >= whatsNew.width - 2 && whatsNew.cover.height > 200, whatsNew?.cover);
await page.screenshot({ path: join(OUT, "ui-whats-new.png") });
const whatsNewExit = await closesWithExit(".dl-whats-new", () => page.locator(".dl-whats-new").getByRole("button", { name: "Close", exact: true }).click());
check("What's new closes with Discord's modal exit (shrinks and fades), then leaves the page", whatsNewExit.closing && whatsNewExit.running.includes("evi-modal-out") && whatsNewExit.gone, whatsNewExit);

// Plugins that updated since they were last seen follow, in one popup
const versionOf = (id: string): string => JSON.parse(readFileSync(join(ROOT, "plugins", id, "manifest.json"), "utf8")).version;
const pluginNews = await page.waitForSelector(".dl-plugin-whats-new[role=dialog]", { timeout: 5000 }).then(() => page.evaluate(() => ({
    text: document.querySelector(".dl-plugin-whats-new")?.textContent ?? "",
    seen: (window as any).Evi.settings.data.pluginVersionsSeen,
})), () => null);
check("Plugin updates show their changelogs once, batched, and remember the versions",
    !!pluginNews && pluginNews.text.includes("What’s New in 2 Plugins") && pluginNews.text.includes(`Clear URLs ${versionOf("clear-urls")}`)
    && pluginNews.text.includes(`No Track ${versionOf("no-track")}`)
    && pluginNews.seen?.["clear-urls"] === versionOf("clear-urls") && pluginNews.seen?.["message-logger"] !== undefined, pluginNews);
await page.screenshot({ path: join(OUT, "ui-plugin-whats-new.png") });
const pluginNewsExit = await closesWithExit(".dl-plugin-whats-new", () => page.locator(".dl-plugin-whats-new").getByRole("button", { name: "Close", exact: true }).click());
check("Plugin changelogs close with an exit animation", pluginNewsExit.closing && pluginNewsExit.gone, pluginNewsExit);

// Dialog motion: a plugin's dialog, on Discord's real page

{
    const opened = await page.evaluate(async () => {
        const w = window as any;
        await w.Evi.plugins.setEnabled("voice-activity-log", true);
        const plugin = w.Evi.$("voice-activity-log");
        const log = plugin?.getLog?.();
        if (!log) return { ok: false };
        // An earlier call that ended, then the one you're in now
        const names: Record<string, string> = { a: "Mira", b: "Theo", c: "Jun" };
        const quiet = { muted: false, deafened: false, streaming: false, video: false };
        const base = { selfId: "me", nameOf: (id: string) => names[id] ?? id, channelName: (id: string) => ({ vc1: "late night radio", vc2: "study hall" } as Record<string, string>)[id] ?? id };
        const t = Date.now() - 50 * 60_000;
        log.sync({ ...base, channelId: "vc2", snapshot: { a: quiet }, now: t });
        log.sync({ ...base, channelId: "vc2", snapshot: { a: quiet, b: quiet }, now: t + 4 * 60_000 });
        log.sync({ ...base, channelId: "vc1", snapshot: { c: quiet }, now: t + 20 * 60_000 });
        log.sync({ ...base, channelId: "vc1", snapshot: { c: quiet, a: quiet }, now: t + 31 * 60_000 });
        log.sync({ ...base, channelId: "vc1", snapshot: { a: quiet }, now: t + 44 * 60_000 });
        plugin.openLog();
        let modal: Element | null = null;
        for (let i = 0; i < 60 && !modal; i++) {
            await new Promise(r => requestAnimationFrame(r));
            modal = document.querySelector(".evi-vcl-modal");
        }
        const running = modal ? modal.getAnimations().map(a => (a as CSSAnimation).animationName) : [];
        return { ok: !!modal, running, scrim: document.querySelector(".evi-vcl-scrim")?.getAnimations().map(a => (a as CSSAnimation).animationName) ?? [] };
    });
    check("A plugin dialog opens with Discord's modal entrance (backdrop fades, dialog springs up)", opened.ok && !!opened.running?.includes("evi-modal-in") && !!opened.scrim?.includes("evi-scrim-in"), opened);
    await page.waitForTimeout(400);
    await page.screenshot({ path: join(OUT, "plugin-voice-log.png") });
    const layout = await page.evaluate(() => {
        const modal = document.querySelector(".evi-vcl-modal")!.getBoundingClientRect();
        const rows = [...document.querySelectorAll(".evi-vcl-row")].map(r => r.textContent);
        const tabs = [...document.querySelectorAll(".evi-vcl-tab")].map(t => t.textContent);
        const primary = getComputedStyle(document.querySelector('.evi-vcl-button[data-variant="primary"]')!).backgroundColor;
        return { width: modal.width, fits: modal.bottom <= innerHeight && modal.top >= 0, rows, tabs, primary };
    });
    check("The voice log lists the call's people and both sessions, channel first", layout.fits && layout.rows.some(r => r?.includes("Mira")) && layout.tabs.length === 2 && layout.tabs[0]!.startsWith("late night radio"), layout);
    const logExit = await closesWithExit(".evi-vcl-modal", () => page.keyboard.press("Escape"));
    check("Escape closes a plugin dialog with the exit animation, then unmounts it", logExit.closing && logExit.running.includes("evi-modal-out") && logExit.running.includes("evi-scrim-out") && logExit.gone, logExit);
    await page.evaluate(() => (window as any).Evi.plugins.setEnabled("voice-activity-log", false));
}

// A popover: Snippets' picker slides in from its chat bar button, and fades out on a click elsewhere
{
    const opened = await page.evaluate(async () => {
        const w = window as any;
        await w.Evi.plugins.setEnabled("snippets", true);
        const buttons: any[] = [];
        w.Evi.$("snippets").injectButton(buttons, { channel: { id: "1" } });
        const host = document.createElement("div");
        host.id = "evi-test-snip-button";
        host.style.cssText = "position: fixed; right: 24px; bottom: 24px; z-index: 5";
        document.body.append(host);
        w.__snipRoot = w.Evi.api.createRoot(host);
        w.__snipRoot.render(buttons[0]);
        let button: HTMLElement | null = null;
        for (let i = 0; i < 60 && !button; i++) {
            await new Promise(r => requestAnimationFrame(r));
            button = host.querySelector("button, [role=button]");
        }
        button?.click();
        let popover: Element | null = null;
        for (let i = 0; i < 60 && !popover; i++) {
            await new Promise(r => requestAnimationFrame(r));
            popover = document.querySelector(".evi-snip-popover");
        }
        return { button: !!button, popover: !!popover, running: popover?.getAnimations().map(a => (a as CSSAnimation).animationName) ?? [] };
    });
    check("A plugin popover opens with Discord's popout entrance", opened.popover && opened.running.includes("evi-popout-in"), opened);
    await page.waitForTimeout(300);
    await page.screenshot({ path: join(OUT, "plugin-snippets-popover.png") });
    const popExit = await closesWithExit(".evi-snip-popover", () => page.mouse.click(200, 200));
    check("Clicking elsewhere fades the popover out, then removes it", popExit.closing && popExit.running.includes("evi-popout-out") && popExit.gone, popExit);
    await page.evaluate(() => {
        (window as any).__snipRoot?.unmount();
        document.getElementById("evi-test-snip-button")?.remove();
        return (window as any).Evi.plugins.setEnabled("snippets", false);
    });
}

const flux = await page.evaluate(async () => {
    const { Dispatcher } = (window as any).Evi.api;
    let got: unknown = null;
    const handler = (a: any) => void (got = a.value);
    Dispatcher.subscribe("EVI_TEST", handler);
    await Dispatcher.dispatch({ type: "EVI_TEST", value: 7 });
    Dispatcher.unsubscribe("EVI_TEST", handler);
    return got;
});
check("flux subscribe + dispatch", flux === 7);

const patch = await page.evaluate(() => {
    const D = (window as any).Evi;
    const diag = D.diagnosePatches().find((d: any) => d.plugin === "experiments");
    let isDeveloper: unknown;
    try {
        isDeveloper = D.api.getStore("DeveloperExperimentStore").isDeveloper;
    } catch (e) {
        isDeveloper = String(e);
    }
    return { health: diag?.health, modules: diag?.modules, errors: diag?.errors, isDeveloper };
});
check("experiments source patch applied", patch.health === "applied", patch);
check("DeveloperExperimentStore.isDeveloper is true", patch.isDeveloper === true);

// Core fixes to Discord's own rendering: its typing dots in CSS, its Game Mode behind Evi's switch
const discordFixes = await page.evaluate(async () => {
    const D = (window as any).Evi;
    const { api } = D;
    const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
    const health = (find: string) => D.diagnosePatches().find((d: any) => d.plugin === "evi" && d.patch.find === find)?.health;
    const out: Record<string, any> = {};
    try {
        const [dotsId] = api.findModuleIds("dotCycle:2.8}");
        const dots = dotsId ? api.requireModule(dotsId) : undefined;
        out.dotsPatch = health("dotCycle:2.8}");
        const exported = Object.values(dots ?? {}) as any[];
        const fn = (c: any) => api.functionSource(c?.type ?? c);
        const Indicator = exported.find(c => fn(c).includes(".animated.g,"));
        const Circles = exported.find(c => fn(c).includes(".animated.circle,"));
        const host = document.createElement("div");
        host.id = "evi-test-dots";
        host.style.cssText = "position:fixed;left:16px;top:16px;z-index:2147483647;display:flex;gap:16px;padding:12px;background:#313338;color:#dbdee1";
        document.body.append(host);
        const h = api.React.createElement;
        // Discord's indicator as patched, Discord's own circles, and Evi's dots animating
        api.createRoot(host).render([
            h("span", { key: "a", className: "patched" }, h(Indicator, { dotRadius: 3.5, themed: true })),
            h("span", { key: "b", className: "original" }, h("svg", { width: 24.5, height: 7 }, h(Circles, { dotRadius: 3.5 }))),
            h("span", { key: "c", className: "animated" }, h("svg", { width: 24.5, height: 7 }, h(D.typingDots, { dotRadius: 3.5, focused: true }))),
        ]);
        await sleep(600);
        const patched = host.querySelector(".patched svg");
        const box = (el: Element) => {
            const r = el.getBoundingClientRect();
            return [r.left, r.top, r.width].map(n => Math.round(n * 100) / 100);
        };
        out.patchedDots = [...(patched?.querySelectorAll("foreignObject > div") ?? [])].map(box);
        out.patchedCircles = patched?.querySelectorAll("circle").length ?? -1;
        out.originalCircles = [...host.querySelectorAll(".original circle")].map(box);
        out.animations = [...host.querySelectorAll(".animated foreignObject > div")].map(d => d.getAnimations().map(a => (a as CSSAnimation).animationName).join());
        out.color = patched && getComputedStyle(patched.querySelector("foreignObject > div")!).backgroundColor;
        out.svgColor = patched && getComputedStyle(patched).color;
    } catch (err) {
        out.error = String(err);
    }

    for (const id of api.findModuleIds('displayName="GameModeStore"')) api.requireModule(id);
    const store = api.findStore("GameModeStore");
    out.gameModePatch = health('displayName="GameModeStore"');
    out.offEnabled = store?.enabled;
    out.available = D.gameMode.available;
    D.settings.update((s: any) => void (s.gameMode = true));
    out.onEnabled = store?.enabled;
    out.onActive = store?.isActive === store?.hasRunningGame;
    D.settings.update((s: any) => void (s.gameMode = undefined));
    out.offAgain = store?.enabled;
    return out;
});
await page.screenshot({ path: join(OUT, "typing-dots.png"), clip: { x: 0, y: 0, width: 160, height: 60 } });
await page.evaluate(() => document.getElementById("evi-test-dots")?.remove());
check("typing dots: Discord's indicator draws Evi's HTML dots, no circles", !discordFixes.error && discordFixes.dotsPatch === "applied" && discordFixes.patchedDots?.length === 3 && discordFixes.patchedCircles === 0, discordFixes);
// Left edges from the first dot, and widths: within a fraction of a pixel of Discord's circles
const relative = (boxes?: number[][]) => boxes?.flatMap(b => [b[0] - boxes[0][0], b[2]]) ?? [];
const sameBoxes = relative(discordFixes.patchedDots).length === 6 && relative(discordFixes.patchedDots).every((n, i) => Math.abs(n - relative(discordFixes.originalCircles)[i]) < 0.3);
check("typing dots: same places and size as Discord's circles, in the indicator's color", sameBoxes && discordFixes.color === discordFixes.svgColor, { patched: discordFixes.patchedDots, original: discordFixes.originalCircles, color: discordFixes.color, svgColor: discordFixes.svgColor });
check("typing dots: animate with CSS while focused", discordFixes.animations?.length === 3 && discordFixes.animations.every((a: string) => a === "evi-typing-dot"), discordFixes.animations);
check("Game Mode: GameModeStore patched; Evi's switch turns it on and back off", discordFixes.gameModePatch === "applied" && discordFixes.available && discordFixes.offEnabled === false && discordFixes.onEnabled === true && discordFixes.onActive && discordFixes.offAgain === false, discordFixes);

// A stylesheet added the way Discord adds its lazy ones, cleaned before it applies. Served from
// Discord's origin: a blob: sheet's rules can't be read there.
await page.route("https://discord.com/evi-test-css-fixes.css", route => route.fulfill({
    contentType: "text/css",
    body: `
        .t-blur { backdrop-filter: blur(4px); background-color: var(--t-c) !important; }
        .t-blur:hover { background-color: var(--t-h) !important; }
        .t-glass { backdrop-filter: blur(20px); background: var(--t-c); }
        .t-has :not(:has(*)) { outline: 1px solid red; }
        .t-keep > :has(.x), .t-any:has(*), :has(.y) { color: red; }
        @media (min-width: 1px) { :not(:has(*)) { color: blue; } }
    `,
}));
const cssFixes = await page.evaluate(async () => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "/evi-test-css-fixes.css";
    const loaded = new Promise(r => link.addEventListener("load", r));
    document.head.append(link);
    await new Promise(r => setTimeout(r, 0));
    const heldAtFirst = link.media === "not all";
    await loaded;
    await new Promise(r => setTimeout(r, 50));
    const rules = [...link.sheet!.cssRules].map(r => r.cssText.replace(/\s+/g, " "));
    const el = document.createElement("div");
    el.className = "t-blur";
    el.style.cssText = "--t-c: rgba(0, 0, 0, 0.22); --t-h: rgba(0, 0, 0, 0.33)";
    document.body.append(el);
    const computed = { background: getComputedStyle(el).backgroundColor, backdrop: getComputedStyle(el).backdropFilter };
    el.remove();
    link.remove();
    return { heldAtFirst, released: !link.hasAttribute("media"), rules, computed };
});
const ruleText = cssFixes.rules.join("\n");
check("css fixes: a small backdrop blur becomes its tint, near-opaque, its hover state too; big blurs stay", cssFixes.heldAtFirst && cssFixes.released && /^(rgba\(0, 0, 0, 0\.85\)|color\(srgb 0 0 0 \/ 0\.85\))$/.test(cssFixes.computed.background) && cssFixes.computed.backdrop === "none"
    && ruleText.includes(".t-blur:hover { background-color: rgb(from var(--t-h) r g b / max(alpha, 0.85)) !important; }") && ruleText.includes(".t-glass { backdrop-filter: blur(20px)"), cssFixes);
check("css fixes: :has() on any element dropped, anchored ones kept, inside @media too", !ruleText.includes(".t-has") && ruleText.includes(".t-keep > :has(.x), .t-any:has(*) { color: red; }") && !ruleText.includes(":has(.y)") && !ruleText.includes("color: blue"), cssFixes.rules);

const hooks = await page.evaluate(async () => {
    const { api, plugins } = (window as any).Evi;
    // MessageActions may be lazy on the login page, load it the way Discord would
    let actions = api.findByProps("sendMessage", "editMessage");
    if (!actions) {
        const [id] = api.findModuleIds("sendMessage(", "editMessage(");
        if (id) api.requireModule(id);
        actions = api.findByProps("sendMessage", "editMessage");
    }
    if (!actions) return { found: false };

    const hookedByPlugin = api.getUnhooked(actions.sendMessage) !== actions.sendMessage;

    // Instead-hook so nothing hits the network; clear-urls' before-hook still runs first
    let captured: any;
    const unhook = api.hook(actions, "sendMessage", "instead", (ctx: any) => {
        captured = ctx.args[1].content;
        return Promise.resolve();
    }, "test");
    await actions.sendMessage("0", { content: "look https://example.com/a?utm_source=x&id=5&si=abc ok" });
    unhook();

    await plugins.setEnabled("clear-urls", false);
    const restored = api.getUnhooked(actions.sendMessage) === actions.sendMessage;
    await plugins.setEnabled("clear-urls", true);
    const rehooked = api.getUnhooked(actions.sendMessage) !== actions.sendMessage;

    return { found: true, hookedByPlugin, captured, restored, rehooked };
});
check("clear-urls hooked sendMessage", !!hooks.found && !!hooks.hookedByPlugin, hooks);
check("before-hook rewrote the message", hooks.captured === "look https://example.com/a?id=5 ok", hooks.captured);
check("disabling restores the original function", !!hooks.restored);
check("re-enabling hooks again", !!hooks.rehooked);

const hot = await page.evaluate(async () => {
    const { plugins } = (window as any).Evi;
    const test = (window as any).__test;
    const payload = {
        source: "dev",
        manifest: { id: "hot-test", name: "Hot Test", enabledByDefault: true },
        code: `module.exports = { default: { start(ctx) { window.__hotVersion = 1; ctx.onDispose(() => window.__hotDisposed = (window.__hotDisposed || 0) + 1); } } };`,
    };
    test.pluginListeners.forEach((cb: any) => cb({ type: "upsert", plugin: payload }));
    await new Promise(r => setTimeout(r, 50));
    const v1 = (window as any).__hotVersion;

    payload.code = payload.code.replace("__hotVersion = 1", "__hotVersion = 2");
    test.pluginListeners.forEach((cb: any) => cb({ type: "upsert", plugin: payload }));
    await new Promise(r => setTimeout(r, 50));
    const v2 = (window as any).__hotVersion;
    const disposedOnReload = (window as any).__hotDisposed;

    test.pluginListeners.forEach((cb: any) => cb({ type: "remove", id: "hot-test" }));
    return { v1, v2, disposedOnReload, disposedTotal: (window as any).__hotDisposed, stillListed: !!plugins.get("hot-test") };
});
check("hot reload swaps plugin code live", hot.v1 === 1 && hot.v2 === 2, hot);
check("old instance disposed on reload and removal", hot.disposedOnReload === 1 && hot.disposedTotal === 2 && !hot.stillListed);

const live = await page.evaluate(async () => {
    const { plugins, api, wreq } = (window as any).Evi;
    const test = (window as any).__test;
    const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

    // Any loaded module that just exports a URL constant: side-effect free, safe to re-run
    let target: { id: string; key: string; url: string; } | undefined;
    for (const id in wreq.c) {
        const src = Function.prototype.toString.call(wreq.m[id]);
        const m = src.match(/^\d+\(e,t,n\)\{(?:"use strict";)?n\.d\(t,\{(\w+):\(\)=>(\w)\}\);(?:let|var|const) \2="(https:\/\/[\w.\/-]+)"\}$/);
        if (m && api.findModuleIds(`"${m[3]}"`).length === 1) {
            target = { id, key: m[1], url: m[3] };
            break;
        }
    }
    if (!target) return { found: false };

    const exportsObject = wreq.c[target.id].exports;
    const before = exportsObject[target.key];
    const payload = {
        source: "dev",
        manifest: { id: "live-test", name: "Live Test", enabledByDefault: true },
        code: `module.exports = { default: { patches: [{ find: ${JSON.stringify(`"${target.url}"`)}, replace: { match: ${JSON.stringify(target.url)}, with: "https://evi.invalid/live" } }] } };`,
    };

    test.pluginListeners.forEach((cb: any) => cb({ type: "upsert", plugin: payload }));
    await sleep(50);
    const after = exportsObject[target.key];
    const needsReload = plugins.get("live-test").needsReload;
    const sameObject = wreq.c[target.id].exports === exportsObject;

    await plugins.setEnabled("live-test", false);
    const reverted = exportsObject[target.key];
    test.pluginListeners.forEach((cb: any) => cb({ type: "remove", id: "live-test" }));

    // Unsafe module: experiments patches a Flux store, which must not be re-run
    const experiments = plugins.get("experiments");
    return { found: true, target, before, after, reverted, needsReload, sameObject, storeReason: experiments.reloadReason ?? null };
});
check("found a safe loaded module to live-patch", !!live.found, live.target);
check("source patch applied live, no reload", live.after === "https://evi.invalid/live" && live.needsReload === false && !!live.sameObject, live);
check("disabling reverts the module live", live.reverted === live.before);

// The draft store ignores drafts while logged out, so watch what reaches Discord's subscribers
const drafts = await page.evaluate(async () => {
    const { api } = (window as any).Evi;
    const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
    const received: string[] = [];
    const onDraft = (a: any) => received.push(a.draft);
    api.Dispatcher.subscribe("DRAFT_CHANGE", onDraft);
    const change = (draft: string) => api.Dispatcher.dispatch({ type: "DRAFT_CHANGE", channelId: "424242", draftType: 0, draft });

    change("a");
    change("ab");
    change("abc");
    const immediately = [...received];
    await sleep(400);
    const afterPause = [...received];

    change("abcd");
    api.Dispatcher.dispatch({ type: "DRAFT_CLEAR", channelId: "424242", draftType: 0 });
    await sleep(400);
    const afterClear = [...received];

    // Sending clears the box with DRAFT_SAVE "", which must also cancel the pending draft
    change("sent right after typing");
    api.Dispatcher.dispatch({ type: "DRAFT_SAVE", channelId: "424242", draftType: 0, draft: "" });
    await sleep(400);
    const afterSave = [...received];

    // The message you just sent drops the draft that was it; a different pending draft survives
    change("hello there");
    api.Dispatcher.dispatch({ type: "MESSAGE_CREATE", channelId: "424242", message: { channel_id: "424242", content: "hello there" } });
    await sleep(400);
    const afterSend = [...received];
    change("still typing");
    api.Dispatcher.dispatch({ type: "MESSAGE_CREATE", channelId: "424242", message: { channel_id: "424242", content: "someone else's message" } });
    await sleep(400);
    const otherMessage = [...received];

    // A slash command's draft clears everything pending for its channel, whatever the draft type
    change("/giphy cat");
    api.Dispatcher.dispatch({ type: "DRAFT_COMMAND_CLEAR", channelId: "424242", draftType: 1 });
    await sleep(400);
    const afterCommand = [...received];

    // Switching channels writes it right away
    change("half a thought");
    api.Dispatcher.dispatch({ type: "CHANNEL_SELECT", channelId: "999", guildId: null });
    const onSwitch = [...received];
    api.Dispatcher.unsubscribe("DRAFT_CHANGE", onDraft);
    return { immediately, afterPause, afterClear, afterSave, afterSend, otherMessage, afterCommand, onSwitch };
});
check("smooth-typing batches draft updates until a pause", drafts.immediately.length === 0 && JSON.stringify(drafts.afterPause) === '["abc"]', drafts);
check("clearing a draft cancels pending updates (no stale draft after sending)", JSON.stringify(drafts.afterClear) === '["abc"]', drafts.afterClear);
check("saving a draft cancels pending updates (sent message doesn't come back)", JSON.stringify(drafts.afterSave) === '["abc"]', drafts.afterSave);
check("a message you send drops its own pending draft, but not a different one", JSON.stringify(drafts.afterSend) === '["abc"]' && JSON.stringify(drafts.otherMessage) === '["abc","still typing"]', { afterSend: drafts.afterSend, other: drafts.otherMessage });
check("a slash command's clear drops pending drafts of any type in its channel", JSON.stringify(drafts.afterCommand) === '["abc","still typing"]', drafts.afterCommand);
check("switching channels writes a pending draft right away", JSON.stringify(drafts.onSwitch) === '["abc","still typing","half a thought"]', drafts.onSwitch);

// That Evi.plugins hands out no contexts outside this test is checked in test-electron.ts

// Toolkit: toasts, context menus, slash commands

await page.context().grantPermissions(["clipboard-read", "clipboard-write"], { origin: "https://discord.com" });

const toolkit = await page.evaluate(async () => {
    const { api, plugins, toolkit, diagnosePatches } = (window as any).Evi;
    const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
    // Modules the login page may not have run yet: run them the way Discord would
    const load = (filter: any, ...code: string[]) => {
        let found = api.findExport(filter);
        if (!found) {
            for (const id of api.findModuleIds(...code)) api.requireModule(id);
            found = api.findExport(filter);
        }
        return found;
    };
    // Discord shows one toast at a time and queues the rest: dismiss each once seen
    const popToast = api.find(api.filters.byCode("queuedToastsMap.get("));
    const toastText = async (text: string) => {
        for (let i = 0; i < 30; i++) {
            const el = [...document.querySelectorAll('[role="status"]')].find(e => e.textContent?.includes(text));
            if (el) {
                popToast?.();
                return { text: el.textContent, type: el.getAttribute("data-type") };
            }
            await sleep(100);
        }
        return null;
    };

    // Toasts
    const toastModule = load(toolkit.filters.showToast, "(\"showToast\"))return");
    const shown = api.showToast("Evi toast test", { type: "success" });
    const toast = await toastText("Evi toast test");

    // Context menus: Discord's Menu, its item components, and the core navId patch
    const menu = load(toolkit.filters.menu, "Menu API only allows Items");
    const components = toolkit.resolveMenuComponents() ?? {};
    const componentKinds = Object.entries(components).filter(([, v]) => typeof v === "function").map(([k]) => k);
    // A menu module from the main bundle: loading it runs it through the navId patch
    const [menuUserId] = api.findModuleIds('navId:"clean-up-inactive-gdms"');
    if (menuUserId) api.requireModule(menuUserId);
    const navPatch = diagnosePatches().find((d: any) => d.plugin === "evi");
    // The same rewrite over every registered factory with a navId, loaded or not: it must always compile
    const rewrite = { modules: 0, injected: 0, compileErrors: [] as string[], sample: "", menuDestructuringKept: false };
    for (const id in (window as any).Evi.wreq.m) {
        const src = api.functionSource(api.getWreq().m[id]);
        if (!src.includes("navId:")) continue;
        rewrite.modules++;
        const code = src.replace(/^(?:[\w$]+|"(?:[^"\\]|\\.)*")(?=\s*\()/, "function");
        const next = toolkit.rewriteMenuArgs(code);
        if (next === code) continue;
        rewrite.injected += next.split("eviMenuArgs:arguments[0],navId:").length - 1;
        try {
            (0, eval)(`0,${next}`);
        } catch (err) {
            rewrite.compileErrors.push(`${id}: ${err}`);
        }
        if (id === menuUserId) rewrite.sample = next.match(/.{30}eviMenuArgs.{50}/)?.[0] ?? "";
        if (id === menu?.id) rewrite.menuDestructuringKept = next.includes("let{navId:t,variant:");
    }

    // Slash commands: Discord's built-in command list
    const builtIns = load(toolkit.filters.builtInCommands, '"tableflip"', '"unflip"');
    const listBefore = builtIns?.value([1], true, false).map((c: any) => c.untranslatedName) ?? [];

    await plugins.setEnabled("toolkit-demo", true);
    const running = !!plugins.get("toolkit-demo")?.running;
    const menuHooked = !!menu && api.getUnhooked(menu.exports[menu.key]) !== menu.exports[menu.key];
    const commandsHooked = !!builtIns && api.getUnhooked(builtIns.exports[builtIns.key]) !== builtIns.exports[builtIns.key];

    const list = builtIns?.exports[builtIns.key]([1], true, false) ?? [];
    const command = list.find((c: any) => c.untranslatedName === "evi");
    const shrug = list.find((c: any) => c.untranslatedName === "shrug");
    const nick = list.find((c: any) => c.untranslatedName === "nick");
    // Replies go through Discord's sendBotMessage ("Only you can see this"): capture them
    const botActions = api.findByProps("sendBotMessage", "sendMessage");
    const replies: [string, string][] = [];
    const unhookBot = botActions && api.hook(botActions, "sendBotMessage", "instead", (c: any) => void replies.push([c.args[0], c.args[1]]), "test");
    (window as any).__botReplies = replies;
    // Discord runs it as execute(options, context)
    const result = await command?.execute([{ name: "text", type: 3, value: "Command reply test" }], { channel: { id: "1" } });
    const commandToast = replies.find(r => r[1] === "Command reply test") ?? null;
    unhookBot?.();

    // Render Discord's real Menu with the context a message menu gets from the navId patch
    const root = document.createElement("div");
    document.body.appendChild(root);
    const reactRoot = api.createRoot(root);
    const Menu = menu?.exports[menu.key];
    let rendered: string[] = [];
    let copied: string | null = null;
    let copyToast = null;
    let renderError: string | null = null;
    try {
        reactRoot.render(api.React.createElement(Menu, {
            navId: "message",
            onClose: () => { },
            "aria-label": "test",
            eviMenuArgs: { message: { id: "123456789" } },
        }, api.React.createElement(components.Item, { id: "native-item", label: "Native item", action: () => { } })));
        await sleep(300);
        rendered = [...root.querySelectorAll('[role="menuitem"]')].map(e => e.textContent ?? "");
        const item = [...root.querySelectorAll('[role="menuitem"]')].find(e => e.textContent?.includes("Copy Message ID")) as HTMLElement | undefined;
        item?.click();
        copyToast = await toastText("Message ID");
        copied = await navigator.clipboard.readText().catch(e => `clipboard: ${e}`);
    } catch (err) {
        renderError = String(err);
    }
    reactRoot.unmount();
    root.remove();

    await plugins.setEnabled("toolkit-demo", false);
    const listAfter = builtIns?.exports[builtIns.key]([1], true, false).map((c: any) => c.untranslatedName) ?? [];
    const menuRestored = !!menu && api.getUnhooked(menu.exports[menu.key]) === menu.exports[menu.key];
    const commandsRestored = !!builtIns && api.getUnhooked(builtIns.exports[builtIns.key]) === builtIns.exports[builtIns.key];

    return {
        toastModule: toastModule && { id: toastModule.id, key: toastModule.key }, shown, toast,
        menu: menu && { id: menu.id, key: menu.key }, componentKinds,
        navPatch: navPatch && { health: navPatch.health, modules: navPatch.modules, errors: navPatch.errors.slice(0, 3), menuUserId },
        rewrite,
        builtIns: builtIns && { id: builtIns.id, key: builtIns.key }, listBefore,
        running, menuHooked, commandsHooked,
        command: command && { id: command.id, inputType: command.inputType, applicationId: command.applicationId, options: command.options?.length },
        shrug: shrug && { inputType: shrug.inputType, applicationId: shrug.applicationId },
        nick: nick && { inputType: nick.inputType, applicationId: nick.applicationId },
        result: result ?? null, commandToast,
        rendered, copyToast, copied, renderError,
        listAfter, menuRestored, commandsRestored,
    };
});
check("toast module found", !!toolkit.toastModule, toolkit.toastModule);
check("toast renders with Discord's toast UI", !!toolkit.shown && toolkit.toast?.type === "success", toolkit.toast);
check("Menu component found", !!toolkit.menu, toolkit.menu);
check("Menu item components resolved", ["Item", "Group", "Separator", "CheckboxItem", "RadioItem", "ControlItem"].every(k => toolkit.componentKinds.includes(k)), toolkit.componentKinds);
check("navId source patch applied, no errors", toolkit.navPatch?.health === "applied" && !!toolkit.navPatch.menuUserId && toolkit.navPatch.modules.includes(toolkit.navPatch.menuUserId) && !toolkit.navPatch.errors.length, toolkit.navPatch);
check("navId rewrite hands menus their props and compiles on every navId module", toolkit.rewrite.modules >= 5 && !toolkit.rewrite.compileErrors.length && toolkit.rewrite.sample.includes('eviMenuArgs:arguments[0],navId:"clean-up-inactive-gdms"') && toolkit.rewrite.menuDestructuringKept, toolkit.rewrite);
check("built-in commands module found", !!toolkit.builtIns && toolkit.listBefore.includes("shrug") && !toolkit.listBefore.includes("evi"), toolkit.builtIns);
check("toolkit-demo started, Menu and command list hooked", toolkit.running && toolkit.menuHooked && toolkit.commandsHooked);
check("/evi listed as a non-text built-in like /nick (Discord never sends its result)", !!toolkit.command && toolkit.command.inputType === toolkit.nick?.inputType && toolkit.command.applicationId === toolkit.nick?.applicationId && toolkit.command.inputType !== toolkit.shrug?.inputType, { command: toolkit.command, nick: toolkit.nick, shrug: toolkit.shrug });
check("/evi replies ephemerally (Only you can see this), returns nothing for Discord to send", toolkit.result == null && JSON.stringify(toolkit.commandToast) === '["1","Command reply test"]', toolkit.commandToast);
check("message menu shows the plugin's item next to Discord's", toolkit.rendered.includes("Native item") && toolkit.rendered.some((t: string) => t.includes("Copy Message ID (Evi)")), toolkit.renderError ?? toolkit.rendered);
check("menu item gets the message from menu props and copies its id", toolkit.copied === "123456789" && toolkit.copyToast?.type === "success", { copied: toolkit.copied, toast: toolkit.copyToast });
// The shared hook comes off with the last command; Evi's own /badge (an admin install) keeps it on here
check("stopping the plugin removes its command, and the command hook with the last one", !toolkit.listAfter.includes("evi") && toolkit.commandsRestored === !toolkit.listAfter.some((n: string) => n === "badge"));
check("the shared Menu hook stays while another plugin still uses menus", !toolkit.menuRestored);
await page.screenshot({ path: join(OUT, "toolkit-toast.png") });

// Helpers for the plugin suites below, in the page
await page.evaluate(() => {
    const { api } = (window as any).Evi;
    const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
    const popToast = api.find(api.filters.byCode("queuedToastsMap.get("));
    (window as any).__qa = {
        sleep,
        // Discord shows one toast at a time and queues the rest: dismiss each once seen
        toastText: async (text: string) => {
            for (let i = 0; i < 30; i++) {
                const el = [...document.querySelectorAll('[role="status"]')].find(e => e.textContent?.includes(text));
                if (el) {
                    popToast?.();
                    return { text: el.textContent, type: el.getAttribute("data-type") };
                }
                await sleep(100);
            }
            return null;
        },
        load: (filter: any, ...code: string[]) => {
            let found = api.findExport(filter);
            if (!found) {
                for (const id of api.findModuleIds(...code)) api.requireModule(id);
                found = api.findExport(filter);
            }
            return found;
        },
    };
});

const silent = await page.evaluate(async () => {
    const { api, plugins, toolkit, diagnosePatches, wreq } = (window as any).Evi;
    const { sleep, toastText, load } = (window as any).__qa;

    // Discord's typing actions: startTyping dispatches TYPING_START_LOCAL, whose store handler sends the request.
    // Since October 2026 they're in the chat's lazy chunks: load the ones the "Channel" route declares
    const route = /createPromise:\(\)=>Promise\.all\(\[((?:\w\.e\("\d+"\),?)+)\]\)\.then\(\w\.bind\(\w,(\d+)\)\),webpackId:\d+,name:"Channel"[,}]/;
    for (const id of api.findModuleIds('name:"Channel"')) {
        const m = api.functionSource(wreq.m[id]).match(route);
        if (!m) continue;
        await Promise.all([...m[1].matchAll(/"(\d+)"/g)].map((x: RegExpMatchArray) => wreq.e(x[1]).catch(() => { })));
        break;
    }
    const typing = load(api.filters.byProps("startTyping", "stopTyping"), "TYPING_START_LOCAL", "startTyping(");
    const actions = typing?.value;
    const dispatched: string[] = [];
    const onStart = (a: any) => void dispatched.push(`start:${a.channelId}`);
    const onStop = (a: any) => void dispatched.push(`stop:${a.channelId}`);
    api.Dispatcher.subscribe("TYPING_START_LOCAL", onStart);
    api.Dispatcher.subscribe("TYPING_STOP_LOCAL", onStop);

    const untouchedBefore = !!actions && api.getUnhooked(actions.startTyping) === actions.startTyping;
    actions?.startTyping("100");
    const sentBefore = dispatched.includes("start:100");

    await plugins.setEnabled("silent-typing", true);
    const state = plugins.get("silent-typing");
    const running = !!state?.running;
    const hooked = !!actions && api.getUnhooked(actions.startTyping) !== actions.startTyping;
    actions?.startTyping("101");
    actions?.stopTyping("101");
    const blocked = !dispatched.includes("start:101");
    const stopStillSent = dispatched.includes("stop:101");

    // The "Enabled" setting lets typing through without stopping the plugin
    state?.ctx.settings.set("enabled", false);
    actions?.startTyping("102");
    const sentWhenSettingOff = dispatched.includes("start:102");
    state?.ctx.settings.set("enabled", true);

    // /silenttyping toggles the setting and says so
    const builtIns = api.findExport(toolkit.filters.builtInCommands);
    const command = builtIns?.exports[builtIns.key]([1], true, false).find((c: any) => c.untranslatedName === "silenttyping");
    const botActions = api.findByProps("sendBotMessage", "sendMessage");
    const replies: [string, string][] = [];
    const unhookBot = botActions && api.hook(botActions, "sendBotMessage", "instead", (c: any) => void replies.push([c.args[0], c.args[1]]), "test");
    await command?.execute([], { channel: { id: "1" } });
    const afterCommand = state?.ctx.settings.get("enabled");
    await command?.execute([], { channel: { id: "1" } });
    const afterSecondCommand = state?.ctx.settings.get("enabled");
    unhookBot?.();
    const commandToast = replies[0]?.[1] ?? null;
    const commandToastOn = replies[1]?.[1] ?? null;

    // Chat bar button: the source patch lands in ChannelTextAreaButtons once that module runs
    const [buttonsModule] = api.findModuleIds('"ChannelTextAreaButtons"');
    let requireError: string | null = null;
    try {
        if (buttonsModule) api.requireModule(buttonsModule);
    } catch (err) {
        requireError = String(err);
    }
    const diag = diagnosePatches().find((d: any) => d.plugin === "silent-typing");
    const self = (window as any).Evi.$("silent-typing");
    const buttons: any[] = [{ key: "emoji" }, { key: "submit" }];
    self?.injectButton(buttons, { channel: { id: "1" } });
    const injectedKeys = buttons.map(b => b?.key);

    // The button itself, with Discord's chat bar button component
    const root = document.createElement("div");
    document.body.appendChild(root);
    const reactRoot = api.createRoot(root);
    reactRoot.render(api.React.createElement(self.SilentTypingButton));
    await sleep(200);
    const button = root.querySelector('[aria-label^="Silent typing"]') as HTMLElement | null;
    const labelOn = button?.getAttribute("aria-label") ?? null;
    const discordButton = !!button && !button.classList.contains("dl-silent-typing-fallback");
    const wrapperClass = root.firstElementChild?.className ?? "";
    button?.click();
    await sleep(200);
    const labelOff = root.querySelector('[aria-label^="Silent typing"]')?.getAttribute("aria-label") ?? null;
    const settingAfterClick = state?.ctx.settings.get("enabled");
    await toastText("Silent typing");
    reactRoot.unmount();
    root.remove();

    await plugins.setEnabled("silent-typing", false);
    const restored = !!actions && api.getUnhooked(actions.startTyping) === actions.startTyping;
    actions?.startTyping("103");
    const sentAfterDisable = dispatched.includes("start:103");
    const commandRemoved = !builtIns?.exports[builtIns.key]([1], true, false).some((c: any) => c.untranslatedName === "silenttyping");
    api.Dispatcher.unsubscribe("TYPING_START_LOCAL", onStart);
    api.Dispatcher.unsubscribe("TYPING_STOP_LOCAL", onStop);

    return {
        typing: typing && { id: typing.id, key: typing.key }, untouchedBefore, sentBefore,
        running, hooked, blocked, stopStillSent, sentWhenSettingOff,
        command: !!command, afterCommand, afterSecondCommand, commandToast, commandToastOn,
        buttonsModule, requireError, patch: diag && { health: diag.health, modules: diag.modules, errors: diag.errors.slice(0, 2) }, injectedKeys,
        labelOn, labelOff, discordButton, wrapperClass, settingAfterClick,
        restored, sentAfterDisable, commandRemoved,
    };
});
check("silent-typing: Discord's typing actions found", !!silent.typing && silent.untouchedBefore && silent.sentBefore, silent.typing);
check("silent-typing: startTyping hooked and blocked while enabled, stopTyping untouched", silent.running && silent.hooked && silent.blocked && silent.stopStillSent);
check("silent-typing: the Enabled setting lets typing through when off", silent.sentWhenSettingOff);
check("silent-typing: /silenttyping toggles it and replies only to you", silent.command && silent.afterCommand === false && silent.afterSecondCommand === true && /off/.test(silent.commandToast ?? "") && /on/.test(silent.commandToastOn ?? ""), { after: [silent.afterCommand, silent.afterSecondCommand], replies: [silent.commandToast, silent.commandToastOn] });
check("silent-typing: chat bar patch applied to ChannelTextAreaButtons", !silent.requireError && silent.patch?.health === "applied" && silent.patch.modules.includes(silent.buttonsModule), { patch: silent.patch, module: silent.buttonsModule, error: silent.requireError });
check("silent-typing: button goes before the send button", JSON.stringify(silent.injectedKeys) === '["emoji","evi-silent-typing","submit"]', silent.injectedKeys);
check("silent-typing: button renders with Discord's chat button and toggles", silent.discordButton && silent.wrapperClass.startsWith("buttonContainer_") && /on/.test(silent.labelOn ?? "") && /off/.test(silent.labelOff ?? "") && silent.settingAfterClick === false, { on: silent.labelOn, off: silent.labelOff, wrapper: silent.wrapperClass });
check("silent-typing: disabling restores startTyping and removes the command", silent.restored && silent.sentAfterDisable && silent.commandRemoved);

// Lookups: a waitFor / hookExport target that never shows up is reported, not silent

const lookups = await page.evaluate(async () => {
    const { api, plugins, diagnoseLookups } = (window as any).Evi;
    const later = () => performance.now() + 60_000;

    await plugins.setEnabled("silent-typing", true);
    const ctx = plugins.get("silent-typing")?.ctx;
    // Its startTyping hook: the typing actions module ran in the silent-typing checks above
    const hook = diagnoseLookups("silent-typing").find((d: any) => d.target.startsWith("props startTyping"));

    // What a Discord update does to a lookup: its code or props are gone
    ctx?.waitFor(api.filters.byCode("evi-lookup-test-never-in-discord"), () => { });
    ctx?.hookExport("after", api.filters.byProps("eviLookupTestNeverInDiscord"), "go", () => { });
    const health = (at?: number) => Object.fromEntries(diagnoseLookups("silent-typing", at).map((d: any) => [d.target, d.health]));
    const early = health();
    const afterGrace = health(later());

    await plugins.setEnabled("silent-typing", false);
    const afterStop = diagnoseLookups("silent-typing").length;
    return { hook: hook && { target: hook.target, health: hook.health }, early, afterGrace, afterStop };
});
const codeTarget = 'code "evi-lookup-test-never-in-discord"';
const propsTarget = "props eviLookupTestNeverInDiscord, method go";
check("lookups: a hookExport target that exists is found", lookups.hook?.health === "found" && lookups.hook.target === "props startTyping, stopTyping, method startTyping", lookups.hook);
check("lookups: an unfound target counts as waiting while Discord starts", lookups.early[codeTarget] === "waiting" && lookups.early[propsTarget] === "waiting", lookups.early);
check("lookups: after that, code no module has is broken and unknown props are missing", lookups.afterGrace[codeTarget] === "broken" && lookups.afterGrace[propsTarget] === "missing", lookups.afterGrace);
check("lookups: stopping the plugin drops its lookups", lookups.afterStop === 0, lookups.afterStop);

// Logged out, MessageStore still works for a channel we "load" ourselves: dispatch Discord's own
// actions for a fake channel and check what the plugin and the store make of them
const logger = await page.evaluate(async () => {
    const { api, plugins, wreq, diagnosePatches } = (window as any).Evi;
    const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
    const { Dispatcher } = api;
    const store = api.getStore("MessageStore");
    const handlersOf = () => (Dispatcher._actionHandlers._nodes?.get(store.getDispatchToken()) ?? Dispatcher._actionHandlers._dependencyGraph.getNodeData(store.getDispatchToken())).actionHandler;
    const handlers = handlersOf();
    const originals = { del: handlers.MESSAGE_DELETE, bulk: handlers.MESSAGE_DELETE_BULK, update: handlers.MESSAGE_UPDATE };

    // The accessories renderer and Discord's content renderer live in lazy chunks: load chunks until
    // both are registered, then run them the way opening a chat would: Discord's lazy "Channel"
    // route component declares the chunks it needs next to its name
    const wanted = [["channelMessageProps:{message:", "isAutomodBlockedMessage:"], ['"useMessageRenderedContent"', "hideSimpleEmbedContent"]];
    const route = /createPromise:\(\)=>Promise\.all\(\[((?:\w\.e\("\d+"\),?)+)\]\)\.then\(\w\.bind\(\w,(\d+)\)\),webpackId:\d+,name:"Channel"[,}]/;
    let chunkIds: string[] = [];
    let channelModule: string | undefined;
    for (const id of api.findModuleIds('name:"Channel"')) {
        const m = api.functionSource(wreq.m[id]).match(route);
        if (m) {
            chunkIds = [...m[1].matchAll(/"(\d+)"/g)].map((x: RegExpMatchArray) => x[1]);
            channelModule = m[2];
            break;
        }
    }
    const loadStart = performance.now();
    let chunksLoaded = 0;
    await Promise.all(chunkIds.map(id => wreq.e(id).then(() => chunksLoaded++, () => { })));
    const loadMs = Math.round(performance.now() - loadStart);
    const moduleIds = wanted.map(code => api.findModuleIds(...code)[0]);
    const requireErrors: string[] = [];
    for (const id of moduleIds) {
        try {
            if (id) api.requireModule(id);
        } catch (err) {
            requireErrors.push(String(err).slice(0, 200));
        }
    }
    const accessories = moduleIds[0] && api.findExport(api.filters.byCode(...wanted[0]));

    await plugins.setEnabled("message-logger", true);
    const state = plugins.get("message-logger");
    const log = state.definition.getLog();
    const running = !!state.running && !!log;
    const hooked = {
        del: api.getUnhooked(handlers.MESSAGE_DELETE) !== handlers.MESSAGE_DELETE,
        bulk: api.getUnhooked(handlers.MESSAGE_DELETE_BULK) !== handlers.MESSAGE_DELETE_BULK,
        update: api.getUnhooked(handlers.MESSAGE_UPDATE) !== handlers.MESSAGE_UPDATE,
        accessories: !!accessories && api.getUnhooked(accessories.exports[accessories.key]) !== accessories.exports[accessories.key],
    };

    const channelId = "777000000000000001";
    const raw = (id: string, content: string) => ({
        id, channel_id: channelId, author: { id: "555", username: "someone", discriminator: "0", avatar: null }, content,
        timestamp: new Date(Date.UTC(2026, 0, 1, 12, Number(id.slice(-2)))).toISOString(),
        edited_timestamp: null, type: 0, flags: 0, attachments: [], embeds: [], mentions: [], mention_roles: [], pinned: false, tts: false,
    });
    const ids = Array.from({ length: 15 }, (_, i) => `88800000000000${i + 10}`);
    await Dispatcher.dispatch({
        type: "LOAD_MESSAGES_SUCCESS", channelId, messages: ids.map(id => raw(id, `message ${id}`)).reverse(),
        isBefore: false, isAfter: false, hasMoreBefore: false, hasMoreAfter: false, isStale: false,
    });
    const loaded = ids.filter(id => store.getMessage(channelId, id)).length;
    const [a, b, c, d] = ids;
    const e = ids[14];

    // Other stores must still see deletes: only MessageStore keeps the message
    const seenBySubscribers: string[] = [];
    const onDelete = (x: any) => seenBySubscribers.push(x.id);
    Dispatcher.subscribe("MESSAGE_DELETE", onDelete);

    // Edit twice, then delete the same message
    await Dispatcher.dispatch({ type: "MESSAGE_UPDATE", message: { id: a, channel_id: channelId, content: "edited **once**", edited_timestamp: new Date().toISOString() } });
    await Dispatcher.dispatch({ type: "MESSAGE_UPDATE", message: { id: a, channel_id: channelId, content: "edited twice", edited_timestamp: new Date().toISOString() } });
    // An embed-only update is not an edit
    await Dispatcher.dispatch({ type: "MESSAGE_UPDATE", message: { id: a, channel_id: channelId, embeds: [] } });
    const edits = log.get(channelId, a)?.edits.map((x: any) => x.content);
    const storeContent = store.getMessage(channelId, a)?.content;

    await Dispatcher.dispatch({ type: "MESSAGE_DELETE", id: a, channelId });
    const keptA = { inStore: !!store.getMessage(channelId, a), deleted: log.isDeleted(channelId, a) };

    // Marked by element ids too, however Discord renders the row: red text, tint and a label
    const row = document.createElement("li");
    row.id = `chat-messages-${channelId}-${a}`;
    row.innerHTML = `<div id="message-content-${a}">gone</div>`;
    document.body.appendChild(row);
    await sleep(50);
    const content = row.firstElementChild as HTMLElement;
    const marked = {
        color: getComputedStyle(content).color,
        rowShadow: getComputedStyle(row).boxShadow,
        label: getComputedStyle(content, "::after").content,
        labelWithTag: "",
    };
    row.insertAdjacentHTML("beforeend", `<span class="dl-ml-deleted">Deleted</span>`);
    marked.labelWithTag = getComputedStyle(content, "::after").content;
    row.remove();

    // Local deletes (ephemeral dismissals, failed sends) always go through
    await Dispatcher.dispatch({ type: "MESSAGE_DELETE", id: b, channelId, local: true });
    const localB = !!store.getMessage(channelId, b);

    // Bulk: the known one is kept, an unknown id passes through untouched
    await Dispatcher.dispatch({ type: "MESSAGE_DELETE_BULK", ids: [c, "1"], channelId });
    const keptC = !!store.getMessage(channelId, c) && log.isDeleted(channelId, c);

    // A delete you start yourself vanishes as usual ("Ignore my own deletes" is on by default).
    // The test's instead-hook keeps the request off the network; the plugin's before-hook still runs.
    let actions = api.findByProps("deleteMessage", "editMessage", "sendMessage");
    if (!actions) {
        for (const id of api.findModuleIds("sendMessage(", "editMessage(")) api.requireModule(id);
        actions = api.findByProps("deleteMessage", "editMessage", "sendMessage");
    }
    const unhookDelete = actions && api.hook(actions, "deleteMessage", "instead", () => Promise.resolve(), "test");
    await actions?.deleteMessage(channelId, d);
    unhookDelete?.();
    await Dispatcher.dispatch({ type: "MESSAGE_DELETE", id: d, channelId });
    const selfD = { inStore: !!store.getMessage(channelId, d), logged: !!log.get(channelId, d) };
    Dispatcher.unsubscribe("MESSAGE_DELETE", onDelete);

    // Pictures: a deleted message keeps a saved copy (Discord's CDN deletes the original), and an edit
    // that removes one keeps it with the old version. Discord's default avatar stands in: it's public.
    const picture = (id: string) => ({ id, filename: `${id}.png`, url: "https://cdn.discordapp.com/embed/avatars/0.png", proxy_url: "https://cdn.discordapp.com/embed/avatars/0.png", size: 4096, content_type: "image/png", width: 128, height: 128 });
    const withPicture = "888000000000000040", editedPicture = "888000000000000041";
    await Dispatcher.dispatch({ type: "MESSAGE_CREATE", channelId, message: { ...raw(withPicture, "look"), attachments: [picture("990001")] } });
    await Dispatcher.dispatch({ type: "MESSAGE_CREATE", channelId, message: { ...raw(editedPicture, "two pictures"), attachments: [picture("990002"), picture("990003")] } });
    await Dispatcher.dispatch({ type: "MESSAGE_DELETE", id: withPicture, channelId });
    await Dispatcher.dispatch({ type: "MESSAGE_UPDATE", message: { id: editedPicture, channel_id: channelId, content: "two pictures", attachments: [picture("990003")], edited_timestamp: new Date().toISOString() } });
    for (let i = 0; i < 30 && !(log.get(channelId, withPicture)?.media?.length && log.get(channelId, editedPicture)?.edits[0]?.media?.length); i++) await new Promise(r => setTimeout(r, 100));
    const media = {
        inStore: !!store.getMessage(channelId, withPicture),
        deleted: (log.get(channelId, withPicture)?.media ?? []).map((m: any) => ({ kind: m.kind, name: m.name, blob: m.url.startsWith("blob:"), size: m.size })),
        edited: (log.get(channelId, editedPicture)?.edits[0]?.media ?? []).map((m: any) => m.name),
    };

    // Render what the accessories hook adds, inside a chat row like Discord's
    const host = document.createElement("ul");
    host.innerHTML = `<li data-list-item-id="chat-messages___chat-messages-${channelId}-${a}" id="chat-messages-${channelId}-${a}"></li>`;
    document.body.appendChild(host);
    const root = api.createRoot(host.firstElementChild);
    const render: Record<string, any> = { error: null };
    try {
        const hookedFn = accessories?.exports[accessories.key];
        const message = store.getMessage(channelId, a);
        const result = hookedFn?.({ channelMessageProps: { message, channel: { id: channelId } }, hasSpoilerEmbeds: false, hasBailedAst: false, isInteracting: false });
        const snapshot = hookedFn?.({ channelMessageProps: { message, channel: { id: channelId } }, isMessageSnapshot: true });
        const ours = result?.props?.children?.[1];
        render.appended = !!ours && result.props.children.length === 2;
        render.snapshotUntouched = !Array.isArray(snapshot?.props?.children);
        if (ours) root.render(ours);
        await sleep(300);
        const li = host.firstElementChild as HTMLElement;
        const tag = li.querySelector(".dl-ml-deleted");
        render.text = li.textContent;
        render.bold = li.querySelector(".dl-ml-version strong")?.textContent ?? null;
        render.markup = li.querySelector(".dl-ml-content")?.className ?? null;
        render.tagColor = tag && getComputedStyle(tag).color;
        render.rowBackground = getComputedStyle(li).backgroundColor;
        render.rowShadow = getComputedStyle(li).boxShadow;
    } catch (err) {
        render.error = String(err);
    }

    // Caps: 10 per channel. Deleting 10 more evicts the oldest deleted ones, which then really go
    state.ctx.settings.set("limit", 10);
    await sleep(50);
    const rest = ids.slice(4, 14);
    await Dispatcher.dispatch({ type: "MESSAGE_DELETE_BULK", ids: rest, channelId });
    await sleep(50);
    const caps = {
        logged: log.counts(),
        evictedGoneFromStore: [a, c].map(id => !store.getMessage(channelId, id)),
        newestKept: rest.every(id => !!store.getMessage(channelId, id) && log.isDeleted(channelId, id)),
    };
    state.ctx.settings.set("limit", 50);
    // One more edit so disabling has history to hide too
    await Dispatcher.dispatch({ type: "MESSAGE_UPDATE", message: { id: rest[0], channel_id: channelId, content: "changed" } });
    // The first message was evicted by the cap: show a surviving one in the row instead
    const surviving = accessories?.exports[accessories.key]({ channelMessageProps: { message: store.getMessage(channelId, rest[0]), channel: { id: channelId } } });
    if (surviving) root.render(surviving.props.children[1]);
    await sleep(100);
    const beforeStop = {
        counts: log.counts(),
        rendered: !!host.querySelector(".dl-ml-deleted") && !!host.querySelector(".dl-ml-history"),
        rowBackground: getComputedStyle(host.firstElementChild!).backgroundColor,
    };

    // A kept (deleted) message, to render once the plugin is off
    const keptMessage = store.getMessage(channelId, rest[0]);
    await plugins.setEnabled("message-logger", false);
    await sleep(100);
    const handlersNow = handlersOf();
    // Evi's own share card hooks the same renderer for good (since 1.1.2), so it stays hooked:
    // what matters is that nothing of the logger's comes out of it any more
    // (Looked for in the elements, not rendered: Discord's own accessories need a real channel)
    const hasLogView = (el: any): boolean => !!el && typeof el === "object"
        && (!!(el.props?.log && el.props?.message) || [el.props?.children].flat().some(hasLogView));
    const afterStop = accessories?.exports[accessories.key]({ channelMessageProps: { message: keptMessage, channel: { id: channelId } } });
    const accessoriesClean = !!accessories && hasLogView(surviving) && !hasLogView(afterStop);
    const stopped = {
        keptGone: rest.every(id => !store.getMessage(channelId, id)),
        unhooked: handlersNow.MESSAGE_DELETE === originals.del && handlersNow.MESSAGE_DELETE_BULK === originals.bulk && handlersNow.MESSAGE_UPDATE === originals.update,
        purgeHandlerRemoved: !Object.keys(handlersNow).some(k => k.startsWith("EVI_")),
        accessoriesClean,
        logCleared: log.counts(),
        renderedGone: !host.querySelector(".dl-ml"),
        rowBackground: getComputedStyle(host.firstElementChild!).backgroundColor,
        style: !!document.getElementById("evi-plugin-message-logger"),
    };
    // With the plugin off, a delete removes the message like stock Discord
    await Dispatcher.dispatch({ type: "MESSAGE_DELETE", id: e, channelId });
    const stockDelete = !store.getMessage(channelId, e);
    root.unmount();
    host.remove();

    return {
        chunks: { total: chunkIds.length, loaded: chunksLoaded, loadMs, channelModule, moduleIds, requireErrors },
        running, hooked, loaded, first: a, edits, storeContent, keptA, marked, localB, keptC, seenBySubscribers, selfD, media, render, caps, beforeStop, stopped, stockDelete,
        patches: diagnosePatches().filter((p: any) => p.plugin === "message-logger").length,
    };
});
check("message-logger: loaded the lazy accessories and content renderers", logger.chunks.moduleIds.every(Boolean) && !logger.chunks.requireErrors.length, logger.chunks);
check("message-logger: hooks MessageStore's delete/update handlers and the accessories renderer", logger.running && Object.values(logger.hooked).every(Boolean), logger.hooked);
check("message-logger: no source patches to break", logger.patches === 0);
check("MessageStore accepts a synthetic channel logged out", logger.loaded === 15, logger.loaded);
check("edits record previous versions, embed-only updates don't", JSON.stringify(logger.edits) === JSON.stringify([`message ${logger.first}`, "edited **once**"]) && logger.storeContent === "edited twice", { edits: logger.edits, store: logger.storeContent });
check("a deleted message stays in MessageStore, marked deleted", logger.keptA.inStore && logger.keptA.deleted, logger.keptA);
check("a deleted message's row is marked by id: red text, tint, a label unless the tag is there", /^(rgb\(2\d\d, |oklab\([\d.]+ 0\.[1-9])/.test(logger.marked.color) && logger.marked.rowShadow !== "none"
    && /deleted/i.test(logger.marked.label) && logger.marked.labelWithTag === "none", logger.marked);
check("other stores and subscribers still get MESSAGE_DELETE", logger.seenBySubscribers.includes(logger.first), logger.seenBySubscribers);
check("local deletes pass through", !logger.localB);
check("bulk deletes are kept per message", logger.keptC);
check("a delete you started yourself isn't kept (Ignore my own deletes)", !logger.selfD.inStore && !logger.selfD.logged, logger.selfD);
check("message-logger: a deleted message keeps a saved copy of its picture, and an edit keeps the picture it removed",
    logger.media.inStore && logger.media.deleted.length === 1 && logger.media.deleted[0].kind === "image" && logger.media.deleted[0].blob && logger.media.deleted[0].size > 0
    && JSON.stringify(logger.media.edited) === '["990002.png"]', logger.media);
check("accessories hook appends the log view, leaves forwarded snapshots alone", !!logger.render.appended && !!logger.render.snapshotUntouched && !logger.render.error, logger.render.error ?? undefined);
check("deleted message renders its tag, row tint and edit history", /Edited from/.test(logger.render.text ?? "") && /Deleted/.test(logger.render.text ?? "")
    && logger.render.rowBackground !== "rgba(0, 0, 0, 0)" && logger.render.rowShadow !== "none", logger.render);
check("old versions go through Discord's markdown renderer and markup class", logger.render.bold === "once" && /markup_/.test(logger.render.markup ?? ""), { bold: logger.render.bold, markup: logger.render.markup });
check("per-channel cap evicts the oldest, evicted deleted messages really go", logger.caps.logged.deleted === 10 && logger.caps.evictedGoneFromStore.every(Boolean) && logger.caps.newestKept, logger.caps);
check("disabling deletes kept messages for real and restores MessageStore's handlers", logger.stopped.keptGone && logger.stopped.unhooked && logger.stopped.purgeHandlerRemoved && logger.stopped.accessoriesClean, logger.stopped);
check("disabling clears the log, unmounts tags and history, removes the tint", logger.beforeStop.rendered && logger.beforeStop.rowBackground !== "rgba(0, 0, 0, 0)" && logger.stopped.renderedGone && logger.stopped.logCleared.deleted + logger.stopped.logCleared.edited === 0
    && logger.stopped.rowBackground === "rgba(0, 0, 0, 0)" && !logger.stopped.style, { before: logger.beforeStop, after: logger.stopped });
check("with the plugin off, deletes behave like stock Discord", logger.stockDelete);

// The core (not a plugin) hooks Discord's profile-badges hook, and leaves the message username alone
// (badges are on profiles only). Where the logged-out page has them loaded, the real ones are used; otherwise stand-ins with the same shape
// (and the code the filters look for) are registered as webpack modules. Discord's own body is swapped
// out for the call with an "instead" hook (it uses React hooks), so our hooks run around it as in the app.
const badges = await page.evaluate(async () => {
    const D = (window as any).Evi;
    const { api } = D;
    const wreq = api.getWreq();
    const profileFilter = api.filters.byCode("getBadges()??[]", "hidePersonalInformation");
    const usernameFilter = api.filters.componentByCode("withMentionPrefix", "hideSystemTag", "decorations");
    const real = { profile: !!api.findExport(profileFilter), username: !!api.findExport(usernameFilter) };

    const standIns: Record<string, (m: any, e: any, n: any) => void> = {};
    if (!real.profile) {
        standIns[990001] = (_m: any, e: any, n: any) => {
            n.d(e, { A: () => c });
            function c(e: any) {
                const hide = "hidePersonalInformation";
                return hide ? e?.getBadges()??[] : [];
            }
        };
    }
    if (!real.username) {
        standIns[990002] = (_m: any, e: any, n: any) => {
            n.d(e, { A: () => F });
            function F(e: any) {
                const { withMentionPrefix, hideSystemTag, decorations } = e;
                return { withMentionPrefix, hideSystemTag, decorations };
            }
        };
    }
    if (Object.keys(standIns).length) {
        (window as any).webpackChunkdiscord_app.push([[Symbol("evi-badges-test")], standIns]);
        for (const id of Object.keys(standIns)) wreq(id);
        await new Promise(r => setTimeout(r, 300));
    }

    const profileTarget = api.findExport(profileFilter);
    const usernameTarget = api.findExport(usernameFilter);
    const hooked = (t: any) => !!t && api.getUnhooked(t.exports[t.key]) !== t.exports[t.key];

    const uid = "123456789012345678";
    const discordBadge = { id: "hypesquad_house_1", description: "HypeSquad Bravery", icon: "8a88d63823d8a71cd5e390baa45efa02" };
    // Discord's part answers with its own badge list; the plugin's after-hook runs on top
    const unProfile = api.hook(profileTarget.exports, profileTarget.key, "instead", () => [discordBadge]);
    const profile = profileTarget.exports[profileTarget.key]({ userId: uid });
    const stranger = profileTarget.exports[profileTarget.key]({ userId: "876543210987654321" });
    unProfile();

    // Discord's part hands back the props it was rendered with: the same ones, with nothing of ours in them
    const unUsername = api.hook(usernameTarget.exports, usernameTarget.key, "instead", ({ args }: any) => args[0]);
    const roleIcon = { key: "role-icon" };
    const header = usernameTarget.exports[usernameTarget.key]({ message: { author: { id: uid } }, compact: false, decorations: { 0: null, 1: [roleIcon] } });
    unUsername();

    const command = D.toolkit.getRegisteredCommands().find((c: any) => c.untranslatedName === "badge");
    // Replies are "Only you can see this" bot messages: catch them instead of posting
    const replies: string[] = [];
    if (command) {
        const botActions = api.findByProps("sendBotMessage", "sendMessage");
        const send = botActions.sendBotMessage;
        botActions.sendBotMessage = (_c: string, text: string) => void replies.push(text);
        try {
            await command.execute([{ name: "action", type: 3, value: "grant" }, { name: "badge", type: 3, value: "dev" }, { name: "user", type: 6, value: uid }], { channel: { id: "1" } });
            await command.execute([{ name: "action", type: 3, value: "create" }], { channel: { id: "1" } });
            await command.execute([{ name: "action", type: 3, value: "time" }, { name: "user", type: 6, value: uid }, { name: "days", type: 4, value: 30 }], { channel: { id: "1" } });
            await new Promise(r => setTimeout(r, 100));
        } finally {
            botActions.sendBotMessage = send;
        }
    }

    // A push from main (the change stream) replaces the list straight away: Gold becomes Sapphire
    const before = api.Badges.getVersion();
    (window as any).__test.pushBadges({
        ok: true,
        badges: { "supporter-sapphire": { name: "Sapphire Supporter", description: "", icon: "data:image/png;base64,AAAA" } },
        users: { [uid]: ["supporter-sapphire"] },
        supporters: { [uid]: Date.UTC(2024, 2, 5, 12) },
    });
    const pushed = { changed: api.Badges.getVersion() !== before, badges: api.Badges.forUser(uid).map((b: any) => `${b.name}: ${b.description}`) };

    return {
        pushed,
        notAPlugin: !D.plugins.getSnapshot().some((p: any) => p.manifest.id === "badges"),

        real,
        hooked: { profile: hooked(profileTarget), username: hooked(usernameTarget) },
        profile: profile.map((b: any) => ({ id: b.id, description: b.description, iconSrc: b.iconSrc?.slice(0, 22) })),
        strangerUnchanged: stranger.length === 1 && stranger[0] === discordBadge,
        chatUnchanged: header.decorations[1].length === 1 && header.decorations[1][0] === roleIcon,
        command: !!command,
        adminCalls: (window as any).__test.badgeAdmin,
        replies,
    };
});
console.log(`  badges: Discord's own modules loaded here: ${JSON.stringify(badges.real)}`);
check("Badges: part of Evi, not a plugin that can be turned off or removed", badges.notAPlugin);
check("Badges: the core hooks Discord's profile badges, not the message username", badges.hooked.profile && !badges.hooked.username, badges.hooked);
check("Badges: ours go in front of Discord's on a profile, others' profiles untouched; a supporter's says since when",
    JSON.stringify(badges.profile) === JSON.stringify([
        { id: "evi-dev", description: "Developer", iconSrc: "data:image/png;base64," },
        { id: "evi-supporter-gold", description: "Supporting Evi since Mar 5, 2026", iconSrc: "data:image/png;base64," },
        { id: "hypesquad_house_1", description: "HypeSquad Bravery" },
    ]) && badges.strangerUnchanged, badges.profile);
check("Badges: a list pushed by main (evi.rest's change stream) shows right away",
    badges.pushed.changed && JSON.stringify(badges.pushed.badges) === JSON.stringify(["Sapphire Supporter: Supporting Evi since Mar 5, 2024"]), badges.pushed);
check("Badges: nothing added next to a name in chat, only on profiles", badges.chatUnchanged);
check("/badge exists for an admin install and asks main to grant, and to give supporters time",
    badges.command && JSON.stringify(badges.adminCalls) === '[{"action":"grant","userId":"123456789012345678","badgeId":"dev"},{"action":"time","userId":"123456789012345678","days":30}]'
    && JSON.stringify(badges.replies) === JSON.stringify(["done: grant", "/badge create needs badge and name and icon.", "done: time"]), { replies: badges.replies, calls: badges.adminCalls });

// Discord's own badge settings ("Customize your badges", "Your badges") read BadgeDirectoryStore, and
// save through one PATCH. Both are Discord's real modules here; the current user is faked.
const badgeSettings = await page.evaluate(async () => {
    const D = (window as any).Evi;
    const { api } = D;
    const me = "123456789012345678";
    const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
    const levels = ["bronze", "silver", "gold", "emerald", "sapphire", "amethyst", "ruby", "prismatic"];
    (window as any).__test.pushBadges({
        ok: true,
        badges: {
            dev: { name: "Developer", description: "Builds Evi", icon: png },
            ...Object.fromEntries(levels.map(l => [`supporter-${l}`, { name: `${l} Supporter`, description: "", icon: png }])),
        },
        users: { [me]: ["dev", "supporter-gold"] },
        supporters: { [me]: Date.now() - 70 * 24 * 60 * 60 * 1000 },
        prefs: {},
    });

    const users = api.findStore("UserStore");
    const unUser = api.hook(users, "getCurrentUser", "instead", () => ({ id: me }));
    try {
        const store = api.findStore("BadgeDirectoryStore");
        const listed = store.getBadges(me).map((b: any) => b.badge_id);
        const supporter = store.getBadgeById("evi-supporter", me);
        const sameEntries = store.getBadges(me)[0] === store.getBadges(me)[0];

        // Editing your profile: Discord's preview merges the profile's badges with the directory's.
        // Ours must come out once each, in the pending order, with a hidden one left out.
        const pending = { pendingBadgeDisplayOrder: ["evi-dev", 1, "evi-supporter"], pendingBadgeHiddenBadges: ["evi-supporter"] };
        const settingsStore = api.findStore("UserProfileSettingsStore");
        const unPending = api.hook(settingsStore, "getPendingChanges", "instead", () => pending);
        const profileTarget = api.findExport(api.filters.byCode("getBadges()??[]", "hidePersonalInformation"));
        const unProfile = api.hook(profileTarget.exports, profileTarget.key, "instead", () => [{ id: "premium", description: "Nitro", icon: "2ba85e8026a8614b640c2837bcdfe21b" }]);
        const merge = api.findExport(api.filters.byCode("simple_icon_raster_url", "pendingBadgeHiddenBadges", "owned"));
        let preview: string[] | undefined;
        try {
            const shown = profileTarget.exports[profileTarget.key]({ userId: me });
            if (merge) {
                const fn = merge.exports[merge.key];
                const hidden = fn(shown, store.getBadges(me), pending).map((b: any) => b.id);
                // Unhiding the supporter: shown by us, and not a second time from the directory
                pending.pendingBadgeHiddenBadges = [];
                const unhidden = fn(profileTarget.exports[profileTarget.key]({ userId: me }), store.getBadges(me), pending).map((b: any) => b.id);
                preview = [...hidden, "|", ...unhidden];
            }
        } finally {
            unProfile();
            unPending();
        }

        // The save: Discord's part goes on (answered here instead of sent), ours go to main
        const http = api.find(api.filters.byProps("get", "post", "put", "patch", "del"));
        const sent: any[] = [];
        const unPatch = api.hook(http, "patch", "instead", ({ args }: any) => (sent.push(args[0]), Promise.resolve({ ok: true, body: {} })));
        await http.patch({ url: "https://discord.com/api/v9/users/@me/badges/settings", body: { display_order: [1, "evi-supporter", "evi-dev"], hidden_badges: ["evi-dev", 22] } });
        await http.patch({ url: "https://discord.com/api/v9/users/@me/profile", body: { bio: "hi" } });
        unPatch();

        // Hidden now: gone from what others see, still in your own badge settings
        const shownToOthers = api.Badges.forUser(me).map((b: any) => b.id);
        const inSettings = store.getBadges(me).map((b: any) => `${b.badge_id}${b.hidden ? " (hidden)" : ""}`);
        return {
            listed, sameEntries, preview,
            supporter: supporter && { name: supporter.name, current: supporter.current_tier, next: supporter.next_tier, tiers: supporter.tiers.length, owned: supporter.tiers.filter((t: any) => t.owned).map((t: any) => t.name), icon: supporter.simple_icon_url?.slice(0, 22), progress: supporter.progress },
            sent: sent.map(r => r.body),
            prefs: (window as any).__test.badgePrefs,
            shownToOthers, inSettings,
        };
    } finally {
        unUser();
    }
});
check("Badges: ours are in Discord's badge directory (Customize your badges, Your badges), rebuilt only on change",
    JSON.stringify(badgeSettings.listed.slice(0, 2)) === '["evi-dev","evi-supporter"]' && badgeSettings.sameEntries, badgeSettings.listed);
check("Badges: a supporter is one badge with the levels as tiers, Gold after 70 days",
    badgeSettings.supporter?.current === "supporter-gold" && badgeSettings.supporter.next === "supporter-emerald" && badgeSettings.supporter.tiers === 8
    && JSON.stringify(badgeSettings.supporter.owned) === '["Bronze","Silver","Gold"]' && badgeSettings.supporter.progress?.[0]?.threshold === 90, badgeSettings.supporter);
check("Badges: the profile preview while editing shows ours once each, in the pending order",
    JSON.stringify(badgeSettings.preview) === JSON.stringify(["evi-dev", "premium", "|", "evi-dev", "premium", "evi-supporter-gold"]), badgeSettings.preview);
check("Badges: saving badge settings sends Discord only its own, and ours to evi.rest",
    JSON.stringify(badgeSettings.sent) === JSON.stringify([{ display_order: [1], hidden_badges: [22] }, { bio: "hi" }])
    && JSON.stringify(badgeSettings.prefs) === JSON.stringify([{ userId: "123456789012345678", prefs: { order: [1, "supporter", "dev"], hidden: ["dev"] } }]), { sent: badgeSettings.sent, prefs: badgeSettings.prefs });
check("Badges: a hidden one is gone for everyone else, and still in your own badge settings, in your order",
    JSON.stringify(badgeSettings.shownToOthers) === '["supporter-gold"]' && badgeSettings.inSettings.includes("evi-dev (hidden)")
    && badgeSettings.inSettings.indexOf("evi-supporter") < badgeSettings.inSettings.indexOf("evi-dev (hidden)"), { others: badgeSettings.shownToOthers, settings: badgeSettings.inSettings });

// evi.rest's Plugin Author badge ("plugin-author") is ours, not a plugin's: its details open like the rest
const authorBadge = await page.evaluate(() => {
    const { api } = (window as any).Evi;
    const me = "123456789012345678";
    const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
    (window as any).__test.pushBadges({
        ok: true,
        badges: { "plugin-author": { name: "Plugin Author", description: "Made a plugin you can install from the Evi store.", icon: png } },
        users: { [me]: ["plugin-author"] },
        supporters: {},
        prefs: {},
    });
    const unUser = api.hook(api.findStore("UserStore"), "getCurrentUser", "instead", () => ({ id: me }));
    try {
        const entry = api.findStore("BadgeDirectoryStore").getBadgeById("evi-plugin-author", me);
        return entry && { name: entry.name, label: entry.info_label };
    } finally {
        unUser();
    }
});
check("Badges: the Plugin Author badge opens with its description", authorBadge?.name === "Plugin Author" && authorBadge.label === "Made a plugin you can install from the Evi store.", authorBadge);

// Plugins' badges (ctx.profileBadges): on the profile after everything else, and in the badge directory
const pluginBadges = await page.evaluate(() => {
    const { api } = (window as any).Evi;
    const who = "999000000000000001";
    const profileTarget = api.findExport(api.filters.byCode("getBadges()??[]", "hidePersonalInformation"));
    const unProfile = api.hook(profileTarget.exports, profileTarget.key, "instead", () => [{ id: "premium", description: "Nitro", icon: "2ba85e8026a8614b640c2837bcdfe21b" }]);
    try {
        const store = api.findStore("BadgeDirectoryStore");
        const entry = store.getBadgeById("evi-plugin:test-status", who);
        return {
            profile: profileTarget.exports[profileTarget.key]({ userId: who }).map((b: any) => b.id),
            nobodyElse: profileTarget.exports[profileTarget.key]({ userId: "999000000000000002" }).map((b: any) => b.id),
            directory: store.getBadges(who).map((b: any) => b.badge_id),
            stable: store.getBadges(who).at(-1) === store.getBadges(who).at(-1),
            entry: entry && { name: entry.name, label: entry.info_label, icon: !!entry.simple_icon_url },
        };
    } finally {
        unProfile();
    }
});
check("Plugins' profile badges show on the profile and in Discord's badge directory (Your badges)",
    JSON.stringify(pluginBadges.profile) === '["premium","evi-test-status"]' && JSON.stringify(pluginBadges.nobodyElse) === '["premium"]'
    && pluginBadges.directory.includes("evi-plugin:test-status") && pluginBadges.stable && pluginBadges.entry?.name === "Testing" && /Badge User/.test(pluginBadges.entry.label), pluginBadges);

// A new version found in the background gets a notice over Discord; skipping it keeps it quiet
{
    await page.evaluate(() => (window as any).Evi.updates.check(true));
    const notice = page.locator(".dl-safe-float .dl-update");
    await notice.getByText("Evi 9.9.0 is available").waitFor({ timeout: 3000 });
    await notice.screenshot({ path: join(OUT, "update-notice.png") });
    await notice.getByRole("button", { name: "Skip this version" }).click();
    await page.waitForSelector(".dl-safe-float .dl-update", { state: "detached", timeout: 2000 }).catch(() => { });
    const after = await page.evaluate(async () => {
        const D = (window as any).Evi;
        const gone = !document.querySelector(".dl-safe-float .dl-update");
        await D.updates.check(true);
        await new Promise(r => setTimeout(r, 200));
        return { gone, dismissed: D.settings.data.dismissedUpdate, stillQuiet: !document.querySelector(".dl-safe-float .dl-update") };
    });
    check("an update found in the background shows a notice; Skip this version keeps it from coming back", after.gone && after.dismissed === "9.9.0" && after.stillQuiet, after);
}

await page.keyboard.press("Control+Shift+D");
await page.waitForSelector(".dl-panel", { timeout: 5000 });
await page.waitForTimeout(300);
await page.screenshot({ path: join(OUT, "ui-plugins.png") });
check("Ctrl+Shift+D opens the panel", true);

/** Opens one of the panel's pages (Plugins, Themes, General, Advanced) on one of its tabs */
async function openTab(section: string, tab: string, on = page) {
    await on.click(`#dl-tab-${section}`);
    await on.click(`#dl-subtab-${section}-${tab}`);
}

/** Plugins come a page at a time: search for one so its card is on the page */
async function findPlugin(id: string, on = page) {
    await on.fill("#dl-plugin-search", id);
    await on.waitForSelector(`li[aria-labelledby="dl-plugin-${id}"]`, { timeout: 3000 });
}

// Four pages in the sidebar, each with its tabs along the top
{
    const layout = await page.evaluate(() => ({
        pages: [...document.querySelectorAll(".dl-nav-item")].map(b => b.id),
        tabs: [...document.querySelectorAll(".dl-tabbar-item")].map(b => b.textContent),
        cards: document.querySelectorAll(".dl-plugin-grid > li").length,
        pager: document.querySelector('.dl-pagination [aria-current="page"]')?.textContent,
    }));
    check("the panel has four pages, Plugins shows Installed and Store tabs and its plugins a page at a time",
        JSON.stringify(layout.pages) === '["dl-tab-plugins","dl-tab-themes","dl-tab-general","dl-tab-advanced"]'
        && layout.tabs[0] === "Installed" && layout.tabs[1]?.startsWith("Store") && layout.cards === 12 && layout.pager === "1", layout);
    await page.getByRole("button", { name: "Page 2", exact: true }).click();
    await page.waitForTimeout(150);
    const second = await page.evaluate(() => ({
        pager: document.querySelector('.dl-pagination [aria-current="page"]')?.textContent,
        first: document.querySelector(".dl-plugin-grid > li")?.getAttribute("aria-labelledby"),
    }));
    await findPlugin("experiments");
    const searched = await page.evaluate(() => document.querySelector('.dl-pagination [aria-current="page"]')?.textContent ?? "one page");
    check("Page 2 shows the next plugins; a new search starts over from the first page", second.pager === "2" && !!second.first && searched !== "2", { second, searched });
}

// No scrollbars in Evi's UI, and nothing reserves room for one
const scrollbars = await page.evaluate(() => [".dl-sidebar", ".dl-body"].map(sel => {
    const el = document.querySelector<HTMLElement>(sel)!;
    return { sel, width: getComputedStyle(el).scrollbarWidth, gutter: el.offsetWidth - el.clientWidth - parseFloat(getComputedStyle(el).borderLeftWidth) - parseFloat(getComputedStyle(el).borderRightWidth) };
}));
check("Evi's panel shows no scrollbars", scrollbars.every(s => s.width === "none" && s.gutter === 0), scrollbars);

// The Account tab: link this install with a code confirmed on the site, then who it's linked to
{
    await openTab("general", "account");
    const body = page.locator(".dl-body");
    await body.getByText("Link to your account").waitFor({ timeout: 3000 });
    await page.screenshot({ path: join(OUT, "ui-account.png") });
    await body.getByText("Link to your account").click();
    await page.waitForSelector(".dl-account-code", { timeout: 3000 });
    const code = await page.textContent(".dl-account-code");
    await page.screenshot({ path: join(OUT, "ui-account-code.png") });
    await page.evaluate(() => { (window as any).__test.account.confirmed = true; });
    await body.getByText("Linked as @evi-tester").waitFor({ timeout: 6000 });
    await page.screenshot({ path: join(OUT, "ui-account-linked.png") });
    await body.getByText("Open dashboard").click();
    const account = await page.evaluate(() => (window as any).__test.account);
    check("Account tab links this install: code, then who it's linked to, then the dashboard", code === "K7PQ-X3MV" && account.started === 1 && account.dashboard === 1, { code, account });
    await page.click("#dl-tab-plugins");
}

// The Developers page: only on an Evi linked to one of Evi's developers, with evi.rest's numbers
// and its admin tools in tabs
{
    const hiddenBefore = await page.locator("#dl-tab-developers").count() === 0;
    await page.evaluate(() => { (window as any).__test.account.admin = true; });
    await openTab("general", "account");
    await page.waitForSelector("#dl-tab-developers", { timeout: 3000 });
    await page.click("#dl-tab-developers");
    const body = page.locator(".dl-body");
    await body.getByText("Online now", { exact: true }).waitFor({ timeout: 3000 });
    const shown = await page.evaluate(() => ({
        tabs: [...document.querySelectorAll('[id^="dl-subtab-developers-"]')].map(b => b.id.replace("dl-subtab-developers-", "")).filter(id => id !== "panel"),
        reviewPill: document.querySelector("#dl-subtab-developers-review")?.textContent,
        stats: [...document.querySelectorAll(".dl-dev-stat")].map(t => t.textContent),
        bars: document.querySelectorAll(".dl-dev-bar").length,
        segments: document.querySelectorAll(".dl-dev-stack > span").length,
        legend: [...document.querySelectorAll(".dl-dev-legend > li")].map(li => li.textContent),
        plugins: [...document.querySelectorAll(".dl-dev-top .dl-dev-name")].map(n => n.textContent),
    }));
    await page.hover(".dl-dev-bar-hit:last-child");
    const tooltip = await page.textContent(".dl-dev-tooltip").catch(() => null);
    await page.mouse.move(0, 0);
    await page.screenshot({ path: join(OUT, "ui-developers.png") });

    // Review: approving an upload asks first, then calls evi.rest
    await page.click("#dl-subtab-developers-review");
    await body.getByText("Cool Plugin", { exact: true }).waitFor({ timeout: 3000 });
    await page.waitForTimeout(300);
    await page.screenshot({ path: join(OUT, "ui-developers-review.png") });
    await body.locator("li", { hasText: "Cool Plugin" }).getByRole("button", { name: "Approve", exact: true }).click();
    await page.getByRole("button", { name: "Publish to the store" }).click();
    await page.waitForSelector("#dl-dev-confirm", { state: "detached", timeout: 3000 }).catch(() => { });

    await page.click("#dl-subtab-developers-plugins");
    await body.getByText("Music Player", { exact: true }).first().waitFor({ timeout: 3000 });
    await page.waitForTimeout(300);
    await page.screenshot({ path: join(OUT, "ui-developers-plugins.png") });

    // Announcements: the preview follows what's typed, and sending asks first
    await page.click("#dl-subtab-developers-announcements");
    await page.fill("#dl-dev-ann-title", "Evi 1.6.0 is out");
    await page.fill("#dl-dev-ann-body", "Fix Embeds and Quick Markup are in the store.");
    const preview = await page.textContent(".dl-dev-preview");
    await page.waitForTimeout(300);
    await page.screenshot({ path: join(OUT, "ui-developers-announcements.png") });
    await body.getByRole("button", { name: "Send to everyone" }).click();
    await page.locator("#dl-dev-ann-confirm").getByRole("button", { name: "Send to everyone" }).click();
    await page.waitForSelector("#dl-dev-ann-confirm", { state: "detached", timeout: 3000 }).catch(() => { });

    await page.click("#dl-subtab-developers-people");
    await body.getByText("Lodestone", { exact: true }).waitFor({ timeout: 3000 });
    await page.waitForTimeout(600);
    await page.screenshot({ path: join(OUT, "ui-developers-people.png") });
    const peopleList = await page.evaluate(() => ({
        badgeIcons: [...document.querySelectorAll(".dl-dev-people .dl-dev-person")].map(row => [...row.querySelectorAll("img.dl-dev-badge")].map(i => i.getAttribute("alt"))),
        tags: [...document.querySelectorAll(".dl-dev-people .dl-dev-person")].map(row => [...row.querySelectorAll(".dl-badge, [class*=badge]")].map(b => b.textContent).filter(t => t && t.length < 20)),
        textBadges: document.querySelector(".dl-dev-people")?.textContent?.includes("early supporter"),
    }));
    const peopleCall = await page.evaluate(() => ((window as any).__test.devAdmin ?? []).filter((c: any) => c.path.startsWith("/admin/people")).at(-1)?.path);

    // One person's page: badges, supporter time, their plugins, and a ban
    await page.locator(".dl-dev-person", { hasText: "Evi Tester" }).click();
    await page.waitForSelector("#dl-dev-person .dl-dev-granted", { timeout: 3000 });
    await page.waitForTimeout(500);
    await page.screenshot({ path: join(OUT, "ui-developers-person.png") });
    const personShown = await page.evaluate(() => ({
        granted: [...document.querySelectorAll("#dl-dev-person .dl-dev-granted")].map(li => li.textContent),
        sections: [...document.querySelectorAll("#dl-dev-person .dl-section h2")].map(h => h.textContent),
        id: document.querySelector("#dl-dev-person .dl-dev-mono")?.textContent,
    }));
    await page.locator("#dl-dev-person").getByRole("button", { name: "Give", exact: true }).click();
    await page.waitForTimeout(300);
    await page.fill("#dl-dev-ban-reason", "Spamming reviews");
    await page.locator("#dl-dev-person").getByRole("button", { name: "Ban", exact: true }).click();
    await page.waitForSelector("#dl-dev-ban", { timeout: 3000 });
    await page.locator("#dl-dev-ban").getByRole("button", { name: "Ban them" }).click();
    await page.waitForSelector("#dl-dev-ban", { state: "detached", timeout: 3000 }).catch(() => { });
    await page.locator("#dl-dev-person .dl-dialog-head").getByRole("button").last().click();
    await page.waitForSelector("#dl-dev-person", { state: "detached", timeout: 3000 }).catch(() => { });

    // Managing the badges themselves
    await body.getByRole("button", { name: "Manage badges" }).click();
    await page.waitForSelector("#dl-dev-badges .dl-dev-badge-card", { timeout: 3000 });
    await page.waitForTimeout(500);
    await page.screenshot({ path: join(OUT, "ui-developers-badges.png") });
    const badgeCards = await page.locator("#dl-dev-badges .dl-dev-badge-card").count();
    await page.locator("#dl-dev-badges .dl-dialog-head").getByRole("button").last().click();
    await page.waitForSelector("#dl-dev-badges", { state: "detached", timeout: 3000 }).catch(() => { });
    const peopleCalls = await page.evaluate(() => ((window as any).__test.devAdmin ?? []).filter((c: any) => c.method !== "GET" && c.path.startsWith("/admin/users/")));
    check("People: badges as icons, pages, a person's page, giving a badge and a ban that asks first",
        peopleList.badgeIcons[0]?.join() === "Early Supporter,Plugin Author,Gold Supporter" && !peopleList.textBadges
        && peopleCall === "/admin/people?page=1&size=25"
        && personShown.granted.length === 2 && personShown.id === "123456789012345678" && personShown.sections.length === 4
        && peopleCalls.some((c: any) => c.method === "PUT" && c.path === "/admin/users/123456789012345678/badges/developer" && c.body?.position === 2)
        && peopleCalls.some((c: any) => c.method === "PUT" && c.path === "/admin/users/123456789012345678/ban" && c.body?.reason === "Spamming reviews" && c.body?.days === 7)
        && badgeCards === 6,
        { peopleList, peopleCall, personShown, peopleCalls, badgeCards });

    const calls = await page.evaluate(() => ((window as any).__test.devAdmin ?? []).filter((c: any) => c.method !== "GET"));
    await page.click("#dl-subtab-developers-overview");
    await page.evaluate(() => { (window as any).__test.account.admin = false; });
    await openTab("general", "account");
    await page.waitForSelector("#dl-tab-developers", { state: "detached", timeout: 3000 }).catch(() => { });
    const hiddenAfter = await page.locator("#dl-tab-developers").count() === 0;
    check("the Developers page shows only for a developer: live numbers, people per day, versions and top plugins",
        hiddenBefore && hiddenAfter && !!shown.stats[0]?.includes("1,284") && shown.bars === 30 && shown.segments === 3
        && !!shown.legend.at(-1)?.startsWith("Before 1.5.0") && shown.plugins[0] === "View Icons" && !!tooltip?.includes("people"),
        { hiddenBefore, hiddenAfter, shown, tooltip });
    check("the Developers page has Overview, Plugins, Review, Announcements and People, with what waits on Review",
        JSON.stringify(shown.tabs) === '["overview","plugins","review","announcements","people"]' && !!shown.reviewPill?.includes("4"), shown);
    check("approving an upload and sending an announcement each ask first, then call evi.rest",
        calls.some((c: any) => c.method === "POST" && c.path === "/admin/submissions/41/approve")
        && calls.some((c: any) => c.method === "POST" && c.path === "/admin/announcements" && c.body?.title === "Evi 1.6.0 is out")
        && !!preview?.includes("Evi 1.6.0 is out"),
        { calls, preview });
    await page.click("#dl-tab-plugins");
}

// The Author page: "Publish your own" at the top right of Plugins opens an author's numbers, how to
// become one, or linking first, as evi.rest answers
{
    await page.click("#dl-tab-plugins");
    const button = page.locator(".dl-page-action button");
    await button.waitFor({ timeout: 3000 });
    const place = await page.evaluate(() => {
        const b = document.querySelector(".dl-page-action button")!.getBoundingClientRect();
        const bar = document.querySelector(".dl-page-head[data-action]")!.getBoundingClientRect();
        const tab = document.querySelector(".dl-page-head .dl-tabbar-item")!.getBoundingClientRect();
        return { rightGap: Math.round(bar.right - b.right), sameRow: Math.abs((b.top + b.bottom) / 2 - (tab.top + tab.bottom) / 2) < 12 };
    });
    const closeDialog = async () => {
        await page.click('#dl-author button[aria-label="Close"]');
        await page.waitForSelector("#dl-author", { state: "detached", timeout: 3000 });
    };

    await page.evaluate(() => { (window as any).__test.authorMode = "none"; });
    await button.click();
    await page.locator("#dl-author").getByText("Publish your own plugins").waitFor({ timeout: 3000 });
    const steps = await page.locator(".dl-authorhub-steps > li").count();
    // Past the dialog's open animation
    await page.waitForTimeout(400);
    await page.screenshot({ path: join(OUT, "ui-author-become.png") });
    await page.locator("#dl-author").getByText("Open the guide").click();
    const opened = await page.evaluate(() => (window as any).__test.nativeCalls.filter((c: any) => c[0] === "authorOpen").map((c: any) => c[1]));
    await closeDialog();

    await page.evaluate(() => { (window as any).__test.authorMode = "unlinked"; });
    await button.click();
    await page.locator("#dl-author").getByText("Link your Discord account first").waitFor({ timeout: 3000 });
    // Past the dialog's open animation
    await page.waitForTimeout(400);
    await page.screenshot({ path: join(OUT, "ui-author-link.png") });
    await closeDialog();

    await page.evaluate(() => { (window as any).__test.authorMode = "author"; });
    await button.click();
    await page.waitForSelector(".dl-authorhub-stats", { timeout: 3000 });
    const shown = await page.evaluate(() => ({
        title: document.querySelector("#dl-author-title")?.textContent,
        stats: [...document.querySelectorAll(".dl-authorhub-stat")].map(s => s.textContent),
        bars: document.querySelectorAll(".dl-authorhub-chart .dl-dev-bar-hit").length,
        builds: document.querySelectorAll(".dl-authorhub-builds > li").length,
        reviews: document.querySelectorAll(".dl-authorhub-review").length,
        switcher: !!document.querySelector(".dl-authorhub-switcher"),
    }));
    // Past the dialog's open animation
    await page.waitForTimeout(400);
    await page.screenshot({ path: join(OUT, "ui-author.png") });
    await page.locator("#dl-author").getByText("7 days").click();
    await page.waitForFunction(() => document.querySelectorAll(".dl-authorhub-chart .dl-dev-bar-hit").length === 7, null, { timeout: 3000 });
    const days = await page.evaluate(() => (window as any).__test.authorDays);
    await closeDialog();
    check("Plugins has \"Publish your own\" at its top right; it shows how to publish, linking first, or an author's numbers",
        place.rightGap <= 2 && place.sameRow && steps === 4 && opened.includes("docs")
        && shown.title === "Your plugins" && shown.stats.length === 6 && shown.bars === 30 && shown.builds === 2 && shown.reviews === 2 && shown.switcher && days === 7,
        { place, steps, opened, shown, days });
}

// The Updates tab: checks when opened, says what's new, and updates with one button
{
    await openTab("general", "updates");
    const body = page.locator(".dl-body");
    await body.getByText("Evi 9.9.0 is available").waitFor({ timeout: 3000 });
    const tab = await page.evaluate(() => {
        const body = document.querySelector(".dl-body")!;
        return {
            text: body.textContent,
            items: [...body.querySelectorAll(".dl-update-notes-list li")].map(li => li.textContent),
            link: body.querySelector<HTMLAnchorElement>("a.dl-store-source")?.href,
            version: (window as any).Evi.version,
        };
    });
    await page.screenshot({ path: join(OUT, "ui-updates.png") });
    check("Updates tab checks when opened and shows the new version's notes, markdown cleaned up",
        tab.text!.includes(`Evi ${tab.version}`) && tab.text!.includes("What’s new in 9.9.0") && JSON.stringify(tab.items) === '["Badges you can hide","Updates from the app"]'
        && tab.text!.includes("Thanks for testing.") && tab.link === "https://github.com/BleedDev/evi/releases/tag/v9.9.0", tab);
    await body.getByRole("button", { name: "Update and restart Discord" }).click();
    await body.getByText("Downloading… 42%").waitFor({ timeout: 3000 });
    const installs = await page.evaluate(() => (window as any).__test.updateInstalls);
    check("Update and restart Discord installs it, showing progress", installs === 1, installs);
    await page.click("#dl-tab-plugins");
}

await findPlugin("experiments");
const toggled = await page.evaluate(async () => {
    // Discord's switch is a real checkbox input (checked), ours a button (aria-checked)
    const checkedOf = (el: any) => el.getAttribute("aria-checked") ?? String(el.checked);
    const sw = document.querySelector('[aria-labelledby="dl-plugin-experiments"][role="switch"]') as HTMLButtonElement;
    const before = checkedOf(sw);
    sw.click();
    await new Promise(r => setTimeout(r, 400));
    const state = (window as any).Evi.plugins.get("experiments");
    const after = checkedOf(document.querySelector('[aria-labelledby="dl-plugin-experiments"][role="switch"]'));
    return { before, after, needsReload: state.needsReload, reason: state.reloadReason, saved: (window as any).__test.savedSettings?.plugins?.experiments };
});
check("switch disables plugin and persists", toggled.before === "true" && toggled.after === "false" && toggled.saved?.enabled === false, toggled);
// Discord's switch keeps its real checkbox in a hidden, absolutely placed box. Clicking the switch
// focuses that checkbox, and the page scrolls to wherever it is: it has to sit on the switch, not far below
const switchInput = await page.evaluate(() => {
    const input = document.querySelector<HTMLElement>('[aria-labelledby="dl-plugin-experiments"][role="switch"]')!;
    const shown = input.closest(".dl-switch-anchor")?.getBoundingClientRect();
    const r = input.getBoundingClientRect();
    return { anchored: !!shown, input: Math.round(r.top), switch: shown && Math.round(shown.top), height: shown && Math.round(shown.height) };
});
check("a plugin switch's checkbox sits on the switch, so clicking it never scrolls the page away",
    switchInput.anchored && Math.abs(switchInput.input - switchInput.switch!) <= 64, switchInput);
// Experiments patches a Flux store: re-running it would register a second store, so it must refuse
check("unsafe module (Flux store) refuses live replacement, asks for reload", toggled.needsReload && /Flux store/.test(toggled.reason ?? ""), toggled.reason);
await page.screenshot({ path: join(OUT, "ui-reload-banner.png") });

// The kill switch: a plugin Evi pulled never started, and its row says so and why
{
    const pulledRowSelector = 'li[aria-labelledby="dl-plugin-store-pulled"]';
    await findPlugin("store-pulled");
    const pulledRow = page.locator(pulledRowSelector);
    await pulledRow.getByText("Turned off by Evi", { exact: true }).waitFor({ timeout: 5000 }).catch(() => { });
    await pulledRow.scrollIntoViewIfNeeded();
    await page.waitForTimeout(200);
    await pulledRow.screenshot({ path: join(OUT, "ui-pulled-row.png") });
    const boot = await page.evaluate(({ sel }) => {
        const D = (window as any).Evi;
        const state = D.plugins.get("store-pulled");
        const sw = document.querySelector<HTMLInputElement>('[aria-labelledby="dl-plugin-store-pulled"][role="switch"]');
        return {
            running: state.running,
            reason: state.pulled?.reason,
            runs: (window as any).__test.pulledRuns ?? 0,
            patches: state.patchesRegistered,
            row: document.querySelector(sel)?.textContent ?? "",
            switchOff: !!sw && (sw.disabled || sw.getAttribute("aria-disabled") === "true") && (sw.getAttribute("aria-checked") ?? String(sw.checked)) === "false",
            // Still turned on: lifting the pull brings it back
            stillOn: D.settings.data.plugins["store-pulled"]?.enabled !== false,
            told: (window as any).__test.storage.getItem("evi-pull-notices") ?? "",
        };
    }, { sel: pulledRowSelector });
    check("kill switch: a plugin Evi pulled never starts at boot, though it's turned on", !boot.running && boot.runs === 0 && boot.reason === PULL_REASON && !boot.patches && boot.stillOn, boot);
    check("kill switch: its row says Turned off by Evi, the reason, disables the switch and offers the fixed version",
        ["Turned off by Evi", `Evi turned it off on every install: ${PULL_REASON}`, "v1.0.1 isn’t affected", "Update to v1.0.1"].every(t => boot.row.includes(t)) && boot.switchOff, boot.row);
    check("kill switch: the user is told once (remembered per pull)", boot.told.includes(`store-pulled@${PULLED_AT}`), boot.told);

    // Its details say it too, and store plugins can be reported from there
    await pulledRow.getByRole("button", { name: "Link Preview Plus details" }).click();
    await page.waitForSelector("#dl-plugin-store-pulled-info", { timeout: 2000 });
    await page.waitForTimeout(300);
    const details = await page.evaluate(() => document.querySelector("#dl-plugin-store-pulled-info")?.textContent ?? "");
    await page.screenshot({ path: join(OUT, "ui-pulled-details.png") });
    check("kill switch: the plugin's details say why it's off, and offer Report", details.includes(`Evi turned it off on every install: ${PULL_REASON}`) && details.includes("Report"), details.slice(0, 300));
    await page.keyboard.press("Escape");
    await page.waitForSelector("#dl-plugin-store-pulled-info", { state: "detached", timeout: 2000 }).catch(() => { });

    // Evi lifts the pull: it starts again, nobody touched its switch
    await page.evaluate(({ scam }) => (window as any).__test.setPulls({ "store-scam": scam }), { scam: pulled["store-scam"] });
    await page.waitForFunction(() => (window as any).Evi.plugins.get("store-pulled").running, null, { timeout: 3000 }).catch(() => { });
    const lifted = await page.evaluate(sel => ({
        running: (window as any).Evi.plugins.get("store-pulled").running,
        runs: (window as any).__test.pulledRuns ?? 0,
        row: document.querySelector(sel)?.textContent ?? "",
    }), pulledRowSelector);
    check("kill switch: lifting the pull starts it again", lifted.running && lifted.runs === 1 && !lifted.row.includes("Turned off by Evi"), lifted);

    // A pull arriving while it runs stops it right away, and turning it on doesn't bring it back
    const repulled = await page.evaluate(async ({ pull, scam }) => {
        const D = (window as any).Evi;
        (window as any).__test.setPulls({ "store-pulled": pull, "store-scam": scam });
        await new Promise(r => setTimeout(r, 300));
        const stopped = { running: D.plugins.get("store-pulled").running, stops: (window as any).__test.pulledStops ?? 0 };
        await D.plugins.setEnabled("store-pulled", true);
        return {
            ...stopped,
            afterSwitch: D.plugins.get("store-pulled").running,
            runs: (window as any).__test.pulledRuns ?? 0,
            setting: D.settings.data.plugins["store-pulled"]?.enabled,
            told: (window as any).__test.storage.getItem("evi-pull-notices") ?? "",
        };
    }, { pull: { ...pulled["store-pulled"], at: PULLED_AT + 60_000 }, scam: pulled["store-scam"] });
    check("kill switch: a pull arriving at runtime stops the running plugin; switching it on doesn't start it",
        !repulled.running && repulled.stops === 1 && !repulled.afterSwitch && repulled.runs === 1 && repulled.setting === true && repulled.told.includes(`store-pulled@${PULLED_AT + 60_000}`), repulled);
}

// A plugin's settings open in a dialog: the list underneath doesn't move, Escape closes only the dialog
await findPlugin("fast-lists");
const dialog = await page.evaluate(async () => {
    const body = document.querySelector(".dl-body") as HTMLElement;
    const row = document.querySelector('li[aria-labelledby="dl-plugin-fast-lists"]') as HTMLElement;
    body.scrollTop = row.offsetTop - 120;
    await new Promise(r => setTimeout(r, 100));
    const before = { scrollTop: body.scrollTop, rowTop: row.getBoundingClientRect().top, rowHeight: row.offsetHeight };
    (row.querySelector('[aria-label="Fast Lists settings"]') as HTMLElement).click();
    await new Promise(r => setTimeout(r, 400));
    const open = document.querySelector('[role="dialog"]#dl-plugin-fast-lists-settings');
    const after = { scrollTop: body.scrollTop, rowTop: row.getBoundingClientRect().top, rowHeight: row.offsetHeight };
    return { before, after, open: !!open, fields: open?.querySelectorAll(".dl-setting, [role=switch], input").length ?? 0, focused: !!open?.contains(document.activeElement) };
});
await page.screenshot({ path: join(OUT, "ui-plugin-settings.png") });
await page.keyboard.press("Escape");
// It animates out first: wait for it to leave rather than a fixed time
await page.waitForSelector("#dl-plugin-fast-lists-settings", { state: "detached", timeout: 2000 }).catch(() => { });
const afterEscape = await page.evaluate(() => ({ dialog: !!document.querySelector("#dl-plugin-fast-lists-settings"), panel: !!document.querySelector(".dl-panel") }));
check("plugin settings open in a dialog and the list doesn't move", dialog.open && dialog.fields > 0 && dialog.focused && JSON.stringify(dialog.before) === JSON.stringify(dialog.after), dialog);
check("Escape closes the settings dialog, not the Evi panel", !afterEscape.dialog && afterEscape.panel, afterEscape);

// No Track's settings show a count its native module keeps: ctx.native.call reaches the bridge
await findPlugin("no-track");
const native = await page.evaluate(async () => {
    const row = document.querySelector('li[aria-labelledby="dl-plugin-no-track"]') as HTMLElement;
    (row.querySelector('[aria-label="No Track settings"]') as HTMLElement).click();
    await new Promise(r => setTimeout(r, 400));
    return { calls: (window as any).__test.nativeCalls, text: document.querySelector("#dl-plugin-no-track-settings")?.textContent ?? "" };
});
check("ctx.native.call reaches the bridge", native.calls.some((c: unknown[]) => c[0] === "no-track" && c[1] === "getBlockedCount") && native.text.includes("42"), native);
await page.keyboard.press("Escape");
await page.waitForSelector("#dl-plugin-no-track-settings", { state: "detached", timeout: 2000 }).catch(() => { });

// Inside Discord's settings screen, Discord's focus lock pulls focus back whenever it leaves. The
// dialog is rendered into <body>, outside it: without its own focus layer a dropdown lost focus as
// it opened and closed again. Discord's real lock goes on the panel here, standing in for its settings.
{
    const unlock = await page.evaluate(() => {
        const { api } = (window as any).Evi;
        const lock = api.findExport(api.filters.byCode("disableReturn", "containerRef", ".children"));
        if (!lock) return false;
        const host = document.createElement("div");
        host.id = "evi-test-settings-lock";
        document.body.append(host);
        const root = api.createRoot(host);
        root.render(api.React.createElement(lock.exports[lock.key], { containerRef: { current: document.querySelector(".dl-panel") } }));
        (window as any).__unlockSettings = () => { root.unmount(); host.remove(); };
        return true;
    });
    await findPlugin("friend-online-alerts");
    const row = page.locator('li[aria-labelledby="dl-plugin-friend-online-alerts"]');
    await row.scrollIntoViewIfNeeded();
    await row.locator('[aria-label="Friend Online Alerts settings"]').click();
    await page.waitForSelector("#dl-plugin-friend-online-alerts-settings", { timeout: 3000 });
    const focus = await page.evaluate(async () => {
        const combobox = document.querySelector<HTMLElement>('#dl-plugin-friend-online-alerts-settings [role="combobox"]');
        combobox?.focus();
        await new Promise(r => setTimeout(r, 150));
        return { combobox: !!combobox, stays: !!combobox && document.activeElement === combobox, active: (document.activeElement as HTMLElement)?.className?.toString().slice(0, 40) };
    });
    const box = await page.locator('#dl-plugin-friend-online-alerts-settings [role="combobox"]').first().boundingBox();
    if (box) await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(400);
    const opened = await page.evaluate(() => !!document.querySelector('[role="listbox"]'));
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    if (await page.locator("#dl-plugin-friend-online-alerts-settings").count()) await page.keyboard.press("Escape");
    await page.waitForSelector("#dl-plugin-friend-online-alerts-settings", { state: "detached", timeout: 2000 }).catch(() => { });
    await page.evaluate(() => (window as any).__unlockSettings?.());
    check("plugin dropdowns open on the first click inside Discord's settings (the dialog keeps focus under Discord's focus lock)",
        unlock && focus.stays && opened, { unlock, focus, opened });
}

// Evi's own dropdown: a long list opens in a layer with a filter box and no scrollbar, keys pick, Escape closes only the list
{
    await findPlugin("hover-converter");
    const row = page.locator('li[aria-labelledby="dl-plugin-hover-converter"]');
    await row.scrollIntoViewIfNeeded();
    await row.locator('[aria-label="Hover Converter settings"]').click();
    await page.waitForSelector("#dl-plugin-hover-converter-settings", { timeout: 3000 });
    const combo = page.locator('#dl-plugin-hover-converter-settings [role="combobox"]').first();
    await combo.click();
    await page.waitForSelector(".dl-select-layer [role=listbox]", { timeout: 2000 });
    await page.waitForTimeout(300);
    const open = await page.evaluate(() => {
        const list = document.querySelector<HTMLElement>(".dl-select-layer .dl-select-options")!;
        const popout = document.querySelector<HTMLElement>(".dl-select-popout")!;
        const dialog = document.querySelector<HTMLElement>("#dl-plugin-hover-converter-settings")!;
        return {
            inBody: !dialog.contains(popout),
            options: list.querySelectorAll("[role=option]").length,
            scrolls: list.scrollHeight > list.clientHeight,
            scrollbar: getComputedStyle(list).scrollbarWidth,
            gutter: list.offsetWidth - list.clientWidth,
            filterFocused: document.activeElement?.classList.contains("dl-select-filter") ?? false,
            expanded: document.querySelector('#dl-plugin-hover-converter-settings [role="combobox"]')?.getAttribute("aria-expanded"),
            selectedInView: (() => {
                const sel = list.querySelector<HTMLElement>("[aria-selected=true]");
                if (!sel) return true;
                const a = sel.getBoundingClientRect(), b = list.getBoundingClientRect();
                return a.top >= b.top - 1 && a.bottom <= b.bottom + 1;
            })(),
        };
    });
    await page.screenshot({ path: join(OUT, "ui-dropdown-long.png") });
    await page.keyboard.type("euro");
    await page.waitForTimeout(100);
    const filtered = await page.locator(".dl-select-layer [role=option]").allTextContents();
    await page.keyboard.press("Enter");
    await page.waitForSelector(".dl-select-layer", { state: "detached", timeout: 2000 }).catch(() => { });
    const picked = (await combo.textContent()) ?? "";
    const backOnButton = await page.evaluate(() => document.activeElement?.getAttribute("role") === "combobox");
    // Keyboard from the button: open, move, Escape closes the list but not the dialog
    await combo.focus();
    await page.keyboard.press("ArrowDown");
    await page.waitForSelector(".dl-select-layer [role=listbox]", { timeout: 2000 });
    await page.keyboard.press("Escape");
    await page.waitForSelector(".dl-select-layer", { state: "detached", timeout: 2000 }).catch(() => { });
    const afterEscape = await page.evaluate(() => ({
        list: !!document.querySelector(".dl-select-layer"),
        dialog: !!document.querySelector("#dl-plugin-hover-converter-settings"),
    }));
    await page.keyboard.press("Escape");
    await page.waitForSelector("#dl-plugin-hover-converter-settings", { state: "detached", timeout: 2000 }).catch(() => { });
    check("Evi's dropdown: a long list opens over the dialog with a filter and no scrollbar; typing filters, Enter picks, Escape closes just the list",
        open.inBody && open.options > 30 && open.scrolls && open.scrollbar === "none" && open.gutter === 0 && open.filterFocused && open.expanded === "true" && open.selectedInView
        && filtered.length >= 1 && filtered.every(f => /euro/i.test(f)) && /EUR/.test(picked) && backOnButton && !afterEscape.list && afterEscape.dialog,
        { open, filtered, picked, backOnButton, afterEscape });
}

// The same dropdown for plugins, from @evi/api, in a plugin's own layer outside Evi's views:
// styled by Evi's tokens there too, and a disabled option can't be picked
{
    await page.evaluate(() => {
        const api = (window as any).Evi.api;
        const { React } = api;
        const w = window as any;
        w.__ddPicked = "a";
        // openLayer's callback isn't a component: the state lives in one
        function Host() {
            const [value, setValue] = React.useState("a");
            return React.createElement("div", { id: "dd-plugin-host", className: "evi-scrim", style: { position: "fixed", inset: 0, zIndex: 10005, display: "grid", placeItems: "center" } },
                React.createElement("div", { className: "evi-modal", style: { width: 360, padding: 20, borderRadius: 12, background: "#242429" } },
                    React.createElement(api.Dropdown, {
                        label: "Server",
                        value,
                        onChange: (v: string) => { setValue(v); w.__ddPicked = v; },
                        options: [
                            { value: "a", label: "Alpha (12 slots left)" },
                            { value: "full", label: "Full server (full)", disabled: true },
                            { value: "c", label: "Charlie (3 slots left)" },
                        ],
                    })));
        }
        w.__ddClose = api.openLayer(() => React.createElement(Host));
    });
    const combo = page.locator('#dd-plugin-host [role="combobox"]');
    await combo.waitFor({ timeout: 2000 });
    const button = await combo.evaluate(el => {
        const cs = getComputedStyle(el);
        return { height: el.getBoundingClientRect().height, radius: cs.borderTopLeftRadius, appearance: cs.appearance, inRoot: !!el.closest(".dl-root") };
    });
    await combo.click();
    await page.waitForSelector(".dl-select-layer [role=listbox]", { timeout: 2000 });
    await page.waitForTimeout(300);
    const disabled = await page.locator('.dl-select-layer [role=option][aria-disabled="true"]').count();
    await page.screenshot({ path: join(OUT, "ui-plugin-dropdown.png") });
    await page.locator('.dl-select-layer [role=option][aria-disabled="true"]').click({ force: true });
    await page.waitForTimeout(150);
    const afterDisabled = await page.evaluate(() => (window as any).__ddPicked);
    await page.locator(".dl-select-layer [role=option]", { hasText: "Charlie" }).click();
    await page.waitForSelector(".dl-select-layer", { state: "detached", timeout: 2000 }).catch(() => { });
    const picked = await page.evaluate(() => (window as any).__ddPicked);
    await page.evaluate(() => (window as any).__ddClose({ instant: true }));
    check("plugins get Evi's dropdown from @evi/api: styled outside Evi's views, a disabled option can't be picked",
        button.inRoot && button.height >= 36 && button.radius !== "0px" && disabled === 1 && afterDisabled === "a" && picked === "c",
        { button, disabled, afterDisabled, picked });
}

// A plugin's details: what it can touch, and its whole changelog
await findPlugin("view-icons");
await page.locator('li[aria-labelledby="dl-plugin-view-icons"]').getByRole("button", { name: "View Icons details" }).click();
await page.waitForSelector("#dl-plugin-view-icons-info", { timeout: 2000 });
await page.waitForTimeout(300);
const pluginDetails = await page.evaluate(() => document.querySelector("#dl-plugin-view-icons-info")?.textContent ?? "");
await page.screenshot({ path: join(OUT, "ui-plugin-details.png") });
const detailsWanted = ["Permissions", "What’s new", "Lives in profiles now", "First release."];
check("Plugin details list its permissions with risk levels and its changelog", detailsWanted.every(t => pluginDetails.includes(t)), { missing: detailsWanted.filter(t => !pluginDetails.includes(t)), text: pluginDetails.slice(0, 200) });
await page.keyboard.press("Escape");
await page.waitForTimeout(200);

// View-icons: Download in the image viewer, and banners that open in it

const viewIcons = await page.evaluate(async () => {
    const { api, plugins, diagnosePatches } = (window as any).Evi;
    const { sleep } = (window as any).__qa;
    const HASH = "0123456789abcdef0123456789abcdef";
    await plugins.setEnabled("view-icons", true);
    const self = (window as any).Evi.$("view-icons");
    const open = api.find(api.filters.byCode("markSessionStarted", "hasMediaOptions:!"));
    const row = () => document.querySelector('[aria-label="Zoom In"]')?.closest("div")?.parentElement?.parentElement;
    const bar = () => [...(row()?.querySelectorAll("[aria-label]") ?? [])].map(e => e.getAttribute("aria-label"));
    const close = async () => {
        (row()?.querySelector('[aria-label="Close"]') as HTMLElement | null)?.click();
        for (let i = 0; i < 30 && document.querySelector('[aria-label="Zoom In"]'); i++) await sleep(100);
        await sleep(300);
    };
    const item = (url: string) => ({ type: "IMAGE", url, original: url, proxyUrl: url, width: 256, height: 256, contentType: "image/png" });

    // An avatar, opened the way a profile opens it: zoom, then ours
    open?.({ items: [item("https://cdn.discordapp.com/embed/avatars/1.png")], startingIndex: 0, location: "test", shouldHideMediaOptions: true });
    await sleep(1500);
    const avatarBar = bar();
    const ours = document.querySelector('[aria-label="Download"]');
    const discordStyled = !!ours && !ours.classList.contains("evi-vi-download");
    await close();
    // Not a profile picture: nothing added
    open?.({ items: [item("https://cdn.discordapp.com/attachments/1/2/cat.png")], startingIndex: 0, location: "test", shouldHideMediaOptions: true });
    await sleep(1200);
    const attachmentBar = bar();
    await close();

    // The banner patch, and the button it adds: fills the banner and opens it in the viewer
    for (const id of api.findModuleIds("pendingAccentColor", "animateOnHoverOrFocusOnly")) api.requireModule(id);
    const patches = diagnosePatches().filter((d: any) => d.plugin === "view-icons").map((d: any) => d.state);
    const root = document.createElement("div");
    root.style.cssText = "position:fixed;left:0;top:0;width:340px;height:120px;";
    const fill = document.createElement("div");
    // Left static, like it may be in Discord: the plugin positions it
    fill.style.cssText = "width:100%;height:100%;";
    root.appendChild(fill);
    document.body.appendChild(root);
    const reactRoot = api.createRoot(fill);
    const bannerUrl = `https://cdn.discordapp.com/embed/avatars/2.png`;
    reactRoot.render(self.renderBanner({ username: "alice" }, bannerUrl, api.React.createElement("span", { id: "evi-vi-overlay" })));
    await sleep(200);
    const button = fill.querySelector(".evi-vi-banner") as HTMLElement | null;
    const rect = button?.getBoundingClientRect();
    const fills = !!rect && Math.round(rect.width) === 340 && Math.round(rect.height) === 120;
    const keepsOverlay = !!fill.querySelector("#evi-vi-overlay");
    const noButtonForPending = self.renderBanner({ username: "alice" }, "data:image/png;base64,AA", null) === null;
    button?.click();
    await sleep(2500);
    const bannerBar = bar();
    const bannerShown = !!document.querySelector(`img[src^="${bannerUrl}"]`);
    await close();
    reactRoot.unmount();
    root.remove();
    const hashLink = self.renderDownload({ type: "IMAGE", url: `https://cdn.discordapp.com/avatars/10/${HASH}.webp?size=80` }, true) !== null
        && self.renderDownload({ type: "IMAGE", url: `https://cdn.discordapp.com/avatars/10/${HASH}.webp?size=80` }, false) === null;
    await plugins.setEnabled("view-icons", false);
    return { avatarBar, discordStyled, attachmentBar, patches, fills, keepsOverlay, noButtonForPending, bannerBar, bannerShown, hashLink };
});
check("view-icons: Download sits right after zoom in the viewer for profile pictures, in Discord's own button style, and not for attachments",
    viewIcons.avatarBar[0] === "Zoom In" && viewIcons.avatarBar[1] === "Download" && viewIcons.discordStyled && !viewIcons.attachmentBar.includes("Download") && viewIcons.hashLink, viewIcons);
check("view-icons: both patches apply, and a banner gets a button filling it that opens it in the viewer with Download",
    viewIcons.patches.length === 2 && viewIcons.patches.every((s: string) => s === "applied") && viewIcons.fills && viewIcons.keepsOverlay && viewIcons.noButtonForPending
    && viewIcons.bannerBar.includes("Download") && viewIcons.bannerShown, viewIcons);

// view-icons: Profile details shows each colour as a row with Copy and Apply buttons, no menus, no scrollbar
{
    const shown = await page.evaluate(async () => {
        const { api, plugins } = (window as any).Evi;
        const { sleep } = (window as any).__qa;
        await plugins.setEnabled("view-icons", true);
        const self = (window as any).Evi.$("view-icons");
        const root = document.createElement("div");
        root.id = "evi-vi-test-banner";
        root.style.cssText = "position:fixed;left:0;top:0;width:340px;height:120px;";
        document.body.appendChild(root);
        const user = { id: "1", username: "southkoreadays", globalName: "jay", displayNameStyles: { fontId: 3, effectId: 2, colors: [0xff5ea8, 0x7c5cff] }, collectibles: { nameplate: { label: "Koi Pond", skuId: "1234567890" } } };
        api.createRoot(root).render(self.renderBanner(user, "https://cdn.discordapp.com/embed/avatars/2.png", null, { themeColors: [0x1e1f22, 0x5865f2], accentColor: 0xffffff }));
        await sleep(200);
        (root.querySelector(".evi-vi-details") as HTMLElement | null)?.click();
        await sleep(600);
        const modal = document.querySelector(".evi-vi-modal");
        const body = modal?.querySelector<HTMLElement>(".evi-vi-body");
        return {
            rows: [...modal?.querySelectorAll(".evi-vi-swatch") ?? []].map(li => ({
                label: li.querySelector(".evi-vi-swatch-label")?.textContent,
                value: li.querySelector(".evi-vi-swatch-value")?.textContent,
                buttons: [...li.querySelectorAll("button")].map(b => b.getAttribute("aria-label")),
            })),
            sectionButtons: [...modal?.querySelectorAll(".evi-vi-section-action") ?? []].map(b => b.textContent),
            menus: modal?.querySelectorAll('[role="menu"]').length ?? -1,
            scrollbar: body ? body.offsetWidth - body.clientWidth : -1,
            scrollbarWidth: body ? getComputedStyle(body).scrollbarWidth : "",
        };
    });
    await page.locator(".evi-vi-modal").screenshot({ path: join(OUT, "view-icons-details.png") }).catch(() => { });
    await page.locator(".evi-vi-swatch").first().locator("button").first().click().catch(() => { });
    await page.waitForTimeout(150);
    const copiedLabel = await page.locator(".evi-vi-swatch").first().locator("button").first().getAttribute("aria-label").catch(() => null);
    await page.locator(".evi-vi-close").click().catch(() => { });
    await page.waitForTimeout(400);
    await page.evaluate(async () => {
        document.getElementById("evi-vi-test-banner")?.remove();
        await (window as any).Evi.plugins.setEnabled("view-icons", false);
    });
    check("view-icons: Profile details lists each colour with its hex (no #) and Copy/Apply buttons, section buttons for the whole theme and name style, no menus and no scrollbar",
        shown.rows.length === 5 && shown.rows.every(r => !!r.value && !r.value.includes("#") && r.buttons.length >= 1)
        && shown.rows[0].buttons.length === 2 && shown.rows.some(r => r.label === "Gradient start") && shown.rows.find(r => r.label === "Banner")?.value?.toLowerCase() === "ffffff"
        && shown.sectionButtons.includes("Use this theme") && shown.sectionButtons.includes("Use this name style")
        && shown.menus === 0 && shown.scrollbar === 0 && shown.scrollbarWidth === "none" && !!copiedLabel?.startsWith("Copied"), { ...shown, copiedLabel });
}

// A plugin's details: what it actually did, grouped by host, a host its code doesn't name flagged, no query strings
await findPlugin("net-user");
await page.locator('li[aria-labelledby="dl-plugin-net-user"]').getByRole("button", { name: "Net User details" }).click();
await page.waitForSelector('#dl-plugin-net-user-info [data-plugin-activity="net-user"] li[data-host]', { timeout: 3000 }).catch(() => { });
const activity = await page.evaluate(() => {
    const section = document.querySelector('#dl-plugin-net-user-info [data-plugin-activity="net-user"]');
    const rows = [...section?.querySelectorAll("li[data-host]") ?? []].map(li => ({ host: li.getAttribute("data-host"), unexpected: li.hasAttribute("data-unexpected"), text: li.textContent ?? "" }));
    return { text: section?.textContent ?? "", rows };
});
await page.locator('#dl-plugin-net-user-info [data-plugin-activity="net-user"]').screenshot({ path: join(OUT, "ui-plugin-activity.png") }).catch(() => { });
const named = activity.rows.find(r => r.host === "api.eviactivity.test");
const sneaky = activity.rows.find(r => r.host === "sneaky.eviactivity.test");
check("Plugin details: Activity lists the hosts it contacted, flags one its code doesn't name, and keeps no query strings",
    activity.text.includes("Activity") && !!named && !named.unexpected && named.text.includes("Contacted api.eviactivity.test") && named.text.includes("GET /v1/ping")
    && !!sneaky && sneaky.unexpected && sneaky.text.includes("Not in its code") && sneaky.text.includes("POST /collect")
    && !activity.text.includes("hunter2") && !activity.text.includes("id=1") && !activity.text.includes("secret"), activity);
await page.locator('#dl-plugin-net-user-info [data-plugin-activity="net-user"]').getByRole("button", { name: "Clear" }).click().catch(() => { });
await page.waitForTimeout(100);
const cleared = await page.evaluate(() => document.querySelector('#dl-plugin-net-user-info [data-plugin-activity="net-user"]')?.textContent ?? "");
check("Plugin details: Clear empties its Activity", cleared.includes("Nothing yet since Discord started."), cleared.slice(0, 200));
await page.keyboard.press("Escape");
await page.waitForTimeout(200);

// A plugin that failed to start offers a crash report for its author
await findPlugin("broken");
await page.locator('li[aria-labelledby="dl-plugin-broken"]').getByRole("button", { name: "Copy crash report" }).click();
await page.waitForTimeout(200);
const report = await page.evaluate(() => navigator.clipboard.readText().catch(e => `clipboard: ${e}`));
check("Copy crash report copies the error, versions and patches", report.startsWith(`Evi crash report: ${BROKEN} (broken)`) && report.includes("kaboom") && /Evi: {6}\S/.test(report) && report.includes("Other enabled store plugins:"), report.slice(0, 200));
await page.locator('li[aria-labelledby="dl-plugin-broken"]').screenshot({ path: join(OUT, "ui-crash-report.png") });

// Bulk actions: everything off, then undo puts back exactly what was on
const enabledIds = () => page.evaluate(() => {
    const D = (window as any).Evi;
    return D.plugins.getSnapshot().filter((p: any) => D.settings.data.plugins[p.manifest.id]?.enabled ?? p.manifest.enabledByDefault ?? false).map((p: any) => p.manifest.id).sort();
});
const enabledBefore = await enabledIds();
await page.getByRole("group", { name: "All plugins" }).getByRole("button", { name: "Turn all off" }).click();
await page.waitForSelector("#dl-bulk-undo", { timeout: 5000 });
const enabledAfterOff = await enabledIds();
const undoText = await page.evaluate(() => document.querySelector("#dl-bulk-undo")?.closest(".dl-notice")?.textContent ?? "");
check("Turn all off turns every plugin off and offers undo", enabledAfterOff.length === 0 && enabledBefore.length > 0 && undoText.includes(`Turned off ${enabledBefore.length} plugins`), { enabledBefore, enabledAfterOff, undoText });
await page.screenshot({ path: join(OUT, "ui-bulk-undo.png") });
await page.click("#dl-bulk-undo");
await page.waitForTimeout(500);
const enabledAfterUndo = await enabledIds();
check("Undo turns the same plugins back on", JSON.stringify(enabledAfterUndo) === JSON.stringify(enabledBefore), enabledAfterUndo);

await openTab("advanced", "patches");
await page.waitForTimeout(200);
await page.screenshot({ path: join(OUT, "ui-patches.png") });

// Performance: what each plugin's code cost (clear-urls' sendMessage hook ran in the hooks check)
await openTab("advanced", "performance");
await page.waitForSelector("#dl-perf-live table", { timeout: 5000 }).catch(() => { });
const perf = await page.evaluate(() => {
    const { perf } = (window as any).Evi;
    const clearUrls = perf.snapshot().find((p: any) => p.plugin === "clear-urls");
    return {
        overhead: perf.measureOverhead() as number,
        clearUrls: clearUrls && { calls: clearUrls.calls as number, sites: clearUrls.sites.map((s: any) => `${s.name}: ${s.calls}`) as string[] },
        row: document.querySelector('#dl-perf-live tr[data-plugin="clear-urls"]')?.textContent ?? null,
        headers: [...document.querySelectorAll("#dl-perf-live thead th")].map(th => th.textContent),
    };
});
check("Performance tab lists each plugin's time, and clear-urls' hook shows up with calls", perf.headers.includes("Since start") && !!perf.row?.includes("Clear URLs") && (perf.clearUrls?.calls ?? 0) > 0 && !!perf.clearUrls?.sites.some((s: string) => s.startsWith("before sendMessage")), perf);
check(`Measuring a call costs under a microsecond (${perf.overhead.toFixed(3)} µs in Chrome)`, perf.overhead > 0 && perf.overhead < 1, perf.overhead);

// A recording shows exactly what ran while it did, and Discord's long tasks
await page.getByRole("button", { name: "Start recording" }).click();
// In a timer, a task of the page's own: DevTools' evaluate doesn't count as one for long tasks
await page.evaluate(() => new Promise<void>(resolve => setTimeout(() => {
    const spin = (ms: number) => { const end = performance.now() + ms; while (performance.now() < end); };
    const obj = { f: () => spin(1) };
    const unhook = (window as any).Evi.api.hook(obj, "f", "after", () => spin(20), "perf-web-test");
    for (let i = 0; i < 3; i++) obj.f();
    unhook();
    resolve();
})));
await page.waitForTimeout(100);
await page.getByRole("button", { name: "Stop recording" }).click();
await page.waitForSelector('#dl-perf-recording tr[data-plugin="perf-web-test"]', { timeout: 3000 }).catch(() => { });
await page.getByRole("button", { name: "Where perf-web-test spends time" }).click().catch(() => { });
await page.waitForTimeout(300);
const recorded = await page.evaluate(() => {
    const row = document.querySelector('#dl-perf-recording tr[data-plugin="perf-web-test"]');
    return {
        summary: document.querySelector("#dl-perf-recording [role=status]")?.textContent ?? "",
        cells: row ? [...row.querySelectorAll("td")].map(td => td.textContent) : null,
        sites: row?.nextElementSibling?.textContent ?? "",
    };
});
await page.screenshot({ path: join(OUT, "ui-performance.png") });
check("A recording lists the hook that ran during it: 3 calls, about 60 ms, where it hooked",
    recorded.cells?.[1] === "3" && parseFloat(recorded.cells?.[0] ?? "") >= 55 && recorded.sites.includes("after f"), recorded);
check("A recording says how long Discord was held up by long tasks", /Recorded \d/.test(recorded.summary) && /Discord was busy for \d+ ms in \d+ long task/.test(recorded.summary), recorded.summary);

// Memory: what main measured, and the restart while away, off until turned on
const memoryBefore = await page.evaluate(() => ({
    rows: [...document.querySelectorAll("#dl-perf-memory tbody tr")].map(tr => tr.textContent),
    limitOpen: document.querySelector("#dl-perf-idle-limit")?.hasAttribute("data-open") ?? null,
}));
await page.evaluate(() => (window as any).Evi.settings.update((d: any) => void (d.idleRestart = true)));
await page.waitForTimeout(300);
const memoryAfter = await page.evaluate(() => ({
    limitOpen: document.querySelector("#dl-perf-idle-limit")?.hasAttribute("data-open") ?? null,
    limit: document.querySelector("#dl-perf-idle-limit-select")?.textContent ?? null,
}));
await page.evaluate(() => (window as any).Evi.settings.update((d: any) => void delete d.idleRestart));
check("Performance tab shows Discord's memory, and the limit only once the idle restart is on", memoryBefore.rows.some(r => r?.includes("1.9 GB")) && memoryBefore.rows.some(r => r?.includes("300 MB"))
    && memoryBefore.limitOpen === false && memoryAfter.limitOpen === true && !!memoryAfter.limit?.includes("4 GB"), { memoryBefore, memoryAfter });
// Discord's Game Mode: off until switched on here
const gameModeToggle = () => page.evaluate(() => {
    const el = document.querySelector<HTMLElement>("#dl-perf-game-mode input[type=checkbox], #dl-perf-game-mode [role=switch]");
    el?.click();
    return !!el;
});
const gameModeBefore = await page.evaluate(() => {
    const section = document.querySelector("#dl-perf-game-mode");
    const el = section?.querySelector<HTMLInputElement>("input[type=checkbox], [role=switch]");
    return { shown: !!el, checked: el ? el.checked ?? el.getAttribute("aria-checked") === "true" : null, label: section?.textContent ?? null };
});
await page.locator("#dl-perf-game-mode").scrollIntoViewIfNeeded().catch(() => { });
await page.screenshot({ path: join(OUT, "ui-performance-game-mode.png") });
await gameModeToggle();
await page.waitForTimeout(100);
const gameModeOn = await page.evaluate(() => ({ setting: (window as any).Evi.settings.data.gameMode, enabled: (window as any).Evi.api.findStore("GameModeStore")?.enabled }));
await gameModeToggle();
await page.waitForTimeout(100);
const gameModeOff = await page.evaluate(() => (window as any).Evi.settings.data.gameMode);
check("Performance tab: Discord's Game Mode switch, off by default, turns it on and off", gameModeBefore.shown && gameModeBefore.checked === false && !!gameModeBefore.label?.includes("Use Discord’s Game Mode") && gameModeOn.setting === true && gameModeOn.enabled === true && gameModeOff === false, { gameModeBefore, gameModeOn, gameModeOff });

await openTab("themes", "quickcss");
await page.fill("#dl-quickcss", "body { outline: 3px solid rgb(255, 0, 128) !important; }");
await page.waitForTimeout(500);
const quickCss = await page.evaluate(() => getComputedStyle(document.body).outlineColor);
check("Quick CSS applies live", quickCss === "rgb(255, 0, 128)", quickCss);
await page.screenshot({ path: join(OUT, "ui-quickcss.png") });

// Patch Helper: develop the experiments plugin's own patch live against Discord's code
await openTab("advanced", "patchhelper");
await page.fill("#dl-ph-find", "Object.defineProperties(this,{isDeveloper");
await page.fill("#dl-ph-match", String.raw`/(?<=isDeveloper:\{[^}]*?get:\(\)=>)\i/`);
await page.fill("#dl-ph-replace", "true");
await page.waitForFunction(() => {
    const status = document.querySelector("#dl-tabpanel [role=status]")?.textContent ?? "";
    return status.startsWith("Checked") && document.querySelector("#dl-ph-result") && !document.querySelector("[data-checking]");
}, null, { timeout: 5000 }).catch(() => { });
const helper = await page.evaluate(() => {
    const status = (id: string) => {
        const el = document.querySelector(`#${id} .dl-card-head .dl-status`);
        return { tone: el?.getAttribute("data-tone"), text: el?.textContent };
    };
    return {
        modules: status("dl-ph-modules"),
        match: status("dl-ph-match"),
        result: status("dl-ph-result"),
        after: document.querySelector("#dl-ph-result mark[data-kind=added]")?.textContent,
        snippet: document.querySelector("#dl-ph-snippet pre")?.textContent,
    };
});
check("Patch Helper: find matches exactly 1 module", helper.modules.tone === "success" && helper.modules.text === "1 module", helper.modules);
check("Patch Helper: match succeeds", helper.match.tone === "success" && /^Matched/.test(helper.match.text ?? ""), helper.match);
check("Patch Helper: patched module compiles", helper.result.tone === "success" && helper.result.text === "Compiles" && helper.after === "true", helper.result);
check("Patch Helper: copyable snippet in plugin format", !!helper.snippet?.includes(String.raw`match: /(?<=isDeveloper:\{[^}]*?get:\(\)=>)\i/,`) && !!helper.snippet?.includes('with: "true"'), helper.snippet);
await page.screenshot({ path: join(OUT, "ui-patch-helper.png") });
await page.evaluate(() => { const body = document.querySelector("#dl-tabpanel")!; body.scrollTop = body.scrollHeight; });
await page.screenshot({ path: join(OUT, "ui-patch-helper-result.png") });

await page.fill("#dl-ph-replace", "true)");
await page.waitForFunction(() => document.querySelector("#dl-ph-result .dl-status")?.textContent === "Doesn’t compile", null, { timeout: 5000 }).catch(() => { });
const broken = await page.evaluate(() => document.querySelector("#dl-ph-result .dl-error")?.textContent ?? null);
check("Patch Helper: reports a patch that breaks compilation", !!broken?.includes("SyntaxError"), broken?.slice(0, 120));

await openTab("themes", "installed");
await page.waitForSelector("#dl-theme-web-test_css", { timeout: 5000 });
await page.waitForTimeout(200);
await page.screenshot({ path: join(OUT, "ui-themes.png") });

// Discord's switch is a transparent checkbox under its styled track, click it the way the plugin test does
const clickThemeSwitch = () => page.evaluate(() => (document.querySelector('[aria-labelledby="dl-theme-web-test_css"][role="switch"]') as HTMLElement).click());
const themeVar = (name: string) => page.evaluate(n => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name);
const themeCard = await page.evaluate(() => document.querySelector("#dl-tabpanel")!.textContent);
check("Themes tab lists the theme with its metadata", ["Web Test", "Paints a marker", "By Evi", "web-test.css"].every(t => themeCard!.includes(t)));
check("disabled theme isn't applied", (await themeVar("--dl-test-theme")) === "");

await clickThemeSwitch();
await page.waitForTimeout(300);
const themeOn = {
    value: await themeVar("--dl-test-theme"),
    saved: await page.evaluate(() => (window as any).__test.savedSettings?.enabledThemes),
    beforeQuickCss: await page.evaluate(() => document.getElementById("evi-theme-web-test.css")?.nextElementSibling?.id),
};
check("switch applies the theme and persists it", themeOn.value === "on" && themeOn.saved?.includes("web-test.css"), themeOn);
check("theme is inserted before Quick CSS", themeOn.beforeQuickCss === "evi-quickcss", themeOn.beforeQuickCss);

await page.evaluate(() => (window as any).__test.themeListeners.forEach((cb: any) => cb({
    type: "upsert",
    theme: { file: "web-test.css", name: "Web Test", css: ":root { --dl-test-theme: edited; }" },
})));
await page.waitForTimeout(100);
check("editing the theme file restyles live", (await themeVar("--dl-test-theme")) === "edited");

await clickThemeSwitch();
await page.waitForTimeout(300);
check("switching it off removes the theme", (await themeVar("--dl-test-theme")) === "" && !(await page.$('[id="evi-theme-web-test.css"]')));

await page.fill("#dl-theme-url", "http://example.com/theme.css");
await page.getByRole("button", { name: "Add from URL" }).click();
await page.waitForTimeout(200);
const refused = await page.evaluate(() => document.querySelector(".dl-add-status")?.textContent);
check("Add from URL shows why a link was refused", refused === "Only https:// links are allowed", refused);

await page.fill("#dl-theme-url", "https://example.com/theme.css");
await page.keyboard.press("Enter");
await page.waitForTimeout(300);
const added = {
    status: await page.evaluate(() => document.querySelector(".dl-add-status")?.textContent),
    value: await themeVar("--dl-remote-theme"),
    listed: !!(await page.$("#dl-theme-remote_css")),
};
check("Add from URL lists the theme and turns it on", added.value === "on" && added.listed && /Remote Theme/.test(added.status ?? ""), added);
await page.screenshot({ path: join(OUT, "ui-themes-added.png") });

await openTab("general", "backup");
await page.getByRole("button", { name: "Export backup" }).click();
await page.waitForTimeout(200);
const exportStatus = await page.evaluate(() => document.querySelector("#dl-tabpanel [role=status]")?.textContent);
check("Backup: export reports where it saved", exportStatus === "Saved to C:\\Users\\you\\Documents\\evi-backup-2026-09-26.json", exportStatus);

await page.getByRole("button", { name: "Choose backup file" }).click();
await page.waitForSelector(".dl-backup-preview", { timeout: 5000 });
await page.waitForTimeout(200);
const backupPreview = await page.evaluate(() => document.querySelector(".dl-backup-preview")?.textContent ?? "");
check("Backup: preview shows the file and what changes", [
    "evi-backup-2026-09-20.json", "with Evi v0.1.0", "Turns on 1 plugin: Toolkit Demo", "Overwrites 1 theme",
    "Keeps your Quick CSS", "Spotify Controls", "plugins/spotify-controls", "Merge backup",
].every(t => backupPreview.includes(t)), backupPreview.slice(0, 300));
await page.screenshot({ path: join(OUT, "ui-backup.png") });

await page.getByRole("button", { name: "Merge backup" }).click();
await page.waitForTimeout(300);
const restored = {
    applied: await page.evaluate(() => (window as any).__test.applied),
    status: await page.evaluate(() => [...document.querySelectorAll("#dl-tabpanel [role=status]")].map(e => e.textContent).join(" | ")),
    theme: await themeVar("--dl-test-theme"),
    previewGone: !(await page.$(".dl-backup-preview")),
};
check("Backup: restoring applies the new settings live", restored.applied?.mode === "merge" && restored.theme === "edited" && restored.previewGone && restored.status.includes("Restored evi-backup-2026-09-20.json, 7 changes applied"), restored);
await page.screenshot({ path: join(OUT, "ui-backup-restored.png") });

await openTab("plugins", "installed");
await page.waitForSelector("#dl-plugin-see-updates", { timeout: 5000 });
const storeTab = await page.evaluate(() => ({
    pill: document.querySelector("#dl-subtab-plugins-store .dl-tabbar-count")?.textContent,
    notice: document.querySelector("#dl-plugin-see-updates")?.closest(".dl-notice")?.textContent ?? "",
}));
check("Plugins says when store updates are ready: a count on the Store tab and a notice", !!storeTab.pill && Number(storeTab.pill) > 0 && /update/.test(storeTab.notice), storeTab);
await page.click("#dl-plugin-see-updates");
await page.waitForSelector('[data-store-id="store-rpc"]', { timeout: 5000 });
await page.waitForTimeout(200);
await page.screenshot({ path: join(OUT, "ui-store.png") });
const storeCard = (id: string) => page.evaluate(i => document.querySelector(`[data-store-id="${i}"]`)?.textContent ?? "", id);
const storeList = {
    clock: await storeCard("store-clock"),
    quiet: await storeCard("store-quiet"),
    rpc: await storeCard("store-rpc"),
    sync: await storeCard("store-theme-sync"),
};
check("Store view lists plugins with description, authors and version", storeList.clock.includes("Message Clock") && storeList.clock.includes("exact send time") && storeList.clock.includes("v1.0.0 · By Evi"), storeList.clock);
check("Store shows Install, Update + Uninstall, and Installed states", /Install$/.test(storeList.clock) && storeList.quiet.includes("v1.2.0 → v1.3.0") && storeList.quiet.includes("Uninstall") && storeList.sync.includes("Installed"), storeList);

// Stars: counts on every card, one click stars, and it's sent to main
const starLabel = (id: string) => page.evaluate(i => document.querySelector(`[data-store-id="${i}"] .dl-star`)?.getAttribute("aria-label") ?? "", id);
const starsBefore = { clock: await starLabel("store-clock"), quiet: await starLabel("store-quiet") };
await page.locator('[data-store-id="store-clock"] .dl-star').click();
await page.waitForTimeout(200);
const starsAfter = { clock: await starLabel("store-clock"), calls: await page.evaluate(() => (window as any).__test.stars) };
check("Stars: cards show counts, and starring counts once and is sent to main",
    starsBefore.clock === "Star Message Clock, 41 stars" && starsBefore.quiet === "Unstar Quiet Mode, 7 stars"
    && starsAfter.clock === "Unstar Message Clock, 42 stars" && JSON.stringify(starsAfter.calls) === '[{"kind":"plugin","id":"store-clock","starred":true}]', { starsBefore, starsAfter });
await page.screenshot({ path: join(OUT, "ui-store-grid.png") });
check("native plugins carry a badge", storeList.rpc.includes("Native") && !storeList.clock.includes("Native"));

// The store's community side: front page, ratings, hearts, Not installed, a plugin's page
{
    const home = await page.evaluate(() => {
        const h = document.querySelector(".dl-home");
        return { text: h?.textContent ?? "", hero: h?.querySelector(".dl-home-row[data-hero] h3")?.textContent ?? "", tiles: h?.querySelectorAll(".dl-home-tile").length ?? 0 };
    });
    // "New this week" left the front page in 1.2.0
    check("Store front page: staff picks first, then trending", home.hero === "Staff picks" && home.text.includes("Trending") && !home.text.includes("New this week") && home.tiles >= 4, home);
    await page.locator(".dl-home").screenshot({ path: join(OUT, "ui-store-home.png") }).catch(() => { });
    const clock = await storeCard("store-clock");
    check("Store cards show a plugin's rating", clock.includes("4.5") && clock.includes("(2)"), clock);

    await page.locator('[data-store-id="store-clock"] .dl-wish').click();
    await page.waitForTimeout(100);
    const wished = await page.evaluate(() => ({ list: (window as any).Evi.settings.data.wishlist, pressed: document.querySelector('[data-store-id="store-clock"] .dl-wish')?.getAttribute("aria-pressed") }));
    check("Hearting a plugin puts it on the wishlist", JSON.stringify(wished.list) === '["plugin:store-clock"]' && wished.pressed === "true", wished);
    await page.locator('[data-store-id="store-clock"] .dl-wish').click();

    await page.locator(".dl-store-controls").getByText("Not installed", { exact: false }).first().click();
    await page.waitForTimeout(200);
    const notInstalled = await page.evaluate(() => ({
        cards: [...document.querySelectorAll("[data-store-id]")].map(el => el.getAttribute("data-store-id")),
        home: !!document.querySelector(".dl-home"),
    }));
    check("Not installed shows only what you don't have, and the front page steps aside", notInstalled.cards.includes("store-clock") && !notInstalled.cards.includes("store-quiet") && !notInstalled.home, notInstalled);
    // The store remembers where you were: leaving the tab and coming back keeps the filter
    await openTab("plugins", "installed");
    await openTab("plugins", "store");
    await page.waitForSelector('[data-store-id="store-clock"]', { timeout: 5000 });
    const kept = await page.evaluate(() => [...document.querySelectorAll("[data-store-id]")].map(el => el.getAttribute("data-store-id")));
    check("The store keeps its filter when you switch tabs and come back", kept.includes("store-clock") && !kept.includes("store-quiet"), kept);
    // Back to everything
    // The "All" chip (its label is followed by a count), not "All categories"
    await page.locator(".dl-store-controls").getByText(/^All\s*\d+$/).first().click();
    await page.waitForSelector('[data-store-id="store-lookup"]', { timeout: 5000 });

    await page.locator('[data-store-id="store-clock"] .dl-store-card-link').click();
    await page.waitForSelector(".dl-reviews", { timeout: 3000 }).catch(() => { });
    const detail = await page.evaluate(() => ({
        reviews: document.querySelector(".dl-reviews")?.textContent ?? "",
        note: document.querySelector(".dl-store-note")?.textContent ?? "",
        related: [...document.querySelectorAll(".dl-home-row")].map(r => r.textContent ?? "").join(" | "),
        facts: document.querySelector(".dl-store-facts")?.textContent ?? "",
    }));
    check("A plugin's page: rating, reviews, the author's note, installs and what people also install",
        detail.reviews.includes("4.5") && detail.reviews.includes("Bob") && detail.reviews.includes("Exactly what I wanted.") && detail.reviews.includes("Install it to rate it")
        && detail.note.includes("Times follow your clock settings.") && detail.facts.includes("1,234") && detail.related.includes("People also install") && detail.related.includes("Quiet Mode"), detail);
    await page.screenshot({ path: join(OUT, "ui-store-detail-reviews.png"), fullPage: true });
    await page.getByRole("button", { name: "Report review" }).click();
    await page.waitForTimeout(100);
    check("Reporting a review sends it and says thanks", JSON.stringify(await page.evaluate(() => (window as any).__test.reviewReports)) === "[7]" && (await page.evaluate(() => document.querySelector(".dl-reviews")?.textContent ?? "")).includes("Reported"));
    // Back to the list: the page's first button
    await page.locator(".dl-store-detail > div > button").first().click();
    await page.waitForSelector('[data-store-id="store-lookup"]', { timeout: 3000 });
}
check("Store cards say when evi.rest knows a plugin is broken", storeList.quiet.includes("Broken since Discord’s update") && (await storeCard("store-lookup")).includes("Being looked into") && !storeList.clock.includes("Broken"), storeList.quiet);

// A verified author: a check next to their name, which opens their page
const verified = await page.locator('[data-store-id="store-lookup"]').getByRole("button", { name: "Evi, verified author" });
const verifiedCheck = await page.locator('[data-store-id="store-lookup"] .dl-verified').count();
await verified.click();
await page.waitForSelector('[data-store-author="evi"]', { timeout: 2000 });
const authorPage = await page.evaluate(() => {
    const view = document.querySelector('[data-store-author="evi"]')!;
    return {
        text: view.textContent ?? "",
        site: [...view.querySelectorAll("a")].find(a => a.textContent === "View on evi.rest")?.getAttribute("href"),
        cards: [...view.querySelectorAll("[data-store-id]")].map(e => e.getAttribute("data-store-id")),
    };
});
await page.screenshot({ path: join(OUT, "ui-store-author.png") });
check("a verified author has a check and opens their page: bio, links and their plugins",
    verifiedCheck === 1 && ["Evi", "Verified author", "The people who make Evi.", "GitHub"].every(t => authorPage.text.includes(t))
    && authorPage.site === "https://evi.rest/author?u=evi" && JSON.stringify(authorPage.cards) === '["store-clock","store-lookup"]', authorPage);
await page.getByRole("button", { name: "Plugin Store", exact: true }).click();
await page.waitForSelector('[data-store-id="store-clock"]', { timeout: 2000 });

// Back from a plugin's page lands where you were: same page of the list, same scroll, that card focused
{
    await page.evaluate(async () => {
        const native = (window as any).__test.native;
        const list = native.storeList;
        (window as any).__test.storeListBeforeFiller = list;
        native.storeList = async () => {
            const listing = await list();
            const file = (id: string, name: string) => ({ url: `https://example.com/${id}/${name}`, sha256: "0".repeat(64) });
            for (let n = 1; n <= 20; n++) {
                const id = `store-filler-${String(n).padStart(2, "0")}`;
                listing.plugins.push({
                    id, name: `Filler ${String(n).padStart(2, "0")}`, description: "Fills the store to a second page.", authors: ["Evi"], version: "1.0.0",
                    tags: [], native: false, minEviVersion: "0.1.0", screenshots: [], changelog: [],
                    files: { "manifest.json": file(id, "manifest.json"), "index.js": file(id, "index.js") },
                });
            }
            return listing;
        };
        await (window as any).Evi.store.refresh();
    });
    await page.waitForSelector('[data-store-id="store-filler-01"]', { timeout: 5000 });
    await page.getByRole("button", { name: "Page 2", exact: true }).click();
    await page.waitForTimeout(150);
    // Scroll the store's scroller (the panel's body) part way down page 2
    const before = await page.evaluate(() => {
        const card = document.querySelector<HTMLElement>(".dl-store-grid li:nth-child(4)")!;
        let scroller = card.parentElement;
        while (scroller && !(/auto|scroll/.test(getComputedStyle(scroller).overflowY) && scroller.scrollHeight > scroller.clientHeight)) scroller = scroller.parentElement;
        scroller!.scrollTop = Math.min(scroller!.scrollHeight - scroller!.clientHeight, scroller!.scrollTop + 260);
        return { top: scroller!.scrollTop, id: card.getAttribute("data-store-id"), page: document.querySelector('.dl-pagination [aria-current="page"]')?.textContent };
    });
    await page.waitForTimeout(150);
    await page.locator(`[data-store-id="${before.id}"] .dl-store-card-link`).click();
    await page.waitForSelector(`[data-store-detail="${before.id}"]`, { timeout: 3000 });
    await page.locator(".dl-store-detail > div > button").first().click();
    await page.waitForSelector(`[data-store-id="${before.id}"]`, { timeout: 3000 });
    await page.waitForTimeout(100);
    const after = await page.evaluate(id => {
        const card = document.querySelector<HTMLElement>(`[data-store-id="${id}"]`)!;
        let scroller = card.parentElement;
        while (scroller && !(/auto|scroll/.test(getComputedStyle(scroller).overflowY) && scroller.scrollHeight > scroller.clientHeight)) scroller = scroller.parentElement;
        return {
            top: scroller?.scrollTop ?? -1,
            page: document.querySelector('.dl-pagination [aria-current="page"]')?.textContent,
            focused: document.activeElement?.closest("[data-store-id]")?.getAttribute("data-store-id"),
        };
    }, before.id);
    await page.screenshot({ path: join(OUT, "ui-store-back.png") });
    check("Back from a plugin's page: the same page of the list, the same scroll and that card focused",
        before.page === "2" && after.page === "2" && Math.abs(after.top - before.top) <= 5 && before.top > 0 && after.focused === before.id, { before, after });

    // Alt+Left goes back too
    await page.locator(`[data-store-id="${before.id}"] .dl-store-card-link`).click();
    await page.waitForSelector(`[data-store-detail="${before.id}"]`, { timeout: 3000 });
    await page.keyboard.press("Alt+ArrowLeft");
    const altBack = await page.waitForSelector(`[data-store-id="${before.id}"]`, { timeout: 2000 }).then(() => true, () => false);
    check("Alt+Left goes back from a plugin's page to the list", altBack);

    await page.evaluate(async () => {
        (window as any).__test.native.storeList = (window as any).__test.storeListBeforeFiller;
        await (window as any).Evi.store.refresh();
    });
    await page.getByRole("button", { name: "Page 1", exact: true }).click().catch(() => { });
    await page.waitForSelector('[data-store-id="store-clock"]', { timeout: 5000 });
}

const filters = await page.evaluate(() => document.querySelector(".dl-store-controls")?.textContent ?? "");
check("Store filters by updates, installed and category, and sorts", ["All", "Updates", "Installed", "Official", "Community", "All categories", "Name"].every(t => filters.includes(t)), filters);

// The card itself opens the page: click its middle, not the title
// force: the card's stretched link is what takes the click, on purpose
await page.locator('[data-store-id="store-clock"] .dl-store-card-desc').click({ force: true });
await page.waitForSelector('[data-store-detail="store-clock"]', { timeout: 2000 });
await page.getByRole("button", { name: "Plugin Store", exact: true }).click();
await page.waitForSelector('[data-store-id="store-clock"]', { timeout: 2000 });

// The detail page: description, screenshots, access, source and changelog
await page.locator('[data-store-id="store-clock"] .dl-store-card-link').click();
await page.waitForSelector('[data-store-detail="store-clock"] .dl-store-shot img', { timeout: 5000 });
const detail = await page.evaluate(() => document.querySelector('[data-store-detail="store-clock"]')?.textContent ?? "");
check("Store detail page shows screenshots, access, source and changelog", ["Message Clock", "exact send time", "Runs inside Discord only", "View source", "What’s new", "12 and 24 hour clocks", "Updated"].every(t => detail.includes(t)), detail.slice(0, 300));
await page.waitForSelector('[data-store-permissions="store-clock"] [data-capability="network"]', { timeout: 3000 }).catch(() => { });
const storePermissions = await page.evaluate(() => document.querySelector('[data-store-permissions="store-clock"]')?.textContent ?? "");
check("Store detail lists permissions read from the plugin's code before install", ["Permissions", "Medium risk", "Connects to the internet", "time.example.net", "Adds menu items"].every(t => storePermissions.includes(t)), storePermissions.slice(0, 300));
await page.screenshot({ path: join(OUT, "ui-store-detail.png") });
await page.getByRole("button", { name: "Plugin Store", exact: true }).click();
await page.waitForSelector('[data-store-id="store-clock"]', { timeout: 2000 });

// View source: Evi's own go to the repository; a community plugin's to the exact code it installs,
// with whatever its author linked (a port's original) kept apart
{
    const links = () => page.evaluate(() => [...document.querySelectorAll("[data-store-detail] a.dl-store-source")].map(a => [a.textContent, (a as HTMLAnchorElement).href]));
    await page.locator('[data-store-id="store-clock"] .dl-store-card-link').click();
    await page.waitForSelector('[data-store-detail="store-clock"]', { timeout: 2000 });
    const official = await links();
    await page.getByRole("button", { name: "Plugin Store", exact: true }).click();
    await page.locator('[data-store-id="store-community"] .dl-store-card-link').click();
    await page.waitForSelector('[data-store-detail="store-community"]', { timeout: 2000 });
    const community = await links();
    await page.getByRole("button", { name: "Plugin Store", exact: true }).click();
    await page.waitForSelector('[data-store-id="store-clock"]', { timeout: 2000 });
    check("View source opens a community plugin's published code, its author's link kept as Project link",
        JSON.stringify(official) === JSON.stringify([["View source", "https://github.com/BleedDev/evi"]])
        && JSON.stringify(community) === JSON.stringify([["View source", "https://example.com/store-community/index.js"], ["Project link", "https://github.com/Vendicated/Vencord/tree/main/src/plugins/emojiTray"]]), { official, community });
}

await page.fill("#dl-plugin-store-search", "privacy");
await page.waitForTimeout(150);
const searched = await page.evaluate(() => [...document.querySelectorAll("[data-store-id]")].map(e => e.getAttribute("data-store-id")));
check("Store search matches tags", JSON.stringify(searched) === '["store-quiet"]', searched);
// Typos and word order are forgiven, and results come while typing
await page.fill("#dl-plugin-store-search", "clok mesage");
await page.waitForTimeout(150);
const forgiving = await page.evaluate(() => [...document.querySelectorAll("[data-store-id]")].map(e => e.getAttribute("data-store-id")));
check("Store search forgives typos and word order", JSON.stringify(forgiving) === '["store-clock"]', forgiving);
await page.fill("#dl-plugin-store-search", "");

const storeButton = (id: string, name: string) => page.locator(`[data-store-id="${id}"]`).getByRole("button", { name, exact: true });

// Official and community: Evi's own say By Evi with the check, everyone else's are marked Community
{
    const community = await storeCard("store-community");
    const scam = await storeCard("store-scam");
    const scamInstall = await storeButton("store-scam", "Install").count();
    check("community plugins carry a Community label, Evi's own don't",
        community.includes("Community") && community.includes("By Mira") && !storeList.clock.includes("Community") && (await page.locator('[data-store-id="store-clock"] .dl-verified').count()) === 1, { community, clock: storeList.clock });
    check("a version Evi pulled shows Pulled instead of Install", scam.includes("Pulled") && scamInstall === 0, scam);

    const shown = () => page.evaluate(() => [...document.querySelectorAll(".dl-store-grid [data-store-id]")].map(e => e.getAttribute("data-store-id")));
    await page.locator(".dl-store-controls").getByText(/^Community/).first().click();
    await page.waitForTimeout(200);
    const communityOnly = await shown();
    await page.screenshot({ path: join(OUT, "ui-store-community.png") });
    await page.locator(".dl-store-controls").getByText(/^Official/).first().click();
    await page.waitForTimeout(200);
    const officialOnly = await shown();
    await page.locator(".dl-store-controls").getByText(/^All \d/).first().click();
    await page.waitForTimeout(200);
    check("the store filters Official and Community plugins",
        JSON.stringify(communityOnly) === '["store-community","store-scam","store-pulled"]' && officialOnly.length === 5 && !officialOnly.includes("store-community"), { communityOnly, officialOnly });

    // The first install of a community plugin asks first, saying who made it
    await storeButton("store-community", "Install").click();
    await page.waitForSelector('#dl-store-community-store-community[role="dialog"]', { timeout: 2000 });
    await page.locator('[data-store-id="store-community"]').screenshot({ path: join(OUT, "ui-store-community-confirm.png") });
    const ask = await page.evaluate(() => ({
        text: document.querySelector('#dl-store-community-store-community')?.textContent ?? "",
        installs: (window as any).__test.storeInstalls.length,
    }));
    check("installing a community plugin the first time asks first",
        ask.text.includes("Install a community plugin?") && ask.text.includes("Made by Mira, not by Evi. Evi’s team reviewed this version before it went into the store.") && ask.installs === 0, ask);
    await page.locator('#dl-store-community-store-community').getByRole("button", { name: "Install", exact: true }).click();
    await page.waitForTimeout(300);
    const confirmed = await page.evaluate(() => ({
        calls: (window as any).__test.storeInstalls.map((c: any) => c.id),
        remembered: (window as any).__test.storage.getItem("evi-community-installs") ?? "",
    }));
    check("confirming installs it, and remembers it asked", JSON.stringify(confirmed.calls) === '["store-community"]' && confirmed.remembered.includes("store-community"), confirmed);

    // Its page says who made it, and it can be reported to Evi's team
    await page.locator('[data-store-id="store-community"] .dl-store-card-link').click();
    await page.waitForSelector('[data-store-detail="store-community"]', { timeout: 2000 });
    await page.waitForTimeout(200);
    const communityDetail = await page.evaluate(() => document.querySelector('[data-store-detail="store-community"]')?.textContent ?? "");
    await page.screenshot({ path: join(OUT, "ui-store-community-detail.png") });
    check("a community plugin's page says who made it and that Evi reviewed it",
        communityDetail.includes("Community") && communityDetail.includes("Made by Mira, not by Evi. Evi’s team reviewed this version before it went into the store."), communityDetail.slice(0, 300));

    const detail = page.locator('[data-store-detail="store-community"]');
    await detail.getByRole("button", { name: "Report", exact: true }).click();
    await page.waitForSelector("#dl-report-store-community", { timeout: 2000 });
    await page.waitForTimeout(300);
    const dialog = page.locator("#dl-report-store-community");
    await dialog.getByLabel("Something else").check();
    await dialog.getByRole("button", { name: "Send report" }).click();
    await page.waitForTimeout(150);
    const refused = await page.evaluate(() => {
        const box = document.querySelector("#dl-report-store-community")!;
        return {
            title: document.querySelector("#dl-report-store-community-title")?.textContent,
            legend: box.querySelector("fieldset legend")?.textContent,
            radios: box.querySelectorAll("fieldset input[type=radio]").length,
            error: box.querySelector("[role=alert]")?.textContent,
            invalid: box.querySelector("textarea")?.getAttribute("aria-invalid"),
            focused: document.activeElement?.tagName,
            text: box.textContent ?? "",
            sent: (window as any).__test.pluginReports.length,
        };
    });
    await page.screenshot({ path: join(OUT, "ui-report-dialog.png") });
    check("Report: a dialog with the reasons as a radio group; Something else needs details before it sends",
        refused.title === "Report Emoji Tray" && refused.legend === "What’s wrong?" && refused.radios === 5 && refused.error === "Say what's wrong" && refused.invalid === "true" && refused.focused === "TEXTAREA"
        && refused.text.includes("Reports go to Evi’s team, not the author. If this install is linked to your Discord account, they can see who sent it.") && refused.sent === 0, refused);
    await dialog.locator("textarea").fill("It adds a link to a giveaway site to every message.");
    await dialog.getByRole("button", { name: "Send report" }).click();
    await page.waitForSelector("#dl-report-store-community", { state: "detached", timeout: 2000 }).catch(() => { });
    const sent = await page.evaluate(() => ({
        calls: (window as any).__test.pluginReports,
        row: document.querySelector('[data-report="store-community"]')?.textContent ?? "",
        disabled: [...document.querySelectorAll('[data-report="store-community"] button')].find(b => b.textContent === "Reported")?.hasAttribute("disabled") ?? false,
    }));
    await page.locator('[data-report="store-community"]').screenshot({ path: join(OUT, "ui-report-sent.png") });
    check("Report sends once to main, then says Reported and thanks you",
        sent.calls.length === 1 && sent.calls[0].id === "store-community" && sent.calls[0].input.reason === "other" && sent.calls[0].input.details === "It adds a link to a giveaway site to every message."
        && sent.row.includes("Thanks. Evi’s team will look at it.") && sent.disabled, sent);

    await page.getByRole("button", { name: "Plugin Store", exact: true }).click();
    await page.waitForSelector('[data-store-id="store-clock"]', { timeout: 2000 });
}
const installsBeforeClick = await page.evaluate(() => (window as any).__test.storeInstalls.length);
await storeButton("store-rpc", "Install").click();
await page.waitForSelector('#dl-store-confirm-store-rpc[role="dialog"]', { timeout: 2000 });
await page.screenshot({ path: join(OUT, "ui-store-native-confirm.png") });
const confirmText = await page.evaluate(() => document.querySelector("#dl-store-confirm-store-rpc")?.textContent ?? "");
const installsBeforeConfirm = await page.evaluate(() => (window as any).__test.storeInstalls.length);
check("installing a native plugin asks first, explaining full access", /full access to your computer/.test(confirmText) && installsBeforeConfirm === installsBeforeClick, confirmText.slice(0, 120));
await page.locator("#dl-store-confirm-store-rpc").getByRole("button", { name: "Install with full access", exact: true }).click();
await page.waitForTimeout(300);
const nativeInstall = {
    calls: await page.evaluate(() => (window as any).__test.storeInstalls),
    card: await storeCard("store-rpc"),
};
check("confirming installs with allowNative and shows the result", nativeInstall.calls.at(-1)?.options?.allowNative === true && nativeInstall.card.includes("Installed and turned on"), nativeInstall);

await page.getByRole("button", { name: "Store settings" }).click();
await page.waitForTimeout(250);
const autoUpdate = await page.evaluate(() => document.querySelector(".dl-tab")?.textContent?.includes("Update automatically"));
check("Store offers automatic updates", !!autoUpdate);
const healthSetting = await page.evaluate(() => document.querySelector(".dl-tab")?.textContent?.includes("Help spot broken plugins"));
check("Store settings can turn off plugin health reports", !!healthSetting);
const pending = await page.evaluate(() => document.querySelector(".dl-store-update-list")?.textContent ?? "");
check("the updates banner lists each update with its versions and release notes", /Quiet Mode/.test(pending) && pending.includes("1.2.0 → 1.3.0") && pending.includes("Read states too") && !pending.includes("Typing indicators"), pending);
await page.locator(".dl-store-updates").screenshot({ path: join(OUT, "ui-store-updates.png") });
await page.click("#dl-plugin-update-all");
await page.waitForTimeout(400);
const updated = await storeCard("store-quiet");
check("Update all installs the new version", updated.includes("Updated to v1.3.0") && !updated.includes("Update available"), updated);
await page.screenshot({ path: join(OUT, "ui-store-after.png") });

// Back in the installed list, store plugins carry a badge and can be uninstalled
await page.click("#dl-subtab-plugins-installed");
await findPlugin("store-rpc");
const rpcRow = await page.evaluate(() => document.querySelector('li[aria-labelledby="dl-plugin-store-rpc"]')?.textContent ?? "");
const rpcUninstall = await page.locator('li[aria-labelledby="dl-plugin-store-rpc"]').getByRole("button", { name: "Uninstall store-rpc" }).count();
check("store plugins show a Store badge and an uninstall button in the list", rpcRow.includes("Store") && rpcUninstall === 1, rpcRow);
// Plugins Evi ships with can go too: nothing in the list is stuck
await page.fill("#dl-plugin-search", "");
await page.waitForTimeout(150);
const removable = await page.evaluate(() => [...document.querySelectorAll("li.dl-plugin-card[aria-labelledby^='dl-plugin-']")].map(li => ({
    id: li.getAttribute("aria-labelledby"),
    remove: !!li.querySelector("button[aria-label^='Remove '], button[aria-label^='Uninstall ']"),
})));
check("every plugin in the list, shipped with Evi or not, can be removed", removable.length > 5 && removable.every(r => r.remove), removable.filter(r => !r.remove));

// A store plugin evi.rest knows about: the pill, the author's message, and its own problem linked up
const lookupRowSelector = 'li[aria-labelledby="dl-plugin-store-lookup"]';
const lookupRow = page.locator(lookupRowSelector);
// Turn all off and Undo restarted it: its lookup counts as missing once Discord had time to load it,
// and the list shows that when it next draws
await page.waitForFunction(() => (window as any).Evi.diagnoseLookups("store-lookup").some((d: any) => d.health === "missing"), null, { timeout: 30_000 }).catch(() => { });
await page.click("#dl-tab-themes");
await page.click("#dl-tab-plugins");
await findPlugin("store-lookup");
await lookupRow.getByText("Others are seeing this too.", { exact: false }).waitFor({ timeout: 5000 }).catch(() => { });
const lookupRowText = await page.evaluate(sel => document.querySelector(sel)?.textContent ?? "", lookupRowSelector);
check("the Plugins list shows what evi.rest knows about a plugin, next to its own problem", ["Being looked into", "Evi: Fix coming in 1.0.1", "Can’t find 1 part of Discord", "Others are seeing this too."].every(t => lookupRowText.includes(t)), lookupRowText.slice(0, 300));

// Send to author: shows the report first, sends it once, then says so
await lookupRow.getByRole("button", { name: "Send to author" }).click();
await page.waitForSelector("#dl-crash-send-store-lookup", { timeout: 2000 });
await page.waitForTimeout(250);
const askSend = await page.evaluate(() => ({
    title: document.querySelector("#dl-crash-send-store-lookup-title")?.textContent,
    report: document.querySelector("#dl-crash-send-store-lookup .dl-crash-text")?.textContent ?? "",
    text: document.querySelector("#dl-crash-send-store-lookup")?.textContent ?? "",
    sent: (window as any).__test.crashReports.length,
}));
await page.screenshot({ path: join(OUT, "ui-crash-send.png") });
check("Send to author shows the exact report and who gets it before sending anything",
    askSend.title === "Send this crash report to Evi?" && askSend.report.startsWith("Evi crash report: Store Lookup (store-lookup)") && askSend.report.includes("missing, props eviHealthTestNeverInDiscord")
    && askSend.text.includes("It goes to Evi through evi.rest. It has no messages, tokens or account details.") && askSend.text.includes("Don’t ask again") && askSend.sent === 0, askSend);
await page.locator("#dl-crash-send-store-lookup").getByRole("button", { name: "Send report" }).click();
await lookupRow.getByText("Sent to Evi").waitFor({ timeout: 3000 }).catch(() => { });
const sentCrash = await page.evaluate(sel => ({
    calls: (window as any).__test.crashReports,
    row: document.querySelector(sel)?.textContent ?? "",
    again: [...document.querySelectorAll(`${sel} button`)].find(b => b.textContent === "Sent")?.hasAttribute("disabled") ?? false,
    dialog: !!document.querySelector("#dl-crash-send-store-lookup"),
}), lookupRowSelector);
check("Send report sends it once, then the button says Sent",
    sentCrash.calls.length === 1 && sentCrash.calls[0].plugin === "store-lookup" && sentCrash.calls[0].version === "1.0.0" && sentCrash.calls[0].report === askSend.report
    && sentCrash.row.includes("Sent to Evi") && sentCrash.again && !sentCrash.dialog, { ...sentCrash, calls: sentCrash.calls.map((c: any) => ({ ...c, report: c.report.slice(0, 60) })) });
await lookupRow.screenshot({ path: join(OUT, "ui-crash-sent.png") });

// Plugin health: the store plugin that can't find a part of Discord was reported, once, and nothing else
await page.waitForFunction(() => (window as any).__test.healthReports.length > 0, null, { timeout: 60_000 }).catch(() => { });
const healthReports = await page.evaluate(() => (window as any).__test.healthReports);
check("plugin health: a store plugin that can't find a part of Discord is reported to evi.rest, and only it",
    healthReports.length === 1 && healthReports[0].plugin === "store-lookup" && healthReports[0].version === "1.0.0" && healthReports[0].kind === "lookups" && typeof healthReports[0].discordBuild === "string", healthReports);

await openTab("themes", "store");
await page.waitForSelector('[data-store-id="midnight"]', { timeout: 5000 });
await page.screenshot({ path: join(OUT, "ui-theme-store.png") });
await page.locator('[data-store-id="midnight"]').getByRole("button", { name: "Install", exact: true }).click();
await page.waitForTimeout(400);
const themeInstall = await page.evaluate(() => ({
    calls: (window as any).__test.themeInstalls,
    card: document.querySelector('[data-store-id="midnight"]')?.textContent ?? "",
    enabled: (window as any).Evi.themes.isEnabled("midnight.css"),
    applied: getComputedStyle(document.documentElement).getPropertyValue("--dl-store-theme").trim(),
}));
check("Theme Store installs a theme and turns it on", JSON.stringify(themeInstall.calls) === '["midnight"]' && themeInstall.card.includes("Installed and turned on") && themeInstall.enabled && themeInstall.applied === "midnight", themeInstall);
await page.click("#dl-subtab-themes-installed");
await page.waitForTimeout(200);
const themeRow = await page.evaluate(() => document.querySelector('li[aria-labelledby="dl-theme-midnight_css"]')?.textContent ?? "");
check("store themes show a Store badge in the Themes tab", themeRow.includes("Midnight") && themeRow.includes("Store"), themeRow);

// Evi 1.0: the inbox, DevTools, recording a shortcut, and blob: media under Discord's CSP
{
    await openTab("plugins", "inbox");
    await page.waitForSelector(".dl-inbox-row", { timeout: 5000 }).catch(() => { });
    const inbox = await page.evaluate(() => ({
        rows: [...document.querySelectorAll(".dl-inbox-row")].map(r => r.textContent ?? ""),
        count: document.querySelector("#dl-subtab-plugins-inbox .dl-tabbar-count")?.textContent ?? "",
    }));
    // With the one Evi adds itself: the test's fake update check finds Evi 9.9.0
    check("Inbox lists the account's notifications and Evi's own, with an unread count on its tab", inbox.rows.some(r => r.includes("New review of Message Clock")) && inbox.rows.some(r => r.includes("Evi 9.9.0 is out")) && inbox.count === "2", inbox);
    await page.screenshot({ path: join(OUT, "ui-inbox.png") });
    await page.getByRole("button", { name: "Mark all as read" }).click();
    await page.waitForTimeout(200);
    const read = await page.evaluate(() => ({ sent: (window as any).__test.inboxRead, count: document.querySelector("#dl-subtab-plugins-inbox .dl-tabbar-count")?.textContent ?? "" }));
    check("Mark all as read tells evi.rest and clears the count", read.sent === true && !read.count, read);

    // A notification arriving now pops up in the corner; one that arrived earlier doesn't
    await page.evaluate(() => {
        const D = (window as any).Evi;
        D.settings.update((d: any) => void (d.liveToasts = true));
        D.settings.update((d: any) => void (d.localNotifications = [
            { id: "local:toast-test", kind: "wishlist", title: "Message Clock 2.0.0 is out", body: "Something on your wishlist has a new version.", link: { kind: "plugin", id: "store-clock" }, at: Date.now(), read: false },
            { id: "local:toast-old", kind: "fixed", title: "An old one", body: "Arrived an hour ago", at: Date.now() - 3_600_000, read: false },
            ...(d.localNotifications ?? []),
        ]));
    });
    await page.waitForSelector(".dl-live-toast", { timeout: 3000 }).catch(() => { });
    await page.waitForTimeout(400);
    const toast = await page.evaluate(() => {
        const toasts = [...document.querySelectorAll(".dl-live-toast")];
        const box = toasts[0]?.getBoundingClientRect();
        return {
            count: toasts.length,
            text: toasts.map(t => t.textContent ?? ""),
            role: toasts[0]?.getAttribute("role"),
            corner: !!box && innerWidth - box.right <= 24 && innerHeight - box.bottom <= 24,
        };
    });
    check("a new notification pops up as a toast in the corner, an old one doesn't",
        toast.count === 1 && toast.text[0].includes("Message Clock 2.0.0 is out") && toast.role === "status" && toast.corner, toast);
    await page.screenshot({ path: join(OUT, "ui-live-toast.png") });
    // Hovering holds it; closing plays its exit, then it's gone
    await page.hover(".dl-live-toast-main");
    const held = await page.evaluate(() => getComputedStyle(document.querySelector(".dl-live-toast-timer")!).animationPlayState);
    // The Inbox lists the same notification with its own Dismiss: this one is the toast's
    await page.getByRole("region", { name: "Evi notifications" }).getByRole("button", { name: "Dismiss Message Clock 2.0.0 is out" }).click();
    await page.waitForSelector(".dl-live-toast", { state: "detached", timeout: 2000 }).catch(() => { });
    const gone = await page.evaluate(() => document.querySelectorAll(".dl-live-toast").length);
    check("hovering a toast holds its timer, and its close button takes it away", held === "paused" && gone === 0, { held, gone });
    await page.evaluate(() => (window as any).Evi.settings.update((d: any) => void (d.liveToasts = false)));

    // An announcement from Evi's team arrives live: top and centre, until closed, and only once
    const announce = (list: unknown[]) => page.evaluate(l => {
        const T = (window as any).__test;
        T.announcements = l;
        T.announce?.();
    }, list);
    await announce([{ id: 7, title: "Evi 1.5 is out", body: "Declutter is here.", link: "https://evi.rest/blog", at: Date.now() }]);
    await page.waitForSelector(".dl-announcement", { timeout: 3000 }).catch(() => { });
    await page.waitForTimeout(400);
    const banner = await page.evaluate(() => {
        const el = document.querySelector(".dl-announcement");
        const box = el?.getBoundingClientRect();
        return {
            text: el?.textContent ?? "",
            top: !!box && box.top <= 24,
            centred: !!box && Math.abs(box.left + box.width / 2 - innerWidth / 2) <= 2,
            link: !!el?.querySelector(".dl-announcement-link"),
        };
    });
    check("an announcement shows live, top and centre, with its link", banner.text.includes("Evi 1.5 is out") && banner.text.includes("Declutter is here.") && banner.top && banner.centred && banner.link, banner);
    await page.screenshot({ path: join(OUT, "ui-announcement.png") });
    await page.getByRole("button", { name: "Close announcement" }).click();
    await page.waitForSelector(".dl-announcement", { state: "detached", timeout: 2000 }).catch(() => { });
    await announce([{ id: 7, title: "Evi 1.5 is out", body: "", at: Date.now() }]);
    await page.waitForTimeout(500);
    const after = await page.evaluate(() => ({ shown: document.querySelectorAll(".dl-announcement").length, seen: (window as any).Evi.settings.data.announcementsSeen }));
    check("a closed announcement is remembered and doesn't come back", after.shown === 0 && after.seen?.includes(7), after);
    await announce([{ id: 8, title: "Store maintenance", body: "", at: Date.now() }]);
    await page.waitForSelector(".dl-announcement", { timeout: 3000 }).catch(() => { });
    await announce([]);
    await page.waitForSelector(".dl-announcement", { state: "detached", timeout: 2000 }).catch(() => { });
    check("a withdrawn announcement leaves the screen", await page.evaluate(() => document.querySelectorAll(".dl-announcement").length) === 0);

    await openTab("advanced", "devtools");
    await page.waitForSelector("#dl-dt-flux", { timeout: 5000 }).catch(() => { });
    await page.waitForTimeout(200);
    await page.evaluate(() => (window as any).Evi.api.Dispatcher.dispatch({ type: "EVI_DEVTOOLS_TEST", value: 1 }));
    await page.waitForTimeout(500);
    const flux = await page.evaluate(() => [...document.querySelectorAll(".dl-dt-log-type")].map(el => el.textContent));
    check("DevTools: the Flux log shows actions as Discord dispatches them", flux.includes("EVI_DEVTOOLS_TEST"), flux.slice(0, 5));
    await page.screenshot({ path: join(OUT, "ui-devtools.png") });

    await openTab("plugins", "installed");
    await findPlugin("streamer-mode-plus");
    await page.locator('li[aria-labelledby="dl-plugin-streamer-mode-plus"]').getByRole("button", { name: "Streamer Mode+ settings" }).click();
    await page.waitForSelector("#dl-setting-streamer-mode-plus-hotkey", { timeout: 3000 });
    await page.click("#dl-setting-streamer-mode-plus-hotkey");
    await page.keyboard.press("Shift+KeyG");
    const refused = await page.evaluate(() => document.querySelector("#dl-setting-streamer-mode-plus-hotkey-status")?.textContent ?? "");
    await page.keyboard.press("Control+Alt+KeyK");
    await page.waitForTimeout(150);
    const recorded = await page.evaluate(() => ({
        saved: (window as any).Evi.settings.data.plugins["streamer-mode-plus"]?.settings?.hotkey,
        keys: [...document.querySelectorAll("#dl-setting-streamer-mode-plus-hotkey .dl-kbd")].map(k => k.textContent),
        panelOpen: !!document.querySelector(".dl-panel"),
    }));
    check("Shortcuts are recorded by pressing them: a bare key is refused, Ctrl+Alt+K is saved and shown as keycaps",
        refused.includes("Ctrl or Alt") && recorded.saved === "Ctrl+Alt+KeyK" && recorded.keys.join("+") === "Ctrl+Alt+K" && recorded.panelOpen, { refused, recorded });
    await page.screenshot({ path: join(OUT, "ui-keybind.png") });
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);

    // Wallpapers and store previews reach the page as blob: URLs: Discord's CSP must let them load
    const blobs = await page.evaluate(async () => {
        const violations: string[] = [];
        const onViolation = (e: SecurityPolicyViolationEvent) => violations.push(`${e.violatedDirective} ${e.blockedURI}`);
        document.addEventListener("securitypolicyviolation", onViolation);
        const png = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="), c => c.charCodeAt(0));
        const img = new Image();
        const imgResult = await new Promise<string>(resolve => {
            img.onload = () => resolve("load");
            img.onerror = () => resolve("error");
            img.src = URL.createObjectURL(new Blob([png], { type: "image/png" }));
        });
        const video = document.createElement("video");
        video.muted = true;
        video.src = URL.createObjectURL(new Blob([new Uint8Array(64)], { type: "video/webm" }));
        video.load();
        await new Promise(r => setTimeout(r, 500));
        document.removeEventListener("securitypolicyviolation", onViolation);
        return { img: imgResult, violations };
    });
    check("Discord's CSP lets blob: images and media load (wallpaper, store previews)", blobs.img === "load" && !blobs.violations.some(v => /blob/.test(v)), blobs);

    // Wallpaper: only Discord's main window turns see-through; its settings and popouts stay solid
    // unless asked. Stand-ins carry Discord's own layer class names.
    const wp = await page.evaluate(async () => {
        const { settings } = (window as any).Evi;
        const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
        const canvas = document.createElement("canvas");
        canvas.width = 640;
        canvas.height = 360;
        const g = canvas.getContext("2d")!;
        const gradient = g.createLinearGradient(0, 0, 640, 360);
        gradient.addColorStop(0, "#5865f2");
        gradient.addColorStop(1, "#eb459e");
        g.fillStyle = gradient;
        g.fillRect(0, 0, 640, 360);
        const blob = await new Promise<Blob>(resolve => canvas.toBlob(b => resolve(b!), "image/png"));
        (window as any).__test.wallpaper = { ok: true, file: "wallpaper-1.png", mime: "image/png", bytes: new Uint8Array(await blob.arrayBuffer()) };
        settings.update((d: any) => void (d.wallpaper = { enabled: true, file: "wallpaper-1.png" }));
        for (let i = 0; i < 40 && !(document.querySelector("#evi-wallpaper img.evi-wallpaper-media") as HTMLImageElement | null)?.naturalWidth; i++) await sleep(100);

        const layer = (outer: string, inner?: string) => {
            const el = document.createElement("div");
            el.className = outer;
            let host = el;
            if (inner) {
                host = document.createElement("div");
                host.className = inner;
                el.append(host);
            }
            const child = document.createElement("div");
            host.append(child);
            document.body.append(el);
            return { el, child };
        };
        const base = layer("layers__960e4", "layer__960e4 baseLayer__960e4");
        const settingsLayer = layer("layers__960e4", "layer__960e4");
        const popout = layer("layerContainer__59d0d");
        const read = () => [base, settingsLayer, popout].map(l => getComputedStyle(l.child).getPropertyValue("--background-base-lower").trim());
        await sleep(50);
        const byDefault = read();
        settings.update((d: any) => void (d.wallpaper = { ...d.wallpaper, behindSettings: true, behindPopouts: true }));
        await sleep(100);
        const everywhere = read();
        settings.update((d: any) => void (d.wallpaper = { ...d.wallpaper, behindSettings: false, behindPopouts: false, tint: "neutral", panels: { chat: 30 } }));
        await sleep(100);
        const neutral = read()[0];
        // The picture itself: covers the window, straight and turned
        const cover = () => {
            const r = document.querySelector("#evi-wallpaper .evi-wallpaper-media")!.getBoundingClientRect();
            return { covers: r.left <= 0.5 && r.top <= 0.5 && r.right >= innerWidth - 0.5 && r.bottom >= innerHeight - 0.5, w: Math.round(r.width), h: Math.round(r.height) };
        };
        settings.update((d: any) => void (d.wallpaper = { ...d.wallpaper, tint: "theme", panels: undefined, zoom: 100, x: 50, y: 50, rotation: 0 }));
        await sleep(100);
        const straight = cover();
        settings.update((d: any) => void (d.wallpaper = { ...d.wallpaper, rotation: 90, zoom: 150, x: 0 }));
        await sleep(100);
        const turned = cover();
        settings.update((d: any) => void (d.wallpaper = { ...d.wallpaper, rotation: 0, zoom: 100, x: 50 }));
        const tile = { straight, turned };
        for (const l of [base, settingsLayer, popout]) l.el.remove();
        return { byDefault, everywhere, neutral, tile, theme: document.documentElement.className.match(/theme-\w+/)?.[0], realBaseLayer: !!document.querySelector('[class*="baseLayer_"]') };
    });
    check("wallpaper: the main window goes see-through in the theme's colours, settings and popouts only when asked",
        / 12%, transparent\)$/.test(wp.byDefault[0]) && !wp.byDefault[1].includes("transparent") && !wp.byDefault[2].includes("transparent")
        && wp.everywhere.every(v => v.endsWith("transparent)")) && wp.everywhere[2].endsWith(" 85%, transparent)") && /rgb\((0 0 0|255 255 255) \/ 0\.3\)/.test(wp.neutral), wp);
    check("wallpaper: the picture covers the whole window, straight, turned and zoomed", wp.tile.straight.covers && wp.tile.turned.covers, wp.tile);

    // The login screen (this page is Discord's real one): the wallpaper shows there even with the in-app one off
    const readLogin = () => page.evaluate(() => {
        const box = document.querySelector('[class*="authBox_"]');
        const art = document.querySelector('[class*="characterBackground_"] > [class*="artwork_"]');
        const layer = document.getElementById("evi-wallpaper");
        const alpha = (c: string) => c.startsWith("rgba") ? +c.split(",")[3] : /\/\s*([\d.]+)\)/.exec(c)?.[1] ?? 1;
        return {
            box: !!box, art: !!art,
            boxBg: box ? getComputedStyle(box).backgroundColor : "",
            boxAlpha: box ? +alpha(getComputedStyle(box).backgroundColor) : 1,
            blur: box ? getComputedStyle(box).backdropFilter : "",
            artDisplay: art ? getComputedStyle(art).display : "",
            layer: layer ? getComputedStyle(layer).display : "none",
            bodyBg: getComputedStyle(document.body).backgroundColor,
        };
    });
    await page.evaluate(() => (window as any).Evi.settings.update((d: any) => void (d.wallpaper = { ...d.wallpaper, enabled: false, login: undefined })));
    await page.waitForTimeout(200);
    const loginOff = await readLogin();
    await page.evaluate(() => (window as any).Evi.settings.update((d: any) => void (d.wallpaper = { ...d.wallpaper, enabled: false, login: { show: true, boxOpacity: 60, blur: 12 } })));
    await page.waitForTimeout(400);
    const loginOn = await readLogin();
    // Evi's panel is open over the page: closed for the picture (the tab part opens it again)
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);
    await page.screenshot({ path: join(OUT, "ui-login-wallpaper.png"), fullPage: true });
    await page.keyboard.press("Control+Shift+D");
    await page.waitForSelector(".dl-panel", { timeout: 5000 });
    await page.evaluate(() => (window as any).Evi.settings.update((d: any) => void (d.wallpaper = { ...d.wallpaper, enabled: true, login: { show: false } })));
    await page.waitForTimeout(200);
    check("wallpaper: the login screen shows your wallpaper behind a translucent, blurred box and hides Discord's artwork, even with the in-app wallpaper off",
        loginOn.box && loginOn.art && loginOn.layer === "block" && loginOn.artDisplay === "none" && loginOn.boxAlpha > 0.5 && loginOn.boxAlpha < 0.7 && /blur\(12px\)/.test(loginOn.blur)
        && loginOff.artDisplay !== "none" && loginOff.layer === "none" && loginOff.boxAlpha === 1, { loginOff, loginOn });

    // The tab, and Edit Image like Discord's: drag, scroll to zoom, rotate, then Apply
    await openTab("themes", "wallpaper");
    await page.waitForSelector(".dl-wp-thumb img", { timeout: 3000 });
    await page.evaluate(() => (window as any).Evi.settings.update((d: any) => void (d.wallpaper = { ...d.wallpaper, zoom: 200, x: 50, y: 50, rotation: 0 })));
    const tab = await page.evaluate(() => document.querySelector(".dl-wallpaper")?.textContent ?? "");
    await page.locator(".dl-wallpaper").screenshot({ path: join(OUT, "ui-wallpaper.png") });
    await page.getByRole("button", { name: "Edit image", exact: true }).click();
    await page.waitForSelector("#dl-wp-edit .dl-wp-edit-stage img", { timeout: 3000 });
    await page.waitForTimeout(400);
    const stage = (await page.locator(".dl-wp-edit-stage").boundingBox())!;
    await page.mouse.move(stage.x + stage.width / 2, stage.y + stage.height / 2);
    await page.mouse.down();
    await page.mouse.move(stage.x + stage.width / 2 + 60, stage.y + stage.height / 2 + 30, { steps: 5 });
    await page.mouse.up();
    await page.mouse.wheel(0, -100);
    await page.waitForTimeout(150);
    await page.locator("#dl-wp-edit").getByRole("button", { name: "Rotate" }).click();
    await page.waitForTimeout(200);
    const beforeApply = await page.evaluate(() => ({ ...(window as any).Evi.settings.data.wallpaper }));
    await page.locator("#dl-wp-edit").screenshot({ path: join(OUT, "ui-wallpaper-edit.png") });
    await page.locator("#dl-wp-edit").getByRole("button", { name: "Apply" }).click();
    await page.waitForSelector("#dl-wp-edit", { state: "detached", timeout: 3000 }).catch(() => { });
    const applied = await page.evaluate(() => ({ ...(window as any).Evi.settings.data.wallpaper }));
    check("wallpaper: Edit Image moves, zooms and rotates the picture, and only Apply saves it",
        beforeApply.zoom === 200 && beforeApply.rotation === 0 && applied.x < 50 && applied.y < 50 && applied.zoom === 210 && applied.rotation === 90, { beforeApply, applied });
    check("wallpaper tab: simple by default, the rest under More options",
        ["Edit image", "Show wallpaper", "Dim", "Panel opacity", "More options"].every(x => tab.includes(x)) && !tab.includes("Tile") && !tab.includes("Message box"), tab.slice(0, 400));
    await page.evaluate(() => (window as any).Evi.settings.update((d: any) => void (d.wallpaper = { ...d.wallpaper, enabled: false })));
}

await page.keyboard.press("Escape");
await page.waitForTimeout(300);
check("Escape closes the panel", !(await page.$(".dl-panel")));

check("healthy start reported once plugins ran for a while", await page.evaluate(() => (window as any).__test.bootOk === 1));
// Evi 2.0's tour: the wave's plugins the store lists, picked and turned on, shown once
{
    await page.evaluate(async () => {
        const native = (window as any).__test.native;
        const list = native.storeList;
        native.storeList = async () => {
            const listing = await list();
            const file = (id: string, name: string) => ({ url: `https://example.com/${id}/${name}`, sha256: "0".repeat(64) });
            const entry = (id: string, name: string, description: string, native = false) => ({
                id, name, description, authors: ["Evi"], version: "1.0.0", tags: [], native, minEviVersion: "0.1.0", screenshots: [], changelog: [],
                files: { "manifest.json": file(id, "manifest.json"), "index.js": file(id, "index.js"), ...(native ? { "native.js": file(id, "native.js") } : {}) },
            });
            listing.plugins.push(
                entry("voice-messages", "Desktop Voice Messages", "Record and send voice messages from your PC, with the waveform."),
                entry("fix-embeds", "Fix Embeds", "Rewrites X, Instagram and TikTok links so their videos play in Discord."),
                entry("click-actions", "Click Actions", "Double-click to edit or reply, Shift+click to delete."),
                // Needs consent on its own page: never offered here
                entry("rich-presence", "Rich Presence Builder", "Your own Playing status.", true),
            );
            return listing;
        };
        await (window as any).Evi.store.refresh();
        (window as any).__test.storeInstalls.length = 0;
        (window as any).Evi.showTour2();
    });
    await page.waitForSelector(".dl-tour[role=dialog]", { timeout: 5000 });
    await page.waitForTimeout(800);
    const welcome = await page.evaluate(() => ({
        title: document.querySelector(".dl-tour-title")?.textContent,
        seen: (window as any).Evi.settings.data.tour2Seen,
        scenes: document.querySelectorAll(".dl-tour-welcome .dl-tour-art").length,
    }));
    await page.screenshot({ path: join(OUT, "ui-tour-welcome.png") });
    await page.locator(".dl-tour").getByRole("button", { name: "See what’s new" }).click();
    await page.waitForSelector(".dl-tour-card", { timeout: 5000 });
    await page.waitForTimeout(900);
    const cards = await page.evaluate(() => [...document.querySelectorAll(".dl-tour-card-name")].map(n => n.textContent));
    const playing = await page.evaluate(() => document.querySelectorAll(".dl-tour-art[data-play]").length);
    await page.screenshot({ path: join(OUT, "ui-tour-pick.png") });
    await page.locator('.dl-tour-card:has(#dl-tour-name-voice-messages)').click({ position: { x: 40, y: 40 } });
    await page.locator('.dl-tour-card:has(#dl-tour-name-fix-embeds)').click({ position: { x: 40, y: 40 } });
    const go = page.locator(".dl-tour").getByRole("button", { name: "Turn on selected (2)" });
    await go.waitFor({ timeout: 3000 });
    // Borders and Discord's switches animate: let them settle
    await page.waitForTimeout(500);
    await page.screenshot({ path: join(OUT, "ui-tour-picked.png") });
    await go.click();
    await page.waitForSelector(".dl-tour-done", { timeout: 10_000 });
    await page.waitForTimeout(600);
    const done = await page.evaluate(() => ({
        installs: (window as any).__test.storeInstalls.map((i: any) => i.id),
        enabled: ["voice-messages", "fix-embeds"].map(id => (window as any).Evi.settings.data.plugins[id]?.enabled),
        text: document.querySelector(".dl-tour-done")?.textContent,
    }));
    await page.screenshot({ path: join(OUT, "ui-tour-done.png") });
    const tourExit = await closesWithExit(".dl-tour", () => page.locator(".dl-tour").getByRole("button", { name: "Done", exact: true }).click());
    check("Evi 2.0 tour: once, the wave's store plugins as moving cards, picked ones installed and on, closes with Discord's motion",
        welcome.title === "Make Discord yours" && welcome.seen === true && welcome.scenes === 3
        && JSON.stringify(cards) === '["Desktop Voice Messages","Click Actions","Fix Embeds"]' && playing > 0
        // The wave's plugins are loaded here from plugins/ as local ones: those are switched on rather than installed
        && done.installs.every((id: string) => id === "voice-messages" || id === "fix-embeds") && done.enabled.every(Boolean) && !!done.text?.includes("You’re all set")
        && tourExit.closing && tourExit.gone,
        { welcome, cards, playing, done, tourExit });
}

// A required update: the Developers page requires a version, and an older Evi downloads it and restarts
{
    // Evi asks whether it's a developer's when the Account tab opens
    await page.evaluate(() => { (window as any).__test.account.admin = true; (window as any).Evi.ui.open("general"); });
    await page.waitForSelector("#dl-tab-general", { timeout: 5000 });
    await openTab("general", "account");
    await page.waitForSelector("#dl-tab-developers", { timeout: 5000 });
    await page.click("#dl-tab-developers");
    await page.click("#dl-subtab-developers-overview");
    await page.waitForSelector("#dl-dev-require", { timeout: 5000 });
    await page.locator("#dl-dev-require").scrollIntoViewIfNeeded();
    await page.waitForFunction(() => (document.querySelector("#dl-dev-req-version") as HTMLInputElement | null)?.value === "9.9.0", null, { timeout: 3000 }).catch(() => { });
    const form = await page.evaluate(() => ({
        version: (document.querySelector("#dl-dev-req-version") as HTMLInputElement | null)?.value,
        text: document.querySelector("#dl-dev-require")?.textContent ?? "",
    }));
    await page.locator("#dl-dev-require").screenshot({ path: join(OUT, "ui-developers-require.png") });
    await page.fill("#dl-dev-req-reason", "Fixes plugin toasts");
    await page.locator("#dl-dev-require").getByRole("button", { name: "Require this version" }).click();
    await page.waitForSelector("#dl-dev-req-confirm", { timeout: 3000 });
    await page.screenshot({ path: join(OUT, "ui-developers-require-confirm.png") });
    await page.locator("#dl-dev-req-confirm").getByRole("button", { name: "Make them update" }).click();
    await page.waitForTimeout(300);
    const sent = await page.evaluate(() => ((window as any).__test.devAdmin ?? []).filter((c: any) => c.path === "/admin/required-version" && c.method === "PUT"));
    check("Developers: Require an update defaults to the latest release, asks first, then tells evi.rest",
        form.version === "9.9.0" && form.text.includes("Latest release: 9.9.0") && sent.length === 1 && sent[0].body?.version === "9.9.0" && sent[0].body?.reason === "Fixes plugin toasts" && sent[0].body?.forcePlugins === false,
        { form: { ...form, text: form.text.slice(0, 200) }, sent });
    await page.keyboard.press("Escape");
    await page.evaluate(() => { (window as any).Evi.ui.close?.(); (window as any).__test.account.admin = false; });
    await page.waitForTimeout(300);

    // evi.rest now requires a version newer than this Evi. With automatic updates off it only asks
    const installsBefore = await page.evaluate(() => (window as any).__test.updateInstalls);
    const requireNewer = () => page.evaluate(() => {
        const T = (window as any).__test;
        T.required = { version: "99.0.0", reason: "Fixes plugin toasts", forcePlugins: false, at: Date.now() };
        T.requiredChanged?.();
    });
    await page.evaluate(() => (window as any).Evi.settings.update((d: any) => void (d.silentUpdates = false)));
    await requireNewer();
    await page.waitForSelector(".dl-required", { timeout: 5000 }).catch(() => { });
    await page.waitForTimeout(500);
    const asked = await page.evaluate(() => ({ prepared: (window as any).__test.prepared ?? [], buttons: [...document.querySelectorAll(".dl-required button")].map(b => b.textContent || b.getAttribute("aria-label")) }));
    check("with automatic updates off, a required update asks and downloads nothing", asked.prepared.length === 0 && asked.buttons.includes("Update now"), asked);

    // With them on, it downloads at once and counts down to a restart
    await page.evaluate(() => (window as any).Evi.settings.update((d: any) => void (d.silentUpdates = true)));
    await requireNewer();
    await page.waitForFunction(() => document.querySelector(".dl-required")?.textContent?.includes("99.0.0"), null, { timeout: 5000 }).catch(() => { });
    const first = await page.evaluate(() => document.querySelector(".dl-required")?.textContent ?? "");
    await page.waitForTimeout(2200);
    const later = await page.evaluate(() => ({ text: document.querySelector(".dl-required")?.textContent ?? "", prepared: (window as any).__test.prepared ?? [], buttons: [...document.querySelectorAll(".dl-required button")].map(b => b.textContent || b.getAttribute("aria-label")) }));
    await page.locator(".dl-required").screenshot({ path: join(OUT, "ui-required-update.png") });
    const seconds = (t: string) => Number(t.match(/in (\d+) s/)?.[1] ?? NaN);
    check("a required update downloads at once and counts down to a restart, with Later and no way to hide it unseen",
        later.prepared.includes("99.0.0") && first.includes("Evi 99.0.0 is ready") && later.text.includes("Fixes plugin toasts")
        && seconds(later.text) < seconds(first) && later.buttons.includes("Later") && later.buttons.includes("Restart now") && !later.buttons.includes("Hide"),
        { first, later });
    await page.locator(".dl-required").getByRole("button", { name: "Restart now" }).click();
    await page.waitForTimeout(300);
    const restarted = await page.evaluate(() => ({ installs: (window as any).__test.updateInstalls, text: document.querySelector(".dl-required")?.textContent ?? "" }));
    check("Restart now installs the downloaded update", restarted.installs === installsBefore + 1 && restarted.text.includes("Restarting Discord"), restarted);
}

// The broken plugin's start failures are the point of it
const unexpected = eviErrors.filter(e => !e.includes(BROKEN));
check("no Evi errors in console", unexpected.length === 0, unexpected.slice(0, 5));

// A fresh page that main booted in safe mode, after a crash loop with a few recorded changes
const now = Date.now();
const safeBoot: BootData = {
    ...boot,
    settings: { quickCss: true, plugins: { experiments: { enabled: true } }, enabledThemes: ["web-test.css"] },
    quickCss: "body { outline: 3px solid rgb(255, 0, 128) !important; }",
    safeMode: {
        reason: "crash-loop",
        failures: 2,
        changes: [
            { kind: "plugin", id: "experiments", action: "enabled", at: now - 3 * 60_000 },
            { kind: "theme", id: "web-test.css", action: "updated", at: now - 2 * 3600_000 },
            { kind: "quickCss", id: "quick.css", action: "edited", at: now - 2 * 86400_000 },
        ],
    },
};
const safePage = await browser.newPage({ viewport: { width: 1280, height: 800 } });
safePage.on("console", msg => msg.type() === "error" && msg.text().includes("Evi") && eviErrors.push(`safe mode: ${msg.text()}`));
safePage.on("pageerror", err => eviErrors.push(`safe mode pageerror: ${err.message}`));
await safePage.addInitScript(disablePasskeys);
await safePage.addInitScript(fakeNative, safeBoot);
await safePage.addInitScript(renderer);
await safePage.goto("https://discord.com/login", { waitUntil: "domcontentloaded" });
await safePage.waitForFunction(() => (window as any).Evi?.safeMode.reportedOk && document.querySelector(".dl-safe-float"), null, { timeout: 60_000 });
await safePage.waitForTimeout(300);
await safePage.screenshot({ path: join(OUT, "safe-mode-notice.png") });

const safe = await safePage.evaluate(() => {
    const D = (window as any).Evi;
    const css = (el: Element, prop: string) => getComputedStyle(el).getPropertyValue(prop).trim();
    const notice = document.querySelector(".dl-safe-float .dl-safe")!;
    return {
        active: D.safeMode.active,
        running: D.plugins.getSnapshot().filter((p: any) => p.running).map((p: any) => p.manifest.id),
        evaluated: D.plugins.getSnapshot().filter((p: any) => p.definition).map((p: any) => p.manifest.id),
        listed: D.plugins.getSnapshot().length,
        patches: D.diagnosePatches().filter((d: any) => d.plugin !== "evi").length,
        theme: css(document.documentElement, "--dl-test-theme"),
        outline: css(document.body, "outline-color"),
        bootOk: (window as any).__test.bootOk,
        text: notice.textContent,
        buttons: [...notice.querySelectorAll("button")].map(b => b.textContent || b.getAttribute("aria-label")),
        labelled: document.getElementById(notice.getAttribute("aria-labelledby")!)?.textContent,
    };
});
check("safe mode: no plugin evaluated, started or patching, all still listed", safe.active && !safe.running.length && !safe.evaluated.length && !safe.patches && safe.listed === plugins.length, safe);
check("safe mode: enabled theme and Quick CSS not applied", safe.theme === "" && safe.outline !== "rgb(255, 0, 128)", { theme: safe.theme, outline: safe.outline });
check("safe mode start is still reported healthy", safe.bootOk === 1);
check("notice explains why and names the newest change that's still on", safe.labelled === "Evi is in safe mode" && safe.text.includes("last 2 times")
    && /Most recent change: Experiments \(plugin, turned on 3 minutes ago\)/.test(safe.text) && /Also changed recently:Web Test \(theme, updated 2 hours ago\)Quick CSS \(edited 2 days ago\)/.test(safe.text), safe.text);
check("notice offers disabling it and leaving safe mode", ["Disable Experiments and restart", "Exit safe mode and restart", "Hide safe mode notice"].every(b => safe.buttons.includes(b)), safe.buttons);

await safePage.getByRole("button", { name: "Hide safe mode notice" }).click();
check("notice can be hidden, and fades out first", await safePage.waitForSelector(".dl-safe-float", { state: "detached", timeout: 2000 }).then(() => true, () => false));

await safePage.keyboard.press("Control+Shift+D");
await safePage.waitForSelector(".dl-panel .dl-safe", { timeout: 5000 });
await safePage.waitForTimeout(300);
await safePage.screenshot({ path: join(OUT, "safe-mode-plugins.png") });
await findPlugin("experiments", safePage);
const paused = await safePage.evaluate(() => document.querySelector('[aria-labelledby="dl-plugin-experiments"]')?.textContent ?? "");
check("Plugins tab repeats the notice, enabled plugins show as paused", paused.includes("Paused in safe mode"), paused);

await safePage.click("#dl-tab-themes");
await safePage.waitForTimeout(200);
const themesHint = await safePage.evaluate(() => document.querySelector("#dl-tabpanel .dl-banner")?.textContent ?? "");
check("Themes tab says themes are off in safe mode", themesHint.includes("Safe mode is on: themes aren’t applied"), themesHint);
await safePage.click("#dl-tab-plugins");
await safePage.waitForTimeout(200);

await safePage.evaluate(() => [...document.querySelectorAll(".dl-panel .dl-safe button")].find(b => b.textContent?.includes("Disable Experiments"))!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
await safePage.waitForTimeout(200);
const disabled = await safePage.evaluate(() => ({ saved: (window as any).__test.savedSettings, exited: (window as any).__test.exitedSafeMode }));
check("\"Disable Experiments and restart\" saves it off right away, then leaves safe mode", disabled.saved?.plugins?.experiments?.enabled === false && disabled.exited === 1, disabled);
const unexpectedInSafeMode = eviErrors.filter(e => !e.includes(BROKEN));
check("no Evi errors in safe mode", unexpectedInSafeMode.length === 0, unexpectedInSafeMode.slice(0, 5));

await browser.close();

const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed. Screenshots in test-results/`);
process.exit(failed.length ? 1 : 0);
