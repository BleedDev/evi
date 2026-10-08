import { describe, expect, test } from "bun:test";

import { gameModePatch } from "../src/renderer/gameMode";
import { canonicalizeMatch, matchesFind, Replacement } from "../src/renderer/patching/source";
import { dotLeft, typingDotsPatch } from "../src/renderer/typingDots";

// Verbatim from Discord's web build (crawled 2026-10-03): the typing dots module
const DOTS = "863610(e,t,n){\"use strict\";n.d(t,{U:()=>h,n:()=>I});var i=n(477900),r=n(582128),a=n(503698),s=n.n(a),l=n(202091),o=n(717421),d=n(866323),c=n(597619),u=n(704038);let _={config:{friction:50,tension:900,mass:1},unique:!0,initial:{dotPosition:1},from:{dotPosition:0},enter:{dotPosition:1},leave:{dotPosition:0}},E={config:{duration:2400},from:{dotCycle:2.8},reset:!0};function A(e){let t=e%2;return t>1?1-(t-1):t}let h=r.memo(function(e){let{dotRadius:t,dotPosition:n,fill:a=\"currentColor\",spacing:s=2.5}=e,{focused:d}=(0,c.xb)(),u=r.useRef(!0);r.useEffect(()=>()=>{u.current=!1},[]);let[_]=(0,o.z)(()=>({...E,to:async e=>{let t=2.8;for(;u.current;)d?(t+=4,await e({dotCycle:t,immediate:!1})):2.8!==t?(t=2.8,await e({dotCycle:t,immediate:!0})):await new Promise(e=>setTimeout(e,1e3))}}),\"animate-always\",[d]),h=(2*t*3+t/4*2)/2;return(0,i.jsx)(i.Fragment,{children:[0,1,2].map(e=>{let r=.25*e,o=t+t*s*e;return(0,i.jsx)(l.animated.circle,{cx:n?n.to([0,1],[h,o]):o,cy:t,r:_.dotCycle.to(e=>A(e-r)).to([0,.4,.8,1],[.8*t,.8*t,t,t]).to(e=>d?e:t),fill:a,style:{opacity:_.dotCycle.to(e=>A(e-r)).to([0,.4,.8,1],[.3,.3,1,1]).to(e=>d?e:1)}},e)})})}),I=r.memo(function(e){let{dotRadius:t,x:n,y:r,hide:a=!1,themed:o=!1,className:E,ref:A}=e,{focused:I}=(0,c.xb)();return(0,d.p)(a,{..._,key:e=>e?\"true\":\"false\"},I?\"animate-always\":\"animate-never\")((e,a,d)=>{let{dotPosition:c}=e,{key:_}=d;return a?null:(0,i.jsx)(\"svg\",{ref:A,x:n,y:r,width:2*t*3+t/2*2,height:2*t,className:s()(E,u.r,o?u.S:null),children:(0,i.jsx)(l.animated.g,{style:{opacity:c.to(e=>Math.min(1,Math.max(e,0)))},children:(0,i.jsx)(h,{dotRadius:t,dotPosition:c})})},_)})})}";
// GameModeStore, trimmed to its getters: as of 2026-10-08, and before 2026-10-03 (still matched)
const GAME_MODE = "class f extends i.Ay.DeviceSettingsStore{static displayName=\"GameModeStore\";static persistKey=\"GameModeStore\";getUserAgnosticState(){return c}get enabled(){return c.enabled??this.isActive}getStoredEnabledChoice(){return c.enabled}isEnabledFor(e){return c.enabled??e}get hasRunningGame(){return u}get hasDetectedGame(){return c.hasDetectedGame}get isActive(){return!1!==c.enabled&&!!u&&!!l.isPlatformEmbedded&&(0,o.v)({location:\"GameModeStore\"}).enabled}get isThrottling(){return this.isActive&&!_&&!E}}";
const GAME_MODE_OLD = "class h extends i.Ay.DeviceSettingsStore{static displayName=\"GameModeStore\";static persistKey=\"GameModeStore\";getUserAgnosticState(){return d}get enabled(){return d.enabled}get hasRunningGame(){return c}get hasDetectedGame(){return d.hasDetectedGame}get isActive(){return!!d.enabled&&!!c&&(0,l.v)({location:\"GameModeStore\"}).enabled}get isThrottling(){return this.isActive&&!u&&!_}}";

function apply(code: string, replace: Replacement | Replacement[]) {
    return [replace].flat().reduce((out, r) => {
        const next = out.replace(canonicalizeMatch(r.match), r.with as string);
        expect(next).not.toBe(out);
        return next;
    }, code);
}

describe("typing dots", () => {
    test("the indicator draws Evi's dots, given focus and react-spring, Discord's otherwise", () => {
        expect(matchesFind(DOTS, typingDotsPatch.find)).toBe(true);
        const out = apply(DOTS, typingDotsPatch.replace);
        expect(out).toContain("children:(0,i.jsx)(window.Evi?.typingDots??h,{dotRadius:t,dotPosition:c,focused:I,animated:l.animated})");
        // The dots component itself is untouched: SVG masks elsewhere still use it
        expect(out).toContain("(0,i.jsx)(l.animated.circle,{");
        // Factories are method shorthand (`863610(e,t,n){...}`): compiles as one in an object literal
        expect(() => new Function(`return {${out}}`)).not.toThrow();
    });

    test("each dot sits where Discord's circle did, sliding in from the middle", () => {
        // Discord: centers at r + r * 2.5 * i, sliding from (2r * 3 + r / 4 * 2) / 2
        expect([0, 1, 2].map(i => dotLeft(4, i))).toEqual([0, 10, 20]);
        const spring = { to: (input: number[], output: number[]) => ({ input, output }) };
        expect(dotLeft(4, 2, spring)).toEqual({ input: [0, 1], output: [9, 20] });
    });
});

describe("Game Mode", () => {
    test("Evi's switch answers for enabled and isActive, Discord's experiment and choice otherwise", () => {
        expect(matchesFind(GAME_MODE, gameModePatch.find)).toBe(true);
        const out = apply(GAME_MODE, gameModePatch.replace);
        expect(out).toContain("get enabled(){return !!window.Evi?.gameMode?.on()||(c.enabled??this.isActive)}");
        expect(out).toContain('get isActive(){return window.Evi?.gameMode?.on()?this.hasRunningGame&&!window.Evi.gameMode.held():!1!==c.enabled&&!!u&&');

        // choice: Discord's stored Game Mode choice, undefined when never set
        const store = (on: boolean, held: boolean, choice: boolean | undefined, running: boolean, experiment: boolean) => {
            const make = new Function("window", "c", "u", "l", "o", "i", `${out};return new f();`);
            return make({ Evi: { gameMode: { on: () => on, held: () => held } } }, { enabled: choice }, running, { isPlatformEmbedded: true }, { v: () => ({ enabled: experiment }) }, { Ay: { DeviceSettingsStore: class { } } });
        };
        // Evi's switch: a game running and not in a call is enough, whatever Discord's choice says
        expect(store(true, false, undefined, true, false).isActive).toBe(true);
        expect(store(true, false, false, true, false).isActive).toBe(true);
        expect(store(true, true, undefined, true, false).isActive).toBe(false);
        expect(store(true, false, undefined, false, false).isActive).toBe(false);
        expect(store(true, false, undefined, false, false).enabled).toBe(true);
        // Off: exactly Discord's, experiment and all
        expect(store(false, false, undefined, true, false).isActive).toBe(false);
        expect(store(false, false, undefined, true, true).isActive).toBe(true);
        expect(store(false, false, false, true, true).isActive).toBe(false);
        expect(store(false, false, undefined, false, true).enabled).toBe(false);
        // Discord's real store ends in `}`: the patched getters still compile as a class
        expect(() => new Function(out)).not.toThrow();
    });

    test("the form before 2026-10-03 still matches", () => {
        expect(matchesFind(GAME_MODE_OLD, gameModePatch.find)).toBe(true);
        const out = apply(GAME_MODE_OLD, gameModePatch.replace);
        expect(out).toContain("get enabled(){return !!window.Evi?.gameMode?.on()||(d.enabled)}");
        expect(out).toContain('get isActive(){return window.Evi?.gameMode?.on()?this.hasRunningGame&&!window.Evi.gameMode.held():!!d.enabled&&!!c&&');
        const make = new Function("window", "d", "c", "l", "i", `${out};return new h();`);
        const store = make({ Evi: { gameMode: { on: () => true, held: () => false } } }, { enabled: false }, true, { v: () => ({ enabled: false }) }, { Ay: { DeviceSettingsStore: class { } } });
        expect(store.isActive).toBe(true);
    });
});
