/**
 * Code Block Tools' source patches, pure so tests/codeBlockTools.test.ts can apply them to Discord's
 * code (checked 2026-10-28). What each one hooks is described in index.tsx.
 */
import type { SourcePatch } from "@evi/api";

export const PATCHES = {
    /**
     * Discord's code block: its container gets our data attributes (line numbers), our buttons go first
     * in it, and Discord's own Copy button steps aside while we're running (ours sits in its place).
     * Since 2026-10-28 the rule is an arrow function, with no location:"MarkupReactRules" any more:
     *     codeBlock:{react:(e,t,n)=>(0,i.jsx)("pre",{children:(0,i.jsxs)("div",{className:er.Hy,children:[L.p5?...
     */
    codeBlock: {
        find: '"hljs"),highlightedClassName:',
        replace: {
            match: /(codeBlock:\{react:?\((\i),\i,\i\)(?:=>|\{)[^]{0,600}?"div",\{)(className:\i\.\i,children:\[)(\i\.\i\?)/,
            with: "$1...$self?.containerProps?.($2),$3$self?.renderCodeTools?.($2),!$self?.ownsCopy?.()&&$4",
        },
    },
    /** Discord's plaintext file preview: the text it shows, buttons in its footer, word wrap off by default */
    preview: {
        find: '"--custom-plaintext-preview-collapsed-lines"',
        replace: [
            {
                match: /(let\{url:(\i),fileName:(\i),fileSize:\i,fileContents:(\i),[^}]*?bytesLeft:(\i),[^}]*\}=\i,\i=)\4(\?\.split\("\\n"\)[^]*?)(\(0,\i\.jsx\)\(\i,\{language:\i,setLanguage:\i,align:"top"\}\))/,
                with: "$1($4=$self?.useText?.($2,$4)??$4)$6$7,$self?.renderPreviewTools?.({url:$2,fileName:$3,text:$4,bytesLeft:$5})??null",
            },
            {
                match: /(\[\i,\i\]=(\i)\.useState\()!0(\),\[\i,\i\]=\2\.useState\(!0\),\{fileContents:)/,
                with: "$1!$self?.numbersFirst?.()$3",
            },
        ],
    },
    /**
     * The text in a plaintext preview (and its full-screen view): line numbers for the code in its <pre>.
     * Since 2026-10-28 it has no location:"PlaintextFilePreview" any more:
     *     let{text:t,language:n,className:s}=e,c=a()(r.kw,"hljs",s);return(0,l.jsx)("pre",{children:(0,l.jsx)(i.E,{code:t,lang:n,className:c})})
     */
    text: {
        find: /let\{text:\i,language:\i,className:\i\}=\i,\i=\i\(\)\(\i\.\i,"hljs",\i\)/,
        replace: {
            match: /(let\{text:(\i),language:\i,className:(\i)\}=\i,[^]{0,300}?"pre",\{)(children:\(0,\i\.jsx\)\(\i\.\i,\{(?:location:"PlaintextFilePreview",)?code:\2,)/,
            with: "$1...$self?.preProps?.($2,$3),$4",
        },
    },
} satisfies Record<string, SourcePatch>;
