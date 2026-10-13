/**
 * Code blocks and text files get Copy, Download, Pretty print for JSON and line numbers, drawn the way
 * Discord draws its own buttons.
 *
 * Checked against Discord's code on 2026-10-11:
 * - Code blocks: Discord's markup rule `codeBlock:{react(e,t,r){…return <pre><div class=codeContainer>
 *   [y.p5 ? <div class=codeActions><Copy/></div> : null, <highlighted code/>]…}}` (next to
 *   location:"MarkupReactRules"). Its codeActions show on hover, 8px from the top and 4px from the end,
 *   with a 16px icon that turns into a checkmark once copied. Our buttons take that spot and look (Discord's
 *   Copy steps aside while we run), the container gets our data attributes, and Pretty print adds a code
 *   element of ours beside Discord's, which then hides.
 * - Text files Discord previews (the plaintext preview, the first 50 KB with a language picker and a
 *   ⋯ menu): Copy and Pretty print join its footer after the language picker, 18px icons 16px apart like
 *   Discord's own; the text it shows goes through useText (pretty printed when asked), and its `<pre>`
 *   gets the line numbers. Numbered lines can't wrap, so with line numbers on the preview starts with
 *   Discord's word wrap off.
 * - Text files Discord shows as a plain download card (its generic file attachment): a Preview button
 *   in the card opens our own preview of the first 512 KB under it.
 *
 * Line numbers are a CSS string floated at the start of the code element itself, so they share its font,
 * padding and line height without anyone measuring them; html.dl-cbt-numbers turns them on.
 */
import { Components, definePlugin, filters, React } from "@evi/api";
import type { PluginContext } from "@evi/api";

import { PATCHES } from "./patches";
import { t } from "./strings";
import { codeFilename, gutterCss, isJson, isTextFile, jsonTokens, languageOf, MAX_FILE_BYTES, prettyJson } from "./tools";

const settings = {
    lineNumbers: {
        type: "boolean",
        get label() { return t("settings.lineNumbers"); },
        get description() { return t("settings.lineNumbers.description"); },
        default: true,
    },
    filePreview: {
        type: "boolean",
        get label() { return t("settings.filePreview"); },
        get description() { return t("settings.filePreview.description"); },
        default: true,
    },
} as const;

let ctx: PluginContext<typeof settings> | undefined;

/** Discord's generic file attachment card: ({ url, fileName, fileSize, onContextMenu, renderAdjacentContent }) */
const fileCardFilter = filters.byCode("renderAdjacentContent:", ".filesize(", "href:", "onContextMenu:");

/** Attachment URLs of the text files shown pretty printed */
const prettyFiles = new Set<string>();
let version = 0;
const listeners = new Set<() => void>();
const subscribe = (cb: () => void) => {
    listeners.add(cb);
    return () => void listeners.delete(cb);
};
function bump() {
    version++;
    listeners.forEach(l => l());
}
const useVersion = () => React.useSyncExternalStore(subscribe, () => version);

function togglePrettyFile(url: string) {
    if (prettyFiles.has(url)) prettyFiles.delete(url);
    else prettyFiles.add(url);
    bump();
}

/** Pretty printed text, cached per text: the preview re-renders on every hover */
const prettyCache = new Map<string, string | null>();
function prettyCached(text: string) {
    if (!prettyCache.has(text)) {
        if (prettyCache.size > 20) prettyCache.delete(prettyCache.keys().next().value!);
        prettyCache.set(text, prettyJson(text));
    }
    return prettyCache.get(text) ?? null;
}

/** Props with a text's line numbers, kept per text: messages and previews re-render often */
type GutterProps = { "data-dl-cbt-lines": ""; style: Record<string, string>; };
const gutterCache = new Map<string, GutterProps>();
function gutterProps(text: string, previewNotice: boolean) {
    const key = (previewNotice ? "p" : "c") + text;
    let props = gutterCache.get(key);
    if (!props) {
        if (gutterCache.size > 300) gutterCache.delete(gutterCache.keys().next().value!);
        props = { "data-dl-cbt-lines": "", style: { "--dl-cbt-gutter": gutterCss(text, previewNotice) } };
        gutterCache.set(key, props);
    }
    return props;
}

/** Copies text; whether it worked. A cut-off copy says so, a whole one shows a checkmark instead. */
async function copyText(text: string, partOf?: number) {
    try {
        const native = (window as any).DiscordNative?.clipboard;
        if (typeof native?.copy === "function") native.copy(text);
        else await navigator.clipboard.writeText(text);
        if (partOf) ctx?.toast(t("copiedPart", { size: formatBytes(partOf) }), { type: "info" });
        return true;
    } catch (err) {
        ctx?.logger.warn("Copying failed", err);
        ctx?.toast(t("copyFailed"), { type: "failure" });
        return false;
    }
}

/** Saves text with the desktop app's save dialog, or else a browser download */
async function saveText(text: string, filename: string) {
    const data = new TextEncoder().encode(text);
    try {
        const fileManager = (window as any).DiscordNative?.fileManager;
        if (typeof fileManager?.saveWithDialog === "function") {
            await fileManager.saveWithDialog(data, filename);
            return;
        }
        const url = URL.createObjectURL(new Blob([data], { type: "text/plain" }));
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        a.style.display = "none";
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } catch (err) {
        ctx?.logger.warn("Saving failed", err);
        ctx?.toast(t("downloadFailed"), { type: "failure" });
    }
}

const formatBytes = (n: number) => n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`;

/** Up to MAX_FILE_BYTES of an attachment, and whether there's more */
async function fetchText(url: string): Promise<{ text: string; partial: boolean; }> {
    const res = await fetch(url, { headers: { Range: `bytes=0-${MAX_FILE_BYTES - 1}`, Accept: "text/plain" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    const total = Number(res.headers.get("content-range")?.split("/")[1]);
    const partial = bytes.length >= MAX_FILE_BYTES || (Number.isFinite(total) && total > bytes.length);
    // A cut can land inside a character: drop what's left of it rather than showing �
    return { text: new TextDecoder("utf-8", { fatal: false }).decode(bytes.slice(0, MAX_FILE_BYTES)).replace(/\uFFFD$/, ""), partial };
}

/** Discord's own icons (CopyIcon, CheckmarkLargeIcon, DownloadIcon, EyeIcon), and curly braces for Pretty print */
const ICONS: Record<string, { d: string; evenOdd?: boolean; }[]> = {
    copy: [
        { d: "M3 16a1 1 0 0 1-1-1v-5a8 8 0 0 1 8-8h5a1 1 0 0 1 1 1v.5a.5.5 0 0 1-.5.5H10a6 6 0 0 0-6 6v5.5a.5.5 0 0 1-.5.5H3Z" },
        { d: "M6 18a4 4 0 0 0 4 4h8a4 4 0 0 0 4-4v-4h-3a5 5 0 0 1-5-5V6h-4a4 4 0 0 0-4 4v8Z" },
        { d: "M21.73 12a3 3 0 0 0-.6-.88l-4.25-4.24a3 3 0 0 0-.88-.61V9a3 3 0 0 0 3 3h2.73Z" },
    ],
    check: [{ d: "M21.7 5.3a1 1 0 0 1 0 1.4l-12 12a1 1 0 0 1-1.4 0l-6-6a1 1 0 1 1 1.4-1.4L9 16.58l11.3-11.3a1 1 0 0 1 1.4 0Z" }],
    download: [{ d: "M12 2a1 1 0 0 1 1 1v10.59l3.3-3.3a1 1 0 1 1 1.4 1.42l-5 5a1 1 0 0 1-1.4 0l-5-5a1 1 0 1 1 1.4-1.42l3.3 3.3V3a1 1 0 0 1 1-1ZM3 20a1 1 0 1 0 0 2h18a1 1 0 1 0 0-2H3Z" }],
    pretty: [{ d: "M8 3a3 3 0 0 0-3 3v3.17c0 .53-.21 1.04-.59 1.42L3.3 11.7a1 1 0 0 0 0 1.42l1.12 1.12c.37.37.58.88.58 1.41V18a3 3 0 0 0 3 3h1a1 1 0 1 0 0-2H8a1 1 0 0 1-1-1v-2.35c0-1.06-.42-2.08-1.17-2.83L5.41 12.4l.42-.42A4 4 0 0 0 7 9.17V6a1 1 0 0 1 1-1h1a1 1 0 0 0 0-2H8Zm8 0a3 3 0 0 1 3 3v3.17c0 .53.21 1.04.59 1.42l1.12 1.11a1 1 0 0 1 0 1.42l-1.12 1.12c-.37.37-.58.88-.58 1.41V18a3 3 0 0 1-3 3h-1a1 1 0 1 1 0-2h1a1 1 0 0 0 1-1v-2.35c0-1.06.42-2.08 1.17-2.83l.42-.42-.42-.42A4 4 0 0 1 17 9.17V6a1 1 0 0 0-1-1h-1a1 1 0 1 1 0-2h1Z" }],
    preview: [
        { d: "M15.56 11.77c.2-.1.44.02.44.23a4 4 0 1 1-4-4c.21 0 .33.25.23.44a2.5 2.5 0 0 0 3.32 3.32Z" },
        { d: "M22.89 11.7c.07.2.07.4 0 .6C22.27 13.9 19.1 21 12 21c-7.11 0-10.27-7.11-10.89-8.7a.83.83 0 0 1 0-.6C1.73 10.1 4.9 3 12 3c7.11 0 10.27 7.11 10.89 8.7Zm-4.5-3.62A15.11 15.11 0 0 1 20.85 12c-.38.88-1.18 2.47-2.46 3.92C16.87 17.62 14.8 19 12 19c-2.8 0-4.87-1.38-6.39-3.08A15.11 15.11 0 0 1 3.15 12c.38-.88 1.18-2.47 2.46-3.92C7.13 6.38 9.2 5 12 5c2.8 0 4.87 1.38 6.39 3.08Z", evenOdd: true },
    ],
};

/** Icon sizes Discord uses here: xs in code blocks, sm in the preview footer, md in file cards */
const SIZE = { code: 16, footer: 18, card: 24 } as const;
const CLASS = { code: "dl-cbt-btn", footer: "dl-cbt-btn dl-cbt-footer-btn", card: "dl-cbt-btn dl-cbt-card-btn" } as const;
type Place = keyof typeof SIZE;

function Action({ label, icon, onClick, pressed, place }: { label: string; icon: keyof typeof ICONS; onClick(): void; pressed?: boolean; place: Place; }) {
    const size = SIZE[place];
    const button = (
        <button
            type="button"
            className={CLASS[place]}
            aria-label={label}
            aria-pressed={pressed}
            onClick={e => {
                e.stopPropagation();
                onClick();
            }}
        >
            <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
                {ICONS[icon].map(p => <path key={p.d} fill="currentColor" fillRule={p.evenOdd ? "evenodd" : undefined} clipRule={p.evenOdd ? "evenodd" : undefined} d={p.d} />)}
            </svg>
        </button>
    );
    const Tooltip = Components.Tooltip;
    return Tooltip ? <Tooltip text={label} position="top">{button}</Tooltip> : button;
}

/** Copy, showing a checkmark for a moment once it worked, like Discord's code block Copy */
function CopyAction({ copy, place }: { copy(): Promise<boolean>; place: Place; }) {
    const [copied, setCopied] = React.useState(false);
    const timer = React.useRef<ReturnType<typeof setTimeout>>(undefined);
    React.useEffect(() => () => clearTimeout(timer.current), []);
    const onClick = async () => {
        if (!await copy()) return;
        setCopied(true);
        clearTimeout(timer.current);
        timer.current = setTimeout(() => setCopied(false), 2000);
    };
    return <Action place={place} label={t(copied ? "copied" : "copy")} icon={copied ? "check" : "copy"} onClick={() => void onClick()} />;
}

/** Coloured like highlight.js would, so Discord's code theme styles it */
function JsonCode({ text, className, style }: { text: string; className?: string; style?: Record<string, string>; }) {
    const tokens = React.useMemo(() => jsonTokens(text), [text]);
    return <code className={className} style={style as React.CSSProperties}>{tokens.map((tok, i) => tok.className ? <span key={i} className={tok.className}>{tok.text}</span> : tok.text)}</code>;
}

interface CodeNode { content?: string; lang?: string; }

function CodeTools({ node }: { node: CodeNode; }) {
    const content = typeof node.content === "string" ? node.content : "";
    const [pretty, setPretty] = React.useState(false);
    const json = React.useMemo(() => isJson(content, node.lang), [content, node.lang]);
    const prettyText = React.useMemo(() => pretty && json ? prettyJson(content) : null, [pretty, json, content]);
    const shown = prettyText ?? content;

    // Pretty printed: Discord's code steps aside for ours. Nothing touches the DOM until it's asked for.
    const barRef = React.useRef<HTMLDivElement>(null);
    const showsPretty = !!prettyText;
    React.useLayoutEffect(() => {
        const host = barRef.current?.parentElement;
        if (!showsPretty || !host) return;
        host.setAttribute("data-dl-cbt-pretty", "");
        return () => host.removeAttribute("data-dl-cbt-pretty");
    }, [showsPretty]);

    const lang = prettyText ? "json" : node.lang;
    return (
        <>
            <div className="dl-cbt-bar" role="group" ref={barRef}>
                {json && <Action place="code" label={t(pretty ? "original" : "pretty")} icon="pretty" pressed={pretty} onClick={() => setPretty(p => !p)} />}
                <Action place="code" label={t("download")} icon="download" onClick={() => void saveText(shown, codeFilename(lang))} />
                <CopyAction place="code" copy={() => copyText(shown)} />
            </div>
            {prettyText && <JsonCode text={prettyText} className="hljs dl-cbt-pretty" style={gutterProps(prettyText, false).style} />}
        </>
    );
}

function PreviewTools({ url, text, bytesLeft }: { url: string; fileName: string; text: string | null; bytesLeft: number; }) {
    useVersion();
    // Pretty printing needs the whole file, and Discord reads only the first 50 KB. Parsed once per
    // text: the preview re-renders on every hover.
    const json = React.useMemo(() => text != null && bytesLeft === 0 && isJson(text, "json"), [text, bytesLeft]);
    if (text == null) return null;
    const pretty = prettyFiles.has(url);
    const copy = async () => {
        if (bytesLeft === 0) return copyText(text);
        try {
            const whole = await fetchText(url);
            return copyText(whole.text, whole.partial ? MAX_FILE_BYTES : undefined);
        } catch (err) {
            ctx?.logger.warn("Reading the file failed", err);
            ctx?.toast(t("copyFailed"), { type: "failure" });
            return false;
        }
    };
    return (
        <>
            <CopyAction place="footer" copy={copy} />
            {json && <Action place="footer" label={t(pretty ? "original" : "pretty")} icon="pretty" pressed={pretty} onClick={() => togglePrettyFile(url)} />}
        </>
    );
}

type Loaded = { state: "loading"; } | { state: "error"; } | { state: "done"; text: string; partial: boolean; };

function FilePane({ url, fileName }: { url: string; fileName: string; }) {
    const [loaded, setLoaded] = React.useState<Loaded>({ state: "loading" });
    const [pretty, setPretty] = React.useState(false);
    React.useEffect(() => {
        let live = true;
        fetchText(url).then(r => live && setLoaded({ state: "done", ...r }), err => {
            ctx?.logger.warn("Reading the file failed", err);
            if (live) setLoaded({ state: "error" });
        });
        return () => void (live = false);
    }, [url]);

    // Up to 512 KB: parsed, pretty printed and numbered once, not on every render
    const text = loaded.state === "done" ? loaded.text : "";
    const partial = loaded.state === "done" && loaded.partial;
    const json = React.useMemo(() => !!text && !partial && isJson(text, languageOf(fileName)), [text, partial, fileName]);
    const prettyText = React.useMemo(() => pretty && json ? prettyJson(text) : null, [pretty, json, text]);
    const shown = prettyText ?? text;

    if (loaded.state === "loading") return <div className="dl-cbt-pane dl-cbt-note">{t("preview.loading")}</div>;
    if (loaded.state === "error") return <div className="dl-cbt-pane dl-cbt-note dl-cbt-error">{t("preview.error")}</div>;

    return (
        <div className="dl-cbt-pane">
            <div className="dl-cbt-bar" role="group">
                {json && <Action place="code" label={t(pretty ? "original" : "pretty")} icon="pretty" pressed={pretty} onClick={() => setPretty(p => !p)} />}
                <CopyAction place="code" copy={() => copyText(shown, loaded.partial ? MAX_FILE_BYTES : undefined)} />
            </div>
            <pre className="dl-cbt-file-pre" {...gutterProps(shown, false)}>
                {prettyText ? <JsonCode text={prettyText} className="hljs" /> : <code className="hljs">{shown}</code>}
            </pre>
            {loaded.partial && <div className="dl-cbt-note">{t("preview.partial", { size: formatBytes(MAX_FILE_BYTES) })}</div>}
        </div>
    );
}

function FileCard({ card, url, fileName }: { card: React.ReactElement<any>; url: string; fileName: string; }) {
    const [open, setOpen] = React.useState(false);
    const button = <Action key="dl-cbt-preview" place="card" label={t(open ? "preview.hide" : "preview.show")} icon="preview" pressed={open} onClick={() => setOpen(o => !o)} />;
    // The card is a block around a row of icon, name and size: the button ends that row
    const children = React.Children.toArray(card.props?.children);
    const row = children[0] as React.ReactElement<{ children?: React.ReactNode; }> | undefined;
    if (React.isValidElement(row)) children[0] = React.cloneElement(row, undefined, ...React.Children.toArray(row.props?.children), button);
    else children.push(button);
    return (
        <div className="dl-cbt-file">
            {React.cloneElement(card, undefined, ...children)}
            {open && <FilePane url={url} fileName={fileName} />}
        </div>
    );
}

// Every selector ends on a class, attribute or tag of ours or on code: none is checked against every element
const css = `
/* Code blocks: our buttons in the spot and style of Discord's Copy, shown while hovering the block */
.dl-cbt-bar {
    position: absolute;
    top: 8px;
    inset-inline-end: 4px;
    z-index: 1;
    display: none;
    gap: 8px;
}
[data-dl-cbt]:hover > .dl-cbt-bar,
.dl-cbt-pane:hover > .dl-cbt-bar,
.dl-cbt-bar:focus-within { display: flex; }

.dl-cbt-btn {
    position: relative;
    display: flex;
    flex-shrink: 0;
    margin: 0;
    padding: 0;
    border: 0;
    border-radius: 2px;
    background: none;
    color: inherit;
    cursor: pointer;
}
/* 16px icons, 24px to hit; 8px apart, so neighbours' areas meet without overlapping */
.dl-cbt-btn::after { content: ""; position: absolute; inset: -4px; }
.dl-cbt-btn:focus-visible { outline: 2px solid var(--focus-primary, #00b0f4); outline-offset: 2px; }
/* The preview footer: 16px apart like Discord's buttons there */
.dl-cbt-footer-btn { margin-inline-start: var(--space-16, 16px); }
.dl-cbt-card-btn { align-self: center; margin-inline-start: auto; color: var(--interactive-icon-default, var(--interactive-normal)); }
@media (hover: hover) {
    .dl-cbt-card-btn:hover { color: var(--interactive-icon-hover, var(--interactive-hover)); }
}

/* Line numbers: floated inside the code, so they share its font, padding and line height */
html.dl-cbt-numbers [data-dl-cbt-lines] code { white-space: pre !important; }
html.dl-cbt-numbers [data-dl-cbt-lines] code::before {
    content: var(--dl-cbt-gutter);
    float: inline-start;
    margin-inline-end: 16px;
    white-space: pre;
    text-align: end;
    color: var(--text-muted);
    user-select: none;
    pointer-events: none;
}

/* Pretty printed: ours shows instead of Discord's */
[data-dl-cbt-pretty] code:not(.dl-cbt-pretty) { display: none; }
code.dl-cbt-pretty { display: block; white-space: pre; overflow-x: auto; }

/* Our preview of a text file under its download card, styled like Discord's preview */
.dl-cbt-file { display: flex; flex-direction: column; gap: 4px; max-width: 100%; }
.dl-cbt-pane {
    position: relative;
    max-width: min(100%, 640px);
    border-radius: 8px;
    border: 1px solid var(--border-subtle);
    background: var(--background-base-lower);
    overflow: hidden;
}
.dl-cbt-file-pre { margin: 0; max-height: 400px; overflow: auto; }
.dl-cbt-file-pre code {
    display: block;
    padding: 8px 12px;
    border: 0;
    background: none;
    font-family: var(--font-code, monospace);
    font-size: 0.875rem;
    line-height: 1.125rem;
    color: var(--text-default, var(--text-normal));
    white-space: pre;
}
.dl-cbt-note { padding: 6px 12px; font-size: 0.75rem; line-height: 1rem; color: var(--text-muted); }
.dl-cbt-error { color: var(--text-feedback-critical, var(--status-danger)); }
`;

const showNumbers = (on: boolean) => document.documentElement.classList.toggle("dl-cbt-numbers", on);

export default definePlugin({
    settings,
    css,

    patches: Object.values(PATCHES),

    /** Whether Discord's code block Copy steps aside for ours */
    ownsCopy() {
        return !!ctx;
    },

    /** Discord's code block container: marked for hovering, and carrying its line numbers */
    containerProps(node: CodeNode) {
        if (!ctx || typeof node?.content !== "string") return undefined;
        return { "data-dl-cbt": "", ...gutterProps(node.content, false) };
    },

    renderCodeTools(node: CodeNode) {
        if (!ctx || typeof node?.content !== "string") return null;
        return <CodeTools key="dl-cbt" node={node} />;
    },

    /** The text a plaintext preview shows: pretty printed when asked. A hook, called on every render. */
    useText(url: string, text: string | null) {
        useVersion();
        if (!ctx || typeof text !== "string" || !prettyFiles.has(url)) return text;
        return prettyCached(text) ?? text;
    },

    renderPreviewTools(props: { url: string; fileName: string; text: string | null; bytesLeft: number; }) {
        if (!ctx || typeof props?.url !== "string") return null;
        return <PreviewTools key="dl-cbt" {...props} />;
    },

    /** Whether a plaintext preview starts without word wrap: numbered lines can't wrap */
    numbersFirst() {
        return !!ctx?.settings.get("lineNumbers");
    },

    preProps(text: unknown, className: unknown) {
        if (!ctx?.settings.get("lineNumbers") || typeof text !== "string") return undefined;
        // Word wrap on (Discord's ⋯ menu): wrapped lines can't be numbered
        if (typeof className === "string" && /\bwordWrap_/.test(className)) return undefined;
        return gutterProps(text, true);
    },

    start(context) {
        ctx = context;
        showNumbers(!!context.settings.get("lineNumbers"));
        context.hookExport("after", fileCardFilter, ({ args, result }) => {
            const props = args[0];
            if (!ctx?.settings.get("filePreview") || !React.isValidElement(result) || typeof props?.url !== "string") return;
            if (!isTextFile(props.fileName)) return;
            return <FileCard card={result} url={props.url} fileName={props.fileName} />;
        });
        context.settings.onChange(() => {
            showNumbers(!!ctx?.settings.get("lineNumbers"));
            bump();
        });
    },

    stop() {
        ctx = undefined;
        showNumbers(false);
        prettyFiles.clear();
        prettyCache.clear();
        gutterCache.clear();
        bump();
    },
});
