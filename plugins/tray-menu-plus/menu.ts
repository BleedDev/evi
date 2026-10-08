/**
 * What Tray Menu Plus adds to Discord's tray menu, as Electron menu templates. Pure: native.ts builds
 * the real menu from it, and tests check it without Electron.
 */

export const STATUSES = ["online", "idle", "dnd", "invisible"] as const;
export type Status = typeof STATUSES[number];

export const MAX_RECENT = 10;

export interface Labels {
    mute: string;
    deafen: string;
    status: string;
    online: string;
    idle: string;
    dnd: string;
    invisible: string;
    recent: string;
}

/** What the page tells the main process */
export interface TrayData {
    labels: Labels;
    show: { voice: boolean; status: boolean; recent: boolean; };
    status: Status | null;
    selfMute: boolean;
    selfDeaf: boolean;
    recent: { id: string; name: string; }[];
}

/** What a click asks the page to do */
export type Action =
    | { type: "status"; status: Status; }
    | { type: "open"; channelId: string; };

/** A click the main process handles itself */
export type Click = Action | { type: "mute"; } | { type: "deafen"; };

export interface Item {
    label?: string;
    type?: "normal" | "separator" | "checkbox" | "radio" | "submenu";
    checked?: boolean;
    enabled?: boolean;
    submenu?: Item[];
    click?: () => void;
}

/** Windows and Linux read "&" as a keyboard mnemonic; a name like "Tom & Jerry" must keep it */
export const escapeLabel = (label: string) => label.replace(/&/g, "&&");

/**
 * Our items, placed after Discord's app name at the top of its menu. Mute and Deafen only show while
 * not in a call: in one, Discord's own (with server mute and suppress) are already there.
 */
export function extraItems(data: TrayData, connected: boolean, click: (c: Click) => void): Item[] {
    const { labels, show } = data;
    const items: Item[] = [];
    if (show.status) {
        items.push({
            label: labels.status,
            type: "submenu",
            submenu: STATUSES.map(status => ({
                label: labels[status],
                type: "radio",
                checked: data.status === status,
                click: () => click({ type: "status", status }),
            })),
        });
    }
    if (show.recent && data.recent.length) {
        items.push({
            label: labels.recent,
            type: "submenu",
            submenu: data.recent.map(({ id, name }) => ({
                label: escapeLabel(name),
                click: () => click({ type: "open", channelId: id }),
            })),
        });
    }
    if (show.voice && !connected) {
        items.push(
            { label: labels.mute, type: "checkbox", checked: data.selfMute, click: () => click({ type: "mute" }) },
            { label: labels.deafen, type: "checkbox", checked: data.selfDeaf, click: () => click({ type: "deafen" }) },
        );
    }
    return items;
}

/** Discord's menu with ours after its first group (the app name, or "Open Discord" on Linux) */
export function mergeInto<T extends { type?: string; }>(discord: T[], ours: (T | Item)[]): (T | Item)[] {
    if (!ours.length) return discord;
    const firstSeparator = discord.findIndex(item => item.type === "separator");
    const at = firstSeparator === -1 ? discord.length : firstSeparator;
    return [...discord.slice(0, at), { type: "separator" }, ...ours, ...discord.slice(at)];
}

const isString = (v: unknown, max: number): v is string => typeof v === "string" && v.length > 0 && v.length <= max;

/** The page's data, checked: anything off is refused rather than shown */
export function parseTrayData(raw: unknown): TrayData | null {
    if (!raw || typeof raw !== "object") return null;
    const r = raw as Record<string, any>;
    const labels = r.labels;
    const keys: (keyof Labels)[] = ["mute", "deafen", "status", "online", "idle", "dnd", "invisible", "recent"];
    if (!labels || typeof labels !== "object" || !keys.every(k => isString(labels[k], 100))) return null;
    const show = r.show;
    if (!show || typeof show !== "object") return null;
    const recent = Array.isArray(r.recent) ? r.recent : [];
    return {
        labels: Object.fromEntries(keys.map(k => [k, labels[k]])) as unknown as Labels,
        show: { voice: show.voice === true, status: show.status === true, recent: show.recent === true },
        status: STATUSES.includes(r.status) ? r.status : null,
        selfMute: r.selfMute === true,
        selfDeaf: r.selfDeaf === true,
        recent: recent
            .filter((d: any) => d && /^\d{1,25}$/.test(d.id) && isString(d.name, 200))
            .slice(0, MAX_RECENT)
            .map((d: any) => ({ id: d.id, name: d.name.slice(0, 64) })),
    };
}
