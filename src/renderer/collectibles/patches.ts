/**
 * How Evi collectibles get into Discord's own collectible code. Someone wearing one gets Discord's
 * collectible data with a sentinel SKU, "evi:<bundle>" (shared/collectibles.ts), and where Discord
 * turns a SKU into files, an evi: SKU gets the page's blob: URLs. Discord's own components then do
 * the rest: sizing, palettes, hover to animate, reduced motion, the effect's intro and loop.
 *
 * Every patch is optional and matched on stable strings. One that stops matching only hides that
 * kind of collectible: the getters hand out an evi: SKU only once the patch that draws it applied
 * (store.ts `drawn`), so a broken one never leaves a broken image behind.
 *
 * Read off Discord's web build of 2026-10-13. Finds are plain RegExps (`\i` only works in matches).
 */
import type { SourcePatch } from "../patching/source";

const E = "window.Evi?.collectibles";

/**
 * The user record (UserStore's users), used everywhere a user is drawn:
 *     get avatarDecoration(){return this.avatarDecorationData}
 * Ours goes first: Discord's own decoration shows unless you chose an Evi one.
 */
export const userDecorationPatch: SourcePatch = {
    find: "get avatarDecoration(){return this.avatarDecorationData}",
    optional: true,
    replace: {
        match: "get avatarDecoration(){return this.avatarDecorationData}",
        with: `get avatarDecoration(){return ${E}?.decoration(this.id)??this.avatarDecorationData}`,
    },
};

/**
 * Same record: `get nameplate(){return(0,o.WK)(this.collectibles?.nameplate)}`. WK turns the server
 * shape ({ skuId, asset, label, palette }) into Discord's, palette colours and all; ours goes in as
 * that same server shape.
 */
export const userNameplatePatch: SourcePatch = {
    find: "get nameplate(){return(0,",
    optional: true,
    replace: {
        match: /(get nameplate\(\)\{return\(0,\i\.\i\)\()(this\.collectibles\?\.nameplate\))/,
        with: `$1${E}?.nameplate(this.id)??$2`,
    },
};

/**
 * Discord's choice between someone's own value and their server profile's, for decorations and
 * nameplates among others (module 919395):
 *     function I(e){let{userValue:t,guildValue:n,pendingValue:i,guildId:r}=e;return""===i||null===i?…:n:t}
 * With an Evi item as the user value and nothing being edited, the user value wins: a server
 * decoration or nameplate doesn't hide the Evi one.
 */
export const mergePatch: SourcePatch = {
    find: /\{userValue:[\w$]+,guildValue:[\w$]+,pendingValue:[\w$]+,guildId:[\w$]+\}=[\w$]+;return""===/,
    optional: true,
    replace: {
        match: /(\{userValue:(\i),guildValue:\i,pendingValue:(\i),guildId:\i\}=\i;return)(?=""===)/,
        with: `$1 void 0===$3&&${E}?.isOurs($2)?$2:`,
    },
};

/**
 * A member's decoration, outside of React (module 259464):
 *     a=null!=t&&null!=e?i.getMember(t,e.id):null;return a?.avatarDecoration??e?.avatarDecoration
 */
export const memberDecorationPatch: SourcePatch = {
    find: /\.getMember\([\w$]+,[\w$]+\.id\):null;return [\w$]+\?\.avatarDecoration\?\?[\w$]+\?\.avatarDecoration\}/,
    optional: true,
    replace: {
        match: /(\.getMember\(\i,\i\.id\):null;return )(\i)(\?\.avatarDecoration\?\?)(\i)(\?\.avatarDecoration\})/,
        with: `$1(${E}?.wears($4?.id,"decoration")?null:$2$3null)??$4$5`,
    },
};

/**
 * The hook behind every avatar's decoration (module 215689): which decoration (through the merge
 * above) and its URL, memoized on the decoration. The hook also hears when Evi's files arrive, so an
 * avatar drawn before them redraws with them.
 *     j=i.useMemo(()=>…(0,a.F_)({avatarDecoration:void 0!==m?m:A,canAnimate:x,size:h}),[_,m,A,x,h]);return{avatarPlaceholderSrc:
 */
export const decorationHookPatch: SourcePatch = {
    find: /onlyAnimateOnHoverOrFocus:[\w$]+=!1\}=[\w$]+/,
    optional: true,
    replace: {
        match: /(\[\i,\i,\i,\i,\i)(\]\);return\{avatarPlaceholderSrc:)/,
        with: `$1,${E}?.useVersion?.()$2`,
    },
};

/**
 * Discord's avatar decoration URL (getAvatarDecorationURL, module 486020):
 *     function v(e){let{avatarDecoration:t,size:i=E.DX,canAnimate:r=!1}=e;if(null==t||(0,o.bS)(t))return null;…
 * An evi: SKU gets the page's blob URL, animated when Discord asks for it.
 */
export const decorationUrlPatch: SourcePatch = {
    find: ".AVATAR_DECORATION_PRESETS(",
    optional: true,
    replace: {
        match: /(\{avatarDecoration:(\i),size:\i=[\w$.]+,canAnimate:(\i)=!1\}=\i;)/,
        with: `$1if(${E}?.isSku($2?.skuId))return ${E}.decorationUrl($2.skuId,$3);`,
    },
};

/**
 * A user's nameplate as a hook (module 449582), for the member list, DMs and the account panel:
 *     return i.useMemo(()=>{if(null!=t)return(0,s.WK)(l?.collectibles?.nameplate)??t.nameplate},[l,t])
 * The server profile's nameplate gives way to an Evi one, and the hook hears when Evi's files arrive.
 */
export const nameplateHookPatch: SourcePatch = {
    find: /\?\.collectibles\?\.nameplate\)\?\?[\w$]+\.nameplate\},\[/,
    optional: true,
    replace: {
        match: /(\.useMemo\(\(\)=>\{if\(null!=(\i)\)return)(\(0,\i\.\i\)\(\i\?\.collectibles\?\.nameplate\))(\?\?\2\.nameplate\},\[\i,\2)\]/,
        with: `$1(${E}?.wears($2.id,"nameplate")?null:$3)$4,${E}?.useVersion?.()]`,
    },
};

/**
 * A nameplate's files (module 253292): the still, and a VP9 video or an animated image.
 *     return i.useMemo(()=>{if(null!=e.previewToolKey&&""!==e.previewToolKey){…
 * An evi: SKU gets the page's blob URLs.
 */
export const nameplateUrlPatch: SourcePatch = {
    find: 'previewToolKey&&""!==',
    optional: true,
    replace: {
        match: /(\.useMemo\(\(\)=>\{)(if\(null!=(\i)\.previewToolKey&&)/,
        with: `$1if(${E}?.isSku($3.skuId))return ${E}.nameplateUrls($3.skuId);$2`,
    },
};

/**
 * Discord's CDN address for a collectible's files (module 746002); every other kind of collectible
 * goes through it. An evi: SKU never gets Discord's CDN: a profile frame's layer (asked for by its
 * asset id) gets the page's blob URL, anything else none.
 *     function l(e){let{skuId:t,assetFormat:n,assetId:i}=e;return null==t?null:`${s}/media/v1/collectibles-shop/…
 */
export const assetUrlPatch: SourcePatch = {
    find: "/media/v1/collectibles-shop/",
    optional: true,
    replace: {
        match: /(\{skuId:(\i),assetFormat:(\i),assetId:(\i)\}=\i;return )(null==\2\?null:)/,
        with: `$1null==$2?null:${E}?.isSku($2)?${E}.assetUrl?.($2,$3,$4)??null:`,
    },
};

/**
 * Discord asking its API for a product it doesn't know (module 815996, fetchCollectiblesProduct):
 *     async function ea(e,t){o.h.dispatch({type:"COLLECTIBLES_PRODUCT_FETCH",skuId:e,…
 * Never for an evi: SKU, which would name it in a request to Discord.
 */
export const productFetchPatch: SourcePatch = {
    find: '"COLLECTIBLES_PRODUCT_FETCH",skuId:',
    optional: true,
    replace: {
        match: /(async function \i\((\i),\i\)\{)(\i\.\i\.dispatch\(\{type:"COLLECTIBLES_PRODUCT_FETCH",)/,
        with: `$1if(${E}?.isSku($2))return;$3`,
    },
};

/**
 * Your own profile's effect and frame (module 919395): the profile editor, its pickers and your own
 * profile read them straight from UserProfileStore, not through a DisplayProfile:
 *     function _(e){let{user:t,guildId:n}=e;return(0,i.bG)([s.A],()=>null==n?s.A.getUserProfile(t.id)?.profileEffect:s.A.getGuildMemberProfile(t.id,n)?.profileEffect)}
 * An Evi one goes first (a server profile's too, as everywhere else), and the hook redraws when Evi's
 * list changes.
 */
const ownProfilePatch = (field: "profileEffect" | "profileFrame"): SourcePatch => ({
    find: new RegExp(`\\.getUserProfile\\([\\w$]+\\.id\\)\\?\\.${field}:[\\w$]+\\.[\\w$]+\\.getGuildMemberProfile\\(`),
    optional: true,
    replace: {
        match: new RegExp(String.raw`(\{user:(\i),guildId:\i\}=\i;)return(\(0,\i\.\i\)\(\[\i\.\i\],\(\)=>)(null==\i\?\i\.\i\.getUserProfile\(\2\.id\)\?\.${field}:\i\.\i\.getGuildMemberProfile\(\2\.id,\i\)\?\.${field})\)\}`),
        with: `$1${E}?.useVersion?.();return$3${E}?.${field}?.($2.id)??($4))}`,
    },
});
export const ownEffectPatch = ownProfilePatch("profileEffect");
export const ownFramePatch = ownProfilePatch("profileFrame");

/**
 * The profile preview in the profile editor and its pickers (module 986687) reads your effect and frame
 * from the DisplayProfile's raw records, under what you're choosing:
 *     et=(0,A.lw)({pendingValue:T,userValue:$?._userProfile?.profileEffect,guildValue:…
 *     ed=q?void 0:(0,A.lw)({pendingValue:O,userValue:$?._userProfile?.profileFrame,guildValue:…
 * Yours from Evi are the user values there, so the preview shows what you wear.
 */
export const editorPreviewPatch: SourcePatch = {
    find: "userValue:$?._userProfile?.profileEffect",
    optional: true,
    replace: [
        {
            match: /userValue:(\i)\?\._userProfile\?\.profileEffect(?=,)/,
            with: `userValue:${E}?.profileEffect($1?.userId)??$1?._userProfile?.profileEffect`,
        },
        {
            match: /userValue:(\i)\?\._userProfile\?\.profileFrame(?=,)/,
            with: `userValue:${E}?.profileFrame?.($1?.userId)??$1?._userProfile?.profileFrame`,
        },
    ],
};

/**
 * A DisplayProfile's frame (module 999291), asked for each time like its effect:
 *     this.profileFrame=t?.profileFrame??e.profileFrame
 */
export const profileFramePatch: SourcePatch = {
    find: "this.profileFrame=",
    optional: true,
    replace: {
        match: /this\.profileFrame=(\i)\?\.profileFrame\?\?(\i)\.profileFrame(?=,)/,
        with: `(p=>Object.defineProperty(this,"profileFrame",{get:()=>${E}?.profileFrame?.(this.userId)??p.v,set:v=>void(p.v=v),enumerable:!0,configurable:!0}))({v:$1?.profileFrame??$2.profileFrame})`,
    },
};

/**
 * A profile frame by SKU (module 77157), from the shop's products or your purchases; everything that
 * draws a frame asks it (profiles, the editor, the picker's tiles):
 *     function l(e){return(0,i.bG)([r.A,a.A],()=>{if(null==e)return;let t=r.A.getProduct(e);…
 * An evi: SKU gets Evi's ProfileFrame record (frames.ts), and the hook redraws when its files arrive.
 */
export const frameConfigPatch: SourcePatch = {
    find: /function [\w$]+\([\w$]+\)\{return\(0,[\w$]+\.[\w$]+\)\(\[[\w$]+\.[\w$]+,[\w$]+\.[\w$]+\],\(\)=>\{if\(null==[\w$]+\)return;let [\w$]+=[\w$]+\.[\w$]+\.getProduct\(/,
    optional: true,
    replace: {
        match: /(function \i\((\i)\)\{)(return\(0,\i\.\i\)\(\[\i\.\i,\i\.\i\],\(\)=>\{if\(null==\2\)return;)/,
        with: `$1${E}?.useFrames?.();$3if(${E}?.isSku($2))return ${E}.frame($2);`,
    },
};

/**
 * A profile as Discord draws it (DisplayProfile, module 999291) is made once per fetched profile:
 *     this.profileEffect=t?.profileEffect??e.profileEffect
 * Its effect is asked for each time instead, so wearing one (or taking it off) shows on a profile
 * that's already open.
 */
export const profileEffectPatch: SourcePatch = {
    find: "this.profileEffect=",
    optional: true,
    replace: {
        match: /this\.profileEffect=(\i)\?\.profileEffect\?\?(\i)\.profileEffect(?=,)/,
        with: `(p=>Object.defineProperty(this,"profileEffect",{get:()=>${E}?.profileEffect(this.userId)??p.v,set:v=>void(p.v=v),enumerable:!0,configurable:!0}))({v:$1?.profileEffect??$2.profileEffect})`,
    },
};

/**
 * The effect player's config, looked up by SKU (module 942426): from the shop's products, or the
 * ones you bought, fetched from Discord when it has neither:
 *     function d(e){let t=(0,r.bG)([s.A,l.A],()=>{if(null==e)return;let t=s.A.getProduct(e);…},n=null!=e&&null==t;
 *     return i.useEffect(()=>{n&&(0,a.RE)(e)},[n,e]),t}
 * An evi: SKU gets Evi's config (layers as blob URLs, in Discord's shape) and is never fetched.
 */
export const effectConfigPatch: SourcePatch = {
    find: /\.getPurchase\([\w$]+\);if\(\(0,[\w$]+\.[\w$]+\)\([\w$]+\?\.items\[0\]\)\)return [\w$]+\.items\[0\]\}\),[\w$]+=null!=[\w$]+&&null==[\w$]+;return [\w$]+\.useEffect\(/,
    optional: true,
    group: true,
    replace: [
        {
            match: /(function \i\((\i)\)\{)(let \i=\(0,\i\.\i\)\(\[\i\.\i,\i\.\i\],\(\)=>\{if\(null==\2\)return;)/,
            with: `$1let eviFx=${E}?.effectConfig($2);${E}?.useVersion?.();if(${E}?.isSku($2))$2=void 0;$3`,
        },
        {
            match: /(\.useEffect\(\(\)=>\{\i&&\(0,\i\.\i\)\(\i\)\},\[\i,\i\]\),)(\i)\}/,
            with: "$1eviFx??$2}",
        },
    ],
};

/**
 * Discord's analytics (the module No Track also patches): every event goes through
 *     eg=e=>{let{addBreadcrumb:t,analyticEventConfigs:i,dispatcher:r,TRACK_ACTION_NAME:a}=e,…;return function(e,r){…}}
 * queued TRACKs through `.handleTrack=function(e){…}`, and uploads through
 *     function g(e,t){let n=Date.now(),r=e.map(e=>({...e,properties:{...e.properties,client_send_timestamp:n}}));…
 * Each takes Evi SKUs out of the properties (privacy.ts), so Discord never learns who wears one.
 */
export const analyticsPatch: SourcePatch = {
    find: '"AnalyticsTrackingStore"',
    optional: true,
    replace: [
        {
            match: /(?<=TRACK_ACTION_NAME:\i\}=\i,[^]{0,400}?)return function\(\i,(\i)\)\{/,
            with: `$&${E}?.scrub($1);`,
        },
        {
            match: /\.handleTrack=function\((\i)\)\{/,
            with: `$&${E}?.scrub($1?.properties);`,
        },
        {
            match: /function \i\((\i),\i\)\{(?=let \i=Date\.now\(\),\i=\i\.map\(\i=>\(\{\.\.\.\i,properties:\{\.\.\.\i\.properties,client_send_timestamp)/,
            with: `$&${E}?.scrubAll($1);`,
        },
    ],
};

/** By kind: what has to apply for that kind to be drawn at all */
export const COLLECTIBLE_PATCHES = {
    nameplate: [userNameplatePatch, nameplateUrlPatch],
    decoration: [userDecorationPatch, decorationUrlPatch],
    effect: [profileEffectPatch, effectConfigPatch],
    frame: [profileFramePatch, frameConfigPatch, assetUrlPatch],
} as const;

/** Every one, for registering */
export const ALL_COLLECTIBLE_PATCHES: SourcePatch[] = [
    userDecorationPatch, userNameplatePatch, mergePatch, memberDecorationPatch, decorationHookPatch, decorationUrlPatch,
    nameplateHookPatch, nameplateUrlPatch, assetUrlPatch, profileEffectPatch, effectConfigPatch, analyticsPatch,
    productFetchPatch, ownEffectPatch, ownFramePatch, editorPreviewPatch, profileFramePatch, frameConfigPatch,
];
