import { describe, expect, test } from "bun:test";

import type { Replacement } from "../src/renderer/patching/source";
import { canonicalizeMatch, matchesFind } from "../src/renderer/patching/source";
import { PATCHES } from "../plugins/code-block-tools/patches";
import {
    codeFilename, extensionFor, fileExtension, gutterCss, gutterText, isJson, isTextFile, jsonTokens, languageOf, lineCount, MAX_JSON_CHARS,
    prettyJson,
} from "../plugins/code-block-tools/tools";

// Verbatim from Discord's web build (2026-10-02): the code block markup rule, the plaintext preview,
// the component holding its state, and the preview's text renderer
const SOURCES = {
    codeBlock: "codeBlock:{react(e,t,r){function a(){return(0,i.jsx)(\"code\",{className:s()(es.kw,\"hljs\"),children:(0,D.t)(e,t,r)})}return(0,i.jsx)(\"pre\",{children:(0,i.jsxs)(\"div\",{className:ea.Hy,children:[y.p5?(0,i.jsx)(\"div\",{className:ea.lB,children:(0,i.jsx)(ec,{text:e.content})}):null,(0,i.jsx)(R.l,{location:\"MarkupReactRules\",code:e.content,lang:e.lang,className:s()(es.kw,\"hljs\"),highlightedClassName:er.H,children:(0,i.jsx)(E.c2,{createPromise:()=>Promise.all([n.e(\"818449\"),n.e(\"175134\")]).then(n.bind(n,981776)),webpackId:981776,renderFallback:a,render:t=>{if(!(e.lang&&t.hasLanguage(e.lang)))return a();{let n=t.highlight(e.lang,e.content,!0);return null==n?a():(0,i.jsx)(\"code\",{className:s()(es.kw,\"hljs\",n.language),dangerouslySetInnerHTML:{__html:n.value}})}}})})]})},r.key)}}",
    preview: "function eS(e){let{url:t,fileName:n,fileSize:i,fileContents:a,expanded:s,setExpanded:o,language:d,setLanguage:c,wordWrap:u,setWordWrap:_,renderMarkdown:E,setRenderMarkdown:A,bytesLeft:h,className:f}=e,p=a?.split(\"\\n\"),T=p?.length??0,m=s?100:6,g=0===h,N=E&&eA.has(d),C=\"\";g&&s&&T>m?C=\"\\n...\":g||(C=\"...\"),\"\"!==C&&(g?C+=\" \"+ec.intl.formatToPlainString(ec.t.DQnFp2,{lines:T-m}):C+=\" \"+ec.intl.formatToPlainString(ec.t[\"1+gGcK\"],{formattedBytes:(0,eo.up)(h)}));let O=p?.slice(0,m).join(\"\\n\")??\"\",R=s||m<T;return(0,r.jsxs)(\"div\",{className:l()(f,eE.kL),children:[(0,r.jsx)(S.Ip,{className:l()(eE.FS,{[eE.KQ]:!s&&!N}),style:{\"--custom-plaintext-preview-collapsed-lines\":6},children:null==a?(0,r.jsx)(I.y,{className:eE.u1}):N?(0,r.jsx)(eh,{text:O,notice:C.trim()}):(0,r.jsx)(eI,{text:O+C,language:d,wordWrap:u})}),(0,r.jsxs)(\"div\",{className:eE.qr,role:\"group\",\"aria-label\":ec.intl.string(ec.t.TlXA8e),children:[R?(0,r.jsx)(ef,{expanded:s,setExpanded:o,numLines:T,isWholeFile:g}):null,(0,r.jsx)(ep,{fileName:n,fileSize:i}),(0,r.jsx)(\"div\",{className:eE.Kb}),(0,r.jsx)(eT,{language:d,setLanguage:c,align:\"top\"}),null!=a?(0,r.jsx)(eg,{url:t,fileName:n,fileSize:i,language:d,wordWrap:u,renderMarkdown:E,fileContents:a,bytesLeft:h}):null,(0,r.jsx)(em,{wordWrap:u,setWordWrap:_,language:d,renderMarkdown:E,setRenderMarkdown:A,url:t,fileName:n})]})]})}",
    state: "function(e){let{url:t,fileName:n,fileSize:i,contentType:s,className:o,onClick:d,onContextMenu:c}=e,[u,_]=a.useState(!1),[E,A]=a.useState(n.split(\".\").slice(-1)[0]),[h,I]=a.useState(!0),[f,p]=a.useState(!0),{fileContents:T,bytesLeft:m,hadError:g}=function(e,t){let[n,i]=a.useState(!1),[r,s]=a.useState(null),[l,o]=a.useState(1);return a.useEffect(()=>{!async function(){try{let n=await fetch(e,{headers:{Range:\"bytes=0-50000\",Accept:\"text/plain\"}}),r=(function(e){let t=e?.split(\"charset=\").slice(-1)[0]??eu;try{return new TextDecoder(t)}catch(n){if(e?.startsWith(\"text\")||t.toLowerCase().includes(\"utf\"))return new TextDecoder(eu);throw n}})(t).decode(await n.arrayBuffer()),a=n.headers.get(\"content-range\")??\"0\",l=n.headers.get(\"content-length\")??\"1\",d=parseInt(a.split(\"/\")[1]),c=Number.isNaN(d)?0:d-parseInt(l),u=0===c?r:r.slice(0,-1);s((0,ed.sJ)(u)),o(c),i(!1)}catch(e){o(0),i(!0)}}()},[e,t]),{fileContents:r,bytesLeft:l,hadError:n}}(t,s);return g?(0,r.jsx)(G.A,{url:t,fileName:n,fileSize:i,onClick:d,onContextMenu:c,className:o}):(0,r.jsx)(eS,{url:t,fileName:n,fileSize:i,fileContents:T,bytesLeft:m,expanded:u,setExpanded:_,language:E,setLanguage:A,wordWrap:h,setWordWrap:I,renderMarkdown:f,setRenderMarkdown:p,className:l()(eE.mr,o)})}",
    text: "function d(e){let{text:t,language:r,className:d}=e,c=a()(o.kw,\"hljs\",d);function u(){return(0,i.jsx)(\"code\",{className:c,children:t})}return(0,i.jsx)(\"pre\",{children:(0,i.jsx)(l.l,{location:\"PlaintextFilePreview\",code:t,lang:r,className:c,children:(0,i.jsx)(s.c2,{createPromise:()=>Promise.all([n.e(\"818449\"),n.e(\"175134\")]).then(n.bind(n,981776)),webpackId:981776,renderFallback:u,render:e=>{if(null==r||!e.hasLanguage(r))return u();let n=e.highlight(r,t,!0);return null==n?u():(0,i.jsx)(\"code\",{className:a()(c,n.language),dangerouslySetInnerHTML:{__html:n.value}})}})})})}",
};

type AnyPatch = { find: string; replace: Replacement | Replacement[]; };

/** Applies a patch like Evi does, each replacement matching exactly once */
function apply(patch: AnyPatch, code: string, self = "S") {
    expect(matchesFind(code, patch.find)).toBe(true);
    let next = code;
    for (const r of ([] as Replacement[]).concat(patch.replace)) {
        const re = canonicalizeMatch(r.match) as RegExp;
        expect(next.match(new RegExp(re.source, "g"))?.length).toBe(1);
        const before = next;
        next = next.replace(re, (r.with as string).replaceAll("$self", self));
        expect(next).not.toBe(before);
    }
    return next;
}

/** Throws if the code isn't valid JavaScript */
const parses = (code: string) => new Function(`return (${code});`);

describe("patches on Discord's code", () => {
    test("code block: its container gets our props, our tools go first, and Discord's Copy steps aside", () => {
        const rule = `{${SOURCES.codeBlock}}`;
        expect(matchesFind(`location:"MarkupReactRules"${rule}`, PATCHES.codeBlock.find)).toBe(true);
        const out = apply({ ...PATCHES.codeBlock, find: "codeBlock:" }, rule);
        expect(out).toContain('(0,i.jsxs)("div",{...S?.containerProps?.(e),className:ea.Hy,children:[S?.renderCodeTools?.(e),!S?.ownsCopy?.()&&y.p5?');
        expect(() => parses(out)).not.toThrow();
    });

    test("plaintext preview: shows useText's text and gets our footer buttons after the language picker", () => {
        const out = apply({ ...PATCHES.preview, replace: PATCHES.preview.replace[0] }, SOURCES.preview);
        expect(out).toContain("p=(a=S?.useText?.(t,a)??a)?.split(");
        expect(out).toContain('(0,r.jsx)(eT,{language:d,setLanguage:c,align:"top"}),S?.renderPreviewTools?.({url:t,fileName:n,text:a,bytesLeft:h})??null,null!=a?');
        expect(() => parses(out)).not.toThrow();
    });

    test("plaintext preview state: word wrap starts off when numbersFirst says so", () => {
        const code = `"--custom-plaintext-preview-collapsed-lines";${SOURCES.state}`;
        const out = apply({ ...PATCHES.preview, replace: PATCHES.preview.replace[1] }, code);
        expect(out).toContain("[h,I]=a.useState(!S?.numbersFirst?.()),[f,p]=a.useState(!0),{fileContents:");
        expect(() => parses(out.slice(out.indexOf("function")))).not.toThrow();
    });

    test("both preview replacements apply to the one module", () => {
        const module = `${SOURCES.preview};let eC=a.memo(${SOURCES.state})`;
        expect(() => apply(PATCHES.preview, module)).not.toThrow();
    });

    test("plaintext text: preProps spread onto its <pre> with the shown text and class", () => {
        const out = apply(PATCHES.text, SOURCES.text);
        expect(out).toContain('("pre",{...S?.preProps?.(t,d),children:(0,i.jsx)(l.l,{location:"PlaintextFilePreview"');
        expect(() => parses(out)).not.toThrow();
    });

    test("with the plugin gone, patched code behaves like Discord's", () => {
        // $self is undefined: every call short-circuits to Discord's own value
        const S: any = undefined;
        const a = "text";
        expect(S?.useText?.("u", a) ?? a).toBe("text");
        expect(!S?.numbersFirst?.()).toBe(true);
        expect({ ...S?.preProps?.("t", "c"), children: 1 }).toEqual({ children: 1 });
        expect(S?.renderCodeTools?.({})).toBeUndefined();
        expect({ ...S?.containerProps?.({}), className: "c" }).toEqual({ className: "c" });
        // Discord's own Copy shows: !undefined && y.p5 is y.p5
        expect(!S?.ownsCopy?.() && "copy").toBe("copy");
    });
});

describe("extensions and file names", () => {
    test("a code block's language picks its extension", () => {
        expect(extensionFor("py")).toBe("py");
        expect(extensionFor("Python")).toBe("py");
        expect(extensionFor("javascript")).toBe("js");
        expect(extensionFor("c++")).toBe("cpp");
        expect(extensionFor("yaml")).toBe("yml");
        expect(extensionFor(" json ")).toBe("json");
    });
    test("no language or an unknown one is .txt", () => {
        expect(extensionFor(undefined)).toBe("txt");
        expect(extensionFor("")).toBe("txt");
        expect(extensionFor("klingon")).toBe("txt");
        expect(extensionFor("../../evil")).toBe("txt");
    });
    test("downloads are code.<ext>", () => {
        expect(codeFilename("rs")).toBe("code.rs");
        expect(codeFilename(null)).toBe("code.txt");
    });
    test("a file's extension", () => {
        expect(fileExtension("server.LOG")).toBe("log");
        expect(fileExtension("archive.tar.gz")).toBe("gz");
        expect(fileExtension(".gitignore")).toBe("gitignore");
        expect(fileExtension("Makefile")).toBe("");
        expect(fileExtension("dir/notes.md")).toBe("md");
        expect(fileExtension(undefined)).toBe("");
        expect(languageOf("data.json")).toBe("json");
    });
});

describe("text files", () => {
    test("text by extension", () => {
        for (const name of ["a.txt", "a.log", "a.json", "a.md", "a.csv", "a.js", "a.ts", "a.py", "a.lua", "a.css", "a.html", "a.xml", "a.yml", "a.ini", "a.cfg", "a.toml", ".env"]) {
            expect(isTextFile(name)).toBe(true);
        }
    });
    test("text by content type, whatever the name", () => {
        expect(isTextFile("noext", "text/plain; charset=utf-8")).toBe(true);
        expect(isTextFile("data", "application/json")).toBe(true);
    });
    test("not text", () => {
        for (const name of ["a.png", "a.zip", "a.exe", "a.mp4", "a.pdf", "Makefile", ""]) expect(isTextFile(name)).toBe(false);
        expect(isTextFile("a.bin", "application/octet-stream")).toBe(false);
    });
});

describe("JSON", () => {
    test("marked or shaped like JSON, and parses", () => {
        expect(isJson('{"a":1}', "json")).toBe(true);
        expect(isJson('{"a":1}')).toBe(true);
        expect(isJson(" [1, 2] ")).toBe(true);
        expect(isJson("42", "json")).toBe(true);
    });
    test("not JSON", () => {
        expect(isJson("{a:1}")).toBe(false);
        expect(isJson("42")).toBe(false);
        expect(isJson('"text"')).toBe(false);
        expect(isJson("")).toBe(false);
        expect(isJson(`[${"1,".repeat(MAX_JSON_CHARS)}1]`)).toBe(false);
    });
    test("pretty prints with two spaces", () => {
        expect(prettyJson('{"a":[1,{"b":null}]}')).toBe('{\n  "a": [\n    1,\n    {\n      "b": null\n    }\n  ]\n}');
    });
    test("already pretty, or not JSON: nothing to do", () => {
        expect(prettyJson('{\n  "a": 1\n}')).toBeNull();
        expect(prettyJson("nope")).toBeNull();
    });
    test("tokens put the text back together and colour keys, strings, numbers and literals", () => {
        const text = '{\n  "key": "va\\"l",\n  "n": -1.5e3,\n  "ok": true,\n  "x": null\n}';
        const tokens = jsonTokens(text);
        expect(tokens.map(tok => tok.text).join("")).toBe(text);
        const cls = (s: string) => tokens.find(tok => tok.text === s)?.className;
        expect(cls('"key"')).toBe("hljs-attr");
        expect(cls('"va\\"l"')).toBe("hljs-string");
        expect(cls("-1.5e3")).toBe("hljs-number");
        expect(cls("true")).toBe("hljs-literal");
        expect(cls("null")).toBe("hljs-literal");
        expect(cls("{")).toBe("hljs-punctuation");
    });
});

describe("line numbers", () => {
    test("counts lines as shown", () => {
        expect(lineCount("")).toBe(1);
        expect(lineCount("a")).toBe(1);
        expect(lineCount("a\nb")).toBe(2);
        expect(lineCount("a\nb\n")).toBe(2);
        expect(lineCount("a\n\nb")).toBe(3);
    });
    test("the gutter beside a code block", () => {
        expect(gutterText(3)).toBe("1\n2\n3");
        expect(gutterText(0)).toBe("1");
    });
    test("the gutter beside a text file, as a CSS string", () => {
        expect(gutterCss("a\nb\nc")).toBe('"1\\A 2\\A 3"');
        expect(gutterCss("one")).toBe('"1"');
    });
    test("Discord's '... more lines' notice gets no number", () => {
        expect(gutterCss("a\nb\n... 120 more lines")).toBe('"1\\A 2\\A  "');
        expect(gutterCss("a\nb\n...")).toBe('"1\\A 2\\A  "');
        // A real line that happens to start with dots keeps its number
        expect(gutterCss("a\n...rest of a sentence")).toBe('"1\\A 2"');
        // Code blocks have no notice: a last line of dots is a line like any other
        expect(gutterCss("a\nb\n...", false)).toBe('"1\\A 2\\A 3"');
    });
});
