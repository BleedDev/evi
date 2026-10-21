/**
 * What the message logger remembers, in memory only. Pure: no Discord, no DOM, so it's unit tested.
 *
 * Entries are immutable: every change replaces the entry object, so `get` doubles as a snapshot for
 * React's useSyncExternalStore. Both channels and the entries inside a channel are kept in order of
 * last activity, and the oldest are evicted past the limits. Evicting a deleted message is reported
 * to the caller, which then really deletes it from Discord: a deleted message we stop tracking must
 * not stay in the chat looking like a live one.
 */

export interface PreviousVersion {
    content: string;
    /** When this version was posted (ms), the message's creation or edit time */
    timestamp: number;
    /** Attachments this version had that the next one didn't, saved */
    media?: readonly SavedMedia[];
}

/** A picture, video, sound or file a message had, saved in memory while it could still be downloaded */
export interface SavedMedia {
    /** The attachment's id, or its URL when it has none */
    key: string;
    name: string;
    kind: "image" | "video" | "audio" | "file";
    /** A blob: URL of the saved copy */
    url: string;
    size: number;
    width?: number;
    height?: number;
    spoiler: boolean;
}

/** The parts of a Discord attachment that matter here */
export interface AttachmentLike {
    id?: string;
    filename?: string;
    content_type?: string;
    url?: string;
    proxy_url?: string;
    size?: number;
    width?: number;
    height?: number;
}

/** Saved per attachment, past this it's left alone: a big video isn't worth the memory */
export const MAX_SAVED_BYTES = 25 * 1024 * 1024;

export const attachmentKey = (a: AttachmentLike) => a.id ?? a.url ?? a.proxy_url ?? "";

export function mediaKind(a: AttachmentLike): SavedMedia["kind"] {
    const type = a.content_type ?? "";
    const name = (a.filename ?? a.url ?? "").toLowerCase().split("?")[0];
    if (type.startsWith("image/") || /\.(png|jpe?g|gif|webp|avif)$/.test(name)) return "image";
    if (type.startsWith("video/") || /\.(mp4|webm|mov)$/.test(name)) return "video";
    if (type.startsWith("audio/") || /\.(mp3|ogg|wav|m4a|flac|opus)$/.test(name)) return "audio";
    return "file";
}

/** Saved ahead of time per attachment, pictures aside (they're saved as a smaller copy): a big clip only if its message is deleted */
export const PREFETCH_FILE_BYTES = 5 * 1024 * 1024;

/** Pictures in a format that can move: resized without a format, so Discord's proxy keeps the animation */
const ANIMATABLE_TYPE = /^image\/(gif|webp|avif)$/;
const ANIMATABLE_NAME = /\.(gif|webp|avif)$/;

/**
 * A smaller copy of a picture from Discord's media proxy, fitted in maxW x maxH (never upscaled): a
 * saved copy is shown at 400x300 at most. Undefined without a proxy URL or the picture's size.
 */
export function savedImageUrl(a: AttachmentLike, maxW = 800, maxH = 600): string | undefined {
    if (!a.proxy_url || !a.width || !a.height) return;
    try {
        const scale = Math.min(1, maxW / a.width, maxH / a.height);
        const u = new URL(a.proxy_url);
        u.searchParams.set("width", String(Math.max(1, Math.round(a.width * scale))));
        u.searchParams.set("height", String(Math.max(1, Math.round(a.height * scale))));
        const name = (a.filename ?? u.pathname).toLowerCase();
        if (!ANIMATABLE_TYPE.test(a.content_type ?? "") && !ANIMATABLE_NAME.test(name)) u.searchParams.set("format", "webp");
        return u.href;
    } catch { }
}

/** Saved as it loads: every picture (as a smaller copy), anything else only when it's small */
export const shouldPrefetch = (a: AttachmentLike) => mediaKind(a) === "image" || (a.size ?? Infinity) <= PREFETCH_FILE_BYTES;

/** The attachments worth saving: downloadable, and not too big */
export function attachmentsToSave(attachments: readonly AttachmentLike[] | undefined, maxBytes = MAX_SAVED_BYTES): AttachmentLike[] {
    return (attachments ?? []).filter(a => !!(a.url || a.proxy_url) && (a.size ?? 0) <= maxBytes);
}

/** Attachments an edit took away: in the old version, not in the new one */
export function removedAttachments(before: readonly AttachmentLike[] | undefined, after: readonly AttachmentLike[] | undefined): AttachmentLike[] {
    if (!after) return [];
    const kept = new Set(after.map(attachmentKey));
    return (before ?? []).filter(a => !kept.has(attachmentKey(a)));
}

/**
 * Saved copies by attachment, capped by total size: the oldest go first, and `onEvict` hears about
 * each (to revoke its blob: URL). Taking one out hands it over: it's no longer the cache's to evict.
 */
export class MediaCache<T extends { size: number; }> {
    private readonly items = new Map<string, T>();
    private bytes = 0;

    constructor(private readonly maxBytes: number, private readonly onEvict: (item: T) => void = () => { }) { }

    get size() {
        return this.bytes;
    }

    has(key: string) {
        return this.items.has(key);
    }

    set(key: string, item: T) {
        if (item.size > this.maxBytes) return this.onEvict(item);
        const old = this.items.get(key);
        if (old) {
            this.items.delete(key);
            this.bytes -= old.size;
            if (old !== item) this.onEvict(old);
        }
        this.items.set(key, item);
        this.bytes += item.size;
        for (const [k, v] of this.items) {
            if (this.bytes <= this.maxBytes) break;
            this.items.delete(k);
            this.bytes -= v.size;
            this.onEvict(v);
        }
    }

    /** Hands a saved copy over (for a deleted message to keep): the cache forgets it without evicting */
    take(key: string): T | undefined {
        const item = this.items.get(key);
        if (!item) return;
        this.items.delete(key);
        this.bytes -= item.size;
        return item;
    }

    clear() {
        for (const item of this.items.values()) this.onEvict(item);
        this.items.clear();
        this.bytes = 0;
    }
}

export interface LoggedMessage {
    channelId: string;
    id: string;
    /** When the delete arrived (ms), undefined while the message still exists */
    deletedAt?: number;
    /** Older versions of the content, oldest first */
    edits: readonly PreviousVersion[];
    /** Its attachments, saved, for once it's deleted */
    media?: readonly SavedMedia[];
}

export interface LogLimits {
    /** Logged messages per channel */
    perChannel: number;
    /** Channels with logged messages */
    channels: number;
    /** Previous versions per message. The original is always kept, the oldest edits after it go first */
    edits: number;
}

export interface MessageRef {
    channelId: string;
    id: string;
}

export const DEFAULT_LIMITS: LogLimits = { perChannel: 50, channels: 100, edits: 10 };

/** The parts of Discord's MessageRecord the filters look at */
export interface MessageLike {
    author?: { id?: string; bot?: boolean; } | null;
    flags?: number;
    state?: string;
}

export interface LogFilters {
    currentUserId?: string;
    ignoreSelf: boolean;
    ignoreBots: boolean;
}

const EPHEMERAL = 1 << 6;

/**
 * Whether a message is worth logging at all. Ephemeral messages ("Only you can see this") and
 * messages that never finished sending are always left alone: Discord deletes those locally.
 */
export function shouldLog(message: MessageLike, filters: LogFilters) {
    if ((message.flags ?? 0) & EPHEMERAL) return false;
    if (message.state === "SENDING" || message.state === "SEND_FAILED") return false;
    if (filters.ignoreSelf && !!filters.currentUserId && message.author?.id === filters.currentUserId) return false;
    if (filters.ignoreBots && message.author?.bot) return false;
    return true;
}

export class MessageLog {
    private readonly channels = new Map<string, Map<string, LoggedMessage>>();
    private readonly listeners = new Set<() => void>();
    private limits: LogLimits;
    /** Bumped on every change, a cheap snapshot for summaries */
    version = 0;

    constructor(limits: Partial<LogLimits> = {}, private readonly onForget: (entry: LoggedMessage) => void = () => { }) {
        this.limits = { ...DEFAULT_LIMITS, ...limits };
    }

    get(channelId: string, id: string): LoggedMessage | undefined {
        return this.channels.get(channelId)?.get(id);
    }

    isDeleted(channelId: string, id: string) {
        return this.get(channelId, id)?.deletedAt !== undefined;
    }

    /** Marks a message deleted. Returns deleted messages evicted to make room. */
    markDeleted(channelId: string, id: string, at = Date.now()): MessageRef[] {
        const previous = this.get(channelId, id);
        if (previous?.deletedAt !== undefined) return [];
        return this.put({ ...previous, channelId, id, edits: previous?.edits ?? [], deletedAt: at });
    }

    /** A message's saved attachments, added as they arrive. Only for a message the log already has. */
    addMedia(channelId: string, id: string, media: readonly SavedMedia[]) {
        const entry = this.get(channelId, id);
        if (!entry || !media.length) return false;
        const have = new Set(entry.media?.map(m => m.key));
        const added = media.filter(m => !have.has(m.key) && !!have.add(m.key));
        if (!added.length) return true;
        this.channels.get(channelId)!.set(id, { ...entry, media: [...entry.media ?? [], ...added] });
        this.changed();
        return true;
    }

    /** Saved attachments for the edit made at `timestamp`, arriving after the edit itself was recorded */
    addEditMedia(channelId: string, id: string, timestamp: number, media: readonly SavedMedia[]) {
        const entry = this.get(channelId, id);
        const at = entry?.edits.findIndex(e => e.timestamp === timestamp) ?? -1;
        if (!entry || at < 0 || !media.length) return false;
        const edits = entry.edits.map((e, i) => i === at ? { ...e, media: [...e.media ?? [], ...media] } : e);
        this.channels.get(channelId)!.set(id, { ...entry, edits });
        this.changed();
        return true;
    }

    /** Every saved attachment of a message, for revoking their blob: URLs once it's forgotten */
    mediaOf(channelId: string, id: string): SavedMedia[] {
        const entry = this.get(channelId, id);
        return entry ? [...entry.media ?? [], ...entry.edits.flatMap(e => e.media ?? [])] : [];
    }

    /** Records the version a message had before an edit. Returns deleted messages evicted to make room. */
    addEdit(channelId: string, id: string, version: PreviousVersion): MessageRef[] {
        const previous = this.get(channelId, id);
        const edits = this.trimEdits([...previous?.edits ?? [], version]);
        return this.put({ ...previous, channelId, id, deletedAt: previous?.deletedAt, edits });
    }

    /** Forgets one message, e.g. once it's really gone from Discord */
    remove(channelId: string, id: string) {
        const channel = this.channels.get(channelId);
        const entry = channel?.get(id);
        if (!channel || !entry) return;
        channel.delete(id);
        this.onForget(entry);
        if (!channel.size) this.channels.delete(channelId);
        this.changed();
    }

    /** Applies new limits. Returns deleted messages evicted by them. */
    setLimits(limits: Partial<LogLimits>): MessageRef[] {
        this.limits = { ...this.limits, ...limits };
        const evicted: MessageRef[] = [];
        for (const [channelId, channel] of this.channels) {
            for (const [id, entry] of channel) {
                if (entry.edits.length > Math.max(1, this.limits.edits)) channel.set(id, { ...entry, edits: this.trimEdits([...entry.edits]) });
            }
            evicted.push(...this.trimChannel(channelId, channel));
        }
        evicted.push(...this.trimChannels());
        this.changed();
        return evicted;
    }

    /** Every deleted message currently kept, grouped by channel */
    deleted(): Map<string, string[]> {
        const out = new Map<string, string[]>();
        for (const [channelId, channel] of this.channels) {
            const ids = [...channel.values()].filter(e => e.deletedAt !== undefined).map(e => e.id);
            if (ids.length) out.set(channelId, ids);
        }
        return out;
    }

    /** Forgets everything. Returns the deleted messages that were kept. */
    clear(): MessageRef[] {
        const deleted = [...this.deleted()].flatMap(([channelId, ids]) => ids.map(id => ({ channelId, id })));
        const had = this.channels.size > 0;
        for (const channel of this.channels.values()) for (const entry of channel.values()) this.onForget(entry);
        this.channels.clear();
        if (had) this.changed();
        return deleted;
    }

    /** Forgets the given channels. Returns the deleted messages that were kept in them. */
    clearChannels(channelIds: Iterable<string>): MessageRef[] {
        const deleted: MessageRef[] = [];
        let had = false;
        for (const channelId of channelIds) {
            const channel = this.channels.get(channelId);
            if (!channel) continue;
            had = true;
            this.channels.delete(channelId);
            for (const entry of channel.values()) {
                this.onForget(entry);
                if (entry.deletedAt !== undefined) deleted.push({ channelId, id: entry.id });
            }
        }
        if (had) this.changed();
        return deleted;
    }

    /** Channels with anything logged */
    channelIds(): string[] {
        return [...this.channels.keys()];
    }

    /** Counts across every channel, or only the given ones */
    counts(channelIds?: Iterable<string>) {
        let deleted = 0;
        let edited = 0;
        const channels = channelIds ? [...channelIds].flatMap(id => this.channels.get(id) ?? []) : [...this.channels.values()];
        for (const channel of channels) {
            for (const entry of channel.values()) {
                if (entry.deletedAt !== undefined) deleted++;
                if (entry.edits.length) edited++;
            }
        }
        return { deleted, edited, channels: channels.length };
    }

    subscribe = (listener: () => void) => {
        this.listeners.add(listener);
        return () => void this.listeners.delete(listener);
    };

    private put(entry: LoggedMessage): MessageRef[] {
        let channel = this.channels.get(entry.channelId);
        if (channel) {
            // Re-insert so both maps stay in order of last activity
            this.channels.delete(entry.channelId);
            channel.delete(entry.id);
        } else {
            channel = new Map();
        }
        this.channels.set(entry.channelId, channel);
        channel.set(entry.id, entry);

        const evicted = [...this.trimChannel(entry.channelId, channel), ...this.trimChannels()];
        this.changed();
        return evicted;
    }

    /** Keeps the original, drops the oldest edits after it. Mutates and returns `edits`. */
    private trimEdits(edits: PreviousVersion[]) {
        while (edits.length > Math.max(1, this.limits.edits)) edits.splice(1, 1);
        return edits;
    }

    private trimChannel(channelId: string, channel: Map<string, LoggedMessage>): MessageRef[] {
        const evicted: MessageRef[] = [];
        for (const [id, entry] of channel) {
            if (channel.size <= Math.max(1, this.limits.perChannel)) break;
            channel.delete(id);
            this.onForget(entry);
            if (entry.deletedAt !== undefined) evicted.push({ channelId, id });
        }
        return evicted;
    }

    private trimChannels(): MessageRef[] {
        const evicted: MessageRef[] = [];
        for (const [channelId, channel] of this.channels) {
            if (this.channels.size <= Math.max(1, this.limits.channels)) break;
            this.channels.delete(channelId);
            for (const entry of channel.values()) {
                this.onForget(entry);
                if (entry.deletedAt !== undefined) evicted.push({ channelId, id: entry.id });
            }
        }
        return evicted;
    }

    private changed() {
        this.version++;
        for (const listener of [...this.listeners]) {
            try {
                listener();
            } catch { }
        }
    }
}
