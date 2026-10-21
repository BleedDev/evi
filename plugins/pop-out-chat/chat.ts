/**
 * What a chat window is about, without Discord or the DOM: which channels have a chat to pop out,
 * the window key Discord's popout manager gets, the title it shows, and which styles it leaves out.
 */

/** Channel types whose page is Discord's chat: text, DMs, voice and stage text chat, announcements, threads */
const CHAT_TYPES = new Set([
    0, // GUILD_TEXT
    1, // DM
    2, // GUILD_VOICE
    3, // GROUP_DM
    5, // GUILD_ANNOUNCEMENT
    10, // ANNOUNCEMENT_THREAD
    11, // PUBLIC_THREAD
    12, // PRIVATE_THREAD
    13, // GUILD_STAGE_VOICE
]);

export const DM = 1;
export const GROUP_DM = 3;

export interface ChatChannel {
    id: string;
    type: number;
    name?: string;
    recipients?: string[];
}

export interface ChatUser {
    username?: string;
    globalName?: string | null;
}

/** Forums, media channels, categories and directories have no chat of their own */
export function canPopOut(channel: { id?: unknown; type?: unknown; } | null | undefined): channel is ChatChannel {
    return typeof channel?.id === "string" && channel.id !== "" && typeof channel.type === "number" && CHAT_TYPES.has(channel.type);
}

/**
 * Discord's desktop app only opens popout windows whose name starts with DISCORD_, and keeps each
 * key's size and position, so every chat gets its own and opens where it was left.
 */
const KEY_PREFIX = "DISCORD_EVI_CHAT_";

export const windowKey = (channelId: string) => KEY_PREFIX + channelId;

/** The channel of one of our windows, or undefined for any other window */
export function channelOfKey(key: string) {
    if (!key.startsWith(KEY_PREFIX)) return undefined;
    const id = key.slice(KEY_PREFIX.length);
    return /^\d+$/.test(id) ? id : undefined;
}

const nameOf = (user: ChatUser | undefined) => user?.globalName || user?.username || "";

/** What the window and its header are called: the person for a DM, the group's name or members, #channel otherwise */
export function chatTitle(channel: ChatChannel, getUser: (id: string) => ChatUser | undefined) {
    if (channel.type === DM) return nameOf(getUser(channel.recipients?.[0] ?? ""));
    if (channel.type === GROUP_DM) {
        if (channel.name) return channel.name;
        return (channel.recipients ?? []).map(id => nameOf(getUser(id))).filter(Boolean).join(", ");
    }
    if (!channel.name) return "";
    // Like Discord's own headers: a # for text and announcement channels, none for voice, stage and threads
    return channel.type === 0 || channel.type === 5 ? `#${channel.name}` : channel.name;
}

/**
 * The main window's styles a chat window doesn't copy: the wallpaper's, which only goes with the
 * wallpaper behind Discord's main window. Themes and Quick CSS are copied though Evi also copies them
 * into every popout (src/renderer/popoutStyles.ts): Evi's copies go in before Discord's stylesheets,
 * these after them, as in the main window, so a theme rule as specific as Discord's still wins.
 */
export const mainWindowOnly = (id: string) => id === "evi-wallpaper-style";
