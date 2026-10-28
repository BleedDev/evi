import type { SourcePatch } from "@evi/api";

/**
 * Pure pieces of Game Activity Toggle, kept free of Discord so they can be tested.
 *
 * The setting is "Share my activity" (User Settings > Activity Privacy), stored in the
 * PreloadedUserSettings proto as `status.showCurrentGame`, a BoolValue wrapper where a missing
 * value means shown. Discord wraps it in a setting object built by
 *     eS=(0,_.c$)("status","showCurrentGame",e=>e?.value??!0,e=>l._t.create({value:e}));
 * (a plain call, ey=f(...), before Discord's build of 2026-10-28) * with { getSetting, updateSetting, useSetting }. Nothing names that object from outside, so a
 * source patch hands it to the plugin right after it's created.
 */

/** Reads the setting from UserSettingsProtoStore.settings the way Discord does: missing means shown */
export function readShowCurrentGame(protoSettings: any): boolean {
    const value = protoSettings?.status?.showCurrentGame?.value;
    return typeof value === "boolean" ? value : true;
}

export const PATCHES = {
    /** Captures Discord's showCurrentGame setting object right after it's defined */
    setting: {
        find: '"status","showCurrentGame"',
        replace: {
            match: /(?<=(\i)=(?:\(0,)?\i(?:\.\i)?\)?\("status","showCurrentGame",e=>e\?\.value\?\?!0,e=>\i\.\i\.create\(\{value:e\}\)\);)/,
            with: "$self?.captureSetting?.($1);",
        },
    },
} satisfies Record<string, SourcePatch>;
