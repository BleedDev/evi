/**
 * Upload Tools: three things for files.
 * - Sending (details.tsx): speed and time left under the bar of a message that's sending files, and
 *   a cancel button for each file when it has several. Discord's taskbar icon shows the progress.
 * - Waiting to be sent (preview.tsx): drag files into order, mark them all as spoilers at once.
 * - Editing (edit.tsx): add files to your own message while you edit it.
 *
 * How each reaches Discord, checked against its code on 2026-10-25:
 * - The pending message of an upload renders a component with props { channelId, file } whose code
 *   reads UploadStore.getMessageForFile; we hook that export and put our details after it.
 * - The taskbar: Discord's desktop app exposes Electron's setProgressBar to the page as
 *   DiscordNative.window.setProgressBar(0..1, -1 to clear); Discord uses it for game installs. We
 *   follow UPLOAD_START / UPLOAD_PROGRESS / UPLOAD_COMPLETE / UPLOAD_FAIL. No native code needed.
 * - The upload preview: one source patch, below, hands us its tiles.
 * - The edit box: a class component found by its code; we hook its render (see edit.tsx).
 */
import { definePlugin, filters, React } from "@evi/api";
import type { Filter, FluxAction } from "@evi/api";
import type { ReactNode } from "react";

import { UploadDetails } from "./details";
import type { UploaderFile } from "./details";
import { EditFiles, subscribeEdits, wrapSubmit } from "./edit";
import { withTools } from "./preview";
import { overall } from "./progress";
import type { Transfer } from "./progress";
import { isOn, settings, state } from "./state";

/** The pending upload message's content: Discord's bar, file name and cancel button */
const pendingUploadFilter = filters.componentByCode("getMessageForFile", "currentSize>0");
/** The box you edit a message in: a class, so not the components that render it */
const editorCode = filters.byCode("validateEdit", "onConfirmDelete", "renderLeftAccessories");
const editorFilter: Filter = Object.assign((v: any) => typeof v?.prototype?.render === "function" && editorCode(v), {
    $code: editorCode.$code,
    $label: `class with ${editorCode.$label}`,
});

/** How often the taskbar is updated while sending */
const TASKBAR_EVERY_MS = 250;

function setTaskbar(value: number) {
    try {
        (window as any).DiscordNative?.window?.setProgressBar?.(value);
    } catch { }
}

export default definePlugin({
    settings,

    patches: [
        {
            // The upload preview's list, checked 2026-10-25:
            //     (0,i.jsx)("ul",{ref:r,...a,className:s()(b.I,M.KK),children:N?L.map(...):k.map(e=>(0,i.jsx)(O.A,
            //     {channelId:t,draftType:n.drafts.type,upload:e,keyboardModeEnabled:m,clip:e.clip,size:T?p.L.SMALL:p.L.MEDIUM},e.id))})
            // in the component that subscribes to APPLICATION_COMMAND_SET_ACTIVE_COMMAND to clear it. k is
            // the uploads shown (all but one being edited). We get the tiles, the uploads, the channel
            // and the draft type, and hand back the tiles with our tools after them.
            find: 'subscribe("APPLICATION_COMMAND_SET_ACTIVE_COMMAND"',
            replace: {
                match: /(\i)\.map\((\i)=>\(0,\i\.jsx\)\(\i\.\i,\{channelId:(\i),draftType:(\i)\.drafts\.type,upload:\2,[^{}]*\},\2\.id\)\)/,
                with: "($self?.tiles?.($&,$1,$3,$4.drafts.type)??$&)",
            },
        },
    ],

    tiles(tiles: ReactNode, uploads: any[], channelId: string, draftType: number): ReactNode {
        try {
            return withTools(tiles, uploads, channelId, draftType);
        } catch (err) {
            state.ctx?.logger.error("Couldn't add the upload tools", err);
            return tiles;
        }
    },

    start(ctx) {
        state.ctx = ctx;
        ctx.onDispose(() => void (state.ctx = undefined));

        ctx.hookExport("after", pendingUploadFilter, ({ args, result }) => {
            const props = args[0] as { channelId?: string; file?: UploaderFile; } | undefined;
            if (!result || !props?.file || !props.channelId || !isOn("details")) return;
            return <>{result}<UploadDetails channelId={props.channelId} file={props.file} /></>;
        });

        ctx.waitFor(editorFilter, Editor => {
            if (typeof Editor?.prototype?.render !== "function") return;
            ctx.hook.before(Editor.prototype, "render", ({ self }) => {
                if (isOn("editFiles")) wrapSubmit(self);
            });
            ctx.hook.after(Editor.prototype, "render", ({ self, result }) => {
                const { channel, message } = (self as any)?.props ?? {};
                if (!result || !channel || !message?.id || !isOn("editFiles")) return;
                const element = result as React.ReactElement<{ children?: ReactNode; }>;
                return React.cloneElement(element, undefined, ...React.Children.toArray(element.props.children),
                    <EditFiles key="evi-upload-tools-edit" channel={channel} message={message} />);
            });
        });
        subscribeEdits();

        // The taskbar: every message sending files, as one bar
        const transfers = new Map<string, Transfer>();
        let shown = -1;
        let queued = false;
        const paint = () => {
            queued = false;
            const value = isOn("taskbar") ? overall(transfers.values()) : -1;
            if (value === shown) return;
            shown = value;
            setTaskbar(value);
        };
        const schedule = () => {
            if (queued) return;
            queued = true;
            ctx.setTimeout(paint, TASKBAR_EVERY_MS);
        };
        const track = ({ file }: FluxAction) => {
            if (!file?.id) return;
            const total = Math.max(0, file.currentSize ?? 0);
            transfers.set(file.id, { loaded: total * Math.max(0, file.progress ?? 0) / 100, total });
            schedule();
        };
        const untrack = ({ file }: FluxAction) => {
            if (file?.id && transfers.delete(file.id)) schedule();
        };
        ctx.flux.subscribe("UPLOAD_START", track);
        ctx.flux.subscribe("UPLOAD_PROGRESS", (action: FluxAction) => {
            if (action.file?.id && transfers.has(action.file.id)) track(action);
        });
        ctx.flux.subscribe("UPLOAD_COMPLETE", untrack);
        ctx.flux.subscribe("UPLOAD_FAIL", untrack);
        ctx.flux.subscribe("UPLOAD_CANCEL_REQUEST", untrack);
        ctx.settings.onChange(paint);
        ctx.onDispose(() => {
            if (shown !== -1) setTaskbar(-1);
        });
    },

    css: `
@keyframes evi-ut-in {
    from { opacity: 0; transform: translateY(-2px); }
}

/* Upload details */
.evi-ut-details {
    display: flex;
    flex-direction: column;
    gap: 6px;
    max-inline-size: 520px;
    margin-block-start: 6px;
}
.evi-ut-stats {
    color: var(--text-muted, #949ba4);
    font-size: 12px;
    line-height: 16px;
    font-variant-numeric: tabular-nums;
}
.evi-ut-files { display: flex; flex-direction: column; gap: 2px; margin: 0; padding: 0; list-style: none; }
.evi-ut-file {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 96px 72px 24px;
    align-items: center;
    gap: 10px;
    min-block-size: 28px;
    padding: 2px 2px 2px 8px;
    border-radius: 6px;
    font-size: 13px;
    animation: evi-ut-in 0.18s ease-out;
}
.evi-ut-file:hover { background: var(--background-modifier-hover, rgb(255 255 255 / 0.04)); }
.evi-ut-file-name { overflow: hidden; color: var(--text-normal, #dbdee1); text-overflow: ellipsis; white-space: nowrap; }
.evi-ut-file-bar {
    block-size: 4px;
    border-radius: 2px;
    background: var(--background-modifier-accent, rgb(255 255 255 / 0.1));
    overflow: hidden;
}
.evi-ut-file-bar > span {
    display: block;
    block-size: 100%;
    background: var(--brand-500, #5865f2);
    transform-origin: left;
    transition: transform 0.2s linear;
}
.evi-ut-file-state { color: var(--text-muted, #949ba4); font-size: 12px; text-align: end; font-variant-numeric: tabular-nums; }
.evi-ut-icon-button {
    display: grid;
    place-items: center;
    inline-size: 24px;
    block-size: 24px;
    padding: 0;
    border: 0;
    border-radius: 6px;
    background: none;
    color: var(--interactive-normal, #b5bac1);
    cursor: pointer;
    transition: background-color 0.15s, color 0.15s;
}
.evi-ut-icon-button:hover { background: var(--background-modifier-hover, rgb(255 255 255 / 0.06)); color: var(--interactive-hover, #dbdee1); }
.evi-ut-icon-button:focus-visible, .evi-ut-tool:focus-visible, .evi-ut-add:focus-visible { outline: 2px solid var(--focus-primary, #00a8fc); outline-offset: 1px; }

/* Upload tools, after the preview's tiles */
.evi-ut-tools {
    display: flex;
    flex: none;
    align-items: center;
    align-self: stretch;
    padding-inline: 4px 8px;
    list-style: none;
}
.evi-ut-tool {
    display: grid;
    place-items: center;
    inline-size: 36px;
    block-size: 36px;
    padding: 0;
    border: 0;
    border-radius: 8px;
    background: var(--background-modifier-hover, rgb(255 255 255 / 0.06));
    color: var(--interactive-normal, #b5bac1);
    cursor: pointer;
    transition: background-color 0.15s, color 0.15s;
}
.evi-ut-tool:hover { background: var(--background-modifier-selected, rgb(255 255 255 / 0.1)); color: var(--interactive-hover, #dbdee1); }
.evi-ut-tool[aria-pressed="true"] { color: var(--interactive-active, #fff); }
.evi-ut-sortable > li:not(.evi-ut-tools) { cursor: grab; }
.evi-ut-sorting { user-select: none; }
.evi-ut-sorting > li:not(.evi-ut-tools) { position: relative; cursor: grabbing; transition: transform 0.2s cubic-bezier(0.2, 0, 0, 1); }
.evi-ut-sorting > li.evi-ut-dragged { z-index: 2; transition: none; }
.evi-ut-sorting > li.evi-ut-dragged.evi-ut-settling { transition: transform 0.16s cubic-bezier(0.2, 0, 0, 1); }
.evi-ut-dragged > * {
    border-radius: 8px;
    box-shadow: var(--shadow-high, 0 8px 24px rgb(0 0 0 / 0.35));
    transform: scale(1.04);
    transition: transform 0.15s ease-out, box-shadow 0.15s ease-out;
}
.evi-ut-settling > * { transform: none; box-shadow: none; }

/* Adding files while editing */
.evi-ut-edit {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 10px;
    padding-block-start: 4px;
    font-size: 12px;
    line-height: 16px;
}
.evi-ut-add {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px 8px 2px 4px;
    border: 0;
    border-radius: 6px;
    background: none;
    color: var(--text-link, #00a8fc);
    font: inherit;
    font-weight: 500;
    cursor: pointer;
    transition: background-color 0.15s;
}
.evi-ut-add:hover:not(:disabled) { background: var(--background-modifier-hover, rgb(255 255 255 / 0.06)); }
.evi-ut-add:disabled { color: var(--text-muted, #949ba4); cursor: not-allowed; }
.evi-ut-edit-note { color: var(--text-muted, #949ba4); }
.evi-ut-chips { display: flex; flex-basis: 100%; flex-wrap: wrap; gap: 6px; margin: 0; padding: 0; list-style: none; }
.evi-ut-chip {
    position: relative;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    max-inline-size: 280px;
    padding: 2px 2px 2px 10px;
    border: 1px solid var(--border-subtle, rgb(255 255 255 / 0.08));
    border-radius: 8px;
    background: var(--background-base-lowest, var(--background-tertiary, #1e1f22));
    overflow: hidden;
    animation: evi-ut-in 0.18s ease-out;
}
.evi-ut-chip > :not(.evi-ut-chip-fill) { position: relative; }
.evi-ut-chip-fill {
    position: absolute;
    inset: 0;
    background: color-mix(in srgb, var(--brand-500, #5865f2) 18%, transparent);
    transform-origin: left;
    transition: transform 0.2s linear;
}
.evi-ut-chip-name { min-inline-size: 0; overflow: hidden; color: var(--text-normal, #dbdee1); text-overflow: ellipsis; white-space: nowrap; }
.evi-ut-chip-state { flex: none; color: var(--text-muted, #949ba4); font-variant-numeric: tabular-nums; }
.evi-ut-chip[data-state="error"] { border-color: var(--status-danger, #f23f43); }
.evi-ut-chip[data-state="error"] .evi-ut-chip-state { color: var(--text-feedback-critical, #f23f43); }

@media (prefers-reduced-motion: reduce) {
    .evi-ut-file, .evi-ut-chip { animation: none; }
    .evi-ut-sorting > li:not(.evi-ut-tools), .evi-ut-dragged > *, .evi-ut-sorting > li.evi-ut-dragged.evi-ut-settling { transition: none; }
}
`,
});
