/**
 * "What's new in Evi", in Evi's own look rather than a copy of Discord's changelog: the release's
 * cover (the same art as its post on evi.rest) across the top, a small "Evi 0.3.2 · date" line over
 * a headline that fades like the site's, and each kind of change under a labelled pill. Shown once
 * after Evi updates itself, and on demand from the Evi panel. Plugin changelogs (PluginChangelog.tsx)
 * use the same shell. It renders in Evi's own layer: Discord's modal layer sits under Evi's panel.
 * The notes, their translations and covers stay in main until it opens (Native.whatsNew).
 */
import { RELEASES_URL, SECTION_KINDS, SectionKind, WhatsNewNotes } from "@shared/changelogNotes";
import { versionCover } from "@shared/versionCover";
import type { ReactNode } from "react";

import { I18n, t, useLocale } from "../i18n";
import { Native } from "../native";
import { Settings } from "../settings";
import { onCreateRootReady, React, ReactDOM } from "../webpack/common";
import { whenAppReady } from "./appReady";
import { cx, FocusLayer, Icon, useExit, useModal } from "./components";
import { ensureStyles } from "./index";
import { mountRoot } from "./discordContext";
import { showTour2, tourDue } from "./Tour2";

/** The markdown Evi's notes use: **bold** lead-ins and `code` */
export function inline(text: string) {
    return text.split(/(\*\*.+?\*\*|`[^`]+`)/g).map((part, i) => {
        if (part.startsWith("**") && part.endsWith("**") && part.length > 4) return <strong key={i}>{part.slice(2, -2)}</strong>;
        if (part.startsWith("`") && part.endsWith("`") && part.length > 2) return <code key={i}>{part.slice(1, -1)}</code>;
        return part;
    });
}

/**
 * The release notes shell: an optional picture across the top with the close button over it, a
 * small line above the title, a body that grows dividers only when it has to scroll, and a footer.
 */
export function ChangelogModal({ className, titleId, title, eyebrow, subtitle, hero, onClose, children, footer }: {
    className: string;
    titleId: string;
    title: ReactNode;
    /** Small text above the title, like "Evi 0.3.2 · September 27, 2026" */
    eyebrow?: ReactNode;
    subtitle?: ReactNode;
    /** Across the top, edge to edge */
    hero?: ReactNode;
    onClose(): void;
    children: ReactNode;
    /** A function gets `close`, for buttons that close it with the exit animation */
    footer?: ReactNode | ((close: () => void) => ReactNode);
}) {
    // Its own root: follow Discord's language here too
    useLocale();
    const exit = useExit(onClose);
    const { ref, onKeyDown } = useModal(exit.close);
    const scrollerRef = React.useRef<HTMLDivElement>(null);
    const innerRef = React.useRef<HTMLElement>(null);
    const [scrolls, setScrolls] = React.useState(false);

    React.useLayoutEffect(() => {
        const scroller = scrollerRef.current, inner = innerRef.current;
        if (!scroller || !inner) return;
        const observer = new ResizeObserver(() => setScrolls(inner.getBoundingClientRect().height > scroller.getBoundingClientRect().height));
        observer.observe(scroller);
        observer.observe(inner);
        return () => observer.disconnect();
    }, []);

    return ReactDOM.createPortal(
        <div className="dl-root" {...exit.closingProps}>
            <div className="dl-scrim dl-dialog-scrim evi-scrim" onMouseDown={e => e.target === e.currentTarget && exit.close()}>
                <div className={cx("dl-notes evi-modal", className)} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} ref={ref} onKeyDown={onKeyDown}>
                    <FocusLayer containerRef={ref}>
                        {hero && <div className="dl-notes-hero">{hero}</div>}
                        <button type="button" className="dl-notes-close" aria-label={t("common.close")} onClick={exit.close}>
                            <Icon name="close" size={20} />
                        </button>
                        <header className="dl-notes-head" data-hero={hero ? "" : undefined}>
                            {eyebrow && <p className="dl-notes-eyebrow">{eyebrow}</p>}
                            <h1 className="dl-notes-title" id={titleId}>{title}</h1>
                            {subtitle && <p className="dl-notes-subtitle">{subtitle}</p>}
                        </header>
                        <div className="dl-notes-body" data-scrolls={scrolls ? "" : undefined} ref={scrollerRef}>
                            <main className="dl-notes-body-inner" ref={innerRef}>{children}</main>
                        </div>
                        {footer && <footer className="dl-notes-foot">{typeof footer === "function" ? footer(exit.close) : footer}</footer>}
                    </FocusLayer>
                </div>
            </div>
        </div>,
        document.body,
    );
}

/** A mark per kind of change, drawn on a 16px grid to sit in the pill */
function KindMark({ kind }: { kind: SectionKind; }) {
    const paths: Record<SectionKind, ReactNode> = {
        // A four-pointed spark
        added: <path fill="currentColor" d="M8 1.5c.3 0 .55.2.62.49l.6 2.5a2.5 2.5 0 0 0 1.8 1.8l2.49.6a.64.64 0 0 1 0 1.23l-2.5.6a2.5 2.5 0 0 0-1.8 1.8l-.6 2.49a.64.64 0 0 1-1.23 0l-.6-2.5a2.5 2.5 0 0 0-1.8-1.8l-2.49-.6a.64.64 0 0 1 0-1.23l2.5-.6a2.5 2.5 0 0 0 1.8-1.8l.6-2.49A.64.64 0 0 1 8 1.5Z" />,
        improved: <path fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" d="M8 13V3.5M3.75 7.5 8 3.25l4.25 4.25" />,
        fixed: <path fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" d="m3.5 8.25 3 3 6-6.5" />,
        progress: <><circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.5" /><path fill="currentColor" d="M8 2.5a5.5 5.5 0 0 1 0 11Z" /></>,
    };
    return <svg className="dl-notes-mark" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">{paths[kind]}</svg>;
}

/** No cover bundled for this release: its version drawn in dots, like the covers on evi.rest */
function VersionHero({ version }: { version: string; }) {
    const src = React.useMemo(() => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(versionCover(version))}`, [version]);
    return <img className="dl-whats-new-cover" src={src} alt="" width={1200} height={675} />;
}

/**
 * The releases since `seen` (the newest one with null) in Discord's language, from main. Rejects
 * under a main older than this page, which doesn't answer yet; undefined without the bridge (web tests).
 */
export const fetchWhatsNew = (seen: string | null): Promise<WhatsNewNotes | null | undefined> =>
    Promise.resolve(Native.whatsNew?.(seen, I18n.discordLocale));

export function WhatsNewModal({ content, onClose }: { content: WhatsNewNotes; onClose(): void; }) {
    const notes = content.release;
    const cover = React.useMemo(() => content.coverSvg && `data:image/svg+xml;charset=utf-8,${encodeURIComponent(content.coverSvg)}`, [content.coverSvg]);
    const date = new Intl.DateTimeFormat(I18n.discordLocale, { dateStyle: "long" }).format(new Date(`${notes.date}T00:00:00`));

    return (
        <ChangelogModal
            className="dl-whats-new"
            titleId="dl-whats-new-title"
            eyebrow={<>Evi {notes.version}<span aria-hidden="true"> · </span><time dateTime={notes.date}>{date}</time></>}
            title={t("whatsNew.title")}
            hero={cover ? <img className="dl-whats-new-cover" src={cover} alt="" width={1200} height={675} /> : <VersionHero version={notes.version} />}
            onClose={onClose}
            footer={close => (
                <>
                    <a className="dl-notes-link" href={RELEASES_URL} target="_blank" rel="noreferrer noopener">
                        <Icon name="github" size={16} />
                        <span>{t("whatsNew.allReleases")}</span>
                    </a>
                    <button type="button" className="dl-notes-done" onClick={close}>{t("common.gotIt")}</button>
                </>
            )}
        >
            <div className="dl-whats-new-notes" role="region" aria-label={t("whatsNew.contentLabel")} tabIndex={0}>
                {SECTION_KINDS.filter(kind => notes.sections[kind]?.length).map(kind => (
                    <section className="dl-notes-section" data-kind={kind} key={kind} aria-labelledby={`dl-whats-new-${kind}`}>
                        <h2 className={`dl-whats-new-title dl-whats-new-${kind}`} id={`dl-whats-new-${kind}`}>
                            <KindMark kind={kind} />
                            {t(`whatsNew.kind.${kind}`)}
                        </h2>
                        <ul className="dl-whats-new-list">
                            {notes.sections[kind]!.map(line => <li className="dl-whats-new-item" key={line}>{inline(line)}</li>)}
                        </ul>
                    </section>
                ))}
            </div>
        </ChangelogModal>
    );
}

// Whether the startup modal is up, so plugin changelogs (PluginChangelog.tsx) wait their turn
let startupOpen = false;
const afterStartup: (() => void)[] = [];

/** Runs `fn` once Evi's own "What's new" is closed, right away when it isn't showing */
export function afterWhatsNew(fn: () => void) {
    if (startupOpen) afterStartup.push(fn);
    else fn();
}

function startupDone() {
    startupOpen = false;
    for (const fn of afterStartup.splice(0)) fn();
}

function Startup({ content }: { content: WhatsNewNotes; }) {
    const [open, setOpen] = React.useState(true);
    const close = () => {
        setOpen(false);
        startupDone();
    };
    return open ? <WhatsNewModal content={content} onClose={close} /> : null;
}

/**
 * After an update, shows what changed since the version last seen, once. A first install only
 * remembers the version: there's nothing "new" to someone who just got Evi.
 */
export function showWhatsNewIfUpdated() {
    const seen = Settings.data.lastSeenVersion;
    // Evi 2.0's tour stands in for What's new, once, on an update or a first install alike
    const tour = tourDue();
    if (seen === EVI_VERSION && !tour) return;
    const markSeen = () => Settings.update(d => {
        d.lastSeenVersion = EVI_VERSION;
    });
    if (tour || !seen) markSeen();
    if (tour) {
        startupOpen = true;
        showTour2(startupDone);
        return;
    }
    if (!seen) return;

    startupOpen = true;
    ensureStyles();
    // Not over Discord's loading screen: once the app is showing
    onCreateRootReady(() => whenAppReady(() => {
        fetchWhatsNew(seen).then(content => {
            markSeen();
            if (!content) return startupDone();
            const mount = () => {
                mountRoot(<Startup content={content} />);
            };
            if (document.body) mount();
            else document.addEventListener("DOMContentLoaded", mount, { once: true });
        }, () => {
            // A main older than this page (a core update waiting for a restart): shown after the restart
            startupDone();
        });
    }));
}
