import { describe, expect, test } from "bun:test";

import {
    addSnippet, BUTTON_PATCH, cleanName, cleanText, commandChoices, dateValues, deleteSnippet, EMPTY, escapePlaceholders, expandPlaceholders,
    findByName, MAX_CHOICES, MAX_NAME_LENGTH, MAX_SNIPPETS, MAX_TEXT_LENGTH, nameError, parseState, readsClipboard, recordUse, resolveSnippet,
    scoreSnippet, searchSnippets, Snippet, SnippetState, suggestName, textError, uniqueName, updateSnippet, usedPlaceholders,
} from "../plugins/snippets/snippets";
import type { Replacement } from "../src/renderer/patching/source";
import { canonicalizeMatch, matchesFind } from "../src/renderer/patching/source";

let n = 0;
function build(...items: [name: string, text: string, extra?: Partial<Snippet>][]): SnippetState {
    let state = EMPTY;
    for (const [name, text, extra] of items) {
        const result = addSnippet(state, { name, text }, 1000, `id${n++}`);
        if (result.error) throw new Error(result.error);
        state = result.state;
        if (extra) state = { snippets: state.snippets.map(s => s.id === result.snippet!.id ? { ...s, ...extra } : s) };
    }
    return state;
}

describe("names and text", () => {
    test("cleanName collapses whitespace, trims and caps length", () => {
        expect(cleanName("  hello \n  world ")).toBe("hello world");
        expect(cleanName("x".repeat(50))).toHaveLength(MAX_NAME_LENGTH);
        expect(cleanName(42)).toBe("");
    });

    test("cleanText normalizes line endings and trims the end, keeping inner lines", () => {
        expect(cleanText("\n\n  line one\r\nline two\r\n\n  ")).toBe("  line one\nline two");
        expect(cleanText(null)).toBe("");
    });

    test("nameError: empty, too long, duplicate (case-insensitive), renaming itself is fine", () => {
        const state = build(["Welcome", "hi"]);
        expect(nameError(state, "   ")).toBeTruthy();
        expect(nameError(state, "x".repeat(MAX_NAME_LENGTH + 1))).toContain(String(MAX_NAME_LENGTH));
        expect(nameError(state, " welcome ")).toContain("Welcome");
        expect(nameError(state, "WELCOME", state.snippets[0].id)).toBeNull();
        expect(nameError(state, "bye")).toBeNull();
    });

    test("textError: blank and too long", () => {
        expect(textError(" \n ")).toBeTruthy();
        expect(textError("x".repeat(MAX_TEXT_LENGTH + 1))).toContain(String(MAX_TEXT_LENGTH));
        expect(textError("ok")).toBeNull();
    });
});

describe("changes", () => {
    test("add, update, delete never mutate", () => {
        const a = addSnippet(EMPTY, { name: " Hi ", text: "Hello there\n" }, 5, "a");
        expect(a.error).toBeUndefined();
        expect(a.snippet).toEqual({ id: "a", name: "Hi", text: "Hello there", createdAt: 5, uses: 0, lastUsed: 0 });
        expect(EMPTY.snippets).toHaveLength(0);

        const dup = addSnippet(a.state, { name: "hi", text: "x" });
        expect(dup.error).toBeTruthy();
        expect(dup.state).toBe(a.state);

        const u = updateSnippet(a.state, "a", { text: "Changed" });
        expect(u.snippet?.text).toBe("Changed");
        expect(a.state.snippets[0].text).toBe("Hello there");
        expect(updateSnippet(u.state, "a", { text: "Changed" }).state).toBe(u.state);
        expect(updateSnippet(u.state, "missing", { text: "x" }).error).toBeTruthy();
        expect(updateSnippet(u.state, "a", { text: "" }).error).toBeTruthy();

        expect(deleteSnippet(u.state, "a").snippets).toHaveLength(0);
        expect(deleteSnippet(u.state, "nope")).toBe(u.state);
    });

    test("rename to another snippet's name is refused", () => {
        const state = build(["one", "1"], ["two", "2"]);
        expect(updateSnippet(state, state.snippets[1].id, { name: "ONE" }).error).toContain("one");
    });

    test("recordUse counts and timestamps", () => {
        const state = build(["one", "1"]);
        const used = recordUse(recordUse(state, state.snippets[0].id, 10), state.snippets[0].id, 20);
        expect(used.snippets[0]).toMatchObject({ uses: 2, lastUsed: 20 });
        expect(recordUse(state, "missing")).toBe(state);
    });

    test("snippet limit", () => {
        const full: SnippetState = { snippets: Array.from({ length: MAX_SNIPPETS }, (_, i) => ({ id: `s${i}`, name: `s${i}`, text: "t", createdAt: 0, uses: 0, lastUsed: 0 })) };
        expect(addSnippet(full, { name: "more", text: "t" }).error).toContain(String(MAX_SNIPPETS));
    });

    test("uniqueName and suggestName", () => {
        const state = build(["Thanks", "x"], ["Thanks 2", "y"]);
        expect(uniqueName(state, "Thanks")).toBe("Thanks 3");
        expect(uniqueName(state, "new")).toBe("new");
        expect(uniqueName(build(["x".repeat(MAX_NAME_LENGTH), "t"]), "x".repeat(MAX_NAME_LENGTH))).toBe(`${"x".repeat(MAX_NAME_LENGTH - 2)} 2`);
        expect(suggestName(EMPTY, "Hey <@123> check https://x.com this **cool** thing out today")).toBe("Hey check this cool");
        expect(suggestName(state, "Thanks!")).toBe("Thanks!");
        expect(suggestName(EMPTY, "   ")).toBe("Snippet");
    });
});

describe("parseState", () => {
    test("garbage gives an empty state", () => {
        expect(parseState(undefined)).toBe(EMPTY);
        expect(parseState({ snippets: "no" })).toBe(EMPTY);
    });

    test("drops broken entries, duplicate ids and names; fixes counters", () => {
        const state = parseState({
            snippets: [
                { id: "a", name: "One", text: "1", createdAt: 3, uses: 2, lastUsed: 9 },
                { id: "a", name: "Dup id", text: "x" },
                { id: "b", name: "one", text: "dup name" },
                { id: "c", name: "", text: "no name" },
                { id: "d", name: "No text", text: "  " },
                null,
                { id: "e", name: "Two", text: "2\r\n", uses: -4, lastUsed: "x" },
            ],
        });
        expect(state.snippets.map(s => s.id)).toEqual(["a", "e"]);
        expect(state.snippets[1]).toEqual({ id: "e", name: "Two", text: "2", createdAt: 0, uses: 0, lastUsed: 0 });
    });
});

describe("placeholders", () => {
    test("expands known ones in any case, leaves unknown ones, empties missing values", () => {
        const text = "Hi {user}, it's {DATE} at {time}. {unknown} {me}{clipboard}";
        expect(expandPlaceholders(text, { user: "Ana", date: "Jan 5", time: "2:03 PM", me: "Bo" }))
            .toBe("Hi Ana, it's Jan 5 at 2:03 PM. {unknown} Bo");
    });

    test("a backslash keeps a placeholder as written", () => {
        expect(expandPlaceholders("Type \\{user} to get {user}", { user: "Ana" })).toBe("Type {user} to get Ana");
    });

    test("values are inserted literally, never re-expanded or treated as replace patterns", () => {
        expect(expandPlaceholders("{clipboard}", { clipboard: "$& {user} $1" })).toBe("$& {user} $1");
    });

    test("usedPlaceholders finds only known, unescaped ones", () => {
        expect([...usedPlaceholders("{user} {User} \\{clipboard} {nope} {date}")].sort()).toEqual(["date", "user"]);
        expect(usedPlaceholders("plain").size).toBe(0);
    });

    test("a message saved as a snippet comes out word for word: its placeholders never expand", () => {
        const values = { user: "Ana", me: "Bo", clipboard: "hunter2", date: "Jan 5" };
        for (const message of [
            "Send me {clipboard} pls",
            "{CLIPBOARD}{Clipboard} {user} {me} {date}",
            "Type \\{user} to keep it, {nope} stays",
            "\\\\{clipboard} {} { clipboard } {clip board}",
            "line one\n{clipboard}\n",
        ]) {
            const saved = escapePlaceholders(message);
            expect(usedPlaceholders(saved).size).toBe(0);
            expect(readsClipboard(saved)).toBe(false);
            expect(expandPlaceholders(saved, values)).toBe(message);
        }
        // The escaped placeholder shows as its literal braces
        expect(expandPlaceholders(escapePlaceholders("Paste {clipboard} here"), values)).toBe("Paste {clipboard} here");
        expect(escapePlaceholders("no braces")).toBe("no braces");
    });

    test("readsClipboard finds an unescaped {clipboard} in any case", () => {
        expect(readsClipboard("{clipboard}")).toBe(true);
        expect(readsClipboard("Code: {ClipBoard}")).toBe(true);
        expect(readsClipboard("\\{clipboard}")).toBe(false);
        expect(readsClipboard("Hi {user}")).toBe(false);
    });

    test("multiline text keeps its lines", () => {
        expect(expandPlaceholders("Hi {user},\n\nThanks!", { user: "Ana" })).toBe("Hi Ana,\n\nThanks!");
    });

    test("dateValues formats in the given locale", () => {
        const values = dateValues(new Date(2026, 0, 5, 14, 3), "en-US");
        expect(values.date).toBe("January 5, 2026");
        expect(values.time).toMatch(/^2:03\sPM$/);
    });
});

describe("search", () => {
    const state = build(
        ["welcome", "Welcome to the server! Read #rules."],
        ["Thanks a lot", "Thank you so much"],
        ["bug report", "Please send your logs"],
        ["well done", "Great work"],
        ["Café hours", "We're open 9-5"],
    );

    test("ranking: exact > prefix > word prefix > substring > subsequence > text", () => {
        const s = (name: string, text = "zzz") => ({ id: name, name, text, createdAt: 0, uses: 0, lastUsed: 0 });
        const scores = [
            scoreSnippet(s("rep"), "rep"),
            scoreSnippet(s("report"), "rep"),
            scoreSnippet(s("bug report"), "rep"),
            scoreSnippet(s("xrepx"), "rep"),
            scoreSnippet(s("r-e-p"), "rep"),
            scoreSnippet(s("nothing", "please rep"), "rep"),
        ];
        expect([...scores].sort((a, b) => b - a)).toEqual(scores);
        expect(new Set(scores).size).toBe(scores.length);
        expect(scoreSnippet(s("nothing"), "rep")).toBe(0);
    });

    test("finds by name, word, text and ignores accents and case", () => {
        expect(searchSnippets(state, "we")[0].name).toBe("welcome");
        expect(searchSnippets(state, "WEL").map(s => s.name)).toEqual(["welcome", "well done"]);
        expect(searchSnippets(state, "report")[0].name).toBe("bug report");
        expect(searchSnippets(state, "logs")[0].name).toBe("bug report");
        expect(searchSnippets(state, "cafe")[0].name).toBe("Café hours");
        expect(searchSnippets(state, "thanks lot")[0].name).toBe("Thanks a lot");
        expect(searchSnippets(state, "qqq")).toEqual([]);
    });

    test("no query: everything, recently used first then by name", () => {
        const used = recordUse(state, state.snippets[2].id, 50);
        const names = searchSnippets(used, "  ").map(s => s.name);
        expect(names[0]).toBe("bug report");
        expect(names.slice(1)).toEqual(["Café hours", "Thanks a lot", "welcome", "well done"]);
    });

    test("ties go to the recently used one", () => {
        const withUse = recordUse(state, state.snippets[3].id, 99); // well done
        expect(searchSnippets(withUse, "wel").map(s => s.name)).toEqual(["well done", "welcome"]);
    });
});

describe("resolveSnippet (/snip)", () => {
    const state = build(["welcome", "hi"], ["welcome back", "hey again"], ["bug report", "logs"], ["thanks", "ty"]);

    test("by id (a picked choice) and exact name, any case", () => {
        expect("snippet" in resolveSnippet(state, state.snippets[2].id) && resolveSnippet(state, state.snippets[2].id)).toMatchObject({ snippet: { name: "bug report" } });
        expect(resolveSnippet(state, " WELCOME ")).toMatchObject({ snippet: { name: "welcome" } });
    });

    test("a unique match is accepted, an ambiguous one lists the options", () => {
        expect(resolveSnippet(state, "bug")).toMatchObject({ snippet: { name: "bug report" } });
        expect(resolveSnippet(state, "than")).toMatchObject({ snippet: { name: "thanks" } });
        const result = resolveSnippet(state, "welc");
        expect("error" in result && result.error).toContain("`welcome`");
        expect("error" in result && result.error).toContain("`welcome back`");
    });

    test("no match lists every name; no snippets explains how to add one", () => {
        const result = resolveSnippet(state, "zzz");
        expect("error" in result && result.error).toContain("`bug report`, `thanks`, `welcome`, `welcome back`");
        expect("error" in resolveSnippet(state, "") && (resolveSnippet(state, "") as { error: string; }).error).toContain("Which snippet");
        expect((resolveSnippet(EMPTY, "x") as { error: string; }).error).toContain("Save as Snippet");
    });

    test("findByName is exact", () => {
        expect(findByName(state, "Thanks")?.name).toBe("thanks");
        expect(findByName(state, "thank")).toBeUndefined();
    });
});

describe("commandChoices", () => {
    test("sorted names with ids as values, none when empty or over Discord's limit", () => {
        const state = build(["b", "1"], ["A", "2"]);
        expect(commandChoices(state)).toEqual([{ name: "A", value: state.snippets[1].id }, { name: "b", value: state.snippets[0].id }]);
        expect(commandChoices(EMPTY)).toBeUndefined();
        const many = build(...Array.from({ length: MAX_CHOICES + 1 }, (_, i) => [`s${i}`, "t"] as [string, string]));
        expect(commandChoices(many)).toBeUndefined();
    });
});

describe("chat bar button patch", () => {
    // Verbatim from Discord's web build (test-results/chunks), trimmed to the end of ChannelTextAreaButtons
    const SOURCE = 'let C=(0,M.n)("ChannelTextAreaButtons");return(!s.Fr&&(x.gifts?.button!=null&&null==D&&!V&&(null==K||k.Ay.isPremiumEligible(K))&&B.push((0,l.jsx)(q.A,{disabled:A,channel:C},"gift"))),'
        + 'z&&j&&B.push((0,l.jsx)(R,{channelId:C.id,type:x},"appLauncher")),Z&&B.push((0,l.jsx)(X,{onClick:E,disabled:A||P},"submit")),0===B.length)?null:(0,l.jsx)("div",{className:G.Uo,children:B})';
    const OTHER_BUILD = 'Q("ChannelTextAreaButtons");return(z&&j.push((0,i.jsx)(R,{channelId:C.id,type:x},"appLauncher")),$&&j.push((0,i.jsx)(Q,{onClick:m,disabled:p||G},"submit")),0===j.length)?null:(0,i.jsx)("div",{className:W.Uo,children:j})';
    const r = BUTTON_PATCH.replace as Replacement;
    const apply = (code: string) => code.replace(canonicalizeMatch(r.match) as RegExp, (r.with as string).replaceAll("$self", "S"));

    test("find matches the module", () => {
        expect(matchesFind(SOURCE, BUTTON_PATCH.find)).toBe(true);
    });

    test("pushes our button right before the send button, in both builds", () => {
        expect(apply(SOURCE)).toContain(',S?.injectButton?.(B,arguments[0]),Z&&B.push((0,l.jsx)(X,{onClick:E,disabled:A||P},"submit")),0===B.length)');
        // `$` as a minified name must survive the replacement
        expect(apply(OTHER_BUILD)).toContain(',S?.injectButton?.(j,arguments[0]),$&&j.push((0,i.jsx)(Q,{onClick:m,disabled:p||G},"submit"))');
    });

    test("matches exactly once and leaves Silent Typing's anchor untouched", () => {
        const re = new RegExp((canonicalizeMatch(r.match) as RegExp).source, "g");
        expect(SOURCE.match(re)).toHaveLength(1);
        const silentTyping = canonicalizeMatch(/(?<=[,(])0===(\i)\.length(?=\)\?null:\(0,\i\.jsxs?\)\("div",\{className:\i\.\i,children:\1\}\))/) as RegExp;
        expect(silentTyping.test(apply(SOURCE))).toBe(true);
        // and the other way round: ours still matches after Silent Typing's patch
        const afterSilent = SOURCE.replace(silentTyping, "(S?.injectButton?.($1,arguments[0]),0===$1.length)");
        expect(apply(afterSilent)).toContain("S?.injectButton?.(B,arguments[0]),Z&&B.push");
    });
});
