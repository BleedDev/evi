/**
 * Renderer entry. Runs in Discord's page before any of Discord's scripts.
 */
import * as api from "@evi/api";
import { isPluginEnabled } from "@shared/ipc";
import { pullFor } from "@shared/pulls";

import { Backup } from "./backup";
import { CrashDetective } from "./crashDetective";
import { Developer } from "./developer";
import { GameMode, installGameMode, startGameMode } from "./gameMode";
import { installCssFixes, warmUiFonts } from "./cssFixes";
import { I18n } from "./i18n";
import { startIdleReports } from "./idle";
import { startHealthReports } from "./health";
import { Logger } from "./logger";
import { Native } from "./native";
import { diagnosePatches } from "./patching/diagnose";
import { startFindCache } from "./patching/findIndex";
import { Perf } from "./perf";
import { diagnoseLookups } from "./plugins/lookups";
import { PluginManager, PublicPlugins } from "./plugins/manager";
import { startPullNotices } from "./pulls";
import { SafeMode } from "./safeMode";
import { isOverlayWindow } from "@shared/appHosts";
import { Settings } from "./settings";
import { Store } from "./store";
import { Updates } from "./updates";
import { Wallpaper } from "./wallpaper";
import { QuickCss } from "./styles";
import { Themes } from "./themes";
import { installTypingDots, TypingDots } from "./typingDots";
import { registerToolkitPatches, Toolkit } from "./toolkit";
import { installLayerStyles } from "./toolkit/layer";
import { renderPanelSlot } from "./toolkit/panel";
import { installHotkey, SettingsUI } from "./ui";
import { whenAppReady } from "./ui/appReady";
import { startAccountSync } from "./accountSync";
import { startBadges } from "./ui/badges";
import { startPluginShare } from "./ui/pluginShare";
import { startUpdateChecks } from "./ui/UpdatesTab";
import { Inbox } from "./inbox";
import { startPluginChangelogs } from "./ui/PluginChangelog";
import { showCrashDetective } from "./ui/CrashDetective";
import { startLiveToasts } from "./ui/LiveToasts";
import { startAnnouncements } from "./ui/Announcements";
import { startRequiredUpdates } from "./ui/RequiredUpdate";
import { showSafeModeNotice } from "./ui/SafeModeNotice";
import { installSettingsEntry } from "./ui/settingsEntry";
import { showTour2 } from "./ui/Tour2";
import { showWhatsNewIfUpdated } from "./ui/WhatsNew";
import { onCommonReady } from "./webpack/common";
import { pendingWaiters } from "./webpack/find";
import { interceptWebpack, stats, wreq } from "./webpack/runtime";

const logger = new Logger("Core");

declare global {
    interface Window {
        Evi: typeof Evi;
    }
}

const Evi = {
    version: EVI_VERSION,
    api,
    plugins: PublicPlugins,
    settings: Settings,
    themes: Themes,
    backup: Backup,
    store: Store,
    ui: SettingsUI,
    diagnosePatches,
    diagnoseLookups,
    stats,
    pendingWaiters,
    toolkit: Toolkit,
    safeMode: SafeMode,
    updates: Updates,
    /** Where plugins spend time: snapshot(), record(ms) */
    perf: Perf,
    get wreq() {
        return wreq;
    },
    /** Target of $self in source patches */
    $: PluginManager.self,
    /** What the user panel calls for plugins' switches (toolkit/panel.tsx) */
    panelSlot: renderPanelSlot,
    /** What Discord's patched typing indicator draws its dots with (typingDots.tsx) */
    typingDots: TypingDots,
    /** What Discord's patched GameModeStore asks (gameMode.ts) */
    gameMode: GameMode,
};

function boot() {
    // Only handed over where our preload decided to load us
    if (!Native) return;
    // Discord's in-game overlay: a see-through window over the game that clicks go through. Nothing
    // of Evi's runs there: no plugin, theme or popup (an update notice there can't be clicked away)
    if (isOverlayWindow(location.href, window.name)) return;
    if (window.Evi) return logger.warn("Already loaded, skipping");
    Object.defineProperty(window, "Evi", { value: Evi, configurable: false, writable: false });

    // Must happen before Discord's runtime script executes
    interceptWebpack();

    const data = Native.boot();
    if (data.testHooks) Object.assign(Evi, { plugins: PluginManager, showTour2 });
    // Main words its own dialogs and errors in Discord's language too
    Native.setLocale?.(I18n.locale);
    I18n.subscribe(() => Native.setLocale?.(I18n.locale));
    // Before anything that applies plugins or CSS, they all check it
    SafeMode.init(data.safeMode);
    // Lets anything that hides content from rendering (Fast Lists) stand down for a screen reader
    // Evi starts before the page has its <html>: the mark goes on once there is one
    let assistive = !!data.assistive;
    const applyAssistive = () => document.documentElement?.toggleAttribute("data-evi-assistive", assistive);
    const markAssistive = (on?: boolean) => {
        assistive = !!on;
        applyAssistive();
    };
    if (!document.documentElement) document.addEventListener("readystatechange", applyAssistive, { once: true });
    markAssistive(data.assistive);
    Native.onAssistiveChange?.(markAssistive);
    // Before Discord adds its first stylesheet: some of its rules must never match anything
    if (!SafeMode.active) installCssFixes();
    Settings.init(data.settings);
    // Dialog and menu motion, before themes so they can restyle it
    installLayerStyles();
    // Themes first: Quick CSS goes after them in <head>, so it wins
    Themes.init(data.themes);
    QuickCss.init(data.quickCss);
    // Its see-through panels go before Quick CSS too, so Quick CSS can still restyle them
    Wallpaper.init();
    // Plugins Evi pulled never run (shared/pulls.ts), so their code doesn't count either
    const runs = (p: typeof data.plugins[number]) => isPluginEnabled(data.settings, p.manifest) && (p.source === "dev" || !pullFor(data.pulled, p.manifest.id, p.manifest.version));
    // Main sends the code of exactly these (main/plugins.ts getBootPlugins)
    if (!SafeMode.active) registerToolkitPatches(data.plugins.filter(runs).map(p => p.code ?? ""));
    // Before Discord's first module runs: patches only search modules the saved index can't answer for
    if (!SafeMode.active) startFindCache(data.findCache, Native.saveFindCache);
    // Fixes to Discord's own rendering waste, for everyone
    if (!SafeMode.active) {
        installTypingDots();
        installGameMode();
    }
    PluginManager.boot(data.plugins, data.pulled, data.hotfixes);
    installHotkey();
    installSettingsEntry();

    onCommonReady(() => {
        if (!SafeMode.active) logger.info("Discord core modules ready, starting plugins");
        PluginManager.startAll().then(() => SafeMode.scheduleBootOk());
        // Part of Evi itself, not a plugin: on for everyone. Safe mode keeps even this off.
        if (!SafeMode.active) {
            startBadges();
            startAccountSync();
            startPluginShare();
            startGameMode();
        }
        // Even in safe mode: a new version may be the fix
        startUpdateChecks();
        // Evi's team requiring a version: downloads it now and restarts once nobody's in a call
        whenAppReady(startRequiredUpdates);
        // Main empties Discord's caches when it's hidden a while, and can restart it if you asked, never in a call
        whenAppReady(startIdleReports);
        if (SafeMode.active) {
            showSafeModeNotice();
        } else {
            // Waits for a normal start: safe mode has its own notice to show, and nothing to update
            showWhatsNewIfUpdated();
            // Plugins that updated since the last start: their changelogs, after Evi's own
            startPluginChangelogs();
            // Tells main what plugins are busy with, so a crash can name a suspect; and offers to turn
            // off the one a crash before this start named
            CrashDetective.start();
            void showCrashDetective();
            Store.scheduleAutoUpdate();
            // Store plugins that can't find parts of Discord, told to evi.rest (off in Store settings)
            whenAppReady(startHealthReports);
            // Plugins Evi turned off: a toast each, once
            whenAppReady(startPullNotices);
            // The store's inbox: the account's notifications, and news about hearted and broken plugins
            whenAppReady(() => {
                Inbox.start();
                // New notifications pop up in the corner as they arrive
                startLiveToasts();
                // Evi's team to everyone, top and centre, live
                startAnnouncements();
                // Evi's developers get their Developers page
                void Developer.refresh();
            });
            // So a font's first use (opening settings, an italic in chat) doesn't relayout all text
            whenAppReady(warmUiFonts);
        }
    });

    if (SafeMode.active) logger.warn(`Safe mode (${data.safeMode!.reason}): ${data.plugins.length} plugins, themes and Quick CSS are off.`);
    else logger.info(`v${EVI_VERSION} loaded, ${data.plugins.length} plugins. Ctrl+Shift+D opens settings.`);
}

try {
    boot();
} catch (err) {
    logger.error("Boot failed", err);
}
