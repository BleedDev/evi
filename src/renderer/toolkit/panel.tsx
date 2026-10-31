/**
 * Plugin switches in the user panel, beside mute and deafen (ctx.panelToggle). Evi owns one spot
 * there, right after deafen: a single switch shows as its own button; two or more fold into one Evi
 * button that opens Discord's menu with a switch for each. The panel never grows by more than one
 * icon, so your name keeps its room and Discord's settings gear is never pushed out of it.
 *
 * The buttons are Discord's own (the component mute and deafen use), so they look and move like
 * them, red glow included. The menu is Discord's context menu, opened at the button.
 */
import type { ComponentType, MouseEvent as ReactMouseEvent } from "react";

import { t, useLocale } from "../i18n";
import { Logger } from "../logger";
import { loadedModulesMatching, replaceLive } from "../patching/live";
import type { SourcePatch } from "../patching/source";
import { CORE_PATCH_SLOTS, registerPatches } from "../patching/source";
import { createStyle } from "../styles";
import { DiscordUI } from "../ui/discord";
import { Dispatcher, React } from "../webpack/common";
import { filters, find } from "../webpack/find";
import { wreq } from "../webpack/runtime";
import { Menu } from "./contextMenu";

const logger = new Logger("Panel", "#5865f2");

export interface PanelIconProps { width?: number; height?: number; }

export interface PanelToggle {
    /** The switch's name in Evi's menu, e.g. "Share my activity" */
    label(): string;
    /** The tooltip while it has a button of its own: what clicking does, e.g. "Hide my activity" */
    tooltip(checked: boolean): string;
    /** Its icon in either state */
    icon(checked: boolean): ComponentType<PanelIconProps>;
    isChecked(): boolean;
    /** Calls `onChange` whenever isChecked() may have changed; returns the unsubscribe */
    subscribe(onChange: () => void): () => void;
    /** Whether this state deserves Discord's red warning glow, like being muted */
    alert(checked: boolean): boolean;
    toggle(): void;
}

interface Entry extends PanelToggle { id: string; }

let entries: Entry[] = [];
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(l => l());
const subscribeEntries = (cb: () => void) => {
    listeners.add(cb);
    return () => void listeners.delete(cb);
};

/** Adds a plugin's switch; returns what takes it away again */
export function addPanelToggle(id: string, toggle: PanelToggle) {
    const entry: Entry = { ...toggle, id };
    entries = [...entries.filter(e => e.id !== id), entry];
    emit();
    return () => {
        if (!entries.includes(entry)) return;
        entries = entries.filter(e => e !== entry);
        emit();
    };
}

/** After Discord's deafen button in the user panel: Evi's one spot */
export const panelPatch: SourcePatch = {
    find: "handleOpenSettingsContextMenu",
    replace: {
        match: /(?<=\(0,\i\.jsx\)\(\i,\{selfDeaf:\i,serverDeaf:\i,[^{}]*\}\)),/,
        with: "$&window.Evi?.panelSlot?.(arguments[0]),",
    },
};

let patched = false;
/** Why the user panel only gets Evi's spot after a Discord reload, when it couldn't be re-run */
let reloadReason: string | undefined;
/**
 * Registered at boot only when an enabled plugin asks for a switch (toolkit/index.ts). A plugin
 * turned on later finds the user panel already loaded: it's re-run with the patch (patching/live.ts).
 * Returns why Discord needs a reload first, if it does.
 */
export function ensurePanelPatch(): string | undefined {
    if (patched) return reloadReason;
    patched = true;
    registerPatches("evi", [panelPatch], CORE_PATCH_SLOTS.panel);
    if (!wreq) return;
    const failures = replaceLive(loadedModulesMatching([panelPatch])).filter(o => !o.ok);
    if (failures.length) {
        reloadReason = [...new Set(failures.map(f => f.reason))].join(", ");
        logger.warn("The user panel needs a reload for plugin switches", failures);
    }
    return reloadReason;
}

/** The user panel's button, the one mute and deafen use */
let PanelButton: ComponentType<any> | undefined;
const panelButton = () => PanelButton ??= find(filters.byCode(".GREEN,positionKeyStemOverride:"));

type OpenContextMenu = (event: ReactMouseEvent, render: (props: any) => React.ReactNode) => void;
const openContextMenu = (): OpenContextMenu | undefined => find(filters.byCode("enableSpellCheck", "renderLazy"));
const MenuRoot = (): ComponentType<any> | undefined => find(filters.componentByCode("Menu API only allows Items"));
const closeContextMenu = () => void Dispatcher.dispatch({ type: "CONTEXT_MENU_CLOSE" });

/** Re-renders when any of `list` changes state */
function useStates(list: Entry[]) {
    const subscribe = React.useCallback((cb: () => void) => {
        const offs = list.map(e => e.subscribe(cb));
        return () => offs.forEach(off => off());
    }, [list]);
    const key = () => list.map(e => (e.isChecked() ? "1" : "0")).join("");
    return React.useSyncExternalStore(subscribe, key);
}

function Button({ label, icon, checked, alert, plated, onClick }: {
    label: string;
    icon: ComponentType<PanelIconProps>;
    checked?: boolean;
    alert: boolean;
    plated: boolean;
    onClick(e: ReactMouseEvent): void;
}) {
    const Native = panelButton();
    if (Native) {
        return (
            <Native
                tooltipText={label}
                icon={icon}
                {...checked !== undefined ? { role: "switch", "aria-checked": checked } : { "aria-haspopup": "menu" }}
                redGlow={alert}
                plated={plated}
                onClick={onClick}
            />
        );
    }
    // Discord renamed its button: a plain one of the same size
    const Icon = icon;
    const button = (
        <button
            type="button"
            className="evi-panel-button"
            data-alert={alert || undefined}
            aria-label={label}
            {...checked !== undefined ? { "aria-pressed": checked } : { "aria-haspopup": "menu" as const }}
            onClick={onClick}
        >
            <Icon width={20} height={20} />
        </button>
    );
    const Tooltip = DiscordUI.Tooltip.get;
    return Tooltip ? <Tooltip text={label} position="top">{button}</Tooltip> : button;
}

function Single({ entry, plated }: { entry: Entry; plated: boolean; }) {
    useLocale();
    // The same list each render: a new one would unsubscribe and subscribe again on every panel update
    useStates(React.useMemo(() => [entry], [entry]));
    const checked = entry.isChecked();
    return <Button label={entry.tooltip(checked)} icon={entry.icon(checked)} checked={checked} alert={entry.alert(checked)} plated={plated} onClick={() => entry.toggle()} />;
}

/** Evi's menu of switches, live: flipping one updates it in place */
function MenuContent({ list, props }: { list: Entry[]; props: any; }) {
    useStates(list);
    const Root = MenuRoot();
    if (!Root) return null;
    return (
        <Root navId="evi-panel-toggles" onClose={closeContextMenu} aria-label={t("panel.toggles")} onSelect={undefined} {...props}>
            <Menu.Group>
                {list.map(e => (
                    <Menu.CheckboxItem key={e.id} id={`evi-panel-${e.id}`} label={e.label()} checked={e.isChecked()} action={() => e.toggle()} />
                ))}
            </Menu.Group>
        </Root>
    );
}

function Group({ list, plated }: { list: Entry[]; plated: boolean; }) {
    useLocale();
    useStates(list);
    const alert = list.some(e => e.alert(e.isChecked()));
    const open = (event: ReactMouseEvent) => {
        const openMenu = openContextMenu();
        if (!openMenu) return logger.warn("Discord's context menu wasn't found");
        openMenu(event, props => <MenuContent list={list} props={props} />);
    };
    return <Button label={t("panel.toggles")} icon={TogglesIcon} alert={alert} plated={plated} onClick={open} />;
}

function Slot({ nameplate }: { nameplate?: unknown; }) {
    const list = React.useSyncExternalStore(subscribeEntries, () => entries);
    if (!list.length) return null;
    const plated = nameplate != null;
    if (list.length === 1) return <Single key={list[0].id} entry={list[0]} plated={plated} />;
    // Keyed by who's in it: a different set of switches starts fresh
    return <Group key={list.map(e => e.id).join()} list={list} plated={plated} />;
}

let styled = false;
/** What the patched panel calls, with its props */
export function renderPanelSlot(props?: { nameplate?: unknown; }) {
    if (!styled) {
        styled = true;
        createStyle(panelCss, "evi-panel");
    }
    return <Slot key="evi-panel-slot" nameplate={props?.nameplate} />;
}

/** Two switches, one on and one off: Evi's quick switches */
function TogglesIcon({ width = 20, height = 20 }: PanelIconProps) {
    return (
        <svg width={width} height={height} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path fillRule="evenodd" d="M7 3.5h10a4.5 4.5 0 0 1 0 9H7a4.5 4.5 0 0 1 0-9Zm10 7a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z" />
            <path fillRule="evenodd" d="M7 13.5h10a4.5 4.5 0 0 1 0 9H7a4.5 4.5 0 0 1 0-9Zm0 2a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5Z" opacity={0.6} />
        </svg>
    );
}

export const panelCss = `
.evi-panel-button { display: flex; align-items: center; justify-content: center; flex: 0 0 auto;
    inline-size: 32px; block-size: 32px; padding: 0; border: 0; border-radius: var(--radius-sm, 8px); cursor: pointer;
    background: transparent; color: var(--interactive-icon-default, var(--interactive-normal)); }
@media (hover: hover) {
    .evi-panel-button:hover { background: var(--interactive-background-hover, var(--background-modifier-hover)); color: var(--interactive-icon-hover, var(--interactive-hover)); }
}
.evi-panel-button[data-alert] { color: var(--status-danger, #da373c); }
.evi-panel-button:focus-visible { outline: 2px solid var(--focus-primary, #5865f2); outline-offset: -2px; }
`;
