import { describe, expect, test } from "bun:test";

import { editDistance, normalize, searchItems, searchScore, Searchable } from "../src/shared/storeSearch";

const translate: Searchable = {
    id: "inline-translate", name: "Inline Translate", description: "Translate any message right in the chat, without leaving Discord.",
    tags: ["messages", "utility"], authors: ["Evi"], alsoNamed: ["Übersetzen im Chat"], alsoDescribed: ["Übersetzt jede Nachricht direkt im Chat."],
};
const logger: Searchable = { id: "message-logger", name: "Message Logger", description: "Keeps deleted and edited messages.", tags: ["messages"], authors: ["Evi"] };
const quests: Searchable = { id: "quest-blocker", name: "Quest Blocker", description: "Removes the quest popup above your profile.", tags: ["utility"], authors: ["Evi"] };
const all = [logger, quests, translate];
const ids = (query: string) => searchItems(all, query, i => i).map(i => i.id);

describe("store search", () => {
    test("an empty query keeps everything in the listing's order", () => {
        expect(ids("  ")).toEqual(["message-logger", "quest-blocker", "inline-translate"]);
    });

    test("every word has to match, in any order", () => {
        expect(ids("messages translate")).toEqual(["inline-translate"]);
        expect(ids("translate quest")).toEqual([]);
    });

    test("results show up while the word is still being typed", () => {
        expect(ids("tra")).toEqual(["inline-translate"]);
        expect(ids("q")).toEqual(["quest-blocker"]);
    });

    test("a name match beats a description match", () => {
        // "message" starts Message Logger's name, and is only in Inline Translate's description
        expect(ids("message")).toEqual(["message-logger", "inline-translate"]);
    });

    test("typos are forgiven, more for longer words", () => {
        expect(ids("tranlsate")).toEqual(["inline-translate"]);
        expect(ids("qeust")).toEqual(["quest-blocker"]);
        expect(ids("blokcer")).toEqual(["quest-blocker"]);
        // Short words have to be right: "log" isn't "lag"
        expect(ids("lag")).toEqual([]);
    });

    test("tags, authors and ids match", () => {
        expect(ids("utility")).toEqual(["quest-blocker", "inline-translate"]);
        expect(ids("quest-blocker")).toEqual(["quest-blocker"]);
    });

    test("translations and accents: German finds it, with or without the umlaut", () => {
        expect(ids("übersetzen")).toEqual(["inline-translate"]);
        expect(ids("ubersetzen")).toEqual(["inline-translate"]);
        expect(ids("nachricht")).toEqual(["inline-translate"]);
    });

    test("the typed phrase in the name ranks above the same words apart", () => {
        const a: Searchable = { id: "a", name: "Voice Tools", description: "Better voice chat" };
        const b: Searchable = { id: "b", name: "Chat Voice", description: "Voice things" };
        expect(searchScore(b, "chat voice")).toBeGreaterThan(searchScore(a, "chat voice"));
    });

    test("searching the same items again (their fields are kept) gives the same results", () => {
        for (const query of ["message", "tranlsate", "übersetzen", "messages translate"]) {
            const first = searchItems(all, query, i => i);
            expect(searchItems(all, query, i => i)).toEqual(first);
            expect(all.map(i => searchScore(i, query))).toEqual(all.map(i => searchScore({ ...i }, query)));
        }
    });

    test("helpers", () => {
        expect(normalize("Café ÜBER")).toBe("cafe uber");
        expect(editDistance("quest", "qeust", 1)).toBe(1);
        expect(editDistance("quest", "blocker", 2)).toBe(3);
    });
});
