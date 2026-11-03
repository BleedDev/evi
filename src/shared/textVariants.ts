/**
 * Discord renamed its Text variants (November 2026): text-xs/sm/md/lg became body-xs/sm/md/lg at the
 * same sizes, the headings moved down a step (heading-sm 14px is now heading-xs, heading-md 16px is
 * now heading-sm) and lost /normal and /bold. A name its Text doesn't know gets no class, so the text
 * falls back to the page's default size and weight. Evi and its plugins still write the old names:
 * this turns one into the name Discord has now, and leaves them alone on a Discord that has the old ones.
 */

const OLD = /^(text|heading)-(xxs|xs|sm|md|lg|xl|xxl)\/(normal|medium|semibold|bold|extrabold)$/;

const TEXT_SIZE: Record<string, string> = { xxs: "xs", xs: "xs", sm: "sm", md: "md", lg: "lg" };
const HEADING_SIZE: Record<string, string> = { sm: "xs", md: "sm", lg: "lg", xl: "xl", xxl: "xxl" };

/**
 * The variant Discord's Text has for this one. A Discord that still has text-sm/normal has the old
 * names and keeps them all; the new one gets the new name, even for heading-sm and heading-md, which
 * still exist but are a size bigger now
 */
export function currentTextVariant(variant: string, known: (variant: string) => boolean): string {
    if (known("text-sm/normal")) return variant;
    const m = OLD.exec(variant);
    if (!m) return variant;
    const [, kind, size, weight] = m;
    const heavy = weight === "bold" || weight === "extrabold";
    const renamed = kind === "text"
        ? TEXT_SIZE[size] && `body-${TEXT_SIZE[size]}/${heavy ? "semibold" : weight}`
        : HEADING_SIZE[size] && `heading-${HEADING_SIZE[size]}/${heavy ? "semibold" : weight === "normal" ? "medium" : weight}`;
    return renamed && known(renamed) ? renamed : variant;
}
