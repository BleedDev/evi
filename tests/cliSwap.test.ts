import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { NEXT_ASAR, swapIn, swapOut } from "../src/cli/swap";
import { createAsar, readAsarFile } from "../src/shared/asar";
import { ORIGINAL_ASAR, SHIM_MARKER } from "../src/shared/shim";

const discordAsar = createAsar({ "package.json": JSON.stringify({ name: "discord", productName: "Discord" }), "index.js": "// discord" });

let dir: string;
const asar = () => join(dir, "app.asar");
const original = () => join(dir, ORIGINAL_ASAR);

beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "evi-swap-"));
    writeFileSync(asar(), discordAsar);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("the CLI's archive swap", () => {
    test("moves Discord's archive aside, refreshes the loader, and puts Discord back", () => {
        swapIn(dir, "clean", { corePath: "/x/core/main.js" });
        expect(readAsarFile(asar(), "index.js").startsWith(SHIM_MARKER)).toBe(true);
        expect(readFileSync(original()).equals(discordAsar)).toBe(true);
        expect(existsSync(join(dir, NEXT_ASAR))).toBe(false);

        swapIn(dir, "evi", { corePath: "/y/core/main.js" });
        expect(readAsarFile(asar(), "index.js")).toContain("/y/core/main.js");

        expect(swapOut(dir)).toBe(true);
        expect(readFileSync(asar()).equals(discordAsar)).toBe(true);
        expect(existsSync(original())).toBe(false);
    });

    test("a failed install leaves Discord as it was", () => {
        // Something in the way of the new loader: the write fails
        mkdirSync(join(dir, NEXT_ASAR));
        expect(() => swapIn(dir, "clean", { corePath: "/x/core/main.js" })).toThrow();
        expect(readFileSync(asar()).equals(discordAsar)).toBe(true);
        expect(existsSync(original())).toBe(false);

        // A broken archive is read before anything moves
        writeFileSync(asar(), "broken");
        expect(() => swapIn(dir, "clean", { corePath: "/x/core/main.js" })).toThrow();
        expect(readFileSync(asar(), "utf8")).toBe("broken");
        expect(existsSync(original())).toBe(false);
    });

    test("a failed update keeps the old loader", () => {
        swapIn(dir, "clean", { corePath: "/x/core/main.js" });
        const loader = readFileSync(asar());
        mkdirSync(join(dir, NEXT_ASAR));
        expect(() => swapIn(dir, "evi", { corePath: "/y/core/main.js" })).toThrow();
        expect(readFileSync(asar()).equals(loader)).toBe(true);
        expect(readFileSync(original()).equals(discordAsar)).toBe(true);
    });

    test("uninstall keeps the loader when Discord's archive is gone", () => {
        swapIn(dir, "clean", { corePath: "/x/core/main.js" });
        const loader = readFileSync(asar());
        rmSync(original());
        expect(swapOut(dir)).toBe(false);
        expect(readFileSync(asar()).equals(loader)).toBe(true);
    });
});
