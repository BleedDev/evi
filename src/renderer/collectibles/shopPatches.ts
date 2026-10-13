/**
 * Evi collectibles in Discord's own Shop (Home > Shop): an "Evi" tab in the Shop's tab bar, and Evi's
 * page in the Shop's content area while it's selected (ui/CollectiblesShop.tsx, at
 * window.Evi.collectiblesShop).
 *
 * The Evi page isn't one of Discord's tabs: Discord's selected tab, its address and what it reports
 * stay as they were, Evi only draws its page over the content and marks its tab selected. Every
 * patch is optional and matched on stable strings. The tab only shows once the page can (the
 * content patch applied), so a Discord that changed its Shop simply has no Evi tab.
 *
 * Read off Discord's web build of 2026-10-13. Finds are plain RegExps (`\i` only works in matches).
 */
import type { SourcePatch } from "../patching/source";

const S = "window.Evi?.collectiblesShop";

/**
 * The Shop's header bar (CollectiblesShopHeaderBar, module 626148). Its tabs come from
 * useCollectiblesShopNavigationMenuOptions, a list of { type, key, text, route, onClick } ending
 *     if(null!=O){…l.push({type:"page",key:R.G2.PROMOTION,text:O.title,…,onClick:()=>(0,m.pX)(e)})}return l},[e,L,O,E,u,A,C])
 * and the tab bar draws them with `selectedKey:es`. Evi's tab goes in the list, and is the selected
 * one while Evi's page shows (a hook: the header redraws when that changes).
 */
export const shopTabsPatch: SourcePatch = {
    find: '"useCollectiblesShopNavigationMenuOptions"',
    optional: true,
    group: true,
    replace: [
        {
            match: /(key:\i\.\i\.PROMOTION,.{0,200}?\}return )(\i)\}/,
            with: `$1${S}?.tabs($2)??$2}`,
        },
        {
            match: /selectedKey:(\i),overflowLabel:/,
            with: `selectedKey:${S}?.useSelectedKey?.($1)??$1,overflowLabel:`,
        },
    ],
};

/**
 * The Shop page (module 791519) puts the selected tab's content in a wrapper that fades between tabs:
 *     children:(0,i.jsx)(nX,{tab:Y,refreshCategories:B,transitionToTab:W,transitionState:$,categories:G,updateAnalyticsState:V})
 * Evi's page takes that place while its tab is selected; Discord's content otherwise.
 */
export const shopContentPatch: SourcePatch = {
    find: /\{selectedTab:[\w$]+,transitionState:[\w$]+,transitionToTab:[\w$]+\}=\(0,/,
    optional: true,
    replace: {
        match: /children:(\(0,\i\.jsx\)\(\i,\{tab:(\i),refreshCategories:\i,transitionToTab:\i,[^{}]*\}\))/,
        with: `children:${S}?.content?.($1,$2)??$1`,
    },
};

/**
 * Discord moving to one of its own tabs (module 983545, transitionToTab), from anywhere in the Shop:
 * its tabs, the Shop button left of them, the search field. Evi's page closes first.
 *     g=n.useCallback(async(e,a)=>{if(T(),e===E.G2.CATALOG)L();…
 */
export const shopLeavePatch: SourcePatch = {
    find: /return\{selectedTab:[\w$]+,transitionState:[\w$]+,transitionToTab:[\w$]+\}/,
    optional: true,
    replace: {
        match: /(\.useCallback\(async\(\i,\i\)=>\{)/,
        with: `$1${S}?.leave?.();`,
    },
};

export const SHOP_PATCHES: SourcePatch[] = [shopTabsPatch, shopContentPatch, shopLeavePatch];
