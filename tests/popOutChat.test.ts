import { describe, expect, test } from "bun:test";

import { CALL_CHAT_PATCH, canPopOut, channelOfKey, chatTitle, windowKey } from "../plugins/pop-out-chat/chat";
import { canonicalizeMatch, matchesFind } from "../src/renderer/patching/source";

describe("the call chat patch", () => {
    // Verbatim from Discord's web build of 2026-10-31 (module 518530), up to the header's props
    const source = 'let I=function(e){let{channel:n,guild:t,maxWidth:I}=e,N=(0,u.Ay)(n);l.useEffect(()=>{(0,m.Dr)(s.M.CALL_CHAT_BUTTON_TEXT_IN_VOICE_COACH_MARK,{dismissAction:E.i.AUTO})},[]);let T=l.useCallback(()=>{o.A.updateChatOpen(n.id,!1),C._.safeDispatch(p.jej.FOCUS_CHAT_BUTTON)},[n.id]),_=(0,i.jsx)(g.Ay.Icon,{icon:a.P,tooltip:j.intl.string(j.t.cpT0Cq),onClick:T});return(0,i.jsxs)(A.A,{sidebarType:A.X.CallChatSidebar,maxWidth:I,floatingLayer:f.Ay,children:[(0,i.jsx)(c.A,{channel:n,draftType:x.C.ChannelMessage}),(0,i.jsxs)(g.Ay,{toolbar:_,"aria-label"';

    test("finds the call chat and hands the plugin its channel and toolbar", () => {
        expect(matchesFind(source, CALL_CHAT_PATCH.find)).toBe(true);
        const patched = source.replace(canonicalizeMatch(CALL_CHAT_PATCH.replace.match) as RegExp, CALL_CHAT_PATCH.replace.with.replaceAll("$self", "S"));
        expect(patched).toEndWith('(0,i.jsxs)(g.Ay,{toolbar:S.callChatToolbar(n,_),"aria-label"');
    });
});

const users: Record<string, { username: string; globalName?: string | null; }> = {
    "1": { username: "mell", globalName: "Mell" },
    "2": { username: "xou", globalName: null },
};
const getUser = (id: string) => users[id];

describe("canPopOut", () => {
    test("channels with a chat", () => {
        for (const type of [0, 1, 2, 3, 5, 10, 11, 12, 13]) expect(canPopOut({ id: "10", type })).toBe(true);
    });

    test("forums, media, categories and directories have no chat", () => {
        for (const type of [4, 14, 15, 16]) expect(canPopOut({ id: "10", type })).toBe(false);
    });

    test("anything that isn't a channel", () => {
        expect(canPopOut(undefined)).toBe(false);
        expect(canPopOut(null)).toBe(false);
        expect(canPopOut({ id: "", type: 0 })).toBe(false);
        expect(canPopOut({ id: 10, type: 0 })).toBe(false);
        expect(canPopOut({ id: "10" })).toBe(false);
    });
});

describe("window keys", () => {
    test("Discord's desktop app only opens DISCORD_ windows", () => {
        expect(windowKey("123")).toStartWith("DISCORD_");
    });

    test("round trip", () => {
        expect(channelOfKey(windowKey("123456789"))).toBe("123456789");
    });

    test("other windows aren't ours", () => {
        expect(channelOfKey("DISCORD_CHANNEL_CALL_POPOUT")).toBeUndefined();
        expect(channelOfKey("DISCORD_EVI_CHAT_")).toBeUndefined();
        expect(channelOfKey("DISCORD_EVI_CHAT_abc")).toBeUndefined();
    });
});

describe("chatTitle", () => {
    test("a DM is the other person, display name first", () => {
        expect(chatTitle({ id: "a", type: 1, recipients: ["1"] }, getUser)).toBe("Mell");
        expect(chatTitle({ id: "a", type: 1, recipients: ["2"] }, getUser)).toBe("xou");
        expect(chatTitle({ id: "a", type: 1, recipients: ["9"] }, getUser)).toBe("");
    });

    test("a group is its name, or its members", () => {
        expect(chatTitle({ id: "a", type: 3, name: "moonveil", recipients: ["1", "2"] }, getUser)).toBe("moonveil");
        expect(chatTitle({ id: "a", type: 3, name: "", recipients: ["1", "2", "9"] }, getUser)).toBe("Mell, xou");
    });

    test("text and announcement channels get a #, voice and threads don't", () => {
        expect(chatTitle({ id: "a", type: 0, name: "general" }, getUser)).toBe("#general");
        expect(chatTitle({ id: "a", type: 5, name: "news" }, getUser)).toBe("#news");
        expect(chatTitle({ id: "a", type: 2, name: "Lounge" }, getUser)).toBe("Lounge");
        expect(chatTitle({ id: "a", type: 11, name: "a thread" }, getUser)).toBe("a thread");
    });
});
