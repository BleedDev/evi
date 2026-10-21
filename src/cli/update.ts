import { renameSync, rmSync, writeFileSync } from "fs";

import { CHECKSUM_ASSET, cleanVersion, EXE_ASSET, fetchReleaseApi, isNewerRelease, pickRelease, releaseApis } from "../shared/release";

/** evi.rest's mirror of GitHub's release API, then GitHub itself. EVI_UPDATE_API alone when set: tests serve fake releases from a local server */
const APIS = releaseApis(process.env.EVI_UPDATE_API);
const HEADERS = { "User-Agent": "evi-cli", Accept: "application/vnd.github+json" };

export class UpdateError extends Error { }

export interface Release {
    tag: string;
    version: string;
    url: string;
    /** Missing since 1.5.0: releases stopped carrying the CLI */
    exeUrl?: string;
    checksumUrl?: string;
}

interface GitHubRelease {
    tag_name: string;
    html_url: string;
    draft: boolean;
    assets: { name: string; browser_download_url: string; }[];
}

/** True when running as the compiled installer rather than `bun src/cli/index.ts` */
export const COMPILED = !/^bun(-debug)?(\.exe)?$/i.test(process.execPath.split(/[\\/]/).pop() ?? "");

/** Prereleases count: 0.5.0-beta.1 is newer than 0.4.0 and older than 0.5.0 */
export const isNewer = isNewerRelease;

async function request(url: string, timeout: number) {
    try {
        return await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(timeout) });
    } catch (e) {
        throw new UpdateError(`Couldn't reach ${new URL(url).host}: ${e instanceof Error ? e.message : e}`);
    }
}

/**
 * The latest published release, or null if nothing has been published yet. Drafts never show up, and
 * prereleases only with beta: /releases/latest skips them, so that picks the newest from the list instead.
 */
export async function fetchLatestRelease(beta = false): Promise<Release | null> {
    const res = await fetchReleaseApi(APIS, beta ? "releases?per_page=30" : "releases/latest", url => request(url, 15_000));
    if (res.status === 404) return null;
    if (res.status === 403 || res.status === 429) throw new UpdateError("GitHub's API rate limit was hit. Try again in a few minutes.");
    if (!res.ok) throw new UpdateError(`GitHub answered ${res.status} ${res.statusText}`);

    const json = await res.json();
    const data: GitHubRelease | undefined = beta ? pickRelease(json, true) : json;
    if (!data || data.draft) return null;
    const asset = (name: string) => data.assets.find(a => a.name === name)?.browser_download_url;
    return { tag: data.tag_name, version: cleanVersion(data.tag_name), url: data.html_url, exeUrl: asset(EXE_ASSET), checksumUrl: asset(CHECKSUM_ASSET) };
}

/** Why this release can't replace the CLI, if it can't */
export function missingExe(release: Release) {
    if (release.exeUrl && release.checksumUrl) return;
    if (release.exeUrl) return `Release ${release.tag} is missing ${CHECKSUM_ASSET}`;
    return `Release ${release.tag} doesn't include the evi CLI (releases stopped carrying it at 1.5.0). Build it from a source checkout with \`bun scripts/build.ts --cli\`.`;
}

async function download(url: string, timeout: number) {
    const res = await request(url, timeout);
    if (!res.ok) throw new UpdateError(`Download failed: ${res.status} ${res.statusText} (${url})`);
    try {
        return new Uint8Array(await res.arrayBuffer());
    } catch (e) {
        throw new UpdateError(`Download interrupted: ${e instanceof Error ? e.message : e}`);
    }
}

/** Downloads the release's installer for this system and checks it against the published SHA-256 */
export async function downloadVerified(release: Release) {
    const { exeUrl, checksumUrl } = release;
    if (!exeUrl || !checksumUrl) throw new UpdateError(missingExe(release));
    const checksumText = new TextDecoder().decode(await download(checksumUrl, 30_000));
    const expected = checksumText.match(/\b[a-f0-9]{64}\b/i)?.[0].toLowerCase();
    if (!expected) throw new UpdateError(`${CHECKSUM_ASSET} doesn't contain a SHA-256 hash`);

    const exe = await download(exeUrl, 10 * 60_000);
    const actual = new Bun.CryptoHasher("sha256").update(exe).digest("hex");
    if (actual !== expected) throw new UpdateError(`Checksum mismatch, the download was not installed.\n  expected ${expected}\n  got      ${actual}`);
    return exe;
}

/**
 * Windows lets a running exe be renamed but not overwritten, so the current one moves aside
 * to .old and the new one takes its name. The .old is removed on the next run.
 */
export function replaceExecutable(exe: string, bytes: Uint8Array) {
    const next = `${exe}.new`;
    const old = `${exe}.old`;
    writeFileSync(next, bytes, { mode: 0o755 });
    try {
        rmSync(old, { force: true });
        renameSync(exe, old);
    } catch (e) {
        rmSync(next, { force: true });
        throw new UpdateError(`Couldn't move ${exe} aside: ${e instanceof Error ? e.message : e}`);
    }
    try {
        renameSync(next, exe);
    } catch (e) {
        renameSync(old, exe);
        rmSync(next, { force: true });
        throw new UpdateError(`Couldn't put the new version in place: ${e instanceof Error ? e.message : e}`);
    }
}

/** Leftovers from a previous self-update. The .old stays locked while that older process is still running, which is fine. */
export function cleanupPreviousUpdate(exe: string) {
    for (const leftover of [`${exe}.old`, `${exe}.new`]) {
        try {
            rmSync(leftover, { force: true });
        } catch { }
    }
}
