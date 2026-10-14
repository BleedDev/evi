/**
 * Embed Builder's message: what the editor holds, Discord's limits on it, and the JSON a webhook
 * takes. Pure, so the tests can check it without Discord.
 *
 * A message is one of two kinds, as in Discord:
 * - Classic: content plus up to 10 embeds.
 * - Components V2 (message flag IS_COMPONENTS_V2): no content or embeds, the whole message is
 *   layout components. A webhook nobody's app owns may send the non-interactive ones (text,
 *   sections, thumbnails, galleries, files, separators, containers and link buttons), and only
 *   with ?with_components=true. Once a message is V2 it stays V2.
 *
 * Imports read the plain webhook body ({ content, embeds, username, avatar_url } or
 * { flags, components }), Discohook's share format ({ messages: [{ data }] }), a bare list of
 * embeds, or one embed. Exports are the plain webhook body, which Discohook and most bots read too.
 */

export interface Field { name: string; value: string; inline: boolean; }

export interface Embed {
    authorName: string;
    authorUrl: string;
    authorIcon: string;
    title: string;
    url: string;
    description: string;
    /** "#rrggbb", or "" for Discord's default */
    color: string;
    fields: Field[];
    image: string;
    thumbnail: string;
    footerText: string;
    footerIcon: string;
    /** ISO date, or "" for none */
    timestamp: string;
}

export interface MediaItem { url: string; description: string; spoiler: boolean; }
export interface LinkButton { label: string; url: string; /** A unicode emoji, or "" */ emoji: string; }

export type Accessory = ({ kind: "thumbnail"; } & MediaItem) | ({ kind: "button"; } & LinkButton);

export type Child =
    | { kind: "text"; content: string; }
    | { kind: "section"; texts: string[]; accessory: Accessory; }
    | { kind: "gallery"; items: MediaItem[]; }
    | { kind: "separator"; divider: boolean; spacing: 1 | 2; }
    | { kind: "file"; name: string; spoiler: boolean; }
    | { kind: "buttons"; buttons: LinkButton[]; };

export type Block = Child | { kind: "container"; color: string; spoiler: boolean; children: Child[]; };

export type Kind = Block["kind"];

export type Mode = "classic" | "v2";

export interface Draft {
    mode: Mode;
    content: string;
    username: string;
    avatarUrl: string;
    embeds: Embed[];
    /** The V2 message, used when mode is "v2" */
    components: Block[];
}

/** Discord's own limits (developer docs: "Embed Limits", "Execute Webhook", "Component Reference") */
export const LIMITS = {
    content: 2000,
    username: 80,
    embeds: 10,
    title: 256,
    description: 4096,
    fields: 25,
    fieldName: 256,
    fieldValue: 1024,
    footer: 2048,
    author: 256,
    total: 6000,
    /** Every component counts, nested ones too */
    components: 40,
    /** All the text in a V2 message's text displays together */
    componentText: 4000,
    sectionTexts: 3,
    galleryItems: 10,
    rowButtons: 5,
    buttonLabel: 80,
    buttonUrl: 512,
    mediaDescription: 1024,
    attachments: 10,
} as const;

export const IS_COMPONENTS_V2 = 1 << 15;

export const COMPONENT_TYPE = { buttons: 1, button: 2, section: 9, text: 10, thumbnail: 11, gallery: 12, file: 13, separator: 14, container: 17 } as const;

export const emptyField = (): Field => ({ name: "", value: "", inline: false });

export const emptyEmbed = (): Embed => ({
    authorName: "", authorUrl: "", authorIcon: "",
    title: "", url: "", description: "", color: "",
    fields: [], image: "", thumbnail: "",
    footerText: "", footerIcon: "", timestamp: "",
});

export const emptyMedia = (): MediaItem => ({ url: "", description: "", spoiler: false });
export const emptyButton = (): LinkButton => ({ label: "", url: "", emoji: "" });

/** A new component of a kind, as the editor adds it */
export function emptyBlock(kind: Kind): Block {
    switch (kind) {
        case "text": return { kind, content: "" };
        case "section": return { kind, texts: [""], accessory: { kind: "thumbnail", ...emptyMedia() } };
        case "gallery": return { kind, items: [emptyMedia()] };
        case "separator": return { kind, divider: true, spacing: 1 };
        case "file": return { kind, name: "", spoiler: false };
        case "buttons": return { kind, buttons: [emptyButton()] };
        case "container": return { kind, color: "", spoiler: false, children: [{ kind: "text", content: "" }] };
    }
}

export const emptyDraft = (mode: Mode = "classic"): Draft => ({
    mode,
    content: "",
    username: "",
    avatarUrl: "",
    embeds: [emptyEmbed()],
    components: mode === "v2" ? [emptyBlock("container")] : [],
});

export function hexToInt(hex: string): number | undefined {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
    return m ? parseInt(m[1], 16) : undefined;
}

export const intToHex = (n: number) => `#${(n & 0xffffff).toString(16).padStart(6, "0")}`;

/** What counts toward the 6000 characters an embed may hold */
export const embedLength = (e: Embed) =>
    e.title.length + e.description.length + e.authorName.length + e.footerText.length
    + e.fields.reduce((n, f) => n + f.name.length + f.value.length, 0);

export const totalLength = (d: Draft) => d.embeds.reduce((n, e) => n + embedLength(e), 0);

/** How many components a V2 message is: every component, nested ones too (gallery items aren't components) */
export function componentCount(blocks: Block[]): number {
    const child = (c: Child): number => {
        switch (c.kind) {
            case "section": return 1 + c.texts.length + 1;
            case "buttons": return 1 + c.buttons.length;
            default: return 1;
        }
    };
    return blocks.reduce((n, b) => n + (b.kind === "container" ? 1 + b.children.reduce((m, c) => m + child(c), 0) : child(b)), 0);
}

/** The text a V2 message shows: its text displays' together */
export function componentTextLength(blocks: Block[]): number {
    const child = (c: Child): number => c.kind === "text" ? c.content.length : c.kind === "section" ? c.texts.reduce((n, s) => n + s.length, 0) : 0;
    return blocks.reduce((n, b) => n + (b.kind === "container" ? b.children.reduce((m, c) => m + child(c), 0) : child(b)), 0);
}

export const isUrl = (s: string) => /^https?:\/\/[^\s/$.?#][^\s]*$/i.test(s.trim());

const ATTACHMENT = /^attachment:\/\/([^\s/]+)$/i;
/** "pic.png" for attachment://pic.png */
export const attachmentName = (s: string) => ATTACHMENT.exec(s.trim())?.[1];

/** Image fields also take attachment://name, for files sent with the message */
const isImageUrl = (s: string) => isUrl(s) || ATTACHMENT.test(s.trim());

const hasContent = (e: Embed) =>
    !!(e.title.trim() || e.description.trim() || e.authorName.trim() || e.footerText.trim() || e.image.trim() || e.thumbnail.trim()
        || e.fields.some(f => f.name.trim() || f.value.trim()));

export type Problem =
    | { kind: "tooLong"; where: string; limit: number; length: number; }
    | { kind: "tooMany"; where: "embeds" | "fields" | "components" | "attachments"; limit: number; count: number; }
    | { kind: "badUrl"; where: string; }
    | { kind: "badColor"; where: string; }
    | { kind: "badTimestamp"; where: string; }
    | { kind: "emptyEmbed"; where: string; }
    | { kind: "fieldNeedsBoth"; where: string; }
    | { kind: "emptyComponent"; where: string; }
    | { kind: "buttonNeedsLabel"; where: string; }
    | { kind: "noAttachment"; where: string; name: string; }
    | { kind: "empty"; };

/**
 * Everything Discord would refuse, with where it is. `where` is a path of keys the editor uses to
 * mark the input: "content", "e1.title", "e1.f2.value", "c2.c1.t1" (component 2, its component 1,
 * text 1), "c3.i2" (gallery item 2), "c4.b1" (button 1), "c1.accessory"...
 *
 * `attachments` are the files picked to go with the message; when given, attachment:// names
 * must be among them.
 */
export function problems(d: Draft, attachments?: string[]): Problem[] {
    const out: Problem[] = [];
    const long = (where: string, text: string, limit: number) => {
        if (text.length > limit) out.push({ kind: "tooLong", where, limit, length: text.length });
    };
    const url = (where: string, text: string, image = false) => {
        if (text.trim() && !(image ? isImageUrl(text) : isUrl(text))) out.push({ kind: "badUrl", where });
        const name = attachmentName(text);
        if (image && name && attachments && !attachments.includes(name)) out.push({ kind: "noAttachment", where, name });
    };
    long("username", d.username, LIMITS.username);
    url("avatarUrl", d.avatarUrl, true);
    if (attachments && attachments.length > LIMITS.attachments) out.push({ kind: "tooMany", where: "attachments", limit: LIMITS.attachments, count: attachments.length });
    if (d.mode === "v2") {
        componentProblems(d.components, out, long, url, attachments);
        return out;
    }
    long("content", d.content, LIMITS.content);
    if (d.embeds.length > LIMITS.embeds) out.push({ kind: "tooMany", where: "embeds", limit: LIMITS.embeds, count: d.embeds.length });
    d.embeds.forEach((e, i) => {
        const p = `e${i + 1}`;
        long(`${p}.title`, e.title, LIMITS.title);
        long(`${p}.description`, e.description, LIMITS.description);
        long(`${p}.authorName`, e.authorName, LIMITS.author);
        long(`${p}.footerText`, e.footerText, LIMITS.footer);
        url(`${p}.url`, e.url);
        url(`${p}.authorUrl`, e.authorUrl);
        url(`${p}.authorIcon`, e.authorIcon, true);
        url(`${p}.image`, e.image, true);
        url(`${p}.thumbnail`, e.thumbnail, true);
        url(`${p}.footerIcon`, e.footerIcon, true);
        if (e.color && hexToInt(e.color) === undefined) out.push({ kind: "badColor", where: `${p}.color` });
        if (e.timestamp && Number.isNaN(Date.parse(e.timestamp))) out.push({ kind: "badTimestamp", where: `${p}.timestamp` });
        if (e.fields.length > LIMITS.fields) out.push({ kind: "tooMany", where: "fields", limit: LIMITS.fields, count: e.fields.length });
        e.fields.forEach((f, j) => {
            long(`${p}.f${j + 1}.name`, f.name, LIMITS.fieldName);
            long(`${p}.f${j + 1}.value`, f.value, LIMITS.fieldValue);
            // Discord needs both, but a field left completely empty is just dropped
            if (!!f.name.trim() !== !!f.value.trim()) out.push({ kind: "fieldNeedsBoth", where: `${p}.f${j + 1}` });
        });
        // An author icon or URL without a name, or a footer icon without text, isn't shown
        if (!hasContent(e) && (e.url || e.color || e.timestamp || e.authorIcon || e.footerIcon)) out.push({ kind: "emptyEmbed", where: p });
    });
    const total = totalLength(d);
    if (total > LIMITS.total) out.push({ kind: "tooLong", where: "total", limit: LIMITS.total, length: total });
    if (!d.content.trim() && !d.embeds.some(hasContent)) out.push({ kind: "empty" });
    return out;
}

function componentProblems(
    blocks: Block[], out: Problem[],
    long: (where: string, text: string, limit: number) => void,
    url: (where: string, text: string, image?: boolean) => void,
    attachments: string[] | undefined,
) {
    const empty = (where: string) => out.push({ kind: "emptyComponent", where });
    const button = (where: string, b: LinkButton) => {
        long(`${where}.label`, b.label, LIMITS.buttonLabel);
        long(`${where}.link`, b.url, LIMITS.buttonUrl);
        if (!b.label.trim() && !b.emoji.trim()) out.push({ kind: "buttonNeedsLabel", where });
        if (!b.url.trim()) out.push({ kind: "badUrl", where: `${where}.link` });
        else url(`${where}.link`, b.url);
    };
    const media = (where: string, m: MediaItem) => {
        if (!m.url.trim()) out.push({ kind: "badUrl", where: `${where}.media` });
        else url(`${where}.media`, m.url, true);
        long(`${where}.alt`, m.description, LIMITS.mediaDescription);
    };
    const child = (where: string, c: Child) => {
        switch (c.kind) {
            case "text":
                if (!c.content.trim()) empty(where);
                break;
            case "section":
                if (!c.texts.length || c.texts.length > LIMITS.sectionTexts || c.texts.some(s => !s.trim())) empty(where);
                if (c.accessory.kind === "thumbnail") media(`${where}.accessory`, c.accessory);
                else button(`${where}.accessory`, c.accessory);
                break;
            case "gallery":
                if (!c.items.length || c.items.length > LIMITS.galleryItems) empty(where);
                c.items.forEach((m, i) => media(`${where}.i${i + 1}`, m));
                break;
            case "file":
                if (!c.name.trim()) empty(where);
                else if (attachments && !attachments.includes(c.name)) out.push({ kind: "noAttachment", where, name: c.name });
                break;
            case "buttons":
                if (!c.buttons.length || c.buttons.length > LIMITS.rowButtons) empty(where);
                c.buttons.forEach((b, i) => button(`${where}.b${i + 1}`, b));
                break;
            case "separator":
                break;
        }
    };
    blocks.forEach((b, i) => {
        const where = `c${i + 1}`;
        if (b.kind === "container") {
            if (b.color && hexToInt(b.color) === undefined) out.push({ kind: "badColor", where: `${where}.color` });
            if (!b.children.length) empty(where);
            b.children.forEach((c, j) => child(`${where}.c${j + 1}`, c));
        } else child(where, b);
    });
    const count = componentCount(blocks);
    if (count > LIMITS.components) out.push({ kind: "tooMany", where: "components", limit: LIMITS.components, count });
    const text = componentTextLength(blocks);
    if (text > LIMITS.componentText) out.push({ kind: "tooLong", where: "componentText", limit: LIMITS.componentText, length: text });
    if (!blocks.length) out.push({ kind: "empty" });
}

const clean = <T extends object>(o: T): T => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== "")) as T;
const opt = (s: string) => s.trim() || undefined;

export function embedPayload(e: Embed): Record<string, unknown> {
    const author = e.authorName.trim() ? clean({ name: e.authorName.trim(), url: opt(e.authorUrl), icon_url: opt(e.authorIcon) }) : undefined;
    const footer = e.footerText.trim() ? clean({ text: e.footerText.trim(), icon_url: opt(e.footerIcon) }) : undefined;
    const fields = e.fields.filter(f => f.name.trim() && f.value.trim()).map(f => ({ name: f.name, value: f.value, inline: f.inline }));
    const color = hexToInt(e.color);
    const time = e.timestamp && !Number.isNaN(Date.parse(e.timestamp)) ? new Date(e.timestamp).toISOString() : undefined;
    return clean({
        author,
        title: opt(e.title),
        url: opt(e.url),
        description: e.description.trim() ? e.description : undefined,
        color,
        fields: fields.length ? fields : undefined,
        image: opt(e.image) ? { url: e.image.trim() } : undefined,
        thumbnail: opt(e.thumbnail) ? { url: e.thumbnail.trim() } : undefined,
        footer,
        timestamp: time,
    });
}

const mediaPayload = (m: MediaItem) => clean({ media: { url: m.url.trim() }, description: opt(m.description), spoiler: m.spoiler || undefined });

function buttonPayload(b: LinkButton) {
    return clean({ type: COMPONENT_TYPE.button, style: 5, label: opt(b.label), url: b.url.trim(), emoji: b.emoji.trim() ? { name: b.emoji.trim() } : undefined });
}

function childPayload(c: Child): Record<string, unknown> {
    switch (c.kind) {
        case "text": return { type: COMPONENT_TYPE.text, content: c.content };
        case "section": return {
            type: COMPONENT_TYPE.section,
            components: c.texts.map(content => ({ type: COMPONENT_TYPE.text, content })),
            accessory: c.accessory.kind === "thumbnail" ? { type: COMPONENT_TYPE.thumbnail, ...mediaPayload(c.accessory) } : buttonPayload(c.accessory),
        };
        case "gallery": return { type: COMPONENT_TYPE.gallery, items: c.items.map(mediaPayload) };
        case "separator": return { type: COMPONENT_TYPE.separator, divider: c.divider, spacing: c.spacing };
        case "file": return clean({ type: COMPONENT_TYPE.file, file: { url: `attachment://${c.name.trim()}` }, spoiler: c.spoiler || undefined });
        case "buttons": return { type: COMPONENT_TYPE.buttons, components: c.buttons.map(buttonPayload) };
    }
}

export function componentsPayload(blocks: Block[]): Record<string, unknown>[] {
    return blocks.map(b => b.kind === "container"
        ? clean({ type: COMPONENT_TYPE.container, accent_color: hexToInt(b.color), spoiler: b.spoiler || undefined, components: b.children.map(childPayload) })
        : childPayload(b));
}

/** The body for POST /webhooks/:id/:token (and, without username and avatar, for editing a message) */
export function payload(d: Draft, editing = false): Record<string, unknown> {
    const body: Record<string, unknown> = d.mode === "v2"
        ? { flags: IS_COMPONENTS_V2, components: componentsPayload(d.components) }
        : { content: d.content, embeds: d.embeds.filter(hasContent).map(embedPayload) };
    // Mentions ping as they would in a message you type
    body.allowed_mentions = { parse: ["users", "roles", "everyone"] };
    if (!editing) {
        if (d.username.trim()) body.username = d.username.trim();
        if (d.avatarUrl.trim()) body.avatar_url = d.avatarUrl.trim();
    }
    return body;
}

const str = (v: unknown, max = 8000) => typeof v === "string" ? v.slice(0, max) : "";

export function embedFromJson(raw: any): Embed {
    const e = emptyEmbed();
    if (!raw || typeof raw !== "object") return e;
    e.authorName = str(raw.author?.name);
    e.authorUrl = str(raw.author?.url);
    e.authorIcon = str(raw.author?.icon_url);
    e.title = str(raw.title);
    e.url = str(raw.url);
    e.description = str(raw.description);
    e.color = typeof raw.color === "number" && Number.isFinite(raw.color) ? intToHex(raw.color) : typeof raw.color === "string" && hexToInt(raw.color) !== undefined ? intToHex(hexToInt(raw.color)!) : "";
    e.fields = Array.isArray(raw.fields) ? raw.fields.slice(0, 50).map((f: any) => ({ name: str(f?.name), value: str(f?.value), inline: f?.inline === true })) : [];
    e.image = str(raw.image?.url);
    e.thumbnail = str(raw.thumbnail?.url);
    e.footerText = str(raw.footer?.text);
    e.footerIcon = str(raw.footer?.icon_url);
    e.timestamp = typeof raw.timestamp === "string" && !Number.isNaN(Date.parse(raw.timestamp)) ? new Date(raw.timestamp).toISOString() : "";
    return e;
}

/**
 * A sent message's attachments, so a loaded message's media pointing at them reads as
 * attachment://name again (that's how an edit keeps them)
 */
export interface SentAttachment { id: string; filename: string; url: string; }

const plainUrl = (u: string) => u.split("?")[0];

function mediaUrl(raw: any, attachments: SentAttachment[]): string {
    const url = str(raw?.url, 2000);
    const id = typeof raw?.attachment_id === "string" ? raw.attachment_id : undefined;
    const sent = attachments.find(a => a.id === id || (url && plainUrl(a.url) === plainUrl(url)));
    return sent ? `attachment://${sent.filename}` : url;
}

const mediaFromJson = (raw: any, attachments: SentAttachment[]): MediaItem =>
    ({ url: mediaUrl(raw?.media, attachments), description: str(raw?.description, LIMITS.mediaDescription * 2), spoiler: raw?.spoiler === true });

/** Only link buttons: interactive ones need an app behind the webhook. null for anything else */
function buttonFromJson(raw: any): LinkButton | null {
    if (raw?.type !== COMPONENT_TYPE.button || raw.style !== 5 || typeof raw.url !== "string") return null;
    return { label: str(raw.label, 200), url: str(raw.url, 2000), emoji: typeof raw.emoji?.name === "string" && !raw.emoji.id ? raw.emoji.name : "" };
}

/** Counts what couldn't be kept (interactive components, unknown types) */
interface Skips { count: number; }

function childFromJson(raw: any, attachments: SentAttachment[], skipped: Skips): Child | null {
    switch (raw?.type) {
        case COMPONENT_TYPE.text: return { kind: "text", content: str(raw.content) };
        case COMPONENT_TYPE.section: {
            const texts = Array.isArray(raw.components) ? raw.components.filter((c: any) => c?.type === COMPONENT_TYPE.text).map((c: any) => str(c.content)).slice(0, LIMITS.sectionTexts) : [];
            const acc = raw.accessory;
            let accessory: Accessory;
            if (acc?.type === COMPONENT_TYPE.thumbnail) accessory = { kind: "thumbnail", ...mediaFromJson(acc, attachments) };
            else {
                const b = buttonFromJson(acc);
                if (!b) skipped.count++;
                accessory = b ? { kind: "button", ...b } : { kind: "thumbnail", ...emptyMedia() };
            }
            return { kind: "section", texts: texts.length ? texts : [""], accessory };
        }
        case COMPONENT_TYPE.gallery:
            return { kind: "gallery", items: Array.isArray(raw.items) ? raw.items.slice(0, 20).map((m: any) => mediaFromJson(m, attachments)) : [] };
        case COMPONENT_TYPE.separator:
            return { kind: "separator", divider: raw.divider !== false, spacing: raw.spacing === 2 ? 2 : 1 };
        case COMPONENT_TYPE.file: {
            const url = mediaUrl(raw.file, attachments);
            return { kind: "file", name: attachmentName(url) ?? str(raw.name, 200), spoiler: raw.spoiler === true };
        }
        case COMPONENT_TYPE.buttons: {
            const all = Array.isArray(raw.components) ? raw.components : [];
            const buttons = all.map(buttonFromJson).filter((b: LinkButton | null): b is LinkButton => !!b);
            skipped.count += all.length - buttons.length;
            return buttons.length ? { kind: "buttons", buttons } : null;
        }
        default:
            skipped.count++;
            return null;
    }
}

export function blocksFromJson(list: unknown, attachments: SentAttachment[] = [], skipped: Skips = { count: 0 }): Block[] {
    if (!Array.isArray(list)) return [];
    const out: Block[] = [];
    for (const raw of list.slice(0, 60)) {
        if (raw?.type === COMPONENT_TYPE.container) {
            const children = (Array.isArray(raw.components) ? raw.components : []).map((c: any) => childFromJson(c, attachments, skipped)).filter((c: Child | null): c is Child => !!c);
            out.push({ kind: "container", color: typeof raw.accent_color === "number" ? intToHex(raw.accent_color) : "", spoiler: raw.spoiler === true, children });
        } else {
            const c = childFromJson(raw, attachments, skipped);
            if (c) out.push(c);
        }
    }
    return out;
}

export const isV2Message = (raw: any) =>
    (typeof raw?.flags === "number" && (raw.flags & IS_COMPONENTS_V2) !== 0)
    || (Array.isArray(raw?.components) && raw.components.some((c: any) => typeof c?.type === "number" && c.type >= 9));

/**
 * A draft from pasted or loaded JSON; throws when it's none of the shapes above. `skipped` is how
 * many components couldn't come along (interactive ones, which a webhook can't send).
 */
export function draftFromJson(text: string, attachments: SentAttachment[] = []): Draft & { skipped: number; } {
    let raw: any;
    try {
        raw = JSON.parse(text);
    } catch {
        throw new Error("not-json");
    }
    // Discohook: { messages: [{ data: {...} }] }, the first message
    if (Array.isArray(raw?.messages)) raw = raw.messages[0]?.data ?? raw.messages[0];
    // Discohook's older backup: { message: {...} }
    else if (raw?.message && typeof raw.message === "object" && !Array.isArray(raw.message)) raw = raw.message;
    if (Array.isArray(raw)) raw = { embeds: raw };
    if (!raw || typeof raw !== "object") throw new Error("not-message");
    const looksLikeEmbed = !("embeds" in raw) && !("content" in raw) && !("components" in raw) && ["title", "description", "fields", "author", "footer", "image"].some(k => k in raw);
    if (looksLikeEmbed) raw = { embeds: [raw] };
    if (!("embeds" in raw) && !("content" in raw) && !("components" in raw)) throw new Error("not-message");
    const skipped = { count: 0 };
    const v2 = isV2Message(raw);
    const embeds = Array.isArray(raw.embeds) ? raw.embeds.slice(0, 20).map(embedFromJson) : [];
    return {
        mode: v2 ? "v2" : "classic",
        content: v2 ? "" : str(raw.content),
        username: str(raw.username, 200),
        avatarUrl: str(raw.avatar_url, 2000),
        embeds: v2 ? [emptyEmbed()] : embeds,
        components: v2 ? blocksFromJson(raw.components, attachments, skipped) : [],
        skipped: skipped.count,
    };
}

export const draftToJson = (d: Draft) => JSON.stringify(payload(d), null, 2);

/**
 * The classic message as V2 components, for switching an existing draft over: the content becomes a
 * text, each embed a container in its colour (author and footer as small text, the thumbnail beside
 * the title and description, fields as bold names over values, the image as a gallery).
 */
export function convertToV2(d: Draft): Block[] {
    const blocks: Block[] = [];
    if (d.content.trim()) blocks.push({ kind: "text", content: d.content });
    for (const e of d.embeds) {
        if (!hasContent(e)) continue;
        const children: Child[] = [];
        if (e.authorName.trim()) children.push({ kind: "text", content: `-# ${e.authorUrl.trim() ? `[${e.authorName.trim()}](${e.authorUrl.trim()})` : e.authorName.trim()}` });
        const head: string[] = [];
        if (e.title.trim()) head.push(`### ${e.url.trim() ? `[${e.title.trim()}](${e.url.trim()})` : e.title.trim()}`);
        if (e.description.trim()) head.push(e.description);
        if (e.thumbnail.trim()) children.push({ kind: "section", texts: head.length ? head : [String.fromCharCode(0x200b)], accessory: { kind: "thumbnail", url: e.thumbnail.trim(), description: "", spoiler: false } });
        else if (head.length) children.push({ kind: "text", content: head.join("\n") });
        const fields = e.fields.filter(f => f.name.trim() && f.value.trim());
        if (fields.length) children.push({ kind: "text", content: fields.map(f => `**${f.name}**\n${f.value}`).join("\n\n") });
        if (e.image.trim()) children.push({ kind: "gallery", items: [{ url: e.image.trim(), description: "", spoiler: false }] });
        const time = e.timestamp && !Number.isNaN(Date.parse(e.timestamp)) ? `<t:${Math.floor(Date.parse(e.timestamp) / 1000)}:f>` : "";
        const foot = [e.footerText.trim(), time].filter(Boolean).join(" • ");
        if (foot) {
            children.push({ kind: "separator", divider: true, spacing: 1 });
            children.push({ kind: "text", content: `-# ${foot}` });
        }
        blocks.push({ kind: "container", color: hexToInt(e.color) === undefined ? "" : e.color, spoiler: false, children });
    }
    return blocks.length ? blocks : [emptyBlock("container")];
}

/**
 * Where each field sits in Discord's 12-column field grid: a field that isn't inline takes the
 * whole row; inline ones share a row, `perRow` at most (3, or 2 next to a thumbnail), evenly.
 */
export function fieldColumns(inline: boolean[], perRow: number): string[] {
    const out: string[] = [];
    let i = 0;
    while (i < inline.length) {
        if (!inline[i]) {
            out.push("1 / 13");
            i++;
            continue;
        }
        let run = 0;
        while (i + run < inline.length && inline[i + run] && run < perRow) run++;
        const span = 12 / run;
        for (let k = 0; k < run; k++) out.push(`${1 + k * span} / ${1 + (k + 1) * span}`);
        i += run;
    }
    return out;
}

/**
 * A media gallery's rows, as Discord lays out 1 to 10 pictures: how many go in each row, top to
 * bottom. Three is the odd one: one big picture beside two stacked ("tall").
 */
export function galleryRows(count: number): number[] | "tall" {
    switch (count) {
        case 0: return [];
        case 1: return [1];
        case 2: return [2];
        case 3: return "tall";
        case 4: return [2, 2];
        case 5: return [2, 3];
        case 6: return [3, 3];
        case 7: return [1, 3, 3];
        case 8: return [2, 3, 3];
        case 9: return [3, 3, 3];
        default: return [1, 3, 3, 3];
    }
}

/** https://discord.com/channels/<guild>/<channel>/<message>, from any Discord host */
export function parseMessageLink(link: string): { guildId: string; channelId: string; messageId: string; } | undefined {
    const m = /^https?:\/\/(?:(?:ptb|canary)\.)?discord(?:app)?\.com\/channels\/(\d{15,22}|@me)\/(\d{15,22})\/(\d{15,22})\/?$/i.exec(link.trim());
    return m ? { guildId: m[1], channelId: m[2], messageId: m[3] } : undefined;
}

/**
 * A webhook's execute URL, with the thread it posts in and the message it edits. `components`
 * adds ?with_components=true, without which Discord ignores the components of a webhook no app owns.
 */
export function webhookUrl(id: string, token: string, options: { threadId?: string; messageId?: string; wait?: boolean; components?: boolean; } = {}) {
    const base = `https://discord.com/api/v10/webhooks/${id}/${encodeURIComponent(token)}`;
    const path = options.messageId ? `${base}/messages/${options.messageId}` : base;
    const query = new URLSearchParams();
    if (options.wait) query.set("wait", "true");
    if (options.threadId) query.set("thread_id", options.threadId);
    if (options.components) query.set("with_components", "true");
    const q = query.toString();
    return q ? `${path}?${q}` : path;
}

/** Channel types webhooks post in: text, announcement, and threads (through their parent's webhook) */
export const THREAD_TYPES = new Set([10, 11, 12]);
export const WEBHOOK_TYPES = new Set([0, 5, ...THREAD_TYPES]);

/** Incoming webhooks this channel can use: ones with a token (type 1); channel-follower and app webhooks have none */
export function usableWebhooks(list: unknown): { id: string; name: string; token: string; avatar: string | null; channelId: string; }[] {
    if (!Array.isArray(list)) return [];
    return list
        .filter((w: any) => w && w.type === 1 && typeof w.id === "string" && typeof w.token === "string" && w.token)
        .map((w: any) => ({ id: w.id, name: typeof w.name === "string" && w.name ? w.name : "Webhook", token: w.token, avatar: typeof w.avatar === "string" ? w.avatar : null, channelId: String(w.channel_id ?? "") }))
        .sort((a, b) => a.name.localeCompare(b.name));
}

/** A file name Discord keeps as is in attachment://name: no slashes or spaces */
export const safeFileName = (name: string) => (name.replace(/[\\/:*?"<>|\s]+/g, "_").replace(/^\.+/, "") || "file").slice(0, 100);

/**
 * The request a message goes out as: JSON alone, or multipart with the files and the JSON in
 * payload_json (attachments listed by index so attachment://name finds them). Editing keeps the
 * message's own attachments that are still referenced (`keep`).
 */
export function requestBody(body: Record<string, unknown>, files: { name: string; }[], keep: SentAttachment[] = []):
    { json: Record<string, unknown>; multipart: boolean; } {
    const kept = keep.map(a => ({ id: a.id, filename: a.filename }));
    const fresh = files.map((f, i) => ({ id: i, filename: f.name }));
    const attachments = [...kept, ...fresh];
    const json = attachments.length ? { ...body, attachments } : body;
    return { json, multipart: files.length > 0 };
}
