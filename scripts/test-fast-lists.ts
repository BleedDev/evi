/**
 * Runs the Fast Server List plugin against a synthetic 185-server sidebar in headless Chrome and
 * checks the guarantees that matter: no visible server is ever hidden, no stale state survives a
 * strategy switch or disabling, and rows added later (opened folders) are handled. The chat and a
 * Discord-like virtualized member list get the same checks, and the chat's gain is measured.
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

    // Chat: a message far above changes size while skipped, then scrolls back into range.
    // The message you are reading must not move.
    const chat = document.querySelector<HTMLElement>(".chatList")!;
    const chatScroller = document.querySelector<HTMLElement>(".chatScroller")!;
    for (let i = 0; i < 200; i++) {
        const li = document.createElement("li");
        li.setAttribute("data-list-item-id", `chat-messages___m${i}`);
        li.style.height = `${40 + (i * 37) % 120}px`;
        li.textContent = `message ${i}`;
        chat.append(li);
    }
    await new Promise(r => setTimeout(r, 1200));
    (window as any).__setScroll(chatScroller, chatScroller.scrollHeight);
    await frame();
    await new Promise(r => setTimeout(r, 100));
    out.chatFar = chat.querySelectorAll(".dl-fl-far").length;
    out.chatDebug = { rows: chat.querySelectorAll(".dl-fl-row").length, sh: chatScroller.scrollHeight, ch: chatScroller.clientHeight, top: chatScroller.scrollTop };
    const target = chat.children[20] as HTMLElement;
    out.targetSkipped = target.classList.contains("dl-fl-far");
    target.style.height = "400px"; // edited while skipped
    // Scroll up in wheel-sized steps until the edited message gets revealed, watching the reading position
    let worstJump = 0;
    for (let i = 0; i < 200 && target.classList.contains("dl-fl-far"); i++) {
        const reading = [...chat.children].find(el => el.getBoundingClientRect().top >= chatScroller.getBoundingClientRect().top) as HTMLElement;
        const before = reading.getBoundingClientRect().top;
        (window as any).__setScroll(chatScroller, chatScroller.scrollTop - 100);
        const expected = before + 100;
        await frame();
        worstJump = Math.max(worstJump, Math.abs(reading.getBoundingClientRect().top - expected));
    }
    out.chatRevealed = !target.classList.contains("dl-fl-far");

    // Cost of a resync on a 200-message chat (Discord adds/removes rows all the time)
    const t0 = performance.now();
    for (let i = 0; i < 20; i++) {
        const li = document.createElement("li");
        li.setAttribute("data-list-item-id", `chat-messages___extra${i}`);
        li.style.height = "40px";
        chat.append(li);
        await new Promise(r => requestAnimationFrame(r));
    }
    out.resyncMsPerFrame = +((performance.now() - t0) / 20).toFixed(2);
    // Rows are worked out in idle time
    await new Promise(r => requestIdleCallback(() => requestIdleCallback(r)));
    out.newMessagesMarked = [...chat.children].slice(-20).every(el => el.classList.contains("dl-fl-row"));
    out.chatWorstJump = +worstJump.toFixed(1);

    // The reported bug: scrolling up fast through a chat while Discord loads older messages at the
    // top (and restores the scroll position itself). The user must always be able to keep going up.
    (window as any).__setScroll(chatScroller, chatScroller.scrollHeight);
    await frame();
    let loaded = 0, stuckSteps = 0, prevTop = chatScroller.scrollTop;
    for (let i = 0; i < 400 && loaded < 5; i++) {
        (window as any).__setScroll(chatScroller, chatScroller.scrollTop - 400);
        if (chatScroller.scrollTop < 300) {
            // Discord-like history load: prepend 30 messages, keep the view where it was
            const before = chatScroller.scrollHeight;
            for (let j = 0; j < 30; j++) {
                const li = document.createElement("li");
                li.setAttribute("data-list-item-id", `chat-messages___old${loaded}-${j}`);
                li.style.height = `${40 + (j * 53) % 90}px`;
                chat.prepend(li);
            }
            (window as any).__setScroll(chatScroller, chatScroller.scrollTop + (chatScroller.scrollHeight - before));
            loaded++;
        }
        await frame();
        if (chatScroller.scrollTop >= prevTop && chatScroller.scrollTop > 0) stuckSteps++;
        prevTop = chatScroller.scrollTop;
    }
    out.historyLoads = loaded;
    out.stuckSteps = stuckSteps;
    out.pluginScrollWrites = pluginScrollWrites;

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

// The gain in chat: a relayout (window resize, member list toggled) of a 150-message chat with
// Discord-like messages, before and after the plugin skips the far ones
const gainPage = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await gainPage.setContent(`<!doctype html><style>
    body { margin: 0; font: 16px sans-serif; }
    .chatScroller { height: 700px; overflow-y: auto; width: 800px; }
    .msg { display: flex; gap: 16px; padding: 2px 16px 2px 72px; position: relative; min-height: 44px; }
    .av { position: absolute; left: 16px; width: 40px; height: 40px; border-radius: 50%; }
    .hdr { display: flex; align-items: baseline; gap: 8px; margin: 0; font-size: 16px; }
    .body { display: flex; flex-direction: column; flex: 1; min-width: 0; }
    .content { white-space: pre-wrap; overflow-wrap: break-word; line-height: 1.375; }
    .embed { display: grid; grid-template-columns: auto min-content; max-width: 432px; border-left: 4px solid #5865f2; padding: 8px 16px; margin-top: 4px; border-radius: 4px; }
    .embed img { width: 300px; height: 160px; grid-column: 1 / 3; }
    .reactions { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 4px; }
    .reactions button { display: flex; align-items: center; gap: 6px; padding: 2px 6px; border-radius: 8px; }
</style><main><div class="chatScroller"><ol data-list-id="chat-messages-1-2" class="chatList" style="list-style:none;margin:0;padding:0"></ol></div></main>`);
const gain = await gainPage.evaluate(async (pluginCode) => {
    const icon = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="purple"/></svg>');
    const chat = document.querySelector(".chatList")!;
    const sc = document.querySelector<HTMLElement>(".chatScroller")!;
    const words = "lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua".split(" ");
    for (let i = 0; i < 150; i++) {
        const li = document.createElement("li");
        li.setAttribute("data-list-item-id", `chat-messages-1-2___m${i}`);
        const text = Array.from({ length: 10 + (i * 7) % 60 }, (_, j) => words[(i + j) % words.length]).join(" ");
        const embed = i % 5 === 0 ? `<article class="embed"><div><a>Link ${i}</a><div>${text}</div></div><img src="${icon}"></article>` : "";
        const reactions = i % 3 === 0 ? `<div class="reactions">${`<button><img src="${icon}" width="16" height="16"><span>3</span></button>`.repeat(4)}</div>` : "";
        li.innerHTML = `<div class="msg"><img class="av" src="${icon}"><div class="body"><h3 class="hdr"><span>user${i % 9}</span><time>Today at 12:${i % 60}</time></h3><div class="content">${text} <b>bold</b> <code>code</code></div>${embed}${reactions}</div></div>`;
        chat.append(li);
    }
    sc.scrollTop = sc.scrollHeight;
    const frame = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    await frame();
    const relayout = () => {
        const t0 = performance.now();
        for (let k = 0; k < 40; k++) {
            sc.style.width = `${k % 2 ? 780 : 800}px`;
            void sc.offsetHeight;
        }
        return (performance.now() - t0) / 40;
    };
    relayout();
    const before = relayout();
    const settings: Record<string, any> = { servers: true, chat: true, members: true, margin: 2 };
    const ctx = {
        addStyle(css: string) {
            const el = document.createElement("style");
            el.textContent = css;
            document.head.append(el);
        },
        onDispose() { },
        setInterval: (fn: () => void, ms: number) => void setInterval(fn, ms),
        settings: { get: (k: string) => settings[k], onChange() { } },
    };
    const module = { exports: {} as any };
    new Function("module", "exports", "require", pluginCode)(module, module.exports, () => ({ definePlugin: (d: any) => d, defineStrings: (s: any) => (k: string) => s.en[k] ?? k }));
    const plugin = module.exports.default;
    plugin.start(ctx);
    await new Promise(r => setTimeout(r, 1500));
    await frame();
    relayout();
    return {
        beforeMs: +before.toFixed(2),
        afterMs: +relayout().toFixed(2),
        far: chat.querySelectorAll(".dl-fl-far").length,
        defaults: { chat: plugin.settings.chat.default, members: plugin.settings.members.default },
    };
}, code);

// Discord's chat as it really is: each message an <li> (display: list-item, no padding) around a
// message whose group start has a 17px top margin. That margin passes through the <li> while it's
// rendered; if a hidden row lost it, the chat would change height mid-scroll, and Discord reads that
// as the layout shifting and pulls the view back to where it was (the 2.2.0 scroll-up bug).
const discordPage = await browser.newPage({ viewport: { width: 1000, height: 800 } });
await discordPage.setContent(`<!doctype html><style>
    body { margin: 0; font: 16px sans-serif; }
    .chatScroller { height: 700px; overflow-y: auto; width: 800px; overflow-anchor: none; }
    .chatList { list-style: none; margin: 0; padding: 0; }
    .message { padding: 2px 16px 2px 72px; min-height: 22px; }
    .groupStart { margin-top: 17px; min-height: 44px; }
</style><main><div class="chatScroller"><ol data-list-id="chat-messages-1-2" class="chatList"></ol></div></main>`);
const discordChat = await discordPage.evaluate(async (pluginCode) => {
    const chat = document.querySelector(".chatList")!;
    const sc = document.querySelector<HTMLElement>(".chatScroller")!;
    for (let i = 0; i < 400; i++) {
        const li = document.createElement("li");
        li.setAttribute("data-list-item-id", `chat-messages-1-2___m${i}`);
        li.innerHTML = `<div class="message${i % 3 === 0 ? " groupStart" : ""}">${"message text ".repeat(1 + (i * 7) % 12)}</div>`;
        chat.append(li);
    }
    sc.scrollTop = sc.scrollHeight;
    const frame = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    const settings: Record<string, any> = { servers: false, chat: true, members: false, margin: 2 };
    const ctx = {
        addStyle(css: string) {
            const el = document.createElement("style");
            el.textContent = css;
            document.head.append(el);
        },
        onDispose() { },
        setInterval: (fn: () => void, ms: number) => void setInterval(fn, ms),
        settings: { get: (k: string) => settings[k], onChange() { } },
    };
    const module = { exports: {} as any };
    new Function("module", "exports", "require", pluginCode)(module, module.exports, () => ({ definePlugin: (d: any) => d, defineStrings: (s: any) => (k: string) => s.en[k] ?? k }));
    module.exports.default.start(ctx);
    await new Promise(r => setTimeout(r, 1500));
    await frame();
    // What Discord checks on every scroll: has the chat's height changed since the last scroll?
    let last = sc.scrollHeight, changes = 0, worst = 0;
    sc.addEventListener("scroll", () => {
        const h = sc.scrollHeight;
        if (h !== last) {
            changes++;
            worst = Math.max(worst, Math.abs(h - last));
        }
        last = h;
    });
    for (let i = 0; i < 1000 && sc.scrollTop > 0; i++) {
        sc.scrollTop -= 100;
        await frame();
    }
    return { far: chat.querySelectorAll(".dl-fl-far").length, reachedTop: sc.scrollTop === 0, heightChanges: changes, worstPx: worst, rowTag: chat.querySelector(".dl-fl-row")?.tagName };
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
check("chat: far messages are skipped", r.chatFar > 50 && r.targetSkipped, { far: r.chatFar, ...r.chatDebug });
check("chat: a message resized while skipped doesn't make the chat jump", r.chatRevealed && r.chatWorstJump <= 1, { revealed: r.chatRevealed, worstJumpPx: r.chatWorstJump });
check("chat: new messages are picked up", r.newMessagesMarked);
check("resync stays cheap (frame time with a new message every frame)", r.resyncMsPerFrame < 20, { msPerFrame: r.resyncMsPerFrame });
check("fast scroll up through loading history never gets stuck", r.historyLoads === 5 && r.stuckSteps <= r.historyLoads, { loads: r.historyLoads, stuckSteps: r.stuckSteps });
check("the plugin never writes the scroll position", r.pluginScrollWrites === 0, r.pluginScrollWrites);
check("members: rows are tracked", r.membersMarked > 0, r.membersMarked);
check("members: no visible member is ever hidden", r.membersWorstHiddenVisible === 0, r.membersWorstHiddenVisible);
// Why the member list is off by default: Discord renders only rows near the view, none is ever far
check("members: Discord's virtualized list leaves nothing far to skip", r.membersMaxFar === 0, r.membersMaxFar);
check("members: the plugin never writes the scroll position", r.pluginScrollWritesWithMembers === 0, r.pluginScrollWritesWithMembers);
check("re-attaches when Discord rebuilds the sidebar", r.reattached);
check("chat: skipping far messages makes a relayout much cheaper", gain.far > 100 && gain.afterMs < gain.beforeMs / 2, gain);
check("chat, as Discord builds it: far messages are skipped", discordChat.far > 100, discordChat);
check("chat, as Discord builds it: scrolling up never changes its height (Discord would pull the view back)", discordChat.heightChanges === 0 && discordChat.reachedTop, discordChat);
check("chat and the member list are off by default", gain.defaults.chat === false && gain.defaults.members === false, gain.defaults);
check("a screen reader turning on brings every row back within a second", r.beforeAssistive.far > 0 && r.withAssistive.rows === 0 && r.withAssistive.far === 0, { before: r.beforeAssistive, with: r.withAssistive });
check("and turning it off skips far rows again", r.afterAssistive.far > 0, r.afterAssistive);
check("disabling leaves no trace", r.afterDisable.rows === 0 && r.afterDisable.far === 0 && r.styleRemoved, r.afterDisable);
process.exit(failed ? 1 : 0);
