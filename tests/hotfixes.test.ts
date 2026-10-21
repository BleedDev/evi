import { describe, expect, test } from "bun:test";

import { healthWarns, parseHealth, validateHealthReport } from "../src/shared/health";
import { parsePulled, pullFor } from "../src/shared/pulls";
import {
    applyPatchFixes, Hotfix, hotfixDraft, HotfixInput, hotfixFor, hotfixRangesOverlap, hotfixTag, inHotfixRange, isHotfixTag,
    lookupFixFor, parseHotfixes, validateHotfixInput,
} from "../src/shared/hotfixes";
import { applySourcePatches, getPatchRecords, registerPatches, SourcePatch, unregisterPatches } from "../src/renderer/patching/source";
import { AppliedHotfixes, fixedLookup } from "../src/renderer/plugins/hotfixes";
import { describeFilter, filters } from "../src/renderer/webpack/find";
import { healthKey } from "../src/renderer/sentReports";

const input = (extra: Record<string, unknown> = {}) => ({
    plugin: "silent-typing",
    from: "1.0.0",
    to: "1.2.0",
    note: "The typing button shows in the chat bar again.",
    patches: [{ index: 0, was: "\"ChannelTextAreaButtons\"", find: "\"ChatInputButtons\"" }],
    ...extra,
});

const published = (extra: Partial<Hotfix> = {}): Hotfix => ({ id: 7, revision: 2, at: 1000, ...(validateHotfixInput(input()) as { hotfix: HotfixInput; }).hotfix, ...extra });

describe("hotfixes: what an admin can publish", () => {
    test("a patch fix and a lookup fix pass, cleaned", () => {
        const checked = validateHotfixInput(input({
            note: "  Fixed.  ",
            patches: [{ index: 2, was: { regex: "a\\i", flags: "" }, replace: [{ match: { regex: "(?<=x)\\i", flags: "g" }, with: "$self?.f?.($1)" }], extra: 1 }],
            lookups: [{ target: "component \"CHAT_INPUT\"", kind: "component", args: ["CHAT_INPUT_V2", { regex: "chat\\d" }], method: "render" }],
        }));
        expect(checked).toEqual({
            hotfix: {
                plugin: "silent-typing", from: "1.0.0", to: "1.2.0", note: "Fixed.",
                patches: [{ index: 2, was: { regex: "a\\i" }, replace: [{ match: { regex: "(?<=x)\\i", flags: "g" }, with: "$self?.f?.($1)" }] }],
                lookups: [{ target: "component \"CHAT_INPUT\"", kind: "component", args: ["CHAT_INPUT_V2", { regex: "chat\\d" }], method: "render" }],
            },
        });
    });

    test("\\i in a patch compiles even with the u flag, as the patcher expands it first", () => {
        expect("hotfix" in validateHotfixInput(input({ patches: [{ index: 0, replace: [{ match: { regex: "\\i\\.x", flags: "u" }, with: "" }] }] }))).toBe(true);
    });

    const bad: [string, Record<string, unknown>][] = [
        ["plugin id", { plugin: "Not An Id" }],
        ["version", { from: "one" }],
        ["backwards range", { from: "2.0.0", to: "1.0.0" }],
        ["empty note", { note: " " }],
        ["long note", { note: "x".repeat(301) }],
        ["nothing to fix", { patches: [], lookups: [] }],
        ["regex that doesn't compile", { patches: [{ index: 0, find: { regex: "(" } }] }],
        ["unknown flag", { patches: [{ index: 0, find: { regex: "a", flags: "x" } }] }],
        ["repeated flag", { patches: [{ index: 0, find: { regex: "a", flags: "gg" } }] }],
        ["huge pattern", { patches: [{ index: 0, find: "x".repeat(2001) }] }],
        ["huge replacement", { patches: [{ index: 0, replace: [{ match: "a", with: "x".repeat(4001) }] }] }],
        ["too many replacements", { patches: [{ index: 0, replace: Array.from({ length: 9 }, () => ({ match: "a", with: "b" })) }] }],
        ["too many patches", { patches: Array.from({ length: 17 }, (_, index) => ({ index, find: "a" })) }],
        ["a patch that changes nothing", { patches: [{ index: 0, was: "a" }] }],
        ["negative index", { patches: [{ index: -1, find: "a" }] }],
        ["the same patch twice", { patches: [{ index: 0, find: "a" }, { index: 0, find: "b" }] }],
        ["function replacement", { patches: [{ index: 0, replace: [{ match: "a", with: 1 }] }] }],
        ["unknown lookup kind", { patches: [], lookups: [{ target: "t", kind: "magic", args: ["a"] }] }],
        ["regex prop name", { patches: [], lookups: [{ target: "t", kind: "props", args: [{ regex: "a" }] }] }],
        ["two store names", { patches: [], lookups: [{ target: "t", kind: "store", args: ["A", "B"] }] }],
        ["bad method", { patches: [], lookups: [{ target: "t", kind: "props", args: ["a"], method: "a b" }] }],
    ];
    for (const [what, extra] of bad) {
        test(`refuses: ${what}`, () => expect(validateHotfixInput(input(extra))).toHaveProperty("error"));
    }
});

describe("hotfixes: which one a plugin gets", () => {
    test("ranges include both ends, and an open end is open", () => {
        expect(inHotfixRange({ from: "1.0.0", to: "1.2.0" }, "1.0.0")).toBe(true);
        expect(inHotfixRange({ from: "1.0.0", to: "1.2.0" }, "1.2.0")).toBe(true);
        expect(inHotfixRange({ from: "1.0.0", to: "1.2.0" }, "1.10.0")).toBe(false);
        expect(inHotfixRange({ from: "1.0.0", to: "1.2.0" }, "1.0.0-beta")).toBe(false);
        expect(inHotfixRange({ to: "1.2.0" }, "0.1.0")).toBe(true);
        expect(inHotfixRange({}, undefined)).toBe(true);
        expect(inHotfixRange({ from: "1.0.0" }, undefined)).toBe(false);
    });

    test("overlapping ranges", () => {
        expect(hotfixRangesOverlap({ from: "1.0.0", to: "1.2.0" }, { from: "1.2.0" })).toBe(true);
        expect(hotfixRangesOverlap({ from: "1.0.0", to: "1.2.0" }, { from: "1.2.1" })).toBe(false);
        expect(hotfixRangesOverlap({ to: "1.0.0" }, { from: "0.9.0", to: "0.9.5" })).toBe(true);
        expect(hotfixRangesOverlap({}, { from: "3.0.0" })).toBe(true);
    });

    test("hotfixFor picks by plugin and version; tags carry the revision", () => {
        const list = [published(), published({ id: 8, plugin: "fast-lists", from: undefined, to: undefined })];
        expect(hotfixFor(list, "silent-typing", "1.1.0")?.id).toBe(7);
        expect(hotfixFor(list, "silent-typing", "2.0.0")).toBeUndefined();
        expect(hotfixFor(list, "fast-lists", "9.9.9")?.id).toBe(8);
        expect(hotfixTag(list[0])).toBe("7.2");
        expect(isHotfixTag("7.2")).toBe(true);
        for (const bad of ["7", "7.2.1", "a.b", 7.2, ""]) expect(isHotfixTag(bad)).toBe(false);
    });

    test("parseHotfixes keeps well-formed ones and drops the rest", () => {
        const good = published();
        const parsed = parseHotfixes({ hotfixes: [good, { ...good, id: 0 }, { ...good, revision: "2" }, { ...good, id: 9, note: "" }, null, "x"] });
        expect(parsed).toEqual([good]);
        expect(parseHotfixes(null)).toEqual([]);
        expect(parseHotfixes({ hotfixes: {} })).toEqual([]);
    });
});

describe("hotfixes: applying one", () => {
    const patches: SourcePatch[] = [
        { find: "\"ChannelTextAreaButtons\"", replace: { match: /(\i)\.length/, with: "$1.size" } },
        { find: /other/, replace: { match: "a", with: "b" } },
    ];

    test("a fixed patch gets its new find and keeps its replacements; the rest stay as they are", () => {
        const fixed = applyPatchFixes(patches, published())!;
        expect(fixed[0].find).toBe("\"ChatInputButtons\"");
        expect(fixed[0].replace).toBe(patches[0].replace);
        expect(fixed[1]).toBe(patches[1]);
        // The plugin's own definition isn't touched
        expect(patches[0].find).toBe("\"ChannelTextAreaButtons\"");
    });

    test("a version whose patch there finds something else is left alone", () => {
        const moved = [patches[1], patches[0]];
        expect(applyPatchFixes(moved, published())).toEqual(moved);
        expect(applyPatchFixes(patches, undefined)).toBe(patches);
    });

    test("new replacements replace every old one, and RegExps come back as RegExps", () => {
        const fix = published({ patches: [{ index: 1, replace: [{ match: { regex: "o(t)", flags: "g" }, with: "$1" }] }] });
        const [, second] = applyPatchFixes(patches, fix)!;
        expect(second.find).toEqual(/other/);
        expect(second.replace).toEqual([{ match: /o(t)/g, with: "$1" }]);
    });

    test("a patch that broke on a Discord update applies with Evi's fix", () => {
        // Discord renamed the string the plugin found its module by
        const source = 'function(e,t,n){let r="ChatInputButtons";t.Z=function(a){return 0===a.length?null:a}}';
        const plugin = "hotfix-test";
        registerPatches(plugin, patches.slice(0, 1));
        applySourcePatches("1", (() => { }) as any, () => source);
        expect(getPatchRecords(plugin)[0].state).toBe("pending");
        unregisterPatches(plugin);

        registerPatches(plugin, applyPatchFixes(patches.slice(0, 1), published())!);
        const { patchedBy, factory } = applySourcePatches("1", (() => { }) as any, () => source);
        expect(patchedBy).toEqual([plugin]);
        expect(getPatchRecords(plugin)[0].state).toBe("applied");
        expect(String(factory)).toContain("0===a.size");
        unregisterPatches(plugin);
    });

    test("a lookup Evi fixed looks for the new target, method included; others are untouched", () => {
        const old = filters.byProps("sendMessage", "editMessage");
        const target = `${describeFilter(old)}, method sendMessage`;
        const fix = published({ patches: [], lookups: [{ target, kind: "props", args: ["sendMessageV2", "editMessage"], method: "sendMessageV2" }] });
        expect(lookupFixFor(fix, target)).toBe(fix.lookups[0]);

        AppliedHotfixes.set("silent-typing", fix);
        const swapped = fixedLookup("silent-typing", old, "sendMessage");
        expect(swapped.method).toBe("sendMessageV2");
        expect(swapped.filter({ sendMessageV2() { }, editMessage() { } })).toBe(true);
        expect(swapped.filter({ sendMessage() { }, editMessage() { } })).toBe(false);

        // Another plugin, another lookup, or no method: as asked
        expect(fixedLookup("fast-lists", old, "sendMessage").filter).toBe(old);
        expect(fixedLookup("silent-typing", old).filter).toBe(old);
        const code = filters.componentByCode("CHAT_INPUT");
        expect(fixedLookup("silent-typing", code).filter).toBe(code);

        AppliedHotfixes.set("silent-typing", published({ patches: [], lookups: [{ target: describeFilter(code), kind: "component", args: [{ regex: "CHAT_INPUT_V\\d" }] }] }));
        const component = fixedLookup("silent-typing", code).filter;
        expect(component.$code).toEqual([/CHAT_INPUT_V\d/]);
        expect(component(function Chat() { return "CHAT_INPUT_V2"; })).toBe(true);
        AppliedHotfixes.set("silent-typing", undefined);
        expect(fixedLookup("silent-typing", code).filter).toBe(code);
    });
});

describe("hotfixes: health reports and the Patch Helper", () => {
    test("reports may carry the hotfix revision they ran with", () => {
        const report = { plugin: "silent-typing", version: "1.1.0", discordBuild: "412345", kind: "patches" };
        expect(validateHealthReport({ ...report, hotfix: "7.2" })).toEqual({ report: { ...report, hotfix: "7.2" } as any });
        expect(validateHealthReport(report)).toEqual({ report: report as any });
        expect(validateHealthReport({ ...report, hotfix: "latest" })).toHaveProperty("error");
    });

    test("a plugin named like one of Object's own properties isn't pulled or broken", () => {
        const pulled = parsePulled({ pulled: { a: { versions: "all", reason: "Bad", at: 1 } } });
        expect(pullFor(pulled, "constructor", "1.0.0")).toBeUndefined();
        expect(pullFor(pulled, "a", "1.0.0")).toMatchObject({ reason: "Bad" });
        const health = parseHealth({ plugins: { a: { state: "broken", since: 1 } } });
        expect(healthWarns((health as any).constructor, "1.0.0")).toBe(false);
        expect(healthWarns(health.a, "1.0.0")).toBe(true);
    });

    test("a new revision is a new report, and plain reports keep their old key", () => {
        const report = { plugin: "p", version: "1.0.0", discordBuild: "1" };
        expect(healthKey(report)).toBe("p@1.0.0#1");
        expect(healthKey({ ...report, hotfix: "7.2" })).toBe("p@1.0.0#1~7.2");
        expect(healthKey({ ...report, hotfix: "7.3" })).not.toBe(healthKey({ ...report, hotfix: "7.2" }));
    });

    test("the Patch Helper's hotfix is valid once someone writes the note", () => {
        const draft = hotfixDraft({ plugin: "silent-typing", version: "1.1.0", index: 0, was: "\"ChannelTextAreaButtons\"", find: "\"ChatInputButtons\"", match: /(\i)\.length/, replace: "$1.size" });
        expect(draft).toEqual({
            plugin: "silent-typing", from: "1.1.0", to: "1.1.0", note: "", lookups: [],
            patches: [{ index: 0, was: "\"ChannelTextAreaButtons\"", find: "\"ChatInputButtons\"", replace: [{ match: { regex: "(\\i)\\.length" }, with: "$1.size" }] }],
        });
        expect(validateHotfixInput(draft)).toHaveProperty("error");
        expect(validateHotfixInput(JSON.parse(JSON.stringify({ ...draft, note: "Fixed." })))).toHaveProperty("hotfix");
        // An unchanged find isn't repeated
        expect(hotfixDraft({ plugin: "p", index: 1, was: /a/, find: /a/, match: "x", replace: "y" }).patches[0]).toEqual({ index: 1, was: { regex: "a" }, replace: [{ match: "x", with: "y" }] });
    });
});
