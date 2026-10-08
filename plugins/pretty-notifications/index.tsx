import { Components, definePlugin, filters, find, findStore, React, useLocale } from "@evi/api";
import type { HookContext, PluginContext } from "@evi/api";

import type { Corner, Placement, Screen, ToastAction, ToastLabels, ToastPayload } from "./shared";
import { safeImage } from "./shared";
import { t } from "./strings";

/**
 * Discord decides whether a notification happens (muted channels, Do Not Disturb, a focused chat,
 * its own notification settings) before it calls its low-level showNotification; this plugin only
 * changes how the ones that get through look. Whatever Discord would hold back at that last step
 * (streamer mode, a fullscreen game or Focus assist, notifications with buttons) goes to Discord's
 * own code untouched, and so does anything that fails on the way to the toast window.
 */

type Settings = typeof settings;
type Ctx = PluginContext<Settings>;

const settings = {
    corner: {
        type: "select",
        get label() { return t("settings.corner"); },
        get description() { return t("settings.corner.description"); },
        default: "bottom-right" as Corner,
        get options() {
            return [
                { label: t("corner.bottomRight"), value: "bottom-right" as Corner },
                { label: t("corner.bottomLeft"), value: "bottom-left" as Corner },
                { label: t("corner.topRight"), value: "top-right" as Corner },
                { label: t("corner.topLeft"), value: "top-left" as Corner },
            ];
        },
    },
    screen: {
        type: "select",
        get label() { return t("settings.screen"); },
        get description() { return t("settings.screen.description"); },
        default: "discord" as Screen,
        get options() {
            return [
                { label: t("screen.discord"), value: "discord" as Screen },
                { label: t("screen.primary"), value: "primary" as Screen },
                { label: t("screen.cursor"), value: "cursor" as Screen },
            ];
        },
    },
    duration: {
        type: "number",
        get label() { return t("settings.duration"); },
        get description() { return t("settings.duration.description"); },
        default: 6, min: 2, max: 30, step: 1,
    },
    maxVisible: {
        type: "number",
        get label() { return t("settings.maxVisible"); },
        get description() { return t("settings.maxVisible.description"); },
        default: 3, min: 1, max: 6, step: 1,
    },
    showText: {
        type: "boolean",
        get label() { return t("settings.showText"); },
        get description() { return t("settings.showText.description"); },
        default: true,
    },
    reply: {
        type: "boolean",
        get label() { return t("settings.reply"); },
        get description() { return t("settings.reply.description"); },
        default: true,
    },
    others: {
        type: "boolean",
        get label() { return t("settings.others"); },
        get description() { return t("settings.others.description"); },
        default: true,
    },
    overFullscreen: {
        type: "boolean",
        get label() { return t("settings.overFullscreen"); },
        get description() { return t("settings.overFullscreen.description"); },
        default: false,
    },
} as const;

/** What a shown toast needs once it's clicked or replied to */
interface Entry {
    options: Record<string, any>;
    channelId?: string;
    guildId?: string;
    messageId?: string;
    test?: boolean;
}

const MAX_ENTRIES = 100;
const entries = new Map<string, Entry>();
let generation = 0;
let seq = 0;

const notificationUtil = filters.byProps("showNotification", "playNotificationSound", "requestPermission");

const store = (name: string): any => findStore(name);

let nativeWrapper: any;
/** Discord's wrapper around its desktop app: shouldDisplayNotifications, flashFrame, focus... */
const desktop = (): any => nativeWrapper ??= find(filters.byProps("shouldDisplayNotifications", "flashFrame"));

const theme = () => document.documentElement.classList.contains("theme-light") ? "light" as const : "dark" as const;

/** Discord passes some icons as paths on its own host */
function absolute(url: unknown): string | undefined {
    if (typeof url !== "string" || !url) return undefined;
    try {
        return safeImage(new URL(url, "https://discord.com").href);
    } catch {
        return undefined;
    }
}

function labels(name: string): ToastLabels {
    return {
        open: t("label.open"),
        close: t("label.close"),
        reply: t("label.reply"),
        placeholder: t("label.placeholder", { name }),
        send: t("label.send"),
        sending: t("label.sending"),
        sent: t("label.sent"),
        failed: t("label.failed"),
    };
}

function placement(ctx: Ctx): Placement {
    return { corner: ctx.settings.get("corner"), screen: ctx.settings.get("screen"), maxVisible: ctx.settings.get("maxVisible") };
}

function displayName(user: any, guildId: string | undefined, fallback: string): string {
    if (!user) return fallback;
    return (guildId && store("GuildMemberStore")?.getNick?.(guildId, user.id))
        || store("RelationshipStore")?.getNickname?.(user.id)
        || user.globalName || user.global_name || user.username || fallback;
}

/** "#general · Server", "Direct message" or the group's name */
function contextLine(channel: any, guild: any): string | undefined {
    if (guild) return channel?.name ? `#${channel.name} · ${guild.name}` : guild.name;
    if (!channel) return undefined;
    if (channel.type === 3) return channel.name || t("context.group");
    return t("context.dm");
}

type Kind = "message" | "other";

/** Whether this one is ours to show, given everything Discord's own showNotification checks last */
function kindOf(ctx: Ctx, tracking: Record<string, any>, options: Record<string, any>): Kind | null {
    const kind: Kind | null = tracking.notif_type === "MESSAGE_CREATE" ? "message" : ctx.settings.get("others") ? "other" : null;
    if (!kind) return null;
    // Buttons on the notification (calls, for example) stay with Discord
    if (Array.isArray(options.actions) && options.actions.length) return null;
    if (store("StreamerModeStore")?.disableNotifications && options.overrideStreamerMode == null) return null;
    if (!ctx.settings.get("overFullscreen")) {
        const shouldShow = desktop()?.shouldDisplayNotifications;
        if (typeof shouldShow === "function" && shouldShow.call(desktop()) === false) return null;
    }
    return kind;
}

function buildToast(ctx: Ctx, kind: Kind, icon: unknown, title: string, body: string, tracking: Record<string, any>): { toast: ToastPayload; entry: Omit<Entry, "options">; } {
    const id = `${tracking.message_id ?? "n"}-${++seq}`;
    const duration = ctx.settings.get("duration") * 1000;
    const showText = ctx.settings.get("showText");

    if (kind === "other") {
        const name = String(title ?? "");
        return {
            toast: { id, avatar: absolute(icon), title: name, body: showText ? String(body ?? "") : t("body.hidden"), canReply: false, theme: theme(), duration, labels: labels(name) },
            entry: {},
        };
    }

    const channelId: string | undefined = tracking.channel_id;
    const channel = channelId ? store("ChannelStore")?.getChannel?.(channelId) : null;
    const guildId: string | undefined = channel?.guild_id ?? tracking.guild_id ?? undefined;
    const guild = guildId ? store("GuildStore")?.getGuild?.(guildId) : null;
    const user = tracking.notif_user_id ? store("UserStore")?.getUser?.(tracking.notif_user_id) : null;
    const name = displayName(user, guildId, String(title ?? ""));
    const text = String(body ?? "").trim();

    let badge: string | undefined;
    try {
        badge = absolute(guild?.getIconURL?.(64, false));
    } catch { }

    return {
        toast: {
            id,
            avatar: absolute(icon),
            badge,
            title: name,
            context: contextLine(channel, guild),
            body: !showText ? t("body.hidden") : text || t("body.attachment"),
            canReply: ctx.settings.get("reply") && !!channel && !!tracking.message_id,
            theme: theme(),
            duration,
            labels: labels(name),
        },
        entry: { channelId, guildId, messageId: tracking.message_id },
    };
}

function remember(id: string, entry: Entry) {
    entries.set(id, entry);
    if (entries.size > MAX_ENTRIES) entries.delete(entries.keys().next().value!);
}

function dismiss(ctx: Ctx, id: string) {
    entries.delete(id);
    ctx.native.call("dismiss", id).catch(() => { });
}

function intercept(ctx: Ctx, call: HookContext) {
    const [icon, title, body, tracking, options] = call.args as [unknown, string, string, Record<string, any> | undefined, Record<string, any> | undefined];
    const opts = options ?? {};
    let built: ReturnType<typeof buildToast> | null = null;
    try {
        const kind = kindOf(ctx, tracking ?? {}, opts);
        if (kind) built = buildToast(ctx, kind, icon, title, body, tracking ?? {});
    } catch (err) {
        ctx.logger.error("Couldn't build the notification, Discord shows its own", err);
    }
    if (!built) return call.callOriginal(...call.args);

    const { toast } = built;
    remember(toast.id, { ...built.entry, options: opts });

    // Discord's own sound and taskbar flash, the way its notification would have
    if (opts.sound != null) {
        try {
            void Promise.resolve(call.self?.playNotificationSound?.(opts.sound, opts.volume ?? 1, opts.soundpack)).catch(() => { });
        } catch { }
    }
    try {
        if (store("NotificationSettingsStore")?.taskbarFlash) desktop()?.flashFrame?.(true);
    } catch { }
    try {
        opts.onShown?.();
    } catch { }

    const fallback = (err?: unknown) => {
        if (err) ctx.logger.error("The notification window failed, Discord shows its own", err);
        entries.delete(toast.id);
        // The sound already played
        void Promise.resolve(call.original.call(call.self, icon, title, body, tracking, { ...opts, sound: undefined })).catch(() => { });
    };
    ctx.native.call<boolean>("show", toast, placement(ctx)).then(ok => ok || fallback()).catch(fallback);

    // What Discord's own showNotification resolves to: it closes the notification once you read the chat
    return Promise.resolve({ notification: { close: () => dismiss(ctx, toast.id) }, trackingProps: tracking });
}

let transition: ((path: string) => void) | undefined;
function navigate(path: string) {
    transition ??= find(filters.byCode("transitionTo - Transitioning to"));
    transition?.(path);
}

async function sendReply(entry: Entry, text: string) {
    const channel = store("ChannelStore")?.getChannel?.(entry.channelId);
    if (!channel || !entry.messageId) throw new Error("The chat isn't loaded");
    const actions = find(filters.byProps("sendMessage", "editMessage"));
    if (typeof actions?.sendMessage !== "function") throw new Error("Couldn't find Discord's message sending");
    // Discord's own parser turns :emoji: and mentions into what it would send from the chat bar
    const parser = find(filters.byProps("parse", "parsePreprocessor", "unparse"));
    const message = typeof parser?.parse === "function"
        ? parser.parse(channel, text)
        : { content: text, tts: false, invalidEmojis: [], validNonShortcutEmojis: [] };
    await actions.sendMessage(channel.id, message, false, {
        messageReference: { channel_id: channel.id, guild_id: channel.guild_id ?? undefined, message_id: entry.messageId },
        allowedMentions: { replied_user: true },
    });
}

async function handle(ctx: Ctx, action: ToastAction) {
    const entry = entries.get(action.id);
    if (action.kind === "closed") {
        entries.delete(action.id);
        return;
    }
    if (action.kind === "click") {
        entries.delete(action.id);
        if (!entry || entry.test) return;
        try {
            entry.options.onClick?.("");
        } catch (err) {
            ctx.logger.error("Discord's notification click failed", err);
        }
        // Straight to the message, not just its channel
        if (entry.channelId && entry.messageId) navigate(`/channels/${entry.guildId ?? "@me"}/${entry.channelId}/${entry.messageId}`);
        return;
    }
    // A reply
    let ok = false;
    if (entry?.test) ok = true;
    else if (entry) {
        try {
            await sendReply(entry, action.text);
            ok = true;
        } catch (err) {
            ctx.logger.error("Couldn't send the reply", err);
        }
    }
    if (ok) entries.delete(action.id);
    await ctx.native.call("replyResult", action.id, ok);
}

/** Clicks, replies and closes from the toast window, one at a time */
async function listen(ctx: Ctx, gen: number) {
    while (gen === generation) {
        let action: ToastAction | null;
        try {
            action = await ctx.native.call<ToastAction | null>("nextAction");
        } catch {
            if (gen !== generation) return;
            await new Promise(r => setTimeout(r, 3000));
            continue;
        }
        // null: the plugin stopped, or a newer copy of it took over
        if (!action || gen !== generation) return;
        try {
            await handle(ctx, action);
        } catch (err) {
            ctx.logger.error("Notification action failed", err);
        }
    }
}

async function showTest(ctx: Ctx): Promise<boolean> {
    const id = `test-${++seq}`;
    const name = t("test.title");
    remember(id, { options: {}, test: true });
    const toast: ToastPayload = {
        id,
        title: name,
        context: t("test.context"),
        body: t("test.body"),
        canReply: ctx.settings.get("reply"),
        theme: theme(),
        duration: ctx.settings.get("duration") * 1000,
        labels: labels(name),
    };
    try {
        return await ctx.native.call<boolean>("show", toast, placement(ctx));
    } catch (err) {
        ctx.logger.error("Test notification failed", err);
        return false;
    }
}

function TestPanel({ ctx }: { ctx: Ctx; }) {
    useLocale();
    const [failed, setFailed] = React.useState(false);
    const Button = Components.Button as any;
    const onClick = () => void showTest(ctx).then(ok => setFailed(!ok));
    return (
        <div>
            {Button
                ? <Button size={Button.Sizes?.SMALL} onClick={onClick}>{t("panel.test")}</Button>
                : <button type="button" className="dl-button" onClick={onClick}>{t("panel.test")}</button>}
            {failed && <p className="dl-hint" role="alert">{t("panel.testFailed")}</p>}
        </div>
    );
}

export default definePlugin({
    settings,
    settingsPanel: ctx => <TestPanel ctx={ctx} />,
    start(ctx) {
        const gen = ++generation;
        ctx.hookExport("instead", notificationUtil, "showNotification", call => intercept(ctx, call));
        void listen(ctx, gen);
        ctx.onDispose(() => {
            if (generation === gen) generation++;
        });
    },
    stop(ctx) {
        generation++;
        entries.clear();
        ctx.native.call("clear").catch(() => { });
        ctx.native.call("cancelWait").catch(() => { });
    },
});
