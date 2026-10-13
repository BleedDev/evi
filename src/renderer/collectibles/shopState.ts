/**
 * Whether Evi's page shows in Discord's Shop, and Evi's tab among Discord's (ui/CollectiblesShop.tsx
 * draws them). Kept apart from the UI so it can be tested on its own.
 */
import { getPatchRecords } from "../patching/source";
import { shopContentPatch } from "./shopPatches";

/** Evi's key among Discord's tabs, and the address its link points at */
export const EVI_TAB = "evi";
export const EVI_ROUTE = "/shop?tab=evi";

let open = false;
const listeners = new Set<() => void>();

export const ShopState = {
    showing: () => open,
    set(next: boolean) {
        if (open === next) return;
        open = next;
        listeners.forEach(l => l());
    },
    subscribe(listener: () => void) {
        listeners.add(listener);
        return () => void listeners.delete(listener);
    },
};

/** One of Discord's tabs, as useCollectiblesShopNavigationMenuOptions makes them */
export interface NavOption {
    type: "page" | "menu";
    key: string;
    text: string;
    route?: string;
    onClick?(...args: unknown[]): unknown;
    options?: NavOption[];
    icon?: unknown;
    [other: string]: unknown;
}

/** Whether Discord's Shop page takes Evi's page: Evi's tab only shows when it does */
export function contentPatched() {
    return getPatchRecords("evi").some(r => r.patch === shopContentPatch && r.state === "applied");
}

/** Discord's tabs, clicked: Evi's page closes first (one that's already Discord's selected tab doesn't move it) */
function leaving(options: NavOption[]): NavOption[] {
    return options.map(option => ({
        ...option,
        ...option.onClick && {
            onClick: (...args: unknown[]) => {
                ShopState.set(false);
                return option.onClick!(...args);
            },
        },
        ...Array.isArray(option.options) && { options: leaving(option.options) },
    }));
}

/** Discord's tabs with Evi's after the first (Featured); undefined to leave them as they are */
export function withEviTab(options: NavOption[], tab: { text: string; icon?: unknown; }): NavOption[] | undefined {
    if (!Array.isArray(options) || !contentPatched()) return undefined;
    const ours: NavOption = { ...tab, type: "page", key: EVI_TAB, route: EVI_ROUTE, onClick: () => ShopState.set(true) };
    const theirs = leaving(options);
    return [...theirs.slice(0, 1), ours, ...theirs.slice(1)];
}
