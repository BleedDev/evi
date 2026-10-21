/**
 * What a plugin says it needs, in its manifest's `permissions`, and the rules Evi holds it to:
 *
 *     "permissions": { "network": ["api.example.com"], "readMessages": true }
 *
 *   network         sites it contacts from Discord's page, Discord's own included. A host covers its
 *                   subdomains ("discordapp.com" covers cdn.discordapp.com)
 *   readMessages    reads messages: message events, Discord's message stores, the Flux dispatcher
 *   sendMessages    sends messages: slash commands that post text, Discord's message endpoints
 *   changeSettings  changes settings: Discord's account and settings endpoints, Evi's badge settings
 *
 * Anything left out is false (or no sites), so `"permissions": {}` asks for nothing. A plugin without
 * `permissions` at all is from before Evi 0.7.0 (or doesn't say): it isn't held to anything, and the
 * store and its details say so.
 *
 * Where it's enforced (src/renderer/plugins/guard.ts): only in what Evi hands the plugin. Its fetch,
 * XMLHttpRequest, WebSocket and EventSource, its context (ctx.flux, ctx.hook, ctx.command...) and its
 * own copy of @evi/api. Plugins share one JavaScript realm with Discord, so code that reaches Discord's
 * objects another way (window.fetch, a finder by props, a source patch) can still go further; that's
 * why store plugins are still reviewed. A plugin's full-access part (native.js) isn't limited at all.
 *
 * Pure: no DOM, no network, no disk, shared by main, the renderer, the server and the tests.
 */
import { DISCORD_HOST } from "./pluginActivity";
import { englishTr, Tr } from "./tr";

export type PermissionKey = "network" | "readMessages" | "sendMessages" | "changeSettings";
/** The yes/no ones, in the order they're shown */
export const PERMISSION_FLAGS = ["readMessages", "sendMessages", "changeSettings"] as const;
export type PermissionFlag = (typeof PERMISSION_FLAGS)[number];

export interface DeclaredPermissions {
    /** Lowercase hosts, sorted, no duplicates */
    network: string[];
    readMessages: boolean;
    sendMessages: boolean;
    changeSettings: boolean;
}

export const MAX_HOSTS = 50;
const KEYS = new Set<string>(["network", ...PERMISSION_FLAGS]);
const LABEL = String.raw`[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?`;
/** A bare host with at least one dot (or localhost): no scheme, port, path or wildcard. Any case, read lowercase. */
const HOST_RE = new RegExp(`^(?:${LABEL}(?:\\.${LABEL})+|localhost)$`, "i");

export const isHost = (value: unknown): value is string => typeof value === "string" && value.length <= 253 && HOST_RE.test(value);

/**
 * Why a manifest's `permissions` can't be used, or undefined when it's fine. Strict: the store and
 * evi.rest refuse a plugin whose declaration Evi would read differently from how its author meant it.
 */
export function whyNotPermissions(raw: unknown): string | undefined {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return "permissions must be an object, like { \"network\": [\"api.example.com\"] }";
    const p = raw as Record<string, unknown>;
    for (const key of Object.keys(p)) {
        if (!KEYS.has(key)) return `permissions has an unknown key "${key.slice(0, 40)}": use network, readMessages, sendMessages or changeSettings`;
    }
    if (p.network !== undefined) {
        if (!Array.isArray(p.network) || p.network.length > MAX_HOSTS) return `permissions.network must list at most ${MAX_HOSTS} sites`;
        for (const host of p.network) {
            if (!isHost(host)) return `permissions.network: ${JSON.stringify(host)?.slice(0, 80)} isn't a site. Write just the host, like "api.example.com": no https://, port, path or *`;
        }
    }
    for (const flag of PERMISSION_FLAGS) {
        if (p[flag] !== undefined && typeof p[flag] !== "boolean") return `permissions.${flag} must be true or false`;
    }
}

/**
 * A manifest's declaration, cleaned up, or undefined when it doesn't declare one. Lenient, for plugins
 * already on disk (the store checked its own with whyNotPermissions): a site that isn't one is dropped
 * rather than granted, and anything but `true` is no.
 */
export function readPermissions(raw: unknown): DeclaredPermissions | undefined {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
    const p = raw as Record<string, unknown>;
    const hosts = Array.isArray(p.network) ? p.network.filter(isHost).map(h => h.toLowerCase()) : [];
    return {
        network: [...new Set(hosts)].sort().slice(0, MAX_HOSTS),
        readMessages: p.readMessages === true,
        sendMessages: p.sendMessages === true,
        changeSettings: p.changeSettings === true,
    };
}

/** The same declaration, however it was written (order, duplicates, false left out) */
export function samePermissions(a: DeclaredPermissions | undefined, b: DeclaredPermissions | undefined) {
    if (!a || !b) return !a === !b;
    return a.network.join(",") === b.network.join(",") && PERMISSION_FLAGS.every(f => a[f] === b[f]);
}

/** Whether the declaration lets it contact `host` (a port is ignored). Subdomains of a listed host count. */
export function hostAllowed(declared: DeclaredPermissions, host: string) {
    const bare = host.toLowerCase().replace(/:\d+$/, "").replace(/\.$/, "");
    return declared.network.some(h => bare === h || bare.endsWith(`.${h}`));
}

/**
 * Flux actions that carry message content: arriving, edited, deleted and loaded messages, search
 * results, and your drafts as you type. Reactions, typing and read states don't.
 */
const MESSAGE_ACTION = /^(?:LOCAL_)?MESSAGE_(?:CREATE|UPDATE|DELETE|DELETE_BULK)$|^LOAD_MESSAGES|^LOAD_(?:RECENT_MENTIONS|PINNED_MESSAGES|FORUM_POSTS)|^SEARCH_FINISH$|^DRAFT_/;
export const isMessageAction = (type: string) => MESSAGE_ACTION.test(type);

/** Flux stores that hold messages or drafts: MessageStore, ReferencedMessageStore, DraftStore... */
const MESSAGE_STORE = /Message|Mention|Pins|Draft|^SearchStore$/;
export const isMessageStore = (name: string) => MESSAGE_STORE.test(name);

/** Discord's API paths (no /api/vN prefix) that write, by what they need */
const DISCORD_WRITES: [PermissionFlag, RegExp][] = [
    // Posting, editing, deleting and reacting to messages; slash commands to bots; webhooks; new threads
    ["sendMessages", /^\/(?:channels\/\d+\/(?:messages|threads)(?:\/|$)|interactions$|webhooks\/\d+\/[^/]+)/i],
    // Your account, profile and settings (settings-proto, per-server notification settings)
    ["changeSettings", /^\/users\/@me(?:\/(?:settings(?:-proto\/\d+)?|guilds\/\d+\/settings|profile|consent|connections(?:\/.*)?))?$/i],
];

/**
 * A path as Discord's API reads it, for DISCORD_WRITES: %-escapes decoded (users/%40me is users/@me),
 * repeated and trailing slashes dropped, and no /api/vN prefix. Undefined when it can't be decoded.
 */
function apiPath(pathname: string) {
    let path: string;
    try {
        path = decodeURIComponent(pathname);
    } catch {
        return undefined;
    }
    return path.replace(/\/{2,}/g, "/").replace(/(.)\/$/, "$1").replace(/^\/api(?:\/v\d+)?(?=\/)/i, "");
}

export interface BlockedRequest {
    permission: PermissionKey;
    /** Lowercase host, with a port when it isn't the default */
    host: string;
}

/**
 * Whether a request the plugin makes through its own fetch, XMLHttpRequest, WebSocket or EventSource
 * is outside its declaration, and which permission it's missing. Relative URLs resolve against
 * `base` (Discord's page). What isn't a network request (data:, blob:) is always fine.
 */
export function checkRequest(declared: DeclaredPermissions, input: string, method = "GET", base?: string): BlockedRequest | undefined {
    let url: URL;
    try {
        url = base ? new URL(input, base) : new URL(input);
    } catch {
        return undefined;
    }
    if (!/^(?:https?|wss?):$/.test(url.protocol) || !url.hostname) return undefined;
    const host = url.host.toLowerCase();
    if (!hostAllowed(declared, host)) return { permission: "network", host };
    // discord.com. (a trailing dot) is discord.com too
    if (/^(?:GET|HEAD|OPTIONS)$/i.test(method) || !DISCORD_HOST.test(url.hostname.toLowerCase().replace(/\.$/, ""))) return undefined;
    const path = apiPath(url.pathname);
    for (const [permission, re] of DISCORD_WRITES) {
        // A path that can't be read could be any of them
        if ((path === undefined || re.test(path)) && !declared[permission]) return { permission, host };
    }
    return undefined;
}

export interface PermissionGrowth {
    /** Sites the new version contacts that the old one's didn't cover */
    hosts: string[];
    flags: PermissionFlag[];
    /** The new version stops declaring: Evi can't hold it to anything any more */
    undeclared: boolean;
}

/**
 * What a new version asks for that the installed one didn't, or undefined when it asks for nothing
 * more. An installed version that never declared wasn't held to anything, so whatever the new one
 * declares only narrows it.
 */
export function permissionGrowth(before: DeclaredPermissions | undefined, after: DeclaredPermissions | undefined): PermissionGrowth | undefined {
    if (!before) return undefined;
    if (!after) return { hosts: [], flags: [], undeclared: true };
    const hosts = after.network.filter(h => !hostAllowed(before, h));
    const flags = PERMISSION_FLAGS.filter(f => after[f] && !before[f]);
    return hosts.length || flags.length ? { hosts, flags, undeclared: false } : undefined;
}

/** The growth in words, for main's own dialog (the page shows it its own way). English without `tr`. */
export function describeGrowth(growth: PermissionGrowth, tr: Tr = englishTr) {
    if (growth.undeclared) return tr("main.growth.undeclared");
    const words: Record<PermissionFlag, string> = {
        readMessages: tr("main.growth.readMessages"),
        sendMessages: tr("main.growth.sendMessages"),
        changeSettings: tr("main.growth.changeSettings"),
    };
    const parts = [...growth.hosts.length ? [tr("main.growth.contact", { hosts: growth.hosts.join(tr("common.listSeparator")) })] : [], ...growth.flags.map(f => words[f])];
    return tr("main.growth.also", { parts: parts.join(tr("common.listSeparator")) });
}

const PERMISSION_WORDS: Record<PermissionKey, string> = {
    network: "contact",
    readMessages: "read messages",
    sendMessages: "send messages",
    changeSettings: "change settings",
};

/**
 * What a plugin gets when Evi refuses something its manifest doesn't declare: a rejected fetch, a
 * thrown call. The message says what to add, for whoever reads the console.
 */
export class PluginPermissionError extends Error {
    override name = "PluginPermissionError";

    constructor(readonly plugin: string, readonly permission: PermissionKey, readonly target: string) {
        super(permission === "network"
            ? `${plugin} can't contact ${target}: its manifest doesn't list it in permissions.network`
            : `${plugin} can't ${PERMISSION_WORDS[permission]} (${target}): its manifest doesn't declare permissions.${permission}`);
    }
}
