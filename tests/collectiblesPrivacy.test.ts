import { describe, expect, test } from "bun:test";

import discord from "./fixtures/collectibles-discord.json";
import { ALL_COLLECTIBLE_PATCHES, analyticsPatch } from "../src/renderer/collectibles/patches";
import { outgoing, scrub, scrubAll } from "../src/renderer/collectibles/privacy";
import type { Replacement } from "../src/renderer/patching/source";
import { canonicalizeMatch, matchesFind, normalizeFactorySource } from "../src/renderer/patching/source";

/** Discord's analytics module of 2026-10-13 (tests/fixtures/collectibles-discord.json) */
const ANALYTICS = (discord as unknown as Record<string, string>)["562708"];

describe("Discord's analytics never see an Evi SKU", () => {
    test("the patch applies to Discord's analytics module, each spot exactly once, and it still parses", () => {
        expect(ALL_COLLECTIBLE_PATCHES).toContain(analyticsPatch);
        expect(matchesFind(ANALYTICS, analyticsPatch.find)).toBe(true);
        let code = normalizeFactorySource(ANALYTICS);
        for (const r of ([] as Replacement[]).concat(analyticsPatch.replace)) {
            const re = canonicalizeMatch(r.match) as RegExp;
            expect(code.match(new RegExp(re.source, "g"))?.length).toBe(1);
            code = code.replace(re, r.with as string);
        }
        expect(code.split("window.Evi?.collectibles?.scrub(").length - 1).toBe(2);
        expect(code.split("window.Evi?.collectibles?.scrubAll(").length - 1).toBe(1);
        // Tracking scrubs the properties (the second argument), queued TRACKs theirs, uploads the batch
        expect(code).toMatch(/return function\((\w+),(\w+)\)\{window\.Evi\?\.collectibles\?\.scrub\(\2\);/);
        expect(code).toMatch(/\.handleTrack=function\((\w+)\)\{window\.Evi\?\.collectibles\?\.scrub\(\1\?\.properties\);/);
        expect(code).toMatch(/function \w+\((\w+),\w+\)\{window\.Evi\?\.collectibles\?\.scrubAll\(\1\);let \w+=Date\.now\(\)/);
        expect(() => new Function(`return (${code});`)).not.toThrow();
    });

    test("No Track's patch on the same function still applies after ours", () => {
        let code = normalizeFactorySource(ANALYTICS);
        for (const r of ([] as Replacement[]).concat(analyticsPatch.replace)) code = code.replace(canonicalizeMatch(r.match) as RegExp, r.with as string);
        const noTrack = canonicalizeMatch(/(?<=TRACK_ACTION_NAME:\i\}=\i,[^]{0,400}?)return function\(\i,\i\)\{/) as RegExp;
        expect(code.match(new RegExp(noTrack.source, "g"))?.length).toBe(1);
    });

    test("scrub: Evi SKUs become null anywhere in the properties, nothing else changes", () => {
        const props = { avatar_decoration_sku_id: "evi:sakura", profile_effect_sku_id: "evi:neon", nested: { list: ["evi:planet", "123"] }, other: "evi is great", sku: "1144058522808614923" };
        expect(scrub(props)).toBe(3);
        expect(props).toEqual({ avatar_decoration_sku_id: null, profile_effect_sku_id: null, nested: { list: [null, "123"] }, other: "evi is great", sku: "1144058522808614923" } as any);
        const viewed = { type: "user_profile_viewed", properties: { decoration: "evi:autumn" as string | null } };
        expect(scrubAll([viewed, { type: "x" }, null])).toBe(1);
        expect(viewed.properties.decoration).toBeNull();
        expect(scrubAll(undefined)).toBe(0);
    });
});

describe("requests to Discord's API never carry an Evi SKU", () => {
    const api = "https://discord.com/api/v9/users/@me/profile";

    test("a profile save leaves the Evi field out, so nothing changes there", () => {
        const body = JSON.stringify({ bio: "hi", avatar_decoration_sku_id: "evi:sakura", avatar_decoration_id: "evi:sakura", nameplate: { sku_id: "evi:neon", asset: "x" } });
        expect(JSON.parse(outgoing("PATCH", api, body)!)).toEqual({ bio: "hi" });
        // Relative URLs, as Discord's HTTP client sends them
        expect(outgoing("PATCH", "/api/v9/users/@me", body)).toBeDefined();
    });

    test("analytics uploads: the properties' Evi fields go", () => {
        const body = JSON.stringify({ token: "t", events: [{ type: "profile_viewed", properties: { profile_effect_sku_id: "evi:study", client_send_timestamp: 1 } }] });
        expect(JSON.parse(outgoing("POST", "https://discord.com/api/v9/science", body)!)).toEqual({ token: "t", events: [{ type: "profile_viewed", properties: { client_send_timestamp: 1 } }] });
    });

    test("left alone: a message that says evi:sakura, reads, other hosts, bodies that aren't JSON", () => {
        expect(outgoing("POST", "https://discord.com/api/v9/channels/1/messages", JSON.stringify({ content: "evi:sakura" }))).toBeUndefined();
        expect(outgoing("GET", api, JSON.stringify({ sku: "evi:sakura" }))).toBeUndefined();
        expect(outgoing("PATCH", "https://evi.rest/v1/me/collectibles", JSON.stringify({ decoration: "evi:sakura" }))).toBeUndefined();
        expect(outgoing("PATCH", api, '"evi:sakura" not json')).toBeUndefined();
        expect(outgoing("PATCH", api, JSON.stringify({ bio: "no evi here" }))).toBeUndefined();
        expect(outgoing("PATCH", api, new Blob())).toBeUndefined();
    });
});
