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

import { ORIGINAL_ASAR } from "../src/shared/shim";

const DATA = mkdtempSync(join(tmpdir(), "evi-main-"));
process.env.EVI_DATA_DIR = DATA;
afterAll(() => rmSync(DATA, { recursive: true, force: true }));

/** What net.fetch answers, by URL */
const responses = new Map<string, () => Response>();

mock.module("electron", () => ({
    app: { getPath: () => tmpdir(), on() { }, relaunch() { }, exit() { }, commandLine: { appendSwitch() { } } },
    ipcMain: { on() { }, handle() { } },
    net: { fetch: async (url: string) => responses.get(url)?.() ?? new Response("", { status: 404 }) },
    session: { defaultSession: {} },
    webContents: { getAllWebContents: () => [] },
    BrowserWindow: { fromWebContents: () => null },
    dialog: {},
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

    test("a malformed %-escape in the file name still adds it, named after the theme", async () => {
        const { addThemeFromUrl } = await import("../src/main/themes");
        responses.set("https://example.com/dark%E0.css", () => new Response(css, { headers: { "content-type": "text/css" } }));
        const result = await addThemeFromUrl("https://example.com/dark%E0.css");
        expect(result).toEqual({ ok: true, file: "Dark.css" });
        expect(readFileSync(join(DATA, "themes", "Dark.css"), "utf8")).toBe(css);
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
