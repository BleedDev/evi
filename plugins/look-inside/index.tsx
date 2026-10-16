/**
 * Zips in chat show what's inside before anyone downloads them, and warn about programs, disguised
 * files, password-locked files, paths that unpack outside their folder and zip bombs.
 *
 * Checked against Discord's code on 2026-10-13: a zip is drawn by Discord's generic file attachment card
 * ({ url, fileName, fileSize, onClick, onContextMenu, renderAdjacentContent } -> <div>[icon, name and
 * size], adjacent content</div>), the same card Code Block Tools hooks for text files. Ours goes around
 * it: a button joins the card's children, and the warning and the list go under it.
 *
 * Only the end of the zip is fetched (a range request to Discord's CDN), and only the directory after
 * that if it's longer: never the files themselves. See zip.ts. The CDN doesn't let Discord's page read
 * zips (no CORS header), so the requests go through native.ts.
 */
import { Components, definePlugin, filters, React } from "@evi/api";
import type { PluginContext } from "@evi/api";

import { t } from "./strings";
import { type Kind, level, type Listing, listZip, type Review, review, type TreeNode, toTree, isArchive } from "./zip";

const settings = {
    auto: {
        type: "boolean",
        get label() { return t("settings.auto"); },
        get description() { return t("settings.auto.description"); },
        default: true,
    },
} as const;

let ctx: PluginContext<typeof settings> | undefined;

/** Discord's generic file attachment card */
const fileCardFilter = filters.byCode("renderAdjacentContent:", ".filesize(", "href:", "onContextMenu:");

/** Bytes [start, end) of an attachment, read by native.ts */
async function readRange(url: string, start: number, end: number) {
    if (!ctx) throw new Error("Look Inside isn't running");
    return new Uint8Array(await ctx.native.call<Uint8Array>("range", url, start, end));
}

type Result = { listing: Listing; review?: Review; } | { error: true; };

/**
 * Results per attachment, kept for the session (a few hundred at most). Keyed without the query: Discord
 * signs attachment links with an expiry and hands out new ones for the same file.
 */
const results = new Map<string, Promise<Result>>();
const settled = new Map<string, Result>();
const MAX_RESULTS = 300;
const keyOf = (url: string) => url.split("?")[0];

function inspect(url: string, size: number): Promise<Result> {
    const key = keyOf(url);
    let pending = results.get(key);
    if (!pending) {
        pending = listZip((start, end) => readRange(url, start, end), size)
            .then((listing): Result => ({ listing, review: listing.kind === "list" ? review(listing.entries) : undefined }))
            .catch(err => {
                ctx?.logger.warn("Couldn't read a zip", err);
                // A failure isn't kept: the next look tries again
                results.delete(key);
                return { error: true } as const;
            })
            .then(result => {
                if (!("error" in result)) settled.set(key, result);
                return result;
            });
        if (results.size >= MAX_RESULTS) {
            const oldest = results.keys().next().value!;
            results.delete(oldest);
            settled.delete(oldest);
        }
        results.set(key, pending);
    }
    return pending;
}

function useResult(url: string, size: number, wanted: boolean) {
    const [result, setResult] = React.useState<Result | undefined>(() => settled.get(keyOf(url)));
    React.useEffect(() => {
        if (!wanted || result) return;
        let live = true;
        void inspect(url, size).then(r => live && setResult(r));
        return () => void (live = false);
    }, [url, size, wanted, result]);
    return result;
}

/** One observer for every card: a zip is checked once it's near the screen */
const watched = new Map<Element, () => void>();
let observer: IntersectionObserver | undefined;
function onVisible(el: Element, cb: () => void) {
    observer ??= new IntersectionObserver(entries => {
        for (const e of entries) {
            if (!e.isIntersecting) continue;
            watched.get(e.target)?.();
            watched.delete(e.target);
            observer?.unobserve(e.target);
        }
    }, { rootMargin: "200px" });
    watched.set(el, cb);
    observer.observe(el);
    return () => {
        watched.delete(el);
        observer?.unobserve(el);
    };
}

function formatBytes(n: number) {
    if (n < 1024) return `${n} B`;
    const units = ["KB", "MB", "GB", "TB"];
    let v = n / 1024, i = 0;
    while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
    return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

const baseName = (path: string) => path.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || path;

/** The first few names, then "and N more" */
function names(paths: string[], shown = 3) {
    const list = paths.slice(0, shown).map(baseName).join(", ");
    return paths.length > shown ? `${list} ${t("more", { count: paths.length - shown })}` : list;
}

const ICON = {
    // A folder, for the card's button
    folder: "M2 6a3 3 0 0 1 3-3h3.59a2 2 0 0 1 1.41.59l1.42 1.41H19a3 3 0 0 1 3 3v9a3 3 0 0 1-3 3H5a3 3 0 0 1-3-3V6Z",
    // Discord's WarningIcon and CircleWarningIcon
    danger: "M10 3.1a2.37 2.37 0 0 1 4 0l8.71 14.75c.84 1.41-.26 3.15-2 3.15H3.29c-1.74 0-2.84-1.74-2-3.15L10 3.1ZM12 8a1.5 1.5 0 0 0-1.5 1.61l.34 3.97a1.17 1.17 0 0 0 2.32 0l.34-3.97A1.5 1.5 0 0 0 12 8Zm0 11a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z",
    warning: "M12 23a11 11 0 1 0 0-22 11 11 0 0 0 0 22Zm1.44-15.94L13.06 14a1.06 1.06 0 0 1-2.12 0l-.38-6.94a1 1 0 0 1 1-1.06h.88a1 1 0 0 1 1 1.06Zm-.19 10.69a1.25 1.25 0 1 1-2.5 0 1.25 1.25 0 0 1 2.5 0Z",
    chevron: "M9.3 5.3a1 1 0 0 0 0 1.4l5.29 5.3-5.3 5.3a1 1 0 1 0 1.42 1.4l6-6a1 1 0 0 0 0-1.4l-6-6a1 1 0 0 0-1.42 0Z",
};

const Icon = ({ d, size, className }: { d: string; size: number; className?: string; }) => (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d={d} /></svg>
);

/** The warnings for a zip, worst first: shown under its card without a click */
function Warnings({ r }: { r: Review; }) {
    const lines: string[] = [];
    if (r.bomb) lines.push(t("warn.bomb", { size: formatBytes(r.size) }));
    if (r.found.disguised) lines.push(t("warn.disguised", { names: names(r.found.disguised) }));
    if (r.found.escape) lines.push(t("warn.escape", { names: names(r.found.escape) }));
    if (r.found.program) lines.push(t("warn.program", { names: names(r.found.program) }));
    if (r.found.locked) lines.push(t("warn.locked", { count: r.found.locked.length }));
    const tone = level(r);
    if (!tone) return null;
    return (
        <div className={`dl-li-warn dl-li-${tone}`} role="note">
            <Icon d={ICON[tone]} size={16} className="dl-li-warn-icon" />
            <div>{lines.map(line => <div key={line}>{line}</div>)}</div>
        </div>
    );
}

/** Rows drawn at most: a zip of 10,000 files lists its first part */
const MAX_ROWS = 1000;

function Tree({ nodes }: { nodes: TreeNode[]; }) {
    const total = React.useMemo(() => {
        let n = 0;
        const count = (list: TreeNode[]) => list.forEach(c => { n++; count(c.children); });
        count(nodes);
        return n;
    }, [nodes]);
    // Small zips open fully; big ones show their top folders
    const [open, setOpen] = React.useState<Set<string>>(() => new Set());
    const [closed, setClosed] = React.useState<Set<string>>(() => new Set());
    const isOpen = (node: TreeNode, depth: number) => total <= 100 || depth === 0 ? !closed.has(node.path) : open.has(node.path);
    const toggle = (node: TreeNode, depth: number) => {
        const flip = (set: Set<string>) => {
            const next = new Set(set);
            if (next.has(node.path)) next.delete(node.path);
            else next.add(node.path);
            return next;
        };
        if (total <= 100 || depth === 0) setClosed(flip);
        else setOpen(flip);
    };

    const rows: React.ReactNode[] = [];
    let hidden = 0;
    const walk = (list: TreeNode[], depth: number) => {
        for (const node of list) {
            if (rows.length >= MAX_ROWS) {
                hidden++;
                continue;
            }
            const expanded = node.dir && isOpen(node, depth);
            const style = { paddingInlineStart: 12 + depth * 16 } as React.CSSProperties;
            const label = (
                <>
                    {node.dir
                        ? <Icon d={ICON.chevron} size={12} className={`dl-li-chevron${expanded ? " dl-li-open" : ""}`} />
                        : <span className="dl-li-spacer" />}
                    <span className={`dl-li-name${node.kind ? ` dl-li-name-${node.kind}` : ""}`}>{node.name}{node.dir ? "/" : ""}</span>
                    {node.kind && <span className={`dl-li-tag dl-li-tag-${node.kind}`}>{t(`tag.${node.kind}` as `tag.${Kind}`)}</span>}
                    <span className="dl-li-size">{formatBytes(node.size)}</span>
                </>
            );
            rows.push(node.dir
                ? <button key={node.path} type="button" className="dl-li-row" style={style} aria-expanded={expanded} onClick={() => toggle(node, depth)}>{label}</button>
                : <div key={node.path} className="dl-li-row" style={style}>{label}</div>);
            if (expanded) walk(node.children, depth + 1);
        }
    };
    walk(nodes, 0);
    return (
        <div className="dl-li-tree" role="list">
            {rows}
            {hidden > 0 && <div className="dl-li-note">{t("more", { count: hidden })}</div>}
        </div>
    );
}

function Pane({ result }: { result: Result | undefined; }) {
    const listing = result && "listing" in result ? result.listing : undefined;
    const entries = listing?.kind === "list" ? listing.entries : undefined;
    const tree = React.useMemo(() => entries ? toTree(entries) : [], [entries]);
    if (!result) return <div className="dl-li-pane"><div className="dl-li-note">{t("loading")}</div></div>;
    if (!listing || "error" in result) return <div className="dl-li-pane"><div className="dl-li-note dl-li-error">{t("error")}</div></div>;
    if (listing.kind === "notZip") return <div className="dl-li-pane"><div className="dl-li-note">{t("notZip")}</div></div>;
    if (listing.kind === "tooBig") return <div className="dl-li-pane"><div className="dl-li-note">{t("tooBig", { count: listing.count })}</div></div>;
    const r = (result as { review: Review; }).review;
    const summary = [t("files", { count: r.files }), r.folders ? t("folders", { count: r.folders }) : "", t("unpacked", { size: formatBytes(r.size) })].filter(Boolean).join(" · ");
    return (
        <div className="dl-li-pane">
            <div className="dl-li-summary">{summary}</div>
            <Tree nodes={tree} />
            {r.found.nested && <div className="dl-li-note">{t("note.nested", { names: names(r.found.nested) })}</div>}
        </div>
    );
}

function ZipCard({ card, url, size }: { card: React.ReactElement<any>; url: string; size: number; }) {
    const [open, setOpen] = React.useState(false);
    const [seen, setSeen] = React.useState(false);
    const ref = React.useRef<HTMLDivElement>(null);
    const auto = !!ctx?.settings.get("auto");
    React.useEffect(() => {
        if (!auto || seen || !ref.current) return;
        return onVisible(ref.current, () => setSeen(true));
    }, [auto, seen]);
    const result = useResult(url, size, open || (auto && seen));
    const r = result && "review" in result ? result.review : undefined;

    const label = t(open ? "button.hide" : "button.show");
    const button = (
        <button
            type="button"
            className="dl-li-btn"
            aria-label={label}
            aria-pressed={open}
            onClick={e => {
                e.stopPropagation();
                setOpen(o => !o);
            }}
        >
            <Icon d={ICON.folder} size={24} />
        </button>
    );
    const Tooltip = Components.Tooltip;
    const action = Tooltip ? <Tooltip key="dl-li" text={label} position="top">{button}</Tooltip> : <React.Fragment key="dl-li">{button}</React.Fragment>;
    // The card is a block around a row of icon, name and size: the button ends that row
    const children = React.Children.toArray(card.props?.children);
    const row = children[0] as React.ReactElement<{ children?: React.ReactNode; }> | undefined;
    if (React.isValidElement(row)) children[0] = React.cloneElement(row, undefined, ...React.Children.toArray(row.props?.children), action);
    else children.push(action);
    return (
        <div className="dl-li-file" ref={ref}>
            {React.cloneElement(card, undefined, ...children)}
            {r && <Warnings r={r} />}
            {open && <Pane result={result} />}
        </div>
    );
}

// Every selector ends on a class of ours: none is checked against every element
const css = `
/* As wide as Discord's card: what's under it wraps at its width instead of widening it */
.dl-li-file { display: flex; flex-direction: column; gap: 4px; width: fit-content; max-width: 100%; }
.dl-li-warn, .dl-li-pane { width: 0; min-width: 100%; box-sizing: border-box; }

.dl-li-btn {
    position: relative;
    display: flex;
    flex-shrink: 0;
    align-self: center;
    margin: 0;
    margin-inline-start: auto;
    padding: 0;
    border: 0;
    border-radius: 2px;
    background: none;
    color: var(--interactive-icon-default, var(--interactive-normal));
    cursor: pointer;
}
.dl-li-btn::after { content: ""; position: absolute; inset: -4px; }
.dl-li-btn:focus-visible { outline: 2px solid var(--focus-primary, #00b0f4); outline-offset: 2px; }
@media (hover: hover) {
    .dl-li-btn:hover { color: var(--interactive-icon-hover, var(--interactive-hover)); }
}

.dl-li-warn {
    display: flex;
    gap: 8px;
    padding: 8px 12px;
    border-radius: 8px;
    font-size: 0.875rem;
    line-height: 1.125rem;
    color: var(--text-default, var(--text-normal));
    overflow-wrap: anywhere;
}
.dl-li-warn-icon { flex-shrink: 0; margin-top: 1px; }
.dl-li-danger { background: color-mix(in srgb, var(--status-danger) 12%, transparent); border: 1px solid color-mix(in srgb, var(--status-danger) 40%, transparent); }
.dl-li-danger .dl-li-warn-icon { color: var(--status-danger); }
.dl-li-warning { background: color-mix(in srgb, var(--status-warning) 12%, transparent); border: 1px solid color-mix(in srgb, var(--status-warning) 40%, transparent); }
.dl-li-warning .dl-li-warn-icon { color: var(--status-warning); }

.dl-li-pane {
    border-radius: 8px;
    border: 1px solid var(--border-subtle);
    background: var(--background-base-lower);
    overflow: hidden;
}
.dl-li-summary { padding: 8px 12px; font-size: 0.75rem; line-height: 1rem; color: var(--text-muted); border-bottom: 1px solid var(--border-subtle); }
.dl-li-tree { max-height: 320px; overflow: auto; padding: 4px 0; }
.dl-li-row {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    min-height: 28px;
    margin: 0;
    padding: 4px 12px;
    border: 0;
    background: none;
    font: inherit;
    font-size: 0.875rem;
    line-height: 1.125rem;
    color: var(--text-default, var(--text-normal));
    text-align: start;
    box-sizing: border-box;
}
button.dl-li-row { cursor: pointer; }
@media (hover: hover) {
    button.dl-li-row:hover { background: var(--background-modifier-hover); }
}
button.dl-li-row:focus-visible { outline: 2px solid var(--focus-primary, #00b0f4); outline-offset: -2px; }
.dl-li-chevron { flex-shrink: 0; color: var(--interactive-icon-default, var(--interactive-normal)); transition: transform 0.15s ease; }
.dl-li-open { transform: rotate(90deg); }
@media (prefers-reduced-motion: reduce) { .dl-li-chevron { transition: none; } }
.dl-li-spacer { width: 12px; flex-shrink: 0; }
.dl-li-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dl-li-name-program { color: var(--text-feedback-warning, var(--status-warning)); }
.dl-li-name-disguised, .dl-li-name-escape { color: var(--text-feedback-critical, var(--status-danger)); }
.dl-li-tag {
    flex-shrink: 0;
    padding: 0 6px;
    border-radius: 4px;
    font-size: 0.75rem;
    line-height: 1rem;
    font-weight: 600;
    background: var(--background-modifier-accent);
    color: var(--text-muted);
}
.dl-li-tag-program, .dl-li-tag-locked { background: color-mix(in srgb, var(--status-warning) 18%, transparent); color: var(--text-feedback-warning, var(--status-warning)); }
.dl-li-tag-disguised, .dl-li-tag-escape { background: color-mix(in srgb, var(--status-danger) 18%, transparent); color: var(--text-feedback-critical, var(--status-danger)); }
.dl-li-size { margin-inline-start: auto; padding-inline-start: 12px; flex-shrink: 0; font-size: 0.75rem; color: var(--text-muted); font-variant-numeric: tabular-nums; }
.dl-li-note { padding: 8px 12px; font-size: 0.75rem; line-height: 1rem; color: var(--text-muted); }
.dl-li-error { color: var(--text-feedback-critical, var(--status-danger)); }
`;

export default definePlugin({
    settings,
    css,

    start(context) {
        ctx = context;
        context.hookExport("after", fileCardFilter, ({ args, result }) => {
            const props = args[0];
            if (!ctx || !React.isValidElement(result) || typeof props?.url !== "string" || !isArchive(props.fileName)) return;
            if (typeof props.fileSize !== "number" || props.fileSize <= 0) return;
            return <ZipCard card={result} url={props.url} size={props.fileSize} />;
        });
    },

    stop() {
        ctx = undefined;
        observer?.disconnect();
        observer = undefined;
        watched.clear();
    },
});
