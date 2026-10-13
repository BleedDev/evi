import { describe, expect, test } from "bun:test";

import { routeChunks } from "../scripts/lazy-route";

// Verbatim from Discord's web build, chunk lists shortened. Up to early October 2026 (2026-10-03) the
// chat's route loaded its chunks inline; by 2026-10-12 it's a named async function that also starts
// native markdown, whose own Promise.all binds another module
const INLINE = 'age",renderLoader:ir.rt}),Lp=(0,tj.qT)({createPromise:()=>Promise.all([n.e("924399"),n.e("456506"),n.e("234052"),n.e("192461")]).then(n.bind(n,466249)),webpackId:466249,name:"Channel",renderLoader:ir.l3}),LT=(0,tj.Fe)({createProm';
const NAMED = 'bA=(0,t$.Fe)({createPromise:()=>Promise.all([n.e("189908"),n.e("598476"),n.e("11015")]).then(n.bind(n,862671)),webpackId:862671,name:"MessageRequestPage",renderLoader:i8.rt});'
    + 'async function bh(){let e=la.o.getConfig({location:"AppView"},{autoTrackExposure:!1}).enabled?Promise.all([n.e("902654"),n.e("774346"),n.e("856437")]).then(n.bind(n,752020)).then(e=>{let{initNativeMarkdown:t}=e;return t().catch(()=>{})},()=>{}):Promise.resolve(),'
    + 't=await Promise.all([n.e("924399"),n.e("865429"),n.e("784573"),n.e("192461")]).then(n.bind(n,284055));return await e,t}let bf=(0,t$.qT)({createPromise:bh,webpackId:284055,name:"Channel",renderLoader:i8.l3}),bI=(0,t$.Fe)({createProm';

describe("Discord's lazy routes", () => {
    test("the chat's chunks when its loader is inline (until October 2026)", () => {
        expect(routeChunks(INLINE, "Channel")).toEqual({ module: "466249", chunkIds: ["924399", "456506", "234052", "192461"] });
    });

    test("the chat's chunks when its loader is a named function, not native markdown's or the route before it", () => {
        expect(routeChunks(NAMED, "Channel")).toEqual({ module: "284055", chunkIds: ["924399", "865429", "784573", "192461"] });
        expect(routeChunks(NAMED, "MessageRequestPage")).toEqual({ module: "862671", chunkIds: ["189908", "598476", "11015"] });
    });

    test("a route with a single chunk", () => {
        expect(routeChunks('bI=(0,t$.Fe)({createPromise:()=>n.e("322270").then(n.bind(n,816015)),webpackId:816015,name:"Thing"})', "Thing"))
            .toEqual({ module: "816015", chunkIds: ["322270"] });
    });

    test("nothing for a route that isn't there or whose loader can't be read", () => {
        expect(routeChunks(NAMED, "Channels")).toBeUndefined();
        expect(routeChunks('({createPromise:bh,webpackId:284055,name:"Channel"})', "Channel")).toBeUndefined();
    });

    test("runs on its own in the page: no imports or outside names", () => {
        const inPage = new Function(`return (${routeChunks.toString()})`)();
        expect(inPage(NAMED, "Channel")).toEqual(routeChunks(NAMED, "Channel"));
    });
});
