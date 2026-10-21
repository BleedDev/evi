import { describe, expect, test } from "bun:test";

import { escapeNonLatin1 } from "../scripts/escapeNonLatin1";

const ARROW = String.fromCharCode(0x2192);
const JA = "日本";
const EMOJI = "\u{1f600}";

/** What a script returns, run as is and escaped; the escaped one must be all Latin-1 */
function both(body: string) {
    const escaped = escapeNonLatin1(body);
    expect(escaped).not.toMatch(/[^\x00-\xff]/);
    return [new Function(body)(), new Function(escaped)()];
}

describe("escapeNonLatin1", () => {
    test("strings, templates and comments read back the same", () => {
        const cases = [
            `return "a ${ARROW} b";`,
            `return 'a ${ARROW} ${JA}';`,
            `const x = 2; return \`\${x} ${ARROW} \${\`in ${JA} \${x}\`} \${{ a: "${ARROW}" }.a}\`;`,
            `// ${ARROW} a comment\n/* ${JA} */ return 1;`,
            `return "${EMOJI}".length;`,
            `return /[${EMOJI.replace(/./gu, c => `\\u{${c.codePointAt(0)!.toString(16)}}`)}]/u.test("${EMOJI}");`,
            // An identity escape (a backslash before the character) and an escaped backslash before one
            `return ["\\${ARROW}", "\\\\${ARROW}", \`\\${ARROW}\`];`,
            // Divisions aren't regexes: the string between them is still escaped
            `const a = 6, b = 3; return a / b + "${ARROW}" + a / 2;`,
            `return /x/.test("x${ARROW}") && typeof /y/ + "${JA}";`,
        ];
        for (const body of cases) {
            const [plain, escaped] = both(body);
            expect(escaped).toEqual(plain);
        }
    });

    test("Latin-1 code is left alone", () => {
        const code = `return "café" + 'naïve';`;
        expect(escapeNonLatin1(code)).toBe(code);
    });

    test("refuses where an escape would change what the code sees", () => {
        // A regex's .source and a tagged template's .raw would change; an identifier can't take one
        expect(() => escapeNonLatin1(`return /${ARROW}/.source;`)).toThrow("regex");
        expect(() => escapeNonLatin1(`return String.raw\`${ARROW}\`;`)).toThrow("tagged template");
        expect(() => escapeNonLatin1(`return tag(1)\`a\${1}${ARROW}\`;`)).toThrow("tagged template");
        expect(() => escapeNonLatin1(`const ${JA} = 1;`)).toThrow("code");
    });

    test("a template after return isn't tagged", () => {
        const [plain, escaped] = both(`return \`${ARROW}\`;`);
        expect(escaped).toBe(plain);
    });
});
