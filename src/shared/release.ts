/**
 * Evi's own releases: published on GitHub with an installer per system and its .sha256 attached. Read
 * by the CLI's `evi update` and by the app's Updates page, which installs a new release with one click.
 */
import { compareVersions, isVersion } from "./store";

export const RELEASE_REPO = "BleedDev/evi";

/** evi.rest's mirror of GitHub's release API: same paths and JSON, without GitHub's 60 calls an hour per address */
export const RELEASE_MIRROR_API = "https://evi.rest/v1/github";
export const GITHUB_API = "https://api.github.com";

/**
 * Where to ask for releases, in order: evi.rest's mirror, then GitHub itself. An override (EVI_UPDATE_API,
 * what the tests use) is the only place asked.
 */
export function releaseApis(override?: string): string[] {
    const api = override?.trim().replace(/\/+$/, "");
    return api ? [api] : [RELEASE_MIRROR_API, GITHUB_API];
}

/**
 * GETs `<api>/repos/BleedDev/evi/<path>` from each API in turn, moving on to the next when one can't be
 * reached, times out or answers 5xx. Anything else (a release, a 404, GitHub's 403) is the answer. The
 * last API's failure is thrown or returned as is.
 */
export async function fetchReleaseApi(apis: string[], path: string, get: (url: string) => Promise<Response>): Promise<Response> {
    if (!apis.length) throw new Error("No release API to ask");
    for (let i = 0; ; i++) {
        const last = i === apis.length - 1;
        let res: Response;
        try {
            res = await get(`${apis[i]}/repos/${RELEASE_REPO}/${path}`);
        } catch (err) {
            if (last) throw err;
            continue;
        }
        if (res.status < 500 || last) return res;
        // Let the connection go before asking the next one
        await res.body?.cancel().catch(() => { });
    }
}

/** Every installer a release carries, each with a <name>.sha256 beside it */
export const RELEASE_ASSETS = ["evi.exe", "evi-macos-arm64", "evi-macos-x64", "evi-linux-x64", "evi-linux-arm64"] as const;

/** The installer for a system: evi.exe on Windows, evi-<macos|linux>-<arm64|x64> elsewhere */
export function exeAsset(platform: string = globalThis.process?.platform, arch: string = globalThis.process?.arch) {
    const cpu = arch === "arm64" ? "arm64" : "x64";
    if (platform === "darwin") return `evi-macos-${cpu}`;
    if (platform === "linux") return `evi-linux-${cpu}`;
    return "evi.exe";
}

export const EXE_ASSET = exeAsset();
export const CHECKSUM_ASSET = `${EXE_ASSET}.sha256`;
/** Evi's own files (core and official plugins) as one JSON, a few MB: what Evi Setup downloads, and what updates install */
export const CORE_ASSET = "evi-core.json";
export const CORE_CHECKSUM_ASSET = `${CORE_ASSET}.sha256`;
/** The same, gzipped: about a quarter of the download. Its checksum is the plain file's */
export const CORE_GZ_ASSET = `${CORE_ASSET}.gz`;

/** Discord's install folders in %LOCALAPPDATA%, by flavor. Also its executable's name on every system, minus spaces and .exe */
export const FLAVORS = {
    stable: "Discord",
    ptb: "DiscordPTB",
    canary: "DiscordCanary",
    development: "DiscordDevelopment",
} as const;

export type Flavor = keyof typeof FLAVORS;

/**
 * Which Discord a path belongs to. On Windows its exe lives in %LOCALAPPDATA%\<Flavor folder>\app-x.y.z\;
 * on macOS it's Discord PTB.app/Contents/MacOS/Discord PTB, on Linux /usr/share/discord-ptb/DiscordPTB.
 */
export function flavorOf(execPath: string): Flavor | undefined {
    const parts = execPath.split(/[\\/]/);
    const folder = parts[parts.length - 3]?.toLowerCase();
    const byFolder = (Object.keys(FLAVORS) as Flavor[]).find(f => FLAVORS[f].toLowerCase() === folder);
    if (byFolder) return byFolder;
    const exe = parts[parts.length - 1].replace(/\.exe$/i, "").replace(/\s+/g, "").toLowerCase();
    return (Object.keys(FLAVORS) as Flavor[]).find(f => FLAVORS[f].toLowerCase() === exe);
}

/** "v1.2.3-beta.1+build" -> "1.2.3-beta.1". The prerelease part stays: 0.5.0-beta.1 comes before 0.5.0 */
export const cleanVersion = (tag: string) => tag.trim().replace(/^v/i, "").split("+")[0];

/** A beta like 0.5.0-beta.1 */
export const isPrerelease = (version: string) => cleanVersion(version).includes("-");

export const isNewerRelease = (tag: string, current: string) => compareVersions(cleanVersion(tag), cleanVersion(current)) > 0;

/**
 * The release to offer from GitHub's /releases list: the highest version that isn't a draft, counting
 * prereleases only with beta on. Tags that aren't versions are skipped. Undefined if none qualifies.
 */
export function pickRelease(list: unknown, beta: boolean): any {
    if (!Array.isArray(list)) return;
    let best: any;
    for (const r of list) {
        if (!r || typeof r !== "object" || typeof r.tag_name !== "string" || r.draft) continue;
        if (!beta && (r.prerelease || isPrerelease(r.tag_name))) continue;
        if (!isVersion(cleanVersion(r.tag_name))) continue;
        if (!best || compareVersions(cleanVersion(r.tag_name), cleanVersion(best.tag_name)) > 0) best = r;
    }
    return best;
}

export interface ReleaseInfo {
    tag: string;
    version: string;
    /** The release page */
    url: string;
    /** Release notes as written on GitHub (markdown), trimmed */
    notes: string;
    publishedAt: string | null;
    /** A beta: marked as a prerelease on GitHub, or a version like 0.5.0-beta.1 */
    prerelease: boolean;
    /** The evi CLI for this system and its checksum. Releases from 1.5.0 on don't carry it: Evi Setup replaced it */
    exeUrl?: string;
    checksumUrl?: string;
    /** evi-core.json and its checksum: updating needs only these. Missing on releases from before Evi Setup */
    coreUrl?: string;
    coreChecksumUrl?: string;
    /** evi-core.json.gz, which updates try first. Only with coreUrl, and missing on older releases */
    coreGzUrl?: string;
}

function isGithubPage(url: unknown): url is string {
    if (typeof url !== "string") return false;
    try {
        const u = new URL(url);
        return u.protocol === "https:" && u.hostname === "github.com";
    } catch {
        return false;
    }
}

/** Where Evi's release files are downloaded from: this repo's releases on GitHub, over https */
export const RELEASE_DOWNLOADS = `https://github.com/${RELEASE_REPO}/releases/download/`;

/** A release file's URL when it's one of Evi's own on GitHub, as the URL that was checked */
function releaseDownload(url: unknown, downloads: string): string | undefined {
    if (typeof url !== "string") return;
    try {
        const u = new URL(url), prefix = new URL(downloads);
        if (u.protocol !== prefix.protocol || u.host !== prefix.host || u.username || u.password) return;
        return u.pathname.toLowerCase().startsWith(prefix.pathname.toLowerCase()) ? u.href : undefined;
    } catch {
        return undefined;
    }
}

/**
 * One release as GitHub's API describes it, or undefined if it isn't a usable release. Its files count
 * only where they're downloaded from `downloads` (Evi's repo on GitHub): the checksum comes from the
 * same answer, so it can't vouch for a file from anywhere else.
 */
export function parseRelease(json: any, downloads = RELEASE_DOWNLOADS): ReleaseInfo | { error: string; } | undefined {
    if (!json || typeof json !== "object" || typeof json.tag_name !== "string" || json.draft) return;
    const asset = (name: string) => Array.isArray(json.assets) ? releaseDownload(json.assets.find((a: any) => a?.name === name)?.browser_download_url, downloads) : undefined;
    const exeUrl = asset(EXE_ASSET), checksumUrl = asset(CHECKSUM_ASSET);
    const coreUrl = asset(CORE_ASSET), coreChecksumUrl = asset(CORE_CHECKSUM_ASSET);
    const hasCore = typeof coreUrl === "string" && typeof coreChecksumUrl === "string";
    const coreGzUrl = hasCore ? asset(CORE_GZ_ASSET) : undefined;
    const hasExe = typeof exeUrl === "string" && typeof checksumUrl === "string";
    // Updating needs evi-core.json; releases from before it had only the CLI
    if (!hasCore && !hasExe) return { error: `Release ${json.tag_name} is missing ${exeUrl ? CHECKSUM_ASSET : coreUrl ? CORE_CHECKSUM_ASSET : CORE_ASSET}` };
    return {
        tag: json.tag_name,
        version: cleanVersion(json.tag_name),
        // Shown as a link: only ever a page on GitHub, whatever the mirror sent
        url: isGithubPage(json.html_url) ? json.html_url : `https://github.com/${RELEASE_REPO}/releases`,
        notes: typeof json.body === "string" ? json.body.trim().slice(0, 4000) : "",
        publishedAt: typeof json.published_at === "string" ? json.published_at : null,
        prerelease: json.prerelease === true || isPrerelease(json.tag_name),
        ...hasExe && { exeUrl, checksumUrl },
        ...hasCore && { coreUrl, coreChecksumUrl },
        ...coreGzUrl && { coreGzUrl },
    };
}

export type UpdateStatus =
    /** Nothing published on GitHub yet */
    | { state: "none"; current: string; checkedAt: number; }
    | { state: "current"; current: string; latest: string; checkedAt: number; }
    /** installable is false for a dev build, which updates with git instead, or where Discord's folder isn't ours to write; blocked says which */
    /** ready: with silent updates on, it's downloaded and installs when Discord quits */
    | { state: "available"; current: string; release: ReleaseInfo; installable: boolean; blocked?: string; ready?: boolean; checkedAt: number; }
    | { state: "error"; current: string; error: string; checkedAt: number; };

export interface UpdateProgress {
    phase: "downloading" | "verifying" | "installing";
    /** Bytes so far and in all, while downloading */
    done?: number;
    total?: number;
}

export type UpdateInstallResult = { ok: true; version: string; } | { ok: false; error: string; };
