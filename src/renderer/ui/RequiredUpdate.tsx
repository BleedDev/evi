/**
 * A required update (shared/required.ts): Evi's team said every Evi older than a version should
 * update. It never overrides the person's update settings. With automatic updates on, this Evi
 * downloads it straight away and says so in a calm banner, top and centre like announcements; once
 * it's downloaded Discord restarts by itself after a minute's countdown, which can be put off once,
 * but never while you're in a call (or streaming, which is a call too): then it waits for the call to
 * end. Quitting Discord before that installs it too. A failed download is said and tried again in half
 * an hour, never in a loop. With automatic updates off, the banner only says an update is needed and
 * nothing happens until "Update now".
 *
 * With `forcePlugins`, store plugins update as well, once per requirement, for people with plugin
 * auto-update on. Updates that ask for more access or full access still wait for the person's OK.
 */
import { mayForcePlugins, mayUpdateEviUnasked, mustUpdate, RequiredUpdate } from "@shared/required";

import { t, useLocale } from "../i18n";
import { Logger } from "../logger";
import { Native } from "../native";
import { SafeMode } from "../safeMode";
import { Settings } from "../settings";
import { Store } from "../store";
import { showToast } from "../toolkit/toasts";
import { findStore } from "../webpack/find";
import { Icon, IconButton, Text, useExit, useStore } from "./components";
import { mountRoot } from "./discordContext";
import { ensureStyles } from "./index";

const logger = new Logger("RequiredUpdate", "#f0b232");

/** Asked this often besides the live event, for a connection that missed it */
const EVERY = 60 * 60 * 1000;
const RETRY_AFTER = 30 * 60 * 1000;
const COUNTDOWN = 60;
/** "Later" puts the restart off this long, or until the call ends if one starts */
const LATER_FOR = 30 * 60 * 1000;

type Phase =
    | { kind: "idle"; }
    /** Automatic updates are off: say it's needed, and wait for "Update now" */
    | { kind: "asked"; }
    | { kind: "downloading"; }
    | { kind: "ready"; version: string; }
    | { kind: "restarting"; }
    | { kind: "failed"; error: string; };

let required: RequiredUpdate | null = null;
let phase: Phase = { kind: "idle" };
/** Hidden by the person (the X): shown again when there's something new to say */
let hidden = false;
let countdown = COUNTDOWN;
let postponedUntil = 0;
let usedLater = false;
let inCall = false;
let retryTimer: ReturnType<typeof setTimeout> | undefined;

const listeners = new Set<() => void>();
let version = 0;
const emit = () => {
    version++;
    listeners.forEach(l => l());
};
const set = (next: Phase) => {
    phase = next;
    hidden = false;
    emit();
};

/** In a voice call (a DM call or a voice channel, streaming included) */
function isInCall() {
    try {
        return !!findStore("SelectedChannelStore")?.getVoiceChannelId?.();
    } catch {
        return false;
    }
}

async function download() {
    if (!required || phase.kind === "downloading" || phase.kind === "ready" || phase.kind === "restarting" || !Native.prepareUpdate) return;
    if (!mayUpdateEviUnasked(Settings.data)) return set({ kind: "asked" });
    clearTimeout(retryTimer);
    set({ kind: "downloading" });
    const result = await Native.prepareUpdate(required.version).catch((err: unknown) => ({ ok: false as const, error: String(err) }));
    if (result.ok) {
        logger.info(`Evi ${result.version} is required and downloaded`);
        countdown = COUNTDOWN;
        set({ kind: "ready", version: result.version });
    } else {
        logger.warn("Couldn't download the required update:", result.error);
        set({ kind: "failed", error: result.error });
        retryTimer = setTimeout(() => void download(), RETRY_AFTER);
    }
}

async function restart() {
    if (phase.kind !== "ready") return;
    set({ kind: "restarting" });
    // Main finds the download already there: Discord closes and opens again on the new Evi. Not through
    // Updates.install(), which does nothing while the Updates tab thinks an install is already under way
    const result = await Native.installUpdate?.().catch((err: unknown) => ({ ok: false as const, error: String(err) }));
    if (!result) {
        set({ kind: "failed", error: t("common.notSupported") });
    } else if (!result.ok) {
        set({ kind: "failed", error: result.error });
        retryTimer = setTimeout(() => void download(), RETRY_AFTER);
    } else {
        // The installer closes Discord within seconds: still here after this long means it didn't
        setTimeout(() => phase.kind === "restarting" && set({ kind: "failed", error: t("updates.installerDidntRestart") }), 90_000);
    }
}

/** "Update now" with automatic updates off: the person's own update, the same as in Settings → Updates */
async function updateNow() {
    if (phase.kind !== "asked" && phase.kind !== "failed") return;
    set({ kind: "restarting" });
    const result = await Native.installUpdate?.().catch((err: unknown) => ({ ok: false as const, error: String(err) }));
    if (!result) set({ kind: "failed", error: t("common.notSupported") });
    else if (!result.ok) set({ kind: "failed", error: result.error });
    else setTimeout(() => phase.kind === "restarting" && set({ kind: "failed", error: t("updates.installerDidntRestart") }), 90_000);
}

/** Every few seconds while a restart waits: counts down, or holds while in a call or put off */
function tick() {
    if (phase.kind !== "ready") return;
    const calling = isInCall();
    if (calling !== inCall) {
        inCall = calling;
        // The call ended: whatever was put off or hidden comes back, and the countdown starts from the top
        if (!calling) {
            countdown = COUNTDOWN;
            postponedUntil = 0;
            hidden = false;
        }
        emit();
    }
    if (inCall || Date.now() < postponedUntil) return;
    if (hidden && postponedUntil) {
        // Back from "Later": say it again
        hidden = false;
        postponedUntil = 0;
        countdown = COUNTDOWN;
    }
    countdown = Math.max(0, countdown - 1);
    emit();
    if (countdown === 0) void restart();
}

function later() {
    if (usedLater) return;
    usedLater = true;
    postponedUntil = Date.now() + LATER_FOR;
    hidden = true;
    emit();
}

/** Store plugins, once per requirement: only for people with plugin auto-update on */
async function updatePlugins(req: RequiredUpdate) {
    if (!mayForcePlugins(req, Settings.data) || SafeMode.active || (Settings.data.requiredPluginsAt ?? 0) >= req.at) return;
    Settings.update(d => void (d.requiredPluginsAt = req.at));
    try {
        await Store.refresh();
        if (Store.getSnapshot().status !== "ready") return;
        const result = await Store.updateAll("plugin");
        if (result.updated.length) {
            showToast(result.updated.length === 1
                ? t("required.pluginsUpdatedOne", { name: result.updated[0] })
                : t("required.pluginsUpdated", { count: result.updated.length }), { type: "success" });
        }
        logger.info(`Required plugin updates: ${result.updated.length} updated, ${result.failed.length} failed`);
    } catch (err) {
        logger.warn("Required plugin updates failed", err);
    }
}

async function check() {
    if (!Native.required) return;
    const result = await Native.required().catch(() => undefined);
    if (!result?.ok) return;
    required = result.value;
    if (!required) return;
    void updatePlugins(required);
    if (mustUpdate(required, EVI_VERSION)) void download();
}

function message(p: Phase): { title: string; body: string; } {
    switch (p.kind) {
        case "asked": return { title: t("required.title"), body: t("required.asked") };
        case "downloading": return { title: t("required.title"), body: t("required.downloading") };
        case "ready": return {
            title: t("required.readyTitle", { version: p.version }),
            body: inCall ? t("required.readyInCall") : t("required.readyIn", { seconds: countdown }),
        };
        case "restarting": return { title: t("required.title"), body: t("required.restarting") };
        case "failed": return { title: t("required.title"), body: t("required.failed", { error: p.error }) };
        default: return { title: "", body: "" };
    }
}

function Banner({ p }: { p: Phase; }) {
    useLocale();
    const exit = useExit(() => {
        hidden = true;
        emit();
    });
    const { title, body } = message(p);
    const reason = required?.reason;
    return (
        <div className="dl-announcement dl-required" role="status" aria-live="polite" aria-label={t("required.region")} {...exit.closingProps}>
            <span className="dl-announcement-icon" aria-hidden="true"><Icon name="download" size={18} /></span>
            <span className="dl-announcement-text">
                <Text tag="span" variant="text-xs/medium" color="text-muted">{t("announcement.from")}</Text>
                <Text tag="span" variant="text-sm/semibold" color="text-strong" className="dl-announcement-title">{title}</Text>
                <Text tag="span" variant="text-sm/normal" color="text-subtle" className="dl-announcement-body" tabular>{body}</Text>
                {reason && <Text tag="span" variant="text-xs/normal" color="text-muted" className="dl-announcement-body">{reason}</Text>}
            </span>
            {(p.kind === "asked" || (p.kind === "failed" && !mayUpdateEviUnasked(Settings.data))) && (
                <span className="dl-required-actions">
                    <button type="button" className="dl-announcement-link" onClick={() => void updateNow()}>{t("updates.updateNow")}</button>
                </span>
            )}
            {p.kind === "ready" && (
                <span className="dl-required-actions">
                    {!inCall && !usedLater && <button type="button" className="dl-required-later" onClick={later}>{t("required.later")}</button>}
                    <button type="button" className="dl-announcement-link" onClick={() => void restart()}>{t("required.restartNow")}</button>
                </span>
            )}
            {/* Never while counting down: Discord doesn't restart without saying so */}
            {(p.kind === "asked" || p.kind === "downloading" || p.kind === "failed" || (p.kind === "ready" && inCall)) && <IconButton icon="close" label={t("required.hide")} onClick={exit.close} />}
        </div>
    );
}

function Host() {
    useStore(cb => {
        listeners.add(cb);
        return () => void listeners.delete(cb);
    }, () => version);
    if (hidden || phase.kind === "idle") return null;
    // Keyed by phase, so each step enters with the banner's motion
    return <Banner key={phase.kind} p={phase} />;
}

let host: HTMLElement | undefined;
/** Moves down while an announcement shows too, so the two don't sit on each other */
function placeHost() {
    if (!host) return;
    const stacked = !!document.querySelector(".dl-announcements:not(.dl-required-host) .dl-announcement");
    host.toggleAttribute("data-stacked", stacked);
}

let started = false;
/** Once the app is up, safe mode included: a new version may be the fix */
export function startRequiredUpdates() {
    if (started || !Native.required) return;
    started = true;
    ensureStyles();
    host = mountRoot(<Host />, "dl-root dl-announcements dl-required-host");
    listeners.add(placeHost);

    void check();
    setInterval(() => void check(), EVERY);
    Native.onRequiredChange?.(() => void check());
    setInterval(() => {
        tick();
        if (phase.kind !== "idle") placeHost();
    }, 1000);
}
