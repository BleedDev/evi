import { expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

// stylesheet.ts injects this file as one string: a single character above U+00FF, even in a
// comment, makes V8 and Blink keep all of it at two bytes per character
test("Evi's stylesheet is Latin-1 only", () => {
    const css = readFileSync(join(import.meta.dir, "../src/renderer/ui/styles.css"), "utf8");
    expect(css.match(/[^\x00-\xff]/g) ?? []).toEqual([]);
});
