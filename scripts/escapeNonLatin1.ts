/**
 * V8 keeps a script's whole source at two bytes per character once one character is above U+00FF
 * (an em dash, the Cyrillic and Japanese in the locale tables), and Bun.build can't escape them.
 * escapeNonLatin1 writes each one in a string, template or comment as \uXXXX, which reads back the
 * same, so the source stays one byte per character. Anywhere else it throws: in a regex literal the
 * escape would change its .source, in a tagged template the tag's .raw, and identifiers can't take one.
 */

const NON_LATIN1 = /[^\x00-\xff]/;
// One token of code: a run of anything that can't start a string, regex, comment or template part, or one that can
const TOKEN = /[^'"`/{}]+|\/[/*]|[^]/y;
const SPECIAL = /['"`/{}]/;
const WORD = /[\w$]/;
// Where a string or template body could end or escape
const BODY_STOP: Record<string, RegExp> = { "'": /['\\\n]/g, "\"": /["\\\n]/g, "`": /[`\\]|\$\{/g };
// After these words a slash starts a regex; after any other word, or ) ] }, it divides
const BEFORE_REGEX = new Set(["return", "typeof", "instanceof", "in", "of", "new", "delete", "void", "throw", "case", "do", "else", "yield", "await"]);

const hex = (c: string) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`;

export function escapeNonLatin1(code: string): string {
    if (!NON_LATIN1.test(code)) return code;
    check(code);
    // After an odd run of backslashes the character was an identity escape: drop one, the \u says the same
    return code.replace(/(\\*)([^\x00-\xff])/g, (_, slashes: string, c: string) => (slashes.length % 2 ? slashes.slice(1) : slashes) + hex(c));
}

/** Throws unless every character above U+00FF is in a string, a plain template or a comment */
function check(code: string) {
    let i = 0;
    // What came before, for telling a regex from a division and a tagged template from a plain one
    let prev: "start" | "word" | "close" | "punct" = "start";
    let prevWord = "";
    // One entry per template whose ${ } we're inside: how many { are open in it, and whether it's tagged
    const braces: { open: number; tagged: boolean; }[] = [];

    const fail = (what: string, at = i): never => {
        const line = code.slice(0, at).split("\n").length;
        throw new Error(`a character above U+00FF in ${what} (line ${line}): ${JSON.stringify(code.slice(Math.max(0, at - 40), at + 20))}`);
    };

    /** A string or template body from i; true when a template stopped at ${ */
    const body = (end: string, tagged: boolean) => {
        const stop = BODY_STOP[end];
        const start = i;
        for (;;) {
            stop.lastIndex = i;
            const m = stop.exec(code);
            if (!m || m[0] === "\n") return fail("an unterminated string", start);
            i = m.index + m[0].length;
            if (m[0] === "\\") {
                // A backslash before U+2028 or U+2029 continues the line instead
                if (code.charCodeAt(i) === 0x2028 || code.charCodeAt(i) === 0x2029) fail("an escape", i);
                i++;
                continue;
            }
            if (tagged && NON_LATIN1.test(code.slice(start, i))) fail("a tagged template", start);
            return m[0] === "${";
        }
    };

    const template = (tagged: boolean) => {
        if (body("`", tagged)) {
            braces.push({ open: 0, tagged });
            prev = "punct";
        } else prev = "close";
    };

    while (i < code.length) {
        TOKEN.lastIndex = i;
        const t = TOKEN.exec(code)![0];
        const at = i;
        i += t.length;
        const c = t[0];
        if (t === "//") {
            const end = code.indexOf("\n", i);
            i = end < 0 ? code.length : end;
        } else if (t === "/*") {
            const end = code.indexOf("*/", i);
            if (end < 0) fail("an unterminated comment", at);
            i = end + 2;
        } else if (!SPECIAL.test(c)) {
            if (NON_LATIN1.test(t)) fail("code", at);
            // Only how the run ends matters
            let end = t.length - 1;
            while (end >= 0 && /\s/.test(t[end])) end--;
            if (end < 0) continue;
            if (WORD.test(t[end])) {
                let start = end;
                while (start > 0 && WORD.test(t[start - 1])) start--;
                prevWord = t.slice(start, end + 1);
                prev = "word";
            } else prev = t[end] === ")" || t[end] === "]" ? "close" : "punct";
        } else if (c === "'" || c === "\"") {
            body(c, false);
            prev = "close";
        } else if (c === "`") {
            template(prev === "close" || (prev === "word" && !BEFORE_REGEX.has(prevWord)));
        } else if (c === "}" && braces.length && braces[braces.length - 1].open === 0) {
            // The end of a template's ${ }: the template goes on
            template(braces.pop()!.tagged);
        } else if (c === "/" && (prev === "start" || prev === "punct" || (prev === "word" && BEFORE_REGEX.has(prevWord)))) {
            let inClass = false;
            while (i < code.length && (code[i] !== "/" || inClass)) {
                if (code[i] === "\\") i++;
                else if (code[i] === "[") inClass = true;
                else if (code[i] === "]") inClass = false;
                else if (code[i] === "\n") fail("an unterminated regex", at);
                i++;
            }
            i++;
            if (NON_LATIN1.test(code.slice(at, i))) fail("a regex literal", at);
            prev = "close";
        } else {
            // A division, { or }
            if (c === "{" && braces.length) braces[braces.length - 1].open++;
            else if (c === "}" && braces.length) braces[braces.length - 1].open--;
            prev = c === "}" ? "close" : "punct";
        }
    }
}
