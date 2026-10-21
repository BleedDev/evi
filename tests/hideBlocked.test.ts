import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { Replacement, SourcePatch } from "../src/renderer/patching/source";
import { canonicalizeMatch, matchesFind } from "../src/renderer/patching/source";
import {
    BLOCKED_GROUP, createReplyTracker, filterMessages, filterVoiceStates, hiddenKind, IGNORED_GROUP, isHiddenUser, PATCHES, REPLY_TYPE, repliesToHidden,
    shouldHideMemberRow, shouldHideMessage,
} from "../plugins/hide-blocked/filter";
import type { HideOptions, Lookups, MessageLike, RelationshipLike } from "../plugins/hide-blocked/filter";

// Verbatim from Discord's web build (test-results/chunks), trimmed to the patched spots
const SOURCES = {
    // Discord's grouping verdict (module 247933, same as the stream builder)
    collapse: 'function eg(e,t,n){if(Q.M.NON_COLLAPSIBLE.has(t.type));else if(t.hasFlag(eu.pr7.HIDDEN_SUSPENDED_USER))return eu.TZK.MESSAGE_GROUP_SUSPENDED_USER;else if(t.blocked)return eu.TZK.MESSAGE_GROUP_BLOCKED;else if(t.ignored)return eu.TZK.MESSAGE_GROUP_IGNORED;else if((0,ei.iJ)(e)&&n)return eu.TZK.MESSAGE_GROUP_SPAMMER;return null}',
    // The channel stream builder, whole
    stream: 'function(e){let t,n,l,{channel:i,messages:s,oldestUnreadMessageId:a,treatSpam:r,summaries:o,selectedSummary:c,selectedConversation:d,pinFirstMessage:u=!1,isTopicalNavEnabled:h=!1}=e,m=[],g=!1,p=null!=a?en.default.extractTimestamp(a):null,A=null;return!u&&i.isForumPost()&&!s.hasMoreBefore&&!s.first()?.isFirstMessageInForumPost(i)&&m.push({type:eu.TZK.FORUM_POST_ACTION_BAR}),s.forEach(e=>{var f,C;let x,E,S;if(u&&e.isFirstMessageInForumPost(i))return;if(null!=o&&o.length>0){let t=en.default.extractTimestamp(e.id);for(let e=0;e<o?.length;e++){if(null==o[e])continue;let n=en.default.extractTimestamp(o[e].startId),l=en.default.extractTimestamp(o[e].endId);if(t>=n&&t<=l){if(A===o[e].id)break;m.push({type:eu.TZK.DIVIDER,content:o[e].topic,contentKey:o[e].id}),A=o[e].id;break}}}let I=(0,et.i$)(e.timestamp,"LL");I!==t&&null==A&&(m.push({type:eu.TZK.DIVIDER,content:I,contentKey:I}),t=I);let _=m[m.length-1],y=null,j=(0,ei.kf)(e);g=g||j;let b=eg(i,e,j&&r);(null!==b&&([y,_]=(E=f=_,null==f||f.type!==b?(x={type:b,content:[],key:e.id},m.push(x)):E=(x=f).content[x.content.length-1],[x,E])),a===e.id&&null!=p)?(null!=_&&_.type===eu.TZK.DIVIDER?_.unreadId=e.id:null!==y?(C=y,e.isFirstMessageInForumPost(i)||C.content.push({type:eu.TZK.DIVIDER,unreadId:e.id}),C.hasUnread=!0):e.isFirstMessageInForumPost(i)||m.push({type:eu.TZK.DIVIDER,unreadId:e.id}),p=null):null!=p&&en.default.extractTimestamp(e.id)>p&&(e.isFirstMessageInForumPost(i)||m.push({type:eu.TZK.DIVIDER,unreadId:e.id}),p=null);let N=null!=(S=function(e,t){if(eh.get(t.id)===e.id)return em(e,t.id);if(null==e.applicationId||!(0,ea.Lt)(e.flags,eu.pr7.SENT_BY_SOCIAL_LAYER_INTEGRATION)||!t.isDM()||e.author.id===eo.default.getId()||null!=e.activity||(0,ea.Lt)(t.recipientFlags??0,es.o.DISMISSED_IN_GAME_MESSAGE_NUX)||eh.has(t.id))return null;let n=em(e,t.id);eh.set(t.id,e.id);let l=(0,ea.lA)(t.recipientFlags??0,es.o.DISMISSED_IN_GAME_MESSAGE_NUX,!0);return er.A.updatePrivateChannelRecipientFlags(t.id,l),n}(e,i))?{message:S,position:"before"}:null;null!=N&&"before"===N.position&&m.push({type:eu.TZK.MESSAGE,content:N.message,groupId:N.message.id});let T=_?.type===eu.TZK.MESSAGE?l:_;(0,el.l)(i,T,e)&&(n=e.id);let v={type:e.type===eu.lAJ.THREAD_STARTER_MESSAGE?eu.TZK.THREAD_STARTER_MESSAGE:eu.TZK.MESSAGE,content:e,groupId:n};n===e.id&&(l=v);let{jumpSequenceId:M,jumpFlash:R,jumpTargetId:D}=s;R&&e.id===D&&null!=M&&(v.flashKey=M),s.jumpTargetId===e.id&&(v.jumpTarget=!0),null!=c&&e.id===c.startId&&c.count>1&&m.push({type:eu.TZK.DIVIDER,content:c.topic,contentKey:c.startId,isSummaryDivider:!0}),h&&null!=d&&e.id===d.startMessageId&&d.messageCount>1&&m.push({type:eu.TZK.DIVIDER,content:d.title,contentKey:`conv-start-${d.id}`,isConversationChannelHeader:!0}),null!==y?(y.content.push(v),v.jumpTarget&&(y.hasJumpTarget=!0)):m.push(v),e.isFirstMessageInForumPost(i)&&m.push({type:eu.TZK.FORUM_POST_ACTION_BAR}),null!=N&&"after"===N.position&&m.push({type:eu.TZK.MESSAGE,content:N.message,groupId:N.message.id}),null!=c&&e.id===c.endId&&c.count>1&&m.push({type:eu.TZK.DIVIDER,contentKey:c.endId,isSummaryDivider:!0})}),g&&(0,ei.iJ)(i)&&ee.trackExposure({location:"416cc9_1"}),m}',
    // The memo around it: its dependency list and what the hook returns
    streamDeps: 'function x(){let f=r.useMemo(()=>0,[l,e,i,s,d,u,g,p,a,A,m]);return{messages:l,channelStream:f,oldestUnreadMessageId:i,location:"416cc9_1"}}',
    // The same memo in Discord's October 2026 build: one dependency fewer
    streamDepsShort: 'function x(){let f=r.useMemo(()=>0,[i,e,s,a,h,m,g,p,o,A]);return{messages:i,channelStream:f,oldestUnreadMessageId:s,location:"416cc9_1"}}',
    // Member list renderRow, both builds in the cache (web.js and 65b5f44f361ff344.js)
    memberList: 'class eB{getFirstApplicationIdOccurrences=()=>null;renderRow=e=>{let{section:t,row:n,rowIndex:r}=e,{channel:a}=this.props,s=this.getRowProps(e);if(null!=s){if(s.type===$.S9.MEMBER&&"user"in s){let{colorString:e,colorStrings:t,colorRoleId:n,user:l,status:o,isOwner:d,isMobileOnline:c,isVROnline:u,nick:_,activities:E,applicationStream:A,premiumSince:h}=s;return(0,i.jsx)(ex,{colorString:e,colorStrings:t,colorRoleId:n,user:l,status:o,isOwner:d,nick:_,activities:E,applicationStream:A,channel:a,guildId:a.guild_id,premiumSince:h,isMobileOnline:c,isVROnline:u,index:r},`member-${s.user.id}`)}}return"other"}}',
    memberListOld: 'class eF{getFirstApplicationIdOccurrences=()=>null;renderRow=e=>{let{section:t,row:n,rowIndex:i}=e,{channel:s}=this.props,r=this.getRowProps(e);if(null!=r){if(r.type===Z.S9.MEMBER&&"user"in r){let{colorString:e,colorStrings:t,colorRoleId:n,user:a,status:o,isOwner:u,isMobileOnline:c,isVROnline:d,nick:h,activities:m,applicationStream:f,premiumSince:p}=r;return(0,l.jsx)(eU,{colorString:e,colorStrings:t,colorRoleId:n,user:a,status:o,isOwner:u,nick:h,activities:m,applicationStream:f,channel:s,guildId:s.guild_id,premiumSince:p,isMobileOnline:c,isVROnline:d,index:i},`member-${r.user.id}`)}}return"other"}}',
    // Users under a voice channel in the channel list
    voiceUsers: 'function(){k.displayName="ConnectedVoiceUser";let w=[],R=function(e){let{allowPreviews:t=!0,allowDragging:i=!0,channel:s,voiceStates:u,collapsed:o,collapsedMax:c=6,tabIndex:A,numAudience:g,withGuildIcon:h=!1,className:I,children:x,isThread:E=!1}=e,[C,j]=l.useState(null),b=l.useRef(null),T=(0,v.$n)(s.id,u??w);return T};return R}',
};

const SELF = "HB";

function applyPatch(patch: SourcePatch, code: string, only?: number) {
    expect(matchesFind(code, patch.find)).toBe(true);
    let next = code;
    const replacements = ([] as Replacement[]).concat(patch.replace);
    for (const [index, r] of replacements.entries()) {
        if (only != null && index !== only) continue;
        const before = next;
        next = next.replace(canonicalizeMatch(r.match) as RegExp, (r.with as string).replaceAll("$self", SELF));
        expect(next).not.toBe(before);
    }
    return next;
}

const ALL: HideOptions = { active: true, ignored: true, replies: false };

function rel(blocked: string[] = [], ignored: string[] = []): RelationshipLike {
    return {
        isBlocked: id => blocked.includes(id!),
        isIgnored: id => !blocked.includes(id!) && ignored.includes(id!),
        isBlockedForMessage: m => blocked.includes(m.author?.id!),
        isIgnoredForMessage: m => !blocked.includes(m.author?.id!) && ignored.includes(m.author?.id!),
    };
}

describe("hide blocked: decisions", () => {
    test("blocked wins over ignored, ignored only when asked, stale records fall back to the store", () => {
        const r = rel(["b"], ["i"]);
        expect(hiddenKind({ author: { id: "b" } }, r, ALL)).toBe("blocked");
        expect(hiddenKind({ author: { id: "i" } }, r, ALL)).toBe("ignored");
        expect(hiddenKind({ author: { id: "i" } }, r, { ignored: false })).toBe(null);
        expect(hiddenKind({ author: { id: "x" } }, r, ALL)).toBe(null);
        expect(hiddenKind({ author: { id: "x" }, blocked: true }, undefined, ALL)).toBe("blocked");
        expect(hiddenKind({ author: { id: "x" }, ignored: true }, undefined, ALL)).toBe("ignored");
        expect(hiddenKind(null, r, ALL)).toBe(null);
        // A throwing store never breaks rendering
        expect(hiddenKind({ author: { id: "x" } }, { isBlocked: () => { throw new Error("nope"); } }, ALL)).toBe(null);
    });

    test("users: member list rows and voice states", () => {
        const r = rel(["b"], ["i"]);
        expect(isHiddenUser("b", r, ALL)).toBe(true);
        expect(isHiddenUser("i", r, { active: true, ignored: false })).toBe(false);
        expect(isHiddenUser("b", r, { active: false, ignored: true })).toBe(false);
        expect(isHiddenUser(null, r, ALL)).toBe(false);
        expect(shouldHideMemberRow({ type: "MEMBER", user: { id: "b" } }, r, ALL)).toBe(true);
        expect(shouldHideMemberRow({ type: "GROUP", id: "online" }, r, ALL)).toBe(false);
        expect(shouldHideMemberRow(undefined, r, ALL)).toBe(false);

        const states = [{ user: { id: "a" } }, { user: { id: "b" } }, { user: { id: "i" } }];
        expect(filterVoiceStates(states, r, ALL).map(s => s.user.id)).toEqual(["a"]);
        const clean = [{ user: { id: "a" } }];
        expect(filterVoiceStates(clean, r, ALL)).toBe(clean);
        expect(filterVoiceStates(states, r, { active: false, ignored: true })).toBe(states);
    });

    test("replies: only real replies whose loaded target is hidden", () => {
        const r = rel(["b"]);
        const loaded: Record<string, MessageLike> = { m1: { id: "m1", author: { id: "b" } }, m2: { id: "m2", author: { id: "a" } } };
        const lookups: Lookups = { relationships: r, referenced: ref => ({ message: loaded[ref.message_id!] }) };
        const reply = (to: string, type = REPLY_TYPE): MessageLike => ({ type, author: { id: "a" }, messageReference: { channel_id: "c", message_id: to } });
        expect(repliesToHidden(reply("m1"), lookups, ALL)).toBe(true);
        expect(repliesToHidden(reply("m2"), lookups, ALL)).toBe(false);
        expect(repliesToHidden(reply("gone"), lookups, ALL)).toBe(false);
        expect(repliesToHidden(reply("m1", 0), lookups, ALL)).toBe(false); // forward, not a reply
        expect(repliesToHidden(reply("m1"), { relationships: r }, ALL)).toBe(false);

        // The reply itself is kept unless asked: Discord already shows "Blocked message" in its quote
        expect(shouldHideMessage(reply("m1"), null, lookups, ALL)).toBe(false);
        expect(shouldHideMessage(reply("m1"), null, lookups, { ...ALL, replies: true })).toBe(true);
    });

    test("messages follow Discord's grouping verdict", () => {
        const lookups: Lookups = {};
        const m = { author: { id: "x" } };
        expect(shouldHideMessage(m, BLOCKED_GROUP, lookups, ALL)).toBe(true);
        expect(shouldHideMessage(m, IGNORED_GROUP, lookups, ALL)).toBe(true);
        expect(shouldHideMessage(m, IGNORED_GROUP, lookups, { ...ALL, ignored: false })).toBe(false);
        expect(shouldHideMessage(m, "MESSAGE_GROUP_SUSPENDED_USER", lookups, ALL)).toBe(false);
        expect(shouldHideMessage(m, "MESSAGE_GROUP_SPAMMER", lookups, ALL)).toBe(false);
        expect(shouldHideMessage(m, null, lookups, ALL)).toBe(false);
        expect(shouldHideMessage(m, BLOCKED_GROUP, lookups, { ...ALL, active: false })).toBe(false);
    });

    test("filtering a list keeps order and drops exactly the hidden ones", () => {
        const r = rel(["b"], ["i"]);
        const msgs = ["a", "b", "a", "i", "c"].map((id, n) => ({ id: String(n), author: { id } }));
        const collapse = (m: MessageLike) => (hiddenKind(m, r, { ignored: true }) === "blocked" ? BLOCKED_GROUP : hiddenKind(m, r, { ignored: true }) ? IGNORED_GROUP : null);
        expect(filterMessages(msgs, collapse, { relationships: r }, ALL).map(m => m.id)).toEqual(["0", "2", "4"]);
        expect(filterMessages(msgs, collapse, { relationships: r }, { ...ALL, ignored: false }).map(m => m.id)).toEqual(["0", "2", "3", "4"]);
        expect(filterMessages(msgs, collapse, { relationships: r }, { ...ALL, active: false })).toHaveLength(5);
    });
});

// Running Discord's real stream builder, patched, against a fake channel

const TZK = Object.fromEntries(["FORUM_POST_ACTION_BAR", "DIVIDER", "MESSAGE", "THREAD_STARTER_MESSAGE", "MESSAGE_GROUP_BLOCKED", "MESSAGE_GROUP_IGNORED", "MESSAGE_GROUP_SPAMMER", "MESSAGE_GROUP_SUSPENDED_USER"].map(k => [k, k]));

interface FakeMessage extends MessageLike {
    id: string;
    timestamp: Date;
    hasFlag(): boolean;
    isFirstMessageInForumPost(): boolean;
}

function msg(id: number, author: string, day = 1, extra: Partial<FakeMessage> = {}): FakeMessage {
    return {
        id: String(id), type: 0, author: { id: author }, timestamp: new Date(Date.UTC(2026, 0, day, 12, 0, id)),
        hasFlag: () => false, isFirstMessageInForumPost: () => false, ...extra,
    };
}

function buildStream(patched: boolean, messages: FakeMessage[], opts: { unread?: string; self?: unknown; jumpTargetId?: string; } = {}) {
    const code = patched ? applyPatch(PATCHES.stream, SOURCES.stream, 0) : SOURCES.stream;
    const env = {
        eu: { TZK, lAJ: { THREAD_STARTER_MESSAGE: 21 }, pr7: { HIDDEN_SUSPENDED_USER: 1, SENT_BY_SOCIAL_LAYER_INTEGRATION: 2 } },
        en: { default: { extractTimestamp: (id: string) => Number(id) } },
        et: { i$: (d: Date) => d.toISOString().slice(0, 10) },
        ei: { kf: () => false, iJ: () => false },
        // Same author as the previous item's group start and still a message: same group
        el: { l: (_c: unknown, prev: any, m: FakeMessage) => prev == null || prev.type !== "MESSAGE" || prev.content.author.id !== m.author!.id },
        ee: { trackExposure() { } },
        eh: new Map(), em: null, ea: null, es: null, er: null, eo: null,
        Q: { M: { NON_COLLAPSIBLE: new Set([24]) } },
    };
    const names = Object.keys(env);
    const builder = new Function(...names, SELF, `${SOURCES.collapse};return(${code})`)(...Object.values(env), opts.self);
    const list = Object.assign([...messages], { hasMoreBefore: true, first() { return messages[0]; }, jumpTargetId: opts.jumpTargetId });
    const channel = { id: "c", isForumPost: () => false, isDM: () => false };
    return builder({ channel, messages: list, oldestUnreadMessageId: opts.unread ?? null, treatSpam: false });
}

/** A readable outline: "date", "unread", "blocked(n)", or "author:id" with "+" for group continuations */
function outline(stream: any[]) {
    return stream.map(item => {
        if (item.type === "DIVIDER") return item.unreadId != null && item.content == null ? "unread" : item.unreadId != null ? `date+unread` : "date";
        if (item.type === "MESSAGE") return `${item.groupId === item.content.id ? "" : "+"}${item.content.author.id}:${item.content.id}`;
        return `${item.type.replace("MESSAGE_GROUP_", "").toLowerCase()}(${item.content.length})`;
    });
}

function makeSelf(options: HideOptions, lookups: Lookups = {}) {
    let versionCalls = 0;
    return {
        hide: (m: MessageLike, collapse: unknown) => shouldHideMessage(m, collapse, lookups, options),
        useVersion: () => ++versionCalls,
        get versionCalls() { return versionCalls; },
    };
}

describe("hide blocked: reply tracker", () => {
    test("a referenced-message change only counts when a message the stream asked about changed", () => {
        const store = new Map<string, { message?: MessageLike | null; }>();
        const tracker = createReplyTracker(ref => store.get(ref.message_id!));
        const ref = { channel_id: "c", message_id: "1" };
        // Asked while it wasn't loaded yet
        expect(tracker.referenced(ref)).toBeUndefined();
        // Something else anywhere loaded: nothing to rebuild
        store.set("2", { message: { id: "2" } });
        expect(tracker.changed()).toBe(false);
        // The one asked about loaded: rebuild once
        const loaded = { message: { id: "1", author: { id: "blocked" } } };
        store.set("1", loaded);
        expect(tracker.changed()).toBe(true);
        expect(tracker.changed()).toBe(false);
        // Deleted: rebuild again
        store.delete("1");
        expect(tracker.changed()).toBe(true);
    });

    test("stays bounded", () => {
        const tracker = createReplyTracker(() => undefined, 3);
        for (let i = 0; i < 10; i++) tracker.referenced({ channel_id: "c", message_id: String(i) });
        expect(tracker.size).toBeLessThanOrEqual(3);
    });
});

describe("hide blocked: channel stream patch", () => {
    const blocked = (m: FakeMessage) => ({ ...m, blocked: true });

    test("unpatched, Discord collapses blocked messages into a row", () => {
        const s = buildStream(false, [msg(1, "a"), blocked(msg(2, "b")), msg(3, "a")]);
        expect(outline(s)).toEqual(["date", "a:1", "blocked(1)", "a:3"]);
    });

    test("patched, blocked messages are gone and the author around them keeps one group", () => {
        const s = buildStream(true, [msg(1, "a"), blocked(msg(2, "b")), msg(3, "a")], { self: makeSelf(ALL) });
        expect(outline(s)).toEqual(["date", "a:1", "+a:3"]);
    });

    test("no date divider for a day that only had blocked messages", () => {
        const s = buildStream(true, [msg(1, "a", 1), blocked(msg(2, "b", 2)), blocked(msg(3, "b", 2)), msg(4, "a", 3)], { self: makeSelf(ALL) });
        expect(outline(s)).toEqual(["date", "a:1", "date", "a:4"]);
        expect(s.filter((i: any) => i.type === "DIVIDER").map((i: any) => i.content)).toEqual(["2026-01-01", "2026-01-03"]);
    });

    test("the unread divider moves to the first message shown, and vanishes if nothing new is shown", () => {
        const moved = buildStream(true, [msg(1, "a"), blocked(msg(2, "b")), msg(3, "c")], { unread: "2", self: makeSelf(ALL) });
        expect(outline(moved)).toEqual(["date", "a:1", "unread", "c:3"]);
        const none = buildStream(true, [msg(1, "a"), blocked(msg(2, "b"))], { unread: "2", self: makeSelf(ALL) });
        expect(outline(none)).toEqual(["date", "a:1"]);
    });

    test("ignored users follow the setting; suspended users stay collapsed as Discord does", () => {
        const msgs = [msg(1, "a"), msg(2, "i", 1, { ignored: true }), msg(3, "s", 1, { hasFlag: () => true })];
        expect(outline(buildStream(true, msgs, { self: makeSelf(ALL) }))).toEqual(["date", "a:1", "suspended_user(1)"]);
        expect(outline(buildStream(true, msgs, { self: makeSelf({ ...ALL, ignored: false }) }))).toEqual(["date", "a:1", "ignored(1)", "suspended_user(1)"]);
    });

    test("replies to a blocked message: kept by default, hidden when asked", () => {
        const target: MessageLike = { id: "2", author: { id: "b" }, blocked: true };
        const lookups: Lookups = { relationships: rel(["b"]), referenced: ref => (ref.message_id === "2" ? { message: target } : null) };
        const msgs = [msg(1, "a"), blocked(msg(2, "b")), msg(3, "c", 1, { type: REPLY_TYPE, messageReference: { channel_id: "c", message_id: "2" } })];
        expect(outline(buildStream(true, msgs, { self: makeSelf(ALL, lookups) }))).toEqual(["date", "a:1", "c:3"]);
        expect(outline(buildStream(true, msgs, { self: makeSelf({ ...ALL, replies: true }, lookups) }))).toEqual(["date", "a:1"]);
    });

    test("turned off, or with the plugin gone, the patched builder is Discord's", () => {
        const msgs = [msg(1, "a"), blocked(msg(2, "b")), msg(3, "a")];
        const expected = outline(buildStream(false, msgs));
        expect(outline(buildStream(true, msgs, { self: makeSelf({ ...ALL, active: false }) }))).toEqual(expected);
        expect(outline(buildStream(true, msgs, { self: undefined }))).toEqual(expected);
    });

    test("jump targets on shown messages are kept", () => {
        const s = buildStream(true, [msg(1, "a"), blocked(msg(2, "b")), msg(3, "c")], { self: makeSelf(ALL), jumpTargetId: "3" });
        expect(s.find((i: any) => i.content?.id === "3").jumpTarget).toBe(true);
    });

    test("the stream memo also depends on our version", () => {
        const code = applyPatch(PATCHES.stream, SOURCES.streamDeps, 1);
        expect(code).toContain("[l,e,i,s,d,u,g,p,a,A,m,HB?.useVersion?.()]);return{messages:l,channelStream:f,");
        let deps: unknown[] = [];
        const self = makeSelf(ALL);
        const run = new Function("r", "l", "e", "i", "s", "d", "u", "g", "p", "a", "A", "m", SELF, `return(${code})()`);
        run({ useMemo: (_: unknown, d: unknown[]) => (deps = d, 0) }, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, self);
        expect(deps).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 1]);
        run({ useMemo: (_: unknown, d: unknown[]) => (deps = d, 0) }, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, undefined);
        expect(deps).toHaveLength(12);
    });

    test("the version is added however many dependencies the memo has", () => {
        const code = applyPatch(PATCHES.stream, SOURCES.streamDepsShort, 1);
        expect(code).toContain("[i,e,s,a,h,m,g,p,o,A,HB?.useVersion?.()]);return{messages:i,channelStream:f,");
    });
});

describe("hide blocked: member list and voice patches", () => {
    for (const key of ["memberList", "memberListOld"] as const) {
        test(`member list (${key}): a hidden member's row renders nothing`, () => {
            const code = applyPatch(PATCHES.memberList, SOURCES[key]);
            const r = rel(["b"]);
            const self = { hideMember: (row: unknown) => shouldHideMemberRow(row, r, ALL) };
            const jsx = { jsx: (_: unknown, props: any, k: string) => ({ props, key: k }) };
            const List = new Function("$", "Z", "i", "l", "ex", "eU", SELF, `return ${code}`)({ S9: { MEMBER: "MEMBER" } }, { S9: { MEMBER: "MEMBER" } }, jsx, jsx, "Member", "Member", self);
            const list = new List();
            const rows: Record<number, unknown> = { 0: { type: "MEMBER", user: { id: "a" } }, 1: { type: "MEMBER", user: { id: "b" } }, 2: { type: "GROUP" } };
            list.props = { channel: { guild_id: "g" } };
            list.getRowProps = (e: { row: number; }) => rows[e.row];
            expect(list.renderRow({ section: 0, row: 0, rowIndex: 0 }).key).toBe("member-a");
            expect(list.renderRow({ section: 0, row: 1, rowIndex: 1 })).toBe(null);
            expect(list.renderRow({ section: 0, row: 2, rowIndex: 2 })).toBe("other");
        });
    }

    test("voice users: hidden users are filtered before Discord's sorting hook", () => {
        const code = applyPatch(PATCHES.voiceUsers, SOURCES.voiceUsers);
        expect(code).toContain("T=(0,v.$n)(s.id,(HB?.useVoiceStates?.(u??w)??u??w))");
        const r = rel(["b"]);
        const env = { k: {}, l: { useState: (x: unknown) => [x, () => { }], useRef: (x: unknown) => ({ current: x }) }, v: { $n: (_id: string, states: unknown[]) => states } };
        const make = (self: unknown) => new Function("k", "l", "v", SELF, `return(${code})()`)(env.k, env.l, env.v, self);
        const states = [{ user: { id: "a" } }, { user: { id: "b" } }];
        const self = { useVoiceStates: (s: any[]) => filterVoiceStates(s, r, ALL) };
        expect(make(self)({ channel: { id: "c" }, voiceStates: states }).map((s: any) => s.user.id)).toEqual(["a"]);
        expect(make(undefined)({ channel: { id: "c" }, voiceStates: states })).toBe(states);
        expect(make(self)({ channel: { id: "c" } })).toEqual([]);
    });
});

// Against the whole cached build, when it's there

const CHUNKS = join(import.meta.dir, "..", "test-results", "chunks");
const haveChunks = existsSync(CHUNKS);

describe.if(haveChunks)("hide blocked: cached Discord build", () => {
    const files = haveChunks ? readdirSync(CHUNKS).filter(f => f.endsWith(".js")).map(f => ({ f, code: readFileSync(join(CHUNKS, f), "utf8") })) : [];

    function count(code: string, match: string | RegExp) {
        const re = canonicalizeMatch(match) as RegExp;
        return [...code.matchAll(new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g"))].length;
    }

    /** Ids of the webpack modules (`123456(e,t,n){...}` in a chunk) whose source contains `find` */
    function modulesWith(code: string, find: string) {
        const starts = [...code.matchAll(/[,{](\d+)\((?:\w+(?:,\w+)*)?\)\{/g)].map(m => [m.index!, m[1]] as const);
        const ids = new Set<string>();
        for (let at = code.indexOf(find); at !== -1; at = code.indexOf(find, at + 1)) {
            let id = "?";
            for (const [start, mod] of starts) if (start < at) id = mod; else break;
            ids.add(id);
        }
        return [...ids];
    }

    for (const [name, patch] of Object.entries(PATCHES)) {
        test(`${name}: every chunk with the find string has each replacement exactly once`, () => {
            const hits = files.filter(({ code }) => matchesFind(code, patch.find));
            expect(hits.length).toBeGreaterThan(0);
            for (const { f, code } of hits) {
                // One module per chunk (the member list ships in two builds of the same module)
                expect(`${f}:${modulesWith(code, patch.find as string).length}`).toBe(`${f}:1`);
                for (const r of ([] as Replacement[]).concat(patch.replace)) expect(`${f}:${count(code, r.match)}`).toBe(`${f}:1`);
            }
        });
    }
});

import { filterAction, filterDmIds } from "../plugins/hide-blocked/filter";

describe("hide blocked: everything else (from Erase Blocked Users)", () => {
    const hidden = (id: string | undefined) => id === "b";
    const on = { active: true, ignored: true, replies: false, voice: true };

    test("their reactions and Mentions-inbox entries are dropped, others' kept", () => {
        expect(filterAction({ type: "MESSAGE_REACTION_ADD", userId: "b" }, hidden, on)).toBeNull();
        const keep = { type: "MESSAGE_REACTION_ADD", userId: "a" };
        expect(filterAction(keep, hidden, on)).toBe(keep);
        const inbox = filterAction({ type: "LOAD_RECENT_MENTIONS_SUCCESS", messages: [{ author: { id: "a" } }, { author: { id: "b" } }] }, hidden, on);
        expect(inbox.messages).toEqual([{ author: { id: "a" } }]);
    });

    test("only the removes of their dropped reactions are dropped, so others' counts stay right", () => {
        const dropped = new Set<string>();
        const thumbs = { channelId: "c", messageId: "m", emoji: { id: null, name: "👍" } };
        expect(filterAction({ type: "MESSAGE_REACTION_ADD", userId: "b", ...thumbs }, hidden, on, undefined, dropped)).toBeNull();
        // Their remove of the dropped add would take a's 👍 off the count
        expect(filterAction({ type: "MESSAGE_REACTION_REMOVE", userId: "b", ...thumbs }, hidden, on, undefined, dropped)).toBeNull();
        expect(dropped.size).toBe(0);
        // A reaction of theirs that came with the message was counted: removing it goes through
        const loaded = { type: "MESSAGE_REACTION_REMOVE", userId: "b", ...thumbs };
        expect(filterAction(loaded, hidden, on, undefined, dropped)).toBe(loaded);
        // A super reaction is its own reaction
        filterAction({ type: "MESSAGE_REACTION_ADD", userId: "b", ...thumbs, burst: true, reactionType: 1 }, hidden, on, undefined, dropped);
        const normal = { type: "MESSAGE_REACTION_REMOVE", userId: "b", ...thumbs, reactionType: 0 };
        expect(filterAction(normal, hidden, on, undefined, dropped)).toBe(normal);
        const other = { type: "MESSAGE_REACTION_REMOVE", userId: "a", ...thumbs };
        expect(filterAction(other, hidden, on, undefined, dropped)).toBe(other);
    });

    test("voice: their states, speaking and soundboard go, and each dropped state is remembered", () => {
        const seen: unknown[] = [];
        const out = filterAction({ type: "VOICE_STATE_UPDATES", guildId: "g", voiceStates: [{ userId: "a", channelId: "c" }, { userId: "b", channelId: "c" }] }, hidden, on, s => seen.push(s));
        expect(out.voiceStates).toEqual([{ userId: "a", channelId: "c" }]);
        expect(seen).toEqual([{ userId: "b", channelId: "c" }]);
        expect(filterAction({ type: "SPEAKING", userId: "b" }, hidden, on)).toBeNull();
        expect(filterAction({ type: "VOICE_CHANNEL_EFFECT_SEND", userId: "b" }, hidden, on)).toBeNull();
    });

    test("with voice off, or the plugin off, events pass untouched", () => {
        const speaking = { type: "SPEAKING", userId: "b" };
        expect(filterAction(speaking, hidden, { ...on, voice: false })).toBe(speaking);
        const reaction = { type: "MESSAGE_REACTION_ADD", userId: "b" };
        expect(filterAction(reaction, hidden, { ...on, active: false })).toBe(reaction);
    });

    test("DMs with them leave the list; the same array comes back when nothing changes", () => {
        const ids = ["1", "2", "3"];
        const recipient = (id: string) => ({ 1: "a", 2: "b", 3: undefined } as Record<string, string | undefined>)[id];
        expect(filterDmIds(ids, recipient, hidden)).toEqual(["1", "3"]);
        expect(filterDmIds(["1", "3"], recipient, hidden)).toEqual(["1", "3"]);
        const same = ["1"];
        expect(filterDmIds(same, recipient, hidden)).toBe(same);
    });
});
