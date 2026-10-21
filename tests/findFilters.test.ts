import { describe, expect, test } from "bun:test";

import { filters, matchesAll } from "../src/renderer/webpack/find";

describe("code filters", () => {
    test("a global or sticky RegExp gives the same answer every time", () => {
        const longModule = `${"x".repeat(500)}function sendMessage(){}`;
        const exported = function sendMessage() { };
        for (const re of [/sendMessage/g, /function/y]) {
            const filter = filters.byCode(re);
            // waitFor tests the whole module's source first, then the export's own, much shorter
            matchesAll(longModule, [re]);
            expect(filter(exported)).toBe(true);
            expect(filter(exported)).toBe(true);
        }
    });
});
