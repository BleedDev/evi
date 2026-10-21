import { describe, expect, test } from "bun:test";

import { LIST_SWITCHES, LOWER_MEMORY_JS_FLAGS, mergeJsFlags, mergeSwitchList } from "../src/shared/chromiumSwitches";
import { DEFAULT_RESTART_GB, isBusy, isChannelPath, relaunchArgs, RESTART_AWAY_MS, RESTART_EVERY_MS, RESTART_MIN_UPTIME_MS, RestartCheck, restartLimitGb, shouldRestart, shouldTrim, TRIM_HIDDEN_MS } from "../src/shared/idle";

const GB = 1024 ** 3;
const NOW = 1_800_000_000_000;

describe("feature list switches", () => {
    test("merge in order, each entry once", () => {
        expect(mergeSwitchList("EviTest,Foo", "WinRetrieveSuggestionsOnlyOnDemand,Foo,HardwareMediaKeyHandling"))
            .toBe("EviTest,Foo,WinRetrieveSuggestionsOnlyOnDemand,HardwareMediaKeyHandling");
        expect(mergeSwitchList("", "A")).toBe("A");
        expect(mergeSwitchList("A,", " B ,,A")).toBe("A,B");
    });

    test("only comma-separated feature lists merge", () => {
        expect(LIST_SWITCHES.has("disable-features")).toBe(true);
        expect(LIST_SWITCHES.has("enable-features")).toBe(true);
        expect(LIST_SWITCHES.has("js-flags")).toBe(false);
        expect(LIST_SWITCHES.has("autoplay-policy")).toBe(false);
    });
});

describe("js-flags", () => {
    test("Discord's flag joins Evi's instead of replacing them", () => {
        expect(mergeJsFlags(LOWER_MEMORY_JS_FLAGS, "--verify-snapshot-checksum")).toBe(`${LOWER_MEMORY_JS_FLAGS} --verify-snapshot-checksum`);
        expect(mergeJsFlags("", "--expose-gc")).toBe("--expose-gc");
        expect(mergeJsFlags("  --a  ", " --b ")).toBe("--a --b");
    });

    test("a flag given twice keeps the later value", () => {
        expect(mergeJsFlags("--max-semi-space-size=8 --foo", "--max_semi_space_size=16")).toBe("--foo --max_semi_space_size=16");
        expect(mergeJsFlags("--lazy", "--no-lazy")).toBe("--no-lazy");
        expect(mergeJsFlags("--no-lazy", "-lazy")).toBe("-lazy");
    });
});

describe("trim", () => {
    const base = { now: NOW, hiddenSince: NOW - TRIM_HIDDEN_MS, busy: false, trimmed: false };
    test("after the window was hidden long enough, once", () => {
        expect(shouldTrim(base)).toBe(true);
        expect(shouldTrim({ ...base, trimmed: true })).toBe(false);
        expect(shouldTrim({ ...base, hiddenSince: NOW - TRIM_HIDDEN_MS + 1 })).toBe(false);
        expect(shouldTrim({ ...base, hiddenSince: undefined })).toBe(false);
    });

    test("never in a call, or when the page couldn't tell", () => {
        expect(shouldTrim({ ...base, busy: true })).toBe(false);
        expect(shouldTrim({ ...base, busy: null })).toBe(false);
    });
});

describe("idle restart", () => {
    const base: RestartCheck = {
        enabled: true, now: NOW, hiddenSince: NOW - RESTART_AWAY_MS, inputIdleMs: 0, busy: false,
        uptimeMs: RESTART_MIN_UPTIME_MS, lastRestart: undefined, rendererBytes: 5 * GB, limitGb: 4,
    };

    test("restarts when every condition holds", () => {
        expect(shouldRestart(base)).toBe(true);
        // Away by input instead: the window can be in view on an unused computer
        expect(shouldRestart({ ...base, hiddenSince: undefined, inputIdleMs: RESTART_AWAY_MS })).toBe(true);
    });

    test("off unless turned on", () => {
        expect(shouldRestart({ ...base, enabled: false })).toBe(false);
    });

    test("never in a call or when the page couldn't tell", () => {
        expect(shouldRestart({ ...base, busy: true })).toBe(false);
        expect(shouldRestart({ ...base, busy: null })).toBe(false);
    });

    test("only when away long enough", () => {
        expect(shouldRestart({ ...base, hiddenSince: NOW - RESTART_AWAY_MS + 1, inputIdleMs: RESTART_AWAY_MS - 1 })).toBe(false);
        expect(shouldRestart({ ...base, hiddenSince: undefined, inputIdleMs: 0 })).toBe(false);
    });

    test("not in the first hour, at most once a day", () => {
        expect(shouldRestart({ ...base, uptimeMs: RESTART_MIN_UPTIME_MS - 1 })).toBe(false);
        expect(shouldRestart({ ...base, lastRestart: NOW - RESTART_EVERY_MS + 1 })).toBe(false);
        expect(shouldRestart({ ...base, lastRestart: NOW - RESTART_EVERY_MS })).toBe(true);
        // A clock set back doesn't allow a second one
        expect(shouldRestart({ ...base, lastRestart: NOW + 1000 })).toBe(false);
    });

    test("only past the limit; an unknown limit is the default", () => {
        expect(shouldRestart({ ...base, rendererBytes: 4 * GB - 1 })).toBe(false);
        expect(shouldRestart({ ...base, rendererBytes: undefined })).toBe(false);
        expect(shouldRestart({ ...base, rendererBytes: 7 * GB, limitGb: 8 })).toBe(false);
        expect(restartLimitGb(undefined)).toBe(DEFAULT_RESTART_GB);
        expect(restartLimitGb(0.001)).toBe(DEFAULT_RESTART_GB);
        expect(restartLimitGb("2")).toBe(DEFAULT_RESTART_GB);
        expect(restartLimitGb(2)).toBe(2);
    });

    test("comes back where it was: hidden stays hidden, shown doesn't take focus", () => {
        expect(relaunchArgs(["--start-minimized", "--foo"], false)).toEqual(["--foo", "--start-inactive"]);
        expect(relaunchArgs(["--start-inactive"], true)).toEqual(["--start-minimized"]);
    });

    test("reopens channels and DMs only", () => {
        expect(isChannelPath("/channels/@me")).toBe(true);
        expect(isChannelPath("/channels/@me/123")).toBe(true);
        expect(isChannelPath("/channels/1/2")).toBe(true);
        expect(isChannelPath("/channels/1/2/3")).toBe(true);
        expect(isChannelPath("/store")).toBe(false);
        expect(isChannelPath("/channels/1/2?x=javascript:")).toBe(false);
        expect(isChannelPath(undefined)).toBe(false);
    });
});

describe("busy", () => {
    const stores = (patch: { voice?: string | null; rtc?: string | null; calls?: unknown; streams?: unknown[]; } = {}) => ({
        selectedChannel: { getVoiceChannelId: () => patch.voice ?? null },
        rtcConnection: { getChannelId: () => patch.rtc ?? null, isConnected: () => !!patch.rtc },
        call: { getCalls: () => patch.calls ?? [] },
        streaming: { getAllActiveStreams: () => patch.streams ?? [], getCurrentUserActiveStream: () => null },
    });

    test("idle when nothing is going on", () => {
        expect(isBusy(stores())).toBe(false);
        // A call others are in, not ringing anyone: not ours
        expect(isBusy(stores({ calls: [{ channelId: "1", ringing: [] }] }))).toBe(false);
    });

    test("voice, a connection, a ringing call or a stream keep it busy", () => {
        expect(isBusy(stores({ voice: "1" }))).toBe(true);
        expect(isBusy(stores({ rtc: "1" }))).toBe(true);
        expect(isBusy(stores({ calls: [{ channelId: "1", ringing: ["me"] }] }))).toBe(true);
        expect(isBusy(stores({ streams: [{ ownerId: "x" }] }))).toBe(true);
    });

    test("can't tell when a store is missing, changed or throws", () => {
        expect(isBusy({})).toBe(null);
        expect(isBusy({ ...stores(), call: undefined })).toBe(null);
        expect(isBusy({ ...stores(), call: { getCalls: () => "nope" } })).toBe(null);
        expect(isBusy({ ...stores(), selectedChannel: { getVoiceChannelId: () => { throw new Error("x"); } } })).toBe(null);
        // The streaming store is optional: streams need voice anyway
        expect(isBusy({ ...stores(), streaming: undefined })).toBe(false);
    });
});
