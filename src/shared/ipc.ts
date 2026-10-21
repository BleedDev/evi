import type { AuthorProfile } from "./authors";
import type { CrashRecord } from "./crashDetective";
import type { ImportMode, ImportPreview } from "./backup";
import type { PluginHealth } from "./health";
import type { Hotfix } from "./hotfixes";
import type { EviNotification } from "./notifications";
import type { PluginLocales } from "./pluginLocales";
import type { PulledPlugins } from "./pulls";
import type { WallpaperKind, WallpaperSettings } from "./wallpaper";

/** IPC channel names shared by main, preload and renderer. */
export const IPC = {
    /** sync: renderer bundle source */
    GET_RENDERER: "evi:get-renderer",
    /** sync: everything the renderer needs to boot, see BootData */
    GET_BOOT: "evi:get-boot",
    /** The renderer tells main Evi's language, for its native dialogs and error messages */
    SET_LOCALE: "evi:set-locale",
    /** answers with SettingsSaveResult, after asking about plugins it turns on that reach beyond the page */
    SETTINGS_SAVE: "evi:settings-save",
    /** sync: last-chance flush while the page unloads, async IPC may not make it */
    SETTINGS_SAVE_SYNC: "evi:settings-save-sync",
    CSS_SAVE_SYNC: "evi:css-save-sync",
    CSS_SAVE: "evi:css-save",
    /** main -> renderer: quick css file changed on disk */
    CSS_CHANGED: "evi:css-changed",
    /** main -> renderer: a plugin was added, changed or removed on disk */
    PLUGIN_CHANGED: "evi:plugin-changed",
    /** invoke a method exported by a plugin's native (main process) module */
    PLUGIN_NATIVE_CALL: "evi:plugin-native-call",
    /** start / stop a plugin's native module */
    PLUGIN_NATIVE_STATE: "evi:plugin-native-state",
    /** sync: a plugin's renderer code, for one the boot data left it out of (BootPlugin) */
    PLUGIN_CODE: "evi:plugin-code",
    /** main -> renderer: a screen reader or other assistive technology turned on or off */
    ASSISTIVE_CHANGED: "evi:assistive-changed",
    /** main -> renderer: a theme file was added, changed or removed on disk */
    THEME_CHANGED: "evi:theme-changed",
    /** download a theme from an https URL into the themes folder */
    THEME_ADD_URL: "evi:theme-add-url",
    /** write a theme from the theme editor into the themes folder, see ThemeSaveInput */
    THEME_SAVE: "evi:theme-save",
    THEME_DELETE: "evi:theme-delete",
    /** send a theme to evi.rest for review, as the account this install is linked to (shared/themeSubmissions.ts) */
    THEME_SUBMIT: "evi:theme-submit",
    /** report a store theme to Evi's team */
    THEME_REPORT: "evi:theme-report",
    /** save a backup file, see shared/backup.ts */
    BACKUP_EXPORT: "evi:backup-export",
    /** pick and validate a backup file, answers with what importing it would change */
    BACKUP_OPEN: "evi:backup-open",
    BACKUP_APPLY: "evi:backup-apply",
    /** plugin store: fetch the registry, install / update / uninstall from it */
    STORE_LIST: "evi:store-list",
    STORE_INSTALL: "evi:store-install",
    STORE_UNINSTALL: "evi:store-uninstall",
    STORE_THEME_INSTALL: "evi:store-theme-install",
    STORE_THEME_UNINSTALL: "evi:store-theme-uninstall",
    /** a screenshot the registry lists, as a data URL */
    STORE_IMAGE: "evi:store-image",
    /** a store plugin's manifest and code, verified like an install, for what its store page says it can access */
    STORE_PREVIEW: "evi:store-preview",
    /** store stars: every count plus this install's own, and starring or unstarring one item */
    STARS_GET: "evi:stars-get",
    STARS_SET: "evi:stars-set",
    /** badges with their icons as data URLs; whether this install may manage them; managing them */
    BADGES_GET: "evi:badges-get",
    BADGES_ADMIN_AVAILABLE: "evi:badges-admin-available",
    BADGES_ADMIN: "evi:badges-admin",
    /** hide and order your own badges, saved on evi.rest (this install must be linked to that account) */
    BADGES_SET_PREFS: "evi:badges-set-prefs",
    /** plugin authors and store-wide plugin health from evi.rest, cached on disk */
    AUTHORS_GET: "evi:authors-get",
    HEALTH_GET: "evi:health-get",
    /** send a crash report to a plugin's author; say a store plugin can't find parts of Discord */
    CRASH_REPORT_SEND: "evi:crash-report-send",
    HEALTH_REPORT: "evi:health-report",
    /** main -> renderer: the plugins Evi pulled changed (see shared/pulls.ts) */
    PULLS_CHANGED: "evi:pulls-changed",
    /** main -> renderer: Evi's hotfixes for broken plugins changed (see shared/hotfixes.ts) */
    HOTFIXES_CHANGED: "evi:hotfixes-changed",
    /** report a store plugin to Evi's team */
    PLUGIN_REPORT: "evi:plugin-report",
    /** Evi's own updates: is a newer release published; download and install it (restarts Discord) */
    UPDATE_CHECK: "evi:update-check",
    UPDATE_INSTALL: "evi:update-install",
    /** main -> renderer: download and install progress of an update */
    UPDATE_PROGRESS: "evi:update-progress",
    /** main -> renderer: a silent update finished downloading (its version) and installs when Discord quits */
    UPDATE_READY: "evi:update-ready",
    /** A required update (shared/required.ts): download it now whatever the update settings; it also installs when Discord quits */
    UPDATE_PREPARE: "evi:update-prepare",
    /** The Evi version evi.rest says every Evi has to be on, and main -> renderer when that changes */
    REQUIRED: "evi:required",
    REQUIRED_CHANGED: "evi:required-changed",
    /** main -> renderer: the badge list changed (evi.rest said so over its change stream) */
    BADGES_CHANGED: "evi:badges-changed",
    /** who this install is linked to on evi.rest; starting a link (opens the site to confirm it) */
    ACCOUNT_STATUS: "evi:account-status",
    ACCOUNT_LINK: "evi:account-link",
    ACCOUNT_DASHBOARD: "evi:account-dashboard",
    ACCOUNT_SYNC_PROFILE: "evi:account-sync-profile",
    /** main -> renderer: download / install progress of a store operation */
    STORE_PROGRESS: "evi:store-progress",
    OPEN_PATH: "evi:open-path",
    RELAUNCH: "evi:relaunch",
    /** renderer -> main: plugins started and the page stayed up, this start counts as healthy */
    BOOT_OK: "evi:boot-ok",
    /** leave safe mode: forget the crash history and restart Discord normally */
    SAFE_MODE_EXIT: "evi:safe-mode-exit",
    /** renderer -> main, one-way: what plugins are doing, kept in case the page crashes (shared/crashDetective.ts) */
    CRASH_BREADCRUMB: "evi:crash-breadcrumb",
    /** the last crash record if the user hasn't seen it yet; marking it seen */
    CRASH_RECORD_GET: "evi:crash-record-get",
    CRASH_RECORD_SEEN: "evi:crash-record-seen",
    /** Dynamic Wallpaper: pick a file and copy it into Evi's folder; the copied file's bytes; remove it */
    WALLPAPER_PICK: "evi:wallpaper-pick",
    WALLPAPER_READ: "evi:wallpaper-read",
    WALLPAPER_REMOVE: "evi:wallpaper-remove",
    /** Whether the computer runs on battery now */
    POWER_ON_BATTERY: "evi:power-on-battery",
    /** main -> renderer: the computer switched between battery and mains power */
    POWER_CHANGED: "evi:power-changed",
    /** renderer -> main, one-way: whether a call keeps Discord busy, and where it is (shared/idle.ts) */
    IDLE_REPORT: "evi:idle-report",
    /** main -> renderer: Discord's window was hidden a while, empty the page's caches */
    MEMORY_TRIM: "evi:memory-trim",
    /** Memory Discord's page and GPU process use now */
    MEMORY_USAGE: "evi:memory-usage",
    /** Once, after Evi restarted an idle Discord: the channel it was on */
    IDLE_RESTORE: "evi:idle-restore",
    /** The store's community side on evi.rest (main/community.ts): its front page, ratings, a plugin's page */
    COMMUNITY_HOME: "evi:community-home",
    COMMUNITY_RATINGS: "evi:community-ratings",
    COMMUNITY_PAGE: "evi:community-page",
    /** Write, change or take back this account's review of a plugin; report someone's */
    COMMUNITY_REVIEW: "evi:community-review",
    COMMUNITY_REVIEW_REPORT: "evi:community-review-report",
    /** Follow or unfollow an author; who this account follows */
    COMMUNITY_FOLLOW: "evi:community-follow",
    COMMUNITY_FOLLOWING: "evi:community-following",
    /** This account's inbox, and marking it read */
    COMMUNITY_INBOX: "evi:community-inbox",
    ANNOUNCEMENTS: "evi:announcements",
    ANNOUNCEMENTS_CHANGED: "evi:announcements-changed",
    DEV_LIVE: "evi:dev-live",
    /** The Developers page's other calls to evi.rest's admin API (shared/devAdmin.ts says which) */
    DEV_ADMIN: "evi:dev-admin",
    /** The Author page: the linked account's plugin numbers (shared/authorStats.ts) */
    AUTHOR_STATS: "evi:author-stats",
    /** The Author page's links to evi.rest: publishing, and the docs */
    AUTHOR_OPEN: "evi:author-open",
    COMMUNITY_INBOX_READ: "evi:community-inbox-read",
    /** main -> renderer: the account's inbox changed (evi.rest's stream said so) */
    COMMUNITY_INBOX_CHANGED: "evi:community-inbox-changed",
    /** Supporters who chose to be named; whether you're one of them, and changing that */
    COMMUNITY_CREDITS: "evi:community-credits",
    COMMUNITY_CREDITED: "evi:community-credited",
    COMMUNITY_SET_CREDITED: "evi:community-set-credited",
    /** A store plugin's preview video or GIF, as bytes (only ones the registry lists) */
    STORE_PREVIEW_MEDIA: "evi:store-preview-media",
    /** renderer -> main, one-way: which modules source patch finds match on this Discord build (renderer/patching/findCache.ts) */
    FIND_CACHE_SAVE: "evi:find-cache-save",
} as const;

export interface PluginManifest {
    /** Folder name, kebab-case. Also the settings key. */
    id: string;
    name: string;
    description?: string;
    version?: string;
    authors?: string[];
    /** Store search keywords, also the store's categories */
    tags?: string[];
    /** https link to the source, published to the store registry */
    source?: string;
    /** https image links, published to the store registry */
    screenshots?: string[];
    /** https link to a short .mp4, .webm, .gif or .webp of it in use, played on its store page */
    preview?: string;
    /** Newest first, published to the store registry */
    changelog?: { version: string; notes: string[]; }[];
    /** Name, description and changelog in other languages (shared/pluginLocales.ts), published to the store registry */
    locales?: PluginLocales;
    /** A thank-you for people supporting Evi: the store lists it for everyone, only supporters can install it. Official plugins only */
    supporters?: boolean;
    /** Oldest Evi the plugin works with, published to the store registry */
    minEviVersion?: string;
    /** Renderer entry, relative to the plugin folder. Defaults to index.js */
    main?: string;
    /** Optional main-process entry, relative to the plugin folder */
    native?: string;
    /** Enabled on first install */
    enabledByDefault?: boolean;
    /**
     * Chromium command line switches applied when Discord starts, while the plugin is enabled.
     * `true` for flags without a value. Changes take effect after restarting Discord.
     */
    chromiumSwitches?: Record<string, string | true>;
    /**
     * What it needs from Discord's page: sites, reading and sending messages, changing settings.
     * Evi blocks anything else it does through Evi (shared/declaredPermissions.ts). Missing: made
     * before Evi 0.7.0, not held to anything.
     */
    permissions?: {
        network?: string[];
        readMessages?: boolean;
        sendMessages?: boolean;
        changeSettings?: boolean;
    };
}

export interface PluginPayload {
    manifest: PluginManifest;
    code: string;
    /** Where the plugin was loaded from: the data dir, or the dev build output */
    source: "user" | "dev";
}

/** A plugin as the boot data has it: without its code when it doesn't run at boot, fetched once it's needed */
export type BootPlugin = Omit<PluginPayload, "code"> & { code?: string; };

export type PluginChange =
    | { type: "upsert"; plugin: PluginPayload; }
    | { type: "remove"; id: string; };

export interface ThemeMeta {
    /** File name inside the themes folder, e.g. "midnight.css". Also the settings key. */
    file: string;
    /** From the header's @name, or the file name without .css */
    name: string;
    description?: string;
    author?: string;
    version?: string;
    /** From `@name:de` / `@description:de` tags: the name and description in other languages */
    locales?: import("./pluginLocales").PluginLocales;
}

export interface ThemePayload extends ThemeMeta {
    css: string;
}

export type ThemeChange =
    | { type: "upsert"; theme: ThemePayload; }
    | { type: "remove"; file: string; };

export type AddThemeResult = { ok: true; file: string; } | { ok: false; error: string; };

/**
 * A theme from the editor. With `file`, it replaces that theme, which must be one the editor made and
 * the store didn't install; without, it gets a free file name made from `name`.
 */
export interface ThemeSaveInput {
    css: string;
    name: string;
    file?: string;
}
export type ThemeSaveResult = { ok: true; file: string; } | { ok: false; error: string; };
/** `submission` as evi.rest answered: waiting for review */
export type ThemeSubmitResult = { ok: true; submission: { id: number; version: string; }; } | { ok: false; error: string; };

export interface PluginSettingsEntry {
    enabled?: boolean;
    settings?: Record<string, unknown>;
}

export interface EviSettings {
    plugins: Record<string, PluginSettingsEntry>;
    quickCss: boolean;
    /** File names of enabled themes */
    enabledThemes: string[];
    /** Update store plugins and themes in the background. Full-access plugins still ask first. */
    autoUpdate?: boolean;
    /** Look for new versions of Evi when Discord starts (on unless turned off) */
    checkEviUpdates?: boolean;
    /** Offer prereleases (betas) too. Off by default */
    betaUpdates?: boolean;
    /** The version whose "update available" notice was dismissed, so it doesn't come back */
    dismissedUpdate?: string;
    /** Download new versions of Evi in the background and install them when Discord quits. Off by default */
    silentUpdates?: boolean;
    /** The Evi version whose "What's new" was last shown, to show it once after each update */
    lastSeenVersion?: string;
    /** Each plugin's version when it was last seen, to show its changelog once after it updates */
    pluginVersionsSeen?: Record<string, string>;
    /** `false` turns off "What's new" popups after plugin updates. On by default. */
    pluginChangelogs?: boolean;
    /** `false` stops telling evi.rest when a store plugin can't find parts of Discord. On by default. */
    healthReports?: boolean;
    /** Send to author without showing the report first ("Don't ask again") */
    crashReportConsent?: boolean;
    /** An image or video behind Discord's panels, see shared/wallpaper.ts. Missing: off */
    wallpaper?: WallpaperSettings;
    /** Store items you hearted ("plugin:id", "theme:id"): you hear when they update or get fixed */
    wishlist?: string[];
    /** The version of each hearted item last seen, and of its beta, so each update is told once */
    wishlistSeen?: Record<string, string>;
    /** Plugins you get beta versions of, when their authors publish one */
    pluginBetas?: string[];
    /** Once a day, tell evi.rest which store plugins you have (shared/analytics.ts). Missing: on */
    shareUsage?: boolean;
    /** Evi's own notifications for this install (wishlist, fixes, updates), shown with the account's */
    localNotifications?: EviNotification[];
    /** New notifications pop up over Discord as they arrive (ui/LiveToasts.tsx). Missing: on */
    liveToasts?: boolean;
    /** Announcements from Evi's team already shown here (their ids), so each shows once */
    announcementsSeen?: number[];
    /** When the last required plugin update ran (shared/required.ts `at`), so each runs once */
    requiredPluginsAt?: number;
    /** The Evi 2.0 tour (ui/Tour2.tsx) was shown, or skipped: it shows once */
    tour2Seen?: boolean;
    /** `false`: crashes don't turn safe mode on; only starting Discord with --evi-safe does. Missing: on */
    autoSafeMode?: boolean;
    /** Plugins you have or hearted that evi.rest said were broken, so a fix is told once */
    brokenSeen?: string[];
    /** Restart Discord when its page uses more than idleRestartGb while you're away (shared/idle.ts). Off by default */
    idleRestart?: boolean;
    /** One of RESTART_GB_OPTIONS. Missing: DEFAULT_RESTART_GB */
    idleRestartGb?: number;
    /** Discord's own Game Mode, which Discord keeps behind an experiment (renderer/gameMode.ts). Missing: off */
    gameMode?: boolean;
}

/** An answer from evi.rest's community side; `unlinked` when it needs this Evi linked to an account */
export type CommunityResult<T> = { ok: true; value: T; } | { ok: false; error: string; unlinked?: boolean; };

export type PreviewMediaResult = { ok: true; bytes: Uint8Array; mime: string; } | { ok: false; error: string; };

export const DEFAULT_SETTINGS: EviSettings = {
    plugins: {},
    quickCss: true,
    enabledThemes: [],
};

/**
 * Main's answer to a settings save. Turning on a plugin with native code or Chromium switches waits
 * for the user's yes in a dialog main shows; `refused` lists the ones they kept off.
 */
export interface SettingsSaveResult {
    refused: string[];
}

export interface BootData {
    version: string;
    dataDir: string;
    settings: EviSettings;
    plugins: BootPlugin[];
    quickCss: string;
    themes: ThemePayload[];
    /** A screen reader or other assistive technology is on (Electron's accessibility support) */
    assistive?: boolean;
    /** Set when this start is in safe mode: no plugins, themes or Quick CSS */
    safeMode?: SafeModeInfo;
    /** Plugins Evi turned off everywhere, from the last health answer on disk: they never start */
    pulled?: PulledPlugins;
    /** Evi's fixes for plugins a Discord update broke, as evi.rest last said: applied before their patches register */
    hotfixes?: Hotfix[];
    /** The saved find index (renderer/patching/findCache.ts), as JSON */
    findCache?: string;
    /**
     * Only the web test's fake bridge sets this: `Evi.plugins` is then the plugin manager itself,
     * contexts and all, so the test can drive plugins. Main never does.
     */
    testHooks?: boolean;
}

/**
 * Why safe mode is on. `crash-loop`: Discord failed to finish starting twice in a row. `renderer-crash`:
 * Discord's window crashed twice within a short time. `flag`: launched with --evi-safe.
 */
export type SafeModeReason = "crash-loop" | "renderer-crash" | "flag";

/** Something the user turned on or changed, a suspect when Discord starts crashing */
export interface RecentChange {
    kind: "plugin" | "theme" | "quickCss";
    /** Plugin id, theme file name, or "quick.css" */
    id: string;
    action: "enabled" | "settings" | "installed" | "updated" | "edited";
    /** Epoch ms */
    at: number;
}

export interface SafeModeInfo {
    reason: SafeModeReason;
    /** Starts that never reached a healthy boot, or crashes in a row for renderer-crash */
    failures: number;
    /** Newest first */
    changes: RecentChange[];
    /** The crash that led here, if Crash Detective has a record the user hasn't seen */
    crash?: CrashRecord;
}

export type OpenPathTarget = "data" | "plugins" | "themes" | "quickCss";

type Failed = { ok: false; canceled?: false; error: string; } | { ok: false; canceled: true; };

/** Authors by slug, and the site their pages are on (evi.rest/author?u=<slug>) */
export type AuthorsResult = { ok: true; authors: Record<string, AuthorProfile>; site: string; } | { ok: false; error: string; };
/** Statuses by plugin id; plugins with none are left out. `pulled`: the plugins Evi turned off everywhere. */
export type HealthResult = { ok: true; plugins: Record<string, PluginHealth>; pulled: PulledPlugins; } | { ok: false; error: string; };
export type PluginReportResult = { ok: true; } | { ok: false; error: string; };
/** `author`: who the crash report went to, as evi.rest names them */
export type CrashReportResult = { ok: true; author?: string; } | { ok: false; error: string; };
export type HealthReportResult = { ok: true; } | { ok: false; error: string; };

export type BackupExportResult = { ok: true; path: string; } | Failed;

/** `file`: the copy's name inside Evi's wallpaper folder, for settings */
export type WallpaperPickResult = { ok: true; file: string; kind: WallpaperKind; } | Failed;
/** The current wallpaper, the only file this reads */
export type WallpaperReadResult = { ok: true; file: string; mime: string; bytes: Uint8Array; } | { ok: false; error: string; };

export type BackupOpenResult = {
    ok: true;
    /** Pass to applyBackup, the validated backup stays in main until then */
    token: string;
    fileName: string;
    createdAt: string;
    eviVersion: string;
    previews: Record<ImportMode, ImportPreview>;
} | Failed;

export type BackupApplyResult = { ok: true; settings: EviSettings; preview: ImportPreview; } | Failed;

export function isPluginEnabled(settings: EviSettings, manifest: PluginManifest) {
    return settings.plugins[manifest.id]?.enabled ?? manifest.enabledByDefault ?? false;
}
