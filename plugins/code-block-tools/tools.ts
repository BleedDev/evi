/** Pure helpers for Code Block Tools, unit tested in tests/codeBlockTools.test.ts */

/** A code block's language (```py) to the file extension its download gets */
const EXTENSIONS: Record<string, string> = {
    js: "js", javascript: "js", mjs: "mjs", cjs: "cjs", jsx: "jsx",
    ts: "ts", typescript: "ts", tsx: "tsx",
    py: "py", python: "py", rb: "rb", ruby: "rb", php: "php", lua: "lua", pl: "pl", perl: "pl", r: "r",
    java: "java", kt: "kt", kotlin: "kt", scala: "scala", groovy: "groovy", swift: "swift", dart: "dart",
    c: "c", h: "h", cpp: "cpp", "c++": "cpp", cc: "cpp", hpp: "hpp", cs: "cs", csharp: "cs", "c#": "cs", fs: "fs", fsharp: "fs",
    go: "go", golang: "go", rs: "rs", rust: "rs", zig: "zig", nim: "nim", hs: "hs", haskell: "hs", ex: "ex", elixir: "ex",
    erl: "erl", erlang: "erl", clj: "clj", clojure: "clj", ml: "ml", ocaml: "ml", vb: "vb", vbnet: "vb",
    sh: "sh", bash: "sh", shell: "sh", zsh: "sh", fish: "fish", ps1: "ps1", powershell: "ps1", ps: "ps1", bat: "bat", cmd: "bat", batch: "bat",
    json: "json", json5: "json5", jsonc: "jsonc", yaml: "yml", yml: "yml", toml: "toml", ini: "ini", cfg: "cfg", conf: "conf", env: "env",
    xml: "xml", html: "html", htm: "html", svg: "svg", css: "css", scss: "scss", sass: "sass", less: "less",
    md: "md", markdown: "md", tex: "tex", latex: "tex", sql: "sql", graphql: "graphql", gql: "graphql",
    diff: "diff", patch: "diff", dockerfile: "dockerfile", docker: "dockerfile", makefile: "mk", make: "mk", cmake: "cmake",
    vue: "vue", svelte: "svelte", glsl: "glsl", hlsl: "hlsl", asm: "asm", nasm: "asm", x86asm: "asm",
    csv: "csv", log: "log", txt: "txt", text: "txt", plaintext: "txt",
};

/** The extension for a code block's language; "txt" when there's none or it's unknown */
export function extensionFor(lang: string | null | undefined): string {
    const key = (lang ?? "").trim().toLowerCase();
    return EXTENSIONS[key] ?? "txt";
}

/** What a downloaded code block is called: code.py, code.json, code.txt */
export const codeFilename = (lang: string | null | undefined) => `code.${extensionFor(lang)}`;

const JSON_LANGS = new Set(["json", "json5", "jsonc", "geojson"]);
/** Bigger than this isn't parsed on render: a pretty print button on a 2 MB block isn't worth the jank */
export const MAX_JSON_CHARS = 1_000_000;

/** Whether a code block or file is JSON: marked as JSON, or an object or array that parses */
export function isJson(text: string, lang?: string | null): boolean {
    if (!text || text.length > MAX_JSON_CHARS) return false;
    const trimmed = text.trim();
    const marked = JSON_LANGS.has((lang ?? "").trim().toLowerCase());
    if (!marked && !/^[[{]/.test(trimmed)) return false;
    try {
        JSON.parse(trimmed);
        return true;
    } catch {
        return false;
    }
}

/** The JSON pretty printed with two spaces, or null if it isn't JSON or already looks like that */
export function prettyJson(text: string): string | null {
    if (!text || text.length > MAX_JSON_CHARS) return null;
    try {
        const pretty = JSON.stringify(JSON.parse(text.trim()), null, 2);
        return pretty === text.trim() ? null : pretty;
    } catch {
        return null;
    }
}

/** How many lines a text has, as shown: a final newline doesn't start one more */
export function lineCount(text: string): number {
    if (!text) return 1;
    const lines = text.split("\n").length;
    return text.endsWith("\n") ? lines - 1 : lines;
}

/** "1\n2\n3": the numbers beside a code block's lines */
export function gutterText(count: number): string {
    return Array.from({ length: Math.max(1, count) }, (_, i) => String(i + 1)).join("\n");
}

/**
 * The numbers beside a code block or text file, as a CSS string for `content:` ("1\A 2\A 3"). In a
 * file preview (`previewNotice`), Discord ends a cut-off text with a line like "... 120 more lines":
 * that line gets no number.
 */
export function gutterCss(text: string, previewNotice = true): string {
    const lines = text.split("\n");
    const notice = previewNotice && lines.length > 1 && /^\.\.\.(?:\s|$)/.test(lines[lines.length - 1]);
    const numbered = lineCount(text) - (notice ? 1 : 0);
    const numbers = Array.from({ length: Math.max(1, numbered) }, (_, i) => String(i + 1));
    if (notice) numbers.push(" ");
    return `"${numbers.join("\\A ")}"`;
}

/** Files that are text, by extension, for the inline preview under Discord's plain file cards */
const TEXT_EXTENSIONS = new Set([
    ...Object.values(EXTENSIONS),
    "txt", "log", "md", "csv", "tsv", "nfo", "srt", "vtt", "properties", "gradle", "lock", "gitignore", "gitattributes",
    "editorconfig", "npmrc", "htaccess", "reg", "inf", "sln", "csproj", "vcxproj", "plist", "rst", "adoc", "org", "cfg", "conf",
    "ini", "env", "toml", "yml", "yaml", "json", "xml", "jsonl", "ndjson", "sum", "mod",
]);

const TEXT_TYPES = /^(?:text\/|application\/(?:json|xml|javascript|x-javascript|ecmascript|x-sh|x-yaml|yaml|toml|x-toml|sql|graphql|ld\+json|x-httpd-php|x-python|x-ruby|x-perl|x-lua))/i;

/** A file's extension, lower case, without the dot ("" for none) */
export function fileExtension(name: string | null | undefined): string {
    const base = (name ?? "").split(/[\\/]/).pop() ?? "";
    // .gitignore, .env: the whole name is the extension
    if (/^\.[^.]+$/.test(base)) return base.slice(1).toLowerCase();
    const dot = base.lastIndexOf(".");
    return dot > 0 ? base.slice(dot + 1).toLowerCase() : "";
}

/** Whether a file is text worth previewing, by its type or else its extension */
export function isTextFile(name: string | null | undefined, contentType?: string | null): boolean {
    if (contentType && TEXT_TYPES.test(contentType)) return true;
    const ext = fileExtension(name);
    return !!ext && TEXT_EXTENSIONS.has(ext);
}

/** The language a file's extension is, for JSON detection: "json" for .json files */
export const languageOf = (name: string | null | undefined) => fileExtension(name);

/** How much of a file the inline preview and Copy read at most */
export const MAX_FILE_BYTES = 512 * 1024;

/** A JSON value's tokens, coloured with highlight.js's classes, which Discord's code theme styles */
export interface Token { text: string; className?: string; }

const JSON_TOKEN = /("(?:[^"\\]|\\.)*")(\s*:)?|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|\b(true|false|null)\b|([{}[\],:])|(\s+)|(.)/gs;

export function jsonTokens(text: string): Token[] {
    const out: Token[] = [];
    for (const m of text.matchAll(JSON_TOKEN)) {
        const [, str, colon, num, literal, punct, space, other] = m;
        if (str !== undefined) {
            out.push({ text: str, className: colon ? "hljs-attr" : "hljs-string" });
            if (colon) out.push({ text: colon, className: "hljs-punctuation" });
        } else if (num !== undefined) out.push({ text: num, className: "hljs-number" });
        else if (literal !== undefined) out.push({ text: literal, className: "hljs-literal" });
        else if (punct !== undefined) out.push({ text: punct, className: "hljs-punctuation" });
        else out.push({ text: space ?? other });
    }
    return out;
}
