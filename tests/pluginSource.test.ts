import { describe, expect, test } from "bun:test";

import { contentsUrl, parseListing, sourceFolderName } from "../src/shared/pluginSource";

const raw = (path: string) => `https://raw.githubusercontent.com/BleedDev/evi/main/${path}`;

describe("a plugin's source, for its author", () => {
    test("Evi's own plugins are read from plugins/<id> in Evi's repository", () => {
        expect(contentsUrl("plugins/relationship-notifier")).toBe("https://api.github.com/repos/BleedDev/evi/contents/plugins/relationship-notifier?ref=main");
    });

    test("a folder listing keeps plain files from Evi's repository and the folders to read next", () => {
        const listing = parseListing([
            { name: "index.tsx", type: "file", size: 22577, download_url: raw("plugins/relationship-notifier/index.tsx") },
            { name: "manifest.json", type: "file", size: 900, download_url: raw("plugins/relationship-notifier/manifest.json") },
            { name: "parts", type: "dir", path: "plugins/relationship-notifier/parts" },
        ], "", 0);
        expect(listing.files.map(f => f.path)).toEqual(["index.tsx", "manifest.json"]);
        expect(listing.dirs).toEqual([{ path: "plugins/relationship-notifier/parts", prefix: "parts/" }]);
        expect(parseListing([{ name: "row.tsx", type: "file", size: 1, download_url: raw("plugins/x/parts/row.tsx") }], "parts/", 1).files[0].path).toBe("parts/row.tsx");
    });

    test("nothing that climbs out of the folder, comes from elsewhere, or nests too deep", () => {
        const listing = parseListing([
            { name: "..", type: "dir", path: "plugins" },
            { name: "../evil.js", type: "file", size: 1, download_url: raw("evil.js") },
            { name: "a\\b.js", type: "file", size: 1, download_url: raw("a") },
            { name: "x.js", type: "file", size: 1, download_url: "https://example.com/x.js" },
            { name: "y.js", type: "file", size: 1, download_url: "https://raw.githubusercontent.com/someone/else/main/y.js" },
            { name: "link", type: "symlink", size: 1, download_url: raw("link") },
            { name: "z.js", type: "file", download_url: raw("z.js") },
        ], "", 0);
        expect(listing).toEqual({ files: [], dirs: [] });
        expect(parseListing([{ name: "deep", type: "dir", path: "p/a/b/c/deep" }], "a/b/c/", 3).dirs).toEqual([]);
        expect(parseListing({ message: "Not Found" }, "", 0)).toEqual({ files: [], dirs: [] });
    });

    test("the folder is named after the plugin and version, numbered when that's taken", () => {
        const taken = new Set(["read-all-1.1.3", "read-all-1.1.3 (2)"]);
        expect(sourceFolderName("read-all", "1.1.3", n => taken.has(n))).toBe("read-all-1.1.3 (3)");
        expect(sourceFolderName("read-all", "1.1.4", n => taken.has(n))).toBe("read-all-1.1.4");
    });
});
