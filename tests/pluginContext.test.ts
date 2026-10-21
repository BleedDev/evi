import { describe, expect, test } from "bun:test";

import { PluginContext } from "../src/renderer/plugins/context";

const manifest = { id: "ctx-test", name: "Context Test", version: "1.0.0", description: "", authors: [] } as any;

describe("a stopped plugin context", () => {
    test("undoes at once what an async start registers after the plugin stopped", async () => {
        const ctx = new PluginContext(manifest, {});
        const undone: string[] = [];
        ctx.onDispose(() => undone.push("before"));
        ctx.dispose();
        expect(undone).toEqual(["before"]);

        // The start resumes after its await, with the plugin already off
        ctx.onDispose(() => undone.push("after"));
        expect(undone).toEqual(["before", "after"]);

        let ticks = 0;
        ctx.setInterval(() => ticks++, 1);
        ctx.setTimeout(() => ticks++, 1);
        const target = { run: () => "original" };
        ctx.hook.instead(target, "run", () => "hooked");
        await Bun.sleep(20);
        expect(ticks).toBe(0);
        expect(target.run()).toBe("original");

        // Nothing piles up for a dispose that never comes
        ctx.dispose();
        expect(undone).toEqual(["before", "after"]);
    });
});
