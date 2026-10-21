/**
 * One person, opened from the People tab: who they are, the badges they have (give, take away and
 * order them), their supporter time, the plugins they publish, and bans. Every change goes to
 * evi.rest's admin API, then the page reloads from what it answers.
 */
import type { AdminBadge, Person, PersonDetail } from "@shared/devAdmin";
import { parsePersonDetail } from "@shared/devAdmin";
import { authorPageUrl } from "@shared/authors";

import { localeDate, t, timeAgo } from "../../i18n";
import { React } from "../../webpack/common";
import { Badge, Button, Dialog, discordAvatarUrl, Dropdown, EmptyState, IconButton, Notice, Section, Text, TextField, Tooltip } from "../components";
import { Confirm, LoadError } from "./common";
import { admin, AdminResult, useAdmin } from "./data";
import { BadgeIcons } from "./People";

type Catalogue = { list: AdminBadge[]; map: Map<string, AdminBadge>; };

const DURATIONS = [["1", 1], ["7", 7], ["30", 30], ["forever", null]] as const;
type Duration = typeof DURATIONS[number][0];

const day = (ms: number) => localeDate(new Date(ms), { year: "numeric", month: "short", day: "numeric" });

function copyText(text: string) {
    return navigator.clipboard?.writeText(text).then(() => true, () => false) ?? Promise.resolve(false);
}

/** One badge they have: its icon and name, when it was given, and controls to move or take it away */
function GrantedBadge({ badge, grantedAt, first, last, busy, onMove, onRemove }: {
    badge: AdminBadge | undefined;
    id: string;
    grantedAt: number;
    first: boolean;
    last: boolean;
    busy: boolean;
    onMove(by: -1 | 1): void;
    onRemove(): void;
}) {
    return (
        <li className="dl-dev-granted">
            {badge?.icon
                ? <img onError={e => void (e.currentTarget.hidden = true)} className="dl-dev-badge" src={badge.icon} alt="" width={24} height={24} draggable={false} />
                : <span className="dl-dev-badge dl-dev-badge-empty" aria-hidden="true" />}
            <span className="dl-dev-granted-text">
                <Text tag="span" variant="text-sm/semibold" color="text-strong">{badge?.name ?? "?"}</Text>
                <Text tag="span" variant="text-xs/normal" color="text-muted">{grantedAt ? t("dev.people.given", { time: timeAgo(grantedAt) }) : ""}</Text>
            </span>
            <span className="dl-dev-granted-actions">
                <span className="dl-dev-up"><IconButton icon="chevronDown" label={t("dev.people.moveUp")} onClick={() => onMove(-1)} disabled={first || busy} /></span>
                <IconButton icon="chevronDown" label={t("dev.people.moveDown")} onClick={() => onMove(1)} disabled={last || busy} />
                <IconButton icon="trash" label={t("dev.people.remove")} onClick={onRemove} disabled={busy} />
            </span>
        </li>
    );
}

function BadgesSection({ detail, catalogue, run, busy }: { detail: PersonDetail; catalogue: Catalogue; run(fn: () => Promise<AdminResult<unknown>>): void; busy: boolean; }) {
    const held = new Set(detail.badges.map(b => b.id));
    // Supporter levels follow supporter time, so they're given in Supporter, not here
    const givable = catalogue.list.filter(b => !held.has(b.id) && !b.supporter);
    const [pick, setPick] = React.useState("");
    const chosen = givable.some(b => b.id === pick) ? pick : givable[0]?.id ?? "";
    const id = detail.user.id;

    // Positions are rewritten for every badge, so moving one is always exact
    const move = (index: number, by: -1 | 1) => run(async () => {
        const order = detail.badges.map(b => b.id);
        const [moved] = order.splice(index, 1);
        order.splice(index + by, 0, moved);
        for (const [position, badge] of order.entries()) {
            const res = await admin("PUT", `/admin/users/${id}/badges/${badge}`, { position });
            if (!res.ok) return res;
        }
        return { ok: true, value: null };
    });

    return (
        <Section title={t("dev.people.badges")} description={t("dev.people.badgesHint")} id="dl-dev-person-badges">
            {detail.badges.length
                ? (
                    <ul className="dl-dev-granted-list">
                        {detail.badges.map((b, i) => (
                            <GrantedBadge
                                key={b.id}
                                id={b.id}
                                badge={catalogue.map.get(b.id)}
                                grantedAt={b.grantedAt}
                                first={i === 0}
                                last={i === detail.badges.length - 1}
                                busy={busy}
                                onMove={by => move(i, by)}
                                onRemove={() => run(() => admin("DELETE", `/admin/users/${id}/badges/${b.id}`))}
                            />
                        ))}
                    </ul>
                )
                : <Text tag="p" variant="text-sm/normal" color="text-muted">{t("dev.people.noBadges")}</Text>}
            {!!givable.length && (
                <div className="dl-dev-inline-form">
                    <Dropdown
                        id="dl-dev-give-badge"
                        label={t("dev.people.give")}
                        options={givable.map(b => ({ value: b.id, label: b.icon ? b.name : t("dev.people.noIcon", { name: b.name }) }))}
                        value={chosen}
                        onChange={setPick}
                        className="dl-dev-grow"
                    />
                    <Button variant="accent" disabled={busy || !chosen} onClick={() => run(() => admin("PUT", `/admin/users/${id}/badges/${chosen}`, { position: detail.badges.length }))}>
                        {t("dev.people.giveButton")}
                    </Button>
                </div>
            )}
        </Section>
    );
}

function SupporterSection({ detail, catalogue, run, busy, onStop }: { detail: PersonDetail; catalogue: Catalogue; run(fn: () => Promise<AdminResult<unknown>>): void; busy: boolean; onStop(): void; }) {
    const [days, setDays] = React.useState("30");
    const id = detail.user.id;
    const s = detail.supporter;
    const n = Number(days);
    const validDays = Number.isSafeInteger(n) && n > 0 && n <= 36_500;
    if (!s) {
        return (
            <Section title={t("dev.people.supporter")} id="dl-dev-person-supporter">
                <div className="dl-dev-inline-form">
                    <Text tag="p" variant="text-sm/normal" color="text-muted" className="dl-dev-grow">{t("dev.people.notSupporter")}</Text>
                    <Button disabled={busy} onClick={() => run(() => admin("PUT", `/admin/supporters/${id}`, {}))}>{t("dev.people.makeSupporter")}</Button>
                </div>
            </Section>
        );
    }
    const level = catalogue.map.get(s.level);
    const next = s.next ? catalogue.map.get(s.next.level) : undefined;
    return (
        <Section title={t("dev.people.supporter")} id="dl-dev-person-supporter">
            <div className="dl-dev-supporter">
                {level?.icon && <img onError={e => void (e.currentTarget.hidden = true)} className="dl-dev-badge" src={level.icon} alt="" width={32} height={32} />}
                <div className="dl-dev-granted-text">
                    <Text tag="span" variant="text-sm/semibold" color="text-strong">{level?.name ?? s.level}</Text>
                    <Text tag="span" variant="text-xs/normal" color="text-muted">{t("dev.people.supporting", { days: s.days, date: day(s.since) })}</Text>
                    {s.next && <Text tag="span" variant="text-xs/normal" color="text-muted">{t("dev.people.nextLevel", { level: next?.name ?? s.next.level, date: day(s.next.at) })}</Text>}
                </div>
            </div>
            <div className="dl-dev-inline-form">
                <TextField id="dl-dev-supporter-days" label={t("dev.people.days")} value={days} onChange={setDays} inputMode="numeric" />
                <Button disabled={busy || !validDays} onClick={() => run(() => admin("POST", `/admin/supporters/${id}/time`, { days: n }))}>{t("dev.people.addTime")}</Button>
                <Button disabled={busy || !validDays} onClick={() => run(() => admin("POST", `/admin/supporters/${id}/time`, { days: -n }))}>{t("dev.people.takeTime")}</Button>
                <Button variant="danger" disabled={busy} onClick={onStop}>{t("dev.people.stopSupporter")}</Button>
            </div>
        </Section>
    );
}

function AuthorSection({ author }: { author: NonNullable<PersonDetail["author"]>; }) {
    return (
        <Section
            title={t("dev.people.author")}
            description={author.name === author.slug ? author.name : `${author.name} · ${author.slug}`}
            id="dl-dev-person-author"
            action={<Button icon="link" onClick={() => window.open(authorPageUrl("https://evi.rest", author.slug), "_blank", "noopener")}>{t("dev.people.authorPage")}</Button>}
        >
            {author.plugins.length
                ? <div className="dl-dev-chips">{author.plugins.map(p => <Badge key={p.id}>{p.name}</Badge>)}</div>
                : <Text tag="p" variant="text-sm/normal" color="text-muted">{t("dev.people.noPlugins")}</Text>}
        </Section>
    );
}

function ModerationSection({ detail, onBan, onUnban }: { detail: PersonDetail; onBan(reason: string, duration: Duration): void; onUnban(): void; }) {
    const [reason, setReason] = React.useState("");
    const [duration, setDuration] = React.useState<Duration>("7");
    const [error, setError] = React.useState<string>();
    const b = detail.banned;
    return (
        <Section title={t("dev.people.moderation")} description={t("dev.people.banHint")} id="dl-dev-person-moderation">
            {b && (
                <Notice tone="danger" action={<Button onClick={onUnban}>{t("dev.people.unban")}</Button>}>
                    <span className="dl-stack-tight">
                        <span>{b.until ? t("dev.people.bannedUntil", { date: day(b.until), reason: b.reason }) : t("dev.people.bannedForever", { reason: b.reason })}</span>
                        {b.by && <Text tag="span" variant="text-xs/normal" color="text-muted">{t("dev.people.bannedBy", { name: b.by.name, time: timeAgo(b.at) })}</Text>}
                    </span>
                </Notice>
            )}
            {!b && detail.admin && <Text tag="p" variant="text-sm/normal" color="text-muted">{t("dev.people.adminNoBan")}</Text>}
            {!b && !detail.admin && (
                <form
                    className="dl-dev-ban-form"
                    onSubmit={e => {
                        e.preventDefault();
                        if (!reason.trim()) return setError(t("dev.people.reasonRequired"));
                        setError(undefined);
                        onBan(reason.trim(), duration);
                    }}
                >
                    <TextField id="dl-dev-ban-reason" label={t("dev.people.reason")} value={reason} onChange={setReason} />
                    <div className="dl-dev-inline-form">
                        <Dropdown
                            id="dl-dev-ban-duration"
                            label={t("dev.people.duration")}
                            options={DURATIONS.map(([value]) => ({ value, label: value === "forever" ? t("dev.people.forever") : t("dev.people.forDays", { count: Number(value) }) }))}
                            value={duration}
                            onChange={v => setDuration(v as Duration)}
                            className="dl-dev-grow"
                        />
                        <Button type="submit" variant="danger">{t("dev.people.ban")}</Button>
                    </div>
                    {error && <Notice tone="danger">{error}</Notice>}
                </form>
            )}
            {!!detail.banLog.length && (
                <ul className="dl-dev-banlog" aria-label={t("dev.people.history")}>
                    {detail.banLog.map((l, i) => (
                        <li key={i}>
                            <Text tag="span" variant="text-xs/normal" color="text-subtle">{l.action === "ban" ? t("dev.people.logBan", { reason: l.reason }) : t("dev.people.logUnban")}</Text>
                            <Text tag="span" variant="text-xs/normal" color="text-muted">{[l.by?.name, timeAgo(l.at)].filter(Boolean).join(" · ")}</Text>
                        </li>
                    ))}
                </ul>
            )}
        </Section>
    );
}

type Ask =
    | { kind: "ban"; reason: string; duration: Duration; }
    | { kind: "unban"; }
    | { kind: "stopSupporter"; };

export function PersonDialog({ person, catalogue, onChanged, onClose }: {
    person: Person;
    catalogue: Catalogue;
    /** Something changed: the list reloads too */
    onChanged(): void;
    onClose(): void;
}) {
    const detail = useAdmin(`/admin/users/${person.user.id}`, parsePersonDetail);
    const [busy, setBusy] = React.useState(false);
    const [error, setError] = React.useState<string>();
    const [copied, setCopied] = React.useState(false);
    const [ask, setAsk] = React.useState<Ask>();
    const d = detail.value;
    const user = d?.user ?? person.user;

    const after = (res: AdminResult<unknown>) => {
        if (res.ok) {
            setError(undefined);
            detail.reload();
            onChanged();
        } else setError(res.error);
        return res;
    };
    const run = (fn: () => Promise<AdminResult<unknown>>) => {
        if (busy) return;
        setBusy(true);
        void fn().then(after).finally(() => setBusy(false));
    };

    // Shown in Discord: what they have by hand, plus their supporter level
    const shown = d ? [...d.badges.map(b => b.id), ...d.supporter ? [d.supporter.level] : []] : person.badges;

    return (
        <Dialog id="dl-dev-person" title={t("dev.people.title")} onClose={onClose} className="dl-dev-person-dialog">
            <div className="dl-dev-person-body">
                <header className="dl-dev-person-head">
                    <img className="dl-dev-avatar" src={discordAvatarUrl(user.id, user.avatar, 128, "auto")} alt="" width={64} height={64} />
                    <div className="dl-dev-person-headtext">
                        <div className="dl-dev-person-names">
                            <Text tag="h3" variant="heading-lg/semibold" color="text-strong" className="dl-dev-name">{user.name}</Text>
                            <BadgeIcons ids={shown} catalogue={catalogue.map} size={20} />
                        </div>
                        <div className="dl-dev-person-names">
                            {user.username && <Text tag="span" variant="text-sm/normal" color="text-subtle">@{user.username}</Text>}
                            {(d?.admin ?? person.admin) && <Badge>{t("dev.people.admin")}</Badge>}
                            {(d ? d.banned : person.banned) && <Badge tone="warning">{t("dev.people.banned")}</Badge>}
                        </div>
                        <div className="dl-dev-person-id">
                            <Text tag="span" variant="text-xs/normal" color="text-muted" className="dl-dev-mono">{user.id}</Text>
                            <Tooltip text={copied ? t("dev.people.copied") : t("dev.people.copyId")}>
                                <button
                                    type="button"
                                    className="dl-dev-copy"
                                    aria-label={t("dev.people.copyId")}
                                    onClick={() => void copyText(user.id).then(ok => {
                                        setCopied(ok);
                                        if (ok) setTimeout(() => setCopied(false), 1500);
                                    })}
                                >
                                    {copied ? t("dev.people.copied") : t("dev.people.copyId")}
                                </button>
                            </Tooltip>
                        </div>
                    </div>
                </header>
                {d && (
                    <Text tag="p" variant="text-xs/normal" color="text-muted" className="dl-dev-person-meta">
                        {[
                            d.createdAt ? t("dev.people.joined", { date: day(d.createdAt) }) : undefined,
                            d.lastLogin ? t("dev.lastLogin", { time: timeAgo(d.lastLogin) }) : undefined,
                            t("dev.people.logins", { count: d.logins }),
                            d.installs ? t("dev.people.evis", { count: d.installs }) : t("dev.people.noEvis"),
                        ].filter(Boolean).join(" · ")}
                    </Text>
                )}
                {error && <Notice tone="danger">{t("dev.error", { error })}</Notice>}
                {detail.error && <LoadError error={detail.error} onRetry={detail.reload} />}
                {!d && !detail.error && <EmptyState icon="clock" title={t("dev.loading")} />}
                {d && (
                    <div className="dl-dev-person-sections" aria-busy={busy}>
                        <BadgesSection detail={d} catalogue={catalogue} run={run} busy={busy} />
                        <SupporterSection detail={d} catalogue={catalogue} run={run} busy={busy} onStop={() => setAsk({ kind: "stopSupporter" })} />
                        {d.author && <AuthorSection author={d.author} />}
                        <ModerationSection detail={d} onBan={(reason, duration) => setAsk({ kind: "ban", reason, duration })} onUnban={() => setAsk({ kind: "unban" })} />
                    </div>
                )}
            </div>
            {ask?.kind === "ban" && (
                <Confirm
                    id="dl-dev-ban"
                    title={t("dev.people.banTitle", { name: user.name })}
                    body={`${ask.duration === "forever" ? t("dev.people.forever") : t("dev.people.forDays", { count: Number(ask.duration) })} · ${ask.reason}. ${t("dev.people.banBody")}`}
                    confirmLabel={t("dev.people.banConfirm")}
                    danger
                    onConfirm={async () => after(await admin("PUT", `/admin/users/${user.id}/ban`, {
                        reason: ask.reason,
                        days: DURATIONS.find(([v]) => v === ask.duration)![1],
                    }))}
                    onClose={() => setAsk(undefined)}
                />
            )}
            {ask?.kind === "unban" && (
                <Confirm
                    id="dl-dev-unban"
                    title={t("dev.people.unbanTitle", { name: user.name })}
                    body={t("dev.people.unbanBody")}
                    confirmLabel={t("dev.people.unban")}
                    onConfirm={async () => after(await admin("DELETE", `/admin/users/${user.id}/ban`))}
                    onClose={() => setAsk(undefined)}
                />
            )}
            {ask?.kind === "stopSupporter" && (
                <Confirm
                    id="dl-dev-stop-supporter"
                    title={t("dev.people.stopSupporter")}
                    body={t("dev.people.stopSupporterBody")}
                    confirmLabel={t("dev.people.stopSupporter")}
                    danger
                    onConfirm={async () => after(await admin("DELETE", `/admin/supporters/${user.id}`))}
                    onClose={() => setAsk(undefined)}
                />
            )}
        </Dialog>
    );
}
