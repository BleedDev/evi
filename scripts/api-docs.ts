/**
 * Writes src/shared/apiDocs.json: every export of @evi/api (src/api/index.ts) and the public members
 * of a plugin's `ctx` (PluginContext) and `ctx.settings` (PluginSettings), each with its signature as
 * written in the source and the summary of its JSDoc. Evi's DevTools and Patch Helper show them on
 * hover. tests/apiDocs.test.ts regenerates them and fails when the file is out of date.
 *
 *   node scripts/api-docs.ts            writes the file
 *   node scripts/api-docs.ts --check    exits 1 when it's out of date
 *
 * Parsing goes through TypeScript's own API (the tsgo server the `typescript` devDependency ships),
 * so signatures are exactly what the declarations say.
 * Runs on Node: TypeScript's synchronous transport needs Node's pipe handles on POSIX.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { SyntaxKind } from "typescript/unstable/ast";
import { API } from "typescript/unstable/sync";

export interface ApiDocEntry {
    name: string;
    kind: string;
    signature: string;
    doc: string;
    example?: string;
}

const ROOT = resolve(import.meta.dirname, "..");
export const API_DOCS_PATH = resolve(ROOT, "src/shared/apiDocs.json");
const ENTRY = resolve(ROOT, "src/api/index.ts");
const CONTEXT = resolve(ROOT, "src/renderer/plugins/context.ts");

/** Longest a type's text gets before it's cut, so a tooltip stays a tooltip */
const MAX_TYPE_TEXT = 400;
/** Members an interface's signature lists before "…" */
const MAX_MEMBERS = 12;

/** Hand-written examples for the calls plugins make most */
const EXAMPLES: Record<string, string> = {
    definePlugin: `export default definePlugin({
    settings: { greeting: { type: "string", label: "Greeting", default: "Hi" } },
    start(ctx) {
        ctx.toast(ctx.settings.get("greeting"));
    },
});`,
    "ctx.hookExport": `// After the export itself
ctx.hookExport("after", filters.componentByCode("userProfile"), ({ result }) => result);
// Before a method on the export
ctx.hookExport("before", filters.byProps("sendMessage"), "sendMessage", ({ args }) => {
    args[1].content = args[1].content.trim();
});`,
    "ctx.contextMenu": `ctx.contextMenu("message", (children, { message }) => {
    children.push(<Menu.Item id="evi-copy-id" label="Copy ID" action={() => copy(message.id)} />);
});`,
    "ctx.command": `ctx.command({
    name: "shrug",
    description: "Sends a shrug",
    execute: () => ({ content: "¯\\\\_(ツ)_/¯" }),
});`,
    "ctx.keybind": `// settings: { toggle: { type: "keybind", label: "Toggle", default: "Ctrl+Shift+KeyG" } }
ctx.keybind("toggle", () => ctx.toast("Toggled"));`,
    findByProps: `const { getCurrentUser } = findByProps("getCurrentUser", "getUser");`,
    showToast: `showToast("Copied", { type: "success" });`,
};

/** Not a declaration anywhere, but what source patches write most */
const SELF: ApiDocEntry = {
    name: "$self",
    kind: "keyword",
    signature: "$self",
    doc: "In a source patch's replacement: your plugin's definition at runtime, so patched code can call your functions. Each call is measured, and counted in DevTools' Patch hits.",
    example: `patches: [{
    find: "renderAvatar",
    replace: { match: /(?<=avatar:)\\i/, with: "$self.wrapAvatar($&)" },
}]`,
};

/** One line, single spaces: signatures read the same however they were wrapped */
const oneLine = (text: string) => stripComments(text).replace(/\s+/g, " ").replace(/\(\s/g, "(").replace(/\s\)/g, ")").replace(/,\s*\)/g, ")").trim();

/** Comments inside a declaration (member docs) don't belong in its signature */
const stripComments = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/[^\n]*/g, "$1");

const clip = (text: string, max = MAX_TYPE_TEXT) => text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;

const stripDeclarationKeywords = (text: string) => text.replace(/^(?:export\s+)?(?:default\s+)?(?:declare\s+)?(?:async\s+)?(?:function\s*\*?\s*)?/, "");

/**
 * The first paragraph of a JSDoc comment, without tags. Lines indented deeper than the comment's text
 * (usage examples) keep their line breaks; prose lines are joined.
 */
export function jsDocSummary(raw: string) {
    const lines = raw
        .replace(/^\/\*\*/, "")
        .replace(/\*\/$/, "")
        .split(/\r?\n/)
        .map(line => line.replace(/^\s*\* ?/, ""));
    const out: string[] = [];
    for (const line of lines) {
        if (/^\s*@/.test(line)) break;
        if (!line.trim()) {
            if (out.length) break;
            continue;
        }
        // Indented or column-aligned lines are examples or tables: they keep their line breaks
        const code = /^\s{2,}/.test(line) || /\S {2,}\S/.test(line);
        if (!out.length) out.push(code ? line.trimEnd() : line.trim());
        else if (code) out.push(`\n${line.trimEnd()}`);
        else out.push(out[out.length - 1].startsWith("\n") ? `\n${line.trim()}` : ` ${line.trim()}`);
    }
    return out.join("").trim();
}

const isInternal = (raw: string) => /@internal\b/.test(raw);

type Node = any;

const list = (nodes: Node): Node[] => nodes ? Array.from(nodes as ArrayLike<Node>) : [];

function docOf(node: Node) {
    const docs = list(node?.jsDoc);
    const last = docs[docs.length - 1];
    let raw = last ? last.getText() as string : "";
    // A file's header comment lands on its first statement; a blank line after it says it isn't that statement's
    if (last && /\n[ \t]*\r?\n/.test(node.getSourceFile().text.slice(last.end, node.getStart()))) raw = "";
    return { raw, summary: raw ? jsDocSummary(raw) : "" };
}

const hasModifier = (node: Node, kind: SyntaxKind) => list(node.modifiers).some(m => m.kind === kind);
const isExported = (node: Node) => hasModifier(node, SyntaxKind.ExportKeyword);
const isHidden = (node: Node) =>
    hasModifier(node, SyntaxKind.PrivateKeyword) || hasModifier(node, SyntaxKind.ProtectedKeyword) || node.name?.kind === SyntaxKind.PrivateIdentifier;

const nameOf = (node: Node): string | undefined => node?.name?.text ?? node?.name?.getText?.();

/** Source text of `node` from its first token (JSDoc left out) up to `end` */
function textTo(node: Node, end: number) {
    const file = node.getSourceFile();
    return file.text.slice(node.getStart(), end) as string;
}

/** `name<T>(params): Ret` of a function-like node, without its body */
function callSignature(node: Node) {
    const text = node.body ? textTo(node, node.body.getStart()) : node.getText();
    return oneLine(stripDeclarationKeywords(text)).replace(/\s*(?:=>|;)\s*$/, "");
}

/** `<T>(params): Ret` of an arrow function or function expression */
function functionValueSignature(fn: Node) {
    let text = fn.body ? textTo(fn, fn.body.getStart()) : fn.getText();
    text = text.replace(/^async\s+/, "").replace(/^function\s*\*?\s*[\w$]*/, "");
    return oneLine(text).replace(/\s*=>\s*$/, "");
}

const isFunctionValue = (node: Node) => node?.kind === SyntaxKind.ArrowFunction || node?.kind === SyntaxKind.FunctionExpression;

/** `{ a, b(), get c }` for an object literal: what's on it, not its code */
function objectShape(literal: Node) {
    const names = list(literal.properties).map(p => {
        const name = nameOf(p) ?? p.getText();
        if (p.kind === SyntaxKind.GetAccessor) return name;
        if (p.kind === SyntaxKind.MethodDeclaration || isFunctionValue(p.initializer)) return `${name}()`;
        return name;
    });
    return `{ ${names.join(", ")} }`;
}

/** An interface or type literal's members, one per line, comments left out */
function membersShape(members: Node[]) {
    const lines = members.slice(0, MAX_MEMBERS).map(m => `    ${oneLine(m.getText()).replace(/;$/, "")};`);
    if (members.length > MAX_MEMBERS) lines.push("    …");
    return lines.length ? `{\n${lines.join("\n")}\n}` : "{}";
}

interface Found {
    kind: string;
    signature: string;
    doc: string;
    node: Node;
}

/** What a declaration of `name` in `file` says about itself */
function describeDeclarations(decls: Node[], name: string): Found | undefined {
    const first = decls[0];
    if (!first) return;
    const doc = docOf(decls.find(d => d.jsDoc?.length) ?? first);
    if (isInternal(doc.raw)) return;

    switch (first.kind) {
        case SyntaxKind.FunctionDeclaration: {
            // Overloads: their signatures, not the implementation's
            const overloads = decls.filter(d => !d.body);
            const shown = overloads.length ? overloads : decls;
            return { kind: "function", signature: shown.map(callSignature).join("\n"), doc: doc.summary, node: first };
        }
        case SyntaxKind.ClassDeclaration: {
            const header = oneLine(stripDeclarationKeywords(textTo(first, first.members.pos - 1)));
            return { kind: "class", signature: header, doc: doc.summary, node: first };
        }
        case SyntaxKind.InterfaceDeclaration: {
            const header = oneLine(stripDeclarationKeywords(textTo(first, first.members.pos - 1)));
            return { kind: "interface", signature: `${header} ${membersShape(list(first.members))}`, doc: doc.summary, node: first };
        }
        case SyntaxKind.TypeAliasDeclaration:
            return { kind: "type", signature: clip(oneLine(stripDeclarationKeywords(first.getText()))), doc: doc.summary, node: first };
        case SyntaxKind.EnumDeclaration: {
            const members = list(first.members).map(nameOf);
            return { kind: "enum", signature: `enum ${name} { ${members.join(", ")} }`, doc: doc.summary, node: first };
        }
        case SyntaxKind.VariableDeclaration: {
            const init = first.initializer;
            let signature: string;
            let kind = "const";
            if (first.type) signature = `const ${name}: ${clip(oneLine(first.type.getText()))}`;
            else if (isFunctionValue(init)) {
                kind = "function";
                signature = `${name}${functionValueSignature(init)}`;
            } else if (init?.kind === SyntaxKind.ObjectLiteralExpression) signature = `const ${name}: ${objectShape(init)}`;
            else signature = `const ${name}`;
            return { kind, signature, doc: doc.summary, node: first };
        }
    }
}

interface Program {
    getSourceFile(file: string): Node | undefined;
}

const normalize = (path: string) => path.replace(/\\/g, "/");

function resolveModule(program: Program, from: string, specifier: string): string | undefined {
    if (!specifier.startsWith(".")) return;
    const base = resolve(dirname(from), specifier);
    for (const candidate of [`${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`, base]) {
        if (program.getSourceFile(normalize(candidate))) return candidate;
    }
}

/** Every declaration each exported name has in `file` (functions can have several: overloads) */
function exportedDeclarations(file: Node) {
    const byName = new Map<string, Node[]>();
    const add = (name: string | undefined, node: Node) => {
        if (!name) return;
        const decls = byName.get(name);
        if (decls) decls.push(node);
        else byName.set(name, [node]);
    };
    for (const statement of list(file.statements)) {
        if (!isExported(statement)) continue;
        if (statement.kind === SyntaxKind.VariableStatement) {
            // The JSDoc sits on the statement: hand it down to its (usually single) declaration
            for (const decl of list(statement.declarationList.declarations)) add(nameOf(decl), withDoc(decl, statement));
        } else {
            add(nameOf(statement), statement);
        }
    }
    return byName;
}

/** A variable declaration that answers with its statement's JSDoc */
function withDoc(decl: Node, statement: Node) {
    return new Proxy(decl, {
        get: (target, key) => key === "jsDoc" ? statement.jsDoc : Reflect.get(target, key, target),
    });
}

function collectModule(program: Program, path: string, onlyTypes: boolean, out: Map<string, ApiDocEntry>, seen = new Set<string>()) {
    if (seen.has(path)) return;
    seen.add(path);
    const file = program.getSourceFile(normalize(path));
    if (!file) throw new Error(`api-docs: ${path} isn't part of the project`);
    for (const [name, decls] of exportedDeclarations(file)) {
        if (out.has(name)) continue;
        const found = describeDeclarations(decls, name);
        if (!found) continue;
        if (onlyTypes && !["interface", "type", "class", "enum"].includes(found.kind)) continue;
        out.set(name, entry(name, found));
    }
}

function entry(name: string, found: Pick<Found, "kind" | "signature" | "doc">): ApiDocEntry {
    const example = EXAMPLES[name];
    return { name, kind: found.kind, signature: found.signature, doc: found.doc, ...example && { example } };
}

/** Finds `name` in `path`, following re-exports */
function findExport(program: Program, path: string, name: string, depth = 0): Found | undefined {
    const file = program.getSourceFile(normalize(path));
    if (!file || depth > 4) return;
    const decls = exportedDeclarations(file).get(name);
    if (decls) return describeDeclarations(decls, name);
    for (const statement of list(file.statements)) {
        if (statement.kind !== SyntaxKind.ExportDeclaration || !statement.moduleSpecifier) continue;
        const target = resolveModule(program, path, statement.moduleSpecifier.text);
        if (!target) continue;
        const elements = statement.exportClause ? list(statement.exportClause.elements) : undefined;
        const element = elements?.find(e => nameOf(e) === name);
        if (element) return findExport(program, target, element.propertyName?.text ?? name, depth + 1);
        if (!elements) {
            const found = findExport(program, target, name, depth + 1);
            if (found) return found;
        }
    }
}

function collectEntry(program: Program, out: Map<string, ApiDocEntry>) {
    const file = program.getSourceFile(normalize(ENTRY));
    if (!file) throw new Error("api-docs: src/api/index.ts isn't part of the project");

    for (const statement of list(file.statements)) {
        if (statement.kind === SyntaxKind.ExportDeclaration) {
            const target = statement.moduleSpecifier && resolveModule(program, ENTRY, statement.moduleSpecifier.text);
            if (!target) continue;
            if (!statement.exportClause) {
                // export type * from "…": every type it declares
                collectModule(program, target, !!statement.isTypeOnly, out);
                continue;
            }
            for (const element of list(statement.exportClause.elements)) {
                const name = nameOf(element)!;
                if (out.has(name)) continue;
                const found = findExport(program, target, element.propertyName?.text ?? name);
                if (found) out.set(name, entry(name, found));
            }
        } else if (isExported(statement)) {
            const decls = statement.kind === SyntaxKind.VariableStatement
                ? list(statement.declarationList.declarations).map(d => withDoc(d, statement))
                : [statement];
            for (const decl of decls) {
                const name = nameOf(decl)!;
                const found = describeDeclarations([decl], name);
                if (found && !out.has(name)) out.set(name, entry(name, found));
            }
        }
    }
}

/** Public members of a class, as `prefix.member` entries. Object-valued properties list their functions too. */
function collectMembers(program: Program, className: string, prefix: string, out: Map<string, ApiDocEntry>) {
    const file = program.getSourceFile(normalize(CONTEXT));
    const cls = list(file?.statements).find(s => s.kind === SyntaxKind.ClassDeclaration && nameOf(s) === className);
    if (!cls) throw new Error(`api-docs: no class ${className} in context.ts`);

    const byName = new Map<string, Node[]>();
    for (const member of list(cls.members)) {
        if (member.kind === SyntaxKind.Constructor) {
            // Constructor parameters with an access modifier are members too (`readonly manifest`)
            for (const param of list(member.parameters)) {
                if (!list(param.modifiers).length || isHidden(param)) continue;
                const name = nameOf(param)!;
                out.set(`${prefix}.${name}`, entry(`${prefix}.${name}`, {
                    kind: "property",
                    signature: `${prefix}.${name}: ${param.type ? clip(oneLine(param.type.getText())) : "unknown"}`,
                    doc: docOf(param).summary,
                }));
            }
            continue;
        }
        const name = nameOf(member);
        if (!name || isHidden(member)) continue;
        const decls = byName.get(name);
        if (decls) decls.push(member);
        else byName.set(name, [member]);
    }

    for (const [name, decls] of byName) {
        const full = `${prefix}.${name}`;
        const first = decls[0];
        const doc = docOf(decls.find(d => d.jsDoc?.length) ?? first);
        if (isInternal(doc.raw)) continue;

        if (first.kind === SyntaxKind.MethodDeclaration) {
            const overloads = decls.filter(d => !d.body);
            const signature = (overloads.length ? overloads : decls).map(d => `${prefix}.${callSignature(d)}`).join("\n");
            out.set(full, entry(full, { kind: "method", signature, doc: doc.summary }));
        } else if (first.kind === SyntaxKind.GetAccessor) {
            const type = first.type ? `: ${clip(oneLine(first.type.getText()))}` : "";
            out.set(full, entry(full, { kind: "property", signature: `${full}${type}`, doc: doc.summary }));
        } else if (first.kind === SyntaxKind.PropertyDeclaration) {
            const init = first.initializer;
            if (isFunctionValue(init)) {
                out.set(full, entry(full, { kind: "method", signature: `${full}${functionValueSignature(init)}`, doc: doc.summary }));
            } else if (init?.kind === SyntaxKind.ObjectLiteralExpression) {
                out.set(full, entry(full, { kind: "property", signature: `${full}: ${objectShape(init)}`, doc: doc.summary }));
                for (const prop of list(init.properties)) {
                    const sub = `${full}.${nameOf(prop)}`;
                    const fn = prop.kind === SyntaxKind.MethodDeclaration ? prop : isFunctionValue(prop.initializer) ? prop.initializer : undefined;
                    if (!fn) continue;
                    const signature = fn === prop ? `${full}.${callSignature(prop)}` : `${sub}${functionValueSignature(fn)}`;
                    out.set(sub, entry(sub, { kind: "method", signature, doc: docOf(prop).summary || doc.summary }));
                }
            } else {
                const type = first.type ? `: ${clip(oneLine(first.type.getText()))}` : "";
                out.set(full, entry(full, { kind: "property", signature: `${full}${type}`, doc: doc.summary }));
            }
        }
    }
}

export function generateApiDocs(): ApiDocEntry[] {
    const api = new API({ cwd: ROOT });
    try {
        const snapshot = api.updateSnapshot({ openFiles: [normalize(ENTRY)] });
        const project = snapshot.getDefaultProjectForFile(normalize(ENTRY));
        if (!project) throw new Error("api-docs: no TypeScript project for src/api/index.ts");
        const program = project.program as unknown as Program;

        const out = new Map<string, ApiDocEntry>();
        collectEntry(program, out);
        collectMembers(program, "PluginContext", "ctx", out);
        collectMembers(program, "PluginSettings", "ctx.settings", out);
        out.set(SELF.name, SELF);
        return [...out.values()];
    } finally {
        api.close();
    }
}

export const formatApiDocs = (docs: ApiDocEntry[]) => `${JSON.stringify(docs, null, 4)}\n`;

if (import.meta.main) {
    const docs = generateApiDocs();
    const next = formatApiDocs(docs);
    if (process.argv.includes("--check")) {
        let current = "";
        try {
            current = readFileSync(API_DOCS_PATH, "utf8");
        } catch { }
        if (current.replace(/\r\n/g, "\n") !== next) {
            console.error("src/shared/apiDocs.json is out of date: run node scripts/api-docs.ts");
            process.exit(1);
        }
        console.log(`apiDocs.json is up to date (${docs.length} entries)`);
    } else {
        writeFileSync(API_DOCS_PATH, next);
        console.log(`Wrote ${docs.length} entries to src/shared/apiDocs.json`);
    }
}
