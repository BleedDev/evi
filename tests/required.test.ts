import { describe, expect, test } from "bun:test";

import { mayForcePlugins, mayUpdateEviUnasked, mustUpdate, parseRequired, parseRequiredInput } from "../src/shared/required";

describe("a required Evi version", () => {
    test("reads what evi.rest sends, and nothing from anything malformed", () => {
        expect(parseRequired({ required: { version: "2.0.1", reason: " Fixes\n toasts ", forcePlugins: true, at: 5 } })).toEqual({ version: "2.0.1", reason: "Fixes toasts", forcePlugins: true, at: 5 });
        expect(parseRequired({ required: null })).toBeNull();
        expect(parseRequired({ required: { version: "nope" } })).toBeNull();
        expect(parseRequired(null)).toBeNull();
        expect(parseRequired({ required: { version: "2.0.1", reason: "x".repeat(500) } })!.reason).toHaveLength(200);
    });

    test("an admin can only require a released version", () => {
        expect(parseRequiredInput({ version: "v2.0.1" })).toEqual({ version: "2.0.1", reason: "", forcePlugins: false });
        expect(parseRequiredInput({ version: "2.0.1-beta.1" })).toHaveProperty("error");
        expect(parseRequiredInput({ version: "" })).toHaveProperty("error");
        expect(parseRequiredInput({ version: "2.0.1", reason: "x".repeat(201) })).toHaveProperty("error");
    });

    test("older Evis must update; that version, newer ones and its betas don't", () => {
        const required = { version: "2.0.1", reason: "", forcePlugins: false, at: 0 };
        expect(mustUpdate(required, "1.5.0")).toBe(true);
        expect(mustUpdate(required, "2.0.0")).toBe(true);
        expect(mustUpdate(required, "2.0.0-beta.3")).toBe(true);
        expect(mustUpdate(required, "2.0.1")).toBe(false);
        expect(mustUpdate(required, "2.0.1-beta.1")).toBe(false);
        expect(mustUpdate(required, "2.1.0")).toBe(false);
        expect(mustUpdate(null, "1.0.0")).toBe(false);
    });

    test("never overrides the person's update settings", () => {
        // Evi itself: only with automatic updates on; off (or never set) means asking first
        expect(mayUpdateEviUnasked({ silentUpdates: true })).toBe(true);
        expect(mayUpdateEviUnasked({ silentUpdates: false })).toBe(false);
        expect(mayUpdateEviUnasked({})).toBe(false);
        // Plugins: only when asked for, and only with plugin auto-update on
        const withPlugins = { version: "2.0.1", reason: "", forcePlugins: true, at: 1 };
        expect(mayForcePlugins(withPlugins, { autoUpdate: true })).toBe(true);
        expect(mayForcePlugins(withPlugins, { autoUpdate: false })).toBe(false);
        expect(mayForcePlugins(withPlugins, {})).toBe(false);
        expect(mayForcePlugins({ ...withPlugins, forcePlugins: false }, { autoUpdate: true })).toBe(false);
        expect(mayForcePlugins(null, { autoUpdate: true })).toBe(false);
    });
});
