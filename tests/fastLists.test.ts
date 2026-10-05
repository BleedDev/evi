import { describe, expect, test } from "bun:test";

import FastLists from "../plugins/fast-lists/index";

describe("fast-lists defaults", () => {
    // The chat is left alone (skipping messages fought Discord's place-keeping); Discord's virtualized
    // member list never has a row far enough away to skip
    test("server list on, member list off, no chat option", () => {
        const settings = FastLists.settings!;
        expect(settings.servers.default).toBe(true);
        expect(settings.members.default).toBe(false);
        expect("chat" in settings).toBe(false);
    });
});
