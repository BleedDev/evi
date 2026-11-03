/**
 * Measures what Evi adds to Discord's module loading on the live web bundle.
 *   node scripts/bench-web.ts [runs]
 */
import { existsSync, readdirSync, readFileSync } from "fs";
import { join, resolve } from "path";
import { chromium } from "playwright-core";

import { disablePasskeys } from "./no-passkeys.ts";

const ROOT = resolve(import.meta.dirname, "..");
const DIST = join(ROOT, "dist");
const runs = Number(process.argv.find(a => /^\d+$/.test(a)) ?? 3);

const plugins = readdirSync(join(DIST, "plugins")).map(id => ({
    manifest: JSON.parse(readFileSync(join(DIST, "plugins", id, "manifest.json"), "utf8")),
    code: readFileSync(join(DIST, "plugins", id, "index.js"), "utf8"),
    source: "dev",
}));
// --no-waiters: disable clear-urls, whose sendMessage waiter never resolves on the logged-out page
const noWaiters = process.argv.includes("--no-waiters");
const boot = { version: "bench", dataDir: "", settings: { quickCss: true, plugins: { experiments: { enabled: true }, ...(noWaiters ? { "clear-urls": { enabled: false } } : {}) } }, plugins, quickCss: "" };
const renderer = readFileSync(join(DIST, "core", "renderer.js"), "utf8");

const browser = await chromium.launch({
    executablePath: [process.env.CHROME_PATH, "C:/Program Files/Google/Chrome/Application/chrome.exe"].find(p => !!p && existsSync(p)),
});

const results: Record<string, number>[] = [];
for (let i = 0; i < runs; i++) {
    const page = await browser.newPage();
    await page.addInitScript(disablePasskeys);
    await page.addInitScript(b => {
        if (window !== window.top) return;
        (window as any).EviNative = {
            boot: () => structuredClone(b), saveSettings: async () => { }, saveSettingsSync() { }, saveQuickCss: async () => { },
            onQuickCssChange() { }, onPluginChange() { }, callNative: async () => 0, setNativeRunning: async () => { },
        };
    }, boot);
    await page.addInitScript(renderer);
    await page.goto("https://discord.com/login");
    await page.waitForFunction(() => (window as any).Evi?.plugins.getSnapshot().some((p: any) => p.running), null, { timeout: 60_000 });
    await page.waitForTimeout(3000);
    results.push(await page.evaluate(() => ({ ...(window as any).Evi.stats })));
    if (i === 0) console.log("pending waiters:", await page.evaluate(() => (window as any).Evi.pendingWaiters()));
    await page.close();
}
await browser.close();

const avg = (k: string) => (results.reduce((a, r) => a + r[k], 0) / results.length);
console.log(JSON.stringify({
    runs,
    modules: Math.round(avg("modules")),
    patchMs: +avg("patchMs").toFixed(1),
    // Per-module overhead of lookups, excluding the work done in callbacks once something is found
    overheadMs: +(avg("listenerMs") - avg("callbackMs")).toFixed(1),
    callbackMs: +avg("callbackMs").toFixed(1),
    patchedModules: avg("patchedModules"),
}));
