/**
 * The store's inbox (renderer/inbox.ts): your account's notifications from evi.rest and this Evi's own,
 * newest first. Opening a notification goes to what it's about; Mark all as read clears the count.
 */
import type { EviNotification, NotificationKind } from "@shared/notifications";

import { Inbox } from "../inbox";
import { localeDate, t, timeAgo as ago } from "../i18n";
import { Settings } from "../settings";
import { React } from "../webpack/common";
import { Button, EmptyState, Icon, IconName, IconButton, Notice, Pagination, scrollToTop, Status, SwitchRow, Text, usePages, useStore } from "./components";
import { SettingsUI } from "./index";
import { openStore } from "./nav";

/** Each kind of notification's icon, in the inbox and its live toasts */
export const kindIcon: Record<NotificationKind, IconName> = {
    review: "star",
    submission: "puzzle",
    theme: "palette",
    follow: "people",
    api: "code",
    wishlist: "heart",
    fixed: "circleCheck",
    broken: "circleError",
    update: "download",
};

/** Which day a notification is from, for the list's headings */
function dayLabel(at: number) {
    const day = new Date(at).toDateString();
    if (day === new Date().toDateString()) return t("inbox.today");
    if (day === new Date(Date.now() - 86_400_000).toDateString()) return t("inbox.yesterday");
    return localeDate(new Date(at), { dateStyle: "medium" });
}

function open(n: EviNotification) {
    const link = n.link;
    if (!link) return;
    if (link.kind === "plugin") openStore("plugin", link.id);
    // The inbox is on the Plugins page, so the Themes page has to be brought up too
    else if (link.kind === "theme") {
        openStore("theme", link.id);
        SettingsUI.open("themes");
    } else if (link.kind === "url") window.open(link.url, "_blank", "noopener");
    else if (link.kind === "author") openStore("plugin");
}

function Row({ n }: { n: EviNotification; }) {
    const body = (
        <>
            <span className="dl-inbox-icon" data-kind={n.kind} aria-hidden="true"><Icon name={kindIcon[n.kind]} size={16} /></span>
            <span className="dl-inbox-text">
                <Text tag="span" variant={n.read ? "text-sm/medium" : "text-sm/semibold"} color="text-strong">{n.title}</Text>
                {n.body && <Text tag="span" variant="text-sm/normal" color="text-subtle" className="dl-inbox-body">{n.body}</Text>}
                <Text tag="span" variant="text-xs/normal" color="text-muted">{ago(n.at)}</Text>
            </span>
            {!n.read && <span className="dl-inbox-unread"><span className="dl-sr-only">{t("inbox.unread")}</span></span>}
        </>
    );
    return (
        <li className="dl-inbox-row" data-read={n.read ? "" : undefined}>
            {n.link
                ? <button type="button" className="dl-inbox-link" onClick={() => open(n)}>{body}</button>
                : <div className="dl-inbox-link">{body}</div>}
            {n.id.startsWith("local:") && <IconButton icon="close" label={t("inbox.dismiss", { title: n.title })} onClick={() => Inbox.dismiss(n.id)} />}
        </li>
    );
}

/** Notifications per page: up to 100 are kept, a long scroll on one */
const PAGE_SIZE = 15;

export function InboxTab() {
    const list = useStore(Inbox.subscribe, Inbox.getSnapshot);
    const state = Inbox.state();
    const listRef = React.useRef<HTMLDivElement>(null);
    // Stays on its page as notifications are read or arrive; back to the first when the list empties
    const paged = usePages(list, PAGE_SIZE, list.length === 0);
    React.useEffect(() => {
        Inbox.start();
        void Inbox.refresh();
    }, []);

    // This page's, grouped by day, newest first
    const days: { label: string; items: EviNotification[]; }[] = [];
    for (const n of paged.items) {
        const label = dayLabel(n.at);
        const last = days.at(-1);
        if (last?.label === label) last.items.push(n);
        else days.push({ label, items: [n] });
    }
    const unread = list.filter(n => !n.read).length;
    const liveToasts = useStore(Settings.subscribe, () => Settings.data.liveToasts !== false);

    return (
        <div className="dl-tab dl-tab-compact">
            {state.linked === false && (
                <Notice tone="info" action={<Button icon="link" onClick={() => SettingsUI.openTab("general", "account")}>{t("community.linkAccount")}</Button>}>
                    {t("inbox.linkHint")}
                </Notice>
            )}
            <div className="dl-toolbar">
                <Text variant="text-sm/medium" color="text-subtle" role="status" tabular className="dl-grow">
                    {state.loading && !list.length ? t("inbox.loading") : unread ? t("inbox.unreadCount", { count: unread }) : t("inbox.allRead")}
                </Text>
                <Button disabled={!unread} onClick={() => void Inbox.markAllRead()}>{t("inbox.markAllRead")}</Button>
                <IconButton icon="refresh" label={t("common.refresh")} onClick={() => void Inbox.refresh()} />
            </div>
            {state.error && <Status tone="danger">{state.error}</Status>}
            {list.length ? (
                <div className="dl-stack" ref={listRef}>
                    {days.map(day => (
                        <section key={day.label} className="dl-stack" aria-label={day.label}>
                            <Text tag="h3" variant="text-xs/semibold" color="text-muted" className="dl-inbox-day">{day.label}</Text>
                            <ul className="dl-inbox">{day.items.map(n => <Row key={n.id} n={n} />)}</ul>
                        </section>
                    ))}
                    <Pagination
                        label={t("inbox.pages")}
                        page={paged.page}
                        count={paged.count}
                        onChange={n => {
                            paged.setPage(n);
                            scrollToTop(listRef.current);
                        }}
                    />
                </div>
            ) : !state.loading && (
                <EmptyState icon="bell" title={t("inbox.emptyTitle")}>{t("inbox.emptyBody")}</EmptyState>
            )}
            <SwitchRow
                id="dl-live-toasts"
                label={t("liveToasts.setting")}
                description={t("liveToasts.settingHint")}
                checked={liveToasts}
                onChange={on => Settings.update(d => void (d.liveToasts = on))}
            />
        </div>
    );
}
