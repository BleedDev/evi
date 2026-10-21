import { describe, expect, test } from "bun:test";

import {
    CAP, ChannelSnapshot, countByFilter, decide, DEDUPE_WINDOW, filterEntries, GROUP_DM, groupName, isRepeat, Lookup, matches, missedChanges, notification,
    NotificationLog, PAGE_SIZE, paginate, parseHistory, parseSnapshot, RelationshipType, REPEAT_WINDOW, SELF_WINDOW, settleSnapshot, Snapshot, storedHistory,
    storeLookup, Tracker, UNANSWERED_AFTER, unansweredRequests,
} from "../plugins/relationship-notifier/events";

const ME = "me";

function lookup(overrides: {
    relationships?: Record<string, number>;
    users?: Record<string, string>;
    channels?: Record<string, ChannelSnapshot>;
    guilds?: Record<string, string>;
    currentUserId?: string;
} = {}): Lookup {
    return {
        currentUserId: "currentUserId" in overrides ? overrides.currentUserId : ME,
        relationshipType: id => overrides.relationships?.[id],
        userName: id => overrides.users?.[id],
        channel: id => overrides.channels?.[id],
        guildName: id => overrides.guilds?.[id],
    };
}

const friends = lookup({
    relationships: { a: RelationshipType.FRIEND, b: RelationshipType.OUTGOING, c: RelationshipType.INCOMING, d: RelationshipType.BLOCKED },
    users: { a: "Alice", b: "Bob", c: "Carol" },
});

describe("relationship notifier: friends", () => {
    test("a friend removing you is reported with their name", () => {
        const n = decide({ type: "RELATIONSHIP_REMOVE", relationship: { id: "a", type: 1 } }, friends, new Tracker(), 5);
        expect(n).toEqual({ kind: "friendRemoved", id: "a", name: "Alice", at: 5, text: "Alice removed you as a friend" });
    });

    test("an outgoing request going away is reported as declined or cancelled", () => {
        const n = decide({ type: "RELATIONSHIP_REMOVE", relationship: { id: "b", type: 4 } }, friends, new Tracker(), 5);
        expect(n?.kind).toBe("requestCancelled");
        expect(n?.text).toContain("Bob");
    });

    test("incoming requests and blocks are ignored", () => {
        const t = new Tracker();
        expect(decide({ type: "RELATIONSHIP_REMOVE", relationship: { id: "c", type: 3 } }, friends, t)).toBeNull();
        expect(decide({ type: "RELATIONSHIP_REMOVE", relationship: { id: "d", type: 2 } }, friends, t)).toBeNull();
    });

    test("the store's type wins over the payload's, and the payload is a fallback", () => {
        const t = new Tracker();
        expect(decide({ type: "RELATIONSHIP_REMOVE", relationship: { id: "c", type: 1 } }, friends, t)).toBeNull();
        const n = decide({ type: "RELATIONSHIP_REMOVE", relationship: { id: "x", type: 1, user: { username: "xavier" } } }, friends, t);
        expect(n?.name).toBe("xavier");
        const unknown = decide({ type: "RELATIONSHIP_REMOVE", relationship: { id: "y", type: 1 } }, friends, t);
        expect(unknown?.name).toBe("User y");
    });

    test("removals you made yourself are not reported, once", () => {
        const t = new Tracker();
        t.markSelf("relationship", "a", 0);
        expect(decide({ type: "RELATIONSHIP_REMOVE", relationship: { id: "a" } }, friends, t, 10)).toBeNull();
        // The mark was consumed
        expect(decide({ type: "RELATIONSHIP_REMOVE", relationship: { id: "a" } }, friends, t, 20)?.kind).toBe("friendRemoved");
    });

    test("own marks expire", () => {
        const t = new Tracker();
        t.markSelf("relationship", "a", 0);
        expect(decide({ type: "RELATIONSHIP_REMOVE", relationship: { id: "a" } }, friends, t, SELF_WINDOW + 1)?.kind).toBe("friendRemoved");
    });

    test("malformed actions are ignored", () => {
        const t = new Tracker();
        expect(decide({ type: "RELATIONSHIP_REMOVE" }, friends, t)).toBeNull();
        expect(decide({ type: "RELATIONSHIP_ADD", relationship: { id: "a", type: 1 } }, friends, t)).toBeNull();
        expect(decide(undefined as any, friends, t)).toBeNull();
    });
});

describe("relationship notifier: group DMs", () => {
    const groups = lookup({
        channels: {
            g: { type: GROUP_DM, name: "Weekend", recipients: ["a"] },
            h: { type: GROUP_DM, name: "", recipients: ["a", "b", "z"] },
            dm: { type: 1, recipients: ["a"] },
            text: { type: 0, name: "general" },
        },
        users: { a: "Alice", b: "Bob" },
    });

    test("a group DM deleted for you is reported with its name", () => {
        const n = decide({ type: "CHANNEL_DELETE", channel: { id: "g", type: 3 } }, groups, new Tracker(), 7);
        expect(n).toEqual({ kind: "groupRemoved", id: "g", name: "Weekend", at: 7, text: "You were removed from Weekend" });
    });

    test("unnamed groups are named after their members", () => {
        expect(decide({ type: "CHANNEL_DELETE", channel: { id: "h" } }, groups, new Tracker())?.name).toBe("Alice, Bob");
        expect(groupName({ type: GROUP_DM, recipients: ["q"] }, groups)).toBe("a group DM");
    });

    test("DMs, guild channels and unknown channels are ignored", () => {
        const t = new Tracker();
        expect(decide({ type: "CHANNEL_DELETE", channel: { id: "dm" } }, groups, t)).toBeNull();
        expect(decide({ type: "CHANNEL_DELETE", channel: { id: "text" } }, groups, t)).toBeNull();
        expect(decide({ type: "CHANNEL_DELETE", channel: { id: "nope" } }, groups, t)).toBeNull();
    });

    test("leaving yourself is not reported", () => {
        const t = new Tracker();
        t.markSelf("channel", "g", 0);
        expect(decide({ type: "CHANNEL_DELETE", channel: { id: "g" } }, groups, t, 1)).toBeNull();
    });

    test("recipient removal counts only when it's you", () => {
        const t = new Tracker();
        expect(decide({ type: "CHANNEL_RECIPIENT_REMOVE", channelId: "g", user: { id: "a" } }, groups, t)).toBeNull();
        expect(decide({ type: "CHANNEL_RECIPIENT_REMOVE", channelId: "g", user: { id: ME } }, groups, t)?.kind).toBe("groupRemoved");
        const noUser = lookup({ currentUserId: undefined, channels: { g: { type: GROUP_DM, name: "W" } } });
        expect(decide({ type: "CHANNEL_RECIPIENT_REMOVE", channelId: "g", user: { id: ME } }, noUser, new Tracker())).toBeNull();
    });

    test("recipient remove then channel delete is reported once", () => {
        const t = new Tracker();
        expect(decide({ type: "CHANNEL_RECIPIENT_REMOVE", channelId: "g", user: { id: ME } }, groups, t, 0)).not.toBeNull();
        expect(decide({ type: "CHANNEL_DELETE", channel: { id: "g" } }, groups, t, 100)).toBeNull();
        expect(decide({ type: "CHANNEL_DELETE", channel: { id: "g" } }, groups, t, DEDUPE_WINDOW + 200)).not.toBeNull();
    });
});

describe("relationship notifier: servers", () => {
    const servers = lookup({ guilds: { s: "Cool Server" } });

    test("being removed from a server is reported with its name", () => {
        const n = decide({ type: "GUILD_DELETE", guild: { id: "s" } }, servers, new Tracker(), 3);
        expect(n).toEqual({ kind: "serverRemoved", id: "s", name: "Cool Server", at: 3, text: "You were removed from Cool Server" });
    });

    test("outages (unavailable) are ignored", () => {
        expect(decide({ type: "GUILD_DELETE", guild: { id: "s", unavailable: true } }, servers, new Tracker())).toBeNull();
    });

    test("servers you left yourself are ignored", () => {
        const t = new Tracker();
        t.markSelf("guild", "s", 0);
        expect(decide({ type: "GUILD_DELETE", guild: { id: "s" } }, servers, t, 1)).toBeNull();
    });

    test("unknown servers and duplicates are ignored", () => {
        const t = new Tracker();
        expect(decide({ type: "GUILD_DELETE", guild: { id: "unknown" } }, servers, t)).toBeNull();
        expect(decide({ type: "GUILD_DELETE", guild: { id: "s" } }, servers, t, 0)).not.toBeNull();
        expect(decide({ type: "GUILD_DELETE", guild: { id: "s" } }, servers, t, 5)).toBeNull();
    });

    test("scopes don't mix", () => {
        const t = new Tracker();
        t.markSelf("channel", "s", 0);
        expect(decide({ type: "GUILD_DELETE", guild: { id: "s" } }, servers, t, 1)).not.toBeNull();
    });
});

describe("relationship notifier: log", () => {
    const entry = (id: string, at = 1) => ({ kind: "friendRemoved" as const, id, name: id, at, text: id });

    test("newest first, limited, immutable snapshots", () => {
        const log = new NotificationLog(2);
        log.add(entry("a"));
        const first = log.entries;
        log.add(entry("b"));
        log.add(entry("c"));
        expect(log.entries.map(e => e.id)).toEqual(["c", "b"]);
        expect(first.map(e => e.id)).toEqual(["a"]);
    });

    test("notifies listeners and clears", () => {
        const log = new NotificationLog();
        let calls = 0;
        const off = log.subscribe(() => calls++);
        log.add(entry("a"));
        log.clear();
        log.clear();
        expect(calls).toBe(2);
        expect(log.entries).toEqual([]);
        off();
        log.add(entry("b"));
        expect(calls).toBe(2);
    });
});

describe("relationship notifier: store lookup", () => {
    function stores() {
        const asked: string[] = [];
        const all: Record<string, any> = {
            UserStore: { getCurrentUser: () => ({ id: ME }), getUser: (id: string) => id === "a" ? { globalName: "Alice" } : undefined },
            RelationshipStore: { getRelationshipType: () => RelationshipType.FRIEND, getNickname: () => undefined },
            ChannelStore: { getChannel: (id: string) => id === "g" ? { type: GROUP_DM, name: "Pals", recipients: ["a"] } : { type: 0, name: "general" } },
            GuildStore: { getGuild: (id: string) => id === "s" ? { name: "Server" } : undefined },
        };
        return { asked, store: (name: string) => (asked.push(name), all[name]) };
    }

    test("a server channel being deleted only looks up ChannelStore", () => {
        const { asked, store } = stores();
        expect(decide({ type: "CHANNEL_DELETE", channel: { id: "text" } }, storeLookup(store), new Tracker())).toBeNull();
        expect(asked).toEqual(["ChannelStore"]);
    });

    test("an unavailable server looks nothing up", () => {
        const { asked, store } = stores();
        expect(decide({ type: "GUILD_DELETE", guild: { id: "s", unavailable: true } }, storeLookup(store), new Tracker())).toBeNull();
        expect(asked).toEqual([]);
    });

    test("each store is looked up once per action, and answers like before", () => {
        const { asked, store } = stores();
        const entry = decide({ type: "RELATIONSHIP_REMOVE", relationship: { id: "a", type: RelationshipType.FRIEND } }, storeLookup(store), new Tracker());
        expect(entry?.text).toBe("Alice removed you as a friend");
        expect(asked.sort()).toEqual(["RelationshipStore", "UserStore"]);
        const lookup = storeLookup(store);
        expect(lookup.currentUserId).toBe(ME);
        expect(lookup.guildName("s")).toBe("Server");
        expect(lookup.channel("g")).toEqual({ type: GROUP_DM, name: "Pals", recipients: ["a"] });
    });
});

describe("relationship notifier: friend requests", () => {
    const people = lookup({
        relationships: { b: RelationshipType.OUTGOING, c: RelationshipType.INCOMING, a: RelationshipType.FRIEND },
        users: { a: "Alice", b: "Bob", c: "Carol" },
    });

    test("a request you sent becoming a friendship is reported as accepted, once", () => {
        const t = new Tracker();
        const n = decide({ type: "RELATIONSHIP_ADD", relationship: { id: "b", type: 1, user: { username: "bob" } } }, people, t, 5);
        expect(n).toEqual({ kind: "requestAccepted", id: "b", name: "Bob", username: "bob", at: 5, text: "Bob accepted your friend request" });
        expect(decide({ type: "RELATIONSHIP_UPDATE", relationship: { id: "b", type: 1 } }, people, t, 10)).toBeNull();
        expect(decide({ type: "RELATIONSHIP_UPDATE", relationship: { id: "b", type: 1 } }, people, t, DEDUPE_WINDOW + 20)?.kind).toBe("requestAccepted");
    });

    test("accepting their request, new requests and updates to friends aren't acceptances", () => {
        const t = new Tracker();
        expect(decide({ type: "RELATIONSHIP_ADD", relationship: { id: "c", type: 1 } }, people, t)).toBeNull();
        expect(decide({ type: "RELATIONSHIP_ADD", relationship: { id: "b", type: 4 } }, people, t)).toBeNull();
        expect(decide({ type: "RELATIONSHIP_UPDATE", relationship: { id: "a", type: 1 } }, people, t)).toBeNull();
        expect(decide({ type: "RELATIONSHIP_ADD", relationship: {} }, people, t)).toBeNull();
    });

    test("a request going away says it may be a block", () => {
        expect(decide({ type: "RELATIONSHIP_REMOVE", relationship: { id: "b" } }, people, new Tracker())?.text)
            .toBe("Your friend request to Bob was declined, or they blocked you");
    });

    test("a friend removal keeps how long you were friends and their @username, when known", () => {
        const known: Lookup = { ...people, since: () => 1000, username: () => "alice" };
        const n = decide({ type: "RELATIONSHIP_REMOVE", relationship: { id: "a" } }, known, new Tracker(), 5);
        expect(n).toMatchObject({ kind: "friendRemoved", since: 1000, username: "alice" });
    });

    test("unanswered after a week, reported once, forgotten when the request goes", () => {
        const now = 10 * UNANSWERED_AFTER;
        const outgoing = [["old", now - UNANSWERED_AFTER], ["new", now - UNANSWERED_AFTER + 1], ["unknown", undefined], ["told", now - 2 * UNANSWERED_AFTER]] as const;
        const first = unansweredRequests(outgoing, new Set(["told", "gone"]), now);
        expect(first.due).toEqual(["old"]);
        expect(first.remember.sort()).toEqual(["old", "told"]);
        expect(unansweredRequests(outgoing, new Set(first.remember), now).due).toEqual([]);
    });
});

describe("relationship notifier: while offline", () => {
    const snapshot = (over: Partial<Snapshot> = {}): Snapshot => ({
        user: ME,
        at: 100,
        friends: { a: { name: "Alice", since: 50 }, d: { name: "Dave" } },
        requests: { b: { name: "Bob", username: "bob" }, c: { name: "Carol" } },
        servers: { s: "Cool Server", u: "Down Server" },
        ...over,
    });

    test("friends, requests and servers that are gone are reported, worded for not knowing who did it", () => {
        const now = snapshot({ at: 200, friends: { d: { name: "Dave" }, c: { name: "Carol" } }, requests: {}, servers: { u: "Down Server" } });
        expect(missedChanges(snapshot(), now, 300)).toEqual([
            { kind: "friendRemoved", id: "a", name: "Alice", since: 50, at: 300, offlineSince: 100, text: "Alice is no longer your friend" },
            { kind: "requestCancelled", id: "b", name: "Bob", username: "bob", at: 300, offlineSince: 100, text: "Your friend request to Bob is gone: declined, cancelled, or they blocked you" },
            { kind: "requestAccepted", id: "c", name: "Carol", at: 300, offlineSince: 100, text: "Carol accepted your friend request" },
            { kind: "serverRemoved", id: "s", name: "Cool Server", at: 300, offlineSince: 100, text: "You're no longer in Cool Server" },
        ]);
    });

    test("servers that are only unavailable aren't gone, and stay in the snapshot", () => {
        const now = snapshot({ servers: { s: "Cool Server" } });
        expect(missedChanges(snapshot(), now, 300, id => id === "u")).toEqual([]);
        expect(settleSnapshot(snapshot(), now, id => id === "u").servers).toEqual({ s: "Cool Server", u: "Down Server" });
        expect(settleSnapshot(snapshot(), now).servers).toEqual({ s: "Cool Server" });
    });

    test("an empty section is one Discord hasn't loaded: nothing is reported, the old one is kept", () => {
        const now = snapshot({ at: 200, friends: {}, requests: {}, servers: {} });
        expect(missedChanges(snapshot(), now, 300)).toEqual([]);
        const kept = settleSnapshot(snapshot(), now);
        expect(kept.friends).toEqual(snapshot().friends);
        expect(kept.requests).toEqual(snapshot().requests);
        expect(kept.servers).toEqual(snapshot().servers);
        expect(kept.at).toBe(200);
    });

    test("friends and requests load together: the last request answered isn't an unloaded section", () => {
        const before = snapshot({ friends: {}, requests: { b: { name: "Bob" } } });
        expect(missedChanges(before, snapshot({ friends: { b: { name: "Bob" } }, requests: {} }), 300).map(e => e.kind)).toEqual(["requestAccepted"]);
        expect(missedChanges(before, snapshot({ friends: {}, requests: {} }), 300)).toEqual([]);
    });

    test("nothing to compare with, or another account's snapshot: nothing reported", () => {
        expect(missedChanges(undefined, snapshot(), 300)).toEqual([]);
        const other = snapshot({ user: "someone else", friends: {} });
        expect(missedChanges(snapshot(), other, 300)).toEqual([]);
        expect(settleSnapshot(snapshot(), other)).toBe(other);
    });

    test("stored snapshots are read back, junk isn't", () => {
        expect(parseSnapshot(JSON.parse(JSON.stringify(snapshot())))).toEqual(snapshot());
        expect(parseSnapshot(null)).toBeUndefined();
        expect(parseSnapshot({ user: ME })).toBeUndefined();
        expect(parseSnapshot({ user: ME, at: 1, friends: { x: { name: 5 }, y: "nope" }, servers: { s: 3 } })).toEqual({ user: ME, at: 1, friends: {}, requests: {}, servers: {} });
    });
});

describe("relationship notifier: history", () => {
    type Kind = "friendRemoved" | "serverRemoved" | "requestAccepted";
    const entry = (id: string, at = 1, kind: Kind = "friendRemoved", extra: { username?: string; offlineSince?: number; } = {}) =>
        notification({ kind, id, name: `Name ${id.toUpperCase()}`, at, ...extra });

    test("keeps the last 500", () => {
        const log = new NotificationLog();
        for (let i = 0; i < CAP + 20; i++) log.add(entry(`u${i}`, i));
        expect(log.entries.length).toBe(CAP);
        expect(log.entries[0].id).toBe(`u${CAP + 19}`);
        expect(log.entries.at(-1)?.id).toBe("u20");
    });

    test("the same thing reported again within a minute is a repeat", () => {
        const log = new NotificationLog();
        expect(log.add(entry("a", 0))).toBe(true);
        expect(log.add(entry("a", REPEAT_WINDOW - 1))).toBe(false);
        expect(log.add(entry("a", 10, "serverRemoved"))).toBe(true);
        expect(log.add(entry("b", 10))).toBe(true);
        expect(log.add(entry("a", REPEAT_WINDOW + 1))).toBe(true);
        expect(log.entries.length).toBe(4);
    });

    test("something noticed after being offline repeats anything logged since it could have happened", () => {
        const logged = [entry("a", 5_000_000)];
        expect(isRepeat(logged, entry("a", 9_000_000, "friendRemoved", { offlineSince: 4_000_000 }))).toBe(true);
        expect(isRepeat(logged, entry("a", 9_000_000, "friendRemoved", { offlineSince: 6_000_000 }))).toBe(false);
        expect(isRepeat(logged, entry("a", 9_000_000))).toBe(false);
    });

    test("stored without the English text, read back with it, junk dropped, newest first, capped", () => {
        const entries = [entry("b", 2, "requestAccepted", { username: "bee" }), entry("a", 3, "friendRemoved", { offlineSince: 1 })];
        const stored = JSON.parse(JSON.stringify(storedHistory(entries)));
        expect(stored[0].text).toBeUndefined();
        const read = parseHistory([...stored, { kind: "nope", id: "x", name: "x", at: 1 }, { kind: "friendRemoved", id: 5 }, null, "x"]);
        expect(read).toEqual([entries[1], entries[0]]);
        expect(read[0].text).toBe("Name A is no longer your friend");
        expect(parseHistory({})).toEqual([]);
        expect(parseHistory(Array.from({ length: CAP + 5 }, (_, i) => ({ kind: "friendRemoved", id: `u${i}`, name: "x", at: i }))).length).toBe(CAP);
    });

    test("filters by kind, and searches name, @username and id", () => {
        const entries = [entry("111", 1), entry("222", 2, "serverRemoved"), entry("333", 3, "requestAccepted", { username: "SomeOne" })];
        expect(filterEntries(entries, "all").length).toBe(3);
        expect(filterEntries(entries, "serverRemoved").map(e => e.id)).toEqual(["222"]);
        expect(filterEntries(entries, "requestUnanswered")).toEqual([]);
        expect(matches(entries[0], "all", "  name 1 ")).toBe(true);
        expect(matches(entries[2], "all", "someone")).toBe(true);
        expect(matches(entries[1], "all", "22")).toBe(true);
        expect(matches(entries[1], "friendRemoved", "22")).toBe(false);
        expect(filterEntries(entries, "all", "nobody")).toEqual([]);
        expect(countByFilter(entries)).toEqual({
            all: 3, friendRemoved: 1, requestCancelled: 0, requestAccepted: 1, requestUnanswered: 0, groupRemoved: 0, serverRemoved: 1,
        });
    });

    test("pages of 20, clamped into range", () => {
        const list = Array.from({ length: 45 }, (_, i) => i);
        expect(paginate(list, 0)).toEqual({ items: list.slice(0, PAGE_SIZE), page: 0, pages: 3 });
        expect(paginate(list, 2).items).toEqual([40, 41, 42, 43, 44]);
        expect(paginate(list, 9).page).toBe(2);
        expect(paginate(list, -3).page).toBe(0);
        expect(paginate(list, NaN).page).toBe(0);
        expect(paginate([], 4)).toEqual({ items: [], page: 0, pages: 1 });
    });
});
