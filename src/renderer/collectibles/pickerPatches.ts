/**
 * Evi collectibles in Discord's own pickers ("Change Nameplate", "Change Avatar Decoration", "Change
 * Profile Effect", "Change Profile Frame") and the profile editor's save (pickers.ts has the behaviour).
 *
 * Every patch is optional and matched on stable strings. A picker only lists Evi items once all the
 * patches its kind needs applied (PICKER_PATCHES_BY_KIND, checked by pickers.ts pickerReady): one that
 * no longer fits leaves that picker as Discord made it, never half working.
 *
 * Read off Discord's web build of 2026-10-13. Finds are plain RegExps (`\i` only works in matches).
 */
import type { CollectibleKind } from "@shared/collectibles";

import type { SourcePatch } from "../patching/source";

const P = "window.Evi?.collectibles";

/**
 * Discord's request bodies from the profile editor's pending changes (module 56348): the user's
 * (nameplate, avatar decoration), the profile's (effect and frame as collectibles_sku_ids) and a
 * server member's. Each hands the pending changes to Evi first, which wears Evi items through Evi
 * and leaves them out (pickers.ts takeEviChanges):
 *     function d(n,i){let e={};void 0!==n.pendingBanner&&…
 *     function o(n){let i={};if(void 0!==n.pendingGlobalName&&…
 *     function p(n){let i={};if(void 0!==n.pendingAvatar){…
 */
export const saveBodiesPatch: SourcePatch = {
    find: /\{collectibles_sku_ids:[\w$]+\.map\(/,
    optional: true,
    group: true,
    replace: [
        {
            match: /(function \i\((\i),(\i)\)\{)(let \i=\{\};void 0!==\2\.pendingBanner)/,
            with: `$1$2=${P}?.saving?.($2,"profile",$3)??$2;$4`,
        },
        {
            match: /(function \i\((\i)\)\{)(let \i=\{\};if\(void 0!==\2\.pendingGlobalName)/,
            with: `$1$2=${P}?.saving?.($2,"user")??$2;$3`,
        },
        {
            match: /(function \i\((\i)\)\{)(let \i=\{\};if\(void 0!==\2\.pendingAvatar\))/,
            with: `$1$2=${P}?.saving?.($2,"member")??$2;$3`,
        },
    ],
};

/**
 * Setting the profile editor's pending changes (module 84540) compares what you chose with what you
 * have, and a choice equal to it isn't a change. What you have is the Evi item you wear where you
 * wear one, so choosing None or a Discord item over it is a change (and takes it off on save):
 *     null==t&&n.nameplate?.skuId===i.collectibles?.nameplate?.skuId?E.pendingNameplate=void 0:…
 *     n.profileEffect?.skuId===u?.profileEffect?.skuId?E.pendingProfileEffect=void 0:…
 * (an avatar decoration already compares with the user record's, which is Evi's)
 */
export const pendingPatch: SourcePatch = {
    find: '"USER_PROFILE_SETTINGS_SET_PENDING_CHANGES",guildId:',
    optional: true,
    group: true,
    replace: [
        {
            match: /(null==\i&&\i\.nameplate\?\.skuId===)(\i\.collectibles\?\.nameplate)\?\.skuId/,
            with: `$1(${P}?.own?.("nameplate")??$2)?.skuId`,
        },
        {
            match: /===(\i\?\.profileEffect)\?\.skuId\?(?=\i\.pendingProfileEffect=void 0)/,
            with: `===(${P}?.own?.("effect")??$1)?.skuId?`,
        },
        {
            match: /===(\i\?\.profileFrame)\?\.skuId\?(?=\i\.pendingProfileFrame=void 0)/,
            with: `===(${P}?.own?.("frame")??$1)?.skuId?`,
        },
    ],
};

/**
 * The badge on a picker's item tile (module 483968): none in "Your …", a lock or "Nitro exclusive"
 * elsewhere. An Evi item gets Evi's: its mark when it's yours, a lock and its price in Sparks when not.
 *     let{skuId:e,canUsePremiumCollectibles:n,isPurchaseSection:A,isPremiumSection:h}=t,…});return A||h&&n?null:…
 */
export const tileBadgePatch: SourcePatch = {
    find: /\{skuId:[\w$]+,canUsePremiumCollectibles:[\w$]+,isPurchaseSection:[\w$]+,isPremiumSection:[\w$]+\}=[\w$]+,/,
    optional: true,
    replace: {
        match: /(\{skuId:(\i),canUsePremiumCollectibles:\i,isPurchaseSection:\i,isPremiumSection:\i\}=\i,[^]*?\}\);return )/,
        with: `$1${P}?.isSku?.($2)?${P}.tile($2):`,
    },
};

/**
 * The product and purchase of a SKU (module 821701), what a picker's footer decides between Apply,
 * "Go to Shop" and Nitro with. An evi: SKU gets Evi's (pickers.ts productFor). Discord's hooks still
 * run every time, so React sees the same hooks whichever item is selected.
 *     return{category:e,product:r,purchase:(0,c.bG)([s.A],()=>s.A.getPurchase(t))}
 */
export const productPatch: SourcePatch = {
    find: /\.getCategoryForProduct\([\w$]+\),[\w$]+\.[\w$]+\.getProduct\([\w$]+\)\]\);return\{category:/,
    optional: true,
    replace: {
        match: /return(\{category:\i,product:\i,purchase:\(0,\i\.\i\)\(\[\i\.\i\],\(\)=>\i\.\i\.getPurchase\((\i)\)\)\})/,
        with: `return(x=>${P}?.product?.($2)??x)($1)`,
    },
};

/**
 * The details under a picker's preview (module 448429): the product's name and when you got it. An
 * Evi item shows Evi's: its name, and that it's yours or what it costs.
 *     let{user:e,previewSkuId:n,…}=t,…;return null==E&&null==j?null:
 */
export const previewDetailsPatch: SourcePatch = {
    find: /previewSkuId:[\w$]+,nitroChurnCTA:/,
    optional: true,
    replace: {
        match: /(?<=previewSkuId:(\i),[^]*?)return (?=null==\i&&null==\i\?null:)/,
        with: `return ${P}?.isSku?.($1)?${P}.details($1):`,
    },
};

/**
 * Opening Discord's Shop (module 815996, openCollectiblesShop): pickers open it at the product you
 * selected. For an evi: SKU Evi's product dialog opens instead.
 *     function J(e){let{tab:t,initialCollectionId:i,...r}=e;{…
 */
export const openShopPatch: SourcePatch = {
    find: /\{let\{tab:[\w$]+,initialCollectionId:[\w$]+,\.\.\.[\w$]+\}=/,
    optional: true,
    replace: {
        match: /(function \i\((\i)\)\{)(let\{tab:\i,initialCollectionId:\i,\.\.\.\i\}=\2;)/,
        with: `$1if(${P}?.openShop?.($2))return;$3`,
    },
};

/**
 * A profile effect's picker thumbnail (module 181774) asks Discord's CDN for a smaller one:
 *     function l(e){if(null!=e)return`${e}?width=100&height=195`}
 * A blob: URL can't take a query, so an Evi effect's thumbnail goes as it is.
 */
export const effectThumbPatch: SourcePatch = {
    find: "?width=100&height=195`",
    optional: true,
    replace: {
        match: /if\(null!=(\i)\)return`\$\{\1\}\?width=100&height=195`/,
        with: "if(null!=$1&&/^(blob|data):/.test($1))return $1;$&",
    },
};

/**
 * The profile editor's nameplate row (module 374654) shows your own nameplate from the user's raw
 * collectibles; it shows the Evi one you wear instead, with its remove button:
 *     {guildNameplate:b,pendingNameplate:m}=(0,v.rv)(n,l??void 0),A=n.collectibles?.nameplate,
 */
export const nameplateRowPatch: SourcePatch = {
    find: /\{guildNameplate:[\w$]+,pendingNameplate:[\w$]+\}=\(0,[\w$]+\.[\w$]+\)\([\w$]+,[\w$]+\?\?void 0\),[\w$]+=[\w$]+\.collectibles\?\.nameplate,/,
    optional: true,
    replace: {
        match: /(\{guildNameplate:\i,pendingNameplate:\i\}=\(0,\i\.\i\)\(\i,\i\?\?void 0\),\i=)(\i\.collectibles\?\.nameplate)(?=,)/,
        with: `$1${P}?.own?.("nameplate")??$2`,
    },
};

/** A picker's grid, right where it asks for its sections: Evi's go in (pickers.ts withEviSections) */
const sections = (kind: CollectibleKind, guild: string) => `$1${P}?.sections?.("${kind}",$3,${guild})??$3`;

/**
 * A modal's own lookup of the selected item among Discord's: an Evi one when nothing of Discord's is it
 *     .find(e=>{let{skuId:t}=e;return t===y?.skuId})??null,[y,…])
 */
const lookup = (kind: CollectibleKind) => ({
    match: /(return \i===(\i)\?\.skuId\}\))\?\?null(?=,\[\2,)/,
    with: `$1??${P}?.item?.($2,"${kind}")??null`,
});

/**
 * The Change Nameplate modal (module 818743). Its grid takes its sections from a hook; your current
 * nameplate (what None and Apply compare with) is the user's raw one, so it's the Evi one you wear
 * instead; the first selection is found among Discord's nameplates, or is the Evi one.
 *     let{currentUser:i,selectedNameplate:t,guildId:s,onSelect:n,onOpenShop:r}=e,a=I.Ay.canUseCollectibles(i),c=Q();
 *     b=null!=N?N.collectibles?.nameplate:i.collectibles?.nameplate
 *     (0,k.zd)(s,t).find(e=>{let{skuId:i}=e;return i===b.skuId})??null)
 */
export const nameplatePickerPatch: SourcePatch = {
    find: 'parentComponent:"NameplateModal"',
    optional: true,
    group: true,
    replace: [
        {
            match: /(guildId:(\i),onSelect:\i,onOpenShop:\i\}=\i,\i=\i\.\i\.canUseCollectibles\(\i\),\i=)(\i\(\))/,
            with: sections("nameplate", "$2"),
        },
        {
            match: /(\i=null!=(\i)\?\2\.collectibles\?\.nameplate:)(\i\.collectibles\?\.nameplate)/,
            with: `$1${P}?.own?.("nameplate")??$3`,
        },
        {
            match: /(\.find\(\i=>\{let\{skuId:\i\}=\i;return \i===(\i)\.skuId\}\))\?\?null/,
            with: `$1??${P}?.item?.($2,"nameplate")??null`,
        },
    ],
};

/**
 * The Change Avatar Decoration modal (module 40344): its grid's sections, and its first selection
 * (your current decoration is the user record's, already Evi's) found among Discord's or Evi's.
 *     let{user:t,guild:i,pendingAvatarDecoration:s,selectedAvatarDecorationRef:n,onSelect:a,onOpenShop:l}=e,u=Y(),
 */
export const decorationPickerPatch: SourcePatch = {
    find: 'parentComponent:"AvatarDecorationModal"',
    optional: true,
    group: true,
    replace: [
        {
            match: /(guild:(\i),pendingAvatarDecoration:\i,selectedAvatarDecorationRef:\i,onSelect:\i,onOpenShop:\i\}=\i,\i=)(\i\(\))/,
            with: sections("decoration", "$2?.id"),
        },
        {
            match: /(\.find\(\i=>\{let\{skuId:\i\}=\i;return \i===(\i)\.skuId\}\))\?\?null/,
            with: `$1??${P}?.item?.($2,"decoration")??null`,
        },
    ],
};

/**
 * The Change Profile Effect modal (module 937563): its grid's sections, and the item its preview
 * shows, looked up among Discord's by the selected SKU (your current effect comes from the profile
 * hook patches.ts makes Evi's).
 *     let{user:t,guild:n,pendingProfileEffect:i,selectedProfileEffectRef:r,onSelect:l,onOpenShop:a}=e,u=Y(),
 */
export const effectPickerPatch: SourcePatch = {
    find: 'parentComponent:"ProfileEffectModal"',
    optional: true,
    group: true,
    replace: [
        {
            match: /(guild:(\i),pendingProfileEffect:\i,selectedProfileEffectRef:\i,onSelect:\i,onOpenShop:\i\}=\i,\i=)(\i\(\))/,
            with: sections("effect", "$2?.id"),
        },
        lookup("effect"),
    ],
};

/**
 * The Change Profile Frame modal (module 651247), the same way as effects.
 *     let{user:t,guild:i,pendingProfileFrame:n,selectedProfileFrameRef:r,onSelect:l,onOpenShop:a}=e,u=Z(),
 */
export const framePickerPatch: SourcePatch = {
    find: 'parentComponent:"ProfileFrameModal"',
    optional: true,
    group: true,
    replace: [
        {
            match: /(guild:(\i),pendingProfileFrame:\i,selectedProfileFrameRef:\i,onSelect:\i,onOpenShop:\i\}=\i,\i=)(\i\(\))/,
            with: sections("frame", "$2?.id"),
        },
        lookup("frame"),
    ],
};

/** What every picker needs: saving through Evi, Evi's badges, Apply for yours and Evi's dialog for the rest */
const SHARED = [saveBodiesPatch, pendingPatch, tileBadgePatch, productPatch, openShopPatch];

/** By kind: what has to apply for a picker to list Evi items */
export const PICKER_PATCHES_BY_KIND: Record<CollectibleKind, SourcePatch[]> = {
    nameplate: [...SHARED, nameplatePickerPatch],
    decoration: [...SHARED, decorationPickerPatch],
    effect: [...SHARED, effectPickerPatch, effectThumbPatch],
    frame: [...SHARED, framePickerPatch],
};

/** Every one, for registering */
export const PICKER_PATCHES: SourcePatch[] = [
    saveBodiesPatch, pendingPatch, tileBadgePatch, productPatch, previewDetailsPatch, openShopPatch, effectThumbPatch,
    nameplateRowPatch, nameplatePickerPatch, decorationPickerPatch, effectPickerPatch, framePickerPatch,
];
