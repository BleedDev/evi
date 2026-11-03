import { describe, expect, test } from "bun:test";

import { currentTextVariant } from "../src/shared/textVariants";

/** Discord's variant names since November 2026 */
const NOW = new Set([
    ...["xs", "sm", "md", "lg"].flatMap(s => ["normal", "medium", "semibold"].map(w => `body-${s}/${w}`)),
    ...["xs", "sm", "md", "lg", "xl", "xxl"].flatMap(s => ["medium", "semibold"].map(w => `heading-${s}/${w}`)),
]);
const now = (v: string) => NOW.has(v);

describe("Discord's renamed Text variants", () => {
    test("text-* becomes body-* at the same size, bold as semibold", () => {
        expect(currentTextVariant("text-sm/normal", now)).toBe("body-sm/normal");
        expect(currentTextVariant("text-xs/semibold", now)).toBe("body-xs/semibold");
        expect(currentTextVariant("text-md/medium", now)).toBe("body-md/medium");
        expect(currentTextVariant("text-lg/bold", now)).toBe("body-lg/semibold");
    });

    test("headings keep their size: heading-sm is heading-xs now, heading-md is heading-sm", () => {
        expect(currentTextVariant("heading-sm/semibold", now)).toBe("heading-xs/semibold");
        expect(currentTextVariant("heading-md/semibold", now)).toBe("heading-sm/semibold");
        expect(currentTextVariant("heading-md/medium", now)).toBe("heading-sm/medium");
        expect(currentTextVariant("heading-lg/semibold", now)).toBe("heading-lg/semibold");
        expect(currentTextVariant("heading-xl/bold", now)).toBe("heading-xl/semibold");
        expect(currentTextVariant("heading-xl/normal", now)).toBe("heading-xl/medium");
    });

    test("a Discord that still knows the old name keeps it, and unknown names stay as written", () => {
        const before = (v: string) => v.startsWith("text-") || v.startsWith("heading-");
        expect(currentTextVariant("text-sm/normal", before)).toBe("text-sm/normal");
        expect(currentTextVariant("heading-md/semibold", before)).toBe("heading-md/semibold");
        expect(currentTextVariant("body-sm/normal", now)).toBe("body-sm/normal");
        expect(currentTextVariant("eyebrow", now)).toBe("eyebrow");
    });
});
