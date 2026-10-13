import { definePlugin, filters, find, findMenuGroup, getStore, Menu, React, useLocale } from "@evi/api";
import type { Filter, PluginContext } from "@evi/api";
import type { ComponentType, ReactElement, ReactNode } from "react";

import { canPopOut, channelOfKey, chatTitle, DM, windowKey } from "./chat";
import type { ChatChannel } from "./chat";
import { t } from "./strings";

/**
 * A chat in its own window, through Discord's popout windows (the ones a popped-out call uses).
 * Dispatching POPOUT_WINDOW_OPEN with a key and a render function makes PopoutWindowStore open
 * /popout and render it there with its own React root; Discord keeps each key's size and position.
 * What's rendered is what the call popout renders: Discord's PopoutWindow (title bar, theme, layers)
 * around ChannelChat, the message list and chat bar, with the chat input type of a call's chat.
 *
 * Discord only copies <link> stylesheets into its windows, and Evi's themes, Quick CSS and plugin
 * CSS are <style> elements, so each window mirrors those from the main window while it's open.
 *
 * The header button comes from export hooks: HeaderBarContainer (the main chat header, which gets
 * the channel id) and CallChatSidebar (a call's chat, the X in its header). Checked October 2026.
 */

/** Discord's PopoutWindow, which asserts the window exists */
const popoutWindowFilter = filters.componentByCode("Missing guestWindow reference");
/** The message list and chat bar of a channel, { channel, guild, chatInputType } */
const channelChatFilter = filters.componentByCode("location:\"ChannelChat\"");
/** The chat input configurations, { NORMAL, SIDEBAR, OVERLAY, ... } */
const inputTypesFilter = filters.byProps("SIDEBAR", "OVERLAY_INLINE_REPLY");
/** Dropping files on the chat, { channel, draftType } */
const uploadAreaFilter = filters.componentByCode(/\{className:[\w$]+,style:[\w$]+,channel:[\w$]+,draftType:[\w$]+\}=/, "ATTACH_FILES");
/** The page header: { channelId, guildId, toolbar, ... }, with Icon, ChannelIcon and Title as statics */
const headerFilter = filters.componentByCode("isAuthenticated", "HEADER_BAR");
/** A call's chat panel, { channel, guild, maxWidth } */
const callChatFilter = filters.componentByCode("CallChatSidebar", "updateChatOpen");

const WINDOW_SIZE = { defaultWidth: 440, defaultHeight: 720 };
/** DraftType.ChannelMessage */
const CHANNEL_MESSAGE_DRAFT = 0;

type Settings = typeof settings;
const settings = {
    headerButton: {
        type: "boolean",
        get label() { return t("settings.headerButton"); },
        get description() { return t("settings.headerButton.description"); },
        default: true,
    },
    shortcut: {
        type: "keybind",
        get label() { return t("settings.shortcut"); },
        get description() { return t("settings.shortcut.description"); },
        default: "",
    },
} as const;

let context: PluginContext<Settings> | undefined;
let header: any;

/** A webpack lookup kept once found; a miss is searched again at most every 10 seconds */
function lookup<T>(filter: Filter): () => T | undefined {
    let value: T | undefined;
    let missedAt = -Infinity;
    return () => {
        if (value !== undefined || performance.now() - missedAt < 10_000) return value;
        value = find<T>(filter);
        if (value === undefined) missedAt = performance.now();
        return value;
    };
}

const getPopoutWindow = lookup<ComponentType<any>>(popoutWindowFilter);
const getChannelChat = lookup<ComponentType<any>>(channelChatFilter);
const getInputTypes = lookup<Record<string, unknown>>(inputTypesFilter);
const getUploadArea = lookup<ComponentType<any>>(uploadAreaFilter);

function svgIcon(paths: string[]) {
    // Called like Discord's icons: { width, height, color, className, colorClass, ... }
    return function Icon({ width = 24, height = 24, color, className, colorClass }: any) {
        const fill = typeof color === "string" ? color : color?.css ?? "currentColor";
        return (
            <svg width={width} height={height} viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
                {paths.map(d => <path key={d} d={d} fill={fill} className={colorClass} />)}
            </svg>
        );
    };
}

// Discord's WindowLaunchIcon and ChatIcon
const PopOutIcon = svgIcon([
    "M15 2a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v6a1 1 0 1 1-2 0V4.41l-4.3 4.3a1 1 0 1 1-1.4-1.42L19.58 3H16a1 1 0 0 1-1-1Z",
    "M5 2a3 3 0 0 0-3 3v14a3 3 0 0 0 3 3h14a3 3 0 0 0 3-3v-6a1 1 0 1 0-2 0v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h6a1 1 0 1 0 0-2H5Z",
]);
const ChatIcon = svgIcon(["M12 22a10 10 0 1 0-8.45-4.64c.13.19.11.44-.04.61l-2.06 2.37A1 1 0 0 0 2.2 22H12Z"]);

/** A value read from a Flux store, re-read when the store changes */
function useStore<T>(name: string, read: (store: any) => T): T {
    const subscribe = React.useCallback((onChange: () => void) => {
        const store = getStore(name);
        store?.addChangeListener?.(onChange);
        return () => store?.removeChangeListener?.(onChange);
    }, [name]);
    return React.useSyncExternalStore(subscribe, () => read(getStore(name)));
}

const getChannel = (id: string): any => getStore("ChannelStore")?.getChannel?.(id);
const titleOf = (channel: ChatChannel) => chatTitle(channel, id => getStore("UserStore")?.getUser?.(id));

function closeWindow(key: string) {
    context?.flux.dispatch({ type: "POPOUT_WINDOW_CLOSE", key });
}

function popOut(channel: ChatChannel) {
    if (!context) return;
    if (!getPopoutWindow() || !getChannelChat() || !getInputTypes()) {
        context.toast(t("toast.unavailable"), { type: "failure" });
        return;
    }
    const channelId = channel.id;
    // An open window is brought to the front instead
    context.flux.dispatch({
        type: "POPOUT_WINDOW_OPEN",
        key: windowKey(channelId),
        features: { menubar: false, toolbar: false, location: false, directories: false, ...WINDOW_SIZE },
        render: (key: string) => <ChatWindow windowKey={key} channelId={channelId} />,
    });
}

function popOutSelected() {
    const channel = getChannel(getStore("SelectedChannelStore")?.getChannelId?.() ?? "");
    if (canPopOut(channel)) popOut(channel);
    else context?.toast(t("toast.noChat"));
}

/**
 * Keeps copies of the main window's <style> elements at the end of the popout's <head>, in the same
 * order, updated as themes, Quick CSS and plugins change them.
 */
function mirrorStyles(win: Window) {
    const copies = new Map<HTMLStyleElement, HTMLStyleElement>();
    let order: HTMLStyleElement[] = [];

    const sync = () => {
        const head = win.document?.head;
        if (!head) return;
        const next = Array.from(document.head.querySelectorAll("style"), style => {
            let copy = copies.get(style);
            if (!copy) copies.set(style, copy = win.document.createElement("style"));
            if (copy.textContent !== style.textContent) copy.textContent = style.textContent;
            if (copy.media !== style.media) copy.media = style.media;
            return copy;
        });
        const kept = new Set(next);
        for (const [style, copy] of copies) {
            if (kept.has(copy)) continue;
            copy.remove();
            copies.delete(style);
        }
        // Moving a stylesheet restyles the window, so only when one came or the order changed
        if (next.length !== order.length || next.some((copy, i) => copy !== order[i] || !copy.isConnected)) head.append(...next);
        order = next;
    };

    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.head, { childList: true, subtree: true, characterData: true });
    return () => {
        observer.disconnect();
        for (const copy of copies.values()) copy.remove();
        copies.clear();
    };
}

function ChatWindow({ windowKey: key, channelId }: { windowKey: string; channelId: string; }) {
    useLocale();
    const channel = useStore("ChannelStore", store => store?.getChannel?.(channelId));
    const guild = useStore("GuildStore", store => channel?.guild_id ? store?.getGuild?.(channel.guild_id) ?? null : null);

    React.useLayoutEffect(() => {
        const win: Window | undefined = getStore("PopoutWindowStore")?.getWindow?.(key);
        return win ? mirrorStyles(win) : undefined;
    }, [key]);

    // Deleted, or no longer visible to you
    const gone = !canPopOut(channel);
    React.useEffect(() => void (gone && closeWindow(key)), [gone, key]);

    const PopoutWindow = getPopoutWindow();
    const ChannelChat = getChannelChat();
    const UploadArea = getUploadArea();
    const Header = header;
    if (gone || !PopoutWindow || !ChannelChat) return null;

    const title = titleOf(channel);
    return (
        <PopoutWindow windowKey={key} title={title} channelId={channel.id} withTitleBar>
            <div className="evi-pop-out-chat">
                {UploadArea && <UploadArea channel={channel} draftType={CHANNEL_MESSAGE_DRAFT} />}
                {Header && (
                    <Header aria-label={title}>
                        <Header.ChannelIcon icon={ChatIcon} aria-hidden />
                        <Header.Title>{title}</Header.Title>
                    </Header>
                )}
                <div className="evi-pop-out-chat-body">
                    <ChannelChat key={channel.id} channel={channel} guild={guild} chatInputType={getInputTypes()?.SIDEBAR} />
                </div>
            </div>
        </PopoutWindow>
    );
}

/** Lit while the chat's window is open; clicking it then brings the window to the front */
function PopOutButton({ channel }: { channel: ChatChannel; }) {
    useLocale();
    const key = windowKey(channel.id);
    const open = useStore("PopoutWindowStore", store => !!store?.getWindowOpen?.(key));
    const Icon = header?.Icon;
    if (!Icon) return null;
    const label = t(open ? "button.show" : "button.popOut");
    return <Icon icon={PopOutIcon} tooltip={label} aria-label={label} selected={open} onClick={() => popOut(channel)} />;
}

function menuItem(channel: ChatChannel) {
    return <Menu.Item id="evi-pop-out-chat" label={t("menu.popOut")} action={() => popOut(channel)} />;
}

/** Next to Discord's own read and pin items, when the menu has them */
function addMenuItem(children: ReactNode[], channel: ChatChannel) {
    const group = ["mark-channel-read", "mark-read", "pin-dm", "pin-channel", "pin-thread", "close-dm"]
        .map(id => findMenuGroup(children, id))
        .find(Boolean);
    (group ?? children).push(menuItem(channel));
}

export default definePlugin({
    settings,

    css: `
        .evi-pop-out-chat { display: flex; flex: 1 1 auto; flex-direction: column; height: 100%; min-height: 0; min-width: 0; position: relative;
            background: var(--background-gradient-chat, var(--background-base-lowest)); }
        .evi-pop-out-chat-body { display: flex; flex: 1 1 auto; flex-direction: column; min-height: 0; min-width: 0; position: relative; }
    `,

    start(ctx) {
        context = ctx;
        ctx.onDispose(() => {
            // The windows render this plugin's components: they close with it
            for (const key of getStore("PopoutWindowStore")?.getWindowKeys?.() ?? []) {
                if (channelOfKey(key)) closeWindow(key);
            }
            context = undefined;
            header = undefined;
        });

        ctx.waitFor(headerFilter, value => void (header = value));

        // The chat header: Discord's buttons, then this one, then the search bar
        ctx.hookExport("before", headerFilter, call => {
            const props = call.args[0];
            if (!props?.channelId || props.toolbar == null || !ctx.settings.get("headerButton")) return;
            const channel = getChannel(props.channelId);
            if (!canPopOut(channel)) return;
            call.args[0] = { ...props, toolbar: <>{props.toolbar}<PopOutButton channel={channel} /></> };
        });

        // A call's chat: before its close button. It renders [upload area, header, chat]
        ctx.hookExport("after", callChatFilter, ({ args, result }) => {
            const channel = args[0]?.channel;
            const children = (result as ReactElement<any> | null)?.props?.children;
            if (!ctx.settings.get("headerButton") || !canPopOut(channel) || !Array.isArray(children)) return;
            const index = children.findIndex(child => child?.props?.toolbar !== undefined);
            if (index < 0) return;
            const bar = children[index];
            const next = [...children];
            next[index] = React.cloneElement(bar, { toolbar: <><PopOutButton channel={channel} />{bar.props.toolbar}</> });
            return React.cloneElement(result, undefined, ...next);
        });

        ctx.contextMenu(["channel-context", "thread-context", "gdm-context"], (children, props) => {
            if (canPopOut(props.channel)) addMenuItem(children, props.channel);
        });
        // A DM in the list or its header: the menu is the other person's, with the DM as its channel
        ctx.contextMenu("user-context", (children, props) => {
            if (props.channel?.type === DM && canPopOut(props.channel)) addMenuItem(children, props.channel);
        });

        ctx.keybind("shortcut", popOutSelected);
    },

    popOut,
});
