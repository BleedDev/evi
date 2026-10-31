import { describe, expect, test } from "bun:test";

import type { Replacement } from "../src/renderer/patching/source";
import { canonicalizeMatch, matchesFind } from "../src/renderer/patching/source";
import { fakeFlags, fakeState, PATCHES } from "../plugins/fake-deafen/voice";

// Verbatim from Discord's web build (test-results/chunks), trimmed to the patched spots
const SOURCES = {
    committer: 'H=new class extends M{socket;constructor(e){super(),this.socket=e}get guildId(){return this.getState().guildId}get channelId(){return this.getState().channelId}computeVoiceFlags(){return 0}}(B);',
    // Build of 2026-10-31
    localState: 'function s(){return{sessionId:l.default.getSessionId(),selfMute:r.Ay.isSelfMute()||r.Ay.isSelfMutedTemporarily(),selfDeaf:r.Ay.isSelfDeaf()}}function i(e,n){let{sessionId:t,selfMute:u,selfDeaf:l}=n;return null!=e&&null!=t&&e.sessionId===t?e.merge({selfMute:u,selfDeaf:l}):e}',
};

type AnyPatch = { find: string; replace: Replacement | Replacement[]; };

function apply(patch: AnyPatch, code: string, self = "S") {
    expect(matchesFind(code, patch.find)).toBe(true);
    let next = code;
    for (const r of ([] as Replacement[]).concat(patch.replace)) {
        const re = canonicalizeMatch(r.match) as RegExp;
        expect(next.match(new RegExp(re.source, "g"))?.length).toBe(1);
        const before = next;
        next = next.replace(re, (r.with as string).replaceAll("$self", self));
        expect(next).not.toBe(before);
    }
    return next;
}

describe("fakeState", () => {
    const real = { guildId: "1", channelId: "2", selfMute: false, selfDeaf: false, selfVideo: true, flags: 3 };

    test("deafens and mutes, keeping everything else", () => {
        expect(fakeState(real, { deafen: true, mute: true })).toEqual({ ...real, selfDeaf: true, selfMute: true });
    });
    test("deafened always shows muted too, like Discord", () => {
        expect(fakeState(real, { deafen: true, mute: false })).toEqual({ ...real, selfDeaf: true, selfMute: true });
    });
    test("mute alone", () => {
        expect(fakeState(real, { deafen: false, mute: true })).toEqual({ ...real, selfDeaf: false, selfMute: true });
    });
    test("never undoes a real mute or deafen", () => {
        const deaf = { ...real, selfMute: true, selfDeaf: true };
        expect(fakeState(deaf, { deafen: false, mute: false })).toEqual(deaf);
    });
    test("leaving a channel goes through untouched", () => {
        const leave = { guildId: null, channelId: null, selfMute: false, selfDeaf: false };
        expect(fakeState(leave, { deafen: true, mute: true })).toBe(leave);
    });
});

describe("patches", () => {
    test("committer: hands Discord's voice state committer to the plugin", () => {
        const out = apply(PATCHES.committer, SOURCES.committer);
        expect(out).toContain("constructor(e){super(),this.socket=e,S?.captureCommitter?.(this)}get guildId()");
        let captured: any;
        const S = { captureCommitter: (v: any) => (captured = v) };
        const H = new Function("M", "B", "S", `let ${out} return H;`)(class { }, "socket", S);
        expect(captured).toBe(H);
        expect(captured.socket).toBe("socket");
    });

    test("localState: your own rows show what fake deafen sends", () => {
        const out = apply(PATCHES.localState, SOURCES.localState);
        expect(out).toContain("function s(){return S?.localState?.({sessionId:");
        const run = (S: unknown) => new Function("l", "r", "S", `${out} return s();`)(
            { default: { getSessionId: () => "a" } },
            { Ay: { isSelfMute: () => false, isSelfMutedTemporarily: () => false, isSelfDeaf: () => false } },
            S,
        );
        expect(run({ localState: (v: any) => fakeFlags(v, { deafen: true, mute: false }) }))
            .toEqual({ sessionId: "a", selfMute: true, selfDeaf: true });
        // The plugin stopped: Discord's own state
        expect(run(undefined)).toEqual({ sessionId: "a", selfMute: false, selfDeaf: false });
    });
});
