import type { SourcePatch } from "@evi/api";

/**
 * Pure pieces of Volume Booster: the volume math and the source patch replacements, kept free of
 * Discord and Evi runtime imports so tests can run them against real snippets of Discord's code.
 *
 * Discord stores a user's volume as an amplitude in percent (100 = unchanged) and shows it on a
 * perceptual slider. Up to 100 the curve is a power law, above 100 every 100 slider points add 6dB:
 * slider 200 is ~2x, slider 400 is ~7.9x. The desktop voice engine gets amplitude / 100.
 */

/** The slider's cap on desktop, and the most Discord's settings sync (and its RPC) accepts */
export const DISCORD_MAX = 200;
export const DEFAULT_MULTIPLIER = 2;
export const MIN_MULTIPLIER = 1;
export const MAX_MULTIPLIER = 5;

/** A usable multiplier from whatever the settings hold */
export function clampMultiplier(value: unknown) {
    const n = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(n)) return DEFAULT_MULTIPLIER;
    return Math.min(MAX_MULTIPLIER, Math.max(MIN_MULTIPLIER, n));
}

/** The slider's new cap, from Discord's own cap for it */
export function sliderMax(discordMax: number, multiplier: number) {
    if (typeof discordMax !== "number" || !Number.isFinite(discordMax)) return discordMax;
    return Math.round(discordMax * clampMultiplier(multiplier));
}

/** Discord's slider position -> stored amplitude (its perceptual curve, same constants) */
export function sliderToAmplitude(slider: number, base = 100) {
    if (slider === 0) return 0;
    const n = slider / base;
    return (n < 1 ? Math.pow(n, 2.8) : Math.pow(10, (n - 1) * 6 / 20)) * base;
}

/** Stored amplitude -> slider position */
export function amplitudeToSlider(amplitude: number, base = 100) {
    if (amplitude === 0) return 0;
    const n = amplitude / base;
    return (n < 1 ? Math.pow(n, 1 / 2.8) : 20 * Math.log10(n) / 6 + 1) * base;
}

/** The loudest amplitude plain Discord can set (its slider at 200) */
export const DISCORD_MAX_AMPLITUDE = sliderToAmplitude(DISCORD_MAX);

/** What gets written to Discord's synced settings: never above what Discord accepts */
export function clampSynced(volume: unknown) {
    return typeof volume === "number" && volume > DISCORD_MAX ? DISCORD_MAX : volume;
}

/**
 * Whether a synced volume should be ignored in favour of the local one: the local volume is boosted
 * and the synced value is exactly the cap we clamped it to, so it is our own write coming back.
 */
export function keepBoosted(local: unknown, synced: unknown) {
    return typeof local === "number" && local > DISCORD_MAX && synced === DISCORD_MAX;
}

/** Calls a plugin helper when it exists, else leaves the value as Discord had it */
const guard = (fn: string, ...args: string[]) => `($self?.${fn}?.(${args.join(",")})??${args[0]})`;

/**
 * Source patches, as plain data. `\i` is Evi's identifier shorthand and `$self` the plugin.
 * Found against Discord's web build cached in test-results/chunks (stable, Sep 2026).
 */
export const PATCHES = {
    /**
     * User and stream volume in the user context menu:
     *     {id:"user-volume",label:...,control:...maxValue:c.isPlatformEmbedded?g.Rv:g.HE,onChange:...}
     * Only the desktop branch grows: the web engine's audio elements can't go above 1.
     */
    userVolumeMenu: {
        find: '"user-volume",label:',
        replace: {
            match: /(?<=maxValue:\i\.isPlatformEmbedded\?)([^:,]+)(?=:)/,
            with: guard("sliderMax", "$1"),
        },
    },
    /**
     * The volume slider on a stream/video tile:
     *     maxValue:A.isPlatformEmbedded?200:100,onValueChange:e=>{...o.A.setLocalVolume(C,(0,d.w)(e),p)}
     */
    streamTile: {
        find: "isPlatformEmbedded?200:100,onValueChange",
        replace: {
            match: /(?<=maxValue:\i\.isPlatformEmbedded\?)(200)(?=:100,onValueChange)/,
            with: guard("sliderMax", "$1"),
        },
    },
    /**
     * Discord syncs per-user volumes to your account (audioContextSettings). Values above 200 are
     * clamped before they are written, so the sync keeps working and other clients see 200.
     */
    syncWrite: {
        find: "AudioContextSettingsMigrated",
        replace: [
            // One-time migration of local volumes: {let i=l[e];l[e]={...i??{muted:!1,modifiedAt:s},volume:(0,I.z)(t,n)}
            {
                match: /(?<=localVolumes\)\).{0,80}?volume:)\(0,\i\.\i\)\(\i,\i\)/,
                with: guard("clampSynced", "$&"),
            },
            // Remote session (console voice) update: N(r,n,t,{muted:E.Ay.isLocalMute(n,t),volume:i})
            {
                match: /(?<=isLocalMute\(\i,\i\),volume:)(\i)(?=\}\))/,
                with: guard("clampSynced", "$1"),
            },
            // Pending settings change: (0,I.gq)(t,n,{volume:i})
            {
                match: /(?<=\(0,\i\.\i\)\(\i,\i,\{volume:)(\i)(?=\})/,
                with: guard("clampSynced", "$1"),
            },
        ],
    },
    /**
     * MediaEngineStore applies synced volumes over local ones:
     *     t.volume!==r?l[e]=t.volume:delete l[e],tr.eachConnection(n=>{n.setLocalVolume(e,t.volume),...
     * When our own clamped 200 comes back, the boosted local volume is kept.
     */
    syncRead: {
        find: "audioContextSettings??{user:{},stream:{}}",
        replace: {
            match: /(\i)\.volume!==(\i)\?(\i)\[(\i)\]=\1\.volume:delete \3\[\4\],(\i\.eachConnection\(\i=>\{\i\.setLocalVolume\(\4,)\1\.volume\)/,
            with: "($self?.keepBoosted?.($3[$4],$1.volume)||($1.volume!==$2?$3[$4]=$1.volume:delete $3[$4])),$5$3[$4]??$2)",
        },
    },
} satisfies Record<string, SourcePatch>;
