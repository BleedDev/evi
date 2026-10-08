/** What the page side, the main-process side and the toast window say to each other */

export type Corner = "bottom-right" | "bottom-left" | "top-right" | "top-left";
export type Screen = "discord" | "primary" | "cursor";
export type Theme = "light" | "dark";

/** Text the toast window shows, already in Discord's language: the window itself has none */
export interface ToastLabels {
    open: string;
    close: string;
    reply: string;
    placeholder: string;
    send: string;
    sending: string;
    sent: string;
    failed: string;
}

export interface ToastPayload {
    id: string;
    /** https image from Discord's CDN or a data: URL; anything else is dropped */
    avatar?: string;
    /** The server's icon, shown small on the avatar */
    badge?: string;
    title: string;
    /** "#channel · Server", "Direct message"... */
    context?: string;
    body: string;
    canReply: boolean;
    theme: Theme;
    /** How long it stays, in ms; hovering pauses it */
    duration: number;
    labels: ToastLabels;
}

export interface Placement {
    corner: Corner;
    screen: Screen;
    maxVisible: number;
}

/** What happened in the toast window, handed to the page side through nextAction */
export type ToastAction =
    | { kind: "click"; id: string; }
    | { kind: "reply"; id: string; text: string; }
    | { kind: "closed"; id: string; };

/** Main process -> toast window */
export type ToastCommand =
    | { type: "show"; toast: ToastPayload; corner: Corner; maxVisible: number; }
    | { type: "dismiss"; id: string; }
    | { type: "replyResult"; id: string; ok: boolean; }
    | { type: "clear"; };

/** Toast window -> main process */
export type ToastMessage =
    | { type: "ready"; }
    | { type: "pointer"; inside: boolean; }
    | { type: "typing"; active: boolean; }
    | { type: "empty"; }
    | { type: "action"; action: ToastAction; };

export const IMAGE_HOSTS = ["cdn.discordapp.com", "media.discordapp.net", "discord.com"];

/** Only Discord's image hosts over https, or inline images */
export function safeImage(url: unknown): string | undefined {
    if (typeof url !== "string" || !url) return undefined;
    if (/^data:image\/(png|jpe?g|webp|gif);base64,[a-z0-9+/=]+$/i.test(url)) return url;
    try {
        const u = new URL(url);
        return u.protocol === "https:" && IMAGE_HOSTS.includes(u.hostname) ? u.href : undefined;
    } catch {
        return undefined;
    }
}
