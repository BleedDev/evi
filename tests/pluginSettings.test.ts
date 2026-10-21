import { afterEach, describe, expect, test } from "bun:test";

import { DEFAULT_SETTINGS } from "../src/shared/ipc";
import { PluginSettings } from "../src/renderer/plugins/context";
import { Settings } from "../src/renderer/settings";

const schema = {
    on: { type: "boolean", label: "On", default: true },
    size: { type: "number", label: "Size", default: 2 },
} as const;

Settings.init(structuredClone(DEFAULT_SETTINGS));
// No bridge to main here: drop the pending save each write schedules
afterEach(() => Settings.replace(Settings.data));

describe("plugin settings", () => {
    test("the snapshot keeps its identity until one of the plugin's own values changes", () => {
        const settings = new PluginSettings("ps-a", schema);
        const first = settings.snapshot();
        expect(first).toEqual({ on: true, size: 2 });
        // Another plugin writing its data: same object, nothing for React to re-render
        Settings.update(d => void ((d.plugins["ps-other"] ??= {}).settings = { data: [1, 2, 3] }));
        expect(settings.snapshot()).toBe(first);
        settings.set("size", 3);
        const second = settings.snapshot();
        expect(second).not.toBe(first);
        expect(second).toEqual({ on: true, size: 3 });
        // Set back to what it was: a change all the same
        settings.set("size", 2);
        expect(settings.snapshot()).toEqual({ on: true, size: 2 });
    });

    test("onChange runs only for the plugin's own changes, with a copy of the values", () => {
        const settings = new PluginSettings("ps-b", schema);
        const calls: unknown[] = [];
        const off = settings.onChange(values => calls.push(values));
        Settings.update(d => void ((d.plugins["ps-other"] ??= {}).enabled = true));
        expect(calls).toEqual([]);
        settings.set("on", false);
        expect(calls).toEqual([{ on: false, size: 2 }]);
        expect(calls[0]).not.toBe(settings.snapshot());
        settings.set("on", false);
        expect(calls.length).toBe(1);
        off();
        settings.set("on", true);
        expect(calls.length).toBe(1);
    });

    test("an onChange that throws doesn't stop the change or the listeners after it", () => {
        const settings = new PluginSettings("ps-c", schema);
        const offThrow = settings.onChange(() => {
            throw new Error("plugin bug");
        });
        let heard = 0;
        const offHeard = Settings.subscribe(() => void heard++);
        const error = console.error;
        console.error = () => { };
        try {
            expect(() => settings.set("size", 5)).not.toThrow();
            expect(() => Settings.replace(Settings.data)).not.toThrow();
        } finally {
            console.error = error;
            offThrow();
            offHeard();
        }
        expect(settings.get("size")).toBe(5);
        expect(heard).toBe(2);
    });
});
