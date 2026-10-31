/**
 * Adding items to Discord's menus (right-click menus, "..." popouts).
 *
 * Every menu is Discord's <Menu navId="..."> component, which reads its items from `children`. A
 * single export hook on Menu lets registered callbacks edit those children before it renders. The
 * menu's context (the message, user, guild...) comes from the `eviMenuArgs` prop that the core
 * source patch in menuArgs.ts adds next to `navId`.
 *
 * Items must be Discord's own marker components (Menu.Item, Menu.Group...): Menu throws on anything
 * else. They live in one module that only Menu's source names, so they're resolved from there.
 */
import type { ComponentType, ReactElement, ReactNode } from "react";

import { Logger } from "../logger";
import { CORE_PATCH_SLOTS, registerPatches, SourcePatch } from "../patching/source";
import { React } from "../webpack/common";
import { filters, findExport, functionSource, requireModule } from "../webpack/find";
import { getOriginalFactory, wreq } from "../webpack/runtime";
import { injectMenuArgs, MENU_ARGS_KEY } from "./menuArgs";
import { SharedHook } from "./shared";

const logger = new Logger("ContextMenu", "#5865f2");

export const menuFilter = filters.componentByCode("Menu API only allows Items");

/** Core source patch: passes each menu's surrounding props to Menu, see menuArgs.ts */
export const menuArgsPatch: SourcePatch = {
    find: /[{,]navId:/,
    replace: { match: /(?<=[{,])navId:/g, with: injectMenuArgs },
    all: true,
    optional: true,
    live: false,
};

/**
 * @param children  the menu's items, mutable: push, splice or replace entries
 * @param props     props of the component that rendered the menu (message, channel, user, guild...),
 *                  or {} when Discord's code gave no way to reach them
 * @param menuProps the Menu's own props (navId, onClose...)
 */
export type ContextMenuCallback = (children: ReactNode[], props: Record<string, any>, menuProps: Record<string, any>) => void;

const callbacks = new Map<string, Set<ContextMenuCallback>>();

let menuArgsRegistered = false;
/**
 * The props patch touches ~190 menu modules, so it is only registered once something needs it: at
 * boot when an enabled plugin uses context menus, otherwise on the first registration (menus
 * Discord already loaded then get props after a reload).
 */
export function ensureMenuArgsPatch() {
    if (menuArgsRegistered) return;
    menuArgsRegistered = true;
    registerPatches("evi", [menuArgsPatch], CORE_PATCH_SLOTS.contextMenu);
}

/**
 * Menu re-renders (focus, hover) with the same children, so callbacks must never edit Discord's
 * arrays: an item pushed into a group would be added again on every render, until React gives up.
 * Groups and submenus are copied down to their item arrays; leaf items are shared as they are.
 */
export function copyItemTree(node: ReactNode): ReactNode {
    if (Array.isArray(node)) return node.map(copyItemTree);
    const children = (node as ReactElement<any> | null)?.props?.children;
    if (children == null || typeof children !== "object") return node;
    return React.cloneElement(node as ReactElement<any>, undefined, copyItemTree(children));
}

const menuHook = new SharedHook(menuFilter, "before", ctx => {
    const props = ctx.args[0];
    if (!props || typeof props !== "object") return;
    const forMenu = callbacks.get(props.navId);
    const forAll = callbacks.get("*");
    if (!forMenu?.size && !forAll?.size) return;

    const copied = copyItemTree(props.children);
    const children: ReactNode[] = Array.isArray(copied) ? copied : copied == null ? [] : [copied];
    const args = props[MENU_ARGS_KEY] ?? {};
    for (const cb of [...forMenu ?? [], ...forAll ?? []]) {
        try {
            cb(children, args, props);
        } catch (err) {
            logger.error(`A context menu callback for "${props.navId}" threw`, err);
        }
    }
    ctx.args[0] = { ...props, children };
});

/**
 * Calls `callback` whenever the menu with this navId renders ("message", "user-context",
 * "guild-context", "channel-context"..., or "*" for every menu). Returns a function that removes it.
 */
export function addContextMenuPatch(navId: string | string[], callback: ContextMenuCallback): () => void {
    ensureMenuArgsPatch();
    const ids = Array.isArray(navId) ? navId : [navId];
    // Own identity per registration, so registering one function twice needs two removals
    const entry: ContextMenuCallback = (...args) => callback(...args);
    for (const id of ids) {
        let set = callbacks.get(id);
        if (!set) callbacks.set(id, set = new Set());
        set.add(entry);
    }
    const release = menuHook.acquire();
    return () => {
        for (const id of ids) callbacks.get(id)?.delete(entry);
        release();
    };
}

/** Whether the Menu component is currently hooked (some plugin registered an item and Menu loaded) */
export const isMenuHooked = () => menuHook.installed;

export interface MenuItemProps {
    id: string;
    label?: ReactNode;
    action?(event: MouseEvent): void;
    disabled?: boolean;
    color?: "default" | "danger" | "brand" | "premium" | "positive";
    icon?: ComponentType<any>;
    subtext?: ReactNode;
    /** Nested items make a submenu */
    children?: ReactNode;
    /** Custom renderer instead of label/icon */
    render?(props: any): ReactNode;
}

export interface MenuCheckboxItemProps extends MenuItemProps {
    checked: boolean;
}

export interface MenuRadioItemProps extends MenuItemProps {
    group: string;
    checked: boolean;
}

export interface MenuControlItemProps {
    id: string;
    label?: ReactNode;
    control(props: any, ref: any): ReactNode;
    disabled?: boolean;
}

export interface MenuComponents {
    Item: ComponentType<MenuItemProps>;
    Group: ComponentType<{ label?: ReactNode; children?: ReactNode; }>;
    Separator: ComponentType<{}>;
    CheckboxItem: ComponentType<MenuCheckboxItemProps>;
    RadioItem: ComponentType<MenuRadioItemProps>;
    SwitchItem: ComponentType<MenuCheckboxItemProps>;
    ControlItem: ComponentType<MenuControlItemProps>;
    TextInput: ComponentType<any>;
}

/** What Menu's child parser turns each marker into, see "Menu API only allows Items" */
const ITEM_KINDS: Record<string, keyof MenuComponents> = {
    separator: "Separator",
    groupstart: "Group",
    customitem: "Item",
    checkbox: "CheckboxItem",
    radio: "RadioItem",
    switch: "SwitchItem",
    textinput: "TextInput",
    control: "ControlItem",
};

let resolved: Partial<MenuComponents> | undefined;

/**
 * Reads Menu's child parser (`if(x.type===Items.K)return list.push({type:"separator"...`) to learn
 * which export of the items module is which, then loads that module.
 */
export function resolveMenuComponents(): Partial<MenuComponents> | undefined {
    if (resolved || !wreq) return resolved;
    const menu = findExport(menuFilter);
    if (!menu) return;

    const factory = getOriginalFactory(wreq.m[menu.id]);
    if (!factory) return;
    const source = functionSource(factory);
    const keys: Partial<Record<keyof MenuComponents, string>> = {};
    let namespace: string | undefined;
    for (const m of source.matchAll(/\.type===([\w$]+)\.([\w$]+)\)/g)) {
        const kind = source.slice(m.index + m[0].length, m.index + m[0].length + 200).match(/type:"(\w+)"/)?.[1];
        const name = kind && ITEM_KINDS[kind];
        if (!name || keys[name]) continue;
        if (namespace && namespace !== m[1]) continue;
        namespace = m[1];
        keys[name] = m[2];
    }

    const escaped = namespace?.replace(/\$/g, "\\$");
    const moduleId = escaped && source.match(new RegExp(`[,;\\s]${escaped}=[\\w$]+\\((\\d+)\\)`))?.[1];
    if (!moduleId || !keys.Item) {
        logger.error("Could not find Discord's menu item components in Menu's source");
        return;
    }

    const exports = requireModule(moduleId);
    const components: Partial<MenuComponents> = {};
    for (const [name, key] of Object.entries(keys)) (components as any)[name] = exports[key];
    return resolved = components;
}

/**
 * Discord's menu item components, for items added with ctx.contextMenu. Resolved on first use;
 * reading one before Discord's Menu module has loaded throws.
 */
export const Menu = new Proxy({} as MenuComponents, {
    get(_, name) {
        if (typeof name !== "string" || !Object.values(ITEM_KINDS).includes(name as keyof MenuComponents)) return undefined;
        const component = resolveMenuComponents()?.[name as keyof MenuComponents];
        if (!component) throw new Error(`Evi: Discord's Menu.${name} is not available`);
        return component;
    },
});

/**
 * The children array of the group that contains the item with this id, to insert next to it:
 *   findMenuGroup(children, "devmode-copy-id")?.push(<Menu.Item ... />)
 */
export function findMenuGroup(children: ReactNode, id: string): ReactNode[] | undefined {
    if (!Array.isArray(children)) return;
    for (const child of children) {
        if (Array.isArray(child)) {
            const found = findMenuGroup(child, id);
            if (found) return found;
            continue;
        }
        const props = (child as ReactElement<any> | null)?.props;
        if (!props) continue;
        if (props.id === id) return children;
        // A lone child isn't in an array we could insert into, but its own descendants may be
        const nested = Array.isArray(props.children) ? props.children : [props.children];
        const found = findMenuGroup(nested, id);
        if (found && (found !== nested || nested === props.children)) return found;
    }
}
