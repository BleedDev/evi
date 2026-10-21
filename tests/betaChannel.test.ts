import { describe, expect, test } from "bun:test";

import { cleanVersion, isNewerRelease, isPrerelease, parseRelease, pickRelease } from "../src/shared/release";
import { compareVersions, meetsMinEvi, storeAction } from "../src/shared/store";

const release = (tag: string, extra: Record<string, unknown> = {}) => ({
    tag_name: tag, draft: false, prerelease: tag.includes("-"), html_url: `https://github.com/BleedDev/evi/releases/tag/${tag}`,
    assets: ["evi.exe", "evi.exe.sha256"].map(name => ({ name, browser_download_url: `https://github.com/BleedDev/evi/releases/download/${tag}/${name}` })),
    ...extra,
});

describe("beta versions", () => {
    test("a beta comes before its release and after the one before", () => {
        const order = ["0.4.0", "0.5.0-alpha", "0.5.0-beta.1", "0.5.0-beta.2", "0.5.0-beta.10", "0.5.0-rc.1", "0.5.0", "0.5.1-beta.1", "0.5.1"];
        for (let i = 1; i < order.length; i++) {
            expect(compareVersions(order[i - 1], order[i])).toBe(-1);
            expect(compareVersions(order[i], order[i - 1])).toBe(1);
        }
        expect(compareVersions("0.5.0-beta.1", "0.5.0-beta.1")).toBe(0);
    });

    test("tags keep their prerelease part", () => {
        expect(cleanVersion("v0.5.0-beta.1")).toBe("0.5.0-beta.1");
        expect(cleanVersion(" v0.5.0+build.7 ")).toBe("0.5.0");
        expect(isPrerelease("v0.5.0-beta.1")).toBe(true);
        expect(isPrerelease("0.5.0")).toBe(false);
    });

    test("what counts as newer", () => {
        expect(isNewerRelease("v0.5.0-beta.1", "0.4.0")).toBe(true);
        expect(isNewerRelease("v0.5.0-beta.2", "0.5.0-beta.1")).toBe(true);
        expect(isNewerRelease("v0.5.0", "0.5.0-beta.2")).toBe(true);
        // On a beta with betas off again: the older stable isn't offered, nothing goes back
        expect(isNewerRelease("v0.4.0", "0.5.0-beta.1")).toBe(false);
        expect(isNewerRelease("v0.5.0-beta.1", "0.5.0")).toBe(false);
    });

    test("picks the highest version, prereleases only with beta on", () => {
        const list = [release("v0.4.0"), release("v0.5.0-beta.2"), release("v0.5.0-beta.10"), release("v0.3.9")];
        expect(pickRelease(list, true).tag_name).toBe("v0.5.0-beta.10");
        expect(pickRelease(list, false).tag_name).toBe("v0.4.0");
        // A stable that's out beats its betas, even listed after them
        expect(pickRelease([release("v0.5.0-beta.2"), release("v0.5.0")], true).tag_name).toBe("v0.5.0");
    });

    test("skips drafts, tags that aren't versions, and anything GitHub marks as a prerelease with beta off", () => {
        const list = [release("v0.6.0", { draft: true }), release("nightly"), release("v0.5.5", { prerelease: true }), release("v0.5.0")];
        expect(pickRelease(list, false).tag_name).toBe("v0.5.0");
        expect(pickRelease(list, true).tag_name).toBe("v0.5.5");
        expect(pickRelease([], true)).toBeUndefined();
        expect(pickRelease({ message: "Not Found" }, true)).toBeUndefined();
        expect(pickRelease([null, 3, { tag_name: 1 }], true)).toBeUndefined();
    });

    test("a picked beta parses as a prerelease", () => {
        const info = parseRelease(pickRelease([release("v0.5.0-beta.1")], true));
        expect(info && "version" in info && [info.version, info.prerelease]).toEqual(["0.5.0-beta.1", true]);
        const stable = parseRelease(release("v0.5.0"));
        expect(stable && "prerelease" in stable && stable.prerelease).toBe(false);
    });
});

describe("store compatibility on a beta", () => {
    test("a beta runs plugins made for the version it leads up to, not later ones", () => {
        expect(meetsMinEvi("0.5.0-beta.1", "0.5.0")).toBe(true);
        expect(meetsMinEvi("0.5.0-beta.1", "0.5.1")).toBe(false);
        expect(meetsMinEvi("0.4.0", "0.5.0")).toBe(false);
        expect(meetsMinEvi("0.5.0", undefined)).toBe(true);
        expect(storeAction({ version: "1.0.0", minEviVersion: "0.5.0" }, undefined, "0.5.0-beta.2")).toBe("install");
    });
});
