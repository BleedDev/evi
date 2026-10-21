import { describe, expect, test } from "bun:test";

import { BULK_ACK_LIMIT, chunk, collectUnread, collectUnreadSteps, countGuilds, summary, toAck } from "../plugins/read-all/collect";
import type { ReadStores } from "../plugins/read-all/collect";

const ch = (id: string) => ({ id });

function makeStores(unread: Record<string, { unread?: boolean; mentions?: number; last?: string | null; }>): ReadStores {
    return {
        GuildStore: { getGuilds: () => ({ g1: {}, g2: {}, g3: {} }) },
        GuildChannelStore: {
            getChannels: id => ({
                g1: { SELECTABLE: [{ channel: ch("a") }, { channel: ch("b") }], VOCAL: [{ channel: ch("v") }], count: 3 },
                g2: { SELECTABLE: [{ channel: ch("c") }] },
                g3: undefined,
            } as Record<string, any>)[id],
        },
        ReadStateStore: {
            hasUnread: id => !!unread[id]?.unread,
            getMentionCount: id => unread[id]?.mentions ?? 0,
            lastMessageId: id => (unread[id] && "last" in unread[id] ? unread[id].last : `m-${id}`),
        },
        ActiveJoinedThreadsStore: {
            getActiveJoinedThreadsForGuild: (id): Record<string, Record<string, unknown>> => (id === "g1" ? { a: { t1: { channel: ch("t1") }, t2: { channel: ch("t2") } } } : {}),
        },
        ChannelStore: { getSortedPrivateChannels: () => [ch("dm1"), ch("dm2")] },
    };
}

describe("read all: collecting", () => {
    test("picks unread and mentioned channels and threads across servers, skipping read ones", () => {
        const stores = makeStores({ a: { unread: true }, v: { mentions: 2 }, c: { unread: true }, t2: { unread: true }, dm1: { unread: true } });
        const result = collectUnread(stores);
        expect(result.map(r => r.channelId)).toEqual(["a", "v", "t2", "c"]);
        expect(result[0]).toEqual({ guildId: "g1", channelId: "a", messageId: "m-a", readStateType: 0 });
        expect(countGuilds(result)).toBe(2);
    });

    test("DMs only when asked", () => {
        const stores = makeStores({ dm1: { unread: true }, dm2: {} });
        expect(collectUnread(stores)).toEqual([]);
        const dms = collectUnread(stores, { includeDms: true });
        expect(dms).toEqual([{ guildId: null, channelId: "dm1", messageId: "m-dm1", readStateType: 0 }]);
        expect(countGuilds(dms)).toBe(0);
    });

    test("tolerates missing optional stores, array guild lists and null message ids", () => {
        const stores = makeStores({ a: { unread: true, last: null } });
        stores.GuildStore = { getGuilds: () => [{ id: "g1" }] };
        delete stores.ActiveJoinedThreadsStore;
        delete stores.ChannelStore;
        expect(collectUnread(stores, { includeDms: true })).toEqual([{ guildId: "g1", channelId: "a", messageId: null, readStateType: 0 }]);
    });

    test("prefers getGuildIds and never lists a channel twice", () => {
        const stores = makeStores({ a: { unread: true } });
        stores.GuildStore = { getGuilds: () => ({}), getGuildIds: () => ["g1", "g1"] };
        expect(collectUnread(stores).map(r => r.channelId)).toEqual(["a"]);
    });

    test("skipReadGuilds leaves out servers Discord says are read, without asking about their channels", () => {
        const stores = makeStores({ a: { unread: true }, c: { unread: true } });
        const asked: string[] = [];
        const hasUnread = stores.ReadStateStore.hasUnread;
        stores.ReadStateStore.hasUnread = id => (asked.push(id), hasUnread(id));
        stores.GuildReadStateStore = { hasUnread: id => id === "g2", getMentionCount: () => 0 };
        expect(collectUnread(stores, { skipReadGuilds: true }).map(r => r.channelId)).toEqual(["c"]);
        expect(asked).toEqual(["c"]);
        // Without the option (marking read), every channel is still checked
        expect(collectUnread(stores).map(r => r.channelId)).toEqual(["a", "c"]);
    });

    test("the stepped count pauses after each server it looks at and ends with the same result", () => {
        const stores = makeStores({ a: { unread: true }, v: { mentions: 2 }, c: { unread: true }, t2: { unread: true }, dm1: { unread: true } });
        const steps = collectUnreadSteps(stores, { includeDms: true });
        let pauses = 0;
        let step = steps.next();
        for (; !step.done; step = steps.next()) pauses++;
        expect(pauses).toBe(3);
        expect(step.value).toEqual(collectUnread(stores, { includeDms: true }));
        // Servers skipped as read cost no pause
        stores.GuildReadStateStore = { hasUnread: id => id === "g2", getMentionCount: () => 0 };
        const skipping = collectUnreadSteps(stores, { skipReadGuilds: true });
        expect(skipping.next().done).toBe(false);
        expect(skipping.next().done).toBe(true);
    });

    test("skipReadGuilds: mentions count, muted-inclusive check preferred, unknown means look", () => {
        const stores = makeStores({ a: { mentions: 1 }, c: { unread: true } });
        stores.GuildReadStateStore = { hasUnread: () => false, getMentionCount: id => (id === "g1" ? 1 : 0) };
        expect(collectUnread(stores, { skipReadGuilds: true }).map(r => r.channelId)).toEqual(["a"]);
        stores.GuildReadStateStore = { hasUnread: () => false, getGuildHasUnreadIgnoreMuted: id => id === "g2" };
        expect(collectUnread(stores, { skipReadGuilds: true }).map(r => r.channelId)).toEqual(["c"]);
        stores.GuildReadStateStore = {};
        expect(collectUnread(stores, { skipReadGuilds: true }).map(r => r.channelId)).toEqual(["a", "c"]);
    });

    test("toAck keeps only what BULK_ACK reads", () => {
        expect(toAck({ guildId: "g", channelId: "c", messageId: "m", readStateType: 0 } as any)).toEqual({ channelId: "c", messageId: "m", readStateType: 0 });
    });
});

describe("read all: batching", () => {
    test("batches of at most 100", () => {
        const items = Array.from({ length: 250 }, (_, i) => i);
        const batches = chunk(items);
        expect(BULK_ACK_LIMIT).toBe(100);
        expect(batches.map(b => b.length)).toEqual([100, 100, 50]);
        expect(batches.flat()).toEqual(items);
        expect(chunk([])).toEqual([]);
        expect(chunk([1, 2, 3], 2)).toEqual([[1, 2], [3]]);
        expect(() => chunk([1], 0)).toThrow(RangeError);
    });

    // A stand-in for the plugin's t: another test file replaces @evi/api's defineStrings for the whole run
    test("summary text", () => {
        const en: Record<string, string> = {
            "summary.none": "Nothing to mark",
            "summary.channels": "{count} ch",
            "summary.servers": "{count} sv",
            "summary.done": "Marked {channels}",
            "summary.doneInServers": "Marked {channels} in {servers}",
        };
        const t = (key: string, vars: Record<string, string | number> = {}) => en[key].replace(/\{(\w+)\}/g, (_, k) => String(vars[k]));
        expect(summary(0, 0, t)).toBe("Nothing to mark");
        expect(summary(1, 1, t)).toBe("Marked 1 ch in 1 sv");
        expect(summary(12, 3, t)).toBe("Marked 12 ch in 3 sv");
        expect(summary(2, 0, t)).toBe("Marked 2 ch");
    });
});
