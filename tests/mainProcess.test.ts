/**
 * Evi's main process modules, with Electron replaced by the little of it they use here and the data
 * folder in a temp dir. Electron is mocked once for the whole run: only this file imports src/main.
 */
import { afterAll, describe, expect, mock, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

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
