/**
 * The store's inbox. evi.rest keeps notifications for accounts (a review on your plugin, your upload
 * approved, a new plugin from an author you follow, a change in the plugin API you use); Evi adds its
 * own for this install (a plugin on your wishlist updated or was fixed). Both show in one list.
 */

export type NotificationKind =
    | "review" // someone reviewed your plugin
    | "submission" // your plugin version was approved or rejected
    | "theme" // your theme was approved or rejected
    | "follow" // an author you follow published something
    | "api" // the plugin API changed in a way that touches your plugin
    | "wishlist" // a plugin you hearted updated or got a beta
    | "fixed" // a plugin you have or hearted works again on your Discord
    | "broken" // installs report your plugin's current version failing (once per version)
    | "update"; // a new Evi

export type NotificationLink =
    | { kind: "plugin" | "theme" | "author"; id: string; }
    | { kind: "url"; url: string; };

export interface EviNotification {
    /** Server ones are numbers as strings, local ones start with "local:" */
    id: string;
    kind: NotificationKind;
    title: string;
    body: string;
    link?: NotificationLink;
    at: number;
    read: boolean;
}

export const MAX_NOTIFICATIONS = 100;
const KINDS = new Set<NotificationKind>(["review", "submission", "theme", "follow", "api", "wishlist", "fixed", "broken", "update"]);

const text = (v: unknown, max: number) => typeof v === "string" && v.length <= max && !/[\0-\x08\x0e-\x1f]/.test(v);

function parseLink(raw: unknown): NotificationLink | undefined {
    const l = (raw ?? {}) as Record<string, unknown>;
    if ((l.kind === "plugin" || l.kind === "theme" || l.kind === "author") && typeof l.id === "string" && /^[a-z0-9-]{1,64}$/.test(l.id)) return { kind: l.kind, id: l.id };
    if (l.kind === "url" && typeof l.url === "string" && /^https:\/\/[^\s]{1,2000}$/.test(l.url)) return { kind: "url", url: l.url };
}

/** One notification from anywhere untrusted (the server, storage), cleaned, or undefined */
export function parseNotification(raw: unknown): EviNotification | undefined {
    const n = (raw ?? {}) as Record<string, unknown>;
    if (!text(n.id, 64) || !KINDS.has(n.kind as NotificationKind) || !text(n.title, 200) || !text(n.body, 1000)) return;
    if (typeof n.at !== "number" || !Number.isFinite(n.at)) return;
    const link = parseLink(n.link);
    return { id: n.id as string, kind: n.kind as NotificationKind, title: n.title as string, body: n.body as string, ...(link && { link }), at: n.at, read: n.read === true };
}

export function parseNotifications(raw: unknown): EviNotification[] {
    return Array.isArray(raw) ? raw.map(parseNotification).filter((n): n is EviNotification => !!n).slice(0, MAX_NOTIFICATIONS) : [];
}

/** Server and local notifications together, newest first, capped */
export function mergeNotifications(...lists: EviNotification[][]): EviNotification[] {
    const byId = new Map<string, EviNotification>();
    for (const list of lists) for (const n of list) if (!byId.has(n.id)) byId.set(n.id, n);
    return [...byId.values()].sort((a, b) => b.at - a.at).slice(0, MAX_NOTIFICATIONS);
}

export const unreadCount = (list: EviNotification[]) => list.filter(n => !n.read).length;

/** How old a notification may be and still pop up when it arrives: older ones only wait in the inbox */
export const FRESH_FOR = 15 * 60 * 1000;

/**
 * What in `list` should pop up now (ui/LiveToasts.tsx): unread, not seen by the caller before, and
 * recent, so a backlog from while Discord was closed never floods the corner. Oldest first, the order
 * they happened in.
 */
export function freshArrivals(list: EviNotification[], seen: ReadonlySet<string>, now = Date.now()): EviNotification[] {
    return list.filter(n => !n.read && !seen.has(n.id) && now - n.at <= FRESH_FOR).sort((a, b) => a.at - b.at);
}
