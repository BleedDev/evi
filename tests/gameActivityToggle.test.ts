import { describe, expect, test } from "bun:test";

import type { Replacement } from "../src/renderer/patching/source";
import { canonicalizeMatch, matchesFind } from "../src/renderer/patching/source";
import { PATCHES, readShowCurrentGame } from "../plugins/game-activity-toggle/toggle";

// Verbatim from Discord's web build (test-results/chunks), trimmed to the patched spots
const SOURCES = {
    setting: 'f("textAndImages","dmSpamFilter",e=>e?.value??N.uH.NON_FRIENDS,e=>l.ZQ.create({value:e}));let eL=f("textAndImages","dmSpamFilterV2",e=>e??s.he.DEFAULT_UNSET,e=>e),ey=f("status","showCurrentGame",e=>e?.value??!0,e=>l._t.create({value:e}));f("privacy","recentGamesEnabled",e=>e?.value??!0,e=>l._t.create({value:e}));let eD=f("privacy","profileVisibility",e=>null==e||e===s.KP.UNSET?s.KP.FRIENDS_AND_ALL_GUILDS:e,e=>e);',
};

/** Discord's build of 2026-10-28 (web.js): the setting is made by (0,_.c$)(...), not a plain call */
const SETTING_1028 = 'let eg=(0,_.c$)("textAndImages","dmSpamFilterV2",e=>e??s.he.DEFAULT_UNSET,e=>e),eS=(0,_.c$)("status","showCurrentGame",e=>e?.value??!0,e=>l._t.create({value:e}));(0,_.c$)("privacy","recentGamesEnabled",e=>e?.value??!0,e=>l._t.create({value:e}));let eN=(0,_.c$)("privacy","profileVisibility",e=>null==e||e===s.KP.UNSET?s.KP.FRIENDS_AND_ALL_GUILDS:e,e=>e);';

function apply(key: keyof typeof PATCHES, code: string = SOURCES[key], self = "S") {
    const patch = PATCHES[key];
    expect(matchesFind(code, patch.find)).toBe(true);
    let next = code;
    for (const r of ([] as Replacement[]).concat(patch.replace)) {
        const re = canonicalizeMatch(r.match) as RegExp;
        expect(code.match(new RegExp(re.source, "g"))?.length).toBe(1);
        const before = next;
        next = next.replace(re, (r.with as string).replaceAll("$self", self));
        expect(next).not.toBe(before);
    }
    return next;
}

describe("readShowCurrentGame", () => {
    test("reads the BoolValue", () => {
        expect(readShowCurrentGame({ status: { showCurrentGame: { value: false } } })).toBe(false);
        expect(readShowCurrentGame({ status: { showCurrentGame: { value: true } } })).toBe(true);
    });
    test("missing means shown, like Discord's e?.value??!0", () => {
        expect(readShowCurrentGame(undefined)).toBe(true);
        expect(readShowCurrentGame({})).toBe(true);
        expect(readShowCurrentGame({ status: {} })).toBe(true);
        expect(readShowCurrentGame({ status: { showCurrentGame: {} } })).toBe(true);
    });
});

describe("patches", () => {
    test("setting: hands the showCurrentGame setting object to the plugin", () => {
        const out = apply("setting");
        expect(out).toContain('ey=f("status","showCurrentGame",e=>e?.value??!0,e=>l._t.create({value:e}));S?.captureSetting?.(ey);f("privacy"');
        let captured: any;
        const f = (group: string, name: string) => ({ group, name });
        new Function("f", "l", "N", "s", "S", out)(f, {}, { uH: {} }, { he: {}, KP: {} }, { captureSetting: (v: any) => (captured = v) });
        expect(captured).toEqual({ group: "status", name: "showCurrentGame" });
    });

    test("setting: also when Discord calls the setting maker as (0,_.c$)(...)", () => {
        const out = apply("setting", SETTING_1028);
        expect(out).toContain('e=>l._t.create({value:e}));S?.captureSetting?.(eS);(0,_.c$)("privacy"');
        let captured: any;
        const _ = { c$: (group: string, name: string) => ({ group, name }) };
        new Function("_", "l", "s", "S", out)(_, {}, { he: {}, KP: {} }, { captureSetting: (v: any) => (captured = v) });
        expect(captured).toEqual({ group: "status", name: "showCurrentGame" });
    });
});
