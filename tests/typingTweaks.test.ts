import { describe, expect, test } from "bun:test";

import type { Replacement } from "../src/renderer/patching/source";
import { canonicalizeMatch, matchesFind } from "../src/renderer/patching/source";
import { nameSlots, PATCHES, typerIds, typingLabel } from "../plugins/typing-tweaks/typing";

// Verbatim from Discord's web build (test-results/chunks), trimmed to the patched spots
const SOURCES = {
    /** dc09942b8eaf5acb.js */
    typingLine: 'let[S,j,y]=l,N="";1===l.length?N=H.intl.format(H.t.lJ9sZX,{a:S}):2===l.length?N=H.intl.format(H.t.rB0CUa,{a:S,b:j}):3===l.length?N=H.intl.format(H.t.StKThj,{a:S,b:j,c:y}):l.length>3&&(N=H.intl.format(H.t.Q8lUnE,{}));let b=v&&l.length>0&&l.length<=3?H.intl.format(H.t["qD/0qZ"],{}):N,_=l.length>0||g>0||p,D=!_&&null!=t,G=null;return _?G=(0,n.jsxs)("div",{className:a()(q.IW,{"stop-animation":!i,[q.Il]:h},r),"data-mtctest-ignore":"true",children:[0===l.length&&p?(0,n.jsx)(O.A,{}):(0,n.jsxs)("div",{className:q.y5,ref:x,children:[l.length>0&&!1!==u&&(A?(0,n.jsx)(X,{}):(0,n.jsx)(c.n,{className:q.gO,dotRadius:3.5,themed:!0})),(0,n.jsx)("span",{className:q.Qq,"aria-hidden":!0,children:b}),(0,n.jsx)("span",{className:q.Qq,style:{position:"absolute",visibility:"hidden"},"aria-hidden":!0,ref:f,children:N})]}),',
    /** 3fc6c70a8be491a4.js */
    channel: 'children:[(0,s.jsxs)("div",{className:P.Y5,children:[(0,s.jsx)(z,{className:j,channel:l,guild:B,hasUsersInVoiceChannel:en,hasActiveThreads:h,locked:m}),(0,s.jsx)(c.A,{className:i()(P.UU,{[P.NW]:$}),"aria-hidden":!0,children:(0,s.jsx)(Z,{textVariant:"text-md/medium",channel:l,name:null!=a?a:eu})}),t.Children.count(F)>0?(0,s.jsx)("div",{onClick:w,onKeyPress:w,className:P.Y_,children:F}):null]})',
    /** 85c155b6e66e95f7.js, with the find string from the same module in front */
    thread: 'n$.__invalid_threadMainContent;(0,s.jsxs)("div",{className:eK()(n$.Y5,n$.__invalid_threadMainContent),children:[(0,s.jsx)(e6.E,{variant:"text-sm/medium",color:"none",className:n$.UU,children:(0,s.jsx)(tX.A,{"aria-hidden":!0,children:A})}),(0,s.jsxs)("div",{className:n$.Y_,onClick:nD.dG,onKeyDown:nD.dG,children:[(0,s.jsx)(lK,{thread:t,countInVoice:_,hasVideo:h,mentionCount:m,isMentionLowImportance:f}),(0,s.jsx)(ly,{thread:t,tabIndex:S.tabIndex})]})',
    /** ddae1f90560b4bbf.js */
    dm: 'o()(null!=a,"PrivateChannel.renderAvatar: Invalid prop configuration - no user or channel");let n=null;return a.isSystemUser()||(n=(0,w.A)(m)?el.clD.STREAMING:j),(0,i.jsx)(eb,{...eF,size:C._3.SIZE_32,src:eB,avatarDecoration:ez,status:n,isMobile:x,isVR:_,isTyping:h,"aria-label":a.username,statusTooltip:!0})}(),highlighted:e0&&!eZ,muted:eZ,name:(0,i.jsx)(N.A,{className:s()(eM.uN,{[eM.e8]:ta}),children:tl}),decorators:t.isSystemDM()?(0,i.jsx)(k.A,{className:eM.G$,type:k.A.Types.SYSTEM_DM,verified:!0}):null,withDisplayNameStyles:ta})}),(0,i.jsxs)("div",{className:s()(eM._q,{[eM.EY]:e8}),children:[eq?(0,i.jsx)(ek,{}):e$?(0,i.jsx)(eO,{}):eQ?(0,i.jsx)(eL,{}):null,tf&&null!=e2?(0,i.jsx)(eU,{channelName:e2,onClick:tA,showNameplate:e8}):null,tf?null:(0,i.jsx)(ew,{icon:D.P,"aria-label":eH?ea.intl.string(ea.t["26C4oi"]):ea.intl.string(ea.t.jsvgc3),onClick:eH?ti:e6,onMouseDown:te,nameplate:E,reducedClickTarget:!0,visibleElementRef:e5})]})',
    /** web.js: the same DM row, other minified names */
    dmWeb: 'PrivateChannel.renderAvatar;name:(0,i.jsx)(I.A,{className:s()(ev.uN,{[ev.e8]:tl}),children:ta}),decorators:t.isSystemDM()?(0,i.jsx)(k.A,{className:ev.G$,type:k.A.Types.SYSTEM_DM,verified:!0}):null,withDisplayNameStyles:tl})}),(0,i.jsxs)("div",{className:s()(ev._q,{[ev.EY]:e3}),children:[eQ?(0,i.jsx)(ex,{}):eZ?(0,i.jsx)(eG,{}):ez?(0,i.jsx)(ew,{}):null,t_&&null!=e1?(0,i.jsx)(eU,{channelName:e1,onClick:tE,showNameplate:e3}):null,t_?null:(0,i.jsx)(eP,{icon:v.P,"aria-label":ej?el.intl.string(el.t["26C4oi"]):el.intl.string(el.t.jsvgc3),onClick:ej?ti:e8,onMouseDown:te,nameplate:N,reducedClickTarget:!0,visibleElementRef:e2})]})',
    /** 2026-10-21: the row's right side starts with an ongoing call's icon */
    /** 2026-10-28 (web.js): the call icon's className is an object of its own */
    dmCall1028: 'PrivateChannel.renderAvatar;name:(0,i.jsx)(h.A,{className:s()(eP.uN,{[eP.e8]:tr}),children:tn}),decorators:t.isSystemDM()?(0,i.jsx)(F.A,{className:eP.G$,type:F.A.Types.SYSTEM_DM,verified:!0}):null,withDisplayNameStyles:tr})}),(0,i.jsxs)("div",{className:s()(eP._q,{[eP.EY]:eJ}),children:[null!=eZ&&(0,i.jsx)(eg,{callMessageId:eZ,className:s()(eP.R4,{[eP.jd]:eJ,[eP.ht]:eJ&&e0===er.NJ8.LIGHT})}),e$?(0,i.jsx)(eB,{}):eK?(0,i.jsx)(eF,{}):ej?(0,i.jsx)(ek,{}):null,td&&null!=eq?(0,i.jsx)(ex,{channelName:eq,onClick:tc,showNameplate:eJ}):null,td?null:(0,i.jsx)(eG,{icon:D.P,"aria-label":"x"})]})',
    dmCall: 'PrivateChannel.renderAvatar;name:(0,i.jsx)(h.A,{className:s()(eM.uN,{[eM.e8]:tn}),children:te}),decorators:t.isSystemDM()?(0,i.jsx)(k.A,{className:eM.G$,type:k.A.Types.SYSTEM_DM,verified:!0}):null,withDisplayNameStyles:tn})}),(0,i.jsxs)("div",{className:s()(eM._q,{[eM.EY]:eQ}),children:[null!=eq&&(0,i.jsx)(em,{callMessageId:eq,className:eM.R4}),eK?(0,i.jsx)(eF,{}):eY?(0,i.jsx)(ek,{}):eH?(0,i.jsx)(ex,{}):null,tl&&null!=eX?(0,i.jsx)(eG,{channelName:eX,onClick:to,showNameplate:eQ}):null,tl?null:(0,i.jsx)(ew,{icon:D.P,"aria-label":ey?ea.intl.string(ea.t["26C4oi"]):ea.intl.string(ea.t.jsvgc3),onClick:ey?e8:e3,onMouseDown:e6,nameplate:g,visibleElementRef:eZ})]})',
};

function apply(key: keyof typeof PATCHES, code: string) {
    const patch = PATCHES[key];
    expect(matchesFind(code, patch.find)).toBe(true);
    let next = code;
    for (const r of ([] as Replacement[]).concat(patch.replace)) {
        const re = canonicalizeMatch(r.match) as RegExp;
        expect(code.match(new RegExp(re.source, "g"))?.length).toBe(1);
        const before = next;
        next = next.replace(re, (r.with as string).replaceAll("$self", "S"));
        expect(next).not.toBe(before);
    }
    return next;
}

describe("patches", () => {
    test("typing line: the visible text goes through the plugin, the measured one doesn't", () => {
        const out = apply("typingLine", SOURCES.typingLine);
        expect(out).toContain('"aria-hidden":!0,children:S?.renderTypingText?.(b,b===N,arguments[0])??b}),(0,n.jsx)("span",{className:q.Qq,style:{position:"absolute"');
        expect(out).toContain("ref:f,children:N})");
    });

    test("channel: the dots go between the name and the badges", () => {
        const out = apply("channel", SOURCES.channel);
        expect(out).toContain('name:null!=a?a:eu})}),S?.renderIndicator?.(l,"channel"),t.Children.count(F)>0');
        // The snippet is cut inside an outer array: close it, before and after the patch alike
        expect(() => new Function(`return {${SOURCES.channel}]}`)).not.toThrow();
        expect(() => new Function(`return {${out}]}`)).not.toThrow();
    });

    test("thread: the dots go first in its badges", () => {
        const out = apply("thread", SOURCES.thread);
        expect(out).toContain('children:[S?.renderIndicator?.(t,"channel"),(0,s.jsx)(lK,{thread:t,countInVoice:_');
    });

    test("DM: the dots go first on the row's right side, in both builds", () => {
        for (const code of [SOURCES.dm, SOURCES.dmWeb]) {
            const out = apply("dm", code);
            expect(out).toMatch(/children:\[S\?\.renderIndicator\?\.\(arguments\[0\]\?\.channel,"dm"\),e\w\?\(0,i\.jsx\)/);
        }
    });

    test("DM: the dots still go first when the row starts with a call's icon", () => {
        const out = apply("dm", SOURCES.dmCall);
        expect(out).toContain('children:[S?.renderIndicator?.(arguments[0]?.channel,"dm"),null!=eq&&(0,i.jsx)(em,{callMessageId:eq,className:eM.R4}),eK?(0,i.jsx)(eF,{})');
        expect(() => new Function(`return ${out.slice(out.indexOf("(0,i.jsxs)"))}`)).not.toThrow();
    });

    test("DM: the dots still go first when the call icon's className is an object", () => {
        const out = apply("dm", SOURCES.dmCall1028);
        expect(out).toContain('children:[S?.renderIndicator?.(arguments[0]?.channel,"dm"),null!=eZ&&(0,i.jsx)(eg,{callMessageId:eZ,');
        expect(() => new Function(`return ${out.slice(out.indexOf("(0,i.jsxs)"))}`)).not.toThrow();
    });
});

describe("typers", () => {
    test("in the order they started, without you, blocked or unknown people", () => {
        const typing = { a: 1, me: 2, b: 3, blocked: 4, ghost: 5 };
        expect(typerIds(typing, "me", id => id === "blocked", id => id !== "ghost")).toEqual(["a", "b"]);
        expect(typerIds(undefined, "me", () => false)).toEqual([]);
    });

    test("the names in Discord's formatted line are its non-text parts", () => {
        const bold = (name: string) => ({ type: "strong", props: { children: name } });
        expect(nameSlots([bold("Ada"), " is typing..."])).toEqual([0]);
        expect(nameSlots([bold("Ada"), " and ", bold("Bo"), " are typing..."])).toEqual([0, 2]);
        expect(nameSlots(["nobody"])).toEqual([]);
    });

    test("the dots' tooltip", () => {
        expect(typingLabel(["Ada"])).toBe("Ada is typing");
        expect(typingLabel(["Ada", "Bo"])).toBe("Ada and Bo are typing");
        expect(typingLabel(["Ada", "Bo", "Cy"])).toBe("Ada, Bo and Cy are typing");
        expect(typingLabel(["Ada", "Bo", "Cy", "Di", "Ed"])).toBe("Ada, Bo and 3 others are typing");
        expect(typingLabel([])).toBe("");
    });
});
