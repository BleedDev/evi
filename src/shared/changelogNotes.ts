/**
 * What's new without its data: the shape of a release and the helpers that pick and merge them.
 * The notes themselves (changelog.ts), their translations (changelogLocales.ts) and the covers stay
 * out of the renderer and main.js: the build writes them to releases.json next to main.js
 * (scripts/coreData.ts), and main reads it when What's new opens (main/whatsNew.ts).
 */
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

/** Language -> version -> section -> lines, like CHANGELOG_LOCALES */
export type ReleaseLocales = Record<string, Record<string, Release["sections"]>>;

/** releases.json: everything What's new can show */
export interface ReleaseData {
    releases: Release[];
    locales: ReleaseLocales;
    /** Cover name -> SVG, the ones Evi bundles (src/renderer/ui/covers) */
    covers: Record<string, string>;
}

/** What the modal shows: the releases as one, in the reader's language, and the cover's SVG when Evi has it */
export interface WhatsNewNotes {
    release: Release;
    coverSvg?: string;
}

/**
 * The release as `locale` reads it: each section in that language where there's a translation,
 * in English where there isn't. Locales match like Evi's menus (`pt-BR`, `de-AT` -> `de`).
 */
export function localizedRelease(release: Release, locale: string | null | undefined, locales: ReleaseLocales): Release {
    const lang = matchLocale(locale, Object.keys(locales));
    const notes = lang ? locales[lang]?.[release.version] : undefined;
    if (!notes) return release;
    const sections: Release["sections"] = { ...release.sections };
    for (const kind of SECTION_KINDS) if (notes[kind]?.length) sections[kind] = notes[kind];
    return { ...release, sections };
}

/** Releases newer than `seen`, up to and including `current`. Nothing on a first run (no `seen`). */
export function releasesSince(seen: string | undefined, current: string, releases: Release[]) {
    if (!seen) return [];
    return releases.filter(r => compareVersions(r.version, seen) > 0 && compareVersions(r.version, current) <= 0);
}

/** The newest release up to `current`, what the panel's "What's new" link shows */
export function latestRelease(current: string, releases: Release[]) {
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

/**
 * What's new for `locale`: the releases since `seen` up to `current` after an update, or with `seen`
 * null the newest one (the panel's link). Null when there's nothing to show.
 */
export function whatsNewNotes(data: ReleaseData, seen: string | null, current: string, locale: string): WhatsNewNotes | null {
    const latest = seen === null ? latestRelease(current, data.releases) : undefined;
    const releases = seen === null ? latest ? [latest] : [] : releasesSince(seen, current, data.releases);
    if (!releases.length) return null;
    const release = mergeReleases(releases.map(r => localizedRelease(r, locale, data.locales)));
    const coverSvg = release.cover ? data.covers[release.cover] : undefined;
    return { release, ...coverSvg && { coverSvg } };
}
