/**
 * Add files while editing: an "Add files" button under the box you edit your own message in. Picked
 * files start uploading at once and are added to the message when you save.
 *
 * Checked against Discord's code on 2026-10-25:
 * - Removing an attachment from your own message is already Discord's: hovering one shows a remove
 *   button (any time, not only while editing), which sends PATCH /channels/{c}/messages/{m} with the
 *   attachments to keep, through its message actions' patchMessageAttachments(channelId, messageId,
 *   attachments). Its edit box has no way to add files, and that's what this adds.
 * - The edit box is a class component with props { channel, message, saveMessage, onCancel,
 *   validateEdit, onConfirmDelete, ... }. Enter (or "save") calls its onSubmit(text): text that didn't
 *   change isn't sent at all, empty text on a message with nothing else offers to delete it, and
 *   either way the edit ends with MESSAGE_END_EDIT. Escape ends it the same way, without onSubmit.
 *   Scheduled messages are edited in the same box, but aren't in EditMessageStore: no button there.
 * - Each file is a CloudUpload, as when sending: new CloudUpload({ file, platform: 1 }, channelId),
 *   upload() puts it in Discord's storage and leaves its uploadedFilename. The edit then keeps every
 *   attachment by id and adds the new ones by uploaded_filename, sent with patchMessageAttachments.
 */
import { find, getStore, React, useLocale } from "@evi/api";

import { CloseGlyph } from "./details";
import { editAttachments, MAX_ATTACHMENTS, roomFor } from "./order";
import { fraction } from "./progress";
import { formatPercent, formatSize, getCloudUpload, isOn, messageActions, state } from "./state";
import { t } from "./strings";

/** Discord's web upload item (CloudUpload's item.platform) */
const WEB = 1;
/** Discord's error code for a file over the size limit */
const ENTITY_TOO_LARGE = 40005;
const ATTACH_FILES = 1n << 15n;

interface Pending {
    key: string;
    name: string;
    size: number;
    upload: any;
    loaded: number;
    total: number;
    status: "uploading" | "uploaded" | "error";
    error?: "tooBig" | "failed";
    /** Resolves true once it's in Discord's storage, false if it failed or was removed */
    done: Promise<boolean>;
}

/** Files picked for a message being edited, by message id */
const pending = new Map<string, { channelId: string; files: Pending[]; }>();
/** Messages whose edit is being saved: the edit ending then isn't a cancel */
const saving = new Set<string>();
const listeners = new Set<() => void>();
const EMPTY: Pending[] = [];

let emitQueued = false;
function emit(now = false) {
    if (now) {
        emitQueued = false;
        for (const l of [...listeners]) l();
        return;
    }
    if (emitQueued) return;
    emitQueued = true;
    setTimeout(() => emitQueued && emit(true), 100);
}

function cancelUpload(file: Pending) {
    try {
        file.upload?.cancel?.();
    } catch { }
}

/** Drops a message's picked files, deleting what was already uploaded */
export function discard(messageId: string) {
    const entry = pending.get(messageId);
    if (!entry) return;
    pending.delete(messageId);
    entry.files.forEach(cancelUpload);
    emit(true);
}

export function discardAll() {
    for (const id of [...pending.keys()]) discard(id);
    saving.clear();
}

/** The edit of a message ended (saved, cancelled or replaced by another): keep only what's being saved */
export function onEditEnded(channelId: string, exceptMessageId?: string) {
    for (const [id, entry] of pending) {
        if (entry.channelId === channelId && id !== exceptMessageId && !saving.has(id)) discard(id);
    }
}

function addFiles(channelId: string, messageId: string, files: File[]) {
    const CloudUpload = getCloudUpload();
    if (!CloudUpload) {
        state.ctx?.toast(t("edit.unavailable"), { type: "failure" });
        return;
    }
    const entry = pending.get(messageId) ?? { channelId, files: [] };
    pending.set(messageId, entry);
    for (const file of files) {
        let upload: any;
        try {
            upload = new CloudUpload({ file, platform: WEB }, channelId);
        } catch (err) {
            state.ctx?.logger.error("Couldn't start uploading", file.name, err);
            continue;
        }
        const item: Pending = {
            key: String(upload.id ?? `${file.name}-${performance.now()}`), name: file.name, size: file.size, upload,
            loaded: 0, total: file.size, status: "uploading", done: Promise.resolve(false),
        };
        item.done = new Promise<boolean>(resolve => {
            upload.on("progress", (loaded: number, total: number) => {
                item.loaded = loaded;
                if (total > 0) item.total = total;
                emit();
            });
            upload.on("error", (code: unknown) => {
                item.status = "error";
                item.error = code === ENTITY_TOO_LARGE ? "tooBig" : "failed";
                emit(true);
                resolve(false);
            });
            upload.on("complete", () => {
                const ok = upload.status === "COMPLETED" && !!upload.uploadedFilename;
                if (ok) item.status = "uploaded";
                emit(true);
                resolve(ok);
            });
        });
        entry.files.push(item);
        try {
            void Promise.resolve(upload.upload()).catch(() => { });
        } catch (err) {
            state.ctx?.logger.error("Couldn't upload", file.name, err);
        }
    }
    emit(true);
}

function removeFile(messageId: string, file: Pending) {
    const entry = pending.get(messageId);
    if (!entry) return;
    entry.files = entry.files.filter(f => f !== file);
    cancelUpload(file);
    if (!entry.files.length) pending.delete(messageId);
    emit(true);
}

/** Takes a message's picked files to save them: they're no longer the edit box's */
function take(messageId: string): Pending[] {
    const files = pending.get(messageId)?.files ?? [];
    pending.delete(messageId);
    emit(true);
    return files;
}

/** Once every picked file is uploaded, adds them to the message, keeping what it has */
async function commit(channelId: string, messageId: string, files: Pending[], content?: string) {
    const ctx = state.ctx;
    const results = await Promise.all(files.map(f => f.done));
    const uploaded = files.filter((_, i) => results[i]);
    if (!uploaded.length) return;
    const actions = find(messageActions);
    const message = (getStore("MessageStore") as any)?.getMessage?.(channelId, messageId);
    if (typeof actions?.patchMessageAttachments !== "function" || !message) {
        ctx?.toast(t("edit.unavailable"), { type: "failure" });
        uploaded.forEach(cancelUpload);
        return;
    }
    const attachments = editAttachments(message.attachments ?? [], uploaded.map(f => ({
        filename: f.upload.filename ?? f.name,
        uploadedFilename: f.upload.uploadedFilename,
        spoiler: !!f.upload.spoiler,
        description: f.upload.description,
    })));
    try {
        await actions.patchMessageAttachments(channelId, messageId, attachments);
        if (content !== undefined) await actions.editMessage(channelId, messageId, { content });
    } catch (err: any) {
        ctx?.logger.error("Couldn't add the files", err);
        (state.ctx ?? ctx)?.toast(t("edit.saveFailed", { reason: err?.body?.message ?? err?.message ?? t("edit.failed") }), { type: "failure" });
        uploaded.forEach(cancelUpload);
    }
}

/** The edit box's own onSubmit, wrapped so saving also adds the picked files */
const ORIGINAL = Symbol.for("evi.uploadTools.onSubmit");
const wrappers = new WeakMap<object, (value: string) => unknown>();

export function wrapSubmit(editor: any) {
    if (!editor || typeof editor.onSubmit !== "function" || wrappers.get(editor) === editor.onSubmit) return;
    // From an earlier copy of the plugin (hot reload), wrap what Discord gave
    const original: (value: string) => any = editor[ORIGINAL] ?? editor.onSubmit;
    editor[ORIGINAL] = original;
    const wrapper = (value: string) => submit(editor, value, original);
    wrappers.set(editor, wrapper);
    editor.onSubmit = wrapper;
}

function submit(editor: any, value: string, original: (value: string) => any) {
    const { channel, message, onCancel } = editor.props ?? {};
    const files = state.ctx && message?.id ? pending.get(message.id)?.files ?? EMPTY : EMPTY;
    if (!files.length) return original.call(editor, value);
    try {
        const nothingElse = !message.attachments?.length && !message.components?.length && !message.stickerItems?.length && !message.stickers?.length;
        if (typeof value === "string" && value.length === 0 && nothingElse) {
            // Discord would offer to delete the message; it's getting files, so it's saved with them and no text
            const taken = take(message.id);
            onCancel?.(channel.id);
            void commit(channel.id, message.id, taken, "");
            return Promise.resolve({ shouldClear: true, shouldRefocus: true });
        }
    } catch (err) {
        state.ctx?.logger.error("Couldn't save with files", err);
    }
    saving.add(message.id);
    const done = () => void saving.delete(message.id);
    return Promise.resolve(original.call(editor, value)).then(result => {
        done();
        // Saved, whether or not the text changed: add the files. Not saved (too long...): keep them
        if (result?.shouldClear) void commit(channel.id, message.id, take(message.id));
        return result;
    }, err => {
        done();
        throw err;
    });
}

function usePending(messageId: string) {
    const [, rerender] = React.useReducer((n: number) => n + 1, 0);
    React.useEffect(() => {
        const listener = () => rerender();
        listeners.add(listener);
        return () => void listeners.delete(listener);
    }, []);
    return pending.get(messageId)?.files ?? EMPTY;
}

function canAttach(channel: any) {
    if (!channel) return false;
    const isPrivate = typeof channel.isPrivate === "function" ? channel.isPrivate() : !channel.guild_id;
    if (isPrivate) return true;
    const can = (getStore("PermissionStore") as any)?.can;
    return typeof can === "function" ? !!can.call(getStore("PermissionStore"), ATTACH_FILES, channel) : true;
}

const PLUS = "M13 5a1 1 0 1 0-2 0v6H5a1 1 0 1 0 0 2h6v6a1 1 0 1 0 2 0v-6h6a1 1 0 1 0 0-2h-6V5Z";

function stateText(file: Pending) {
    if (file.status === "error") return file.error === "tooBig" ? t("edit.tooBig") : t("edit.failed");
    if (file.status === "uploaded") return formatSize(file.size);
    return formatPercent(fraction(file.loaded, file.total));
}

export function EditFiles({ channel, message }: { channel: any; message: any; }) {
    useLocale();
    const files = usePending(message.id);
    const root = React.useRef<HTMLDivElement>(null);
    const input = React.useRef<HTMLInputElement>(null);
    // The same box edits scheduled messages, which aren't messages yet: only a message being edited
    const editing = (getStore("EditMessageStore") as any)?.isEditing?.(channel?.id, message.id);
    if (!isOn("editFiles") || !editing || !canAttach(channel)) return null;
    const room = roomFor(message.attachments?.length ?? 0, files.length);

    const focusEditor = () => requestAnimationFrame(() => root.current?.parentElement
        ?.querySelector<HTMLElement>('[role="textbox"], textarea')?.focus());

    return (
        <div ref={root} className="evi-ut-edit">
            <button
                type="button"
                className="evi-ut-add"
                disabled={!room}
                title={room ? undefined : t("edit.full", { max: MAX_ATTACHMENTS })}
                onClick={() => input.current?.click()}
            >
                <svg width={16} height={16} viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d={PLUS} /></svg>
                {t("edit.add")}
            </button>
            <input
                ref={input}
                type="file"
                multiple
                hidden
                onChange={e => {
                    const picked = [...e.currentTarget.files ?? []].slice(0, room);
                    e.currentTarget.value = "";
                    if (picked.length) addFiles(channel.id, message.id, picked);
                    focusEditor();
                }}
            />
            {files.length > 0 && <span className="evi-ut-edit-note">{t("edit.pending", { count: files.length })}</span>}
            {files.length > 0 && (
                <ul className="evi-ut-chips">
                    {files.map(file => (
                        <li key={file.key} className="evi-ut-chip" data-state={file.status}>
                            {file.status === "uploading" && <span className="evi-ut-chip-fill" aria-hidden="true" style={{ transform: `scaleX(${fraction(file.loaded, file.total)})` }} />}
                            <span className="evi-ut-chip-name" title={file.name}>{file.name}</span>
                            <span className="evi-ut-chip-state">{stateText(file)}</span>
                            <button type="button" className="evi-ut-icon-button" aria-label={t("edit.remove", { name: file.name })} title={t("edit.remove", { name: file.name })} onClick={() => {
                                removeFile(message.id, file);
                                focusEditor();
                            }}>
                                <CloseGlyph size={14} />
                            </button>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}

/** Edits that start or end, so picked files don't outlive their edit box */
export function subscribeEdits() {
    const ctx = state.ctx;
    if (!ctx) return;
    ctx.flux.subscribe("MESSAGE_END_EDIT", (action: any) => action?.channelId && onEditEnded(action.channelId));
    ctx.flux.subscribe("MESSAGE_START_EDIT", (action: any) => action?.channelId && onEditEnded(action.channelId, action.messageId));
    ctx.onDispose(discardAll);
}
