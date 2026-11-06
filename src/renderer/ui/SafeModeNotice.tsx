/**
 * Explains safe mode, names the most likely culprit and offers the two ways out. Shown floating over
 * Discord when safe mode starts, and on top of the Plugins tab for as long as it lasts.
 */
import { activeSuspect } from "@shared/crashDetective";
import type { RecentChange, SafeModeInfo } from "@shared/ipc";
import { discordUpdatedSince, isStillActive, pickSuspect } from "@shared/safeMode";

import { discordBuild } from "../crashReport";
import { t, timeAgo as ago, useLocale } from "../i18n";
import { PluginManager } from "../plugins/manager";
import { SafeMode } from "../safeMode";
import { Settings } from "../settings";
import { Themes } from "../themes";
import { onCreateRootReady, React } from "../webpack/common";
import { whenAppReady } from "./appReady";
import { Button, Icon, IconButton, useExit, useStore } from "./components";
import { SuspectLine } from "./CrashDetective";
import { ensureStyles } from "./index";
import { mountRoot } from "./discordContext";

const reasons: Record<SafeModeInfo["reason"], (info: SafeModeInfo) => string> = {
    "crash-loop": info => t("safeMode.reason.crashLoop", { count: info.failures }),
    "renderer-crash": () => t("safeMode.reason.rendererCrash"),
    "flag": () => t("safeMode.reason.flag"),
};


function nameOf(change: RecentChange) {
    if (change.kind === "plugin") return PluginManager.get(change.id)?.manifest.name ?? change.id;
    if (change.kind === "theme") return Themes.getSnapshot().find(t => t.file === change.id)?.name ?? change.id;
    return "Quick CSS";
}

function describe(change: RecentChange) {
    const action = t(`safeMode.action.${change.action}`);
    const when = ago(change.at);
    if (change.kind === "plugin") return t("safeMode.changedPlugin", { action, when });
    if (change.kind === "theme") return t("safeMode.changedTheme", { action, when });
    return t("safeMode.changed", { action, when });
}

export function SafeModeNotice({ onDismiss }: { onDismiss?(): void; }) {
    const plugins = useStore(PluginManager.subscribe, PluginManager.getSnapshot);
    const settings = useStore(Settings.subscribe, () => Settings.data);
    useStore(Themes.subscribe, Themes.getSnapshot);
    const [busy, setBusy] = React.useState(false);

    const { info } = SafeMode;
    if (!info) return null;

    const manifests = plugins.map(p => p.manifest);
    // Crash Detective saw which plugin was busy when Discord crashed: a better lead than the newest change
    const crashSuspect = activeSuspect(info.crash, settings, manifests);
    const crashChange: RecentChange | undefined = crashSuspect && (
        info.changes.find(c => c.kind === "plugin" && c.id === crashSuspect.plugin)
        ?? { kind: "plugin", id: crashSuspect.plugin, action: "enabled", at: info.crash!.at }
    );
    const suspect = crashChange ?? pickSuspect(info.changes, settings, manifests);
    // Discord updated since it last started fine: that, not the newest change, is the lead. Only
    // Crash Detective catching a plugin busy in the crash beats it
    const discordUpdated = !crashSuspect && discordUpdatedSince(info.goodBuild, discordBuild());
    const others = info.changes.filter(c => (discordUpdated || c !== suspect) && !(crashSuspect && c.kind === "plugin" && c.id === crashSuspect.plugin) && isStillActive(c, settings, manifests)).slice(0, 3);

    const run = (action: () => Promise<unknown>) => async () => {
        setBusy(true);
        try {
            await action();
        } finally {
            // Only reached if the restart didn't happen
            setBusy(false);
        }
    };

    return (
        <section className="dl-safe" aria-labelledby="dl-safe-title" data-reason={info.reason}>
            <div className="dl-safe-head">
                <span className="dl-safe-icon"><Icon name="warning" size={18} /></span>
                <h2 className="dl-safe-title" id="dl-safe-title">{t("safeMode.title")}</h2>
                {onDismiss && <IconButton icon="close" label={t("safeMode.hide")} onClick={onDismiss} />}
            </div>
            <p className="dl-safe-text">{reasons[info.reason](info)}{!discordUpdated && <> {t("safeMode.discordWorks")}</>}</p>
            {discordUpdated ? (
                <p className="dl-safe-text">{t("safeMode.discordUpdated")}</p>
            ) : crashSuspect ? (
                <p className="dl-safe-text"><SuspectLine suspect={crashSuspect} inSafeMode /></p>
            ) : suspect ? (
                <p className="dl-safe-text">
                    {t("safeMode.mostRecent")} <strong className="dl-safe-suspect">{nameOf(suspect)}</strong>
                    <span className="dl-safe-meta"> ({describe(suspect)})</span>
                </p>
            ) : (
                <p className="dl-safe-text">{t("safeMode.noChanges")}</p>
            )}
            {others.length > 0 && (
                <div className="dl-safe-text">
                    {t(discordUpdated ? "safeMode.changedRecently" : "safeMode.alsoChanged")}
                    <ul className="dl-safe-changes">
                        {others.map(c => (
                            <li key={`${c.kind}:${c.id}:${c.action}`}>
                                {nameOf(c)} <span className="dl-safe-meta">({describe(c)})</span>
                            </li>
                        ))}
                    </ul>
                </div>
            )}
            <div className="dl-safe-actions">
                {suspect && !discordUpdated && (
                    <Button variant="accent" disabled={busy} onClick={run(() => SafeMode.disableAndExit(suspect))}>
                        {t("safeMode.disableAndRestart", { name: nameOf(suspect) })}
                    </Button>
                )}
                <Button variant={discordUpdated ? "accent" : undefined} disabled={busy} onClick={run(() => SafeMode.exit())}>{t("safeMode.exitAndRestart")}</Button>
            </div>
        </section>
    );
}

/** One line for the Themes and Quick CSS tabs */
export function SafeModeHint({ what }: { what: "quickCss" | "themes"; }) {
    if (!SafeMode.active) return null;
    return (
        <div className="dl-banner" role="status">
            <Icon name="warning" />
            <span>{t(what === "themes" ? "safeMode.hint.themes" : "safeMode.hint.quickCss")}</span>
        </div>
    );
}

function FloatingNotice({ onClose }: { onClose(): void; }) {
    const exit = useExit(onClose);
    return <div className="dl-safe-float" {...exit.closingProps}><SafeModeNotice onDismiss={exit.close} /></div>;
}

function Floating() {
    useLocale();
    const [open, setOpen] = React.useState(true);
    return open ? <FloatingNotice onClose={() => setOpen(false)} /> : null;
}

let shown = false;
export function showSafeModeNotice() {
    if (shown) return;
    shown = true;
    ensureStyles();
    const mount = () => {
        mountRoot(<Floating />, "dl-root");
    };
    // react-dom/client loads after React and Flux, which is all onCommonReady waits for
    onCreateRootReady(() => whenAppReady(() => {
        if (document.body) mount();
        else document.addEventListener("DOMContentLoaded", mount, { once: true });
    }));
}
