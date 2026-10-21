import type { KeyboardEvent } from "react";

import { t, useLocale } from "../i18n";
import { isRecording } from "../keybinds";
import { Developer } from "../developer";
import { Native } from "../native";
import { React } from "../webpack/common";
import { Button, ErrorBoundary, Icon, openDialogs, Text, trapTab, useStore } from "./components";
import { showTab } from "./nav";
import { PageView, visiblePages } from "./pages";
import { currentRelease, WhatsNewModal } from "./WhatsNew";
import { ensureStyles } from "./stylesheet";
import { mountRoot } from "./discordContext";

type View = "closed" | "open" | "closing";

let view: View = "closed";
const listeners = new Set<() => void>();
const setView = (next: View) => {
    view = next;
    listeners.forEach(l => l());
};
const subscribe = (l: () => void) => {
    listeners.add(l);
    return () => void listeners.delete(l);
};

const CLOSE_MS = 150;
const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches || document.documentElement.classList.contains("reduce-motion");

function close() {
    if (view !== "open") return;
    if (reducedMotion()) return setView("closed");
    setView("closing");
    setTimeout(() => view === "closing" && setView("closed"), CLOSE_MS);
}

// Each page has its tabs along the top, see pages.tsx
let tabs = visiblePages();

// Remembered across closing and reopening, like Discord's settings remember their last page
let lastTab = tabs[0].id;
/** The open panel's page switch, for SettingsUI.open(page) while it's already open */
let switchPage: ((id: string) => void) | undefined;

function Panel() {
    useLocale();
    // The Developers page comes and goes with the linked account
    useStore(Developer.subscribe, Developer.isDev);
    tabs = visiblePages();
    const [tab, setTabState] = React.useState(lastTab);
    const [whatsNew, setWhatsNew] = React.useState(false);
    const release = currentRelease();
    const panelRef = React.useRef<HTMLDivElement>(null);
    const bodyRef = React.useRef<HTMLDivElement>(null);
    const current = tabs.find(t => t.id === tab) ?? tabs[0];

    const setTab = (id: string) => {
        lastTab = id;
        setTabState(id);
        bodyRef.current?.scrollTo({ top: 0 });
    };

    React.useEffect(() => {
        switchPage = setTab;
        return () => void (switchPage = undefined);
    }, []);

    React.useEffect(() => {
        const previouslyFocused = document.activeElement as HTMLElement | null;
        panelRef.current?.focus();
        return () => previouslyFocused?.focus?.();
    }, []);

    // Vertical tablist: arrows move between sections, Home and End jump to the ends
    const onTabKey = (e: KeyboardEvent) => {
        const index = tabs.findIndex(t => t.id === tab);
        const next = { ArrowDown: index + 1, ArrowUp: index - 1, Home: 0, End: tabs.length - 1 }[e.key];
        if (next === undefined) return;
        e.preventDefault();
        const target = tabs[(next + tabs.length) % tabs.length];
        setTab(target.id);
        document.getElementById(`dl-tab-${target.id}`)?.focus();
    };

    // Keep Tab inside the dialog while it's open
    const onKeyDown = (e: KeyboardEvent) => trapTab(e, panelRef.current);

    return (
        <div className="dl-scrim" data-closing={view === "closing" ? "" : undefined} onMouseDown={e => e.target === e.currentTarget && close()}>
            <div className="dl-panel" role="dialog" aria-modal="true" aria-labelledby="dl-title" tabIndex={-1} ref={panelRef} onKeyDown={onKeyDown}>
                <nav className="dl-sidebar" aria-label="Evi">
                    <div className="dl-sidebar-head">
                        <Text tag="h2" variant="text-xs/semibold" color="text-muted" id="dl-title" className="dl-sidebar-title">Evi</Text>
                    </div>
                    <div className="dl-nav" role="tablist" aria-label={t("panel.sections")} aria-orientation="vertical" onKeyDown={onTabKey}>
                        {tabs.map(t => (
                            <button
                                key={t.id}
                                type="button"
                                role="tab"
                                className="dl-nav-item"
                                id={`dl-tab-${t.id}`}
                                aria-selected={t.id === tab}
                                aria-controls="dl-tabpanel"
                                tabIndex={t.id === tab ? 0 : -1}
                                onClick={() => setTab(t.id)}
                            >
                                <Icon name={t.icon} size={20} />
                                <span>{t.label()}</span>
                            </button>
                        ))}
                    </div>
                    <div className="dl-sidebar-foot">
                        <Button icon="folder" onClick={() => Native.openPath("data")}>{t("panel.openDataFolder")}</Button>
                        <button type="button" className="dl-link-button dl-version-link" onClick={() => setWhatsNew(true)}>
                            <Text variant="text-xs/normal" color="text-muted" tabular>{t("panel.versionWhatsNew", { version: EVI_VERSION })}</Text>
                        </button>
                    </div>
                </nav>
                <div className="dl-content">
                    <header className="dl-content-head">
                        <Text tag="h1" variant="heading-xl/semibold" color="text-strong" className="dl-content-title">{current.label()}</Text>
                        <div className="dl-close">
                            <button type="button" className="dl-close-button" aria-label={t("panel.close")} onClick={close}>
                                <Icon name="closeLarge" size={18} />
                            </button>
                            <span className="dl-close-hint" aria-hidden="true">ESC</span>
                        </div>
                    </header>
                    <div className="dl-body" role="tabpanel" id="dl-tabpanel" aria-labelledby={`dl-tab-${current.id}`} ref={bodyRef}>
                        <ErrorBoundary resetKey={current.id}><PageView page={current} /></ErrorBoundary>
                    </div>
                </div>
                {whatsNew && release && <WhatsNewModal releases={[release]} onClose={() => setWhatsNew(false)} />}
            </div>
        </div>
    );
}

function Root() {
    const current = useStore(subscribe, () => view);
    return current === "closed" ? null : <Panel />;
}

export { ensureStyles };

let mounted = false;
function mount() {
    if (mounted) return;
    mounted = true;
    ensureStyles();
    mountRoot(<Root />, "dl-root");
}

export const SettingsUI = {
    /** Opens the panel, on `page` when given (see pages.tsx) */
    open(page?: string) {
        if (page && visiblePages().some(t => t.id === page)) {
            lastTab = page;
            // Already open on another page: go there
            switchPage?.(page);
        }
        mount();
        setView("open");
    },
    /**
     * Opens the panel on one of a page's tabs. showTab alone only changes which tab that page
     * shows, so nothing happens on screen when another page is the one showing
     */
    openTab(page: string, tab: string) {
        showTab(page, tab);
        SettingsUI.open(page);
    },
    close,
    toggle() {
        view === "open" ? close() : SettingsUI.open();
    },
};

export function installHotkey() {
    // Capture phase, so Discord's own key handlers never see our shortcut
    window.addEventListener("keydown", e => {
        // Being recorded as a plugin's shortcut
        if (isRecording(e.target)) return;
        const toggle = e.ctrlKey && e.shiftKey && !e.altKey && e.code === "KeyD";
        // An open dialog closes first, with its own Escape handler
        const escape = e.key === "Escape" && view === "open" && !openDialogs;
        if (!toggle && !escape) return;

        e.preventDefault();
        e.stopImmediatePropagation();
        toggle ? SettingsUI.toggle() : close();
    }, true);
}
