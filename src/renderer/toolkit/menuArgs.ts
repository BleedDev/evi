/**
 * Discord's context menus build their <Menu navId="..."> from closure variables (the message, the
 * user...) that the Menu itself never sees. To hand those to plugins, a source patch adds
 * `eviMenuArgs:arguments[0]` next to every `navId:` in an object literal: that is the props of
 * the component (or the argument of the helper) that renders the menu.
 *
 * Not every `navId:` can take it: destructuring patterns (`let{navId:t}=e`) must stay as they are,
 * `arguments` is a syntax error in class fields, and at module level it would be the module object.
 * This scans the module source once, tracking what each `{` opens, to decide per occurrence.
 */

export const MENU_ARGS_KEY = "eviMenuArgs";

// What a bracket opens, numbers rather than objects: the scan keeps one per open bracket
const OTHER = 0;    // parens, brackets
const BLOCK = 1;    // object literal or block
const FUNCTION = 2; // body of a non-arrow function or method: has its own `arguments`
const FACTORY = 3;  // the module factory itself
const CLASS = 4;    // class body
const ARROW = 5;    // arrow function body

const BLOCK_KEYWORD = /(?:^|[^\w$.])(?:if|for|while|switch|catch|with)\s*$/;
const REGEX_PRECEDER = /(?:^|[(,=:[!&|?{};+\-*%<>~^]|\b(?:return|typeof|case|void|in|of|delete|throw|new|else|do|yield|await))\s*$/;

/** Index just past the `}` closing the object whose content starts at `from`, or -1 */
function closingBrace(code: string, from: number) {
    let depth = 0;
    for (let i = from; i < code.length; i++) {
        const c = code[i];
        if (c === "\"" || c === "'" || c === "`") {
            i = skipString(code, i);
            continue;
        }
        if (c === "{" || c === "(" || c === "[") depth++;
        else if (c === "}" || c === ")" || c === "]") {
            if (depth-- === 0) return c === "}" ? i + 1 : -1;
        }
    }
    return -1;
}

/** Index of the closing quote of the string starting at `start` (template expressions are skipped roughly) */
function skipString(code: string, start: number) {
    const quote = code.charCodeAt(start);
    let depth = 0;
    for (let i = start + 1; i < code.length; i++) {
        const c = code.charCodeAt(i);
        if (c === 92) { // backslash
            i++;
        } else if (quote === 96 && c === 36 && code.charCodeAt(i + 1) === 123) { // ${ in a template
            depth++;
            i++;
        } else if (depth && c === 125) {
            depth--;
        } else if (!depth && c === quote) {
            return i;
        }
    }
    return code.length;
}

function skipRegex(code: string, start: number) {
    let inClass = false;
    for (let i = start + 1; i < code.length; i++) {
        const c = code[i];
        if (c === "\\") i++;
        else if (c === "[") inClass = true;
        else if (c === "]") inClass = false;
        else if (c === "/" && !inClass) {
            while (/[a-z]/.test(code[i + 1] ?? "")) i++;
            return i;
        } else if (c === "\n") return i;
    }
    return code.length;
}

function isDestructuring(code: string, braceContentStart: number) {
    const end = closingBrace(code, braceContentStart);
    if (end < 0) return true;
    const next = code.slice(end, end + 3);
    return /^=(?![=>])/.test(next) || next.startsWith(")=>") || next.startsWith("){");
}

const isWordChar = (c: string | undefined) => !!c && /\w/.test(c);

/**
 * Whether the 200 characters before `at` end in a class head, as /\bclass\b[^{};]*$/ on them would
 * say, without slicing and running that regex at every `{`: this runs for each object literal.
 *
 * @param classAt every offset of "class" in the code, ascending
 */
function inClassHead(code: string, at: number, classAt: number[]) {
    const lo = Math.max(0, at - 200);
    // Index of the last "class" that ends by `at`
    let a = 0, b = classAt.length;
    while (a < b) {
        const mid = (a + b) >> 1;
        if (classAt[mid] + 5 <= at) a = mid + 1;
        else b = mid;
    }
    if (a === 0 || classAt[a - 1] < lo) return false;

    let from = at;
    while (from > lo && code[from - 1] !== "{" && code[from - 1] !== "}" && code[from - 1] !== ";") from--;
    for (let n = a - 1; n >= 0 && classAt[n] >= from; n--) {
        const k = classAt[n];
        if ((k === lo || !isWordChar(code[k - 1])) && (k + 5 === at || !isWordChar(code[k + 5]))) return true;
    }
    return false;
}

/** Offsets of `navId:` occurrences where `eviMenuArgs:arguments[0],` can be inserted */
export function findMenuArgSites(code: string): Set<number> {
    const sites = new Set<number>();
    // Open brackets: what each opens and where
    const kinds: number[] = [];
    const starts: number[] = [];
    let depth = 0;
    // The last `)` and its `(`: a `{` right after a `)` is all that asks where a paren opened
    let closeAt = -1;
    let openAt = -1;
    let seenFactory = false;
    // Nothing after the last navId: can be a site
    const end = code.lastIndexOf("navId:") + 1;
    const classAt: number[] = [];
    for (let k = code.indexOf("class"); k !== -1 && k < end; k = code.indexOf("class", k + 1)) classAt.push(k);

    for (let i = 0; i < end; i++) {
        const c = code.charCodeAt(i);

        if (c === 34 || c === 39 || c === 96) { // " ' `
            i = skipString(code, i);
        } else if (c === 47) { // /
            const next = code.charCodeAt(i + 1);
            if (next !== 47 && next !== 42 && REGEX_PRECEDER.test(code.slice(Math.max(0, i - 8), i))) i = skipRegex(code, i);
        } else if (c === 40 || c === 91) { // ( [
            kinds[depth] = OTHER;
            starts[depth++] = i;
        } else if (c === 41 || c === 93) { // ) ]
            if (depth > 0 && c === 41) {
                closeAt = i;
                openAt = starts[depth - 1];
            }
            if (depth > 0) depth--;
        } else if (c === 123) { // {
            kinds[depth] = classify(i);
            starts[depth++] = i;
        } else if (c === 125) { // }
            if (depth > 0) depth--;
        } else if (c === 110 && code.startsWith("navId:", i) && (code[i - 1] === "{" || code[i - 1] === ",")) { // n
            if (!depth || kinds[depth - 1] !== BLOCK || isDestructuring(code, starts[depth - 1] + 1)) continue;
            // `arguments` belongs to the innermost non-arrow function
            for (let f = depth - 1; f >= 0; f--) {
                const kind = kinds[f];
                if (kind === ARROW || kind === OTHER || kind === BLOCK) continue;
                if (kind === FUNCTION) sites.add(i);
                break;
            }
        }
    }
    return sites;

    function classify(at: number) {
        let j = at - 1;
        while (j >= 0 && /\s/.test(code[j])) j--;
        if (code[j] === ">" && code[j - 1] === "=") return ARROW;
        if (code[j] === ")") {
            if (closeAt !== j) return BLOCK;
            const head = code.slice(Math.max(0, openAt - 12), openAt);
            if (BLOCK_KEYWORD.test(head)) return BLOCK;
            if (!seenFactory) {
                seenFactory = true;
                return FACTORY;
            }
            return FUNCTION;
        }
        return inClassHead(code, at, classAt) ? CLASS : BLOCK;
    }
}

let lastCode: string | undefined;
let lastSites: Set<number> | undefined;

/** Replacement callback for /(?<=[{,])navId:/g, analyses each module source once */
export function injectMenuArgs(match: string, offset: number, code: string) {
    if (code !== lastCode) {
        lastCode = code;
        lastSites = findMenuArgSites(code);
        // One replace calls this for every site in a row, synchronously. After that the module's
        // source (up to a few MB) isn't kept for the session.
        queueMicrotask(() => {
            lastCode = undefined;
            lastSites = undefined;
        });
    }
    return lastSites!.has(offset) ? `${MENU_ARGS_KEY}:arguments[0],${match}` : match;
}
