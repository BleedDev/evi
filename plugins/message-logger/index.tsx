import { Components, definePlugin, Dispatcher, filters, findStore, Menu, React } from "@evi/api";
import type { Filter, FluxAction, HookContext, PluginContext } from "@evi/api";

import {
    AttachmentLike, attachmentKey, attachmentsToSave, LoggedMessage, MAX_SAVED_BYTES, MediaCache, mediaKind, MessageLog, MessageRef, PreviousVersion,
    PREFETCH_FILE_BYTES, removedAttachments, SavedMedia, savedImageUrl, shouldLog, shouldPrefetch,
} from "./log";
import { t } from "./strings";

/**
 * Deleted messages stay in the chat and edited ones keep their previous versions. No source patches:
 *
 * - Flux stores register one handler map per store with the dispatcher. We hook MessageStore's own
 *   MESSAGE_DELETE / MESSAGE_DELETE_BULK / MESSAGE_UPDATE entries in that map, so only MessageStore
 *   keeps a deleted message: read states, mentions, threads... all still see the delete.
 * - What we know lives in our own MessageLog. A message's accessories (embeds, attachments...) are
 *   rendered by an exported function, hooked to add our "Deleted" tag and edit history under it.
 *   The red tint is CSS on the list item that contains our tag.
 * - Deleting a message deletes its attachments from Discord's CDN too, so the kept message would show
 *   broken images. Attachments in the channel you're looking at are downloaded as they load (into
 *   blob: URLs, in memory, capped; pictures as a smaller copy, big videos and files only once
 *   deleted), and a deleted message keeps its copies; Discord's broken ones are hidden and ours are
 *   shown. An edit that removes an attachment keeps it with the old version.
 * - On stop, kept messages are really deleted from MessageStore (a private action only it handles),
 *   the log is cleared, so every tag and history unmounts, saved copies are let go, and the stylesheet goes.
 * - Right-clicking a channel, thread, DM or server with anything logged offers to clear just that,
 *   the same purge as the settings button, scoped to its channels.
 */

const PURGE_ACTION = "EVI_MESSAGE_LOGGER_PURGE";
/** How long a delete you started waits for Discord's MESSAGE_DELETE */
const SELF_DELETE_WINDOW = 60_000;
/** Saved copies of attachments not (yet) deleted, all together: pictures are smaller copies, other files 5 MB at most */
const CACHE_BYTES = 25 * 1024 * 1024;
/** Messages a loaded page of history has its attachments saved from, newest first */
const SAVE_FROM_LOADED = 50;

const accessoriesFilter = filters.byCode("channelMessageProps:{message:", "isAutomodBlockedMessage:");
/** Discord's useMessageRenderedContent(message, options). Its options (hideSimpleEmbedContent) are read by a helper since Discord's build of 2026-10-30 */
const renderedContentFilter = filters.byCode('"useMessageRenderedContent"', "hasBailedAst:");
/**
 * The CSS module with Discord's `markup` class, which styles rendered message content. Its code hint
 * is plain strings: a regex tested against every module's source costs far more.
 */
const MARKUP_CLASS = /^markup_+[\da-f]+$/;
const markupFilter: Filter = Object.assign(
    (v: any) => !!v && typeof v === "object" && !Array.isArray(v)
        && Object.values(v).some(c => typeof c === "string" && MARKUP_CLASS.test(c))
        && Object.values(v).some(c => typeof c === "string" && /^codeContainer_+[\da-f]+$/.test(c)),
    { $code: ['"markup_', '"codeContainer_'] },
);
/** Discord's message actions. The code hint lets the search skip every module that can't define them. */
const messageActionsFilter = Object.assign(filters.byProps("deleteMessage", "editMessage", "sendMessage"), { $code: ["deleteMessage", "editMessage", "sendMessage"] });

/**
 * A Flux store: from Evi's store cache when it's already been found (no search at all), otherwise
 * as soon as it loads
 */
function withStore(ctx: PluginContext<any>, name: string, callback: (store: any) => void) {
    const found = findStore(name);
    if (found) callback(found);
    else ctx.waitFor(filters.byStoreName(name), callback);
}

type RenderedContent = (message: any, options: Record<string, unknown>) => { content: React.ReactNode; };

// Found once and kept across restarts of the plugin: they're Discord's, not ours
let useRenderedContent: RenderedContent | undefined;
let markupClass = "";

const css = `
[data-list-item-id^="chat-messages___"]:has(.dl-ml-deleted) {
    background: color-mix(in srgb, var(--status-danger, #f23f43) 8%, transparent);
    box-shadow: inset 2px 0 0 var(--status-danger, #f23f43);
}
.dl-ml {
    text-indent: 0;
    padding: 0.125rem 0;
    font-family: var(--font-primary);
}
.dl-ml-history {
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
    margin: 0.125rem 0;
    padding-inline-start: 0.5rem;
    border-inline-start: 2px solid var(--border-subtle, rgba(151, 151, 159, 0.12));
}
.dl-ml-caption, .dl-ml-time, .dl-ml-deleted {
    font-size: 0.75rem;
    line-height: 1rem;
}
.dl-ml-caption {
    color: var(--text-muted, #949ba4);
    font-weight: 500;
}
.dl-ml-version {
    color: var(--text-muted, #949ba4);
    font-size: 0.875rem;
    line-height: 1.25rem;
    overflow-wrap: anywhere;
    white-space: pre-wrap;
}
.dl-ml-time {
    color: var(--text-muted, #949ba4);
    margin-inline-end: 0.375rem;
    font-variant-numeric: tabular-nums;
}
.dl-ml-content {
    display: inline;
}
.dl-ml-deleted {
    display: inline-block;
    color: var(--text-feedback-critical, var(--status-danger, #f23f43));
    font-weight: 500;
}
/* Discord's own attachments of a deleted message are gone from its CDN: our saved copies stand in */
[data-list-item-id^="chat-messages___"]:has(.dl-ml-saved) :is([class*="visualMediaItemContainer_"], [class*="nonVisualMediaItemContainer_"]) {
    display: none;
}
.dl-ml-media {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    margin: 0.25rem 0;
}
.dl-ml-media img, .dl-ml-media video {
    display: block;
    max-width: min(400px, 100%);
    max-height: 300px;
    border-radius: 8px;
    outline: 1px solid rgb(255 255 255 / 0.08);
    outline-offset: -1px;
    background: var(--background-secondary, #2b2d31);
}
.dl-ml-history .dl-ml-media img, .dl-ml-history .dl-ml-media video {
    max-width: 200px;
    max-height: 150px;
}
.dl-ml-spoiler {
    all: unset;
    position: relative;
    display: block;
    cursor: pointer;
    border-radius: 8px;
    overflow: hidden;
}
.dl-ml-spoiler > img { filter: blur(44px); }
.dl-ml-spoiler > span {
    position: absolute;
    inset: 50% auto auto 50%;
    translate: -50% -50%;
    padding: 4px 10px;
    border-radius: 999px;
    background: rgb(0 0 0 / 0.6);
    color: #fff;
    font-size: 0.75rem;
    font-weight: 600;
}
.dl-ml-spoiler:focus-visible { outline: 2px solid var(--focus-primary, #00a8fc); }
.dl-ml-file {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 0.75rem;
    border-radius: 8px;
    border: 1px solid var(--border-subtle, rgba(151, 151, 159, 0.12));
    background: var(--background-secondary, #2b2d31);
    color: var(--text-link, #00a8fc);
    font-size: 0.875rem;
}
.dl-ml-file small { color: var(--text-muted, #949ba4); }
`;

function formatTime(ms: number) {
    const date = new Date(ms);
    const sameDay = date.toDateString() === new Date().toDateString();
    return sameDay
        ? date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
        : date.toLocaleString([], { dateStyle: "short", timeStyle: "short" });
}

function Time({ ms }: { ms: number; }) {
    return <time className="dl-ml-time" dateTime={new Date(ms).toISOString()}>{formatTime(ms)}</time>;
}

/** An old version rendered by Discord's own message renderer: markdown, mentions, emoji */
function RichContent({ message, content, render }: { message: any; content: string; render: RenderedContent; }) {
    const record = React.useMemo(() => message.set?.("content", content) ?? { ...message, content }, [message, content]);
    const rendered = render(record, {
        hideSimpleEmbedContent: false,
        formatInline: false,
        allowLinks: true,
        allowList: true,
        allowHeading: true,
    });
    return <>{rendered?.content ?? content}</>;
}

const revokeAll = (media: readonly SavedMedia[]) => {
    for (const m of media) URL.revokeObjectURL(m.url);
};

const formatSize = (bytes: number) => bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

/** A spoilered image stays blurred until clicked, like Discord's */
function Spoiler({ children }: { children: React.ReactElement; }) {
    const [shown, setShown] = React.useState(false);
    if (shown) return children;
    return <button type="button" className="dl-ml-spoiler" aria-label={t("spoiler.show")} onClick={() => setShown(true)}>{children}<span>{t("spoiler")}</span></button>;
}

/** Saved copies: pictures and videos as themselves, sounds with a player, anything else as a download */
function SavedMediaList({ media }: { media: readonly SavedMedia[]; }) {
    return (
        <div className="dl-ml-media">
            {media.map(m => {
                if (m.kind === "image") {
                    const img = <img src={m.url} alt={m.name} width={m.width} height={m.height} loading="lazy" />;
                    return <React.Fragment key={m.key}>{m.spoiler ? <Spoiler>{img}</Spoiler> : img}</React.Fragment>;
                }
                if (m.kind === "video") return <video key={m.key} src={m.url} controls preload="metadata" aria-label={m.name} />;
                if (m.kind === "audio") return <audio key={m.key} src={m.url} controls preload="metadata" aria-label={m.name} />;
                return <a key={m.key} className="dl-ml-file" href={m.url} download={m.name}>{m.name} <small>{formatSize(m.size)}</small></a>;
            })}
        </div>
    );
}

function Version({ message, version }: { message: any; version: PreviousVersion; }) {
    const render = useRenderedContent;
    return (
        <div className="dl-ml-version">
            <Time ms={version.timestamp} />
            <div className={`dl-ml-content ${markupClass}`}>
                {render ? <RichContent message={message} content={version.content} render={render} /> : version.content}
            </div>
            {!!version.media?.length && <SavedMediaList media={version.media} />}
        </div>
    );
}

function Logged({ log, message }: { log: MessageLog; message: any; }) {
    const entry: LoggedMessage | undefined = React.useSyncExternalStore(log.subscribe, () => log.get(message.channel_id, message.id));
    if (!entry) return null;
    const saved = entry.deletedAt !== undefined && !!entry.media?.length;
    return (
        <div className={saved ? "dl-ml dl-ml-saved" : "dl-ml"}>
            {saved && <SavedMediaList media={entry.media!} />}
            {entry.edits.length > 0 && (
                <div className="dl-ml-history" role="group" aria-label={t("versions")}>
                    <div className="dl-ml-caption">{t("edited.from")}</div>
                    {entry.edits.map((version, i) => <Version key={i} message={message} version={version} />)}
                </div>
            )}
            {entry.deletedAt !== undefined && (
                <span className="dl-ml-deleted">
                    {t("deleted")} <time dateTime={new Date(entry.deletedAt).toISOString()}>{formatTime(entry.deletedAt)}</time>
                </span>
            )}
        </div>
    );
}

interface Runtime {
    log: MessageLog;
    /** Forgets everything and removes kept deleted messages from the chat */
    clear(): void;
    /** The same, for some channels only */
    clearChannels(channelIds: string[]): void;
}

let active: Runtime | undefined;

function Summary({ runtime }: { runtime: Runtime; }) {
    React.useSyncExternalStore(runtime.log.subscribe, () => runtime.log.version);
    const { deleted, edited } = runtime.log.counts();
    const Button = Components.Button as any;
    const empty = deleted + edited === 0;
    const label = t("clear");

    return (
        <div className="dl-field-row">
            <div className="dl-field-text">
                <div className="dl-label">{t("summary.title")}</div>
                <p className="dl-hint" role="status" style={{ fontVariantNumeric: "tabular-nums" }}>
                    {t("summary.text", { deleted, edited })}
                </p>
            </div>
            {Button
                ? <Button color={Button.Colors?.RED} size={Button.Sizes?.SMALL} disabled={empty} onClick={runtime.clear}>{label}</Button>
                : <button type="button" className="dl-button" disabled={empty} onClick={runtime.clear}>{label}</button>}
        </div>
    );
}

const settings = {
    keepDeleted: { type: "boolean", get label() { return t("settings.keepDeleted"); }, get description() { return t("settings.keepDeleted.description"); }, default: true },
    logEdits: { type: "boolean", get label() { return t("settings.logEdits"); }, get description() { return t("settings.logEdits.description"); }, default: true },
    ignoreOwnDeletes: { type: "boolean", get label() { return t("settings.ignoreOwnDeletes"); }, get description() { return t("settings.ignoreOwnDeletes.description"); }, default: true },
    ignoreSelf: { type: "boolean", get label() { return t("settings.ignoreSelf"); }, get description() { return t("settings.ignoreSelf.description"); }, default: false },
    ignoreBots: { type: "boolean", get label() { return t("settings.ignoreBots"); }, get description() { return t("settings.ignoreBots.description"); }, default: false },
    saveMedia: {
        type: "boolean",
        get label() { return t("settings.saveMedia"); },
        get description() { return t("settings.saveMedia.description"); },
        default: true,
    },
    limit: {
        type: "number",
        get label() { return t("settings.limit"); },
        get description() { return t("settings.limit.description"); },
        default: 50,
        min: 10,
        max: 200,
        step: 10,
    },
} as const;

type Ctx = PluginContext<typeof settings>;

/**
 * Saving attachments: from the channel you're looking at as they load, into a capped cache; a deleted
 * message takes its copies out of it (or downloads them then, if they're still there).
 */
function mediaSaver(ctx: Ctx, cache: MediaCache<SavedMedia>) {
    const pending = new Map<string, Promise<SavedMedia | undefined>>();
    const queue: (() => Promise<unknown>)[] = [];
    let running = 0;
    const pump = () => {
        while (running < 2 && queue.length) {
            running++;
            void queue.shift()!().finally(() => {
                running--;
                pump();
            });
        }
    };

    /** Downloads one attachment. Discord's page may keep it cached, which is what's left once it's deleted. */
    async function download(a: AttachmentLike): Promise<SavedMedia | undefined> {
        const name = a.filename ?? "attachment";
        // A picture as a smaller copy first (it's shown at 400x300 at most), its full size only if that fails
        const urls = mediaKind(a) === "image"
            ? [savedImageUrl(a), a.proxy_url, (a.size ?? 0) <= PREFETCH_FILE_BYTES ? a.url : undefined]
            : [a.url, a.proxy_url];
        for (const url of urls) {
            if (!url) continue;
            try {
                const res = await fetch(url, { cache: "force-cache" });
                if (!res.ok) continue;
                const blob = await res.blob();
                if (blob.size > MAX_SAVED_BYTES) return;
                return {
                    key: attachmentKey(a), name, kind: mediaKind(a), url: URL.createObjectURL(blob), size: blob.size,
                    ...(a.width && { width: a.width }), ...(a.height && { height: a.height }), spoiler: name.startsWith("SPOILER_"),
                };
            } catch { }
        }
    }

    /** One download per attachment at a time, two at once */
    const fetchOnce = (a: AttachmentLike) => {
        const key = attachmentKey(a);
        let job = pending.get(key);
        if (!job) {
            job = new Promise(resolve => {
                queue.push(() => download(a).then(resolve, () => resolve(undefined)));
                pump();
            });
            pending.set(key, job);
            void job.finally(() => pending.delete(key));
        }
        return job;
    };

    return {
        /** Saves a message's attachments ahead of time, into the cache */
        prefetch(attachments: readonly AttachmentLike[] | undefined) {
            if (!ctx.settings.get("saveMedia")) return;
            for (const a of attachmentsToSave(attachments).filter(shouldPrefetch)) {
                const key = attachmentKey(a);
                if (cache.has(key) || pending.has(key)) continue;
                void fetchOnce(a).then(m => m && cache.set(key, m));
            }
        },
        /**
         * A message's attachments for keeping: the saved copies right away, the rest when (if) they
         * download. `later` gets those.
         */
        keep(attachments: readonly AttachmentLike[] | undefined, later: (media: SavedMedia[]) => void): SavedMedia[] {
            if (!ctx.settings.get("saveMedia")) return [];
            const now: SavedMedia[] = [];
            const missing: AttachmentLike[] = [];
            for (const a of attachmentsToSave(attachments)) {
                const saved = cache.take(attachmentKey(a));
                if (saved) now.push(saved);
                else missing.push(a);
            }
            if (missing.length) {
                void Promise.all(missing.map(a => fetchOnce(a).then(m => m && (cache.take(m.key) ?? m)))).then(list => {
                    const got = list.filter((m): m is SavedMedia => !!m);
                    if (got.length) later(got);
                });
            }
            return now;
        },
    };
}

function install(ctx: Ctx, log: MessageLog, store: any, saver: ReturnType<typeof mediaSaver>) {
    const registry = (Dispatcher as any)._actionHandlers;
    const token = store.getDispatchToken?.();
    // Discord keeps each store's handlers in _nodes (token -> { actionHandler }) since October 2026,
    // in a dependency graph before that
    const handlers = registry?._nodes?.get?.(token)?.actionHandler ?? registry?._dependencyGraph?.getNodeData?.(token)?.actionHandler;
    if (!handlers || !["MESSAGE_DELETE", "MESSAGE_DELETE_BULK", "MESSAGE_UPDATE"].every(t => typeof handlers[t] === "function")) {
        ctx.logger.error("Couldn't find MessageStore's action handlers, Discord changed how Flux stores register");
        return;
    }
    // The dispatcher caches each action type's handler list: rebuild it whenever ours change
    const invalidate = () => registry._invalidateCaches?.();
    ctx.onDispose(invalidate);

    let users: any;
    withStore(ctx, "UserStore", s => void (users = s));

    const logFilters = () => ({
        currentUserId: users?.getCurrentUser?.()?.id,
        ignoreSelf: ctx.settings.get("ignoreSelf"),
        ignoreBots: ctx.settings.get("ignoreBots"),
    });

    // Deletes you start: Discord's deleteMessage(channelId, messageId, local)
    const selfDeletes = new Map<string, number>();
    ctx.hookExport("before", messageActionsFilter, "deleteMessage", ({ args }) => {
        const now = Date.now();
        for (const [key, at] of selfDeletes) if (now - at > SELF_DELETE_WINDOW) selfDeletes.delete(key);
        selfDeletes.set(`${args[0]}:${args[1]}`, now);
    });

    /** Really deletes messages from MessageStore, and nowhere else: only our private action reaches it */
    const purge = (refs: MessageRef[]) => {
        const byChannel = new Map<string, string[]>();
        for (const { channelId, id } of refs) byChannel.set(channelId, [...byChannel.get(channelId) ?? [], id]);
        return Promise.all([...byChannel].map(([channelId, ids]) => Dispatcher.dispatch({ type: PURGE_ACTION, channelId, ids })));
    };
    const purgeHandler = (action: FluxAction) =>
        handlers.MESSAGE_DELETE_BULK({ type: "MESSAGE_DELETE_BULK", channelId: action.channelId, ids: action.ids, eviPurge: true });
    handlers[PURGE_ACTION] = purgeHandler;
    // The _nodes registry only asks the stores listed for an action type: list MessageStore for ours
    const byType: Record<string, string[]> | undefined = registry._tokensByActionType;
    if (byType && !byType[PURGE_ACTION]?.includes(token)) (byType[PURGE_ACTION] ??= []).push(token);

    const shouldKeep = (action: FluxAction, channelId: string, id: string) => {
        if (log.isDeleted(channelId, id)) return true;
        const key = `${channelId}:${id}`;
        const self = selfDeletes.delete(key);
        if (action.local || !ctx.settings.get("keepDeleted")) return false;
        if (self && ctx.settings.get("ignoreOwnDeletes")) return false;
        const message = store.getMessage(channelId, id);
        return !!message && shouldLog(message, logFilters());
    };

    /** A kept message's attachments stay with it: saved copies now, the rest as they download */
    const keepMedia = (channelId: string, id: string) => {
        const attachments = store.getMessage(channelId, id)?.attachments;
        if (!attachments?.length || log.get(channelId, id)?.media?.length) return;
        const now = saver.keep(attachments, later => {
            if (!log.addMedia(channelId, id, later)) revokeAll(later);
        });
        if (!log.addMedia(channelId, id, now)) revokeAll(now);
    };

    ctx.hook.instead(handlers, "MESSAGE_DELETE", (call: HookContext) => {
        const action = call.args[0] as FluxAction;
        if (action.eviPurge || !shouldKeep(action, action.channelId, action.id)) return call.callOriginal(...call.args);
        void purge(log.markDeleted(action.channelId, action.id));
        keepMedia(action.channelId, action.id);
        // Nothing changed in the store; our tag re-renders from the log
        return false;
    });

    ctx.hook.instead(handlers, "MESSAGE_DELETE_BULK", (call: HookContext) => {
        const action = call.args[0] as FluxAction;
        if (action.eviPurge) return call.callOriginal(...call.args);
        const keep: string[] = [];
        const drop: string[] = [];
        for (const id of action.ids ?? []) (shouldKeep(action, action.channelId, id) ? keep : drop).push(id);
        void purge(keep.flatMap(id => log.markDeleted(action.channelId, id)));
        for (const id of keep) keepMedia(action.channelId, id);
        return drop.length ? call.callOriginal({ ...action, ids: drop }) : false;
    });

    // Before MessageStore applies an edit: the old content is still there to record
    ctx.hook.before(handlers, "MESSAGE_UPDATE", ({ args }) => {
        const next = args[0]?.message;
        if (!ctx.settings.get("logEdits") || !next?.id) return;
        const channelId = next.channel_id;
        const old = store.getMessage(channelId, next.id);
        if (!old || typeof old.content !== "string" || !shouldLog(old, logFilters())) return;
        // An edit can change the text, take attachments away, or both
        const changedText = typeof next.content === "string" && old.content !== next.content;
        const removed = removedAttachments(old.attachments, next.attachments);
        if (!changedText && !removed.length) return;
        const timestamp = Number(old.editedTimestamp ?? old.timestamp) || Date.now();
        const media = saver.keep(removed, later => {
            if (!log.addEditMedia(channelId, next.id, timestamp, later)) revokeAll(later);
        });
        void purge(log.addEdit(channelId, next.id, { content: old.content, timestamp, ...(media.length && { media }) }));
    });

    invalidate();

    const runtime: Runtime = {
        log,
        clear: () => void purge(log.clear()),
        clearChannels: ids => void purge(log.clearChannels(ids)),
    };
    active = runtime;

    ctx.settings.onChange(values => {
        void purge(log.setLimits({ perChannel: values.limit }));
        if (!values.keepDeleted) {
            const kept = [...log.deleted()].flatMap(([channelId, ids]) => ids.map(id => ({ channelId, id })));
            for (const { channelId, id } of kept) log.remove(channelId, id);
            void purge(kept);
        }
    });

    // Runs first on stop, while our hooks are still in place (they let the purge through)
    ctx.onDispose(() => {
        if (active === runtime) active = undefined;
        purge(log.clear()).finally(() => {
            if (handlers[PURGE_ACTION] !== purgeHandler) return;
            delete handlers[PURGE_ACTION];
            if (byType) delete byType[PURGE_ACTION];
            invalidate();
        });
    });
}

/**
 * Deleted messages marked by their element ids, which Discord gives every message row
 * (chat-messages-<channel>-<id>) and its text (message-content-<id>): red text, the row tint and a
 * "Deleted" label, whatever Discord renders the message with. The tag under the message (Logged) adds
 * the time and the edit history where the accessories hook runs, and the label then steps aside.
 */
function markDeleted(ctx: Ctx, log: MessageLog) {
    const style = document.createElement("style");
    style.id = "evi-message-logger-deleted";
    document.head.append(style);
    ctx.onDispose(() => style.remove());

    const update = () => {
        const label = JSON.stringify(` (${t("deleted").toLowerCase()})`);
        const rules: string[] = [];
        for (const [channelId, ids] of log.deleted()) {
            for (const id of ids) {
                const row = `#chat-messages-${channelId}-${id}`;
                const text = `${row} #message-content-${id}`;
                rules.push(
                    `${row} { background: color-mix(in srgb, var(--status-danger, #f23f43) 8%, transparent); box-shadow: inset 2px 0 0 var(--status-danger, #f23f43); opacity: 1 !important; }`,
                    `${text} { color: var(--text-feedback-critical, var(--status-danger, #f23f43)) !important; opacity: 1 !important; }`,
                    `${row}:not(:has(.dl-ml-deleted)) #message-content-${id}::after { content: ${label}; font-size: 0.75rem; font-weight: 500; }`,
                );
            }
        }
        const css = rules.join("\n");
        if (style.textContent !== css) style.textContent = css;
    };
    update();
    ctx.onDispose(log.subscribe(update));
}

/** "3 deleted, 1 edited" */
function countLabel({ deleted, edited }: { deleted: number; edited: number; }) {
    return [deleted && t("count.deleted", { count: deleted }), edited && t("count.edited", { count: edited })].filter(Boolean).join(t("count.sep"));
}

/** A menu group clearing these channels' logs, or nothing when they have none */
function clearItem(ctx: Ctx, id: string, label: string, channelIds: string[]) {
    const runtime = active;
    if (!runtime || !channelIds.length) return;
    const counts = runtime.log.counts(channelIds);
    if (counts.deleted + counts.edited === 0) return;
    return (
        <Menu.Group key={`${id}-group`}>
            <Menu.Item
                id={id}
                label={label}
                subtext={countLabel(counts)}
                color="danger"
                action={() => {
                    runtime.clearChannels(channelIds);
                    ctx.toast(t("cleared", { counts: countLabel(counts) }), { type: "success" });
                }}
            />
        </Menu.Group>
    );
}

/** Logged channels in a server, threads included */
function guildChannelIds(guildId: string) {
    const channels = findStore("ChannelStore");
    return active?.log.channelIds().filter(id => channels?.getChannel?.(id)?.guild_id === guildId) ?? [];
}

export default definePlugin({
    settings,

    start(ctx) {
        // Saved copies are let go with the message they belong to
        const log = new MessageLog({ perChannel: ctx.settings.get("limit") }, entry => {
            revokeAll(entry.media ?? []);
            for (const e of entry.edits) revokeAll(e.media ?? []);
        });
        const cache = new MediaCache<SavedMedia>(CACHE_BYTES, m => URL.revokeObjectURL(m.url));
        const saver = mediaSaver(ctx, cache);
        ctx.onDispose(() => cache.clear());
        ctx.addStyle(css);

        withStore(ctx, "MessageStore", store => install(ctx, log, store, saver));
        markDeleted(ctx, log);

        // Attachments in the channel you're looking at, saved as they load: after a delete they're gone from Discord
        let selected: any;
        withStore(ctx, "SelectedChannelStore", s => void (selected = s));
        const inView = (channelId: string) => !!channelId && channelId === selected?.getChannelId?.();
        ctx.flux.subscribe("MESSAGE_CREATE", action => {
            if (inView(action.channelId) && !action.optimistic) saver.prefetch(action.message?.attachments);
        });
        ctx.flux.subscribe("LOAD_MESSAGES_SUCCESS", action => {
            if (!inView(action.channelId) || !Array.isArray(action.messages)) return;
            for (const m of action.messages.slice(0, SAVE_FROM_LOADED)) saver.prefetch(m?.attachments);
        });
        ctx.settings.onChange(values => void (!values.saveMedia && cache.clear()));
        // Kept from an earlier start: no need to search every module again
        if (!useRenderedContent) ctx.waitFor(renderedContentFilter, fn => void (useRenderedContent = fn));
        if (!markupClass) ctx.waitFor(markupFilter, classes => {
            markupClass = Object.values(classes).find((c): c is string => typeof c === "string" && MARKUP_CLASS.test(c)) ?? "";
        });

        ctx.contextMenu(["channel-context", "thread-context", "gdm-context"], (children, props) => {
            const item = props.channel?.id && clearItem(ctx, "evi-ml-clear-channel", t("clear.menu"), [props.channel.id]);
            if (item) children.push(item);
        });
        // A DM in the list: the menu is the other user's, with the DM as its channel
        ctx.contextMenu("user-context", (children, props) => {
            const channel = props.channel;
            if (!channel?.id || channel.guild_id || channel.type !== 1) return;
            const item = clearItem(ctx, "evi-ml-clear-dm", t("clear.menu"), [channel.id]);
            if (item) children.push(item);
        });
        ctx.contextMenu("guild-context", (children, props) => {
            const item = props.guild?.id && clearItem(ctx, "evi-ml-clear-guild", t("clear.menu"), guildChannelIds(props.guild.id));
            if (item) children.push(item);
        });

        // Discord's renderMessageAccessories({ channelMessageProps: { message, channel }, ... })
        ctx.hookExport("after", accessoriesFilter, ({ args, result }) => {
            const props = args[0];
            const message = props?.channelMessageProps?.message;
            if (result == null || props.isMessageSnapshot || !message?.id) return;
            return <>{result}<Logged log={log} message={message} /></>;
        });
    },

    settingsPanel: () => active && <Summary runtime={active} />,

    /** The running plugin's log, for tests and debugging */
    getLog: () => active?.log,
});
