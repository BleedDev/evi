import { definePlugin, filters, find, findStore } from "@evi/api";
import type { PluginContext } from "@evi/api";

import { type Action, MAX_RECENT, type Status, STATUSES, type TrayData } from "./menu";
import { t } from "./strings";

/**
 * The page's half: tells native.ts what to put in Discord's tray menu (labels in Discord's language,
 * your status, recent DMs, mute and deafen), and does what a click there asks for: set a status or
 * open a DM. Mute and Deafen are handled in the main process with Discord's own tray messages.
 */

type Settings = typeof settings;
const settings = {
    voice: { type: "boolean", get label() { return t("settings.voice"); }, get description() { return t("settings.voice.description"); }, default: true },
    status: { type: "boolean", get label() { return t("settings.status"); }, get description() { return t("settings.status.description"); }, default: true },
    recent: { type: "boolean", get label() { return t("settings.recent"); }, get description() { return t("settings.recent.description"); }, default: true },
    recentCount: { type: "number", get label() { return t("settings.recentCount"); }, default: 5, min: 1, max: MAX_RECENT, step: 1 },
} as const;

/** Stores whose changes can change the menu */
const WATCHED = ["PrivateChannelSortStore", "SelfPresenceStore", "UserSettingsProtoStore", "MediaEngineStore", "RelationshipStore"];

const PRELOADED = "discord_protos.discord_users.v1.PreloadedUserSettings";

function currentStatus(): Status | null {
    const status = findStore("SelfPresenceStore")?.getStatus?.() ?? findStore("UserSettingsProtoStore")?.settings?.status?.status?.value;
    return STATUSES.includes(status) ? status : null;
}

function userName(id: string | undefined) {
    if (!id) return undefined;
    const user = findStore("UserStore")?.getUser?.(id);
    return findStore("RelationshipStore")?.getNickname?.(id) || user?.globalName || user?.username;
}

/** Newest first, like Discord's DM list: DMs by the other person's name, groups by theirs or their people */
function recentDms(count: number) {
    const ids: string[] = findStore("PrivateChannelSortStore")?.getPrivateChannelIds?.() ?? [];
    const channels = findStore("ChannelStore");
    const out: { id: string; name: string; }[] = [];
    for (const id of ids) {
        if (out.length >= count) break;
        const channel = channels?.getChannel?.(id);
        if (!channel) continue;
        let name: string | undefined;
        if (channel.type === 1) {
            name = userName(channel.getRecipientId?.() ?? channel.recipients?.[0]);
        } else if (channel.type === 3) {
            name = channel.name || (channel.recipients ?? []).map(userName).filter(Boolean).join(", ");
        }
        if (name) out.push({ id, name });
    }
    return out;
}

function gather(ctx: PluginContext<Settings>): TrayData {
    const media = findStore("MediaEngineStore");
    const values = ctx.settings.snapshot();
    return {
        labels: {
            mute: t("menu.mute"),
            deafen: t("menu.deafen"),
            status: t("menu.status"),
            online: t("menu.online"),
            idle: t("menu.idle"),
            dnd: t("menu.dnd"),
            invisible: t("menu.invisible"),
            recent: t("menu.recent"),
        },
        show: { voice: values.voice, status: values.status, recent: values.recent },
        status: currentStatus(),
        selfMute: media?.isSelfMute?.() === true,
        selfDeaf: media?.isSelfDeaf?.() === true,
        recent: values.recent ? recentDms(Math.min(Math.max(1, Math.round(values.recentCount)), MAX_RECENT)) : [],
    };
}

/** Discord's own "set status" (the one its status picker uses), or the same writes by hand */
async function setStatus(status: Status) {
    const own = find(filters.byCode("nextStatus", "statusCreatedAtMs", "statusExpiresAtMs"));
    if (typeof own === "function") {
        await own({ nextStatus: status, disableTracking: true });
        return;
    }
    const creators = find(v => typeof v?.updateAsync === "function" && v?.ProtoClass?.typeName === PRELOADED);
    if (!creators) throw new Error("Couldn't find Discord's user settings updater");
    const group = creators.ProtoClass.fields?.find((f: any) => f.name === "status")?.T?.();
    const field = (name: string) => group?.fields?.find((f: any) => f.localName === name)?.T?.();
    const stringValue = field("status");
    const createdAt = field("statusCreatedAtMs");
    const previous = currentStatus();
    const now = `${Date.now()}`;
    await creators.updateAsync("status", (s: any) => {
        s.status = stringValue?.create?.({ value: status }) ?? { value: status };
        s.statusExpiresAtMs = "0";
        if (previous !== status || !s.statusCreatedAtMs) s.statusCreatedAtMs = createdAt?.create?.({ value: now }) ?? { value: now };
    }, 0);
}

function openChannel(channelId: string) {
    const transitionTo = find(filters.byCode("transitionTo - Transitioning to"));
    if (typeof transitionTo === "function") transitionTo(`/channels/@me/${channelId}`);
}

async function handle(ctx: PluginContext<Settings>, action: Action) {
    if (action.type === "status") {
        if (!STATUSES.includes(action.status)) return;
        try {
            await setStatus(action.status);
        } catch (err) {
            ctx.logger.error("Couldn't set status", err);
            ctx.toast(t("toast.statusFailed"), { type: "failure" });
        }
    } else if (action.type === "open" && /^\d+$/.test(action.channelId)) {
        openChannel(action.channelId);
    }
}

export default definePlugin({
    settings,

    start(ctx) {
        // Discord's popout windows share the page's stores: the main window speaks for the tray
        if (location.pathname.startsWith("/popout")) return;

        let alive = true;
        ctx.onDispose(() => void (alive = false));

        let sent = "";
        let timer: ReturnType<typeof setTimeout> | undefined;
        const push = () => {
            timer = undefined;
            if (!alive) return;
            const data = gather(ctx);
            const json = JSON.stringify(data);
            if (json === sent) return;
            sent = json;
            ctx.native.call("update", data).catch(err => {
                sent = "";
                ctx.logger.warn("Couldn't update the tray menu", err);
            });
        };
        const schedule = () => void (timer ??= setTimeout(push, 300));
        ctx.onDispose(() => clearTimeout(timer));

        for (const name of WATCHED) {
            const store = findStore(name);
            store?.addChangeListener?.(schedule);
            ctx.onDispose(() => store?.removeChangeListener?.(schedule));
        }
        ctx.settings.onChange(schedule);
        // Names and the DM list fill in once Discord has connected
        ctx.flux.subscribe("CONNECTION_OPEN", schedule);
        push();

        void (async () => {
            const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
            while (alive) {
                let action: Action | null;
                try {
                    action = await ctx.native.call<Action | null>("nextAction");
                } catch {
                    // Turned off, or the main process is restarting the plugin
                    await sleep(5000);
                    continue;
                }
                if (!alive) break;
                if (!action) {
                    await sleep(1000);
                    continue;
                }
                await handle(ctx, action);
            }
        })();
    },
});
