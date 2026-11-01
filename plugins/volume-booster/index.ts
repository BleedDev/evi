import { definePlugin, filters, find, getStore } from "@evi/api";

import { t } from "./strings";
import {
    capVolume, clampMultiplier, clampSynced, DEFAULT_MULTIPLIER, DISCORD_MAX_AMPLITUDE, keepBoosted, MAX_MULTIPLIER, maxAmplitude,
    MIN_MULTIPLIER, PATCHES, sliderMax,
} from "./volume";

/**
 * Discord caps a user's volume at 200% on desktop. The cap is only the slider's maxValue: the
 * action creator (AudioActionCreators.setLocalVolume) and MediaEngineStore take any number, and
 * the desktop voice engine gets amplitude / 100. So the patches raise the slider caps, hold every
 * volume MediaEngineStore takes to the multiplier's maximum (N x 200% amplitude), and keep Discord's
 * synced audio settings (which accept at most 200) from pulling boosted volumes back.
 *
 * Patched code keeps calling $self after the plugin is turned off until Discord reloads, so every
 * helper falls back to Discord's own behaviour while the plugin isn't running.
 */

const audioActions = filters.byProps("setLocalVolume", "toggleLocalMute", "toggleSelfDeaf");

let running = false;
let multiplier = DEFAULT_MULTIPLIER;

/**
 * Puts anyone above `max` back at it: Discord's own maximum when the plugin turns off, so off really is
 * off, and the multiplier's maximum when it starts or the limit is lowered (volumes kept from before).
 */
function lowerAbove(max: number) {
    try {
        const state = getStore("MediaEngineStore")?.getState?.();
        const actions = find(audioActions);
        if (!state?.settingsByContext || !actions) return;
        for (const [context, settings] of Object.entries<any>(state.settingsByContext)) {
            for (const [userId, volume] of Object.entries<any>(settings?.localVolumes ?? {})) {
                if (typeof volume === "number" && volume > max) actions.setLocalVolume(userId, max, context);
            }
        }
    } catch {
        // Best effort: a reload applies Discord's cap anyway
    }
}

export default definePlugin({
    settings: {
        multiplier: {
            type: "number",
            get label() { return t("settings.multiplier"); },
            get description() { return t("settings.multiplier.description"); },
            default: DEFAULT_MULTIPLIER,
            min: MIN_MULTIPLIER,
            max: MAX_MULTIPLIER,
            step: 0.5,
        },
    },

    patches: [PATCHES.userVolumeMenu, PATCHES.streamTile, PATCHES.capLocalVolume, PATCHES.syncWrite, PATCHES.syncRead],

    sliderMax: (discordMax: number) => running ? sliderMax(discordMax, multiplier) : discordMax,
    capVolume: (volume: unknown) => running ? capVolume(volume, multiplier) : volume,
    clampSynced,
    keepBoosted: (local: unknown, synced: unknown) => running && keepBoosted(local, synced),

    start(ctx) {
        multiplier = clampMultiplier(ctx.settings.get("multiplier"));
        running = true;
        lowerAbove(maxAmplitude(multiplier));
        ctx.settings.onChange(values => {
            multiplier = clampMultiplier(values.multiplier);
            lowerAbove(maxAmplitude(multiplier));
        });
        ctx.onDispose(() => {
            running = false;
            lowerAbove(DISCORD_MAX_AMPLITUDE);
        });
    },
});
