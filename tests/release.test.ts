import { describe, expect, test } from "bun:test";

import { cleanVersion, exeAsset, fetchReleaseApi, flavorOf, GITHUB_API, isNewerRelease, parseRelease, RELEASE_MIRROR_API, releaseApis } from "../src/shared/release";

const asset = (name: string) => ({ name, browser_download_url: `https://github.com/BleedDev/evi/releases/download/v0.3.0/${name}` });

describe("Evi's releases", () => {
    test("a published release with the exe and its checksum", () => {
        const release = parseRelease({
            tag_name: "v0.3.0", html_url: "https://github.com/BleedDev/evi/releases/tag/v0.3.0", draft: false,
            body: "  ## New\n- Updates from the app  ", published_at: "2026-09-27T10:00:00Z",
            assets: [asset("evi.exe"), asset("evi.exe.sha256")],
        });
        expect(release).toEqual({
            tag: "v0.3.0", version: "0.3.0", url: "https://github.com/BleedDev/evi/releases/tag/v0.3.0",
            notes: "## New\n- Updates from the app", publishedAt: "2026-09-27T10:00:00Z", prerelease: false,
            exeUrl: asset("evi.exe").browser_download_url, checksumUrl: asset("evi.exe.sha256").browser_download_url,
        });
    });

    test("a release without the CLI, only Evi Setup and evi-core.json, still updates", () => {
        const release = parseRelease({ tag_name: "v1.5.0", assets: [asset("Evi-Setup.exe"), asset("evi-core.json"), asset("evi-core.json.sha256")] });
        expect(release).toMatchObject({ version: "1.5.0", coreUrl: asset("evi-core.json").browser_download_url, coreChecksumUrl: asset("evi-core.json.sha256").browser_download_url });
        expect(release).not.toHaveProperty("exeUrl");
    });

    test("drafts and junk aren't releases; a missing file is said plainly", () => {
        expect(parseRelease({ tag_name: "v0.3.0", draft: true, assets: [] })).toBeUndefined();
        expect(parseRelease(null)).toBeUndefined();
        expect(parseRelease({ tag_name: "v0.3.0", assets: [asset("evi.exe")] })).toEqual({ error: "Release v0.3.0 is missing evi.exe.sha256" });
        expect(parseRelease({ tag_name: "v0.3.0", assets: [] })).toEqual({ error: "Release v0.3.0 is missing evi-core.json" });
    });

    test("files only count when they're Evi's own on GitHub, whatever the mirror sent", () => {
        const core = (url: string) => parseRelease({ tag_name: "v1.5.0", assets: [{ name: "evi-core.json", browser_download_url: url }, asset("evi-core.json.sha256")] });
        for (const url of [
            "http://github.com/BleedDev/evi/releases/download/v1.5.0/evi-core.json",
            "https://evil.example/BleedDev/evi/releases/download/v1.5.0/evi-core.json",
            "https://github.com/someone/else/releases/download/v1.5.0/evi-core.json",
            "https://github.com/BleedDev/evi/releases/download/../../../someone/else/releases/download/v1/evi-core.json",
            "https://github.com/BleedDev/evi/releases/download/%2e%2e/%2e%2e/%2e%2e/someone/evi-core.json",
            "https://github.com@evil.example/BleedDev/evi/releases/download/v1.5.0/evi-core.json",
            "https://github.com:8443/BleedDev/evi/releases/download/v1.5.0/evi-core.json",
            "not a url",
        ]) {
            expect(core(url)).toEqual({ error: "Release v1.5.0 is missing evi-core.json" });
        }
        expect(core("https://github.com/BleedDev/evi/releases/download/v1.5.0/evi-core.json")).toMatchObject({ coreUrl: "https://github.com/BleedDev/evi/releases/download/v1.5.0/evi-core.json" });
        // A local test server can stand in for GitHub when asked
        expect(parseRelease({ tag_name: "v1.5.0", assets: ["evi-core.json", "evi-core.json.sha256"].map(name => ({ name, browser_download_url: `http://127.0.0.1:4000/download/${name}` })) }, "http://127.0.0.1:4000/download/"))
            .toMatchObject({ coreUrl: "http://127.0.0.1:4000/download/evi-core.json" });
    });

    test("versions", () => {
        expect(cleanVersion("v1.2.3-beta")).toBe("1.2.3-beta");
        expect(isNewerRelease("v0.3.0", "0.2.0")).toBe(true);
        expect(isNewerRelease("v0.2.0", "0.2.0")).toBe(false);
        expect(isNewerRelease("v0.10.0", "0.9.9")).toBe(true);
    });

    test("which Discord a path is", () => {
        expect(flavorOf("C:\\Users\\a\\AppData\\Local\\Discord\\app-1.0.9259\\Discord.exe")).toBe("stable");
        expect(flavorOf("C:\\Users\\a\\AppData\\Local\\DiscordPTB\\app-1.0.1\\DiscordPTB.exe")).toBe("ptb");
        expect(flavorOf("C:/Users/a/AppData/Local/DiscordCanary/app-1.0.1/DiscordCanary.exe")).toBe("canary");
        expect(flavorOf("C:\\Program Files\\electron\\electron.exe")).toBeUndefined();
        expect(flavorOf("/Applications/Discord.app/Contents/MacOS/Discord")).toBe("stable");
        expect(flavorOf("/Applications/Discord PTB.app/Contents/MacOS/Discord PTB")).toBe("ptb");
        expect(flavorOf("/usr/share/discord-canary/DiscordCanary")).toBe("canary");
        expect(flavorOf("/opt/discord/Discord")).toBe("stable");
        expect(flavorOf("/usr/lib/electron37/electron")).toBeUndefined();
    });

    test("each system gets its own installer", () => {
        expect(exeAsset("win32", "x64")).toBe("evi.exe");
        expect(exeAsset("darwin", "arm64")).toBe("evi-macos-arm64");
        expect(exeAsset("darwin", "x64")).toBe("evi-macos-x64");
        expect(exeAsset("linux", "x64")).toBe("evi-linux-x64");
        expect(exeAsset("linux", "arm64")).toBe("evi-linux-arm64");
    });
});

describe("where releases are asked for", () => {
    const answer = (status: number) => new Response(status === 200 ? "{}" : null, { status });

    test("evi.rest's mirror, then GitHub; an override alone", () => {
        expect(releaseApis()).toEqual([RELEASE_MIRROR_API, GITHUB_API]);
        expect(releaseApis("")).toEqual([RELEASE_MIRROR_API, GITHUB_API]);
        expect(releaseApis("http://127.0.0.1:9/fake//")).toEqual(["http://127.0.0.1:9/fake"]);
        expect(RELEASE_MIRROR_API).toBe("https://evi.rest/v1/github");
    });

    /** A fetch that answers each URL's host with the next of its answers, and remembers what was asked */
    function fake(answers: Record<string, (number | Error)[]>) {
        const asked: string[] = [];
        const get = async (url: string) => {
            asked.push(url);
            const next = answers[new URL(url).host].shift()!;
            if (next instanceof Error) throw next;
            return answer(next);
        };
        return { asked, get };
    }
    const apis = ["https://evi.rest/v1/github", "https://api.github.com"];

    test("the mirror's answer is used, a 404 too", async () => {
        const { asked, get } = fake({ "evi.rest": [200, 404], "api.github.com": [] });
        expect((await fetchReleaseApi(apis, "releases/latest", get)).status).toBe(200);
        expect(asked).toEqual(["https://evi.rest/v1/github/repos/BleedDev/evi/releases/latest"]);
        expect((await fetchReleaseApi(apis, "releases/tags/v9.9.9", get)).status).toBe(404);
        expect(asked).toHaveLength(2);
    });

    test("GitHub is asked when the mirror can't be reached or answers 5xx", async () => {
        const { asked, get } = fake({ "evi.rest": [new Error("timed out"), 502], "api.github.com": [200, 403] });
        expect((await fetchReleaseApi(apis, "releases?per_page=30", get)).status).toBe(200);
        expect(asked).toEqual(["https://evi.rest/v1/github/repos/BleedDev/evi/releases?per_page=30", "https://api.github.com/repos/BleedDev/evi/releases?per_page=30"]);
        // GitHub's own answer stands, its rate limit included
        expect((await fetchReleaseApi(apis, "releases/latest", get)).status).toBe(403);
    });

    test("the last one's failure is what comes back", async () => {
        const { get } = fake({ "evi.rest": [500, 500], "api.github.com": [503, new Error("offline")] });
        expect((await fetchReleaseApi(apis, "releases/latest", get)).status).toBe(503);
        await expect(fetchReleaseApi(apis, "releases/latest", get)).rejects.toThrow("offline");
        // With an override there's nothing to fall back to
        const only = fake({ "127.0.0.1:9": [502] });
        expect((await fetchReleaseApi(releaseApis("http://127.0.0.1:9"), "releases/latest", only.get)).status).toBe(502);
        expect(only.asked).toHaveLength(1);
    });
});
