/**
 * Embed Builder: compose a webhook message with a live preview, then send it through one of the
 * channel's webhooks, or edit a message a webhook sent before. A message is classic (content and up
 * to 10 embeds) or Components V2 (layout blocks: text, sections, galleries, files, separators,
 * containers and link buttons), as in Discord.
 *
 * - Where: right-click a text channel or thread you can manage webhooks in, or /embed there.
 * - Webhooks: GET /channels/:id/webhooks with Discord's own API client (threads use their parent's
 *   and post with ?thread_id). "New webhook" makes one named "Evi Embeds".
 * - Sending: the webhook's own URL (it carries its token, so no account token is involved), with the
 *   plugin's fetch, which Evi limits to discord.com. V2 messages add ?with_components=true, without
 *   which Discord drops a non-app webhook's components. Picked files go as multipart, so
 *   attachment://name works in images, galleries and File components. Webhook tokens are never
 *   logged or saved.
 * - Drafts: the open message is kept per channel while you work, and named drafts are kept in the
 *   plugin's settings. Picked files aren't kept: they're only in memory while the dialog is open.
 */
import { definePlugin, Dropdown, filters, find, getStore, Menu, openLayer, React } from "@evi/api";
import type { CloseLayer, PluginContext } from "@evi/api";
import type { ReactNode } from "react";

import {
    attachmentName, Block, Child, componentCount, componentTextLength, convertToV2, Draft, draftFromJson, draftToJson, Embed, emptyBlock, emptyButton,
    emptyDraft, emptyEmbed, emptyField, emptyMedia, embedLength, Field, fieldColumns, galleryRows, hexToInt, Kind, LIMITS, LinkButton, MediaItem, Mode,
    parseMessageLink, payload, Problem, problems, requestBody, safeFileName, SentAttachment, THREAD_TYPES, totalLength, usableWebhooks, WEBHOOK_TYPES, webhookUrl,
} from "./embed";
import { t } from "./strings";

let context: PluginContext | undefined;

const MANAGE_WEBHOOKS = 1n << 29n;
const DRAFTS_KEY = "drafts";
const OPEN_KEY = "open";
const MAX_DRAFTS = 30;
const WEBHOOK_NAME = "Evi Embeds";

const store = (name: string): any => {
    try {
        return getStore(name);
    } catch {
        return undefined;
    }
};

type HttpClient = { get(opts: any): Promise<any>; post(opts: any): Promise<any>; };
/** Discord's API client ({ get, post, put, patch, del }), not the superagent under it (see Emoji Stealer) */
const http = (): HttpClient | undefined => find(v => typeof v?.patch === "function" && typeof v?.del === "function"
    && typeof v?.post === "function" && !("getXHR" in v) && !("Request" in v));

const markdown = (): any => find(filters.byProps("parse", "parseTopic"));

/** The channel webhooks live in: a thread's parent */
const webhookChannelId = (channel: any): string => THREAD_TYPES.has(channel?.type) ? channel.parent_id ?? channel.parentId : channel.id;

function canUse(channel: any): boolean {
    if (!channel?.guild_id || !WEBHOOK_TYPES.has(channel.type)) return false;
    try {
        const target = THREAD_TYPES.has(channel.type) ? store("ChannelStore")?.getChannel?.(webhookChannelId(channel)) : channel;
        return !!target && !!store("PermissionStore")?.can?.(MANAGE_WEBHOOKS, target);
    } catch {
        return false;
    }
}

function errorText(err: any, fallback: string): string {
    const body = err?.body;
    if (body && typeof body === "object") {
        if (typeof body.message === "string" && body.message && body.message !== "Invalid Form Body") return body.message;
        const first = firstError(body.errors ?? body);
        if (first) return first;
        if (typeof body.message === "string" && body.message) return body.message;
    }
    if (typeof err?.message === "string" && err.message) return err.message;
    return fallback;
}

function firstError(node: any, path = ""): string | undefined {
    if (!node || typeof node !== "object") return undefined;
    if (Array.isArray(node._errors) && node._errors[0]?.message) return path ? `${path}: ${node._errors[0].message}` : node._errors[0].message;
    for (const [k, v] of Object.entries(node)) {
        const found = firstError(v, path ? `${path}.${k}` : k);
        if (found) return found;
    }
    return undefined;
}

interface Webhook { id: string; name: string; token: string; avatar: string | null; channelId: string; }

function apiClient(): HttpClient {
    const client = http();
    if (!client) throw new Error(t("error.noClient"));
    return client;
}

async function listWebhooks(channel: any): Promise<Webhook[]> {
    const res = await apiClient().get({ url: `/channels/${webhookChannelId(channel)}/webhooks`, rejectWithError: true });
    return usableWebhooks(res?.body);
}

async function createWebhook(channel: any): Promise<Webhook> {
    const res = await apiClient().post({ url: `/channels/${webhookChannelId(channel)}/webhooks`, body: { name: WEBHOOK_NAME }, rejectWithError: true });
    const [hook] = usableWebhooks([res?.body]);
    if (!hook) throw new Error(t("error.createFailed"));
    return hook;
}

/**
 * Calls a webhook URL, as JSON or (with files) multipart; Discord's error message on failure. Sent from
 * the main process (native.ts): Discord refuses webhook calls made from its own page since 2026-10.
 */
async function callWebhook(url: string, method: "GET" | "POST" | "PATCH", body?: Record<string, unknown>, files: File[] = []): Promise<any> {
    const sent = await Promise.all(files.map(async f => ({ name: f.name, type: f.type, bytes: new Uint8Array(await f.arrayBuffer()) })));
    const res = await context!.native.call<{ status: number; text: string; }>("webhook", url, method, body, sent);
    const text = res.text;
    let json: any;
    try {
        json = text ? JSON.parse(text) : undefined;
    } catch { /* not JSON */ }
    const ok = res.status >= 200 && res.status < 300;
    if (!ok) {
        if (res.status === 429) throw new Error(t("error.rateLimited", { seconds: Math.ceil(Number(json?.retry_after) || 1) }));
        if (res.status === 404) throw new Error(t("error.notFound"));
        if (res.status === 413) throw new Error(t("error.tooBig"));
        throw new Error(errorText({ body: json }, t("error.status", { status: res.status })));
    }
    return json;
}

async function copy(text: string, done: string) {
    try {
        const native = (window as any).DiscordNative?.clipboard;
        if (native?.copy) native.copy(text);
        else await navigator.clipboard.writeText(text);
        context?.toast(done, { type: "success" });
    } catch {
        context?.toast(t("toast.copyFailed"), { type: "failure" });
    }
}

interface SavedDraft { name: string; savedAt: number; draft: Draft; }

const storage = () => context?.settings as unknown as { get(key: string): any; set(key: string, value: unknown): void; } | undefined;

const fromSaved = (raw: unknown): Draft | undefined => {
    try {
        const { skipped: _skipped, ...draft } = draftFromJson(JSON.stringify(raw));
        return draft;
    } catch {
        return undefined;
    }
};

function savedDrafts(): SavedDraft[] {
    const raw = storage()?.get(DRAFTS_KEY);
    if (!Array.isArray(raw)) return [];
    return raw.filter(d => d && typeof d.name === "string" && d.draft).map(d => {
        const draft = fromSaved(d.draft);
        return draft ? { name: d.name, savedAt: Number(d.savedAt) || 0, draft } : undefined;
    }).filter((d): d is SavedDraft => !!d);
}

/** Drafts are kept in the webhook body shape, so they survive changes to the editor */
const storeDrafts = (list: SavedDraft[]) => storage()?.set(DRAFTS_KEY, list.slice(0, MAX_DRAFTS).map(d => ({ name: d.name, savedAt: d.savedAt, draft: payload(d.draft) })));

function openDrafts(): Record<string, unknown> {
    const raw = storage()?.get(OPEN_KEY);
    return raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
}

const loadOpen = (channelId: string): Draft | undefined => {
    const raw = openDrafts()[channelId];
    return raw ? fromSaved(raw) : undefined;
};

function saveOpen(channelId: string, draft: Draft | undefined) {
    const all = { ...openDrafts() };
    if (draft) all[channelId] = payload(draft);
    else delete all[channelId];
    // Only the last few channels
    const keys = Object.keys(all);
    for (const k of keys.slice(0, Math.max(0, keys.length - 10))) delete all[k];
    storage()?.set(OPEN_KEY, all);
}

function firstText(blocks: Block[]): string {
    for (const b of blocks) {
        const kids: Child[] = b.kind === "container" ? b.children : [b];
        for (const c of kids) {
            if (c.kind === "text" && c.content.trim()) return c.content;
            if (c.kind === "section" && c.texts[0]?.trim()) return c.texts[0];
        }
    }
    return "";
}

const draftName = (d: Draft) => {
    const e = d.embeds[0];
    const raw = d.mode === "v2" ? firstText(d.components) : (e?.title || e?.description || d.content || e?.authorName || "");
    const text = raw.replace(/^[#\-\s>*]+/, "").replace(/\s+/g, " ").trim();
    return text ? text.slice(0, 48) : t("drafts.untitled");
};

const ICON = {
    up: "M12 7.4 5.7 13.7a1 1 0 1 0 1.4 1.4L12 10.2l4.9 4.9a1 1 0 0 0 1.4-1.4L12 7.4Z",
    down: "M12 16.6l6.3-6.3a1 1 0 1 0-1.4-1.4L12 13.8 7.1 8.9a1 1 0 0 0-1.4 1.4l6.3 6.3Z",
    trash: "M9 3h6l1 2h4v2H4V5h4l1-2Zm-3 6h12l-1 12H7L6 9Z",
    close: "M17.3 18.7a1 1 0 0 0 1.4-1.4L13.42 12l5.3-5.3a1 1 0 0 0-1.42-1.4L12 10.58l-5.3-5.3a1 1 0 0 0-1.4 1.42L10.58 12l-5.3 5.3a1 1 0 1 0 1.42 1.4L12 13.42l5.3 5.3Z",
    chevron: "M9.3 5.3a1 1 0 0 0 0 1.4l5.29 5.3-5.3 5.3a1 1 0 1 0 1.42 1.4l6-6a1 1 0 0 0 0-1.4l-6-6a1 1 0 0 0-1.42 0Z",
    copy: "M8 3h10a3 3 0 0 1 3 3v10h-2V6a1 1 0 0 0-1-1H8V3Zm-3 4h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2Z",
    plus: "M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6V5Z",
    warning: "M10.3 3.6a2 2 0 0 1 3.4 0l8 13.9A2 2 0 0 1 20 20.5H4a2 2 0 0 1-1.7-3L10.3 3.6ZM11 9v5h2V9h-2Zm0 7v2h2v-2h-2Z",
    embed: "M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm4 4v2h8V7H9Zm0 4v2h8v-2H9Zm0 4v2h5v-2H9ZM5 5v14h2V5H5Z",
    attach: "M16.5 6.5v9.75a4.25 4.25 0 0 1-8.5 0V5.5a2.75 2.75 0 0 1 5.5 0v10a1.25 1.25 0 0 1-2.5 0V6.5H9.5v9a2.75 2.75 0 0 0 5.5 0v-10a4.25 4.25 0 0 0-8.5 0v10.75a5.75 5.75 0 0 0 11.5 0V6.5h-1.5Z",
    link: "M10.6 13.4a1 1 0 0 1 0-1.4l3.6-3.6a3 3 0 1 1 4.2 4.2l-1.6 1.6-1.4-1.4 1.6-1.6a1 1 0 0 0-1.4-1.4l-3.6 3.6a1 1 0 0 1-1.4 0Zm2.8-2.8a1 1 0 0 1 0 1.4l-3.6 3.6a3 3 0 1 1-4.2-4.2l1.6-1.6 1.4 1.4-1.6 1.6a1 1 0 0 0 1.4 1.4l3.6-3.6a1 1 0 0 1 1.4 0Z",
    text: "M4 5h16v2H4V5Zm0 6h16v2H4v-2Zm0 6h10v2H4v-2Z",
    section: "M3 5h10v2H3V5Zm0 4h10v2H3V9Zm0 4h7v2H3v-2Zm12-8h6v6h-6V5Z",
    gallery: "M4 4h7v7H4V4Zm9 0h7v7h-7V4ZM4 13h7v7H4v-7Zm9 0h7v7h-7v-7Z",
    separator: "M3 11h18v2H3v-2ZM7 5h10v2H7V5Zm0 12h10v2H7v-2Z",
    file: "M6 2h8l6 6v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Zm0 2v16h12V9h-5V4H6Z",
    buttons: "M4 8a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V8Zm3-1a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V8a1 1 0 0 0-1-1H7Zm2 4h6v2H9v-2Z",
    container: "M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm4 2v14h10V5H9Z",
};

type IconName = keyof typeof ICON;

function Icon({ name, size = 16 }: { name: IconName; size?: number; }) {
    return <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" fillRule="evenodd" d={ICON[name]} /></svg>;
}

function IconButton({ label, icon, onClick, disabled, danger }: { label: string; icon: IconName; onClick(): void; disabled?: boolean; danger?: boolean; }) {
    return (
        <button type="button" className="evi-eb-icon" aria-label={label} title={label} disabled={disabled} data-danger={danger ? "" : undefined} onClick={onClick}>
            <Icon name={icon} />
        </button>
    );
}

/**
 * Discord's message markup class (markup__xxxx), where its headings, small text, lists and masked links
 * are styled. Its module exports it under a minified name, so it's found by its value.
 */
let markupCache: string | null | undefined;
function markupClass(): string {
    if (markupCache === undefined) {
        const mod = find((m: any) => m && typeof m === "object" && !Array.isArray(m) && Object.values(m).some(v => typeof v === "string" && /^markup_[\w-]+$/.test(v)));
        markupCache = mod ? (Object.values(mod).find(v => typeof v === "string" && /^markup_[\w-]+$/.test(v as string)) as string) : null;
    }
    return markupCache ?? "";
}

/** Discord's own markdown: its embed title rules for titles, its message rules for the rest */
function Markdown({ text, channelId, inline }: { text: string; channelId: string; inline?: boolean; }) {
    let nodes: ReactNode = text;
    try {
        const md = markdown();
        if (inline && typeof md?.parseEmbedTitle === "function") nodes = md.parseEmbedTitle(text, true, { channelId });
        else if (md?.parse) nodes = md.parse(text, true, { channelId, allowLinks: true, allowHeading: !inline, allowList: !inline, allowEmojiLinks: true });
    } catch { /* plain text */ }
    return inline ? <>{nodes}</> : <div className={`evi-eb-markup ${markupClass()}`}>{nodes}</div>;
}

/** What a picture link shows as: a web link as is, attachment://name as the picked file */
type Resolve = (url: string) => string | undefined;

const VIDEO = /\.(mp4|webm|mov|m4v)(\?|$)/i;

function Media({ url, resolve, className, alt }: { url: string; resolve: Resolve; className?: string; alt?: string; }) {
    const src = resolve(url);
    if (!src) return <div className={`${className ?? ""} evi-eb-media-missing`} aria-hidden="true"><Icon name="gallery" size={20} /></div>;
    return VIDEO.test(url) ? <video className={className} src={src} muted /> : <img className={className} src={src} alt={alt ?? ""} />;
}

function EmbedPreview({ e, channelId, resolve }: { e: Embed; channelId: string; resolve: Resolve; }) {
    const color = hexToInt(e.color);
    const fields = e.fields.filter(f => f.name.trim() || f.value.trim());
    const thumb = resolve(e.thumbnail);
    const image = resolve(e.image);
    const authorIcon = resolve(e.authorIcon);
    const footerIcon = resolve(e.footerIcon);
    const footerText = e.footerText.trim();
    const time = e.timestamp && !Number.isNaN(Date.parse(e.timestamp)) ? new Date(e.timestamp) : undefined;
    const columns = fieldColumns(fields.map(f => f.inline), thumb ? 2 : 3);
    return (
        <article className="evi-eb-embed" style={{ borderInlineStartColor: color === undefined ? undefined : `#${color.toString(16).padStart(6, "0")}` }}>
            <div className="evi-eb-embed-grid" data-thumb={thumb ? "" : undefined}>
                {e.authorName.trim() && (
                    <div className="evi-eb-embed-author">
                        {authorIcon && <img src={authorIcon} alt="" />}
                        {/^https?:/i.test(e.authorUrl.trim()) ? <a href={e.authorUrl.trim()} target="_blank" rel="noreferrer">{e.authorName}</a> : <span>{e.authorName}</span>}
                    </div>
                )}
                {e.title.trim() && (
                    <div className="evi-eb-embed-title" data-link={/^https?:/i.test(e.url.trim()) ? "" : undefined}>
                        <Markdown text={e.title} channelId={channelId} inline />
                    </div>
                )}
                {e.description.trim() && <div className="evi-eb-embed-description"><Markdown text={e.description} channelId={channelId} /></div>}
                {fields.length > 0 && (
                    <div className="evi-eb-embed-fields">
                        {fields.map((f, i) => (
                            <div key={i} className="evi-eb-embed-field" style={{ gridColumn: columns[i] }}>
                                <div className="evi-eb-embed-field-name"><Markdown text={f.name} channelId={channelId} inline /></div>
                                <div className="evi-eb-embed-field-value"><Markdown text={f.value} channelId={channelId} /></div>
                            </div>
                        ))}
                    </div>
                )}
                {image && <img className="evi-eb-embed-image" src={image} alt="" />}
                {thumb && <img className="evi-eb-embed-thumb" src={thumb} alt="" />}
                {(footerText || time) && (
                    <div className="evi-eb-embed-footer">
                        {footerIcon && footerText && <img src={footerIcon} alt="" />}
                        <span>
                            {footerText}
                            {footerText && time && <span className="evi-eb-dot">•</span>}
                            {time && time.toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" })}
                        </span>
                    </div>
                )}
            </div>
        </article>
    );
}

const fileSize = (bytes: number) => bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

function FileCard({ name, size }: { name: string; size?: number; }) {
    return (
        <div className="evi-eb-filecard">
            <span className="evi-eb-filecard-icon"><Icon name="file" size={28} /></span>
            <span className="evi-eb-filecard-text">
                <span className="evi-eb-filecard-name">{name || "file"}</span>
                {size !== undefined && <span className="evi-eb-filecard-size">{fileSize(size)}</span>}
            </span>
        </div>
    );
}

function LinkButtonPreview({ b }: { b: LinkButton; }) {
    return (
        <span className="evi-eb-pbutton">
            {b.emoji.trim() && <span className="evi-eb-pbutton-emoji">{b.emoji.trim()}</span>}
            {b.label.trim() && <span>{b.label}</span>}
            <Icon name="link" size={14} />
        </span>
    );
}

function GalleryPreview({ items, resolve }: { items: MediaItem[]; resolve: Resolve; }) {
    const shown = items.slice(0, LIMITS.galleryItems);
    const rows = galleryRows(shown.length);
    const cell = (m: MediaItem, i: number, extra?: string) => (
        <div key={i} className={`evi-eb-gcell ${extra ?? ""}`} data-spoiler={m.spoiler ? "" : undefined}>
            <Media url={m.url} resolve={resolve} alt={m.description} className="evi-eb-gmedia" />
            {m.spoiler && <span className="evi-eb-spoiler-tag">{t("preview.spoiler")}</span>}
        </div>
    );
    if (rows === "tall") {
        return (
            <div className="evi-eb-gallery evi-eb-gallery-tall">
                {cell(shown[0], 0, "evi-eb-gcell-big")}
                <div className="evi-eb-gallery-stack">{shown.slice(1).map((m, i) => cell(m, i + 1))}</div>
            </div>
        );
    }
    let at = 0;
    return (
        <div className="evi-eb-gallery">
            {rows.map((n, r) => {
                const row = shown.slice(at, at + n);
                const start = at;
                at += n;
                return <div key={r} className="evi-eb-gallery-row" data-count={n} data-single={shown.length === 1 ? "" : undefined}>{row.map((m, i) => cell(m, start + i))}</div>;
            })}
        </div>
    );
}

function ChildPreview({ c, channelId, resolve, sizes }: { c: Child; channelId: string; resolve: Resolve; sizes: Map<string, number>; }) {
    switch (c.kind) {
        case "text":
            return <div className="evi-eb-ptext"><Markdown text={c.content} channelId={channelId} /></div>;
        case "section":
            return (
                <div className="evi-eb-psection">
                    <div className="evi-eb-psection-texts">{c.texts.map((s, i) => <div key={i} className="evi-eb-ptext"><Markdown text={s} channelId={channelId} /></div>)}</div>
                    {c.accessory.kind === "thumbnail"
                        ? <div className="evi-eb-pthumb" data-spoiler={c.accessory.spoiler ? "" : undefined}><Media url={c.accessory.url} resolve={resolve} alt={c.accessory.description} className="evi-eb-gmedia" /></div>
                        : <LinkButtonPreview b={c.accessory} />}
                </div>
            );
        case "gallery":
            return <GalleryPreview items={c.items} resolve={resolve} />;
        case "separator":
            return <div className="evi-eb-psep" data-spacing={c.spacing} data-line={c.divider ? "" : undefined}><hr /></div>;
        case "file":
            return <FileCard name={c.name} size={sizes.get(c.name)} />;
        case "buttons":
            return <div className="evi-eb-prow">{c.buttons.map((b, i) => <LinkButtonPreview key={i} b={b} />)}</div>;
    }
}

/** Whether a block shows anything yet: a text not written or a picture without a link is left out of the preview */
function shows(b: Block): boolean {
    switch (b.kind) {
        case "text": return !!b.content.trim();
        case "section": return b.texts.some(x => x.trim());
        case "gallery": return b.items.some(m => m.url.trim());
        case "buttons": return b.buttons.some(x => x.label.trim() || x.emoji.trim());
        case "file": return !!b.name;
        case "separator": return true;
        case "container": return b.children.some(c => c.kind !== "separator" && shows(c));
    }
}

function V2Preview({ blocks, channelId, resolve, sizes }: { blocks: Block[]; channelId: string; resolve: Resolve; sizes: Map<string, number>; }) {
    return (
        <div className="evi-eb-v2">
            {blocks.map((b, i) => !shows(b) ? null : b.kind === "container"
                ? (
                    <div key={i} className="evi-eb-pcontainer" data-accent={hexToInt(b.color) !== undefined ? "" : undefined} data-spoiler={b.spoiler ? "" : undefined} style={{ ["--accent" as string]: hexToInt(b.color) !== undefined ? b.color : undefined }}>
                        {b.children.filter(shows).map((c, j) => <ChildPreview key={j} c={c} channelId={channelId} resolve={resolve} sizes={sizes} />)}
                        {b.spoiler && <span className="evi-eb-spoiler-tag">{t("preview.spoiler")}</span>}
                    </div>
                )
                : <ChildPreview key={i} c={b} channelId={channelId} resolve={resolve} sizes={sizes} />)}
        </div>
    );
}

function MessagePreview({ draft, webhook, channelId, resolve, files }: { draft: Draft; webhook?: Webhook; channelId: string; resolve: Resolve; files: File[]; }) {
    const name = draft.username.trim() || webhook?.name || WEBHOOK_NAME;
    const avatar = resolve(draft.avatarUrl)
        ?? (webhook?.avatar ? `https://cdn.discordapp.com/avatars/${webhook.id}/${webhook.avatar}.png?size=80` : "https://cdn.discordapp.com/embed/avatars/0.png");
    const now = new Date().toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
    const sizes = new Map(files.map(f => [f.name, f.size]));
    // Classic messages show their files below; V2 ones only where a component uses them
    const loose = draft.mode === "classic" ? files.filter(f => !draft.embeds.some(e => [e.image, e.thumbnail, e.authorIcon, e.footerIcon].some(u => attachmentName(u) === f.name))) : [];
    const filled = (e: Embed) => !!(embedLength(e) || e.image || e.thumbnail);
    const empty = draft.mode === "v2" ? !draft.components.some(b => b.kind !== "separator" && shows(b)) : !draft.content.trim() && !draft.embeds.some(filled) && !loose.length;
    return (
        <div className="evi-eb-message">
            <img className="evi-eb-avatar" src={avatar} alt="" />
            <div className="evi-eb-message-body">
                <div className="evi-eb-message-head">
                    <span className="evi-eb-username">{name}</span>
                    <span className="evi-eb-tag">{t("preview.app")}</span>
                    <span className="evi-eb-time">{t("preview.today", { time: now })}</span>
                </div>
                {empty && <div className="evi-eb-preview-empty">{t("preview.empty")}</div>}
                {draft.mode === "v2"
                    ? <V2Preview blocks={draft.components} channelId={channelId} resolve={resolve} sizes={sizes} />
                    : (
                        <>
                            {draft.content.trim() && <div className="evi-eb-content"><Markdown text={draft.content} channelId={channelId} /></div>}
                            {draft.embeds.map((e, i) => filled(e) && <EmbedPreview key={i} e={e} channelId={channelId} resolve={resolve} />)}
                            {loose.map(f => f.type.startsWith("image/")
                                ? <img key={f.name} className="evi-eb-loose-image" src={resolve(`attachment://${f.name}`)} alt="" />
                                : <FileCard key={f.name} name={f.name} size={f.size} />)}
                        </>
                    )}
            </div>
        </div>
    );
}

function problemText(p: Problem): string {
    switch (p.kind) {
        case "tooLong": return t("problem.tooLong", { where: whereText(p.where), length: p.length, limit: p.limit });
        case "tooMany":
            switch (p.where) {
                case "embeds": return t("problem.tooManyEmbeds", { limit: p.limit });
                case "fields": return t("problem.tooManyFields", { limit: p.limit });
                case "components": return t("problem.tooManyComponents", { limit: p.limit, count: p.count });
                case "attachments": return t("problem.tooManyFiles", { limit: p.limit });
            }
            break;
        case "badUrl": return t("problem.badUrl", { where: whereText(p.where) });
        case "badColor": return t("problem.badColor", { where: whereText(p.where) });
        case "badTimestamp": return t("problem.badTimestamp", { where: whereText(p.where) });
        case "emptyEmbed": return t("problem.emptyEmbed", { where: whereText(p.where) });
        case "fieldNeedsBoth": return t("problem.fieldNeedsBoth", { where: whereText(p.where) });
        case "emptyComponent": return t("problem.emptyComponent", { where: whereText(p.where) });
        case "buttonNeedsLabel": return t("problem.buttonNeedsLabel", { where: whereText(p.where) });
        case "noAttachment": return t("problem.noAttachment", { where: whereText(p.where), name: p.name });
        case "empty": return t("problem.empty");
    }
    return "";
}

/** "e2.f3.value" → "Embed 2, field 3, value"; "c2.c1.t1" → "Component 2, item 1, text 1" */
function whereText(where: string): string {
    if (where === "total") return t("where.total");
    if (where === "componentText") return t("where.componentText");
    const parts: string[] = [];
    where.split(".").forEach((part, i) => {
        const m = /^([a-z])(\d+)$/.exec(part);
        if (m) {
            const n = m[2];
            switch (m[1]) {
                case "e": return void parts.push(t("where.embed", { n }));
                case "f": return void parts.push(t("where.field", { n }));
                case "c": return void parts.push(i === 0 ? t("where.component", { n }) : t("where.child", { n }));
                case "t": return void parts.push(t("where.text", { n }));
                case "i": return void parts.push(t("where.item", { n }));
                case "b": return void parts.push(t("where.button", { n }));
            }
        }
        parts.push(t(`where.${part}` as any));
    });
    return parts.join(", ");
}

/** The card keys a problem sits in, so they open when it's clicked: "c2.c1.t1" → c2, c2.c1 */
const cardKeys = (where: string) => {
    const parts = where.split(".");
    const keys: string[] = [];
    for (let i = 0; i < parts.length; i++) {
        if (!/^[ec]\d+$/.test(parts[i])) break;
        keys.push(parts.slice(0, i + 1).join("."));
    }
    return keys;
};

function Counter({ length, limit }: { length: number; limit: number; }) {
    if (length < limit * 0.8) return null;
    return <span className="evi-eb-counter" data-over={length > limit ? "" : undefined}>{limit - length}</span>;
}

function TextInput({ label, value, onChange, limit, placeholder, multiline, invalid, rows, where, hint, children }: {
    label: string; value: string; onChange(v: string): void; limit?: number; placeholder?: string; multiline?: boolean; invalid?: boolean; rows?: number;
    where?: string; hint?: string; children?: ReactNode;
}) {
    const id = React.useId();
    const bad = invalid || (limit !== undefined && value.length > limit) ? true : undefined;
    return (
        <div className="evi-eb-input">
            <label htmlFor={id}>
                <span>{label}</span>
                {limit !== undefined && <Counter length={value.length} limit={limit} />}
            </label>
            <div className="evi-eb-input-row">
                {multiline
                    ? <textarea id={id} data-where={where} value={value} rows={rows ?? 3} placeholder={placeholder} aria-invalid={bad} onChange={e => onChange(e.currentTarget.value)} />
                    : <input id={id} data-where={where} type="text" value={value} placeholder={placeholder} aria-invalid={bad} onChange={e => onChange(e.currentTarget.value)} />}
                {children}
            </div>
            {hint && <span className="evi-eb-hint">{hint}</span>}
        </div>
    );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange(v: boolean): void; }) {
    return (
        <label className="evi-eb-toggle">
            <input type="checkbox" role="switch" checked={checked} onChange={e => onChange(e.currentTarget.checked)} />
            <span className="evi-eb-toggle-track" aria-hidden="true"><span /></span>
            <span>{label}</span>
        </label>
    );
}

function Segmented<V extends string | number>({ label, value, options, onChange, disabled, title }: {
    label: string; value: V; options: { value: V; label: string; }[]; onChange(v: V): void; disabled?: boolean; title?: string;
}) {
    return (
        <div className="evi-eb-segmented" role="radiogroup" aria-label={label} title={title} data-disabled={disabled ? "" : undefined}>
            {options.map(o => (
                <button key={String(o.value)} type="button" role="radio" aria-checked={o.value === value} disabled={disabled} onClick={() => onChange(o.value)}>{o.label}</button>
            ))}
        </div>
    );
}

/** Discord's role colour palette, then its brand */
const SWATCHES = ["#5865f2", "#1abc9c", "#2ecc71", "#3498db", "#9b59b6", "#e91e63", "#f1c40f", "#e67e22", "#e74c3c", "#95a5a6", "#607d8b", "#ffffff"];

function ColorInput({ label, value, onChange, invalid, where }: { label: string; value: string; onChange(v: string): void; invalid?: boolean; where?: string; }) {
    const picked = hexToInt(value) === undefined ? "#5865f2" : value;
    return (
        <div className="evi-eb-input">
            <label><span>{label}</span></label>
            <div className="evi-eb-colors">
                <button type="button" className="evi-eb-swatch-none" aria-pressed={!value} title={t("color.none")} aria-label={t("color.none")} onClick={() => onChange("")} />
                {SWATCHES.map(c => (
                    <button key={c} type="button" className="evi-eb-swatch-pick" style={{ background: c }} aria-pressed={value.toLowerCase() === c} aria-label={t("color.swatch", { hex: c.toUpperCase() })} title={c.toUpperCase()} onClick={() => onChange(c)} />
                ))}
                <span className="evi-eb-color-custom">
                    <input type="color" aria-label={t("color.custom")} title={t("color.custom")} value={picked} onChange={e => onChange(e.currentTarget.value)} />
                </span>
                <input type="text" className="evi-eb-hex" data-where={where} value={value} placeholder="#5865F2" aria-label={label} aria-invalid={invalid || undefined} onChange={e => onChange(e.currentTarget.value.trim())} />
            </div>
        </div>
    );
}

const toLocalInput = (iso: string) => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/** A collapsible card: icon, title, a summary line, its actions; the body when open */
function Card({ icon, title, summary, open, onToggle, actions, children, tone, invalid }: {
    icon: ReactNode; title: string; summary?: string; open: boolean; onToggle(): void; actions?: ReactNode; children?: ReactNode; tone?: "nested"; invalid?: boolean;
}) {
    return (
        <section className="evi-eb-card" data-open={open ? "" : undefined} data-tone={tone} data-invalid={invalid ? "" : undefined}>
            <header className="evi-eb-card-head">
                <button type="button" className="evi-eb-card-toggle" aria-expanded={open} onClick={onToggle}>
                    <span className="evi-eb-chevron"><Icon name="chevron" /></span>
                    <span className="evi-eb-card-icon">{icon}</span>
                    <span className="evi-eb-card-title">{title}</span>
                    {summary && <span className="evi-eb-card-summary">{summary}</span>}
                </button>
                <span className="evi-eb-card-actions">{actions}</span>
            </header>
            <div className="evi-eb-card-body-wrap" aria-hidden={!open}>
                <div className="evi-eb-card-body">{open && children}</div>
            </div>
        </section>
    );
}

/** Part of a card that stays folded until you need it: open from the start when it has something in it */
function Fold({ title, filled, forced, children }: { title: string; filled: boolean; forced?: boolean; children: ReactNode; }) {
    const [open, setOpen] = React.useState(filled);
    const shown = open || !!forced;
    return (
        <div className="evi-eb-fold" data-open={shown ? "" : undefined}>
            <button type="button" className="evi-eb-fold-toggle" aria-expanded={shown} onClick={() => setOpen(!shown)}>
                <span className="evi-eb-chevron"><Icon name="chevron" /></span>
                <span>{title}</span>
            </button>
            {shown && <div className="evi-eb-fold-body">{children}</div>}
        </div>
    );
}

/** Move, duplicate and remove, for anything in a list */
function ListActions({ index, count, onMove, onDuplicate, onRemove, canDuplicate = true, removeLabel }: {
    index: number; count: number; onMove(by: number): void; onDuplicate?(): void; onRemove(): void; canDuplicate?: boolean; removeLabel: string;
}) {
    return (
        <>
            <IconButton label={t("action.moveUp")} icon="up" disabled={index === 0} onClick={() => onMove(-1)} />
            <IconButton label={t("action.moveDown")} icon="down" disabled={index === count - 1} onClick={() => onMove(1)} />
            {onDuplicate && <IconButton label={t("action.duplicate")} icon="copy" disabled={!canDuplicate} onClick={onDuplicate} />}
            <IconButton label={removeLabel} icon="trash" danger onClick={onRemove} />
        </>
    );
}

const move = <T,>(list: T[], i: number, by: number): T[] => {
    const next = [...list];
    const [x] = next.splice(i, 1);
    next.splice(i + by, 0, x);
    return next;
};
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));

function FieldEditor({ field, index, count, where, onChange, onMove, onRemove }: {
    field: Field; index: number; count: number; where: string; onChange(f: Field): void; onMove(by: number): void; onRemove(): void;
}) {
    return (
        <div className="evi-eb-sub">
            <div className="evi-eb-sub-head">
                <span>{t("field.title", { n: index + 1 })}</span>
                <Toggle label={t("field.inline")} checked={field.inline} onChange={inline => onChange({ ...field, inline })} />
                <ListActions index={index} count={count} onMove={onMove} onRemove={onRemove} removeLabel={t("action.removeField")} />
            </div>
            <TextInput label={t("field.name")} where={`${where}.name`} value={field.name} limit={LIMITS.fieldName} onChange={name => onChange({ ...field, name })} />
            <TextInput label={t("field.value")} where={`${where}.value`} value={field.value} limit={LIMITS.fieldValue} multiline rows={2} onChange={value => onChange({ ...field, value })} />
        </div>
    );
}

function EmbedEditor({ embed, index, count, open, onToggle, onChange, onMove, onRemove, onDuplicate, bad, files }: {
    embed: Embed; index: number; count: number; open: boolean; onToggle(): void; onChange(e: Embed): void; onMove(by: number): void; onRemove(): void; onDuplicate(): void;
    bad: Set<string>; files: string[];
}) {
    const set = <K extends keyof Embed>(key: K) => (value: Embed[K]) => onChange({ ...embed, [key]: value });
    const p = `e${index + 1}`;
    const fields = embed.fields;
    const summary = plain(embed.title || embed.authorName || embed.description);
    /** A problem shown inside: its fold opens, so the problem list can take you there */
    const inside = (...prefixes: string[]) => [...bad].some(w => prefixes.some(x => w.startsWith(x)));
    const url = (key: "url" | "authorUrl" | "authorIcon" | "image" | "thumbnail" | "footerIcon", label: string, image = false) => (
        <TextInput label={label} where={`${p}.${key}`} value={embed[key]} placeholder="https://" invalid={bad.has(`${p}.${key}`)} onChange={set(key)}>
            {image && <FilePick files={files} onPick={name => set(key)(`attachment://${name}`)} />}
        </TextInput>
    );
    return (
        <Card
            icon={<span className="evi-eb-dotswatch" style={{ background: hexToInt(embed.color) === undefined ? undefined : embed.color }} />}
            title={t("embed.title", { n: index + 1 })}
            summary={summary}
            open={open}
            onToggle={onToggle}
            invalid={[...bad].some(w => w === p || w.startsWith(`${p}.`))}
            actions={(
                <>
                    <span className="evi-eb-counter-quiet" title={t("message.embedChars")}>{embedLength(embed)}</span>
                    <ListActions index={index} count={count} onMove={onMove} onDuplicate={onDuplicate} canDuplicate={count < LIMITS.embeds} onRemove={onRemove} removeLabel={t("action.removeEmbed")} />
                </>
            )}
        >
            <div className="evi-eb-pair">
                <TextInput label={t("embed.titleField")} where={`${p}.title`} value={embed.title} limit={LIMITS.title} onChange={set("title")} />
                {url("url", t("embed.url"))}
            </div>
            <TextInput label={t("embed.description")} where={`${p}.description`} value={embed.description} limit={LIMITS.description} multiline rows={4} onChange={set("description")} />
            <ColorInput label={t("embed.color")} where={`${p}.color`} value={embed.color} invalid={bad.has(`${p}.color`)} onChange={set("color")} />

            <div className="evi-eb-folds">
                <Fold title={t("group.fields", { count: fields.length, limit: LIMITS.fields })} filled={fields.length > 0} forced={inside(`${p}.f`)}>
                    {fields.map((f, i) => (
                        <FieldEditor
                            key={i}
                            field={f}
                            index={i}
                            count={fields.length}
                            where={`${p}.f${i + 1}`}
                            onChange={next => set("fields")(fields.map((x, j) => j === i ? next : x))}
                            onMove={by => set("fields")(move(fields, i, by))}
                            onRemove={() => set("fields")(fields.filter((_, j) => j !== i))}
                        />
                    ))}
                    <button type="button" className="evi-eb-add-small" disabled={fields.length >= LIMITS.fields} onClick={() => set("fields")([...fields, emptyField()])}><Icon name="plus" />{t("action.addField")}</button>
                </Fold>

                <Fold title={t("group.images")} filled={!!(embed.image || embed.thumbnail)} forced={inside(`${p}.image`, `${p}.thumbnail`)}>
                    <div className="evi-eb-pair">
                        {url("image", t("embed.image"), true)}
                        {url("thumbnail", t("embed.thumbnail"), true)}
                    </div>
                </Fold>

                <Fold title={t("group.author")} filled={!!(embed.authorName || embed.authorUrl || embed.authorIcon)} forced={inside(`${p}.author`)}>
                    <TextInput label={t("embed.authorName")} where={`${p}.authorName`} value={embed.authorName} limit={LIMITS.author} onChange={set("authorName")} />
                    <div className="evi-eb-pair">
                        {url("authorUrl", t("embed.authorUrl"))}
                        {url("authorIcon", t("embed.authorIcon"), true)}
                    </div>
                </Fold>

                <Fold title={t("group.footer")} filled={!!(embed.footerText || embed.footerIcon || embed.timestamp)} forced={inside(`${p}.footer`, `${p}.timestamp`)}>
                    <TextInput label={t("embed.footerText")} where={`${p}.footerText`} value={embed.footerText} limit={LIMITS.footer} onChange={set("footerText")} />
                    {url("footerIcon", t("embed.footerIcon"), true)}
                    <div className="evi-eb-input">
                        <label><span>{t("embed.timestamp")}</span></label>
                        <div className="evi-eb-input-row">
                            <input
                                type="datetime-local"
                                data-where={`${p}.timestamp`}
                                value={embed.timestamp ? toLocalInput(embed.timestamp) : ""}
                                onChange={e => {
                                    const v = e.currentTarget.value;
                                    set("timestamp")(v ? new Date(v).toISOString() : "");
                                }}
                            />
                            <button type="button" className="evi-eb-ghost" onClick={() => set("timestamp")(new Date().toISOString())}>{t("action.now")}</button>
                            {embed.timestamp && <button type="button" className="evi-eb-ghost" onClick={() => set("timestamp")("")}>{t("action.clear")}</button>}
                        </div>
                    </div>
                </Fold>
            </div>
        </Card>
    );
}

const KINDS: Kind[] = ["text", "section", "gallery", "buttons", "separator", "file", "container"];

/** A small picker that fills a link field with attachment://name */
function FilePick({ files, onPick }: { files: string[]; onPick(name: string): void; }) {
    if (!files.length) return null;
    return (
        <Dropdown
            className="evi-eb-filepick"
            label={t("comp.useFile")}
            value=""
            onChange={name => name && onPick(name)}
            options={[{ value: "", label: t("comp.useFile") }, ...files.map(f => ({ value: f, label: f }))]}
        />
    );
}

function MediaEditor({ item, where, files, bad, onChange, label }: { item: MediaItem; where: string; files: string[]; bad: Set<string>; onChange(m: MediaItem): void; label?: string; }) {
    return (
        <>
            <TextInput label={label ?? t("comp.mediaUrl")} where={`${where}.media`} value={item.url} placeholder="https://" invalid={bad.has(`${where}.media`)} onChange={url => onChange({ ...item, url })}>
                <FilePick files={files} onPick={name => onChange({ ...item, url: `attachment://${name}` })} />
            </TextInput>
            <TextInput label={t("comp.alt")} where={`${where}.alt`} value={item.description} limit={LIMITS.mediaDescription} onChange={description => onChange({ ...item, description })} />
            <Toggle label={t("comp.spoiler")} checked={item.spoiler} onChange={spoiler => onChange({ ...item, spoiler })} />
        </>
    );
}

function ButtonEditor({ b, where, bad, onChange }: { b: LinkButton; where: string; bad: Set<string>; onChange(b: LinkButton): void; }) {
    return (
        <>
            <div className="evi-eb-pair" data-ratio="emoji">
                <TextInput label={t("comp.emoji")} value={b.emoji} placeholder="🔗" onChange={emoji => onChange({ ...b, emoji: [...emoji].slice(0, 8).join("") })} />
                <TextInput label={t("comp.label")} where={`${where}.label`} value={b.label} limit={LIMITS.buttonLabel} invalid={bad.has(where)} onChange={label => onChange({ ...b, label })} />
            </div>
            <TextInput label={t("comp.link")} where={`${where}.link`} value={b.url} limit={LIMITS.buttonUrl} placeholder="https://" invalid={bad.has(`${where}.link`)} onChange={url => onChange({ ...b, url })} />
        </>
    );
}

/** A line of markdown as it reads: no heading or quote marks, no bold or spoiler markers, links as their text */
const plain = (text: string) => text.split("\n").map(l => l.trim()).find(Boolean)?.replace(/^(?:#{1,3}|-#|>{1,3}|[-*])\s+/, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/(\*\*|__|\*|_|~~|\|\||`)/g, "").slice(0, 60) ?? "";

function blockSummary(b: Block): string {
    switch (b.kind) {
        case "text": return plain(b.content);
        case "section": return plain(b.texts.find(s => s.trim()) ?? "");
        case "gallery": return t("summary.pictures", { count: b.items.length });
        case "separator": return `${b.divider ? t("summary.line") : t("summary.space")} · ${b.spacing === 2 ? t("comp.spacingLarge") : t("comp.spacingSmall")}`;
        case "file": return b.name;
        case "buttons": return b.buttons.map(x => `${x.emoji} ${x.label}`.trim()).filter(Boolean).join(", ").slice(0, 60);
        case "container": return t("summary.inside", { count: b.children.length });
    }
}

function ChildBody({ c, where, files, bad, onChange }: { c: Child; where: string; files: string[]; bad: Set<string>; onChange(c: Child): void; }) {
    switch (c.kind) {
        case "text":
            return <TextInput label={t("comp.content")} where={where} value={c.content} multiline rows={4} invalid={bad.has(where)} hint={t("comp.markdownHint")} onChange={content => onChange({ ...c, content })} />;
        case "section":
            return (
                <>
                    {c.texts.map((s, i) => (
                        <TextInput key={i} label={t("comp.sectionText", { n: i + 1 })} where={`${where}.t${i + 1}`} value={s} multiline rows={2} invalid={bad.has(where) && !s.trim()} onChange={v => onChange({ ...c, texts: c.texts.map((x, j) => j === i ? v : x) })}>
                            {c.texts.length > 1 && <IconButton label={t("comp.removeText")} icon="trash" danger onClick={() => onChange({ ...c, texts: c.texts.filter((_, j) => j !== i) })} />}
                        </TextInput>
                    ))}
                    {c.texts.length < LIMITS.sectionTexts && (
                        <button type="button" className="evi-eb-add-small" onClick={() => onChange({ ...c, texts: [...c.texts, ""] })}><Icon name="plus" />{t("comp.addText")}</button>
                    )}
                    <h4>{t("comp.accessory")}</h4>
                    <Segmented
                        label={t("comp.accessory")}
                        value={c.accessory.kind}
                        options={[{ value: "thumbnail", label: t("comp.accessoryThumbnail") }, { value: "button", label: t("comp.accessoryButton") }]}
                        onChange={kind => onChange({ ...c, accessory: kind === "thumbnail" ? { kind, ...emptyMedia() } : { kind, ...emptyButton() } })}
                    />
                    <div className="evi-eb-gap" />
                    {c.accessory.kind === "thumbnail"
                        ? <MediaEditor item={c.accessory} where={`${where}.accessory`} files={files} bad={bad} label={t("comp.thumbnailUrl")} onChange={m => onChange({ ...c, accessory: { kind: "thumbnail", ...m } })} />
                        : <ButtonEditor b={c.accessory} where={`${where}.accessory`} bad={bad} onChange={b => onChange({ ...c, accessory: { kind: "button", ...b } })} />}
                </>
            );
        case "gallery":
            return (
                <>
                    {c.items.map((m, i) => (
                        <div key={i} className="evi-eb-sub">
                            <div className="evi-eb-sub-head">
                                <span>{t("comp.item", { n: i + 1 })}</span>
                                <ListActions index={i} count={c.items.length} onMove={by => onChange({ ...c, items: move(c.items, i, by) })} onRemove={() => onChange({ ...c, items: c.items.filter((_, j) => j !== i) })} removeLabel={t("comp.removeItem")} />
                            </div>
                            <MediaEditor item={m} where={`${where}.i${i + 1}`} files={files} bad={bad} onChange={next => onChange({ ...c, items: c.items.map((x, j) => j === i ? next : x) })} />
                        </div>
                    ))}
                    <button type="button" className="evi-eb-add-small" disabled={c.items.length >= LIMITS.galleryItems} onClick={() => onChange({ ...c, items: [...c.items, emptyMedia()] })}>
                        <Icon name="plus" />{t("comp.addItem", { count: c.items.length, limit: LIMITS.galleryItems })}
                    </button>
                </>
            );
        case "separator":
            return (
                <div className="evi-eb-inline-controls">
                    <Toggle label={t("comp.divider")} checked={c.divider} onChange={divider => onChange({ ...c, divider })} />
                    <Segmented label={t("comp.spacing")} value={c.spacing} options={[{ value: 1, label: t("comp.spacingSmall") }, { value: 2, label: t("comp.spacingLarge") }]} onChange={spacing => onChange({ ...c, spacing })} />
                </div>
            );
        case "file":
            return (
                <>
                    {files.length
                        ? (
                            <div className="evi-eb-input">
                                <label><span>{t("comp.fileName")}</span></label>
                                <div className="evi-eb-dropdown" data-where={where}>
                                <Dropdown
                                    className={bad.has(where) ? "evi-eb-select-bad" : undefined}
                                    label={t("comp.fileName")}
                                    value={c.name}
                                    onChange={name => onChange({ ...c, name })}
                                    options={[
                                        { value: "", label: t("comp.filePick") },
                                        ...files.map(f => ({ value: f, label: f })),
                                        ...c.name && !files.includes(c.name) ? [{ value: c.name, label: c.name }] : [],
                                    ]}
                                />
                                </div>
                            </div>
                        )
                        : <p className="evi-eb-note">{t("comp.fileNone")}</p>}
                    <Toggle label={t("comp.spoiler")} checked={c.spoiler} onChange={spoiler => onChange({ ...c, spoiler })} />
                </>
            );
        case "buttons":
            return (
                <>
                    <p className="evi-eb-note">{t("comp.buttonsNote")}</p>
                    {c.buttons.map((b, i) => (
                        <div key={i} className="evi-eb-sub">
                            <div className="evi-eb-sub-head">
                                <span>{t("comp.button", { n: i + 1 })}</span>
                                <ListActions index={i} count={c.buttons.length} onMove={by => onChange({ ...c, buttons: move(c.buttons, i, by) })} onRemove={() => onChange({ ...c, buttons: c.buttons.filter((_, j) => j !== i) })} removeLabel={t("comp.removeButton")} />
                            </div>
                            <ButtonEditor b={b} where={`${where}.b${i + 1}`} bad={bad} onChange={next => onChange({ ...c, buttons: c.buttons.map((x, j) => j === i ? next : x) })} />
                        </div>
                    ))}
                    <button type="button" className="evi-eb-add-small" disabled={c.buttons.length >= LIMITS.rowButtons} onClick={() => onChange({ ...c, buttons: [...c.buttons, emptyButton()] })}>
                        <Icon name="plus" />{t("comp.addButton", { count: c.buttons.length, limit: LIMITS.rowButtons })}
                    </button>
                </>
            );
    }
}

/** Where a new component goes: one button, and the kinds to pick from once it's pressed */
function AddBar({ kinds, onAdd, disabled, label }: { kinds: Kind[]; onAdd(k: Kind): void; disabled?: boolean; label: string; }) {
    const [open, setOpen] = React.useState(false);
    if (!open) {
        return <button type="button" className="evi-eb-add" disabled={disabled} aria-expanded={false} onClick={() => setOpen(true)}><Icon name="plus" />{label}</button>;
    }
    return (
        <div className="evi-eb-addbar" role="group" aria-label={label}>
            <div className="evi-eb-addbar-head">
                <span className="evi-eb-addbar-label">{label}</span>
                <IconButton label={t("action.cancel")} icon="close" onClick={() => setOpen(false)} />
            </div>
            <div className="evi-eb-addbar-kinds">
                {kinds.map(k => (
                    <button key={k} type="button" className="evi-eb-kind" disabled={disabled} onClick={() => {
                        onAdd(k);
                        setOpen(false);
                    }}>
                        <Icon name={k} size={20} />
                        <span className="evi-eb-kind-text">
                            <span className="evi-eb-kind-name">{t(`kind.${k}`)}</span>
                            <span className="evi-eb-kind-hint">{t(`kindHint.${k}`)}</span>
                        </span>
                    </button>
                ))}
            </div>
        </div>
    );
}

interface Tree {
    openKeys: Set<string>;
    toggle(key: string): void;
    reveal(key: string): void;
    bad: Set<string>;
    files: string[];
    full: boolean;
}

function BlockEditor({ block, where, index, count, tree, onChange, onMove, onRemove, onDuplicate, nested }: {
    block: Block; where: string; index: number; count: number; tree: Tree; onChange(b: Block): void; onMove(by: number): void; onRemove(): void; onDuplicate(): void; nested?: boolean;
}) {
    const open = tree.openKeys.has(where);
    const invalid = [...tree.bad].some(w => w === where || w.startsWith(`${where}.`));
    return (
        <Card
            icon={block.kind === "container" && hexToInt(block.color) !== undefined ? <span className="evi-eb-dotswatch" style={{ background: block.color }} /> : <Icon name={block.kind} />}
            title={t(`kind.${block.kind}`)}
            summary={blockSummary(block)}
            open={open}
            onToggle={() => tree.toggle(where)}
            tone={nested ? "nested" : undefined}
            invalid={invalid}
            actions={<ListActions index={index} count={count} onMove={onMove} onDuplicate={onDuplicate} canDuplicate={!tree.full} onRemove={onRemove} removeLabel={t("comp.remove")} />}
        >
            {block.kind === "container"
                ? (
                    <>
                        <div className="evi-eb-pair" data-ratio="color">
                            <ColorInput label={t("comp.accent")} where={`${where}.color`} value={block.color} invalid={tree.bad.has(`${where}.color`)} onChange={color => onChange({ ...block, color })} />
                        </div>
                        <Toggle label={t("comp.spoiler")} checked={block.spoiler} onChange={spoiler => onChange({ ...block, spoiler })} />
                        <h4>{t("comp.inside")}</h4>
                        {block.children.length === 0 && <p className="evi-eb-note">{t("comp.emptyContainer")}</p>}
                        <div className="evi-eb-tree">
                            {block.children.map((c, j) => {
                                const key = `${where}.c${j + 1}`;
                                return (
                                    <BlockEditor
                                        key={j}
                                        nested
                                        block={c}
                                        where={key}
                                        index={j}
                                        count={block.children.length}
                                        tree={tree}
                                        onChange={next => onChange({ ...block, children: block.children.map((x, k) => k === j ? next as Child : x) })}
                                        onMove={by => onChange({ ...block, children: move(block.children, j, by) })}
                                        onRemove={() => onChange({ ...block, children: block.children.filter((_, k) => k !== j) })}
                                        onDuplicate={() => {
                                            const children = [...block.children];
                                            children.splice(j + 1, 0, clone(c));
                                            onChange({ ...block, children });
                                        }}
                                    />
                                );
                            })}
                        </div>
                        <AddBar
                            kinds={KINDS.filter(k => k !== "container")}
                            disabled={tree.full}
                            label={t("add.toContainer")}
                            onAdd={k => {
                                onChange({ ...block, children: [...block.children, emptyBlock(k) as Child] });
                                tree.reveal(`${where}.c${block.children.length + 1}`);
                            }}
                        />
                    </>
                )
                : <ChildBody c={block} where={where} files={tree.files} bad={tree.bad} onChange={onChange} />}
        </Card>
    );
}

function Attachments({ files, kept, onAdd, onRemove }: { files: File[]; kept: SentAttachment[]; onAdd(list: FileList): void; onRemove(i: number): void; }) {
    const input = React.useRef<HTMLInputElement>(null);
    return (
        <div className="evi-eb-files">
            {kept.length > 0 && (
                <ul className="evi-eb-filelist">
                    {kept.map(a => (
                        <li key={a.id} data-kept="">
                            <Icon name="attach" />
                            <span className="evi-eb-filelist-name">{a.filename}</span>
                            <span className="evi-eb-filelist-meta">{t("files.kept")}</span>
                            <IconButton label={t("files.copyRef")} icon="copy" onClick={() => void copy(`attachment://${a.filename}`, t("toast.refCopied"))} />
                        </li>
                    ))}
                </ul>
            )}
            {files.length > 0 && (
                <ul className="evi-eb-filelist">
                    {files.map((f, i) => (
                        <li key={f.name}>
                            <Icon name="attach" />
                            <span className="evi-eb-filelist-name">{f.name}</span>
                            <span className="evi-eb-filelist-meta">{fileSize(f.size)}</span>
                            <IconButton label={t("files.copyRef")} icon="copy" onClick={() => void copy(`attachment://${f.name}`, t("toast.refCopied"))} />
                            <IconButton label={t("files.remove")} icon="trash" danger onClick={() => onRemove(i)} />
                        </li>
                    ))}
                </ul>
            )}
            <div className="evi-eb-files-foot">
                <button type="button" className="evi-eb-add-small" disabled={files.length + kept.length >= LIMITS.attachments} onClick={() => input.current?.click()}>
                    <Icon name="plus" />{t("files.add")}
                </button>
                <span className="evi-eb-hint">{t("files.hint")}</span>
            </div>
            <input ref={input} type="file" multiple hidden onChange={e => {
                if (e.currentTarget.files?.length) onAdd(e.currentTarget.files);
                e.currentTarget.value = "";
            }} />
        </div>
    );
}

type Panel = "none" | "import" | "edit" | "drafts";

/** Cards open at the start: the first embed, or the first component and what's in it */
const FIRST_OPEN = ["e1", "c1", "c1.c1"];
/** Problems that only mean "not filled in yet" */
const UNFINISHED = new Set<Problem["kind"]>(["empty", "emptyEmbed", "emptyComponent", "fieldNeedsBoth", "buttonNeedsLabel"]);

interface Editing { messageId: string; attachments: SentAttachment[]; }

/** The classic editor always has an embed card to fill in */
const withEmbed = (d: Draft): Draft => ({ ...d, embeds: d.embeds.length ? d.embeds : [emptyEmbed()] });

function Builder({ channel, onClose }: { channel: any; onClose(): void; }) {
    const [draft, setDraftState] = React.useState<Draft>(() => loadOpen(channel.id) ?? emptyDraft());
    const [openKeys, setOpenKeys] = React.useState<Set<string>>(() => new Set(FIRST_OPEN));
    const [webhooks, setWebhooks] = React.useState<Webhook[] | undefined>();
    const [hookId, setHookId] = React.useState("");
    const [loadError, setLoadError] = React.useState<string>();
    const [busy, setBusy] = React.useState<string>();
    const [error, setError] = React.useState<string>();
    const [panel, setPanel] = React.useState<Panel>("none");
    const [importText, setImportText] = React.useState("");
    const [editLink, setEditLink] = React.useState("");
    const [editing, setEditing] = React.useState<Editing>();
    const [drafts, setDrafts] = React.useState<SavedDraft[]>(() => savedDrafts());
    const [showProblems, setShowProblems] = React.useState(false);
    const [files, setFiles] = React.useState<File[]>([]);
    const [tried, setTried] = React.useState(false);
    const editorRef = React.useRef<HTMLDivElement>(null);
    const focusWhere = React.useRef<string | undefined>(undefined);

    const threadId = THREAD_TYPES.has(channel.type) ? channel.id : undefined;
    const webhook = webhooks?.find(w => w.id === hookId);

    // Picked files as object URLs, for the preview
    const urls = React.useMemo(() => new Map(files.map(f => [f.name, URL.createObjectURL(f)])), [files]);
    React.useEffect(() => () => urls.forEach(u => URL.revokeObjectURL(u)), [urls]);
    const kept = editing?.attachments ?? [];
    const resolve: Resolve = url => {
        const name = attachmentName(url);
        if (name) return urls.get(name) ?? kept.find(a => a.filename === name)?.url;
        return /^https?:\/\//i.test(url.trim()) ? url.trim() : undefined;
    };
    const fileNames = [...kept.map(a => a.filename), ...files.map(f => f.name)];

    const setDraft = (next: Draft) => {
        setDraftState(next);
        setError(undefined);
    };

    // Kept while you work, so closing by accident loses nothing
    React.useEffect(() => {
        const timer = setTimeout(() => saveOpen(channel.id, draft), 400);
        return () => clearTimeout(timer);
    }, [draft]);

    React.useEffect(() => {
        let gone = false;
        listWebhooks(channel).then(list => {
            if (gone) return;
            setWebhooks(list);
            setHookId(list.find(w => w.name === WEBHOOK_NAME)?.id ?? list[0]?.id ?? "");
        }, err => !gone && setLoadError(errorText(err, t("error.loadWebhooks"))));
        return () => void (gone = true);
    }, [channel.id]);

    const found = problems(draft, fileNames);
    // Something not filled in yet isn't a mistake while you're still writing: those show once you press Send
    const shown = tried ? found : found.filter(p => !UNFINISHED.has(p.kind));
    const bad = new Set(shown.flatMap(p => "where" in p ? [p.where] : []));

    // After a problem opens its card: scroll to its input and focus it
    React.useEffect(() => {
        const where = focusWhere.current;
        if (!where) return;
        focusWhere.current = undefined;
        const el = editorRef.current?.querySelector<HTMLElement>(`[data-where="${CSS.escape(where)}"]`)
            ?? editorRef.current?.querySelector<HTMLElement>(`[data-where^="${CSS.escape(where)}."]`);
        el?.scrollIntoView({ block: "center", behavior: "smooth" });
        (el?.matches("input, textarea, button") ? el : el?.querySelector<HTMLElement>("button") ?? el)?.focus({ preventScroll: true });
    });

    const toggle = (key: string) => setOpenKeys(prev => {
        const next = new Set(prev);
        next.has(key) ? next.delete(key) : next.add(key);
        return next;
    });
    const reveal = (key: string) => setOpenKeys(prev => new Set([...prev, ...cardKeys(key), key]));

    function goTo(p: Problem) {
        if (!("where" in p)) return;
        setOpenKeys(prev => new Set([...prev, ...cardKeys(p.where)]));
        focusWhere.current = p.where;
        setShowProblems(false);
    }

    function setMode(mode: Mode) {
        if (mode === draft.mode || editing) return;
        if (mode === "v2" && !draft.components.length) {
            setDraft({ ...draft, mode, components: convertToV2(draft) });
            setOpenKeys(new Set(["c1", "c1.c1"]));
        } else setDraft({ ...draft, mode });
    }

    function addFiles(list: FileList) {
        const next = [...files];
        for (const f of Array.from(list)) {
            if (next.length + kept.length >= LIMITS.attachments) break;
            let name = safeFileName(f.name);
            const taken = new Set([...next.map(x => x.name), ...kept.map(a => a.filename)]);
            for (let n = 1; taken.has(name); n++) name = safeFileName(f.name).replace(/(\.[^.]*)?$/, `_${n}$1`);
            next.push(name === f.name ? f : new File([f], name, { type: f.type, lastModified: f.lastModified }));
        }
        setFiles(next);
    }

    /** The channel has no webhook yet: make "Evi Embeds" for this message and the next ones */
    async function makeWebhook() {
        try {
            const hook = await createWebhook(channel);
            setWebhooks([hook]);
            setHookId(hook.id);
            return hook;
        } catch (err) {
            throw new Error(errorText(err, t("error.createFailed")));
        }
    }

    async function send() {
        if (busy) return;
        setTried(true);
        if (found.length) {
            setShowProblems(true);
            return;
        }
        if (!webhook && webhooks?.length !== 0) {
            setError(t("error.pickWebhook"));
            return;
        }
        setBusy("send");
        setError(undefined);
        try {
            const hook = webhook ?? await makeWebhook();
            const { json } = requestBody(payload(draft, !!editing), files, kept);
            if (editing) {
                await callWebhook(webhookUrl(hook.id, hook.token, { messageId: editing.messageId, threadId, components: v2 }), "PATCH", json, files);
                context?.toast(t("toast.edited"), { type: "success" });
            } else {
                await callWebhook(webhookUrl(hook.id, hook.token, { wait: true, threadId, components: v2 }), "POST", json, files);
                context?.toast(t("toast.sent", { channel: channel.name ?? "" }), { type: "success" });
            }
            saveOpen(channel.id, undefined);
            onClose();
        } catch (err) {
            setError(errorText(err, t("error.sendFailed")));
        } finally {
            setBusy(undefined);
        }
    }

    React.useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                e.stopImmediatePropagation();
                void send();
                return;
            }
            if (e.key !== "Escape") return;
            e.preventDefault();
            e.stopImmediatePropagation();
            if (showProblems) setShowProblems(false);
            else if (panel !== "none") setPanel("none");
            else if (!busy) onClose();
        };
        window.addEventListener("keydown", onKey, true);
        return () => window.removeEventListener("keydown", onKey, true);
    });

    async function loadMessage() {
        const link = parseMessageLink(editLink);
        if (!link) {
            setError(t("error.badLink"));
            return;
        }
        if (!webhook) {
            setError(t("error.pickWebhook"));
            return;
        }
        setBusy("load");
        setError(undefined);
        try {
            const message = await callWebhook(webhookUrl(webhook.id, webhook.token, { messageId: link.messageId, threadId: link.channelId !== webhookChannelId(channel) ? link.channelId : threadId }), "GET");
            const attachments: SentAttachment[] = Array.isArray(message?.attachments)
                ? message.attachments.filter((a: any) => typeof a?.id === "string" && typeof a?.filename === "string").map((a: any) => ({ id: a.id, filename: a.filename, url: String(a.url ?? "") }))
                : [];
            const { skipped, ...loaded } = draftFromJson(JSON.stringify({ content: message?.content ?? "", embeds: message?.embeds ?? [], flags: message?.flags ?? 0, components: message?.components ?? [] }), attachments);
            setDraft(withEmbed({ ...loaded, username: "", avatarUrl: "" }));
            setOpenKeys(new Set(FIRST_OPEN));
            setEditing({ messageId: link.messageId, attachments });
            setFiles([]);
            setPanel("none");
            if (skipped) context?.toast(t("toast.skipped", { count: skipped }), { type: "message" });
        } catch (err) {
            setError(errorText(err, t("error.loadMessage")));
        } finally {
            setBusy(undefined);
        }
    }

    function importJson() {
        try {
            const { skipped, ...next } = draftFromJson(importText);
            setDraft(withEmbed(next));
            setOpenKeys(new Set(FIRST_OPEN));
            setPanel("none");
            setImportText("");
            if (skipped) context?.toast(t("toast.skipped", { count: skipped }), { type: "message" });
        } catch (err: any) {
            setError(t(err?.message === "not-json" ? "error.notJson" : "error.notMessage"));
        }
    }

    function saveDraft() {
        const next = [{ name: draftName(draft), savedAt: Date.now(), draft }, ...drafts].slice(0, MAX_DRAFTS);
        setDrafts(next);
        storeDrafts(next);
        context?.toast(t("toast.draftSaved"), { type: "success" });
    }

    function deleteDraft(i: number) {
        const next = drafts.filter((_, j) => j !== i);
        setDrafts(next);
        storeDrafts(next);
    }

    const v2 = draft.mode === "v2";
    const count = componentCount(draft.components);
    const tree: Tree = { openKeys, toggle, reveal, bad, files: fileNames, full: count >= LIMITS.components };
    const sendLabel = busy === "send" ? t("action.sending") : editing ? t("action.saveEdit") : t("action.send");
    const setBlock = (i: number, b: Block) => setDraft({ ...draft, components: draft.components.map((x, j) => j === i ? b : x) });

    const meters = v2
        ? [
            { label: t("meter.components"), value: count, limit: LIMITS.components },
            { label: t("meter.text"), value: componentTextLength(draft.components), limit: LIMITS.componentText },
        ]
        : [{ label: t("meter.embedText"), value: totalLength(draft), limit: LIMITS.total }];

    return (
        <div className="evi-eb-scrim evi-scrim" onMouseDown={e => e.target === e.currentTarget && !busy && onClose()}>
            <div className="evi-eb-modal evi-modal" role="dialog" aria-modal="true" aria-labelledby="evi-eb-title">
                <header className="evi-eb-head">
                    <div className="evi-eb-head-text">
                        <h2 id="evi-eb-title">{t("dialog.title")}</h2>
                        <p>{editing ? t("dialog.editing") : t("dialog.subtitle", { channel: channel.name ?? "" })}</p>
                    </div>
                    <Segmented
                        label={t("mode.label")}
                        value={draft.mode}
                        disabled={!!editing}
                        title={editing ? t("mode.locked") : undefined}
                        options={[{ value: "classic", label: t("mode.classic") }, { value: "v2", label: t("mode.v2") }]}
                        onChange={setMode}
                    />
                    <button type="button" className="evi-eb-close" aria-label={t("action.close")} onClick={onClose} disabled={!!busy}><Icon name="close" size={20} /></button>
                </header>

                <div className="evi-eb-columns">
                    <div className="evi-eb-editor" ref={editorRef}>
                        <section className="evi-eb-sender" aria-labelledby="evi-eb-sender">
                            <h3 className="evi-eb-group" id="evi-eb-sender">{t("section.sendAs")}</h3>
                            {!editing && (
                                <div className="evi-eb-pair">
                                    <TextInput label={t("message.username")} where="username" value={draft.username} placeholder={webhook?.name ?? WEBHOOK_NAME} limit={LIMITS.username} onChange={username => setDraft({ ...draft, username })} />
                                    <TextInput label={t("message.avatar")} where="avatarUrl" value={draft.avatarUrl} placeholder="https://" invalid={bad.has("avatarUrl")} onChange={avatarUrl => setDraft({ ...draft, avatarUrl })} />
                                </div>
                            )}
                            {webhooks === undefined && !loadError && <p className="evi-eb-note">{t("webhook.loading")}</p>}
                            {loadError && <p className="evi-eb-note" data-error="">{loadError}</p>}
                            {webhooks?.length === 0 && <p className="evi-eb-note">{t("webhook.auto")}</p>}
                            {webhooks && webhooks.length > 1 && (
                                <div className="evi-eb-input">
                                    <label htmlFor="evi-eb-webhook"><span>{t("webhook.label")}</span></label>
                                    <Dropdown
                                        id="evi-eb-webhook"
                                        label={t("webhook.label")}
                                        value={hookId}
                                        onChange={setHookId}
                                        options={webhooks.map(w => ({ value: w.id, label: w.name }))}
                                    />
                                </div>
                            )}
                        </section>

                        {v2
                            ? (
                                <>
                                    {draft.components.length === 0 && <div className="evi-eb-empty">{t("empty.v2")}</div>}
                                    <div className="evi-eb-tree">
                                        {draft.components.map((b, i) => (
                                            <BlockEditor
                                                key={i}
                                                block={b}
                                                where={`c${i + 1}`}
                                                index={i}
                                                count={draft.components.length}
                                                tree={tree}
                                                onChange={next => setBlock(i, next)}
                                                onMove={by => setDraft({ ...draft, components: move(draft.components, i, by) })}
                                                onRemove={() => setDraft({ ...draft, components: draft.components.filter((_, j) => j !== i) })}
                                                onDuplicate={() => {
                                                    const components = [...draft.components];
                                                    components.splice(i + 1, 0, clone(b));
                                                    setDraft({ ...draft, components });
                                                    reveal(`c${i + 2}`);
                                                }}
                                            />
                                        ))}
                                    </div>
                                    <AddBar
                                        kinds={KINDS}
                                        disabled={tree.full}
                                        label={t("add.component")}
                                        onAdd={k => {
                                            setDraft({ ...draft, components: [...draft.components, emptyBlock(k)] });
                                            reveal(`c${draft.components.length + 1}`);
                                        }}
                                    />
                                </>
                            )
                            : (
                                <>
                                    <TextInput label={t("message.content")} where="content" value={draft.content} limit={LIMITS.content} multiline rows={3} onChange={content => setDraft({ ...draft, content })} />
                                    <div className="evi-eb-tree">
                                        {draft.embeds.map((e, i) => (
                                            <EmbedEditor
                                                key={i}
                                                embed={e}
                                                index={i}
                                                count={draft.embeds.length}
                                                open={openKeys.has(`e${i + 1}`)}
                                                bad={bad}
                                                files={fileNames}
                                                onToggle={() => toggle(`e${i + 1}`)}
                                                onChange={next => setDraft({ ...draft, embeds: draft.embeds.map((x, j) => j === i ? next : x) })}
                                                onMove={by => setDraft({ ...draft, embeds: move(draft.embeds, i, by) })}
                                                onDuplicate={() => {
                                                    const embeds = [...draft.embeds];
                                                    embeds.splice(i + 1, 0, clone(e));
                                                    setDraft({ ...draft, embeds });
                                                    reveal(`e${i + 2}`);
                                                }}
                                                onRemove={() => setDraft({ ...draft, embeds: draft.embeds.filter((_, j) => j !== i) })}
                                            />
                                        ))}
                                    </div>
                                    <button
                                        type="button"
                                        className="evi-eb-add"
                                        disabled={draft.embeds.length >= LIMITS.embeds}
                                        onClick={() => {
                                            setDraft({ ...draft, embeds: [...draft.embeds, emptyEmbed()] });
                                            reveal(`e${draft.embeds.length + 1}`);
                                        }}
                                    >
                                        <Icon name="plus" />{t("action.addEmbed", { count: draft.embeds.length, limit: LIMITS.embeds })}
                                    </button>
                                </>
                            )}

                        <h3 className="evi-eb-group">{t("section.files")}</h3>
                        <Attachments files={files} kept={kept} onAdd={addFiles} onRemove={i => setFiles(files.filter((_, j) => j !== i))} />

                        <div className="evi-eb-meters">
                            {meters.map(m => (
                                <div key={m.label} className="evi-eb-meter" data-over={m.value > m.limit ? "" : undefined}>
                                    <span>{m.label}</span>
                                    <span className="evi-eb-meter-bar" aria-hidden="true"><span style={{ width: `${Math.min(100, m.value / m.limit * 100)}%` }} /></span>
                                    <span className="evi-eb-meter-value">{m.value}/{m.limit}</span>
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="evi-eb-preview" aria-label={t("preview.label")}>
                        <h3 className="evi-eb-group">{t("preview.label")}</h3>
                        <div className="evi-eb-preview-chat">
                            <MessagePreview draft={draft} webhook={webhook} channelId={channel.id} resolve={resolve} files={files} />
                        </div>
                    </div>
                </div>

                {panel !== "none" && (
                    <div className="evi-eb-panel">
                        {panel === "import" && (
                            <>
                                <TextInput label={t("import.label")} value={importText} multiline rows={6} placeholder={'{ "content": "", "embeds": [ … ] }'} onChange={setImportText} />
                                <div className="evi-eb-panel-actions">
                                    <button type="button" className="evi-eb-ghost" onClick={() => void copy(draftToJson(draft), t("toast.jsonCopied"))}>{t("action.copyJson")}</button>
                                    <span className="evi-eb-spacer" />
                                    <button type="button" className="evi-eb-button" data-variant="secondary" onClick={() => setPanel("none")}>{t("action.cancel")}</button>
                                    <button type="button" className="evi-eb-button" disabled={!importText.trim()} onClick={importJson}>{t("import.load")}</button>
                                </div>
                            </>
                        )}
                        {panel === "edit" && (
                            <>
                                <TextInput label={t("edit.label")} value={editLink} placeholder="https://discord.com/channels/…" hint={t("edit.hint")} onChange={setEditLink} />
                                <div className="evi-eb-panel-actions">
                                    <button type="button" className="evi-eb-button" data-variant="secondary" onClick={() => setPanel("none")}>{t("action.cancel")}</button>
                                    <button type="button" className="evi-eb-button" disabled={!editLink.trim() || !!busy} onClick={() => void loadMessage()}>{busy === "load" ? t("edit.loading") : t("edit.load")}</button>
                                </div>
                            </>
                        )}
                        {panel === "drafts" && (
                            <>
                                <div className="evi-eb-sub-head">
                                    <span>{t("drafts.title")}</span>
                                    <button type="button" className="evi-eb-button" data-variant="secondary" onClick={saveDraft}>{t("drafts.save")}</button>
                                </div>
                                {drafts.length === 0 && <p className="evi-eb-note">{t("drafts.none")}</p>}
                                <ul className="evi-eb-drafts">
                                    {drafts.map((d, i) => (
                                        <li key={`${d.savedAt}-${i}`}>
                                            <button type="button" className="evi-eb-draft" onClick={() => {
                                                if (editing) setEditing(undefined);
                                                setDraft(withEmbed(d.draft));
                                                setOpenKeys(new Set(FIRST_OPEN));
                                                setPanel("none");
                                            }}>
                                                <span className="evi-eb-draft-mode">{d.draft.mode === "v2" ? "V2" : t("mode.classic")}</span>
                                                <span className="evi-eb-draft-name">{d.name}</span>
                                                <span className="evi-eb-note">{new Date(d.savedAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}</span>
                                            </button>
                                            <IconButton label={t("drafts.delete")} icon="trash" danger onClick={() => deleteDraft(i)} />
                                        </li>
                                    ))}
                                </ul>
                            </>
                        )}
                    </div>
                )}

                {showProblems && shown.length > 0 && (
                    <ul className="evi-eb-problems" role="alert">
                        {shown.slice(0, 8).map((p, i) => (
                            <li key={i}>
                                <button type="button" disabled={!("where" in p)} onClick={() => goTo(p)}>
                                    <Icon name="warning" size={14} />
                                    <span>{problemText(p)}</span>
                                </button>
                            </li>
                        ))}
                        {shown.length > 8 && <li className="evi-eb-problems-more">{t("problem.more", { count: shown.length - 8 })}</li>}
                    </ul>
                )}
                {error && <p className="evi-eb-error" role="alert">{error}</p>}

                <footer className="evi-eb-foot">
                    <div className="evi-eb-foot-left">
                        <button type="button" className="evi-eb-ghost" aria-pressed={panel === "drafts"} onClick={() => setPanel(panel === "drafts" ? "none" : "drafts")}>{t("drafts.button")}</button>
                        <button type="button" className="evi-eb-ghost" aria-pressed={panel === "import"} onClick={() => setPanel(panel === "import" ? "none" : "import")}>{t("json.button")}</button>
                        {editing
                            ? <button type="button" className="evi-eb-ghost" onClick={() => setEditing(undefined)}>{t("edit.stop")}</button>
                            : <button type="button" className="evi-eb-ghost" aria-pressed={panel === "edit"} onClick={() => setPanel(panel === "edit" ? "none" : "edit")}>{t("edit.button")}</button>}
                        <button type="button" className="evi-eb-ghost" onClick={() => {
                            setDraft(emptyDraft(draft.mode));
                            setTried(false);
                            setEditing(undefined);
                            setFiles([]);
                            setOpenKeys(new Set(FIRST_OPEN));
                        }}>{t("action.clearAll")}</button>
                    </div>
                    {shown.length > 0 && (
                        <button type="button" className="evi-eb-problem-pill" aria-expanded={showProblems} onClick={() => setShowProblems(!showProblems)}>
                            <Icon name="warning" size={14} />
                            {shown.length === 1 ? t("problem.one") : t("problem.count", { count: shown.length })}
                        </button>
                    )}
                    <button type="button" className="evi-eb-button" data-variant="secondary" onClick={onClose} disabled={!!busy}>{t("action.cancel")}</button>
                    <button type="button" className="evi-eb-button" disabled={!!busy || (!webhook && webhooks?.length !== 0)} title={t("action.sendShortcut")} onClick={() => void send()}>{sendLabel}</button>
                </footer>
            </div>
        </div>
    );
}

let closeOpen: CloseLayer | undefined;
/** The builder's ~30 KB of CSS goes in the first time it opens, not at startup: a new stylesheet makes Discord restyle the whole app */
let styled = false;

function openBuilder(channel: any) {
    if (!styled && context) {
        context.addStyle(css);
        styled = true;
    }
    closeOpen?.({ instant: true });
    const close = openLayer(close => <Builder channel={channel} onClose={() => close()} />, {
        onClosed: () => void (closeOpen === close && (closeOpen = undefined)),
    });
    closeOpen = close;
}

const css = `
.evi-eb-scrim { position: fixed; inset: 0; z-index: 10000; display: grid; place-items: center; padding: 24px; background: var(--opacity-black-70, rgba(0,0,0,.7)); }
.evi-eb-modal { display: flex; flex-direction: column; width: min(1180px, 100%); height: min(840px, calc(100vh - 48px)); border-radius: 12px; overflow: hidden;
  background: var(--modal-background, var(--background-base-low, #313338)); color: var(--text-default, var(--text-normal, #dbdee1));
  border: 1px solid var(--border-subtle, rgba(255,255,255,.06)); box-shadow: var(--shadow-high, 0 8px 24px rgba(0,0,0,.4)); font-family: var(--font-primary); font-size: 14px; line-height: 1.286; }

/* Head */
.evi-eb-head { display: flex; align-items: center; gap: 16px; padding: 20px 20px 20px 24px; border-block-end: 1px solid var(--border-subtle, rgba(255,255,255,.06)); }
.evi-eb-head-text { flex: 1; min-width: 0; }
.evi-eb-head h2 { margin: 0; font-size: 20px; line-height: 24px; font-weight: 600; color: var(--text-strong, var(--header-primary, #f2f3f5)); }
.evi-eb-head p { margin: 2px 0 0; font-size: 14px; color: var(--text-muted, #949ba4); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.evi-eb-close { display: grid; place-items: center; width: 32px; height: 32px; border: 0; border-radius: 8px; background: none; color: var(--interactive-normal, #b5bac1); cursor: pointer; transition: background-color .15s ease-out, color .15s ease-out; }
.evi-eb-close:hover:not(:disabled) { background: var(--background-modifier-hover, rgba(255,255,255,.06)); color: var(--interactive-hover, #dbdee1); }

/* Segmented control, like Discord's tab bars in settings */
.evi-eb-segmented { display: inline-flex; flex: none; padding: 2px; gap: 2px; border-radius: 8px; background: var(--background-base-lowest, var(--background-tertiary, #1e1f22)); border: 1px solid var(--border-subtle, rgba(255,255,255,.06)); }
.evi-eb-segmented button { min-height: 28px; padding: 0 12px; border: 0; border-radius: 6px; background: none; font: inherit; font-size: 13px; font-weight: 500; color: var(--interactive-normal, #b5bac1); cursor: pointer; transition: background-color .15s ease-out, color .15s ease-out; }
.evi-eb-segmented button:hover:not(:disabled):not([aria-checked="true"]) { color: var(--interactive-hover, #dbdee1); background: var(--background-modifier-hover, rgba(255,255,255,.04)); }
.evi-eb-segmented button[aria-checked="true"] { background: var(--background-modifier-selected, rgba(255,255,255,.1)); color: var(--interactive-active, #fff); box-shadow: 0 1px 2px rgba(0,0,0,.2); }
.evi-eb-segmented[data-disabled] { opacity: .6; }
.evi-eb-segmented button:disabled { cursor: not-allowed; }

/* Columns */
.evi-eb-columns { display: grid; grid-template-columns: minmax(0, 1.05fr) minmax(0, 1fr); min-height: 0; flex: 1; }
.evi-eb-editor, .evi-eb-preview { min-height: 0; overflow-y: auto; scrollbar-width: none; overscroll-behavior: contain; }
.evi-eb-editor::-webkit-scrollbar, .evi-eb-preview::-webkit-scrollbar, .evi-eb-drafts::-webkit-scrollbar, .evi-eb-input textarea::-webkit-scrollbar { display: none; }
.evi-eb-editor { display: flex; flex-direction: column; gap: 16px; padding: 24px 24px 32px; }
.evi-eb-preview { padding: 24px 24px 32px; background: var(--background-base-lower, var(--background-primary, #313338)); border-inline-start: 1px solid var(--border-subtle, rgba(255,255,255,.06)); }
.evi-eb-preview-chat { padding: 8px 0; }
.evi-eb-group { margin: 8px 0 0; font-size: 12px; line-height: 16px; font-weight: 600; text-transform: uppercase; letter-spacing: .02em; color: var(--text-muted, #949ba4); }
.evi-eb-preview .evi-eb-group { margin: 0 0 12px; }
.evi-eb-sender { display: flex; flex-direction: column; gap: 12px; }
.evi-eb-sender .evi-eb-group { margin: 0; }
.evi-eb-spacer { flex: 1; }
.evi-eb-intro { margin: 8px 0 0; font-size: 13px; line-height: 18px; color: var(--text-muted, #949ba4); }
.evi-eb-empty { padding: 24px; border-radius: 8px; text-align: center; color: var(--text-muted, #949ba4); background: var(--background-mod-subtle, rgba(255,255,255,.02)); }
.evi-eb-tree { display: flex; flex-direction: column; gap: 12px; }
.evi-eb-tree:empty { display: none; }

/* Cards */
.evi-eb-card { border-radius: 8px; border: 1px solid var(--border-subtle, rgba(255,255,255,.06)); background: var(--background-base-lower, rgba(0,0,0,.12)); transition: border-color .15s ease-out; }
.evi-eb-card[data-tone="nested"] { background: var(--background-mod-subtle, rgba(255,255,255,.025)); }
.evi-eb-card[data-invalid] { border-color: color-mix(in srgb, var(--status-danger, #f23f43) 35%, transparent); }
.evi-eb-card-head { display: flex; align-items: center; gap: 2px; padding: 6px; }
.evi-eb-card-toggle { display: flex; align-items: center; gap: 10px; flex: 1; min-width: 0; min-height: 40px; padding: 0 10px; border: 0; border-radius: 6px; background: none; color: inherit; font: inherit; cursor: pointer; text-align: start; transition: background-color .15s ease-out; }
.evi-eb-card-toggle:hover { background: var(--background-modifier-hover, rgba(255,255,255,.04)); }
.evi-eb-chevron { display: grid; flex: none; color: var(--interactive-normal, #b5bac1); transition: rotate .2s cubic-bezier(.2,0,0,1); }
.evi-eb-card[data-open] > .evi-eb-card-head .evi-eb-chevron { rotate: 90deg; }
.evi-eb-card-icon { display: grid; place-items: center; flex: none; width: 20px; color: var(--interactive-normal, #b5bac1); }
.evi-eb-dotswatch { width: 12px; height: 12px; border-radius: 50%; background: var(--background-modifier-accent, #4e5058); box-shadow: inset 0 0 0 1px rgba(255,255,255,.12); }
.evi-eb-card-title { flex: none; font-size: 14px; font-weight: 600; color: var(--text-strong, #f2f3f5); }
.evi-eb-card-summary { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; color: var(--text-muted, #949ba4); }
.evi-eb-card-actions { display: flex; align-items: center; gap: 0; flex: none; opacity: .55; transition: opacity .15s ease-out; }
.evi-eb-card-head:hover .evi-eb-card-actions, .evi-eb-card-head:focus-within .evi-eb-card-actions { opacity: 1; }
.evi-eb-card-body-wrap { display: grid; grid-template-rows: 0fr; transition: grid-template-rows .2s cubic-bezier(.2,0,0,1); }
.evi-eb-card[data-open] > .evi-eb-card-body-wrap { grid-template-rows: 1fr; }
.evi-eb-card-body { min-height: 0; overflow: hidden; display: flex; flex-direction: column; gap: 16px; padding: 0 16px; }
.evi-eb-card[data-open] > .evi-eb-card-body-wrap > .evi-eb-card-body { padding: 4px 16px 16px; }
.evi-eb-card-body h4 { margin: 4px 0 -4px; font-size: 12px; line-height: 16px; font-weight: 600; text-transform: uppercase; letter-spacing: .02em; color: var(--text-muted, #949ba4); }
.evi-eb-card-body h4:first-child { margin-top: 4px; }

/* Rows inside cards */
.evi-eb-sub { display: flex; flex-direction: column; gap: 12px; padding: 8px 8px 16px 16px; border-radius: 8px; background: var(--background-modifier-hover, rgba(255,255,255,.03)); }
.evi-eb-sub-head { display: flex; align-items: center; gap: 8px; min-height: 28px; font-size: 13px; font-weight: 600; color: var(--text-strong, #f2f3f5); }
.evi-eb-sub-head > span:first-child { flex: 1; }
.evi-eb-inline-controls { display: flex; flex-wrap: wrap; align-items: center; gap: 16px; }
.evi-eb-gap { height: 0; }
.evi-eb-note { margin: 0; font-size: 13px; line-height: 18px; color: var(--text-muted, #949ba4); }
.evi-eb-note[data-error] { color: var(--text-feedback-critical, #f23f43); }

/* Inputs */
.evi-eb-input { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.evi-eb-input > label { display: flex; justify-content: space-between; gap: 8px; font-size: 12px; line-height: 16px; font-weight: 600; color: var(--text-muted, #b5bac1); }
.evi-eb-input-row { display: flex; align-items: flex-start; gap: 8px; min-width: 0; }
.evi-eb-input-row > :is(input, textarea, select, .dl-dropdown-host):first-child { flex: 1; min-width: 0; }
/* The dropdown host is display: contents, so its button is the row's flex item */
.evi-eb-input-row > .dl-dropdown-host:first-child > .dl-select { flex: 1; min-width: 0; width: auto; }
.evi-eb-dropdown .dl-select, .evi-eb-input-row .dl-select { min-height: 40px; font-size: 14px; }
.evi-eb-select-bad { border-color: var(--status-danger, #f23f43) !important; }
.evi-eb-input :is(input[type="text"], input[type="datetime-local"], textarea, select), .evi-eb-panel textarea, .evi-eb-hex {
  width: 100%; box-sizing: border-box; min-height: 40px; padding: 10px 12px; border-radius: 8px; font: inherit; font-size: 14px; line-height: 20px; color: var(--text-default, #dbdee1);
  border: 1px solid var(--input-border, var(--border-subtle, rgba(255,255,255,.08))); background: var(--input-background, var(--background-tertiary, #1e1f22));
  transition: border-color .15s ease-out; }
.evi-eb-input select { appearance: none; padding-inline-end: 32px; cursor: pointer;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24'%3E%3Cpath fill='%23b5bac1' d='M12 16.6l6.3-6.3a1 1 0 1 0-1.4-1.4L12 13.8 7.1 8.9a1 1 0 0 0-1.4 1.4l6.3 6.3Z'/%3E%3C/svg%3E");
  background-repeat: no-repeat; background-position: right 10px center; }
.evi-eb-input textarea { resize: vertical; min-height: 64px; scrollbar-width: none; }
.evi-eb-input :is(input, textarea, select):hover { border-color: var(--input-border-hover, rgba(255,255,255,.16)); }
.evi-eb-input :is(input, textarea, select):focus, .evi-eb-hex:focus { outline: none; border-color: var(--input-border-active, var(--brand-500, #5865f2)); }
.evi-eb-input [aria-invalid="true"], .evi-eb-hex[aria-invalid="true"] { border-color: var(--status-danger, #f23f43); }
.evi-eb-input ::placeholder, .evi-eb-hex::placeholder { color: var(--input-placeholder-text, var(--text-muted, #6d6f78)); }
.evi-eb-hint { font-size: 12px; line-height: 16px; color: var(--text-muted, #949ba4); }
.evi-eb-filepick { flex: none !important; width: auto !important; max-width: 40%; }
.evi-eb-pair { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }

/* Folds: the optional parts of an embed, one row each until opened */
.evi-eb-folds { display: flex; flex-direction: column; border-radius: 8px; border: 1px solid var(--border-subtle, rgba(255,255,255,.06)); }
.evi-eb-fold + .evi-eb-fold { border-block-start: 1px solid var(--border-subtle, rgba(255,255,255,.06)); }
.evi-eb-fold-toggle { display: flex; align-items: center; gap: 10px; width: 100%; min-height: 44px; padding: 0 12px; border: 0; border-radius: 8px; background: none;
  font: inherit; font-size: 14px; font-weight: 500; color: var(--text-default, #dbdee1); text-align: start; cursor: pointer; transition: background-color .15s ease-out; }
@media (hover: hover) { .evi-eb-fold-toggle:hover { background: var(--background-modifier-hover, rgba(255,255,255,.04)); } }
.evi-eb-fold[data-open] > .evi-eb-fold-toggle .evi-eb-chevron { rotate: 90deg; }
.evi-eb-fold-body { display: flex; flex-direction: column; gap: 16px; padding: 4px 16px 16px; animation: evi-eb-rise .2s cubic-bezier(.2,0,0,1); }
.evi-eb-pair[data-ratio="emoji"] { grid-template-columns: 96px 1fr; }
.evi-eb-pair[data-ratio="color"] { grid-template-columns: 1fr; }
.evi-eb-counter { font-weight: 500; color: var(--text-muted, #949ba4); font-variant-numeric: tabular-nums; }
.evi-eb-counter[data-over] { color: var(--text-feedback-critical, #f23f43); }
.evi-eb-counter-quiet { margin-inline-end: 4px; font-size: 12px; color: var(--text-muted, #949ba4); font-variant-numeric: tabular-nums; }

/* Colour picker */
.evi-eb-colors { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.evi-eb-swatch-pick, .evi-eb-swatch-none { width: 24px; height: 24px; padding: 0; border: 0; border-radius: 50%; cursor: pointer; box-shadow: inset 0 0 0 1px rgba(255,255,255,.12); transition: transform .15s ease-out, box-shadow .15s ease-out; }
.evi-eb-swatch-none { background: linear-gradient(135deg, transparent calc(50% - 1px), var(--status-danger, #f23f43) calc(50% - 1px) calc(50% + 1px), transparent calc(50% + 1px)), var(--background-base-lowest, #1e1f22); }
.evi-eb-swatch-pick:hover, .evi-eb-swatch-none:hover { transform: scale(1.1); }
.evi-eb-swatch-pick[aria-pressed="true"], .evi-eb-swatch-none[aria-pressed="true"] { box-shadow: 0 0 0 2px var(--background-base-lower, #2b2d31), 0 0 0 4px var(--text-strong, #f2f3f5); }
.evi-eb-color-custom { position: relative; width: 24px; height: 24px; border-radius: 50%; overflow: hidden; background: conic-gradient(#f23f43, #f0b232, #23a55a, #00a8fc, #5865f2, #eb459e, #f23f43); box-shadow: inset 0 0 0 1px rgba(255,255,255,.12); }
.evi-eb-color-custom input { position: absolute; inset: 0; width: 100%; height: 100%; opacity: 0; cursor: pointer; border: 0; padding: 0; }
.evi-eb-hex { width: 104px !important; min-height: 32px !important; padding: 4px 10px !important; margin-inline-start: 4px; font-family: var(--font-code, monospace) !important; font-size: 13px !important; text-transform: uppercase; }

/* Switch, like Discord's */
.evi-eb-toggle { display: inline-flex; align-items: center; gap: 8px; font-size: 14px; color: var(--text-default, #dbdee1); cursor: pointer; user-select: none; }
.evi-eb-toggle input { position: absolute; opacity: 0; width: 1px; height: 1px; }
.evi-eb-toggle-track { position: relative; flex: none; width: 36px; height: 20px; border-radius: 10px; background: var(--background-modifier-accent, #80848e); transition: background-color .15s ease-out; }
.evi-eb-toggle-track > span { position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; border-radius: 50%; background: #fff; transition: translate .15s cubic-bezier(.2,0,0,1); }
.evi-eb-toggle input:checked + .evi-eb-toggle-track { background: var(--brand-500, #5865f2); }
.evi-eb-toggle input:checked + .evi-eb-toggle-track > span { translate: 16px 0; }
.evi-eb-toggle input:focus-visible + .evi-eb-toggle-track { outline: 2px solid var(--focus-primary, #00a8fc); outline-offset: 2px; }

/* Buttons */
.evi-eb-icon { display: grid; place-items: center; flex: none; width: 28px; height: 28px; border: 0; border-radius: 6px; background: none; color: var(--interactive-normal, #b5bac1); cursor: pointer; transition: background-color .15s ease-out, color .15s ease-out; }
.evi-eb-input-row > .evi-eb-icon { height: 40px; }
.evi-eb-icon:hover:not(:disabled) { background: var(--background-modifier-hover, rgba(255,255,255,.06)); color: var(--interactive-hover, #dbdee1); }
.evi-eb-icon[data-danger]:hover:not(:disabled) { color: var(--text-feedback-critical, #f23f43); }
.evi-eb-icon:disabled { opacity: .3; cursor: default; }
.evi-eb-add, .evi-eb-add-small { display: inline-flex; align-items: center; justify-content: center; gap: 6px; border: 1px dashed var(--border-strong, rgba(255,255,255,.16)); border-radius: 8px; background: none;
  color: var(--text-default, #dbdee1); font: inherit; font-weight: 500; cursor: pointer; transition: background-color .15s ease-out, border-color .15s ease-out; }
.evi-eb-add { width: 100%; min-height: 44px; font-size: 14px; }
.evi-eb-add-small { align-self: flex-start; min-height: 32px; padding: 0 12px; font-size: 13px; }
.evi-eb-add:hover:not(:disabled), .evi-eb-add-small:hover:not(:disabled) { background: var(--background-modifier-hover, rgba(255,255,255,.04)); border-color: var(--interactive-normal, #b5bac1); }
.evi-eb-add:disabled, .evi-eb-add-small:disabled { opacity: .45; cursor: default; }
.evi-eb-ghost { min-height: 32px; padding: 0 10px; border: 0; border-radius: 6px; background: none; font: inherit; font-size: 13px; font-weight: 500; color: var(--interactive-normal, #b5bac1); cursor: pointer; transition: background-color .15s ease-out, color .15s ease-out; white-space: nowrap; }
.evi-eb-input-row > .evi-eb-ghost { min-height: 40px; }
.evi-eb-ghost:hover, .evi-eb-ghost[aria-pressed="true"] { background: var(--background-modifier-hover, rgba(255,255,255,.06)); color: var(--interactive-hover, #dbdee1); }
.evi-eb-button { min-width: 96px; height: 38px; padding: 0 16px; border: 0; border-radius: 8px; font: inherit; font-size: 14px; font-weight: 500; cursor: pointer; flex: none; white-space: nowrap;
  background: var(--button-filled-brand-background, var(--brand-500, #5865f2)); color: var(--white, #fff); transition: background-color .15s ease-out; }
.evi-eb-input-row > .evi-eb-button { height: 40px; }
.evi-eb-button:hover:not(:disabled) { background: var(--button-filled-brand-background-hover, var(--brand-560, #4752c4)); }
.evi-eb-button[data-variant="secondary"] { background: var(--button-secondary-background, rgba(255,255,255,.08)); color: var(--text-default, #dbdee1); }
.evi-eb-button[data-variant="secondary"]:hover:not(:disabled) { background: var(--button-secondary-background-hover, rgba(255,255,255,.12)); }
.evi-eb-button:disabled { opacity: .5; cursor: not-allowed; }

/* Adding components */
.evi-eb-addbar { display: flex; flex-direction: column; gap: 12px; padding: 12px; border-radius: 8px; border: 1px solid var(--border-subtle, rgba(255,255,255,.08)); animation: evi-eb-rise .2s cubic-bezier(.2,0,0,1); }
.evi-eb-addbar-head { display: flex; align-items: center; justify-content: space-between; padding-inline-start: 4px; }
.evi-eb-addbar-label { font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: .02em; color: var(--text-muted, #949ba4); }
.evi-eb-addbar-kinds { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 8px; }
.evi-eb-kind { display: flex; align-items: flex-start; gap: 12px; padding: 12px; border: 1px solid var(--border-subtle, rgba(255,255,255,.08)); border-radius: 8px; text-align: start;
  background: var(--background-base-lower, rgba(0,0,0,.12)); font: inherit; color: var(--text-default, #dbdee1); cursor: pointer; transition: background-color .15s ease-out, border-color .15s ease-out, transform .15s ease-out; }
.evi-eb-kind-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.evi-eb-kind-name { font-size: 14px; font-weight: 600; color: var(--text-strong, #f2f3f5); }
.evi-eb-kind-hint { font-size: 12px; line-height: 16px; color: var(--text-muted, #949ba4); }
.evi-eb-kind:hover:not(:disabled) { background: var(--background-modifier-hover, rgba(255,255,255,.06)); border-color: var(--interactive-normal, #b5bac1); }
.evi-eb-kind:active:not(:disabled) { transform: scale(.97); }
.evi-eb-kind:disabled { opacity: .45; cursor: default; }
.evi-eb-kind svg { flex: none; margin-top: 1px; color: var(--interactive-normal, #b5bac1); }

/* Files */
.evi-eb-files { display: flex; flex-direction: column; gap: 8px; }
.evi-eb-filelist { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
.evi-eb-filelist li { display: flex; align-items: center; gap: 8px; padding: 4px 4px 4px 10px; border-radius: 8px; background: var(--background-base-lower, rgba(0,0,0,.12)); color: var(--interactive-normal, #b5bac1); }
.evi-eb-filelist-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 14px; color: var(--text-default, #dbdee1); }
.evi-eb-filelist-meta { font-size: 12px; color: var(--text-muted, #949ba4); font-variant-numeric: tabular-nums; }
.evi-eb-files-foot { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }

/* Meters */
.evi-eb-meters { display: flex; flex-direction: column; gap: 6px; margin-top: 8px; padding-top: 12px; border-top: 1px solid var(--border-subtle, rgba(255,255,255,.06)); }
.evi-eb-meter { display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: 12px; font-size: 12px; color: var(--text-muted, #949ba4); }
.evi-eb-meter-bar { height: 4px; border-radius: 2px; background: var(--background-modifier-accent, rgba(255,255,255,.08)); overflow: hidden; }
.evi-eb-meter-bar > span { display: block; height: 100%; border-radius: 2px; background: var(--brand-500, #5865f2); transition: width .2s ease-out; }
.evi-eb-meter[data-over] .evi-eb-meter-bar > span { background: var(--status-danger, #f23f43); }
.evi-eb-meter-value { font-variant-numeric: tabular-nums; }
.evi-eb-meter[data-over] { color: var(--text-feedback-critical, #f23f43); }

/* Panels, problems, errors */
.evi-eb-panel { display: flex; flex-direction: column; gap: 12px; padding: 16px 24px; border-block-start: 1px solid var(--border-subtle, rgba(255,255,255,.06)); background: var(--background-base-lower, rgba(0,0,0,.08));
  animation: evi-eb-rise .2s cubic-bezier(.2,0,0,1); }
.evi-eb-panel-actions { display: flex; align-items: center; justify-content: flex-end; gap: 8px; }
.evi-eb-drafts { list-style: none; margin: 0; padding: 0; max-height: 200px; overflow-y: auto; scrollbar-width: none; }
.evi-eb-drafts li { display: flex; align-items: center; gap: 4px; }
.evi-eb-draft { display: flex; align-items: center; gap: 12px; flex: 1; min-width: 0; padding: 8px 10px; border: 0; border-radius: 6px; background: none; color: inherit; font: inherit; font-size: 14px; text-align: start; cursor: pointer; }
.evi-eb-draft:hover { background: var(--background-modifier-hover, rgba(255,255,255,.04)); }
.evi-eb-draft-mode { flex: none; padding: 0 6px; border-radius: 4px; font-size: 11px; font-weight: 600; line-height: 16px; color: var(--text-muted, #b5bac1); background: var(--background-modifier-accent, rgba(255,255,255,.08)); }
.evi-eb-draft-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.evi-eb-problems { list-style: none; margin: 0; padding: 8px 16px; display: flex; flex-direction: column; gap: 2px; border-block-start: 1px solid color-mix(in srgb, var(--status-danger, #f23f43) 30%, transparent);
  background: color-mix(in srgb, var(--status-danger, #f23f43) 8%, transparent); animation: evi-eb-rise .2s cubic-bezier(.2,0,0,1); }
.evi-eb-problems button { display: flex; align-items: center; gap: 8px; width: 100%; min-height: 28px; padding: 0 8px; border: 0; border-radius: 6px; background: none; font: inherit; font-size: 13px; text-align: start; color: var(--text-feedback-critical, #f23f43); cursor: pointer; }
.evi-eb-problems button:hover:not(:disabled) { background: color-mix(in srgb, var(--status-danger, #f23f43) 12%, transparent); }
.evi-eb-problems button:disabled { cursor: default; }
.evi-eb-problems-more { padding: 4px 8px; font-size: 13px; color: var(--text-muted, #949ba4); }
.evi-eb-error { margin: 0; padding: 10px 24px; font-size: 14px; color: var(--text-feedback-critical, #f23f43); background: color-mix(in srgb, var(--status-danger, #f23f43) 10%, transparent); }
@keyframes evi-eb-rise { from { opacity: 0; translate: 0 4px; } }

/* Footer */
.evi-eb-foot { display: flex; align-items: center; gap: 8px; padding: 16px 24px; border-block-start: 1px solid var(--border-subtle, rgba(255,255,255,.06)); }
.evi-eb-foot-left { display: flex; flex-wrap: wrap; gap: 4px; flex: 1; min-width: 0; margin-inline-start: -10px; }
.evi-eb-problem-pill { display: inline-flex; align-items: center; gap: 6px; height: 32px; padding: 0 12px; border: 0; border-radius: 16px; font: inherit; font-size: 13px; font-weight: 600; cursor: pointer;
  color: var(--text-feedback-critical, #f23f43); background: color-mix(in srgb, var(--status-danger, #f23f43) 14%, transparent); transition: background-color .15s ease-out; }
.evi-eb-problem-pill:hover, .evi-eb-problem-pill[aria-expanded="true"] { background: color-mix(in srgb, var(--status-danger, #f23f43) 22%, transparent); }

:is(.evi-eb-button, .evi-eb-ghost, .evi-eb-icon, .evi-eb-fold-toggle, .evi-eb-close, .evi-eb-card-toggle, .evi-eb-add, .evi-eb-add-small, .evi-eb-draft, .evi-eb-kind, .evi-eb-segmented button, .evi-eb-problem-pill, .evi-eb-swatch-pick, .evi-eb-swatch-none, .evi-eb-problems button):focus-visible {
  outline: 2px solid var(--focus-primary, #00a8fc); outline-offset: 2px; }

/* The preview, after Discord's own message, embed and V2 components */
.evi-eb-message { display: flex; gap: 16px; padding: 2px 0; }
.evi-eb-avatar { flex: none; width: 40px; height: 40px; border-radius: 50%; }
.evi-eb-message-body { min-width: 0; flex: 1; }
.evi-eb-message-head { display: flex; align-items: center; gap: 4px; line-height: 22px; }
.evi-eb-username { font-size: 16px; font-weight: 500; color: var(--header-primary, var(--text-strong, #f2f3f5)); }
.evi-eb-tag { display: inline-flex; align-items: center; height: 15px; padding: 0 4px; border-radius: 3px; font-size: 10px; font-weight: 600; color: var(--white, #fff); background: var(--brand-500, #5865f2); }
.evi-eb-time { margin-inline-start: 4px; font-size: 12px; color: var(--text-muted, #949ba4); }
.evi-eb-preview-empty { margin-top: 2px; font-size: 15px; font-style: italic; color: var(--text-muted, #949ba4); }
.evi-eb-content, .evi-eb-ptext { font-size: 16px; line-height: 1.375; white-space: pre-wrap; overflow-wrap: anywhere; color: var(--text-default, #dbdee1); }
.evi-eb-markup { white-space: pre-wrap; }
.evi-eb-markup h1 { font-size: 1.5rem; font-weight: 700; margin: 8px 0 4px; }
.evi-eb-markup h2 { font-size: 1.25rem; font-weight: 700; margin: 8px 0 4px; }
.evi-eb-markup h3 { font-size: 1rem; font-weight: 700; margin: 8px 0 4px; }
.evi-eb-markup small { display: block; font-size: 0.8125rem; color: var(--text-muted, #949ba4); }
.evi-eb-markup ul, .evi-eb-markup ol { margin: 4px 0 0 16px; padding: 0; list-style-position: outside; }
.evi-eb-markup ul { list-style-type: disc; }
.evi-eb-markup a { color: var(--text-link, #00a8fc); }
.evi-eb-content { margin-top: 2px; }
.evi-eb-embed { box-sizing: border-box; max-width: 516px; margin-top: 4px; border-radius: 4px; border-inline-start: 4px solid var(--background-modifier-accent, #1e1f22);
  background: var(--background-mod-subtle, var(--background-secondary, #2b2d31)); }
.evi-eb-embed-grid { display: grid; grid-template-columns: minmax(0, 1fr) auto; padding: 8px 16px 16px 12px; }
.evi-eb-embed-grid > * { grid-column: 1; min-width: 0; margin-top: 8px; }
.evi-eb-embed-author { display: flex; align-items: center; gap: 8px; font-size: 14px; font-weight: 600; color: var(--header-primary, #f2f3f5); }
.evi-eb-embed-author img { width: 24px; height: 24px; border-radius: 50%; object-fit: cover; }
.evi-eb-embed-author a { color: inherit; }
.evi-eb-embed-title { font-size: 16px; font-weight: 600; color: var(--header-primary, #f2f3f5); }
.evi-eb-embed-title[data-link] { color: var(--text-link, #00a8fc); }
.evi-eb-embed-description, .evi-eb-embed-field-value { font-size: 14px; line-height: 18px; white-space: pre-wrap; overflow-wrap: anywhere; color: var(--text-default, #dbdee1); }
.evi-eb-embed-fields { display: grid; grid-template-columns: repeat(12, minmax(0, 1fr)); gap: 8px; }
.evi-eb-embed-field { min-width: 0; }
.evi-eb-embed-field-name { margin-bottom: 2px; font-size: 14px; font-weight: 600; color: var(--header-primary, #f2f3f5); }
.evi-eb-embed-image { grid-column: 1 / -1 !important; max-width: 100%; max-height: 300px; border-radius: 4px; object-fit: contain; justify-self: start; }
.evi-eb-embed-thumb { grid-column: 2 !important; grid-row: 1 / 8; width: 80px; height: 80px; margin-inline-start: 16px; border-radius: 4px; object-fit: contain; justify-self: end; }
.evi-eb-embed-footer { display: flex; align-items: center; gap: 8px; grid-column: 1 / -1 !important; font-size: 12px; font-weight: 500; color: var(--text-muted, #949ba4); }
.evi-eb-embed-footer img { width: 20px; height: 20px; border-radius: 50%; object-fit: cover; }
.evi-eb-dot { margin: 0 4px; }
.evi-eb-loose-image { display: block; max-width: min(400px, 100%); max-height: 300px; margin-top: 8px; border-radius: 8px; }

.evi-eb-v2 { display: flex; flex-direction: column; gap: 8px; max-width: 600px; margin-top: 4px; }
.evi-eb-pcontainer { position: relative; display: flex; flex-direction: column; gap: 8px; padding: 16px; border-radius: 8px; border: 1px solid var(--border-subtle, rgba(255,255,255,.06));
  background: var(--background-mod-subtle, var(--background-secondary, #2b2d31)); overflow: hidden; }
.evi-eb-pcontainer[data-accent] { border-inline-start: 4px solid var(--accent); padding-inline-start: 13px; }
.evi-eb-pcontainer[data-spoiler] > :not(.evi-eb-spoiler-tag) { filter: blur(24px); opacity: .7; pointer-events: none; }
.evi-eb-psection { display: flex; align-items: flex-start; gap: 12px; }
.evi-eb-psection-texts { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 8px; }
.evi-eb-pthumb { flex: none; width: 85px; height: 85px; border-radius: 8px; overflow: hidden; }
.evi-eb-pthumb[data-spoiler] .evi-eb-gmedia { filter: blur(16px); }
.evi-eb-gallery { display: flex; flex-direction: column; gap: 4px; border-radius: 8px; overflow: hidden; max-width: 550px; }
.evi-eb-gallery-row { display: grid; gap: 4px; grid-auto-flow: column; grid-auto-columns: minmax(0, 1fr); height: 180px; }
.evi-eb-gallery-row[data-count="3"] { height: 140px; }
.evi-eb-gallery-row[data-single] { height: auto; max-height: 350px; }
.evi-eb-gallery-tall { display: grid; grid-template-columns: 2fr 1fr; gap: 4px; height: 300px; }
.evi-eb-gallery-stack { display: grid; grid-template-rows: 1fr 1fr; gap: 4px; min-height: 0; }
.evi-eb-gcell { position: relative; min-width: 0; min-height: 0; overflow: hidden; background: var(--background-base-lowest, #1e1f22); }
.evi-eb-gcell[data-spoiler] .evi-eb-gmedia { filter: blur(24px); }
.evi-eb-gmedia { display: block; width: 100%; height: 100%; object-fit: cover; }
.evi-eb-gallery-row[data-single] .evi-eb-gmedia { height: auto; max-height: 350px; object-fit: contain; }
.evi-eb-media-missing { display: grid; place-items: center; width: 100%; height: 100%; min-height: 64px; color: var(--text-muted, #6d6f78); background: var(--background-base-lowest, #1e1f22); }
.evi-eb-spoiler-tag { position: absolute; top: 50%; left: 50%; translate: -50% -50%; padding: 4px 10px; border-radius: 16px; font-size: 12px; font-weight: 700; letter-spacing: .02em; text-transform: uppercase; color: #fff; background: rgba(0,0,0,.6); }
.evi-eb-psep { padding-block: 4px; }
.evi-eb-psep[data-spacing="2"] { padding-block: 12px; }
.evi-eb-psep hr { margin: 0; border: 0; height: 1px; background: transparent; }
.evi-eb-psep[data-line] hr { background: var(--border-subtle, rgba(255,255,255,.12)); }
.evi-eb-prow { display: flex; flex-wrap: wrap; gap: 8px; }
.evi-eb-pbutton { display: inline-flex; align-items: center; gap: 6px; flex: none; height: 32px; padding: 0 12px; border-radius: 8px; font-size: 14px; font-weight: 500;
  color: var(--text-default, #dbdee1); background: var(--button-secondary-background, rgba(255,255,255,.08)); }
.evi-eb-pbutton svg { opacity: .8; }
.evi-eb-pbutton-emoji { font-size: 16px; line-height: 1; }
.evi-eb-filecard { display: flex; align-items: center; gap: 12px; max-width: 432px; padding: 12px 16px; border-radius: 8px; border: 1px solid var(--border-subtle, rgba(255,255,255,.06)); background: var(--background-base-lower, rgba(0,0,0,.15)); }
.evi-eb-filecard-icon { color: var(--text-link, #00a8fc); display: grid; }
.evi-eb-filecard-text { display: flex; flex-direction: column; min-width: 0; }
.evi-eb-filecard-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 15px; color: var(--text-link, #00a8fc); }
.evi-eb-filecard-size { font-size: 12px; color: var(--text-muted, #949ba4); }

@media (max-width: 860px) {
  .evi-eb-modal { height: calc(100vh - 48px); }
  /* One column that scrolls as a whole: the editor, then the preview under it */
  .evi-eb-columns { display: block; overflow-y: auto; scrollbar-width: none; overscroll-behavior: contain; }
  .evi-eb-columns::-webkit-scrollbar { display: none; }
  .evi-eb-editor, .evi-eb-preview { overflow: visible; min-height: auto; }
  .evi-eb-editor { padding: 16px; }
  .evi-eb-addbar-kinds { grid-template-columns: 1fr; }
  .evi-eb-preview { padding: 16px; }
  .evi-eb-preview { border-inline-start: 0; border-block-start: 1px solid var(--border-subtle, rgba(255,255,255,.06)); }
  .evi-eb-pair { grid-template-columns: 1fr; }
  .evi-eb-head { flex-wrap: wrap; }
}
@media (prefers-reduced-motion: reduce) {
  .evi-eb-chevron, .evi-eb-button, .evi-eb-add, .evi-eb-card-body-wrap, .evi-eb-toggle-track > span, .evi-eb-meter-bar > span { transition: none; }
  .evi-eb-panel, .evi-eb-problems, .evi-eb-fold-body, .evi-eb-addbar { animation: none; }
}
`;

export default definePlugin({
    start(ctx) {
        context = ctx;
        ctx.onDispose(() => {
            closeOpen?.({ instant: true });
            context = undefined;
            styled = false;
        });

        ctx.contextMenu(["channel-context", "thread-context"], (children, props) => {
            const channel = props?.channel;
            if (!canUse(channel)) return;
            children.push(
                <Menu.Group key="evi-embed-builder">
                    <Menu.Item id="evi-embed-builder" label={t("menu.open")} action={() => openBuilder(channel)} />
                </Menu.Group>,
            );
        });

        ctx.command({
            name: "embed",
            get description() { return t("command.description"); },
            predicate: ({ channel }) => canUse(channel),
            execute: (_args, { channel }) => void openBuilder(channel),
        });
    },
});
