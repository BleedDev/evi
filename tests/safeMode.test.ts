import { describe, expect, test } from "bun:test";

import { isDiscordAppUrl, isOverlayUrl, isOverlayWindow, OOP_OVERLAY_WINDOW } from "../src/shared/appHosts";
import { DEFAULT_SETTINGS, EviSettings, PluginManifest, RecentChange } from "../src/shared/ipc";
import { addChange, diffSettings, MAX_CHANGES, parseState, pickSuspect, startupMode, StartupState } from "../src/shared/safeMode";

const settings = (patch: Partial<EviSettings> = {}): EviSettings => ({ ...structuredClone(DEFAULT_SETTINGS), ...patch });
const change = (c: Partial<RecentChange>): RecentChange => ({ kind: "plugin", id: "a", action: "enabled", at: 1, ...c });

describe("startup mode", () => {
    test("two failed starts in a row mean safe mode, four mean one vanilla start", () => {
        expect(startupMode({ pendingStarts: 0, changes: [] }, false)).toBe("normal");
        expect(startupMode({ pendingStarts: 1, changes: [] }, false)).toBe("normal");
        expect(startupMode({ pendingStarts: 2, changes: [] }, false)).toBe("safe");
        expect(startupMode({ pendingStarts: 3, changes: [] }, false)).toBe("safe");
        expect(startupMode({ pendingStarts: 4, changes: [] }, false)).toBe("vanilla");
    });

    test("the flag and sticky safe mode", () => {
        expect(startupMode({ pendingStarts: 0, changes: [] }, true)).toBe("safe");
        expect(startupMode({ pendingStarts: 0, forceSafe: "renderer-crash", changes: [] }, false)).toBe("safe");
    });
});

describe("recent changes", () => {
    test("records what got turned on or changed, not what got turned off", () => {
        const prev = settings({ plugins: { a: { enabled: true }, b: { enabled: false, settings: { x: 1 } } }, enabledThemes: ["old.css"], quickCss: false });
        const next = settings({ plugins: { a: { enabled: false }, b: { enabled: false, settings: { x: 2 } }, c: { enabled: true } }, enabledThemes: ["new.css"], quickCss: true });
        expect(diffSettings(prev, next)).toEqual([
            { kind: "plugin", id: "b", action: "settings" },
            { kind: "plugin", id: "c", action: "enabled" },
            { kind: "theme", id: "new.css", action: "enabled" },
            { kind: "quickCss", id: "quick.css", action: "enabled" },
        ]);
        expect(diffSettings(next, next)).toEqual([]);
    });

    test("newest first, repeats only bump the time, capped", () => {
        let list: RecentChange[] = [];
        list = addChange(list, change({ id: "a", at: 1 }));
        list = addChange(list, change({ kind: "quickCss", id: "quick.css", action: "edited", at: 2 }));
        list = addChange(list, change({ kind: "quickCss", id: "quick.css", action: "edited", at: 3 }));
        expect(list.map(c => [c.id, c.at])).toEqual([["quick.css", 3], ["a", 1]]);
        for (let i = 0; i < 20; i++) list = addChange(list, change({ id: `p${i}` }));
        expect(list.length).toBe(MAX_CHANGES);
        expect(list[0].id).toBe("p19");
    });

    test("the suspect is the newest change that's still on", () => {
        const manifests: PluginManifest[] = [{ id: "a", name: "A" }, { id: "b", name: "B", enabledByDefault: true }];
        const changes = [
            change({ id: "a", at: 3 }),
            change({ kind: "theme", id: "t.css", at: 2 }),
            change({ id: "b", action: "updated", at: 1 }),
        ];
        // a was turned off again, t.css is on
        expect(pickSuspect(changes, settings({ plugins: { a: { enabled: false } }, enabledThemes: ["t.css"] }), manifests)?.id).toBe("t.css");
        // Both off: b is on by default
        expect(pickSuspect(changes, settings(), manifests)?.id).toBe("b");
        // A plugin that's gone can't be it
        expect(pickSuspect([change({ id: "gone" })], settings({ plugins: { gone: { enabled: true } } }), manifests)).toBeUndefined();
    });
});

describe("reading safe-mode.json", () => {
    test("files from before crash records still load", () => {
        const old: StartupState = { pendingStarts: 1, forceSafe: "renderer-crash", changes: [change({})] };
        expect(parseState(old)).toEqual(old);
    });

    test("damaged fields fall back, unknown ones are kept", () => {
        expect(parseState(null)).toEqual({ pendingStarts: 0, changes: [] });
        expect(parseState({ pendingStarts: -3, forceSafe: "maybe", changes: "x", crash: { at: "?" }, future: 1 }))
            .toEqual({ pendingStarts: 0, changes: [], future: 1 } as any);
    });

    test("the crash record comes through", () => {
        const crash = { at: 5, reason: "crashed", suspect: { plugin: "a", why: "busiest", site: { kind: "hook", name: "x", ms: 200 } } };
        expect(parseState({ pendingStarts: 0, changes: [], crash }).crash).toEqual(crash as any);
    });
});

test("Discord's in-game overlay is told apart from its window", () => {
    expect(isOverlayUrl("https://discord.com/overlay")).toBe(true);
    expect(isOverlayUrl("https://canary.discord.com/overlay/123?x=1")).toBe(true);
    expect(isOverlayUrl("https://discord.com/channels/@me")).toBe(false);
    expect(isOverlayUrl("https://discord.com/overlays-are-not-this")).toBe(false);
    expect(isOverlayUrl("not a url")).toBe(false);
    expect(isDiscordAppUrl("https://discord.com/overlay")).toBe(true);
});

test("the newer overlay is the popout Discord opens over the game, not its other popouts", () => {
    expect(isOverlayWindow("https://discord.com/popout", OOP_OVERLAY_WINDOW)).toBe(true);
    expect(isOverlayWindow("https://discord.com/overlay", "")).toBe(true);
    expect(isOverlayWindow("https://discord.com/popout", "DISCORD_CHANNEL_CALL_POPOUT")).toBe(false);
    expect(isOverlayWindow("https://discord.com/channels/@me", "")).toBe(false);
});

test("with safe mode turned off in settings, crashes don't turn it on; --evi-safe and the last resort still work", () => {
    const crashed = { pendingStarts: 2, forceSafe: "renderer-crash" as const, changes: [] };
    expect(startupMode(crashed, false, false)).toBe("normal");
    expect(startupMode(crashed, true, false)).toBe("safe");
    expect(startupMode(crashed, false, true)).toBe("safe");
    expect(startupMode({ pendingStarts: 99, changes: [] }, false, false)).toBe("vanilla");
});
