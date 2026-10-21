import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

import { blankDraft, buildThemeCss, cleanFont, contrast, isEditorTheme, parseThemeCss, PRESETS, themeSlug, toHex } from "../src/shared/themeEditor";
import { scanThemeCss, validateThemeSubmission, whyNotCommunityCss, withStoreHeader } from "../src/shared/themeSubmissions";
import { parseThemeMeta } from "../src/shared/themes";

const ocean = () => ({
    ...blankDraft("dark", "Alica"),
    name: "Ocean",
    description: "Deep blue with a teal accent",
    colors: { ...PRESETS.dark, frame: "#0b1320", chat: "#101a2b", accent: "#1fb6a6" },
    radius: 50,
    font: "Inter",
});

describe("theme editor: writing", () => {
    test("a header Evi reads back, and variables scoped to the dark modes", () => {
        const css = buildThemeCss(ocean());
        expect(parseThemeMeta(css, "ocean.css")).toEqual({ file: "ocean.css", name: "Ocean", description: "Deep blue with a teal accent", author: "Alica", version: "1.0.0" });
        expect(css).toContain(".theme-dark,\n.theme-darker,\n.theme-midnight {");
        expect(css).not.toContain(".theme-light");
        expect(css).toContain("    --background-base-lowest: #0b1320;");
        expect(css).toContain("    --control-primary-background-default: #1fb6a6;");
        // Half of Discord's corners, and the font before Discord's own
        expect(css).toContain("    --radius-sm: 4px;");
        expect(css).toContain(`    --font-primary: "Inter", "gg sans", "Noto Sans", sans-serif;`);
        // Nitro colour themes would paint over it otherwise
        expect(css).toContain("--background-gradient-chat: initial;");
        expect(isEditorTheme(css)).toBe(true);
        // Nothing remote, so it can go straight to the store
        expect(whyNotCommunityCss(css)).toBeUndefined();
    });

    test("light themes only style light mode; unchanged corners and fonts aren't written", () => {
        const css = buildThemeCss({ ...blankDraft("light"), name: "Paper" });
        expect(css).toContain(".theme-light {");
        expect(css).not.toMatch(/\.theme-dark/);
        expect(css).not.toContain("--radius-");
        expect(css).not.toContain("--font-primary");
        expect(css).not.toContain("@author");
    });

    test("header values stay on one line and can't close the comment or start a tag", () => {
        const css = buildThemeCss({ ...ocean(), name: "Two\nlines */ body{display:none}", description: "ping @everyone" });
        const meta = parseThemeMeta(css, "x.css");
        expect(meta.name).toBe("Two lines body{display:none}");
        expect(meta.description).toBe("ping everyone");
        // The header's own end is the first one
        expect(css.indexOf("*/")).toBe(css.indexOf("\n */\n") + 2);
    });

    test("fonts are names only", () => {
        expect(cleanFont(`Inter"; } body { display: none`)).toBe("Inter body display none");
        expect(cleanFont("  JetBrains   Mono ")).toBe("JetBrains Mono");
    });
});

describe("theme editor: reading", () => {
    test("its own themes round-trip, extra CSS included", () => {
        const draft = { ...ocean(), extraCss: ".markup { letter-spacing: 0.01em; }" };
        const back = parseThemeCss(buildThemeCss(draft), "ocean.css");
        expect(back).toEqual(draft);
        expect(parseThemeCss(buildThemeCss({ ...blankDraft("light"), name: "Paper" })).base).toBe("light");
    });

    test("other themes are a starting point: Midnight's colours, the rest from the preset", () => {
        const midnight = parseThemeCss(readFileSync(join(import.meta.dir, "..", "themes", "midnight.css"), "utf8"), "midnight.css");
        expect(midnight).toMatchObject({ name: "Midnight", author: "Evi", base: "dark", radius: 100, font: "", extraCss: "" });
        expect(midnight.colors).toMatchObject({ frame: "#000000", chat: "#000000", panel: "#050506", popout: "#0b0b0d", input: "#0b0b0d" });
        expect(midnight.colors.accent).toBe(PRESETS.dark.accent);
        expect(isEditorTheme(readFileSync(join(import.meta.dir, "..", "themes", "midnight.css"), "utf8"))).toBe(false);
    });

    test("light is read from the selectors when there's no @base; commented-out values don't count", () => {
        const draft = parseThemeCss(".theme-light { /* --text-default: #ff0000; */ --text-default: rgb(10, 20, 30); --brand-500: #abc; }");
        expect(draft.base).toBe("light");
        expect(draft.colors.text).toBe("#0a141e");
        expect(draft.colors.accent).toBe("#aabbcc");
    });

    test("colours", () => {
        expect(toHex("#ABC")).toBe("#aabbcc");
        expect(toHex("#11223344")).toBe("#112233");
        expect(toHex("rgba(255, 0, 0, 0.5)")).toBe("#ff0000");
        expect(toHex("hsl(0 0% 0%)")).toBeUndefined();
        expect(Math.round(contrast("#ffffff", "#000000"))).toBe(21);
        expect(contrast("#777777", "#777777")).toBe(1);
    });

    test("store ids from names", () => {
        expect(themeSlug("Ocean Night")).toBe("ocean-night");
        expect(themeSlug("Café  Crème!")).toBe("cafe-creme");
        expect(themeSlug("…")).toBe("theme");
    });
});

describe("community themes", () => {
    test("nothing loaded from the internet, however it's written", () => {
        expect(whyNotCommunityCss("@import 'x.css'; a{}")).toStartWith("Themes can't use @import");
        expect(whyNotCommunityCss("@\\69mport 'x.css'; a{}")).toStartWith("Themes can't use @import");
        expect(whyNotCommunityCss("a { background: url(\"https://i.imgur.com/x.png\") }")).toContain("i.imgur.com");
        expect(whyNotCommunityCss("a { background: url(//evil.example/x.png) }")).toContain("evil.example");
        expect(whyNotCommunityCss("a { background: \\75rl(\\2f\\2f evil.example/x.png) }")).toContain("evil.example");
        expect(whyNotCommunityCss("a { background: image-set(\"https://evil.example/x.png\" 1x) }")).toContain("evil.example");
        // Discord's own CDN, data: URLs and a namespace inside an embedded SVG are fine
        expect(whyNotCommunityCss("a { background: url(https://cdn.discordapp.com/attachments/1/2/bg.png) }")).toBeUndefined();
        expect(whyNotCommunityCss("a { background: url(data:image/png;base64,iVBOR//w0KGgo=) }")).toBeUndefined();
        expect(whyNotCommunityCss(`a { background: url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'/>") }`)).toBeUndefined();
        // A URL in a comment loads nothing
        expect(whyNotCommunityCss("/* see https://example.com */ a { color: red }")).toBeUndefined();
        expect(whyNotCommunityCss("a { color: red }".padEnd(600 * 1024, " "))).toContain("at most 512 KB");
    });

    test("addresses are read where the browser would go, not where they seem to point", () => {
        const refused = [
            "url(https://cdn.discordapp.com@evil.example/x.png)",
            "url(https://cdn.discordapp.com:pw@evil.example/x.png)",
            "url(http:evil.example/x.png)",
            "url(//%65vil.example/x.png)",
            "url(\\\\\\\\evil.example/x.png)",
            "url(/\\\\evil.example/x.png)",
            "url(https://[2001:db8::1]/x.png)",
            "url(https://_evil.example/x)",
            "url(\"h\\9ttps://evil.example/x\")",
            "url(\"https:\\9//evil.example/x\")",
            "u\\72l(http:evil.example/x)",
            // An escaped quote doesn't end the string, so it can't hide what comes after
            "content: \"\\\"\"; background: url(http:evil.example/x); content: \"a\"",
            // Nor does a comment inside a string swallow the rule after it
            "content: \"/*\"; background: url(http:evil.example/x); content: \"*/\"",
            "image-set(\"http:evil.example/x\" 1x)",
            // Discord's host, but not over https or with a name in front
            "url(http://cdn.discordapp.com/x.png)",
            "url(https://user@cdn.discordapp.com/x.png)",
        ];
        for (const value of refused) expect([value, whyNotCommunityCss(`a { background: ${value} }`)]).toEqual([value, expect.stringContaining("can't load anything")]);
        expect(whyNotCommunityCss("a { background: url(https://cdn.discordapp.com@evil.example/x.png) }")).toContain("evil.example");
        expect(scanThemeCss("a { background: url(https://cdn.discordapp.com@evil.example/x.png) }").hosts).toEqual([{ host: "https://cdn.discordapp.com@evil.example", allowed: false, count: 1 }]);
        // Words, font names and paths on Discord's own page load nothing from anyone else
        for (const value of ["content: \"Tip: hover me\"", "font-family: 'gg sans', \"Noto Sans\"", "background: url(/assets/x.png)", "background: url(\"https:x.png\")", "background: url(HTTPS://CDN.DISCORDAPP.COM/x.png)"]) {
            expect([value, whyNotCommunityCss(`a { ${value} }`)]).toEqual([value, undefined]);
        }
    });

    test("the scan tells reviewers what the theme brings", () => {
        const scan = scanThemeCss("@font-face { font-family: 'Mine'; src: url(data:font/woff2;base64,AAAA) }\na { color: red !important; background: url(https://media.discordapp.net/x.png) }");
        expect(scan).toMatchObject({ imports: 0, dataUrls: 1, fontFaces: ["Mine"], importants: 1, hosts: [{ host: "media.discordapp.net", allowed: true, count: 1 }] });
    });

    test("uploads are checked field by field", () => {
        const base = { id: "ocean", name: "Ocean", version: "1.0.0", css: "a{}" };
        expect(validateThemeSubmission(base)).toEqual({ input: { ...base, description: "", tags: [], notes: [] } });
        expect(validateThemeSubmission({ ...base, id: "Ocean" })).toHaveProperty("error");
        expect(validateThemeSubmission({ ...base, version: "one" })).toHaveProperty("error");
        expect(validateThemeSubmission({ ...base, tags: ["Dark Mode"] })).toHaveProperty("error");
        expect(validateThemeSubmission({ ...base, notes: Array(11).fill("x") })).toHaveProperty("error");
        expect(validateThemeSubmission({ ...base, screenshot: { type: "image/gif", data: "" } })).toHaveProperty("error");
    });

    test("published CSS gets the verified header, keeping the editor's @base", () => {
        const css = withStoreHeader(buildThemeCss(ocean()), { name: "Ocean", description: "Blue", author: "Bobby", version: "1.2.0" });
        expect(parseThemeMeta(css, "x.css")).toMatchObject({ name: "Ocean", description: "Blue", author: "Bobby", version: "1.2.0" });
        expect(css).toContain(" * @base dark\n");
        expect(css.match(/@name/g)).toHaveLength(1);
        // No header of its own: the first comment stays part of the theme
        expect(withStoreHeader("/* just a note */\na{}", { name: "N", description: "", author: "A", version: "1.0.0" })).toContain("/* just a note */");
        // Still an editor theme after publishing, so whoever installs it can open it in the editor
        expect(isEditorTheme(css)).toBe(true);
    });
});

describe("theme translations", () => {
    test("a theme's other languages survive being opened and saved in the editor", () => {
        const css = `/**\n * @name Night\n * @description Dark.\n * @name:de Nacht\n * @description:de Dunkel.\n * @base dark\n */\n.theme-dark { --background-base-lower: #000; }`;
        const draft = parseThemeCss(css, "night.css")!;
        expect(draft.locales).toEqual({ de: { name: "Nacht", description: "Dunkel." } });
        const saved = buildThemeCss(draft);
        expect(saved).toContain(" * @name:de Nacht");
        expect(saved).toContain(" * @description:de Dunkel.");
        expect(parseThemeCss(saved, "night.css")!.locales).toEqual(draft.locales);
    });
});
