/**
 * Evi's main process modules, with Electron replaced by the little of it they use here and the data
 * folder in a temp dir. Electron is mocked once for the whole run: only this file imports src/main.
 */
import { afterAll, describe, expect, mock, test } from "bun:test";
import { EventEmitter } from "events";
import * as realFs from "fs";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { IPC } from "../src/shared/ipc";
import { ORIGINAL_ASAR } from "../src/shared/shim";

const DATA = mkdtempSync(join(tmpdir(), "evi-main-"));
process.env.EVI_DATA_DIR = DATA;
afterAll(() => rmSync(DATA, { recursive: true, force: true }));

/** What main sent the page */
const sent: { channel: string; args: unknown[]; }[] = [];
const page = { isDestroyed: () => false, send: (channel: string, ...args: unknown[]) => void sent.push({ channel, args }) };

/** Questions main asked in a system dialog, answered by calling them with the button index */
const asked: ((answer: { response: number; }) => void)[] = [];

/** What net.fetch answers, by URL */
const responses = new Map<string, () => Response>();

mock.module("electron", () => ({
    app: { getPath: () => tmpdir(), on() { }, relaunch() { }, exit() { }, commandLine: { appendSwitch() { } } },
    ipcMain: { on() { }, handle() { } },
    net: { fetch: async (url: string) => responses.get(url)?.() ?? new Response("", { status: 404 }) },
    session: { defaultSession: {} },
    webContents: { getAllWebContents: () => [page] },
    BrowserWindow: { fromWebContents: () => null },
    dialog: { showMessageBox: () => new Promise(resolve => asked.push(resolve)) },
    powerMonitor: {},
    shell: {},
}));

/** Watchers persist.ts started, in order: tests make them fail */
const watchers: (EventEmitter & { closed?: boolean; })[] = [];
mock.module("original-fs", () => ({
    ...realFs,
    watch: () => {
        const watcher = Object.assign(new EventEmitter(), { unref() { }, close() { watcher.closed = true; } }) as EventEmitter & { closed?: boolean; unref(): void; close(): void; };
        watchers.push(watcher);
        return watcher;
    },
}));

describe("staying in Discord across its updates", () => {
    test.skipIf(process.platform !== "win32")("watching Discord's folder starts again after the watcher fails", async () => {
        const { persistAcrossUpdates } = await import("../src/main/persist");
        const root = join(DATA, "Discord");
        const running = join(root, "app-1.0.0", "resources");
        mkdirSync(running, { recursive: true });
        writeFileSync(join(running, "app.asar"), "evi");
        writeFileSync(join(running, ORIGINAL_ASAR), "discord");

        const exitListeners = process.listeners("exit");
        persistAcrossUpdates(join(running, "app.asar"));
        for (const listener of process.listeners("exit")) if (!exitListeners.includes(listener)) process.off("exit", listener);
        expect(watchers.length).toBe(1);

        // Discord's updater deletes the old version, which errors the watcher, and writes the new one
        watchers[0].emit("error", Object.assign(new Error("EPERM"), { code: "EPERM" }));
        expect(watchers[0].closed).toBe(true);
        const next = join(root, "app-1.0.1", "resources");
        mkdirSync(next, { recursive: true });
        writeFileSync(join(next, "app.asar"), "discord 1.0.1");

        await Bun.sleep(1200);
        expect(watchers.length).toBe(2);
        expect(readFileSync(join(next, "app.asar"), "utf8")).toBe("evi");
        expect(readFileSync(join(next, ORIGINAL_ASAR), "utf8")).toBe("discord 1.0.1");
    });
});

describe("adding a theme from a link", () => {
    const css = "/**\n * @name Dark\n */\nbody { color: red; }";

    test("a malformed %-escape in the file name still adds it, named as written", async () => {
        const { addThemeFromUrl } = await import("../src/main/themes");
        responses.set("https://example.com/dark%E0.css", () => new Response(css, { headers: { "content-type": "text/css" } }));
        const result = await addThemeFromUrl("https://example.com/dark%E0.css");
        expect(result).toEqual({ ok: true, file: "dark-E0.css" });
        expect(readFileSync(join(DATA, "themes", "dark-E0.css"), "utf8")).toBe(css);
    });

    test("a folder in the way is an error result, not a thrown one", async () => {
        const { addThemeFromUrl } = await import("../src/main/themes");
        responses.set("https://example.com/other.css", () => new Response(css, { headers: { "content-type": "text/css" } }));
        // A folder where the file would go
        mkdirSync(join(DATA, "themes", "other.css"));
        const result = await addThemeFromUrl("https://example.com/other.css");
        expect(result.ok).toBe(false);
        expect(readdirSync(join(DATA, "themes"))).not.toContain("other-2.css");
        expect(existsSync(join(DATA, "themes", "other.css"))).toBe(true);
    });
});

describe("two plugin folders with the same id", () => {
    const write = (folder: string, version: string) => {
        const dir = join(DATA, "plugins", folder);
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, "manifest.json"), JSON.stringify({ id: "twin", name: "Twin", version, description: "", authors: [] }));
        writeFileSync(join(dir, "index.js"), `// ${version}`);
    };
    const changes = () => sent.filter(m => m.channel === IPC.PLUGIN_CHANGED).map(m => m.args[0] as { type: string; id?: string; plugin?: { manifest: { version: string; }; }; });

    test("a copy doesn't take over, and deleting it leaves the original", async () => {
        const { pluginLocation, refreshUserPlugin } = await import("../src/main/plugins");
        write("twin", "1.0.0");
        refreshUserPlugin("twin");
        expect(pluginLocation("twin")?.version).toBe("1.0.0");

        sent.length = 0;
        write("twin - Copy", "1.0.1");
        refreshUserPlugin("twin - Copy");
        expect(pluginLocation("twin")?.dir).toBe(join(DATA, "plugins", "twin"));
        expect(changes()).toEqual([]);

        rmSync(join(DATA, "plugins", "twin - Copy"), { recursive: true });
        refreshUserPlugin("twin - Copy");
        expect(pluginLocation("twin")?.dir).toBe(join(DATA, "plugins", "twin"));
        expect(changes()).toEqual([]);
    });

    test("deleting the folder that runs hands the id to the copy instead of removing the plugin", async () => {
        const { pluginLocation, refreshUserPlugin } = await import("../src/main/plugins");
        write("twin - Copy", "1.0.1");
        refreshUserPlugin("twin - Copy");
        sent.length = 0;

        rmSync(join(DATA, "plugins", "twin"), { recursive: true });
        refreshUserPlugin("twin");
        expect(pluginLocation("twin")?.dir).toBe(join(DATA, "plugins", "twin - Copy"));
        expect(changes().map(c => [c.type, c.plugin?.manifest.version])).toEqual([["upsert", "1.0.1"]]);

        sent.length = 0;
        rmSync(join(DATA, "plugins", "twin - Copy"), { recursive: true });
        refreshUserPlugin("twin - Copy");
        expect(pluginLocation("twin")).toBeUndefined();
        expect(changes()).toEqual([{ type: "remove", id: "twin" }]);
    });
});

describe("a plugin's code in main", () => {
    const dir = join(DATA, "plugins", "coder");
    const write = (code: string, version = "1.0.0") => {
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, "manifest.json"), JSON.stringify({ id: "coder", name: "Coder", version, description: "", authors: [] }));
        writeFileSync(join(dir, "index.js"), code);
    };
    const upserts = () => sent.filter(m => m.channel === IPC.PLUGIN_CHANGED).map(m => m.args[0] as { type: string; plugin?: { code?: string; }; }).filter(c => c.type === "upsert");

    test("files written again unchanged don't reload it; a change sends the new code", async () => {
        const { refreshUserPlugin } = await import("../src/main/plugins");
        write("// one");
        refreshUserPlugin("coder");
        sent.length = 0;

        write("// one");
        refreshUserPlugin("coder");
        expect(upserts()).toEqual([]);

        write("// two");
        refreshUserPlugin("coder");
        expect(upserts().map(c => c.plugin?.code)).toEqual(["// two"]);
    });

    test("the page gets it from the plugin's folder; a backup lists plugins without code", async () => {
        const { getBootPlugins, getPluginPayloads, pluginCode, refreshUserPlugin } = await import("../src/main/plugins");
        const settingsModule = await import("../src/main/settings");
        write("// three");
        refreshUserPlugin("coder");
        expect(pluginCode("coder")).toBe("// three");
        expect(pluginCode("nobody")).toBeNull();

        const before = structuredClone(settingsModule.settings);
        settingsModule.saveSettings({ ...before, plugins: { ...before.plugins, coder: { enabled: true } } });
        try {
            expect(getBootPlugins().find(p => p.manifest.id === "coder")?.code).toBe("// three");
        } finally {
            settingsModule.saveSettings(before);
        }
        expect(getBootPlugins().find(p => p.manifest.id === "coder")?.code).toBeUndefined();
        expect(getPluginPayloads().find(p => p.manifest.id === "coder")).toEqual({ manifest: expect.objectContaining({ id: "coder" }), source: "user" });
    });
});

describe("restoring a backup that turns on a plugin with native code", () => {
    test("saves made while the question is up are kept, and so is the restore", async () => {
        const { refreshUserPlugin } = await import("../src/main/plugins");
        const { applyBackup } = await import("../src/main/backup");
        const settingsModule = await import("../src/main/settings");
        const { buildBackup } = await import("../src/shared/backup");

        const dir = join(DATA, "plugins", "nat");
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, "manifest.json"), JSON.stringify({ id: "nat", name: "Nat", version: "1.0.0", description: "", authors: [], native: "native.js" }));
        writeFileSync(join(dir, "index.js"), "");
        writeFileSync(join(dir, "native.js"), "module.exports = {};");
        refreshUserPlugin("nat");

        const before = structuredClone(settingsModule.settings);
        const backup = buildBackup({
            settings: { ...before, betaUpdates: true, plugins: { nat: { enabled: true }, other: { enabled: true } } },
            quickCss: "",
            themes: [],
            plugins: [],
        }, "2.5.2");

        asked.length = 0;
        const result = applyBackup(backup, "replace");
        await Bun.sleep(10);
        expect(asked.length).toBe(1);
        // The page still has the settings from before, and saves on top of them
        settingsModule.saveSettings({ ...before, lastSeenVersion: "9.9.9" });
        asked[0]({ response: 0 });

        const done = await result;
        const saved = settingsModule.settings;
        expect(done.ok && done.settings).toEqual(saved);
        expect(saved.betaUpdates).toBe(true);
        expect(saved.plugins.other?.enabled).toBe(true);
        expect(saved.plugins.nat?.enabled).toBe(true);
        expect(saved.lastSeenVersion).toBe("9.9.9");
        expect(JSON.parse(readFileSync(join(DATA, "settings.json"), "utf8"))).toEqual(saved);
        // Safe mode can name what the restore turned on
        const changes = JSON.parse(readFileSync(join(DATA, "safe-mode.json"), "utf8")).changes;
        expect(changes).toContainEqual(expect.objectContaining({ kind: "plugin", id: "nat", action: "enabled" }));
        expect(changes).toContainEqual(expect.objectContaining({ kind: "plugin", id: "other", action: "enabled" }));
    });
});
