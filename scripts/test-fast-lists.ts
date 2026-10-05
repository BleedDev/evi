/**
 * Runs the Fast Server List plugin against a synthetic 185-server sidebar in headless Chrome and
 * checks the guarantees that matter: no visible server is ever hidden, no stale state survives a
 * strategy switch or disabling, and rows added later (opened folders) are handled. A Discord-like
 * virtualized member list gets the same checks, and the chat must be left alone.
 *
 *   node scripts/test-fast-lists.ts
 */
import { existsSync, readFileSync } from "fs";
import { join, resolve } from "path";
import { chromium } from "playwright-core";

const ROOT = resolve(import.meta.dirname, "..");
const code = readFileSync(join(ROOT, "dist", "plugins", "fast-lists", "index.js"), "utf8");

const browser = await chromium.launch({
    executablePath: [process.env.CHROME_PATH, "C:/Program Files/Google/Chrome/Application/chrome.exe"].find(p => !!p && existsSync(p)),
    headless: true,
});
const page = await browser.newPage({ viewport: { width: 400, height: 700 } });

await page.setContent(`<!doctype html><style>
    body { margin: 0; }
    .scroller { height: 600px; overflow-y: auto; width: 72px; }
    .listItem { position: relative; height: 48px; margin-bottom: 8px; }
    .pill { position: absolute; left: 0; width: 4px; height: 8px; background: white; transform: translateX(0) translateZ(0); }
    img { width: 48px; height: 48px; display: block; }
</style>
<nav><ul data-list-id="guildsnav" class="scroller"><div class="list"></div></ul></nav>
<main><div class="chatScroller" style="height:500px;overflow-y:auto;width:300px"><ol data-list-id="chat-messages" class="chatList"></ol></div></main>
<aside><div data-list-id="members-1" class="memberScroller" style="height:600px;overflow-y:auto;width:240px"><ul class="memberList" style="margin:0;padding:0;list-style:none"></ul></div></aside>`);

const results = await page.evaluate(async (pluginCode) => {
    const list = document.querySelector(".list")!;
    const icon = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48"><rect width="48" height="48" fill="purple"/></svg>');
    const row = (id: string) => {
        const div = document.createElement("div");
        div.className = "listItem";
        div.innerHTML = `<div class="pill"></div><div><div data-list-item-id="guildsnav___${id}" role="treeitem"><img src="${icon}"></div></div>`;
        return div;
    };
    for (let i = 0; i < 175; i++) list.append(row(String(i)));
    // Folders: a header item plus a group of children, collapsed by default
    const folders: HTMLElement[] = [];
    for (let f = 0; f < 10; f++) {
        const folder = document.createElement("div");
        folder.className = "folder";
        folder.append(row(`folder-${f}`));
        list.append(folder);
        folders.push(folder);
    }

    // Minimal plugin host
    const settings: Record<string, any> = { servers: true, chat: true, members: true, margin: 2 };
    // Every scrollTop write the plugin makes is a bug: it fights the user's scrolling
    let pluginScrollWrites = 0;
    const desc = Object.getOwnPropertyDescriptor(Element.prototype, "scrollTop")!;
    let writingFromTest = false;
    Object.defineProperty(Element.prototype, "scrollTop", {
        configurable: true,
        get() { return desc.get!.call(this); },
        set(v) { if (!writingFromTest) pluginScrollWrites++; desc.set!.call(this, v); },
    });
    (window as any).__setScroll = (el: Element, v: number) => { writingFromTest = true; el.scrollTop = v; writingFromTest = false; };
    const changeListeners: (() => void)[] = [];
    const disposers: (() => void)[] = [];
    // Evi marks the page while a screen reader is on (Electron's accessibility support)
    const setAssistive = (on: boolean) => document.documentElement.toggleAttribute("data-evi-assistive", on);
    const ctx = {
        addStyle(css: string) {
            const el = document.createElement("style");
            el.textContent = css;
            document.head.append(el);
            disposers.push(() => el.remove());
        },
        onDispose: (fn: () => void) => void disposers.push(fn),
        setInterval(fn: () => void, ms: number) {
            const h = setInterval(fn, ms);
            disposers.push(() => clearInterval(h));
        },
        settings: {
            get: (k: string) => settings[k],
            onChange: (cb: () => void) => void changeListeners.push(cb),
        },
    };
    const module = { exports: {} as any };
    new Function("module", "exports", "require", pluginCode)(module, module.exports, (n: string) => {
        if (n === "@evi/api") return { definePlugin: (d: any) => d, defineStrings: (s: any) => (k: string) => s.en[k] ?? k };
        throw new Error(n);
    });
    const plugin = module.exports.default;
    const setSetting = (k: string, v: any) => {
        settings[k] = v;
        changeListeners.forEach(cb => cb());
    };
    const frame = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

    const sc = document.querySelector<HTMLElement>(".scroller")!;
    const counts = () => ({ rows: document.querySelectorAll(".dl-fl-row").length, far: document.querySelectorAll(".dl-fl-far").length });
    const hiddenVisible = () => {
        const view = sc.getBoundingClientRect();
        return [...sc.querySelectorAll(".dl-fl-far")].filter(r => {
            const b = r.getBoundingClientRect();
            return b.bottom > view.top && b.top < view.bottom;
        }).length;
    };
    const renderedHeight = () => sc.scrollHeight;

    const out: Record<string, unknown> = {};
    const heightBefore = renderedHeight();

    plugin.start(ctx);
    await frame();
    await new Promise(r => setTimeout(r, 50));
    out.rowsMarked = counts().rows;
    out.skipFarAtTop = counts().far;
    // Measured: containment on visible rows made frames slower, so they must stay plain
    const visibleRow = [...document.querySelectorAll<HTMLElement>(".dl-fl-row:not(.dl-fl-far)")][0];
    out.visibleRowContain = visibleRow ? getComputedStyle(visibleRow).contain : "missing";
    // The pills' GPU-layer hack is flattened once the stylesheets have been read in idle time
    for (let i = 0; i < 40 && !document.getElementById("evi-fl-flatten"); i++) await new Promise(r => setTimeout(r, 50));
    out.pillTransform = getComputedStyle(document.querySelector(".pill")!).transform;
    let worst = 0;
    for (let i = 0; i < 120; i++) {
        (window as any).__setScroll(sc, sc.scrollTop + 120);
        await frame();
        worst = Math.max(worst, hiddenVisible());
    }
    // Jumps: bottom, top, middle
    for (const to of [sc.scrollHeight, 0, sc.scrollHeight / 2]) {
        (window as any).__setScroll(sc, to);
        await new Promise(r => requestAnimationFrame(r));
        worst = Math.max(worst, hiddenVisible());
        await frame();
        worst = Math.max(worst, hiddenVisible());
    }
    out.skipWorstHiddenVisible = worst;
    out.skipKeepsLayout = renderedHeight() === heightBefore;

    // Open a folder: its children must be picked up
    const group = document.createElement("div");
    for (let c = 0; c < 5; c++) group.append(row(`child-${c}`));
    folders[0].append(group);
    await frame();
    await frame();
    out.folderChildrenHandled = [...group.children].every(ch => ch.classList.contains("dl-fl-row"));

    // A smaller render distance applies live and hides more
    (window as any).__setScroll(sc, 0);
    await frame();
    setSetting("margin", 1);
    await frame();
    await new Promise(r => setTimeout(r, 50));
    out.farWithMargin1 = counts().far;
    out.hiddenVisibleAfterSettingChange = hiddenVisible();

    // Cost of a resync on the server list as servers are added (rows come and go all the time)
    const t0 = performance.now();
    const added: HTMLElement[] = [];
    for (let i = 0; i < 20; i++) {
        added.push(row(`extra-${i}`));
        list.append(added[i]);
        await new Promise(r => requestAnimationFrame(r));
    }
    out.resyncMsPerFrame = +((performance.now() - t0) / 20).toFixed(2);
    // Rows are worked out in idle time
    await new Promise(r => requestIdleCallback(() => requestIdleCallback(r)));
    out.newRowsMarked = added.every(el => el.classList.contains("dl-fl-row"));
    out.pluginScrollWrites = pluginScrollWrites;

    // The chat is left alone, even with a "chat" setting saved from an older version: skipping messages
    // in it fought Discord's own place-keeping while scrolling
    const chat = document.querySelector<HTMLElement>(".chatList")!;
    for (let i = 0; i < 200; i++) {
        const li = document.createElement("li");
        li.setAttribute("data-list-item-id", `chat-messages___m${i}`);
        li.style.height = `${40 + (i * 37) % 120}px`;
        chat.append(li);
    }
    await new Promise(r => setTimeout(r, 1200));
    await new Promise(r => requestIdleCallback(() => requestIdleCallback(r)));
    out.chatTouched = chat.querySelectorAll(".dl-fl-row, .dl-fl-far").length;
    out.defaults = { hasChat: "chat" in plugin.settings, members: plugin.settings.members.default };

    // Member list, rendered like Discord's: fixed 42px rows, only the 256px chunks around the view
    // (plus one each side) are in the DOM, re-rendered on scroll
    const members = document.querySelector<HTMLElement>(".memberScroller")!;
    const memberList = members.querySelector<HTMLElement>(".memberList")!;
    const MEMBERS = 1000, ROW_H = 42, CHUNK = 256;
    const renderMembers = () => {
        const top = members.scrollTop;
        const from = Math.max(0, Math.floor((Math.floor(top / CHUNK) - 1) * CHUNK / ROW_H));
        const to = Math.min(MEMBERS, Math.ceil((Math.ceil((top + members.clientHeight) / CHUNK) + 1) * CHUNK / ROW_H));
        memberList.style.paddingTop = `${from * ROW_H}px`;
        memberList.style.height = `${MEMBERS * ROW_H}px`;
        memberList.style.boxSizing = "border-box";
        const keep = new Map([...memberList.children].map(el => [el.getAttribute("data-list-item-id"), el]));
        const rowsNow: Element[] = [];
        for (let i = from; i < to; i++) {
            const id = `members-1___u${i}`;
            let li = keep.get(id);
            if (!li) {
                li = document.createElement("li");
                li.setAttribute("data-list-item-id", id);
                (li as HTMLElement).style.height = `${ROW_H}px`;
                li.textContent = `member ${i}`;
            }
            rowsNow.push(li);
        }
        memberList.replaceChildren(...rowsNow);
    };
    renderMembers();
    members.addEventListener("scroll", renderMembers);
    await new Promise(r => setTimeout(r, 1200));
    await frame();
    const hiddenInView = (scroller: HTMLElement) => {
        const view = scroller.getBoundingClientRect();
        return [...scroller.querySelectorAll(".dl-fl-far")].filter(r => {
            const b = r.getBoundingClientRect();
            return b.bottom > view.top && b.top < view.bottom;
        }).length;
    };
    let memberWorst = 0, memberFar = 0;
    for (let i = 0; i < 150; i++) {
        (window as any).__setScroll(members, members.scrollTop + 250);
        await frame();
        memberWorst = Math.max(memberWorst, hiddenInView(members));
        memberFar = Math.max(memberFar, members.querySelectorAll(".dl-fl-far").length);
    }
    for (const to of [0, members.scrollHeight / 2]) {
        (window as any).__setScroll(members, to);
        await frame();
        memberWorst = Math.max(memberWorst, hiddenInView(members));
    }
    // Rows are worked out in idle time
    await new Promise(r => setTimeout(r, 100));
    await new Promise(r => requestIdleCallback(() => requestIdleCallback(r)));
    out.membersMarked = memberList.querySelectorAll(".dl-fl-row").length;
    out.membersWorstHiddenVisible = memberWorst;
    out.membersMaxFar = memberFar;
    out.pluginScrollWritesWithMembers = pluginScrollWrites;

    // Rebuilt sidebar: plugin re-attaches within its polling interval
    const nav = document.querySelector("nav")!;
    const clone = nav.cloneNode(true) as HTMLElement;
    clone.querySelectorAll(".dl-fl-row, .dl-fl-far").forEach(e => e.classList.remove("dl-fl-row", "dl-fl-far"));
    nav.replaceWith(clone);
    await new Promise(r => setTimeout(r, 2300));
    out.reattached = document.querySelectorAll(".dl-fl-row").length > 150;

    // A screen reader turned on mid-session: every row renders again, so it can read them all
    out.beforeAssistive = counts();
    setAssistive(true);
    await new Promise(r => setTimeout(r, 300));
    await frame();
    out.withAssistive = counts();
    // ...and off again: rows are skipped again
    setAssistive(false);
    await new Promise(r => setTimeout(r, 300));
    await frame();
    await new Promise(r => setTimeout(r, 100));
    await new Promise(r => requestIdleCallback(() => requestIdleCallback(r)));
    out.afterAssistive = counts();

    // Disable: nothing may be left
    disposers.splice(0).reverse().forEach(fn => fn());
    await frame();
    out.afterDisable = counts();
    out.styleRemoved = ![...document.querySelectorAll("style")].some(s => s.textContent?.includes("dl-fl")) && !document.getElementById("evi-fl-flatten");
    return out;
}, code);

await browser.close();

let failed = 0;
function check(name: string, ok: boolean, detail?: unknown) {
    if (!ok) failed++;
    console.log(`${ok ? "\x1b[32m✓" : "\x1b[31m✗"} ${name}\x1b[0m${detail !== undefined ? `  \x1b[2m${JSON.stringify(detail)}\x1b[0m` : ""}`);
}
const r = results as any;
check("marks every server and folder row", r.rowsMarked === 185, r.rowsMarked);
check("hides rows far out of view", r.skipFarAtTop > 50, r.skipFarAtTop);
check("visible rows get no containment (measured slower)", r.visibleRowContain === "none", r.visibleRowContain);
check("pills' translateZ(0) is flattened to 2D", !!r.pillTransform && !r.pillTransform.startsWith("matrix3d"), r.pillTransform);
check("no visible row is ever hidden, scrolling or jumping", r.skipWorstHiddenVisible === 0, r.skipWorstHiddenVisible);
check("skipping doesn't change the list's size", r.skipKeepsLayout);
check("opened folder's servers are picked up", r.folderChildrenHandled);
check("smaller render distance applies live", r.farWithMargin1 > r.skipFarAtTop && r.hiddenVisibleAfterSettingChange === 0, { margin2: r.skipFarAtTop, margin1: r.farWithMargin1 });
check("resync stays cheap (frame time with a new server every frame)", r.resyncMsPerFrame < 20, { msPerFrame: r.resyncMsPerFrame });
check("new servers are picked up", r.newRowsMarked);
check("the plugin never writes the scroll position", r.pluginScrollWrites === 0, r.pluginScrollWrites);
check("members: rows are tracked", r.membersMarked > 0, r.membersMarked);
check("members: no visible member is ever hidden", r.membersWorstHiddenVisible === 0, r.membersWorstHiddenVisible);
// Why the member list is off by default: Discord renders only rows near the view, none is ever far
check("members: Discord's virtualized list leaves nothing far to skip", r.membersMaxFar === 0, r.membersMaxFar);
check("members: the plugin never writes the scroll position", r.pluginScrollWritesWithMembers === 0, r.pluginScrollWritesWithMembers);
check("re-attaches when Discord rebuilds the sidebar", r.reattached);
check("the chat is left alone, even with an old chat setting saved", r.chatTouched === 0, r.chatTouched);
check("no chat option, and the member list is off by default", r.defaults.hasChat === false && r.defaults.members === false, r.defaults);
check("a screen reader turning on brings every row back within a second", r.beforeAssistive.far > 0 && r.withAssistive.rows === 0 && r.withAssistive.far === 0, { before: r.beforeAssistive, with: r.withAssistive });
check("and turning it off skips far rows again", r.afterAssistive.far > 0, r.afterAssistive);
check("disabling leaves no trace", r.afterDisable.rows === 0 && r.afterDisable.far === 0 && r.styleRemoved, r.afterDisable);
process.exit(failed ? 1 : 0);
