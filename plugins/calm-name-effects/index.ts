import { definePlugin, Filter } from "@evi/api";

import { t } from "./strings";

/**
 * Nitro display name styles (Prism, Neon, Toon, Pop, Gummy) are CSS animations Discord starts every
 * time a name mounts: opening a chat plays them in the header, on every message and in the profile
 * panel at once, for 2 to 4 seconds. They animate background-position, colour and per-letter
 * transforms, which the compositor can't run, so every vsync goes through style, paint of the whole
 * page, layerize and commit on the main thread.
 *
 * Measured on a ~280Hz display, 6 DM switches per run, interleaved with stock runs:
 *   chats showing an effect: 50-70% of the main thread for the seconds after opening them
 *   work per DM switch: ~990ms stock -> ~480ms with effects held still; frames drawn ~307 -> ~49
 * Measured and rejected: a GPU layer per name (will-change) saved ~8%, and stepping the animation
 * to 15fps ~20%: Chromium still runs every frame while an animation is playing.
 *
 * So effects keep their colours and gradients, and play while the pointer is on the name, the way
 * Discord animates avatars on hover. Classes come from Discord's CSS module, found by value.
 */

const settings = {
    animateOnHover: {
        type: "boolean",
        get label() { return t("settings.animateOnHover"); },
        get description() { return t("settings.animateOnHover.description"); },
        default: true,
    },
} as const;

/**
 * Discord's display name styles CSS module: { [mangled]: "innerContainer_or4Hj-", ... }. Since
 * 2026-11-06 it no longer lists its keyframes (prism-scroll), and the suffix isn't only hex.
 */
const stylesFilter: Filter = Object.assign(
    (v: any) => !!v && typeof v === "object" && !Array.isArray(v)
        && Object.values(v).some(c => typeof c === "string" && /^innerContainer_+[\w-]+$/.test(c))
        && Object.values(v).some(c => typeof c === "string" && /^gummyLetter_+[\w-]+$/.test(c)),
    { $code: ['"innerContainer_', '"gummyLetter_'], $label: "display name styles CSS module" },
);

function buildCss(classes: Record<string, unknown>, onHover: boolean) {
    const cls = (name: string) => Object.values(classes).find((c): c is string => typeof c === "string" && new RegExp(`^${name}_+[\\w-]+$`).test(c));
    const animated = cls("animated"), inner = cls("innerContainer");
    if (!animated || !inner) return "";
    const scope = `.${animated}${onHover ? ":not(:hover)" : ""} .${inner}`;
    return `${[scope, `${scope} *`, `${scope}::before`, `${scope} *::before`, `${scope}::after`, `${scope} *::after`].join(",\n")} {
    animation: none !important;
}`;
}

let styles: Record<string, unknown> | undefined;

export default definePlugin({
    settings,
    start(ctx) {
        const style = ctx.addStyle("");
        const apply = () => {
            if (styles) style.update(buildCss(styles, ctx.settings.get("animateOnHover")));
        };
        // Kept from an earlier start: no need to search every module again
        if (styles) apply();
        else ctx.waitFor(stylesFilter, classes => {
            styles = classes;
            apply();
        });
        ctx.settings.onChange(apply);
    },
});
