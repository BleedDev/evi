/**
 * Every plugin in the store speaks every language Evi does. Checked on upload (submissionChecks.ts),
 * by `bun run preview-plugin`, and for Evi's own plugins by tests/pluginTranslations.test.ts:
 *
 *  - manifest.json's "locales" has each language's name, description and this version's notes;
 *  - the code's text is in defineStrings({ en: {…}, de: {…}, … }), with every English key in every
 *    language. Settings labels and descriptions written as plain strings count as text left out.
 *
 * The strings table is read from the built index.js without running it: a small scanner finds the
 * defineStrings(...) call and the keys of each language, skipping strings, templates and comments.
 */

/** The languages besides English that Evi ships, as Discord names them (shared/locales) */
export const PLUGIN_LANGUAGES = ["de", "es", "fr", "ja", "pl", "pt-BR", "ru", "tr"] as const;

/** Skips a string, template or comment starting at `i`; returns where it ends, or i when it isn't one */
function skip(code: string, i: number): number {
    const c = code[i];
    if (c === '"' || c === "'" || c === "`") {
        for (let j = i + 1; j < code.length; j++) {
            if (code[j] === "\\") j++;
            else if (code[j] === c) return j + 1;
            // Templates can nest code in ${…}; its braces are balanced, so skipping by depth works
            else if (c === "`" && code[j] === "$" && code[j + 1] === "{") j = matching(code, j + 1) - 1;
        }
        return code.length;
    }
    if (c === "/" && code[i + 1] === "/") {
        const end = code.indexOf("\n", i);
        return end === -1 ? code.length : end;
    }
    if (c === "/" && code[i + 1] === "*") {
        const end = code.indexOf("*/", i + 2);
        return end === -1 ? code.length : end + 2;
    }
    return i;
}

/** Index just past the bracket matching the one at `open` */
function matching(code: string, open: number): number {
    let depth = 0;
    for (let i = open; i < code.length;) {
        const next = skip(code, i);
        if (next !== i) {
            i = next;
            continue;
        }
        const c = code[i];
        if (c === "{" || c === "(" || c === "[") depth++;
        else if (c === "}" || c === ")" || c === "]") {
            depth--;
            if (depth === 0) return i + 1;
        }
        i++;
    }
    return code.length;
}

/** The keys of an object literal's own properties, in `body` (the text between its braces) */
function ownKeys(body: string): { key: string; value: string; }[] {
    const out: { key: string; value: string; }[] = [];
    let i = 0;
    while (i < body.length) {
        while (i < body.length && /[\s,]/.test(body[i])) i++;
        const commentEnd = skip(body, i);
        if (commentEnd !== i && body[i] === "/") {
            i = commentEnd;
            continue;
        }
        let key: string;
        if (body[i] === '"' || body[i] === "'") {
            const end = skip(body, i);
            key = body.slice(i + 1, end - 1);
            i = end;
        } else {
            const m = /^[\w$-]+/.exec(body.slice(i));
            if (!m) {
                i++;
                continue;
            }
            key = m[0];
            i += key.length;
        }
        while (/\s/.test(body[i] ?? "")) i++;
        if (body[i] !== ":") {
            // A language Evi's build made lazy (scripts/lazyStrings.ts) counts as its table:
            // get de() { return Object.defineProperty(this, "de", { value: {…} })["de"]; }
            const lazy = key === "get" ? /^(?:"[^"]*"|[\w$-]+)\s*\(\)\s*\{\s*return\s+Object\.defineProperty\(this,\s*"([^"]+)",\s*\{\s*value:\s*(?=\{)/.exec(body.slice(i)) : null;
            if (lazy) out.push({ key: lazy[1], value: body.slice(i + lazy[0].length, matching(body, i + lazy[0].length)) });
            // A method or getter: skip to its end
            const brace = body.indexOf("{", i);
            i = brace === -1 ? body.length : matching(body, brace);
            continue;
        }
        i++;
        // The value runs to the next comma at this depth
        const start = i;
        while (i < body.length && body[i] !== ",") {
            const next = skip(body, i);
            if (next !== i) i = next;
            else if ("{([".includes(body[i])) i = matching(body, i);
            else i++;
        }
        out.push({ key, value: body.slice(start, i).trim() });
    }
    return out;
}

/** Each defineStrings(...) table in the code: language -> its keys. Empty when it doesn't use one */
export function stringTables(code: string): Map<string, Set<string>>[] {
    const tables: Map<string, Set<string>>[] = [];
    const re = /defineStrings\)?\s*\(/g;
    for (let m = re.exec(code); m; m = re.exec(code)) {
        const open = code.indexOf("{", m.index + m[0].length - 1);
        const paren = code.indexOf(")", m.index + m[0].length);
        if (open === -1 || (paren !== -1 && paren < open)) continue;
        const end = matching(code, open);
        const table = new Map<string, Set<string>>();
        for (const { key: lang, value } of ownKeys(code.slice(open + 1, end - 1))) {
            if (!value.startsWith("{")) continue;
            table.set(lang, new Set(ownKeys(value.slice(1, matching(value, 0) - 1)).map(p => p.key)));
        }
        if (table.size) tables.push(table);
        re.lastIndex = end;
    }
    return tables;
}

/** Settings written with plain English labels or descriptions (`label: "…"`), not through t() */
function plainSettingsText(code: string) {
    return /\b(?:label|description)\s*:\s*["'`][^"'`]*[A-Za-z]{3}/.test(code);
}

/** What's missing for a plugin to speak every language, in plain words; empty when nothing is */
export function missingTranslations(manifest: Record<string, any>, code: string, languages: readonly string[] = PLUGIN_LANGUAGES): string[] {
    const problems: string[] = [];
    const locales = manifest.locales && typeof manifest.locales === "object" ? manifest.locales : {};
    const version = manifest.version;
    const hasNotes = Array.isArray(manifest.changelog) && manifest.changelog.some((c: any) => c?.version === version);

    const noManifest: string[] = [];
    for (const lang of languages) {
        const l = locales[lang];
        const missing = [
            typeof l?.name !== "string" || !l.name.trim() ? "name" : "",
            typeof manifest.description === "string" && manifest.description.trim() && (typeof l?.description !== "string" || !l.description.trim()) ? "description" : "",
            hasNotes && !(Array.isArray(l?.changelog?.[version]) && l.changelog[version].length) ? `${version} notes` : "",
        ].filter(Boolean);
        if (missing.length) noManifest.push(`${lang} (${missing.join(", ")})`);
    }
    if (noManifest.length) problems.push(`manifest.json "locales" is missing ${noManifest.join("; ")}`);

    const tables = stringTables(code);
    if (!tables.length) {
        if (plainSettingsText(code)) problems.push(`Its text is written in English only: put it in defineStrings({ en: {…}, ${languages.join(", ")} }) and use t("key") (see docs/plugins.md, "Translations")`);
    }
    for (const table of tables) {
        const en = table.get("en");
        if (!en) {
            problems.push("defineStrings has no en table: English is what every other language is checked against");
            continue;
        }
        for (const lang of languages) {
            const keys = table.get(lang);
            const missing = [...en].filter(k => !keys?.has(k));
            if (!keys) problems.push(`defineStrings has no ${lang} table`);
            else if (missing.length) problems.push(`defineStrings ${lang} is missing ${missing.length > 5 ? `${missing.slice(0, 5).join(", ")} and ${missing.length - 5} more` : missing.join(", ")}`);
        }
    }
    return problems;
}
