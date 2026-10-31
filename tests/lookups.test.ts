import { describe, expect, test } from "bun:test";

import { lookupHealth, scanFor, SCAN_TTL_MS, trackLookup, untrackLookup } from "../src/renderer/plugins/lookups";
import { filters } from "../src/renderer/webpack/find";

describe("lookup code scans", () => {
    const record = trackLookup("eviTestLookups", filters.byCode("eviTestNeverThere"));
    let scans = 0;
    const scan = () => (scans++, ["42"]);

    test("a second diagnosis within the TTL reuses the first scan", () => {
        expect(scanFor(record, 1_000, SCAN_TTL_MS, scan)).toEqual(["42"]);
        expect(scanFor(record, 1_000 + SCAN_TTL_MS - 1, SCAN_TTL_MS, scan)).toEqual(["42"]);
        expect(scans).toBe(1);
    });

    test("an older scan, or maxAge 0 (Check again), scans again", () => {
        scanFor(record, 1_000 + SCAN_TTL_MS, SCAN_TTL_MS, scan);
        expect(scans).toBe(2);
        scanFor(record, 1_000 + SCAN_TTL_MS, 0, scan);
        scanFor(record, 1_000 + SCAN_TTL_MS, 0, scan);
        expect(scans).toBe(4);
        untrackLookup(record);
    });
});

describe("what an unanswered lookup is", () => {
    const loaded = (id: string) => id === "1";
    test("a lookup with code: waiting while a module with that code hasn't loaded, broken once they all ran without it", () => {
        expect(lookupHealth("code", ["1", "2"], loaded)).toBe("waiting");
        expect(lookupHealth("code", ["1"], loaded)).toBe("broken");
    });
    test("no module with the code yet is missing, not broken: it may be in a chunk Discord hasn't fetched (Pop Out Chat's call chat)", () => {
        expect(lookupHealth("code", [], loaded)).toBe("missing");
    });
    test("byProps in a module Discord loads later (search's actions) waits instead of counting as missing", () => {
        expect(lookupHealth("hint", ["2"], loaded)).toBe("waiting");
        expect(lookupHealth("hint", ["1"], loaded)).toBe("missing");
        expect(lookupHealth("hint", [], loaded)).toBe("missing");
        expect(lookupHealth("none", [], loaded)).toBe("missing");
    });
    test("byProps and byStoreName carry what their module's code very likely has, as a hint only", () => {
        expect(filters.byProps("fetchTabMessages", "clearSearchMessages").$hint).toEqual(["fetchTabMessages", "clearSearchMessages"]);
        expect(filters.byProps("fetchTabMessages").$code).toBeUndefined();
        expect(filters.byStoreName("SearchStore").$hint).toEqual(["SearchStore"]);
    });
});
