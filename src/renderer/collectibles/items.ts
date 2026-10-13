/**
 * Discord's own collectible item classes (a Nameplate, an AvatarDecoration, a ProfileEffect, a
 * ProfileFrame record). Discord's pickers only draw items that are instances of them (`e instanceof
 * Nameplate`), so Evi's items in "Your Nameplates" and the other pickers are made with Discord's own
 * classes. Each is found once by its constructor (`this.type=….NAMEPLATE,`), the one place Discord
 * names a kind of item; a Discord without one simply lists no Evi items in that picker.
 */
import type { CollectibleKind } from "@shared/collectibles";

import { Logger } from "../logger";
import { filters, find } from "../webpack/find";

const logger = new Logger("Collectibles", "#c27aff");

/** Discord's CollectiblesItemType for each kind (module 575593 on 2026-10-13) */
export const ITEM_TYPE: Record<CollectibleKind, number> = { decoration: 0, effect: 1, nameplate: 2, frame: 3 };

const TYPE_NAME: Record<CollectibleKind, string> = { nameplate: "NAMEPLATE", decoration: "AVATAR_DECORATION", effect: "PROFILE_EFFECT", frame: "PROFILE_FRAME" };

type ItemClass = new (fields: Record<string, unknown>) => object;
const classes = new Map<CollectibleKind, ItemClass | null>();

/** For tests: stand-ins for Discord's classes */
export function setItemClass(kind: CollectibleKind, cls: ItemClass | null | undefined) {
    if (cls === undefined) classes.delete(kind);
    else classes.set(kind, cls);
}

/** Discord's item class of a kind, or undefined when this Discord has none Evi recognises */
export function itemClass(kind: CollectibleKind): ItemClass | undefined {
    if (classes.has(kind)) return classes.get(kind) ?? undefined;
    let found: ItemClass | undefined;
    try {
        found = find<ItemClass>(filters.byCode(new RegExp(`this\\.type=[\\w$]+\\.[\\w$]+\\.${TYPE_NAME[kind]},`), "static fromServer"));
    } catch (err) {
        logger.warn(`Couldn't look for Discord's ${kind} class`, err);
    }
    // Not loaded yet is asked again next time; a picker only shows once its module loaded the class
    if (found) classes.set(kind, found);
    return found;
}

/** An item of Discord's class for a kind, or undefined without the class */
export function makeItem(kind: CollectibleKind, fields: Record<string, unknown>): object | undefined {
    const cls = itemClass(kind);
    if (!cls) return undefined;
    try {
        return new cls(fields);
    } catch (err) {
        logger.warn(`Couldn't make a ${kind} item`, err);
        classes.set(kind, null);
        return undefined;
    }
}
