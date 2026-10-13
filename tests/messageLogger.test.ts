import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

import { filters } from "../src/renderer/webpack/find";
import { attachmentsToSave, MAX_SAVED_BYTES, MediaCache, mediaKind, MessageLog, removedAttachments, shouldLog } from "../plugins/message-logger/log";

const v = (content: string, timestamp = 1) => ({ content, timestamp });

describe("message logger log", () => {
    test("marks deleted messages and keeps their edit history", () => {
        const log = new MessageLog();
        log.addEdit("c", "1", v("first"));
        log.markDeleted("c", "1", 5);
        expect(log.get("c", "1")).toEqual({ channelId: "c", id: "1", deletedAt: 5, edits: [v("first")] });
        expect(log.isDeleted("c", "1")).toBe(true);
        expect(log.isDeleted("c", "2")).toBe(false);
    });

    test("a second delete of the same message changes nothing", () => {
        const log = new MessageLog();
        log.markDeleted("c", "1", 5);
        const entry = log.get("c", "1");
        const version = log.version;
        expect(log.markDeleted("c", "1", 9)).toEqual([]);
        expect(log.get("c", "1")).toBe(entry);
        expect(log.version).toBe(version);
    });

    test("entries are replaced, never mutated, so they work as React snapshots", () => {
        const log = new MessageLog();
        log.addEdit("c", "1", v("a"));
        const before = log.get("c", "1")!;
        log.addEdit("c", "1", v("b"));
        expect(before.edits).toEqual([v("a")]);
        expect(log.get("c", "1")).not.toBe(before);
        expect(log.get("c", "1")!.edits).toEqual([v("a"), v("b")]);
    });

    test("caps messages per channel, oldest activity first, and reports evicted deleted messages", () => {
        const log = new MessageLog({ perChannel: 2 });
        log.markDeleted("c", "1");
        log.addEdit("c", "2", v("x"));
        // Touching 1 again makes 2 the oldest
        log.addEdit("c", "1", v("y"));
        expect(log.addEdit("c", "3", v("z"))).toEqual([]);
        expect(log.get("c", "2")).toBeUndefined();
        expect(log.markDeleted("c", "4")).toEqual([{ channelId: "c", id: "1" }]);
        expect([...log.deleted()]).toEqual([["c", ["4"]]]);
        expect(log.counts()).toEqual({ deleted: 1, edited: 1, channels: 1 });
    });

    test("caps channels and reports their deleted messages", () => {
        const log = new MessageLog({ channels: 2 });
        log.markDeleted("a", "1");
        log.markDeleted("b", "2");
        expect(log.markDeleted("c", "3")).toEqual([{ channelId: "a", id: "1" }]);
        expect(log.get("a", "1")).toBeUndefined();
        expect(log.counts().channels).toBe(2);
    });

    test("caps edits per message but always keeps the original", () => {
        const log = new MessageLog({ edits: 3 });
        for (const content of ["original", "e1", "e2", "e3", "e4"]) log.addEdit("c", "1", v(content));
        expect(log.get("c", "1")!.edits.map(e => e.content)).toEqual(["original", "e3", "e4"]);
    });

    test("lowering limits trims immediately", () => {
        const log = new MessageLog({ perChannel: 10, edits: 10 });
        for (let i = 0; i < 5; i++) log.markDeleted("c", String(i));
        for (const content of ["o", "a", "b"]) log.addEdit("c", "4", v(content));
        const evicted = log.setLimits({ perChannel: 2, edits: 2 });
        expect(evicted).toEqual([0, 1, 2].map(i => ({ channelId: "c", id: String(i) })));
        expect(log.get("c", "4")!.edits.map(e => e.content)).toEqual(["o", "b"]);
    });

    test("clear forgets everything and returns what was kept deleted", () => {
        const log = new MessageLog();
        log.markDeleted("a", "1");
        log.addEdit("b", "2", v("x"));
        expect(log.clear()).toEqual([{ channelId: "a", id: "1" }]);
        expect(log.counts()).toEqual({ deleted: 0, edited: 0, channels: 0 });
    });

    test("clearChannels forgets only those channels and returns what was kept deleted in them", () => {
        const log = new MessageLog();
        log.markDeleted("a", "1");
        log.addEdit("a", "2", v("x"));
        log.markDeleted("b", "3");
        log.addEdit("c", "4", v("y"));
        let calls = 0;
        log.subscribe(() => calls++);

        expect(log.counts(["a", "c", "missing"])).toEqual({ deleted: 1, edited: 2, channels: 2 });
        expect(log.clearChannels(["a", "c", "missing"])).toEqual([{ channelId: "a", id: "1" }]);
        expect(log.channelIds()).toEqual(["b"]);
        expect(log.counts()).toEqual({ deleted: 1, edited: 0, channels: 1 });
        expect(calls).toBe(1);

        expect(log.clearChannels(["a"])).toEqual([]);
        expect(calls).toBe(1);
    });

    test("remove forgets one message and notifies", () => {
        const log = new MessageLog();
        let calls = 0;
        const unsubscribe = log.subscribe(() => calls++);
        log.markDeleted("a", "1");
        log.remove("a", "1");
        log.remove("a", "1");
        unsubscribe();
        log.markDeleted("a", "2");
        expect(calls).toBe(2);
        expect(log.get("a", "1")).toBeUndefined();
    });
});

describe("message logger filters", () => {
    const base = { currentUserId: "me", ignoreSelf: false, ignoreBots: false };

    test("logs ordinary messages", () => {
        expect(shouldLog({ author: { id: "u" }, flags: 0, state: "SENT" }, base)).toBe(true);
    });

    test("never logs ephemeral or unsent messages", () => {
        expect(shouldLog({ author: { id: "u" }, flags: 64 }, base)).toBe(false);
        expect(shouldLog({ author: { id: "u" }, state: "SENDING" }, base)).toBe(false);
        expect(shouldLog({ author: { id: "u" }, state: "SEND_FAILED" }, base)).toBe(false);
    });

    test("ignore own messages and bots", () => {
        expect(shouldLog({ author: { id: "me" } }, base)).toBe(true);
        expect(shouldLog({ author: { id: "me" } }, { ...base, ignoreSelf: true })).toBe(false);
        expect(shouldLog({ author: { id: "me" } }, { ...base, ignoreSelf: true, currentUserId: undefined })).toBe(true);
        expect(shouldLog({ author: { id: "b", bot: true } }, base)).toBe(true);
        expect(shouldLog({ author: { id: "b", bot: true } }, { ...base, ignoreBots: true })).toBe(false);
    });
});

describe("message logger media", () => {
    const att = (id: string, extra: Record<string, unknown> = {}) => ({ id, filename: `${id}.png`, url: `https://cdn.discordapp.com/attachments/1/${id}/${id}.png`, size: 100, ...extra });
    const saved = (key: string, size = 10) => ({ key, name: key, kind: "image" as const, url: `blob:${key}`, size, spoiler: false });

    test("what's worth saving, and what kind it is", () => {
        expect(attachmentsToSave([att("a"), att("big", { size: MAX_SAVED_BYTES + 1 }), { id: "nourl" }]).map(a => a.id)).toEqual(["a"]);
        expect(mediaKind({ content_type: "video/mp4" })).toBe("video");
        expect(mediaKind({ filename: "clip.MOV" })).toBe("video");
        expect(mediaKind({ filename: "voice.ogg" })).toBe("audio");
        expect(mediaKind({ filename: "cat.webp" })).toBe("image");
        expect(mediaKind({ filename: "notes.txt" })).toBe("file");
    });

    test("an edit's removed attachments, only when the edit says what's left", () => {
        expect(removedAttachments([att("a"), att("b")], [att("b")]).map(a => a.id)).toEqual(["a"]);
        expect(removedAttachments([att("a")], undefined)).toEqual([]);
    });

    test("the cache keeps the newest within its size, and hands copies over without evicting them", () => {
        const evicted: string[] = [];
        const cache = new MediaCache<ReturnType<typeof saved>>(25, m => evicted.push(m.key));
        cache.set("a", saved("a"));
        cache.set("b", saved("b"));
        cache.set("c", saved("c"));
        expect(evicted).toEqual(["a"]);
        expect(cache.take("b")?.key).toBe("b");
        expect(cache.size).toBe(10);
        cache.set("huge", saved("huge", 100));
        expect(evicted).toEqual(["a", "huge"]);
        cache.clear();
        expect(evicted).toEqual(["a", "huge", "c"]);
    });

    test("a deleted message keeps its saved copies, and they're let go when it's forgotten", () => {
        const forgotten: string[] = [];
        const log = new MessageLog({ perChannel: 1 }, e => forgotten.push(...(e.media ?? []).map(m => m.key)));
        expect(log.addMedia("c", "1", [saved("x")])).toBe(false);
        log.markDeleted("c", "1", 5);
        expect(log.addMedia("c", "1", [saved("x"), saved("x")])).toBe(true);
        expect(log.get("c", "1")?.media?.map(m => m.key)).toEqual(["x"]);
        log.markDeleted("c", "2", 6);
        expect(forgotten).toEqual(["x"]);
    });

    test("an edit's removed attachments arrive with that version", () => {
        const log = new MessageLog();
        log.addEdit("c", "1", v("with a picture", 7));
        expect(log.addEditMedia("c", "1", 7, [saved("p")])).toBe(true);
        expect(log.addEditMedia("c", "1", 8, [saved("q")])).toBe(false);
        expect(log.mediaOf("c", "1").map(m => m.key)).toEqual(["p"]);
    });
});

// Verbatim from Discord's web build (2026-10-13), both in the chat's lazy chunks: the accessories renderer
// (embeds, attachments...) the plugin hooks, a chat row calling it through its module's export, and the
// hook that renders a message's content, which old versions go through
const DISCORD = {
    accessories: "function r(e){let{channelMessageProps:{message:t,channel:n,compact:a=!1},hasSpoilerEmbeds:o,hasBailedAst:d,handleContextMenu:c,isInteracting:u,isAutomodBlockedMessage:m,isMessageSnapshot:h,renderThreadAccessory:g,renderSuppressEmbeds:p,renderReactions:A,hideInviteEmbedBanner:x,hideActivityInvite:f,disableComponentInteractivity:I,className:E}=e;return m?null:(0,i.jsx)(l.A,{message:t,children:(0,i.jsx)(s.Ay,{renderAccessories:r,className:E,isInteracting:u,message:t,channel:n,compact:a,hasSpoilerEmbeds:o,hasBailedAst:d,isMessageSnapshot:h,onMediaItemContextMenu:c,renderThreadAccessory:g,disableComponentInteractivity:I,renderSuppressEmbeds:p,renderReactions:A,hideInviteEmbedBanner:x,hideActivityInvite:f})})}",
    row: "repliedMessage:b,roleIcon:ea}),childrenAccessories:(0,tv.A)({channelMessageProps:e,hasSpoilerEmbeds:Q,hasBailedAst:ee,handleContextMenu:R,isInteracting:W,isAutomodBlockedMessage:ex,hideInviteEmbedBanner:C,hideA",
    renderedContent: "function b(e,n){let{hideSimpleEmbedContent:b=!0,formatInline:C=!1,noStyleAndInteraction:E=!1,allowHeading:g=!1,allowList:f=!1,allowLinks:k=!1,allowDevLinks:I=!1,previewLinkTarget:S=!1,viewingChannelId:_,postProcessor:y}=n,M=(0,a.I)({location:\"useMessageRenderedContent\"}),[j,v]=d.useState(!1),G=d.useCallback(e=>{e&&v(!0)},[]);return d.useEffect(()=>{v(!1)},[e.content]),d.useMemo(()=>{if(null!=e.customRenderedContent)return e.customRenderedContent;if(e.isUnsupported)return{content:m.intl.string(m.t.sWi5EU),hasSpoilerEmbeds:!1,hasBailedAst:!1};if(e.isCommandType()&&0===e.content.length||e.hasFlag(p.pr7.LOADING))return{content:(0,s.jsx)(c.Ay,{message:e}),hasSpoilerEmbeds:!1,hasBailedAst:!1};if(e.type===p.lAJ.CHANGELOG){let{renderChangelogMessageMarkup:n}=t(550997);return n(e,A,{track:(e,n)=>{o.default.track(e,n)}})}return M.enabled&&null==y?{content:(0,s.jsx)(d.Suspense,{children:(0,s.jsx)(h.O.Provider,{value:{messageId:e.id,channelId:e.channel_id,viewingChannelId:_,guildId:(0,r.U)(e),authorId:e.author?.id,setHasSpoilerEmbeds:G},children:(0,s.jsx)(i.A,{content:e.content,allowJumboEmoji:e.type!==p.lAJ.MEDIA_MENTION_MESSAGE,hideSingleLinkContent:b&&(0,l.k5)(e.embeds)})})}),hasSpoilerEmbeds:j,hasBailedAst:!1}:(0,u.Ay)(e,{hideSimpleEmbedContent:b,formatInline:C,noStyleAndInteraction:E,allowHeading:g,allowList:f,allowLinks:k,allowDevLinks:I,previewLinkTarget:S,viewingChannelId:_,allowGameMentions:!0,postProcessor:y})},[e.content,e.customRenderedContent,e.embeds,e.interaction,e.state,e.type,b,C,E,g,f,k,S,I,_,y,M.enabled,j])}",
};

/** The code a filter in the plugin looks for, read from its source so the test follows the plugin */
const pluginSource = readFileSync(join(import.meta.dir, "../plugins/message-logger/index.tsx"), "utf8");
function pluginFilter(name: string) {
    const args = pluginSource.match(new RegExp(String.raw`const ${name} = filters\.byCode\((.+)\);`))?.[1];
    if (!args) throw new Error(`${name} isn't a filters.byCode(...) in the plugin`);
    return filters.byCode(...(new Function(`return [${args}]`)() as string[]));
}
const fn = (source: string) => new Function(`return ${source}`)() as Function;

describe("message logger finds on Discord's code", () => {
    test("finds the accessories renderer, which every chat row calls through its export", () => {
        expect(pluginFilter("accessoriesFilter")(fn(DISCORD.accessories))).toBe(true);
        expect(pluginFilter("accessoriesFilter")(fn(DISCORD.renderedContent))).toBe(false);
        expect(DISCORD.row).toContain("childrenAccessories:(0,tv.A)({channelMessageProps:e,");
    });

    test("finds Discord's message content renderer", () => {
        expect(pluginFilter("renderedContentFilter")(fn(DISCORD.renderedContent))).toBe(true);
        expect(pluginFilter("renderedContentFilter")(fn(DISCORD.accessories))).toBe(false);
    });
});
