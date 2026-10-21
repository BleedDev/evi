import { describe, expect, test } from "bun:test";

import { scanFor, SCAN_TTL_MS, trackLookup, untrackLookup } from "../src/renderer/plugins/lookups";
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
