import { CHANGELOG_LOCALES } from "./changelogLocales";
import { matchLocale } from "./i18n";
import { compareVersions } from "./store";

/** The sections of Discord's own changelog, in its order, each with its own heading color */
export const SECTION_KINDS = ["added", "improved", "fixed", "progress"] as const;
export type SectionKind = typeof SECTION_KINDS[number];

/** Where Evi's releases are published, linked from the modal's footer */
export const RELEASES_URL = "https://github.com/BleedDev/evi/releases";

export interface Release {
    version: string;
    /** YYYY-MM-DD */
    date: string;
    /**
     * The release's picture, where Discord's changelog has its video: a blog cover, by the name of
     * its file in src/renderer/ui/covers. Usually the cover of the post announcing the release.
     */
    cover?: string;
    /** One line per change. Like Discord's, a line can open with a **bold lead-in.** */
    sections: Partial<Record<SectionKind, string[]>>;
}

/**
 * Evi's own release notes, newest first. The "What's new" modal shows the releases between the last
 * version you saw and this one, once, after Evi updates itself. Add an entry here with each release.
 */
export const RELEASES: Release[] = [
    {
        version: "2.2.0",
        date: "2026-10-05",
        sections: {
            fixed: [
                "**Updates follow your settings.** When Evi's team says an update is needed, Evi only downloads it and restarts Discord by itself if you have automatic updates on. Otherwise it tells you and waits until you press Update now. Plugins come along only if you have plugin auto-update on.",
            ],
        },
    },
    {
        version: "2.1.0",
        date: "2026-10-03",
        sections: {
            added: [
                "**Memory in the Performance tab.** See how much Discord uses, and if you like, let Evi restart it when it uses too much while you're away. Never during a call, and at most once a day.",
                "**Game Mode.** Discord's own hidden Game Mode, as a switch in the Performance tab: while you play, Discord slows down in the background and stops GIFs. It stays off during calls.",
            ],
            improved: [
                "**Starts faster.** Evi remembers where plugins hook into Discord, so from the second start on a Discord version it's ready about four times faster with many plugins. Plugins you've turned off don't load until you turn them on.",
                "**Lighter while you use it.** Typing dots no longer redraw with JavaScript every frame, call buttons stop re-blurring the video behind them, and once Discord has been hidden for 10 minutes Evi empties its image caches (never during a call).",
            ],
            fixed: [
                "**Plugins' Chromium settings stick.** Discord was quietly overwriting them at startup.",
            ],
        },
    },
    {
        version: "2.0.0",
        date: "2026-10-02",
        sections: {
            added: [
                "**Twelve new plugins.** Desktop Voice Messages, Embed Builder with Components V2, Audit Log Plus, Role Colours Everywhere, Rich Presence Builder, Search Highlight, Click Actions, Soundboard Stealer, Quick Markup, Fix Embeds, Code Block Tools and Hover Converter. All in the store, all off until you turn them on.",
                "**A tour of what's new.** The first time 2.0 starts, it shows you the new plugins and turns on the ones you pick.",
                "**Publish your own plugins.** A button on the Plugins page opens your author dashboard: installs, active users, ratings, reviews and how each Discord build treats your plugins.",
            ],
            improved: [
                "**Menus look like Discord's.** Every dropdown in Evi and its plugins opens Discord's way, with no scrollbar and a filter for long lists.",
                "**Back to where you were.** Going back from a plugin in the store returns to the same page, filters and scroll.",
                "**Updates that matter arrive sooner.** When an update is needed, Evi downloads it straight away and restarts Discord when you're not in a call.",
            ],
            fixed: [
                "**Plugins aren't called broken for nothing.** A plugin waiting for a part of Discord that hadn't opened yet was reported as broken.",
                "**Dialogs open at the top.** Some opened scrolled halfway down inside Discord's settings.",
            ],
        },
    },
    {
        version: "1.5.0",
        date: "2026-10-01",
        sections: {
            added: [
                "**News from Evi's team, live.** Announcements show at the top of your screen within seconds of being sent, and stay until you close them.",
            ],
            fixed: [
                "**Plugin notifications show again.** Discord changed how it shows its pop-ups today, and plugins' ones stopped appearing.",
            ],
        },
    },
    {
        version: "1.4.3",
        date: "2026-10-01",
        sections: {
            fixed: [
                "**Your Discord colour theme stays out of Evi's.** With an Evi theme on, parts it doesn't colour (like a dialog's footer) showed your Discord colour theme's tint.",
                "**No band under dialogs with a wallpaper.** Dialog footers showed the wallpaper through twice, in a different colour.",
            ],
        },
    },
    {
        version: "1.4.2",
        date: "2026-10-01",
        sections: {
            improved: [
                "**Safe mode is yours to switch off.** General → Updates has \"Turn on safe mode by itself\": off, crashes never turn it on.",
            ],
            fixed: [
                "**Nothing of Evi's over your games.** Safe mode and other notices showed in Discord's in-game overlay, where they couldn't be clicked away, and a game closing the overlay counted as Discord crashing.",
            ],
        },
    },
    {
        version: "1.4.1",
        date: "2026-10-01",
        sections: {
            added: [
                "**Evi Setup for macOS and Linux.** Install, update and remove Evi from a window on every system, no terminal. On Linux it asks for your password when Discord's folder needs it, and on macOS and Linux it puts Evi back by itself after Discord updates.",
            ],
        },
    },
    {
        version: "1.4.0",
        date: "2026-10-01",
        sections: {
            added: [
                "**Spotify Player in the store.** A small player on top of your user panel with the song, its cover, play and pause, previous and next, and where you are in it.",
            ],
            improved: [
                "**Store search finds what you mean.** Every word you type counts, in any order, a typo is forgiven, the best match comes first, and a plugin's English name finds it in every language.",
            ],
            fixed: [
                "**Updates keep working** with releases that no longer carry the command-line installer.",
            ],
        },
    },
    {
        version: "1.3.1",
        date: "2026-09-30",
        sections: {
            fixed: [
                "**The user panel keeps its room.** With Game Activity Toggle and Fake Deafen both on, their switches share one Evi button with a menu, so your name and Discord's settings gear aren't pushed out.",
            ],
        },
    },
    {
        version: "1.3.0",
        date: "2026-09-29",
        sections: {
            added: [
                "**Live notifications.** Reviews, approvals, Evi updates and news from authors you follow pop up in the corner as they arrive. Hover one to keep it, click it to go there, or turn them off in the Inbox.",
            ],
            improved: [
                "**Plugins are kept apart.** A plugin can't use another plugin's full access, and a restored backup asks before turning on a plugin with full access.",
                "**Asked again when it matters.** When an update changes the full-access part of a plugin you have, Evi asks before installing it.",
            ],
            fixed: [
                "**Your wallpaper stays out of your games.** Discord's in-game overlay showed it over the whole game.",
            ],
        },
    },
    {
        version: "1.2.0",
        date: "2026-09-29",
        sections: {
            added: [
                "**Supporter plugins stand out.** They're gold in the store, and their page thanks you, or shows how to become a supporter.",
            ],
            improved: [
                "**One theme at a time.** Turning a theme on turns the others off, so they don't fight over colours.",
                "**Profiles stay current.** Change your Discord name or avatar and evi.rest, the credits and author pages follow on their own.",
                "**Buttons that look like Discord's.** Fake Deafen and Game Activity Toggle use Discord's own panel buttons, and Fake Deafen has a ghost so it isn't mistaken for deafen.",
                "**A calmer store front page.** New this week is gone, and installed plugins get a check by their name.",
            ],
            fixed: [
                "**Voice Chat Utilities really works.** It said it moved, muted or disconnected people, but its requests never reached Discord.",
                "**No more false \"broken\" labels.** View Icons was marked broken because part of it waits for the image viewer to open.",
                "**Video Controls+ works in chat.** Its controls show on videos in chat, not only in fullscreen.",
                "**Plugins don't restyle each other.** Link Safety's styles were leaking into Last Seen's settings.",
            ],
        },
    },
    {
        version: "1.1.2",
        date: "2026-09-29",
        sections: {
            added: [
                "**Share plugins in chat.** Copy a plugin's link from its store page and paste it in any Discord chat. Everyone with Evi gets a card to install it right there.",
                "**Fake Deafen.** Appear deafened to everyone in voice while you still hear them. A thank-you for supporters.",
                "**Voice Chat Utilities.** Right-click a voice channel to move, disconnect, mute or deafen everyone in it, when you're allowed to.",
            ],
            fixed: [
                "Reordering your badges saves more reliably.",
            ],
        },
    },
    {
        version: "1.1.1",
        date: "2026-09-29",
        sections: {
            added: [
                "**Edit Image, like Discord's.** Drag, zoom and rotate your wallpaper in a preview shaped like your window.",
                "**Your wallpaper on the login screen.** It shows behind Discord's login page, with the login box frosted over it.",
                "**Delete themes you made.** Themes you made or added yourself have a delete button now.",
            ],
            improved: [
                "**Simpler wallpaper settings.** Show it, dim it and choose how see-through Discord is. Everything else is under More options.",
                "**A new supporter page.** Your level, when the next one comes and what you get, in Account. The credits in Updates show everyone's face.",
                "Supporter badges keep their level's colour: custom badge colours are gone.",
            ],
            fixed: [
                "**The wallpaper shows again.** Discord's own backdrop and the member list were covering it.",
                "**Reordering your badges saves again.** Discord refused the whole save because of Evi's badges; now your order reaches everyone.",
            ],
        },
    },
    {
        version: "1.1.0",
        date: "2026-09-28",
        sections: {
            added: [
                "**Evi speaks your language.** Evi, every plugin and the store follow Discord's language: German, Spanish, French, Japanese, Polish, Portuguese, Russian and Turkish, besides English.",
                "**Place your wallpaper.** Fill, Fit, Stretch, Center or Tile it, then drag and zoom it in a live preview of Discord.",
                "**Choose what's see-through.** Set how solid the server list, channels, chat and message box stay over the wallpaper, and tint them with your theme's colors.",
            ],
            improved: [
                "**Discord is much smoother.** Evi takes out a hidden Discord style rule that made the whole app restyle itself whenever anything changed, like someone talking in a call: in a busy call the longest stall went from about 100 ms to 15 ms, and settings open faster. Discord's fonts load in the background too, so text doesn't jump the first time a style is used.",
                "**Smaller updates.** From the next version on, updating Evi downloads just its files, a few MB, instead of the whole 100 MB installer.",
                "**Settings and popouts stay solid.** The wallpaper only shows behind Discord's main window, unless you turn it on for settings or popouts too.",
                "**View source shows the real code.** On a community plugin's page it opens the exact code Evi installs, with the author's own link next to it.",
            ],
            fixed: [
                "The theme editor keeps a theme's translations when you save it.",
            ],
        },
    },
    {
        version: "1.0.0",
        date: "2026-09-28",
        cover: "1.0.0",
        sections: {
            added: [
                "**A store front page.** What's trending, what's new this week, staff picks and collections put together by Evi's team, before the full list.",
                "**Ratings and reviews.** Rate plugins you use and say why, in a few lines. Reviews anyone can report go to Evi's team.",
                "**Plugin pages show more.** A video or GIF of it in use, what people who run it also install, known issues, and a note from its author about the version.",
                "**A wishlist and an inbox.** Heart anything in the store to hear when it updates, gets a beta or works again. Reviews of your plugins, your uploads and news from authors you follow land in the new Inbox too.",
                "**Follow authors.** Author pages have a banner, pinned plugins, how many run their plugins, and a Follow button.",
                "**Plugin betas.** Authors can publish a beta next to the stable version, and you can opt into any plugin's betas from its page.",
                "**Dynamic Wallpaper.** An image or video behind Discord, dimmed so text stays readable, and paused on battery.",
                "**Crash Detective.** When Discord crashes or freezes, Evi says which plugin was busiest right before and offers to turn it off.",
                "**Updates in the background.** Turn it on in Updates, and new versions download on their own and install when you close Discord.",
                "**Keyboard shortcuts for plugins.** Set one in a plugin's settings by pressing the keys, like Discord's keybinds. Streamer Mode+ and Game Activity Toggle have one, and the field says when two plugins want the same keys.",
                "**Supporter perks.** Your supporter badge in a colour of your own, your name in the credits if you like, and Aurora, a theme for supporters.",
                "**Who Reacted.** Small avatars of who reacted, right on each reaction next to its count.",
                "**Typing Tweaks.** See who's typing at a glance: avatars and role colours in the \"is typing\" line, and three dots on channels and DMs while someone types there.",
                "**For plugin authors:** Evi DevTools (live Flux events, stores, patch hits and timings), API docs on hover in the Patch Helper, a public plugin API changelog, anonymous install and crash numbers on your dashboard, and `bun run new-plugin` / `bun run preview-plugin` to start and check a plugin.",
            ],
            improved: [
                "**Search finds settings, not just plugins.** Searching the Plugins tab looks through every plugin's settings too, and opening one from the results takes you to the setting.",
                "**Show only what you don't have yet** with the store's new Not installed filter, and sort by rating or what's trending.",
                "Streamer Mode+ keeps the shortcut you typed in, now as a recorded one.",
                "Plugin authors see how many use their plugins: once a day Evi tells evi.rest which store plugins it has, anonymously. Turn it off in the store's settings.",
                "Quick Actions is no longer part of Evi, and is removed when Evi updates.",
                "**View Icons moved into profiles.** Click someone's banner to open it full size like their avatar, and Download sits next to zoom. The right-click menu items are gone.",
            ],
            fixed: [
                "**Message Logger keeps deleted pictures, videos and files.** Discord deletes them from its servers with the message, so they used to show broken. Edits that remove an attachment keep it with the old version too.",
            ],
        },
    },
    {
        version: "0.7.0",
        date: "2026-09-28",
        sections: {
            added: [
                "**Plugins say what they need, and Evi holds them to it.** Which sites a plugin contacts, and whether it reads your messages, sends messages or changes your settings. Evi blocks the rest of what it tries through Evi, and anything blocked shows in the plugin's Activity.",
                "**Evi fixes plugins Discord breaks, without waiting for an update.** When a Discord update breaks a plugin, Evi's team repairs it on evi.rest and every install picks up the fix within minutes. The plugin's details say what was fixed.",
                "**Make your own theme.** Pick colours in the new Editor tab and watch Discord change as you go, then save it as a theme of your own.",
                "**Community themes.** Send a theme to the Theme Store from the editor or your dashboard. Evi's team reviews each one, and community themes can't load anything from the internet, so nobody learns who uses them.",
                "**DM Categories.** Sort your DMs into collapsible categories like Friends, Work or Gaming, at the top of your DM list. Right-click a DM to add it to one.",
                "**View Icons.** Right-click someone for their avatar and banner at full size, or a server for its icon and banner, in Discord's image viewer. Download the original or copy its link.",
                "**Calm Name Effects.** Opening a chat takes half the work: Nitro name styles like Prism and Neon animate while you hover a name, instead of on every message at once.",
            ],
            improved: [
                "**An update that asks for more waits for your OK,** like full access does. Store pages, install questions and plugin details list what each plugin asks for, and older plugins that don't say are labelled.",
                "**The store knows a fix is working.** A plugin Evi fixed shows as fixed instead of broken, and goes back to broken only if installs running the fix still have problems.",
                "Themes in the store can be reported, like plugins.",
            ],
            fixed: [
                "Platform Indicators' icon no longer grows to fill a whole message in places Evi's styles don't reach, like pop-out chats.",
            ],
        },
    },
    {
        version: "0.6.1",
        date: "2026-09-27",
        sections: {
            fixed: [
                "**Smooth Typing no longer brings back a message you just sent** into the text box. Switching channels and slash commands keep the box up to date too.",
                "A plugin that Evi turned off, or that has a problem to explain, keeps its card size in the Plugins list instead of stretching across it.",
            ],
        },
    },
    {
        version: "0.6.0",
        date: "2026-09-27",
        sections: {
            improved: [
                "**No more stutters from Evi.** Finding Discord's parts used to search all of Discord's code, 10 to 20 ms at a time, and a missing one was searched again every second. Now it's found once, and every later look is instant.",
                "**Plugins do their heavy work in small pieces,** between everything else: Fast Lists, Read All, GIF Folders and Last Seen's saving no longer hold Discord up.",
                "**Show Hidden Channels remembers who can see what,** instead of asking again for every channel on every redraw.",
                "**Faster Message Logger, Inline Translate, Platform Indicators, Voice Activity Log, Relationship Notifier, Hide Blocked, Timezones, Friend Online Alerts, Streamer Mode+, Silent Typing and Snippets.**",
                "The background plugin health check is much lighter.",
            ],
            fixed: [
                "**A plugin Evi turns off everywhere goes off within seconds,** with a notice, instead of at the next half-hourly check or restart.",
            ],
        },
    },
    {
        version: "0.5.3",
        date: "2026-09-27",
        sections: {
            fixed: [
                "The Plugin Author badge opens its details when you click it, and can be hidden and moved in Customize your badges.",
            ],
        },
    },
    {
        version: "0.5.2",
        date: "2026-09-27",
        sections: {
            improved: [
                "**Update checks go through evi.rest,** so a busy network no longer runs into GitHub's limit and says Evi can't check for updates.",
                "**Installing a plugin with full access asks in a dialog,** instead of a box squeezed into its card.",
                "**Icons on every tab,** so Installed and Store are told apart at a glance.",
                "**Every release gets its dotted cover** in What's new.",
            ],
            fixed: [
                "Opening the Store no longer scrolls Discord's settings down a bit.",
            ],
        },
    },
    {
        version: "0.5.1",
        date: "2026-09-27",
        sections: {
            added: [
                "**Community plugins with a native part.** Authors can submit a native.js with their plugin. Evi's team reads all of it before it goes in, and Evi still asks you before installing anything with full access.",
            ],
            fixed: [
                "Opening Evi's pages in Discord's settings no longer crashes Discord.",
            ],
        },
    },
    {
        version: "0.5.0",
        date: "2026-09-27",
        sections: {
            added: [
                "**Evi Setup.** A small installer with a window: pick your Discord, click Install Evi or Uninstall Evi. It checks for a newer Evi first and downloads it, so it's a few MB instead of over 100.",
                "**Evi in your language.** Evi's menus follow Discord's language: Spanish, Portuguese, French, German, Turkish, Russian, Polish and Japanese. Plugins can be translated too.",
                "**See what a plugin did.** A plugin's details list the sites it contacted and when, and point out ones its code never mentions.",
                "**Beta versions.** Turn on Get beta versions in Updates to get new Evi versions a few days early.",
                "**Plugin Author badge.** Anyone whose plugin makes it into the store gets it on their profile.",
            ],
            improved: [
                "Turning a plugin on or off no longer freezes Discord for a moment.",
                "**Supporter levels come monthly.** A new badge every month for your first six months, from Silver at one month to Ruby at six, then Prismatic at one year.",
            ],
            fixed: [
                "Clicking a plugin's switch no longer scrolls Discord's settings away from it.",
            ],
        },
    },
    {
        version: "0.4.0",
        date: "2026-09-27",
        cover: "0.4.0",
        sections: {
            added: [
                "**Community plugins in the store.** Plugin authors can now publish their own plugins on evi.rest. Evi's team reads every version before it goes in, and community plugins are labelled so you always know who made what.",
                "**Verified authors.** Every plugin shows who made it, with a check for verified authors. Click a name to see their other plugins.",
                "**Send a crash report to the author.** Next to Copy crash report. You see exactly what's sent before it goes, and nothing personal is in it.",
                "**Know when a plugin is broken.** If a plugin stops working for lots of people after a Discord update, the store and your Plugins list say so, often with a note from its author about the fix.",
                "**Report a plugin.** Something harmful, fake or broken? Report it from its store page. Reports go to Evi's team.",
                "**Evi can turn off a bad plugin everywhere.** If a plugin turns out to be harmful, Evi switches it off on every install and tells you why.",
            ],
            improved: [
                "**A What's new that looks like Evi.** The release's cover across the top, and each kind of change under its own label.",
                "**Popups wait for Discord.** What's new, plugin changelogs and the update notice show once Discord has loaded, not over its loading screen.",
                "**Supporter badges level up faster.** Prismatic is now one year of support instead of five.",
                "**Plugin badges in Your badges.** Badges plugins add to profiles, like Last Seen's clock and Platform Indicators' device, are listed in Discord's badge directory too.",
                "**Safer by design.** Turning on a plugin with full access to your computer always asks you in a system dialog that no plugin can answer for you.",
            ],
            fixed: [
                "Installing a plugin from the store always turns it on. It used to say it had, and sometimes hadn't.",
                "Dropdowns in a plugin's settings open on the first click. In Discord's settings they often closed again right away.",
            ],
        },
    },
    {
        version: "0.3.2",
        date: "2026-09-27",
        cover: "0.3.2",
        sections: {
            improved: [
                "**Dialogs and menus move like Discord's.** Evi's dialogs, notices and plugin menus now spring open and fade away instead of popping in and vanishing.",
                "**A cleaner Voice Activity Log**, with sessions listed by channel and a proper search field.",
            ],
        },
    },
    {
        version: "0.3.1",
        date: "2026-09-27",
        cover: "0.3.1",
        sections: {
            added: [
                "**Evi on macOS and Linux.** Download the installer for your system from the release and run `evi install`. On Linux, run it with sudo.",
            ],
        },
    },
    {
        version: "0.3.0",
        date: "2026-09-27",
        sections: {
            added: [
                "**Evi badges are part of Evi.** They show on profiles for everyone using Evi, and can't be turned off by accident.",
                "**Hide and reorder your Evi badges** in Discord's own Customize your badges. Everyone sees the change within seconds.",
                "**Supporter badges that level up.** From Bronze to Prismatic the longer you support Evi, with your progress in Your badges.",
                "**Update Evi from the app.** Evi says when a new version is out, and one button installs it.",
            ],
            improved: [
                "Badges update live instead of every half hour.",
                "Every plugin can be removed, including the ones Evi comes with, and they stay removed when Evi updates.",
            ],
        },
    },
    {
        version: "0.2.0",
        date: "2026-09-26",
        cover: "store",
        sections: {
            added: [
                "**The Plugin Store now lives in the Plugins tab.** Every plugin gets its own page with screenshots, its changelog, its source and what it can access.",
                "**Theme Store.** Install and update themes right from the Themes tab.",
                "**Update all, and automatic updates if you want them.** Plugins with full access to your computer still ask first.",
                "**Crash reports.** A plugin that fails to start has a Copy crash report button for its author.",
            ],
            improved: [
                "Browse the store by category, and sort it by name or most recently updated.",
                "Update and uninstall store plugins right from the Plugins list.",
                "Turn every plugin off, or reset them all to their defaults, with one click and an undo.",
            ],
        },
    },
    {
        version: "0.1.0",
        date: "2026-09-20",
        cover: "hello",
        sections: {
            added: ["**First release.** Plugins, themes, Quick CSS, backups, safe mode and the plugin store."],
        },
    },
];

/**
 * The release as `locale` reads it: each section in that language where there's a translation,
 * in English where there isn't. Locales match like Evi's menus (`pt-BR`, `de-AT` -> `de`).
 */
export function localizedRelease(release: Release, locale: string | null | undefined, locales = CHANGELOG_LOCALES): Release {
    const lang = matchLocale(locale, Object.keys(locales));
    const notes = lang ? locales[lang]?.[release.version] : undefined;
    if (!notes) return release;
    const sections: Release["sections"] = { ...release.sections };
    for (const kind of SECTION_KINDS) if (notes[kind]?.length) sections[kind] = notes[kind];
    return { ...release, sections };
}

/** Releases newer than `seen`, up to and including `current`. Nothing on a first run (no `seen`). */
export function releasesSince(seen: string | undefined, current: string, releases = RELEASES) {
    if (!seen) return [];
    return releases.filter(r => compareVersions(r.version, seen) > 0 && compareVersions(r.version, current) <= 0);
}

/** The newest release up to `current`, what the panel's "What's new" link shows */
export function latestRelease(current: string, releases = RELEASES) {
    return releases.find(r => compareVersions(r.version, current) <= 0);
}

/**
 * Several releases as one changelog, like Discord shows one per update: newest first within each
 * section, dated and pictured by the newest. For when you skipped a version or two.
 */
export function mergeReleases(releases: Release[]): Release {
    const sections: Release["sections"] = {};
    for (const kind of SECTION_KINDS) {
        const lines = releases.flatMap(r => r.sections[kind] ?? []);
        if (lines.length) sections[kind] = lines;
    }
    const cover = releases.find(r => r.cover)?.cover;
    return { version: releases[0].version, date: releases[0].date, ...cover && { cover }, sections };
}

const NOTES_HEADINGS: Record<SectionKind, string> = { added: "New", improved: "Improved", fixed: "Fixed", progress: "In progress" };

/**
 * A release's notes as the markdown on its GitHub release, which Evi's Updates tab, `evi update` and
 * evi.rest's releases page all show. Written by the release workflow (scripts/release-notes.ts), so
 * the entry here is the only place a release's notes are written.
 */
export function releaseMarkdown(release: Release) {
    return SECTION_KINDS
        .filter(kind => release.sections[kind]?.length)
        .map(kind => `## ${NOTES_HEADINGS[kind]}\n${release.sections[kind]!.map(line => `- ${line}`).join("\n")}`)
        .join("\n\n") + "\n";
}
