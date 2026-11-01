import type { SourcePatch } from "@evi/api";

/**
 * Pure pieces of Snippets: the saved replies, every change to them, placeholder expansion and
 * search. No Discord or Evi runtime imports, so tests can run all of it. Every change returns a new
 * state (or the same object when nothing changed) and never mutates its input.
 */

/** The wording of the messages this file returns. English here; index.tsx passes its translations in (strings.ts) */
export type SayKey =
    | "err.nameEmpty" | "err.nameLong" | "err.nameTaken" | "err.textEmpty" | "err.textLong"
    | "err.none" | "err.which" | "err.more" | "err.noneCalledClose" | "err.noneCalled";
export type Say = (key: SayKey, vars?: Record<string, string | number>) => string;

const ENGLISH: Record<SayKey, string> = {
    "err.nameEmpty": "Give it a name.",
    "err.nameLong": "Names can be up to {max} characters.",
    "err.nameTaken": "There's already a snippet called \"{name}\".",
    "err.textEmpty": "Write the text to insert.",
    "err.textLong": "Snippets can be up to {max} characters (this one is {length}).",
    "err.none": "You have no snippets yet. Add one from the snippets button in the chat bar, or right-click a message and pick Save as Snippet.",
    "err.which": "Which snippet? You have: {list}",
    "err.more": ", and {n} more",
    "err.noneCalledClose": "No snippet is called \"{value}\". Did you mean: {list}?",
    "err.noneCalled": "No snippet is called \"{value}\". You have: {list}",
};

const english: Say = (key, vars) => ENGLISH[key].replace(/\{(\w+)\}/g, (whole, name: string) => vars && name in vars ? String(vars[name]) : whole);

export interface Snippet {
    id: string;
    /** Unique, case-insensitively */
    name: string;
    /** May span several lines and hold placeholders like {user} */
    text: string;
    createdAt: number;
    /** How many times it was inserted or sent */
    uses: number;
    /** When it was last inserted or sent, 0 if never */
    lastUsed: number;
}

export interface SnippetState {
    snippets: Snippet[];
}

export interface SnippetInput {
    name: string;
    text: string;
}

export type ChangeResult = { state: SnippetState; snippet?: Snippet; error?: string; };

export const EMPTY: SnippetState = { snippets: [] };
export const MAX_NAME_LENGTH = 32;
/** Discord's message limit with Nitro; without it Discord itself says the message is too long */
export const MAX_TEXT_LENGTH = 4000;
export const MAX_SNIPPETS = 500;
/** Discord shows at most this many choices for a command option */
export const MAX_CHOICES = 25;

export function makeId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/** A single-line, trimmed, length-capped name, or "" when there is nothing usable */
export function cleanName(name: unknown) {
    return typeof name === "string" ? name.replace(/\s+/g, " ").trim().slice(0, MAX_NAME_LENGTH) : "";
}

/** Unix line endings, no trailing whitespace on the whole text, no leading blank lines */
export function cleanText(text: unknown) {
    return typeof text === "string" ? text.replace(/\r\n?/g, "\n").replace(/^\s*\n/, "").trimEnd() : "";
}

const key = (name: string) => cleanName(name).toLocaleLowerCase();

/** Why this name can't be used, or null. `exceptId` is the snippet being renamed. */
export function nameError(state: SnippetState, name: unknown, exceptId?: string, say: Say = english): string | null {
    if (typeof name !== "string" || !cleanName(name)) return say("err.nameEmpty");
    if (name.replace(/\s+/g, " ").trim().length > MAX_NAME_LENGTH) return say("err.nameLong", { max: MAX_NAME_LENGTH });
    const k = key(name);
    const taken = state.snippets.find(s => s.id !== exceptId && key(s.name) === k);
    return taken ? say("err.nameTaken", { name: taken.name }) : null;
}

/** Why this text can't be saved, or null */
export function textError(text: unknown, say: Say = english): string | null {
    const clean = cleanText(text);
    if (!clean.trim()) return say("err.textEmpty");
    if (clean.length > MAX_TEXT_LENGTH) return say("err.textLong", { max: MAX_TEXT_LENGTH, length: clean.length });
    return null;
}

/** The first problem with this input, or null */
export function inputError(state: SnippetState, input: SnippetInput, exceptId?: string) {
    return nameError(state, input.name, exceptId) ?? textError(input.text);
}

const count = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;

/** A valid state from whatever was stored: drops broken entries, duplicate ids and duplicate names */
export function parseState(raw: unknown): SnippetState {
    const list = (raw as SnippetState | null)?.snippets;
    if (!Array.isArray(list)) return EMPTY;
    const ids = new Set<string>();
    const names = new Set<string>();
    const snippets: Snippet[] = [];
    for (const item of list) {
        if (!item || typeof item !== "object" || typeof item.id !== "string" || !item.id || ids.has(item.id)) continue;
        const name = cleanName(item.name);
        const text = cleanText(item.text);
        if (!name || !text.trim() || names.has(key(name))) continue;
        ids.add(item.id);
        names.add(key(name));
        snippets.push({
            id: item.id,
            name,
            text: text.slice(0, MAX_TEXT_LENGTH),
            createdAt: count(item.createdAt),
            uses: count(item.uses),
            lastUsed: count(item.lastUsed),
        });
        if (snippets.length >= MAX_SNIPPETS) break;
    }
    return { snippets };
}

export function getSnippet(state: SnippetState, id: string | null | undefined) {
    return id ? state.snippets.find(s => s.id === id) : undefined;
}

/** Exact, case-insensitive name match */
export function findByName(state: SnippetState, name: unknown) {
    if (typeof name !== "string") return undefined;
    const k = key(name);
    return k ? state.snippets.find(s => key(s.name) === k) : undefined;
}

export function addSnippet(state: SnippetState, input: SnippetInput, now = Date.now(), id = makeId()): ChangeResult {
    if (state.snippets.length >= MAX_SNIPPETS) return { state, error: `You can keep up to ${MAX_SNIPPETS} snippets.` };
    const error = inputError(state, input);
    if (error) return { state, error };
    const snippet: Snippet = { id, name: cleanName(input.name), text: cleanText(input.text), createdAt: now, uses: 0, lastUsed: 0 };
    return { state: { snippets: [...state.snippets, snippet] }, snippet };
}

export function updateSnippet(state: SnippetState, id: string, input: Partial<SnippetInput>): ChangeResult {
    const current = getSnippet(state, id);
    if (!current) return { state, error: "That snippet no longer exists." };
    const next = { name: input.name ?? current.name, text: input.text ?? current.text };
    const error = inputError(state, next, id);
    if (error) return { state, error };
    const name = cleanName(next.name);
    const text = cleanText(next.text);
    if (name === current.name && text === current.text) return { state, snippet: current };
    const snippet = { ...current, name, text };
    return { state: { snippets: state.snippets.map(s => s.id === id ? snippet : s) }, snippet };
}

export function deleteSnippet(state: SnippetState, id: string): SnippetState {
    return getSnippet(state, id) ? { snippets: state.snippets.filter(s => s.id !== id) } : state;
}

export function recordUse(state: SnippetState, id: string, now = Date.now()): SnippetState {
    if (!getSnippet(state, id)) return state;
    return { snippets: state.snippets.map(s => s.id === id ? { ...s, uses: s.uses + 1, lastUsed: now } : s) };
}

/** `base`, or `base 2`, `base 3`... whichever is free, within the name length limit */
export function uniqueName(state: SnippetState, base: string) {
    const clean = cleanName(base) || "Snippet";
    if (!nameError(state, clean)) return clean;
    for (let n = 2; ; n++) {
        const suffix = ` ${n}`;
        const name = clean.slice(0, MAX_NAME_LENGTH - suffix.length).trimEnd() + suffix;
        if (!nameError(state, name)) return name;
    }
}

/** A name for a snippet made from a message: its first few words, made unique */
export function suggestName(state: SnippetState, text: string) {
    const words = cleanText(text)
        .replace(/<a?:(\w+):\d+>/g, "$1") // custom emoji
        .replace(/<[@#][!&]?\d+>/g, "") // mentions
        .replace(/https?:\/\/\S+/g, "")
        .replace(/[*_~`|>]/g, "")
        .split(/\s+/)
        .filter(Boolean);
    let name = "";
    for (const word of words) {
        const next = name ? `${name} ${word}` : word;
        if (next.length > 24) break;
        name = next;
        if (name.split(" ").length >= 4) break;
    }
    return uniqueName(state, name || words[0]?.slice(0, 24) || "Snippet");
}

export const PLACEHOLDERS = [
    { key: "user", description: "The person you're replying to, or the other person in a DM" },
    { key: "me", description: "Your own display name" },
    { key: "channel", description: "The channel's name" },
    { key: "server", description: "The server's name" },
    { key: "date", description: "Today's date" },
    { key: "time", description: "The current time" },
    { key: "clipboard", description: "Whatever text you have copied" },
] as const;

export type PlaceholderKey = typeof PLACEHOLDERS[number]["key"];
export type PlaceholderValues = Partial<Record<PlaceholderKey, string>>;

const KNOWN = new Set<string>(PLACEHOLDERS.map(p => p.key));
/** `{name}`, or an escaped `\{name}` that stays as typed (minus the backslash) */
const PLACEHOLDER = /(\\?)\{([a-z]+)\}/gi;

/** Which known placeholders the text uses, so only those get looked up (the clipboard, say) */
export function usedPlaceholders(text: string): Set<PlaceholderKey> {
    const used = new Set<PlaceholderKey>();
    for (const [, escape, name] of text.matchAll(PLACEHOLDER)) {
        const k = name.toLowerCase();
        if (!escape && KNOWN.has(k)) used.add(k as PlaceholderKey);
    }
    return used;
}

/**
 * Replaces {user}, {date}... (any case) with their values. A known placeholder without a value
 * becomes empty; unknown ones stay as typed; `\{user}` gives a literal `{user}`.
 */
export function expandPlaceholders(text: string, values: PlaceholderValues): string {
    return text.replace(PLACEHOLDER, (whole, escape: string, name: string) => {
        if (escape) return whole.slice(1);
        const k = name.toLowerCase();
        if (!KNOWN.has(k)) return whole;
        return values[k as PlaceholderKey] ?? "";
    });
}

/**
 * Someone else's text made safe to save as a snippet: every `{name}` gets a backslash, so it stays as
 * written when the snippet is used. Otherwise a message holding {clipboard} would become a snippet
 * that sends what you copied. Unknown names are escaped too, in case they become placeholders later.
 * An escape already in the text keeps its backslash: `\{user}` comes out as `\{user}`.
 */
export function escapePlaceholders(text: string): string {
    return text.replace(/\{[a-z]+\}/gi, "\\$&");
}

/** Whether using this snippet reads your clipboard: then it's never sent without you seeing it */
export function readsClipboard(text: string) {
    return usedPlaceholders(text).has("clipboard");
}

/** {date} and {time} for a moment, in the user's locale (or the one given) */
export function dateValues(now: Date, locale?: string): Pick<PlaceholderValues, "date" | "time"> {
    return {
        date: now.toLocaleDateString(locale, { year: "numeric", month: "long", day: "numeric" }),
        time: now.toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" }),
    };
}

const fold = (s: string) => s.toLocaleLowerCase().normalize("NFD").replace(/\p{M}/gu, "");

/** Whether every character of `query` appears in `text`, in order */
function isSubsequence(query: string, text: string) {
    let i = 0;
    for (const ch of text) if (ch === query[i] && ++i === query.length) return true;
    return query.length === 0;
}

/**
 * How well a snippet matches a query, higher is better, 0 for no match. Names win over text:
 * exact name, name prefix, a word in the name starting with it, name substring, every word of the
 * query in the name, name initials/subsequence, then text.
 */
export function scoreSnippet(snippet: Snippet, query: string): number {
    const q = fold(query.replace(/\s+/g, " ").trim());
    if (!q) return 1;
    const name = fold(snippet.name);
    const text = fold(snippet.text);
    if (name === q) return 1000;
    if (name.startsWith(q)) return 800;
    if (name.split(/[\s\-_.]+/).some(w => w.startsWith(q))) return 600;
    if (name.includes(q)) return 400;
    const tokens = q.split(" ");
    if (tokens.length > 1 && tokens.every(t => name.includes(t))) return 300;
    if (!q.includes(" ") && q.length > 1 && isSubsequence(q, name)) return 200;
    if (text.includes(q)) return 150;
    if (tokens.every(t => name.includes(t) || text.includes(t))) return 100;
    return 0;
}

/** Most used and most recent first, then by name */
export function compareByUse(a: Snippet, b: Snippet) {
    return b.lastUsed - a.lastUsed || b.uses - a.uses || a.name.localeCompare(b.name);
}

export function compareByName(a: Snippet, b: Snippet) {
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
}

/** Matching snippets, best first. Without a query: all of them, recently used first. */
export function searchSnippets(state: SnippetState, query: string): Snippet[] {
    return state.snippets
        .map(snippet => ({ snippet, score: scoreSnippet(snippet, query) }))
        .filter(r => r.score > 0)
        .sort((a, b) => b.score - a.score || compareByUse(a.snippet, b.snippet))
        .map(r => r.snippet);
}

export type Resolved = { snippet: Snippet; } | { error: string; };

/**
 * The snippet a /snip argument means: an id (a picked choice), an exact name, or the only good
 * match. Otherwise an error that lists what the user may have meant.
 */
export function resolveSnippet(state: SnippetState, input: unknown, say: Say = english): Resolved {
    if (!state.snippets.length) return { error: say("err.none") };
    const value = typeof input === "string" ? input.trim() : "";
    const list = (items: Snippet[]) => items.slice(0, 10).map(s => `\`${s.name}\``).join(", ") + (items.length > 10 ? say("err.more", { n: items.length - 10 }) : "");
    const listAll = () => list([...state.snippets].sort(compareByName));
    if (!value) return { error: say("err.which", { list: listAll() }) };

    const exact = getSnippet(state, value) ?? findByName(state, value);
    if (exact) return { snippet: exact };

    const matches = state.snippets
        .map(snippet => ({ snippet, score: scoreSnippet(snippet, value) }))
        .filter(r => r.score >= 400)
        .sort((a, b) => b.score - a.score || compareByUse(a.snippet, b.snippet));
    // One clear winner: the only name match, or the only prefix match
    if (matches.length === 1 || (matches.length > 1 && matches[0].score >= 800 && matches[1].score < 800)) return { snippet: matches[0].snippet };

    const close = matches.length ? matches.map(m => m.snippet) : searchSnippets(state, value);
    if (close.length) return { error: say("err.noneCalledClose", { value, list: list(close) }) };
    return { error: say("err.noneCalled", { value, list: listAll() }) };
}

/**
 * Choices for the /snip name option: Discord suggests and filters them as you type. With more
 * snippets than Discord shows, there are none and the option takes any text (matched by name).
 */
export function commandChoices(state: SnippetState): { name: string; value: string; }[] | undefined {
    if (!state.snippets.length || state.snippets.length > MAX_CHOICES) return undefined;
    return [...state.snippets].sort(compareByName).map(s => ({ name: s.name, value: s.id }));
}

/**
 * ChannelTextAreaButtons pushes its buttons into an array, the send button last:
 * `Z&&B.push((0,l.jsx)(X,{onClick:E,disabled:A||P},"submit")),0===B.length)?null:...`
 * Ours is pushed right before that push, so it sits next to the send button. This leaves the
 * `0===B.length` check alone, which Silent Typing patches, so both apply in either order.
 */
export const BUTTON_PATCH: SourcePatch = {
    find: "\"ChannelTextAreaButtons\"",
    replace: {
        match: /(\i)&&(\i)\.push\(\(0,\i\.jsxs?\)\(\i,\{onClick:\i,disabled:[^{}]+\},"submit"\)\)/,
        with: "$self?.injectButton?.($2,arguments[0]),$&",
    },
};
