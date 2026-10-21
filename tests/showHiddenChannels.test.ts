import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";

// A PermissionStore that counts how often it's asked, with Discord's version counters
const Permissions = { VIEW_CHANNEL: 1n << 10n, CONNECT: 1n << 20n };
let visible = new Set<string>();
let joinable = new Set<string>();
let asked = 0;
let guildVersion = 0;
let channelsVersion = 0;
const listeners = new Set<() => void>();
const PermissionStore = {
    can(permission: bigint, channel: { id: string; }) {
        asked++;
        return (permission === Permissions.VIEW_CHANNEL ? visible : joinable).has(channel.id);
    },
    getGuildVersion: () => guildVersion,
    getChannelsVersion: () => channelsVersion,
    addChangeListener: (fn: () => void) => void listeners.add(fn),
    removeChangeListener: (fn: () => void) => void listeners.delete(fn),
};
const channels: Record<string, any> = {};
const ChannelStore = { getChannel: (id: string) => channels[id] };

// Other test files share @evi/api: it comes back whole afterwards
const realApi = { ...await import("@evi/api") };
afterAll(() => void mock.module("@evi/api", () => realApi));

mock.module("@evi/api", () => ({
    find: () => undefined,
    getStore: (name: string) => ({ PermissionStore, ChannelStore } as Record<string, unknown>)[name],
}));

const { canConnect, isHiddenChannel, watchPermissions } = await import("../plugins/show-hidden-channels/shared");

const channel = (id: string) => channels[id] = { id, guild_id: "g" };
const emitChange = () => listeners.forEach(fn => fn());

describe("show hidden channels: permission cache", () => {
    let unwatch: () => void;
    beforeEach(() => {
        unwatch?.();
        visible = new Set(["open"]);
        joinable = new Set(["open"]);
        asked = 0;
        unwatch = watchPermissions();
    });

    test("asks PermissionStore once per channel across renders", () => {
        const open = channel("open"), locked = channel("locked");
        for (let i = 0; i < 50; i++) {
            expect(isHiddenChannel(open)).toBe(false);
            expect(isHiddenChannel(locked)).toBe(true);
        }
        expect(asked).toBe(2);
        // By id, through ChannelStore, shares the same answer
        expect(isHiddenChannel({ channelId: "locked" })).toBe(true);
        expect(asked).toBe(2);
    });

    test("connect is asked only when needed, then kept", () => {
        const open = channel("open");
        joinable.delete("open");
        expect(isHiddenChannel(open)).toBe(false);
        expect(asked).toBe(1);
        expect(isHiddenChannel(open, true)).toBe(true);
        expect(canConnect(open)).toBe(false);
        expect(asked).toBe(2);
    });

    test("a PermissionStore change is picked up", () => {
        const locked = channel("locked");
        expect(isHiddenChannel(locked)).toBe(true);
        visible.add("locked");
        emitChange();
        expect(isHiddenChannel(locked)).toBe(false);
    });

    test("PermissionStore's versions are picked up before its change listeners run", () => {
        const locked = channel("locked");
        expect(isHiddenChannel(locked)).toBe(true);
        visible.add("locked");
        guildVersion++;
        expect(isHiddenChannel(locked)).toBe(false);
        visible.delete("locked");
        channelsVersion++;
        expect(isHiddenChannel(locked)).toBe(true);
    });

    test("a changed channel (new object) is asked again", () => {
        channel("locked");
        expect(isHiddenChannel({ channelId: "locked" })).toBe(true);
        visible.add("locked");
        channel("locked");
        expect(isHiddenChannel({ channelId: "locked" })).toBe(false);
    });

    test("nothing is cached while not watching", () => {
        unwatch();
        const locked = channel("locked");
        expect(isHiddenChannel(locked)).toBe(true);
        visible.add("locked");
        expect(isHiddenChannel(locked)).toBe(false);
        expect(asked).toBe(2);
        unwatch = watchPermissions();
    });

    test("DMs and Discord's pseudo channels are never hidden", () => {
        expect(isHiddenChannel({ id: "dm", isDM: () => true })).toBe(false);
        expect(isHiddenChannel({ id: "browse", guild_id: "g" })).toBe(false);
        expect(isHiddenChannel({ channelId: null })).toBe(false);
        expect(asked).toBe(0);
    });
});
