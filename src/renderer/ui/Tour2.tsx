/**
 * "What's new in Evi 2.0": shown once, the first time Evi starts on 2.0 or later, in place of the
 * usual What's new (WhatsNew.tsx decides). Four steps: a welcome, the new plugins as cards with a
 * small looping illustration each to pick from, turning the picked ones on (installed from the store
 * and switched on, one at a time), and done. It counts as seen as soon as it opens, so skipping it, or
 * Discord closing under it, never brings it back. Plugins the store doesn't list (yet), can't install
 * on this Evi, or that need full access to the computer (they ask for consent on their own page) are
 * left out. Never in safe mode or the in-game overlay: Evi's startup doesn't get this far there.
 */
import { compareVersions } from "@shared/store";
import { isPluginEnabled } from "@shared/ipc";
import type { EviKey } from "@shared/locales";

import { t, useLocale } from "../i18n";
import { PluginManager } from "../plugins/manager";
import { Settings } from "../settings";
import { Store } from "../store";
import { createRoot, onCreateRootReady, React, ReactDOM } from "../webpack/common";
import { whenAppReady } from "./appReady";
import { Button, FocusLayer, Icon, Switch, useExit, useModal, useStore } from "./components";
import { DiscordContext } from "./discordContext";
import { ensureStyles, SettingsUI } from "./index";
import { openStore } from "./nav";

/** The release the tour introduces */
export const TOUR_VERSION = "2.0.0";

/** The wave's plugins, in the order the cards show */
export const TOUR_PLUGINS = [
    "voice-messages", "search-highlight", "rich-presence", "click-actions",
    "role-colours", "embed-builder", "audit-log-plus", "soundboard-stealer",
    "fix-embeds", "quick-markup", "hover-converter", "code-block-tools",
] as const;
type TourPlugin = typeof TOUR_PLUGINS[number];

/** Due once, on 2.0 or later (betas of 2.0 too) */
export function tourDue(version = EVI_VERSION) {
    return !Settings.data.tour2Seen && compareVersions(version.split("-")[0], TOUR_VERSION) >= 0;
}

type Step = "welcome" | "pick" | "install" | "done";
type Progress = Record<string, "waiting" | "working" | "done" | "failed">;

interface Offer {
    id: TourPlugin;
    name: string;
    pitch: string;
    /** Installed and switched on already: shown, not offered */
    on: boolean;
}

/** What the tour can offer, from the store as it is now */
function offers(): Offer[] {
    const { plugins } = Store.getSnapshot();
    const list: Offer[] = [];
    for (const id of TOUR_PLUGINS) {
        const entry = plugins.find(p => p.id === id);
        if (!entry || entry.native) continue;
        const action = Store.pluginAction(id);
        if (!action || action === "incompatible" || action === "pulled") continue;
        const loaded = PluginManager.get(id);
        const on = !!loaded && isPluginEnabled(Settings.data, loaded.manifest);
        list.push({ id, name: entry.name, pitch: entry.description || t(`tour.pitch.${id}` as EviKey), on });
    }
    return list;
}

async function turnOn(id: string): Promise<boolean> {
    if (Store.installedPlugin(id)) {
        await PluginManager.setEnabled(id, true);
        return true;
    }
    const result = await Store.install(id);
    return result.ok;
}

// Each is a small scene drawn with plain boxes; only transform and opacity move. The resting styles are
// the finished picture, so with motion off (or paused off screen) it still reads.

const bars = (n: number, cls: string) => Array.from({ length: n }, (_, i) => <i key={i} className={cls} style={{ "--i": i } as React.CSSProperties} />);

const ART: Record<TourPlugin, () => React.ReactElement> = {
    "voice-messages": () => <>
        <span className="a-mic"><Icon name="mic" size={18} /></span>
        <span className="a-wave">{bars(16, "a-bar")}</span>
        <span className="a-time" />
    </>,
    "search-highlight": () => <>
        <span className="a-line w70" />
        <span className="a-line w90"><span className="a-hit" /></span>
        <span className="a-line w50" />
        <span className="a-lens"><Icon name="search" size={16} /></span>
    </>,
    "rich-presence": () => <>
        <span className="a-card">
            <span className="a-cover" />
            <span className="a-text"><span className="a-line w80" /><span className="a-line w60 dim" /><span className="a-timer" /></span>
        </span>
        <span className="a-status" />
    </>,
    "click-actions": () => <>
        <span className="a-bubble"><span className="a-line w80" /><span className="a-line w50" /><span className="a-edit" /></span>
        <span className="a-ripple r1" /><span className="a-ripple r2" />
        <span className="a-cursor" />
    </>,
    "role-colours": () => <>
        <span className="a-pills"><span className="a-pill p1" /><span className="a-pill p2" /><span className="a-pill p3" /></span>
        <span className="a-typing"><i /><i /><i /></span>
    </>,
    "embed-builder": () => <>
        <span className="a-embed">
            <span className="a-line w60 strong" />
            <span className="a-fields">{bars(3, "a-field")}</span>
            <span className="a-image" />
        </span>
    </>,
    "audit-log-plus": () => <>
        <span className="a-chip" />
        <span className="a-rows">{bars(4, "a-row")}</span>
    </>,
    "soundboard-stealer": () => <>
        <span className="a-sound"><Icon name="music" size={18} /><span className="a-ring" /><span className="a-ring late" /></span>
        <span className="a-arrow"><Icon name="download" size={16} /></span>
        <span className="a-tray" />
    </>,
    "fix-embeds": () => <>
        <span className="a-link" />
        <span className="a-video"><span className="a-play" /></span>
    </>,
    "quick-markup": () => <>
        <span className="a-shot">
            <span className="a-line w70" /><span className="a-line w50" />
            <span className="a-blur">{bars(6, "a-px")}</span>
            <span className="a-mark" />
        </span>
    </>,
    "hover-converter": () => <>
        <span className="a-price">$20</span>
        <span className="a-tip">€18.40</span>
        <span className="a-pointer" />
    </>,
    "code-block-tools": () => <>
        <span className="a-code">
            <span className="a-gutter">{bars(4, "a-num")}</span>
            <span className="a-src"><span className="a-line w70 code" /><span className="a-line w50 code" /><span className="a-line w80 code" /><span className="a-line w40 code" /></span>
            <span className="a-copy"><Icon name="copy" size={14} /><span className="a-check"><Icon name="tick" size={14} /></span></span>
        </span>
    </>,
};

/** Plays only while it's on screen */
function Art({ id, root }: { id: TourPlugin; root?: React.RefObject<HTMLElement | null>; }) {
    const ref = React.useRef<HTMLSpanElement>(null);
    const [play, setPlay] = React.useState(false);
    React.useEffect(() => {
        const el = ref.current;
        if (!el) return;
        const observer = new IntersectionObserver(([entry]) => setPlay(entry.isIntersecting), { root: root?.current ?? null, threshold: 0.2 });
        observer.observe(el);
        return () => observer.disconnect();
    }, []);
    const Scene = ART[id];
    return <span className="dl-tour-art" data-art={id} data-play={play ? "" : undefined} aria-hidden="true" ref={ref}><Scene /></span>;
}

function Dots({ step }: { step: Step; }) {
    const steps: Step[] = ["welcome", "pick", "install", "done"];
    const at = steps.indexOf(step);
    return (
        <span className="dl-tour-dots" role="img" aria-label={t("tour.step", { n: at + 1, total: steps.length })}>
            {steps.map((s, i) => <i key={s} data-on={i === at ? "" : undefined} data-past={i < at ? "" : undefined} />)}
        </span>
    );
}

function Welcome() {
    const hero: TourPlugin[] = ["voice-messages", "embed-builder", "search-highlight"];
    return (
        <div className="dl-tour-welcome">
            <div className="dl-tour-collage">
                {hero.map((id, i) => <span key={id} className="dl-tour-float" style={{ "--i": i } as React.CSSProperties}><Art id={id} /></span>)}
            </div>
            <p className="dl-tour-eyebrow">{t("tour.welcome.eyebrow")}</p>
            <h1 className="dl-tour-title" id="dl-tour-title">{t("tour.welcome.title")}</h1>
            <p className="dl-tour-lede">{t("tour.welcome.body")}</p>
        </div>
    );
}

function Pick({ list, picked, toggle, setAll, status, retry }: {
    list: Offer[];
    picked: Set<string>;
    toggle(id: string): void;
    setAll(on: boolean): void;
    status: string;
    retry(): void;
}) {
    const scroller = React.useRef<HTMLDivElement>(null);
    const open = list.filter(o => !o.on);
    return (
        <div className="dl-tour-pick">
            <header className="dl-tour-head">
                <div>
                    <h1 className="dl-tour-title small" id="dl-tour-title">{t("tour.pick.title")}</h1>
                    <p className="dl-tour-sub">{t("tour.pick.subtitle")}</p>
                </div>
                {open.length > 1 && (
                    <button type="button" className="dl-tour-link" onClick={() => setAll(picked.size < open.length)}>
                        {picked.size < open.length ? t("tour.pick.all") : t("tour.pick.none")}
                    </button>
                )}
            </header>
            <div className="dl-tour-scroll" ref={scroller}>
                {status === "loading" && !list.length && <p className="dl-tour-note">{t("tour.pick.loading")}</p>}
                {status === "error" && !list.length && (
                    <div className="dl-tour-note">
                        <p>{t("tour.pick.error")}</p>
                        <Button onClick={retry}>{t("common.tryAgain")}</Button>
                    </div>
                )}
                {status === "ready" && !list.length && <p className="dl-tour-note">{t("tour.pick.empty")}</p>}
                <ul className="dl-tour-grid">
                    {list.map((o, i) => {
                        const on = o.on || picked.has(o.id);
                        const nameId = `dl-tour-name-${o.id}`;
                        return (
                            <li key={o.id} className="dl-tour-card" data-picked={picked.has(o.id) ? "" : undefined} data-on={o.on ? "" : undefined}
                                style={{ "--i": i } as React.CSSProperties}
                                onClick={e => {
                                    if (o.on || (e.target as HTMLElement).closest("[role=switch], input")) return;
                                    toggle(o.id);
                                }}>
                                <Art id={o.id} root={scroller} />
                                <div className="dl-tour-card-body">
                                    <div className="dl-tour-card-top">
                                        <h2 className="dl-tour-card-name" id={nameId}>{o.name}</h2>
                                        {o.on
                                            ? <span className="dl-tour-badge"><Icon name="tick" size={12} />{t("tour.pick.on")}</span>
                                            : <Switch checked={on} onChange={() => toggle(o.id)} labelledBy={nameId} />}
                                    </div>
                                    <p className="dl-tour-card-pitch">{o.pitch}</p>
                                </div>
                            </li>
                        );
                    })}
                </ul>
            </div>
        </div>
    );
}

function Install({ list, progress }: { list: Offer[]; progress: Progress; }) {
    const ids = Object.keys(progress);
    const done = ids.filter(id => progress[id] === "done" || progress[id] === "failed").length;
    return (
        <div className="dl-tour-install">
            <h1 className="dl-tour-title small" id="dl-tour-title">{t("tour.install.title")}</h1>
            <div className="dl-tour-meter" role="progressbar" aria-valuemin={0} aria-valuemax={ids.length} aria-valuenow={done} aria-label={t("tour.install.progress", { done, total: ids.length })}>
                <i style={{ transform: `scaleX(${ids.length ? done / ids.length : 0})` }} />
            </div>
            <ul className="dl-tour-steps">
                {ids.map(id => {
                    const state = progress[id];
                    return (
                        <li key={id} data-state={state}>
                            <span className="dl-tour-state" aria-hidden="true">
                                {state === "done" ? <Icon name="tick" size={14} /> : state === "failed" ? <Icon name="close" size={14} /> : <i />}
                            </span>
                            <span className="dl-tour-step-name">{list.find(o => o.id === id)?.name ?? id}</span>
                            <span className="dl-tour-step-state">{t(`tour.install.${state}` as EviKey)}</span>
                        </li>
                    );
                })}
            </ul>
        </div>
    );
}

function Done({ on, failed, names }: { on: string[]; failed: string[]; names: (id: string) => string; }) {
    return (
        <div className="dl-tour-done">
            <span className="dl-tour-done-mark" aria-hidden="true"><Icon name="tick" size={28} /></span>
            <h1 className="dl-tour-title small" id="dl-tour-title">{t("tour.done.title")}</h1>
            <p className="dl-tour-lede">{t("tour.done.body")}</p>
            {on.length > 0 && (
                <ul className="dl-tour-chips">
                    {on.map((id, i) => <li key={id} style={{ "--i": i } as React.CSSProperties}><Icon name="tick" size={12} />{names(id)}</li>)}
                </ul>
            )}
            {failed.length > 0 && <p className="dl-tour-warn" role="alert">{t("tour.done.partial", { names: failed.map(names).join(", ") })}</p>}
        </div>
    );
}

export function Tour2({ onClose }: { onClose(): void; }) {
    useLocale();
    const exit = useExit(onClose);
    const [step, setStep] = React.useState<Step>("welcome");
    // Like clicking beside it, Escape waits for the installs: the Done step says which failed
    const { ref, onKeyDown } = useModal(() => step !== "install" && exit.close());
    const store = useStore(Store.subscribe, Store.getSnapshot);
    useStore(PluginManager.subscribe, PluginManager.getSnapshot);
    const [picked, setPicked] = React.useState<Set<string>>(new Set());
    const [progress, setProgress] = React.useState<Progress>({});
    const list = offers();
    const names = (id: string) => list.find(o => o.id === id)?.name ?? id;

    React.useEffect(() => {
        if (Store.getSnapshot().status !== "ready") void Store.refresh();
    }, []);

    const toggle = (id: string) => setPicked(p => {
        const next = new Set(p);
        next.has(id) ? next.delete(id) : next.add(id);
        return next;
    });
    const setAll = (on: boolean) => setPicked(on ? new Set(list.filter(o => !o.on).map(o => o.id)) : new Set());

    async function install() {
        const ids = list.filter(o => picked.has(o.id)).map(o => o.id);
        if (!ids.length) return exit.close();
        const state: Progress = Object.fromEntries(ids.map(id => [id, "waiting"]));
        setProgress({ ...state });
        setStep("install");
        for (const id of ids) {
            state[id] = "working";
            setProgress({ ...state });
            const ok = await turnOn(id).catch(() => false);
            state[id] = ok ? "done" : "failed";
            setProgress({ ...state });
        }
        setStep("done");
    }

    const openTheStore = () => {
        exit.close();
        SettingsUI.open("plugins");
        openStore("plugin");
    };

    const failed = Object.keys(progress).filter(id => progress[id] === "failed");
    const count = list.filter(o => picked.has(o.id)).length;

    return ReactDOM.createPortal(
        <div className="dl-root" {...exit.closingProps}>
            <div className="dl-scrim dl-dialog-scrim evi-scrim" onMouseDown={e => e.target === e.currentTarget && step !== "install" && exit.close()}>
                <div className="dl-tour evi-modal" role="dialog" aria-modal="true" aria-labelledby="dl-tour-title" tabIndex={-1} ref={ref} onKeyDown={onKeyDown} data-step={step}>
                    <FocusLayer containerRef={ref}>
                        <div className="dl-tour-stage" key={step}>
                            {step === "welcome" && <Welcome />}
                            {step === "pick" && <Pick list={list} picked={picked} toggle={toggle} setAll={setAll} status={store.status} retry={() => void Store.refresh()} />}
                            {step === "install" && <Install list={list} progress={progress} />}
                            {step === "done" && <Done on={Object.keys(progress).filter(id => progress[id] === "done")} failed={failed} names={names} />}
                        </div>
                        <footer className="dl-tour-foot">
                            <Dots step={step} />
                            <span className="dl-tour-actions">
                                {step === "welcome" && <>
                                    <Button onClick={exit.close}>{t("tour.skip")}</Button>
                                    <Button variant="accent" onClick={() => setStep("pick")}>{t("tour.welcome.next")}</Button>
                                </>}
                                {step === "pick" && <>
                                    <Button onClick={() => setStep("welcome")}>{t("tour.back")}</Button>
                                    {count > 0
                                        ? <Button variant="accent" onClick={() => void install()}>{t("tour.pick.go", { count })}</Button>
                                        : <Button variant="accent" onClick={exit.close}>{t("tour.pick.finish")}</Button>}
                                </>}
                                {step === "install" && <Button variant="accent" disabled>{t("tour.install.wait")}</Button>}
                                {step === "done" && <>
                                    <Button onClick={openTheStore}>{t("tour.done.store")}</Button>
                                    <Button variant="accent" onClick={exit.close}>{t("tour.done.close")}</Button>
                                </>}
                            </span>
                        </footer>
                    </FocusLayer>
                </div>
            </div>
        </div>,
        document.body,
    );
}

/** Mounts the tour; `onClosed` runs once it's gone (WhatsNew.tsx lets plugin changelogs go next) */
export function showTour2(onClosed?: () => void) {
    Settings.update(d => void (d.tour2Seen = true));
    ensureStyles();
    onCreateRootReady(() => whenAppReady(() => {
        const mount = () => {
            const container = document.createElement("div");
            document.body.append(container);
            const root = createRoot(container);
            const close = () => {
                root.unmount();
                container.remove();
                onClosed?.();
            };
            root.render(<DiscordContext><Tour2 onClose={close} /></DiscordContext>);
        };
        if (document.body) mount();
        else document.addEventListener("DOMContentLoaded", mount, { once: true });
    }));
}

