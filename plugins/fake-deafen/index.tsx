import { definePlugin, filters, findStore, getStore } from "@evi/api";
import type { PluginContext } from "@evi/api";

import { t } from "./strings";

import { fakeFlags, fakeState, PATCHES } from "./voice";
import type { ResendResult, VoiceState } from "./voice";

/**
 * Appear deafened (and muted) to everyone else while still hearing them.
 *
 *  - A `before` hook on the gateway socket's voiceStateUpdate (GatewayConnectionStore.getSocket(),
 *    one socket for the whole session) rewrites selfDeaf/selfMute while fake deafen is on.
 *  - Toggling resends the real state through that hook right away: through Discord's own voice
 *    state committer (captured by a source patch) when it has it, or by repeating the last call the
 *    hook saw. The committer's module runs at startup, so after turning the plugin on mid-session
 *    only the second works, and only once Discord has sent something (mute, deafen, join).
 *  - Your own rows in voice channels show you faked too (a source patch on the local state Discord
 *    merges into your voice state), so you see what everyone else sees.
 *  - Its switch sits in the user panel, while the showButton setting is on.
 *
 * Fake deafen itself isn't saved: it starts off with every Discord launch, so nobody stays
 * "deafened" by accident. Stopping the plugin resends the real state.
 */

interface GatewaySocket {
    voiceStateUpdate(state: VoiceState): void;
}

interface VoiceCommitter {
    readonly channelId: string | null;
    forceUpdate(): void;
}

type Settings = typeof settings;
const settings = {
    deafen: { type: "boolean", get label() { return t("settings.deafen"); }, get description() { return t("settings.deafen.description"); }, default: true },
    mute: { type: "boolean", get label() { return t("settings.mute"); }, get description() { return t("settings.mute.description"); }, default: true },
    showButton: { type: "boolean", get label() { return t("settings.showButton"); }, get description() { return t("settings.showButton.description"); }, default: true },
    shortcut: { type: "keybind", get label() { return t("settings.shortcut"); }, get description() { return t("settings.shortcut.description"); }, default: "" },
} as const;

let context: PluginContext<Settings> | undefined;
let socket: GatewaySocket | undefined;
/** Discord's voice state committer, handed over by the source patch */
let committer: VoiceCommitter | undefined;
/** The last voice state Discord sent, before our rewrite */
let lastReal: VoiceState | undefined;
let enabled = false;

const listeners = new Set<() => void>();
function setEnabled(value: boolean) {
    enabled = value;
    for (const listener of listeners) listener();
    redrawOwnState();
}

/** Your rows in voice channels read your local state through MediaEngineStore: a change there redraws them */
function redrawOwnState() {
    findStore<{ emitChange?(): void; }>("MediaEngineStore")?.emitChange?.();
}
function subscribe(onChange: () => void) {
    listeners.add(onChange);
    return () => void listeners.delete(onChange);
}

/** Sends the real voice state again, through our hook */
function resend(): ResendResult {
    if (committer && socket) {
        if (committer.channelId == null) return "idle";
        committer.forceUpdate();
        return "sent";
    }
    if (socket && lastReal?.channelId != null) {
        socket.voiceStateUpdate({ ...lastReal });
        return "sent";
    }
    return getStore("SelectedChannelStore")?.getVoiceChannelId?.() ? "pending" : "idle";
}

const TOASTS = { sent: "toast.on", idle: "toast.onIdle", pending: "toast.onPending" } as const;

function toggle() {
    if (!context) return;
    if (!socket) {
        context.toast(t("toast.failed"), { type: "failure" });
        return;
    }
    setEnabled(!enabled);
    let result: ResendResult;
    try {
        result = resend();
    } catch (err) {
        context.logger.error("Couldn't resend the voice state", err);
        context.toast(t("toast.failed"), { type: "failure" });
        return;
    }
    context.toast(t(enabled ? TOASTS[result] : "toast.off"), { type: "success" });
}

interface IconProps { width?: number; height?: number; }

/** A ghost: you "appear" deafened. Its own shape, so it isn't mistaken for Discord's deafen button */
const GHOST = "M12 2.5a8 8 0 0 0-8 8V21a.75.75 0 0 0 1.28.53L7.25 19.56l2.22 2.22a.75.75 0 0 0 1.06 0L12 20.31l1.47 1.47a.75.75 0 0 0 1.06 0l2.22-2.22 1.97 1.97A.75.75 0 0 0 20 21V10.5a8 8 0 0 0-8-8ZM9 9a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3Zm6 0a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3Z";

function GhostIcon({ width = 20, height = 20 }: IconProps) {
    return (
        <svg width={width} height={height} viewBox="0 0 24 24" aria-hidden="true">
            <path fill="currentColor" fillRule="evenodd" d={GHOST} />
        </svg>
    );
}

/** On: red like Discord's own deafen icon when you're deafened */
function GhostIconOn(props: IconProps) {
    return <span className="dl-fake-deafen-on"><GhostIcon {...props} /></span>;
}

/** Its switch in the user panel, while the showButton setting is on */
function panelSwitch(ctx: PluginContext<Settings>) {
    let remove: (() => void) | undefined;
    const sync = () => {
        const want = ctx.settings.get("showButton");
        if (want && !remove) {
            remove = ctx.panelToggle({
                label: () => t("panel.label"),
                tooltip: on => t(on ? "button.off" : "button.on"),
                icon: on => on ? GhostIconOn : GhostIcon,
                isChecked: () => enabled,
                subscribe,
                alert: on => on,
                toggle,
            });
        } else if (!want && remove) {
            remove();
            remove = undefined;
        }
    };
    sync();
    ctx.settings.onChange(sync);
}

export default definePlugin({
    settings,

    patches: [PATCHES.committer, PATCHES.localState],

    /** Called by the patched voice state committer's constructor */
    captureCommitter(value: unknown) {
        if (value && typeof (value as any).forceUpdate === "function") committer = value as VoiceCommitter;
    },

    /** Called by the patched local voice state: what your own rows show */
    localState<T extends { selfMute?: boolean; selfDeaf?: boolean; }>(state: T): T {
        if (!enabled || !context) return state;
        return fakeFlags(state, { deafen: context.settings.get("deafen"), mute: context.settings.get("mute") });
    },

    toggle,
    isEnabled: () => enabled,

    css: `
        .dl-fake-deafen-on { display: contents; color: var(--status-danger, #da373c); }
    `,

    start(ctx) {
        context = ctx;
        panelSwitch(ctx);

        ctx.waitFor<{ getSocket(): GatewaySocket | undefined; }>(filters.byStoreName("GatewayConnectionStore"), store => {
            const found = store.getSocket?.();
            if (typeof found?.voiceStateUpdate !== "function") {
                ctx.logger.error("GatewayConnectionStore has no socket with voiceStateUpdate");
                return;
            }
            socket = found;
            ctx.hook.before(found, "voiceStateUpdate", call => {
                const real = call.args[0] as VoiceState | undefined;
                if (!real || typeof real !== "object") return;
                lastReal = { ...real };
                if (enabled) call.args[0] = fakeState(real, { deafen: ctx.settings.get("deafen"), mute: ctx.settings.get("mute") });
            });
        });

        // Changing what to fake while it's on applies at once
        ctx.settings.onChange(() => {
            if (!enabled) return;
            resend();
            redrawOwnState();
        });

        ctx.onDispose(() => {
            const wasOn = enabled;
            setEnabled(false);
            // Let the server see the real state again. Runs whether or not our hook is still installed.
            if (wasOn) {
                try { resend(); } catch { /* the socket is gone with Discord */ }
            }
            context = undefined;
            socket = undefined;
            lastReal = undefined;
            // committer stays: its module only runs once, and a restarted plugin needs it again
        });

        ctx.keybind("shortcut", toggle);

        ctx.command({
            name: "fakedeafen",
            get description() { return t("command.description"); },
            execute: () => void toggle(),
        });
    },
});
