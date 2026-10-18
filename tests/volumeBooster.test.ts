import { describe, expect, test } from "bun:test";

import type { Replacement } from "../src/renderer/patching/source";
import { canonicalizeMatch, matchesFind } from "../src/renderer/patching/source";
import {
    amplitudeToSlider, clampMultiplier, clampSynced, DISCORD_MAX, DISCORD_MAX_AMPLITUDE, keepBoosted, PATCHES, sliderMax, sliderToAmplitude,
} from "../plugins/volume-booster/volume";

// Verbatim from Discord's web build (test-results/chunks), trimmed to the patched spots
const SOURCES = {
    userVolumeMenu: 'function h(t){let e=arguments.length>1&&void 0!==arguments[1]?arguments[1]:g.x.DEFAULT,i=arguments.length>2&&void 0!==arguments[2]?arguments[2]:void 0,h=(0,n.bG)([d.Ay],()=>d.Ay.getLocalVolume(t,e),[t,e]),m=t===o.default.getCurrentUser()?.id,p=e===g.x.STREAM;return m?null:(0,l.jsx)(a.aK,{id:"user-volume",label:p?v.intl.string(v.t.t4JBnI):v.intl.string(v.t.m7TNdF),interactive:!1,control:(n,a)=>(0,l.jsx)(r.i,{...n,ref:a,value:(0,u.M)(h),maxValue:c.isPlatformEmbedded?g.Rv:g.HE,onChange:l=>{s.A.setLocalVolume(t,(0,u.w)(l),e),i?.(l)},"aria-label":p?v.intl.string(v.t.t4JBnI):v.intl.string(v.t.m7TNdF)})})}',
    streamTile: 'function C(e){let{className:n,iconClassName:t,sliderClassName:l,userId:C,context:p,currentWindow:x=window,location:g}=e,{currentVolume:f,muted:E}=(0,a.cf)([u.Ay],()=>({currentVolume:u.Ay.getLocalVolume(C,p),muted:u.Ay.isLocalMute(C,p)}));return(0,i.jsx)(m.A,{children:(0,i.jsx)(c.A,{currentWindow:x,iconClassName:s()(t,h.pd),sliderClassName:l,className:n,value:(0,d.M)(f),muted:E,maxValue:A.isPlatformEmbedded?200:100,onValueChange:e=>{e>0&&E&&o.A.toggleLocalMute(C,p),o.A.setLocalVolume(C,(0,d.w)(e),p)},onToggleMute:()=>{null!=g&&(0,r.X)(g,r.O.VOLUME,E),o.A.toggleLocalMute(C,p)}})})}',
    syncWrite: 'function x(){let T=e=>`AudioContextSettingsMigrated:${e}`;function g(){l.w.get(T(_.default.getId()))||h.wc.updateAsync("audioContextSettings",e=>{let t=!1;for(let[n,i]of Object.entries(E.Ay.getState().settingsByContext)){let r=(0,f.o)(n);if(null==r)continue;let a=e[r],s=String(Date.now()),l={};for(let[e,t]of Object.entries(i.localMutes))l[e]={muted:t,volume:m(n),modifiedAt:s,soundboardMuted:!1};for(let[e,t]of Object.entries(i.localVolumes)){let i=l[e];l[e]={...i??{muted:!1,modifiedAt:s},volume:(0,f.z)(t,n)}}}return t})}function O(e){let{context:t,userId:n,volume:i}=e;if(n===_.default.getId())return;let r=c.default.getRemoteSessionId();null!=r&&N(r,n,t,{muted:E.Ay.isLocalMute(n,t),volume:i}),(0,I.gq)(t,n,{volume:i}),S()}function R(e){let{context:t,userId:n}=e;if(n!==_.default.getId()){var i;i=E.Ay.isLocalMute(n,t),(0,I.gq)(t,n,{muted:i}),S.cancel(),C()}}return{g,O,R}}',
    syncRead: 'function nP(){let e=arguments.length>0&&void 0!==arguments[0]&&arguments[0],t=ew.A.settings.audioContextSettings??{user:{},stream:{}};for(let n of Object.keys(t)){let i=n===eZ.W.USER?eJ.x.DEFAULT:eJ.x.STREAM,r=i===eJ.x.STREAM?eJ.Cn:eJ.Hz,a=t[n]??{},{localMutes:s,localVolumes:l}=nt(i);for(let[e,t]of Object.entries(a))null==(0,eG.tM)(i,e)&&(t.muted?s[e]=!0:delete s[e],t.volume!==r?l[e]=t.volume:delete l[e],tr.eachConnection(n=>{n.setLocalVolume(e,t.volume),n.setLocalMute(e,t.muted)},i));if(e)for(let e of new Set([...Object.keys(s),...Object.keys(l)]))null==a[e]&&(delete s[e],delete l[e],tr.eachConnection(t=>{t.setLocalVolume(e,r),t.setLocalMute(e,!1)},i));ng({localMutes:s,localVolumes:l},i)}}',
};

function apply(key: keyof typeof PATCHES, self = "S") {
    const patch = PATCHES[key];
    const code = SOURCES[key];
    expect(matchesFind(code, patch.find)).toBe(true);
    let next = code;
    for (const r of ([] as Replacement[]).concat(patch.replace)) {
        const before = next;
        next = next.replace(canonicalizeMatch(r.match) as RegExp, (r.with as string).replaceAll("$self", self));
        expect(next).not.toBe(before);
    }
    // Still valid JavaScript
    expect(() => new Function(`return ${next}`)).not.toThrow();
    return next;
}

describe("volume booster math", () => {
    test("multiplier is clamped to 1..5, garbage falls back to the default", () => {
        expect(clampMultiplier(2)).toBe(2);
        expect(clampMultiplier(0)).toBe(1);
        expect(clampMultiplier(12)).toBe(5);
        expect(clampMultiplier("3")).toBe(3);
        expect(clampMultiplier(NaN)).toBe(2);
        expect(clampMultiplier(undefined)).toBe(2);
    });

    test("slider cap scales Discord's cap", () => {
        expect(sliderMax(200, 2)).toBe(400);
        expect(sliderMax(200, 5)).toBe(1000);
        expect(sliderMax(200, 99)).toBe(1000);
        expect(sliderMax(200, 1.5)).toBe(300);
    });

    test("Discord's perceptual curve round-trips, 200 is ~2x and every 100 above adds 6dB", () => {
        expect(sliderToAmplitude(100)).toBe(100);
        expect(DISCORD_MAX_AMPLITUDE).toBeCloseTo(199.53, 1);
        expect(sliderToAmplitude(400)).toBeCloseTo(794.3, 0);
        for (const s of [0, 10, 50, 100, 150, 200, 400, 1000]) expect(amplitudeToSlider(sliderToAmplitude(s))).toBeCloseTo(s, 6);
    });

    test("synced volumes never exceed what Discord accepts", () => {
        expect(clampSynced(794)).toBe(DISCORD_MAX);
        expect(clampSynced(150)).toBe(150);
        expect(clampSynced(DISCORD_MAX_AMPLITUDE)).toBe(DISCORD_MAX_AMPLITUDE);
        expect(clampSynced(undefined)).toBe(undefined);
    });

    test("only our own clamped write coming back keeps a boosted volume", () => {
        expect(keepBoosted(794, 200)).toBe(true);
        expect(keepBoosted(794, 150)).toBe(false);
        expect(keepBoosted(150, 200)).toBe(false);
        expect(keepBoosted(undefined, 200)).toBe(false);
    });
});

describe("volume booster patches", () => {
    test("user menu: only the desktop cap grows", () => {
        expect(apply("userVolumeMenu")).toContain("maxValue:c.isPlatformEmbedded?(S?.sliderMax?.(g.Rv)??g.Rv):g.HE,onChange");
    });

    test("stream tile: only the desktop cap grows", () => {
        expect(apply("streamTile")).toContain("maxValue:A.isPlatformEmbedded?(S?.sliderMax?.(200)??200):100,onValueChange");
    });

    test("user menu slider evaluates to the boosted cap, and to Discord's without the plugin", () => {
        const expr = apply("userVolumeMenu").match(/maxValue:(.+?),onChange/)![1];
        const run = (S: unknown) => new Function("S", "c", "g", `return ${expr}`)(S, { isPlatformEmbedded: true }, { Rv: 200, HE: 100 });
        expect(run({ sliderMax: (m: number) => sliderMax(m, 2) })).toBe(400);
        expect(run(undefined)).toBe(200);
    });

    test("sync writes are clamped", () => {
        const out = apply("syncWrite");
        expect(out).toContain("volume:(S?.clampSynced?.((0,f.z)(t,n))??(0,f.z)(t,n))}");
        expect(out).toContain("isLocalMute(n,t),volume:(S?.clampSynced?.(i)??i)})");
        expect(out).toContain("(0,I.gq)(t,n,{volume:(S?.clampSynced?.(i)??i)})");
        // The mute path is untouched
        expect(out).toContain("(0,I.gq)(t,n,{muted:i})");
    });

    test("sync reads keep boosted volumes and otherwise behave like Discord", () => {
        const out = apply("syncRead");
        expect(out).toContain("(S?.keepBoosted?.(l[e],t.volume)||(t.volume!==r?l[e]=t.volume:delete l[e])),tr.eachConnection(n=>{n.setLocalVolume(e,l[e]??r)");

        // Run the patched loop with fake stores
        const loop = out.match(/(for\(let\[e,t\]of Object\.entries\(a\)\).+?\},i\)\));if\(e\)/)![1];
        const run = (S: unknown, local: Record<string, number>, synced: Record<string, { volume: number; muted: boolean; }>) => {
            const sent: [string, number][] = [];
            const tr = { eachConnection: (cb: (c: any) => void) => cb({ setLocalVolume: (id: string, v: number) => sent.push([id, v]), setLocalMute() { } }) };
            new Function("S", "a", "l", "s", "r", "tr", "eG", "i", loop)(S, synced, local, {}, 100, tr, { tM: () => undefined }, "default");
            return sent;
        };

        const local: Record<string, number> = { a: 794, b: 794, c: 150 };
        const sent = run({ keepBoosted }, local, { a: { volume: 200, muted: false }, b: { volume: 50, muted: false }, c: { volume: 100, muted: false } });
        expect(local).toEqual({ a: 794, b: 50 });
        expect(sent).toEqual([["a", 794], ["b", 50], ["c", 100]]);

        // Plugin gone: Discord's behaviour
        const plain: Record<string, number> = { a: 794 };
        expect(run(undefined, plain, { a: { volume: 200, muted: false } })).toEqual([["a", 200]]);
        expect(plain).toEqual({ a: 200 });
    });
});
