import { definePlugin, filters, find, getStore, openLayer, React } from "@evi/api";
import type { CloseLayer } from "@evi/api";
import type { ComponentType, PointerEvent as ReactPointerEvent, ReactNode } from "react";

import { canMarkUp, drawMark, isTiny, Mark, outputType, Point, Rect, rectFrom, render, strokeFor, Tool } from "./draw";
import { t } from "./strings";

/**
 * A "Mark up" button on each picture waiting to be sent, next to Discord's spoiler, edit and remove
 * buttons. It opens an editor to crop, blur, box, draw arrows and scribble; saving swaps the file
 * waiting to be sent for the edited one. Checked 2026-10-02, the upload tile's action bar reads
 *     return(0,i.jsxs)(C.A,{actions:(0,i.jsxs)(r.Fragment,{children:[T?(0,i.jsx)(N.A,{...spoiler...
 * inside the tile component, whose props are { channelId, draftType, upload, ... }. We put our
 * button first, made with the same action button component (N.A) so it looks like Discord's.
 */

interface Upload {
    id: string;
    filename: string;
    spoiler: boolean;
    description: string | null;
    isImage: boolean;
    item: { file?: File; platform: number; };
}
interface TileProps { channelId: string; draftType: number; upload: Upload; canEdit?: boolean; }

const uploadActions = filters.byProps("addFiles", "setFile", "setUploads");

const COLORS = ["#f23f43", "#f0b232", "#23a55a", "#5865f2", "#ffffff", "#000000"];
const TOOLS: Tool[] = ["crop", "blur", "box", "arrow", "pen"];

const ICONS: Record<Tool | "markup" | "undo" | "redo", string> = {
    // A scribble, so it isn't mistaken for Discord's own edit pencil next to it
    markup: "M4.59 6.89c.7-.71 1.4-1.35 1.71-1.22.5.2 0 1.03-.3 1.52-.25.42-2.86 3.89-2.86 6.31 0 1.28.48 2.34 1.34 2.98.75.56 1.74.73 2.64.46 1.07-.31 1.95-1.4 3.06-2.77 1.21-1.49 2.83-3.44 4.08-3.44 1.63 0 1.65 1.01 1.76 1.79-3.78.64-5.38 3.67-5.38 5.37 0 1.7 1.44 3.09 3.21 3.09 1.63 0 4.29-1.33 4.69-6.1H21v-2.5h-2.47c-.15-1.65-1.09-4.2-4.03-4.2-2.25 0-4.18 1.91-4.94 2.84-.58.73-2.06 2.48-2.29 2.72-.25.3-.68.84-1.11.84-.45 0-.72-.83-.36-1.92.35-1.09 1.4-2.86 1.85-3.52.78-1.14 1.3-1.92 1.3-3.28C8.95 3.69 7.31 3 6.44 3 5.12 3 3.97 4 3.72 4.25c-.36.36-.66.66-.88.93l1.75 1.71Zm9.29 11.66c-.31 0-.74-.26-.74-.72 0-.6.73-2.2 2.87-2.76-.3 2.69-1.43 3.48-2.13 3.48Z",
    crop: "M7 1v4H3v2h4v10a2 2 0 0 0 2 2h10v4h2v-4h4v-2H9V1H7Zm10 14V9a2 2 0 0 0-2-2h-4v2h4v6h2Z",
    blur: "M3 3h4v4H3zm6 0h4v4H9zm6 0h4v4h-4zM3 9h4v4H3zm6 0h4v4H9zm6 0h4v4h-4zM3 15h4v4H3zm6 0h4v4H9zm6 0h4v4h-4z",
    box: "M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5Zm2 0v14h14V5H5Z",
    arrow: "M14 3h7v7l-2.6-2.6-9.9 9.9-1.8-1.8 9.9-9.9L14 3ZM4 15h2v3h3v2H4v-5Z",
    pen: "M20.2 3.8a2.7 2.7 0 0 0-3.8 0L8 12.2l-1 4.8 4.8-1 8.4-8.4a2.7 2.7 0 0 0 0-3.8ZM4 19c1.5 1 3.5 1.2 5 .5.9-.4 1.9-.4 2.8 0 1.8.8 3.9.8 5.7 0l.5-.2.8 1.8-.5.2c-2.3 1-4.9 1-7.3 0a1.4 1.4 0 0 0-1.2 0c-2.2 1-5 .8-6.9-.5L4 19Z",
    undo: "M12.5 8c-2.65 0-5.05 1-6.9 2.6L2 7v9h9l-3.62-3.62A7.95 7.95 0 0 1 20.4 16l2.37-.78A10.5 10.5 0 0 0 12.5 8Z",
    redo: "M18.4 10.6A10.46 10.46 0 0 0 1.24 15.22l2.36.78A7.95 7.95 0 0 1 16.62 12.4L13 16h9V7l-3.6 3.6Z",
};

function Glyph({ name, size = 20 }: { name: keyof typeof ICONS; size?: number; }) {
    return <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d={ICONS[name]} /></svg>;
}

const toolLabel = (tool: Tool) => t(`tool.${tool}`);

function loadImage(file: File): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error("Couldn't read the picture"));
        img.src = url;
    });
}

function Editor({ file, onSave, onClose }: { file: File; onSave(file: File): void; onClose(): void; }) {
    const [image, setImage] = React.useState<HTMLImageElement>();
    const [error, setError] = React.useState(false);
    const [tool, setTool] = React.useState<Tool>("blur");
    const [color, setColor] = React.useState(COLORS[0]);
    const [marks, setMarks] = React.useState<Mark[]>([]);
    const [undone, setUndone] = React.useState<Mark[]>([]);
    const [crop, setCrop] = React.useState<Rect>();
    const [draft, setDraft] = React.useState<{ mark?: Mark; crop?: Rect; }>();
    const [saving, setSaving] = React.useState(false);
    const canvas = React.useRef<HTMLCanvasElement>(null);
    const start = React.useRef<Point | undefined>(undefined);
    /** The blur being drawn's noise, kept for the whole drag */
    const seed = React.useRef(0);

    React.useEffect(() => {
        let url: string | undefined;
        loadImage(file).then(img => {
            url = img.src;
            setImage(img);
        }, () => setError(true));
        return () => void (url && URL.revokeObjectURL(url));
    }, [file]);

    const size = image ? { w: image.naturalWidth, h: image.naturalHeight } : { w: 1, h: 1 };
    const width = strokeFor(size);

    // The picture with its finished marks, drawn once per change rather than on every pointer move
    const base = React.useMemo(() => {
        if (!image) return undefined;
        const c = document.createElement("canvas");
        render(c, image, size, marks);
        return c;
    }, [image, marks]);

    // That, and the mark being drawn on top
    React.useEffect(() => {
        const c = canvas.current;
        if (!base || !c) return;
        // Setting the size reallocates the canvas: only when it changes
        if (c.width !== base.width || c.height !== base.height) {
            c.width = base.width;
            c.height = base.height;
        }
        const g = c.getContext("2d")!;
        g.clearRect(0, 0, c.width, c.height);
        g.drawImage(base, 0, 0);
        if (draft?.mark) drawMark(g, draft.mark);
    }, [base, draft]);

    React.useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                e.preventDefault();
                e.stopImmediatePropagation();
                onClose();
            } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
                e.preventDefault();
                e.stopImmediatePropagation();
                e.shiftKey ? redo() : undo();
            }
        };
        window.addEventListener("keydown", onKey, true);
        return () => window.removeEventListener("keydown", onKey, true);
    });

    const toImage = (e: ReactPointerEvent): Point => {
        const box = canvas.current!.getBoundingClientRect();
        return { x: (e.clientX - box.left) / box.width * size.w, y: (e.clientY - box.top) / box.height * size.h };
    };

    const markFor = (from: Point, to: Point, points?: Point[]): Mark | undefined => {
        switch (tool) {
            case "blur": return { kind: "blur", rect: rectFrom(from, to, size), seed: seed.current };
            case "box": return { kind: "box", rect: rectFrom(from, to, size), color, width };
            case "arrow": return { kind: "arrow", from, to, color, width };
            case "pen": return { kind: "pen", points: points ?? [from, to], color, width };
        }
    };

    const down = (e: ReactPointerEvent) => {
        if (!image || e.button !== 0) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        const p = toImage(e);
        start.current = p;
        seed.current = crypto.getRandomValues(new Uint32Array(1))[0];
        setDraft(tool === "crop" ? { crop: rectFrom(p, p, size) } : { mark: markFor(p, p, [p]) });
    };
    const move = (e: ReactPointerEvent) => {
        const from = start.current;
        if (!from) return;
        const p = toImage(e);
        if (tool === "crop") return setDraft({ crop: rectFrom(from, p, size) });
        setDraft(d => ({ mark: tool === "pen" && d?.mark?.kind === "pen" ? { ...d.mark, points: [...d.mark.points, p] } : markFor(from, p) }));
    };
    const up = () => {
        if (!start.current) return;
        start.current = undefined;
        const done = draft;
        setDraft(undefined);
        if (done?.crop) {
            setCrop(isTiny(done.crop) ? undefined : done.crop);
            return;
        }
        const mark = done?.mark;
        if (!mark) return;
        if ((mark.kind === "blur" || mark.kind === "box") && isTiny(mark.rect)) return;
        if (mark.kind === "arrow" && Math.hypot(mark.to.x - mark.from.x, mark.to.y - mark.from.y) < 6) return;
        setMarks(m => [...m, mark]);
        setUndone([]);
    };

    function undo() {
        setMarks(m => {
            if (!m.length) return m;
            setUndone(u => [m[m.length - 1], ...u]);
            return m.slice(0, -1);
        });
    }
    function redo() {
        setUndone(u => {
            if (!u.length) return u;
            setMarks(m => [...m, u[0]]);
            return u.slice(1);
        });
    }

    async function save() {
        if (!image) return;
        setSaving(true);
        try {
            const full = document.createElement("canvas");
            render(full, image, size, marks);
            let out = full;
            if (crop) {
                out = document.createElement("canvas");
                out.width = crop.w;
                out.height = crop.h;
                out.getContext("2d")!.drawImage(full, crop.x, crop.y, crop.w, crop.h, 0, 0, crop.w, crop.h);
            }
            const { type, name } = outputType(file.type, file.name);
            const blob = await new Promise<Blob | null>(resolve => out.toBlob(resolve, type, 0.92));
            if (!blob) throw new Error("toBlob gave nothing");
            onSave(new File([blob], name, { type, lastModified: Date.now() }));
        } catch {
            setSaving(false);
            setError(true);
        }
    }

    const shownCrop = draft?.crop ?? crop;
    const changed = marks.length > 0 || !!crop;

    return (
        <div className="evi-qm-scrim evi-scrim" onMouseDown={e => e.target === e.currentTarget && onClose()}>
            <div className="evi-qm-modal evi-modal" role="dialog" aria-modal="true" aria-label={t("editor.title")}>
                <header className="evi-qm-head">
                    <div className="evi-qm-tools" role="toolbar" aria-label={t("editor.tools")}>
                        {TOOLS.map(tl => (
                            <button key={tl} type="button" className="evi-qm-tool" aria-pressed={tool === tl} aria-label={toolLabel(tl)} title={toolLabel(tl)} onClick={() => setTool(tl)}>
                                <Glyph name={tl} />
                            </button>
                        ))}
                        <span className="evi-qm-divider" />
                        {COLORS.map(c => (
                            <button key={c} type="button" className="evi-qm-swatch" style={{ background: c }} aria-pressed={color === c} aria-label={t("editor.color", { color: c })} title={c} disabled={tool === "blur" || tool === "crop"} onClick={() => setColor(c)} />
                        ))}
                        <span className="evi-qm-divider" />
                        <button type="button" className="evi-qm-tool" aria-label={t("editor.undo")} title={t("editor.undo")} disabled={!marks.length} onClick={undo}><Glyph name="undo" /></button>
                        <button type="button" className="evi-qm-tool" aria-label={t("editor.redo")} title={t("editor.redo")} disabled={!undone.length} onClick={redo}><Glyph name="redo" /></button>
                    </div>
                </header>
                <div className="evi-qm-stage">
                    {error && <p className="evi-qm-error" role="alert">{t("editor.error")}</p>}
                    {image && (
                        <div className="evi-qm-canvas-wrap">
                            <canvas ref={canvas} className="evi-qm-canvas" data-tool={tool} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} />
                            {shownCrop && !isTiny(shownCrop) && (
                                <div className="evi-qm-crop" aria-hidden="true" style={{
                                    left: `${shownCrop.x / size.w * 100}%`,
                                    top: `${shownCrop.y / size.h * 100}%`,
                                    width: `${shownCrop.w / size.w * 100}%`,
                                    height: `${shownCrop.h / size.h * 100}%`,
                                }} />
                            )}
                        </div>
                    )}
                </div>
                <footer className="evi-qm-foot">
                    <span className="evi-qm-hint">{t(`hint.${tool}`)}</span>
                    <button type="button" className="evi-qm-button" data-variant="secondary" onClick={onClose}>{t("editor.cancel")}</button>
                    <button type="button" className="evi-qm-button" data-variant="primary" disabled={!changed || saving} onClick={() => void save()}>{t("editor.save")}</button>
                </footer>
            </div>
        </div>
    );
}

let closeOpen: CloseLayer | undefined;

function openEditor({ channelId, draftType, upload }: TileProps) {
    const file = upload.item.file;
    if (!file) return;
    closeOpen?.({ instant: true });
    const close = openLayer(close => (
        <Editor
            file={file}
            onClose={() => close()}
            onSave={edited => {
                replaceUpload(channelId, draftType, upload, edited);
                close();
            }}
        />
    ), { onClosed: () => void (closeOpen === close && (closeOpen = undefined)) });
    closeOpen = close;
}

/**
 * Discord's setFile swaps the file but puts the upload last with no spoiler or description, so
 * those go back as they were, and the upload goes back to where it was among the others.
 */
function replaceUpload(channelId: string, draftType: number, upload: Upload, file: File) {
    const actions = find(uploadActions);
    const store = getStore("UploadAttachmentStore") as any;
    if (!actions) return;
    const before: Upload[] = store?.getUploads?.(channelId, draftType) ?? [];
    const index = before.findIndex(u => u.id === upload.id);
    actions.setFile({ channelId, id: upload.id, draftType, file: { id: upload.id, platform: upload.item.platform, file } });
    actions.update?.(channelId, upload.id, draftType, { filename: file.name, description: upload.description ?? undefined, spoiler: upload.spoiler });
    const after: Upload[] = store?.getUploads?.(channelId, draftType) ?? [];
    const moved = after.findIndex(u => u.id === upload.id);
    if (index >= 0 && moved >= 0 && moved !== index && typeof actions.setUploads === "function") {
        const order = [...after];
        const [item] = order.splice(moved, 1);
        order.splice(index, 0, item);
        actions.setUploads({ channelId, draftType, uploads: order });
    }
}

type ActionButton = ComponentType<{ tooltip?: ReactNode; onClick?(e: any): void; className?: string; children?: ReactNode; }>;

export default definePlugin({
    patches: [
        {
            find: "attachmentItemSmall]:",
            replace: {
                match: /actions:\(0,\i\.jsxs\)\(\i\.Fragment,\{children:\[(?=\i\?\(0,\i\.jsx\)\((\i\.\i),)/,
                with: "$&$self.button?.(arguments[0],$1),",
            },
        },
    ],

    button(props: TileProps, Action: ActionButton) {
        const file = props?.upload?.item?.file;
        if (!file || props.canEdit === false || !canMarkUp(file)) return null;
        return (
            <Action key="evi-markup" tooltip={t("button")} onClick={(e: Event) => {
                e?.stopPropagation?.();
                openEditor(props);
            }}>
                <Glyph name="markup" size={20} />
            </Action>
        );
    },

    stop() {
        closeOpen?.({ instant: true });
    },

    css: `
.evi-qm-scrim {
    position: fixed;
    inset: 0;
    z-index: 1000;
    display: grid;
    place-items: center;
    padding: 32px;
    background: var(--opacity-black-70, rgb(0 0 0 / 0.7));
}
.evi-qm-modal {
    display: flex;
    flex-direction: column;
    max-inline-size: min(920px, 100%);
    max-block-size: 100%;
    border-radius: 12px;
    background: var(--modal-background, var(--background-base-low, #2b2d31));
    border: 1px solid var(--border-subtle, rgb(255 255 255 / 0.06));
    box-shadow: var(--shadow-high, 0 12px 32px rgb(0 0 0 / 0.4));
    overflow: hidden;
}
.evi-qm-head { padding: 10px 12px; border-block-end: 1px solid var(--border-subtle, rgb(255 255 255 / 0.06)); }
.evi-qm-tools { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }
.evi-qm-tool {
    display: grid;
    place-items: center;
    inline-size: 36px;
    block-size: 36px;
    border: 0;
    border-radius: 8px;
    background: none;
    color: var(--interactive-normal, var(--interactive-icon-default, #b5bac1));
    cursor: pointer;
    transition: background-color 0.15s, color 0.15s;
}
.evi-qm-tool:hover:not(:disabled) { background: var(--background-modifier-hover, rgb(255 255 255 / 0.06)); color: var(--interactive-hover, #dbdee1); }
.evi-qm-tool[aria-pressed="true"] { background: var(--background-modifier-selected, rgb(255 255 255 / 0.1)); color: var(--interactive-active, #fff); }
.evi-qm-tool:disabled { opacity: 0.35; cursor: default; }
.evi-qm-swatch {
    inline-size: 22px;
    block-size: 22px;
    margin-inline: 2px;
    border-radius: 50%;
    border: 2px solid rgb(255 255 255 / 0.2);
    cursor: pointer;
    transition: transform 0.15s, opacity 0.15s;
}
.evi-qm-swatch[aria-pressed="true"] { box-shadow: 0 0 0 2px var(--modal-background, #2b2d31), 0 0 0 4px var(--brand-500, #5865f2); }
.evi-qm-swatch:hover:not(:disabled) { transform: scale(1.1); }
.evi-qm-swatch:disabled { opacity: 0.3; cursor: default; }
.evi-qm-divider { inline-size: 1px; block-size: 24px; margin-inline: 6px; background: var(--border-subtle, rgb(255 255 255 / 0.1)); }
.evi-qm-stage {
    display: grid;
    place-items: center;
    min-block-size: 0;
    padding: 16px;
    background: var(--background-base-lowest, #1e1f22);
    overflow: hidden;
}
/* The canvas keeps its picture's shape: as big as fits, never bigger than the picture */
.evi-qm-canvas-wrap { position: relative; display: inline-block; line-height: 0; overflow: hidden; border-radius: 4px; }
.evi-qm-canvas { display: block; max-inline-size: min(880px, 70vw); max-block-size: 60vh; touch-action: none; }
.evi-qm-canvas[data-tool] { cursor: crosshair; }
.evi-qm-crop {
    position: absolute;
    outline: 2px dashed #fff;
    box-shadow: 0 0 0 9999px rgb(0 0 0 / 0.55);
    pointer-events: none;
}
.evi-qm-error { color: var(--text-feedback-critical, #f23f43); margin: 0 0 12px; }
.evi-qm-foot { display: flex; align-items: center; gap: 8px; padding: 12px 16px; }
.evi-qm-hint { flex: 1; color: var(--text-muted, #949ba4); font-size: 14px; }
.evi-qm-button {
    min-block-size: 38px;
    padding: 2px 16px;
    border: 0;
    border-radius: 8px;
    font: inherit;
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
    transition: background-color 0.15s, opacity 0.15s;
}
.evi-qm-button[data-variant="primary"] { background: var(--button-filled-brand-background, #5865f2); color: var(--white, #fff); }
.evi-qm-button[data-variant="primary"]:hover:not(:disabled) { background: var(--button-filled-brand-background-hover, #4752c4); }
.evi-qm-button[data-variant="secondary"] { background: var(--button-secondary-background, rgb(255 255 255 / 0.08)); color: var(--text-normal, #dbdee1); }
.evi-qm-button[data-variant="secondary"]:hover { background: var(--button-secondary-background-hover, rgb(255 255 255 / 0.12)); }
.evi-qm-button:disabled { opacity: 0.5; cursor: default; }
`,
});
