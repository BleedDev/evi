/**
 * An author's own plugins, in numbers (shared/authorStats.ts): how many run each one, per day, how
 * it's holding up on each Discord build this week, and what people say about it. An author with
 * several starts on all of them side by side, ranked by what they pick, and opens one from there or
 * the switcher at the top; quiet on purpose, like the Developers page.
 */
import type { AuthorPluginStats, AuthorStats } from "@shared/authorStats";

import { I18n, t, timeAgo } from "../../i18n";
import { Native } from "../../native";
import { React } from "../../webpack/common";
import { Badge, Button, discordAvatarUrl, Dropdown, FilterChips, Icon, Notice, Section, Status, Text, Tooltip } from "../components";
import { Problems } from "../developers/common";
import { dayLabel, format } from "../developers/data";

export const DAY_CHOICES = ["7", "30", "90"] as const;
export type DayChoice = typeof DAY_CHOICES[number];

const percent = (rate: number) => rate.toLocaleString(I18n.discordLocale, { style: "percent", maximumFractionDigits: rate < 0.1 ? 1 : 0 });
const stars = (n: number) => n.toLocaleString(I18n.discordLocale, { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** A number with a short label; what it counts is in its tooltip */
function Stat({ label, value, hint, tone }: { label: string; value: string; hint: string; tone?: "warning"; }) {
    return (
        <Tooltip text={hint}>
            <div className="dl-dev-stat dl-authorhub-stat" tabIndex={0} aria-label={`${label}: ${value}. ${hint}`} data-tone={tone}>
                <Text tag="span" variant="text-xs/semibold" color="text-muted">{label}</Text>
                <Text tag="span" variant="heading-xl/semibold" color="text-strong" tabular>{value}</Text>
            </div>
        </Tooltip>
    );
}

/** One bar a day, oldest first; hover or focus a bar for that day's numbers */
function ActiveChart({ history }: { history: AuthorPluginStats["history"]; }) {
    const [hover, setHover] = React.useState<number>();
    const max = Math.max(1, ...history.map(d => d.active));
    const label = (d: AuthorPluginStats["history"][number]) => t("author.dayTooltip", { day: dayLabel(d.day), active: format(d.active), installed: format(d.installed) });
    const shown = hover === undefined ? undefined : history[hover];
    const at = hover === undefined ? 0 : (hover + 0.5) / history.length;
    return (
        <div className="dl-dev-chart dl-authorhub-chart">
            <div className="dl-dev-bars" role="list" aria-label={t("author.chart")} onMouseLeave={() => setHover(undefined)}>
                <Text tag="span" variant="text-xs/normal" color="text-muted" tabular className="dl-dev-max" aria-hidden="true">{format(max)}</Text>
                {history.map((d, i) => (
                    <div
                        key={d.day}
                        role="listitem"
                        tabIndex={0}
                        aria-label={label(d)}
                        className="dl-dev-bar-hit"
                        data-active={hover === i ? "" : undefined}
                        onMouseEnter={() => setHover(i)}
                        onFocus={() => setHover(i)}
                        onBlur={() => setHover(undefined)}
                    >
                        {d.active > 0 && <div className="dl-dev-bar" style={{ blockSize: `${Math.max(3, d.active / max * 100)}%` }} />}
                    </div>
                ))}
                {shown && (
                    <div className="dl-dev-tooltip" style={{ insetInlineStart: `${at * 100}%`, translate: `-${Math.min(100, Math.max(0, at * 200 - 50))}% 0` }} aria-hidden="true">
                        <Text tag="span" variant="text-xs/semibold" color="text-strong">{label(shown)}</Text>
                    </div>
                )}
            </div>
            <div className="dl-dev-axis" aria-hidden="true">
                <Text tag="span" variant="text-xs/normal" color="text-muted">{dayLabel(history[0].day)}</Text>
                <Text tag="span" variant="text-xs/normal" color="text-muted">{dayLabel(history[history.length - 1].day)}</Text>
            </div>
        </div>
    );
}

/** Each Discord build installs reported trouble on this week, newest build first, with what kind */
function Trouble({ builds }: { builds: AuthorPluginStats["health"]["builds"]; }) {
    if (!builds.length) {
        return (
            <p className="dl-authorhub-quiet">
                <Icon name="circleCheck" size={16} />
                <Text tag="span" variant="text-sm/normal" color="text-muted">{t("author.noTrouble")}</Text>
            </p>
        );
    }
    const max = Math.max(1, ...builds.map(b => b.installs));
    return (
        <ul className="dl-authorhub-builds">
            {builds.map(b => (
                <li key={b.build}>
                    <div className="dl-authorhub-build-head">
                        <Text tag="span" variant="text-sm/medium" color="text-default" tabular>{t("author.build", { build: b.build })}</Text>
                        <Text tag="span" variant="text-sm/semibold" color="text-strong" tabular>{format(b.installs)}</Text>
                    </div>
                    <span className="dl-authorhub-meter" aria-hidden="true"><span style={{ inlineSize: `${b.installs / max * 100}%` }} /></span>
                    <Text tag="span" variant="text-xs/normal" color="text-muted" tabular>
                        {t("author.troubleKinds", { patches: format(b.patches), lookups: format(b.lookups), start: format(b.start) })}
                    </Text>
                </li>
            ))}
        </ul>
    );
}

function StarRow({ rating }: { rating: number; }) {
    return (
        <span className="dl-authorhub-stars" aria-label={`${rating}/5`}>
            {[1, 2, 3, 4, 5].map(i => <Icon key={i} name="star" size={12} className={i <= rating ? "dl-authorhub-star-on" : "dl-authorhub-star-off"} />)}
        </span>
    );
}

function Reviews({ plugin }: { plugin: AuthorPluginStats; }) {
    const { rating, reviews } = plugin;
    if (!rating.count && !reviews.length) {
        return <Text variant="text-sm/normal" color="text-muted" className="dl-authorhub-quiet">{t("author.noReviews")}</Text>;
    }
    const most = Math.max(1, ...rating.counts);
    return (
        <div className="dl-authorhub-reviews">
            <div className="dl-authorhub-spread" aria-label={t("author.ratingHint", { count: format(rating.count) })}>
                {[5, 4, 3, 2, 1].map(n => (
                    <div key={n} className="dl-authorhub-spread-row">
                        <Text tag="span" variant="text-xs/semibold" color="text-muted" tabular>{n}</Text>
                        <span className="dl-authorhub-meter" aria-hidden="true"><span style={{ inlineSize: `${rating.counts[n - 1] / most * 100}%` }} /></span>
                        <Text tag="span" variant="text-xs/normal" color="text-muted" tabular>{format(rating.counts[n - 1])}</Text>
                    </div>
                ))}
            </div>
            <ul className="dl-authorhub-review-list">
                {reviews.map(r => (
                    <li key={r.id} className="dl-authorhub-review">
                        <img src={discordAvatarUrl(r.user.id, r.user.avatar, 64)} alt="" width={32} height={32} className="dl-authorhub-avatar" />
                        <div className="dl-authorhub-review-text">
                            <div className="dl-authorhub-review-head">
                                <Text tag="span" variant="text-sm/semibold" color="text-strong">{r.user.name}</Text>
                                <StarRow rating={r.rating} />
                                <Text tag="span" variant="text-xs/normal" color="text-muted">
                                    {[r.version && t("author.reviewVersion", { version: r.version }), r.createdAt ? timeAgo(r.createdAt) : ""].filter(Boolean).join(" · ")}
                                </Text>
                            </div>
                            {r.body && <Text tag="p" variant="text-sm/normal" color="text-default" className="dl-authorhub-review-body">{r.body}</Text>}
                        </div>
                    </li>
                ))}
            </ul>
        </div>
    );
}

/** What Evi's team or the store says about it right now, if anything */
function Notices({ plugin }: { plugin: AuthorPluginStats; }) {
    const out: React.ReactNode[] = [];
    if (plugin.pull) {
        const which = plugin.pull.versions === "all" ? t("author.pulledAll") : plugin.pull.versions.join(", ");
        out.push(<Notice key="pull" tone="danger">{t("author.pulled", { reason: `${plugin.pull.reason} (${which})` })}</Notice>);
    }
    for (const h of plugin.hotfixes) out.push(<Notice key={`hotfix-${h.id}`} tone="info">{t("author.hotfix", { note: h.note })}</Notice>);
    if (!plugin.pull && plugin.health.state === "broken") out.push(<Notice key="broken" tone="warning">{t("author.broken")}</Notice>);
    if (!plugin.pull && plugin.health.state === "fixed") out.push(<Notice key="fixed" tone="info">{t("author.fixed")}</Notice>);
    return out.length ? <div className="dl-authorhub-notices">{out}</div> : null;
}

/** Active installs on the last day against the first day shown: null without a start to compare to */
function growthOf(plugin: AuthorPluginStats): number | null {
    const first = plugin.history[0]?.active;
    const last = plugin.history.at(-1)?.active;
    if (first === undefined || last === undefined || plugin.history.length < 2 || first === 0) return null;
    return (last - first) / first;
}

type SortKey = "active" | "growth" | "rating" | "crashes";
const SORTS: SortKey[] = ["active", "growth", "rating", "crashes"];

/** Biggest first, except crashes: fewest first. Ones without a number go last either way */
function compare(key: SortKey) {
    const value = (p: AuthorPluginStats): number | null => key === "active" ? p.activeNow
        : key === "growth" ? growthOf(p)
        : key === "rating" ? (p.rating.count ? p.rating.average : null)
        : p.crashes.latestRate;
    return (a: AuthorPluginStats, b: AuthorPluginStats) => {
        const x = value(a), y = value(b);
        if (x === null || y === null) return (x === null ? 1 : 0) - (y === null ? 1 : 0) || b.activeNow - a.activeNow;
        return (key === "crashes" ? x - y : y - x) || b.activeNow - a.activeNow;
    };
}

function Growth({ value }: { value: number | null; }) {
    if (value === null) return <Text tag="span" variant="text-sm/normal" color="text-muted">–</Text>;
    const tone = value > 0.005 ? "up" : value < -0.005 ? "down" : "flat";
    const shown = `${value > 0 ? "+" : ""}${value.toLocaleString(I18n.discordLocale, { style: "percent", maximumFractionDigits: Math.abs(value) < 0.1 ? 1 : 0 })}`;
    return (
        <span className="dl-authorhub-growth" data-tone={tone}>
            {tone !== "flat" && <Icon name={tone === "up" ? "arrowUp" : "arrowDown"} size={12} />}
            <span className="dl-tabular">{shown}</span>
        </span>
    );
}

/**
 * Every plugin side by side, best first by what you pick: active installs, growth over the days
 * shown, rating or crash rate. A row opens that plugin's own numbers.
 */
function Overview({ stats, onPick }: { stats: AuthorStats; onPick(id: string): void; }) {
    const [sort, setSort] = React.useState<SortKey>("active");
    const plugins = [...stats.plugins].sort(compare(sort));
    const most = Math.max(1, ...plugins.map(p => p.activeNow));
    const sum = (f: (p: AuthorPluginStats) => number) => stats.plugins.reduce((n, p) => n + f(p), 0);
    const ratings = sum(p => p.rating.count);
    const average = ratings ? sum(p => p.rating.average * p.rating.count) / ratings : 0;
    const reports = sum(p => p.openReports);
    const sortLabel: Record<SortKey, string> = { active: t("author.active"), growth: t("author.growth"), rating: t("author.rating"), crashes: t("author.crashRate") };

    return (
        <>
            <div className="dl-dev-stats dl-authorhub-stats">
                <Stat label={t("author.active")} value={format(sum(p => p.activeNow))} hint={t("author.activeHint")} />
                <Stat label={t("author.installed")} value={format(sum(p => p.installedNow))} hint={t("author.installedHint")} />
                <Stat label={t("author.hearts")} value={format(sum(p => p.stars))} hint={t("author.heartsHint")} />
                <Stat label={t("author.rating")} value={ratings ? `${stars(average)}★` : "–"} hint={ratings ? t("author.ratingHint", { count: format(ratings) }) : t("author.noRating")} />
                <Stat label={t("author.reports")} value={format(reports)} hint={t("author.reportsHint")} tone={reports ? "warning" : undefined} />
            </div>

            <Section
                title={t("author.compareTitle")}
                description={t("author.compareHint", { days: stats.days })}
                id="dl-author-compare"
                action={<FilterChips<SortKey> label={t("author.sortBy")} options={SORTS.map(id => ({ id, label: sortLabel[id] }))} value={sort} onChange={setSort} />}
            >
                <div className="dl-authorhub-table" role="table" aria-label={t("author.compareTitle")}>
                    <div className="dl-authorhub-table-head" role="row">
                        <Text tag="span" variant="text-xs/semibold" color="text-muted" role="columnheader">{t("author.switcher")}</Text>
                        <Text tag="span" variant="text-xs/semibold" color="text-muted" role="columnheader">{t("author.active")}</Text>
                        <Text tag="span" variant="text-xs/semibold" color="text-muted" role="columnheader">{t("author.growth")}</Text>
                        <Text tag="span" variant="text-xs/semibold" color="text-muted" role="columnheader">{t("author.rating")}</Text>
                        <Text tag="span" variant="text-xs/semibold" color="text-muted" role="columnheader">{t("author.crashRate")}</Text>
                    </div>
                    {plugins.map((p, i) => {
                        const trouble = p.pull ? t("pulled.label") : p.health.state === "broken" ? t("health.broken") : undefined;
                        return (
                            <button key={p.id} type="button" className="dl-authorhub-table-row" role="row" aria-label={t("author.openPlugin", { name: p.name })} onClick={() => onPick(p.id)}>
                                <span className="dl-authorhub-table-name" role="cell">
                                    <Text tag="span" variant="text-sm/semibold" color="text-muted" tabular className="dl-authorhub-rank">{i + 1}</Text>
                                    <span className="dl-authorhub-table-title">
                                        <span className="dl-row-title">
                                            <Text tag="span" variant="text-sm/semibold" color="text-strong" className="dl-authorhub-table-plugin">{p.name}</Text>
                                            {p.coAuthored && <Badge>{t("author.credited")}</Badge>}
                                            {trouble && <Status tone="danger">{trouble}</Status>}
                                        </span>
                                        <span className="dl-authorhub-meter" aria-hidden="true"><span style={{ inlineSize: `${p.activeNow / most * 100}%` }} /></span>
                                    </span>
                                </span>
                                <Text tag="span" variant="text-sm/semibold" color="text-strong" tabular role="cell">{format(p.activeNow)}</Text>
                                <span role="cell"><Growth value={growthOf(p)} /></span>
                                <Text tag="span" variant="text-sm/normal" color={p.rating.count ? "text-default" : "text-muted"} tabular role="cell">{p.rating.count ? `${stars(p.rating.average)}★` : "–"}</Text>
                                <Text
                                    tag="span"
                                    variant="text-sm/normal"
                                    color={p.crashes.latestRate === null ? "text-muted" : p.crashes.latestRate >= 0.05 ? "text-warning" : "text-default"}
                                    tabular
                                    role="cell"
                                >
                                    {p.crashes.latestRate === null ? "–" : percent(p.crashes.latestRate)}
                                </Text>
                            </button>
                        );
                    })}
                </div>
            </Section>
        </>
    );
}

/** One plugin's numbers: how many run it, how it holds up on each Discord build, what people say */
function PluginDetail({ plugin, days }: { plugin: AuthorPluginStats; days: number; }) {
    const latest = plugin.crashes.latestRate;
    return (
        <>
            <Notices plugin={plugin} />

            <div className="dl-dev-stats dl-authorhub-stats">
                <Stat label={t("author.active")} value={format(plugin.activeNow)} hint={t("author.activeHint")} />
                <Stat label={t("author.installed")} value={format(plugin.installedNow)} hint={t("author.installedHint")} />
                <Stat label={t("author.hearts")} value={format(plugin.stars)} hint={t("author.heartsHint")} />
                <Stat
                    label={t("author.rating")}
                    value={plugin.rating.count ? `${stars(plugin.rating.average)}★` : "–"}
                    hint={plugin.rating.count ? t("author.ratingHint", { count: format(plugin.rating.count) }) : t("author.noRating")}
                />
                <Stat
                    label={t("author.crashRate")}
                    value={latest === null ? "–" : percent(latest)}
                    hint={latest === null ? t("author.crashRateNone") : t("author.crashRateHint", { version: plugin.version || "?" })}
                    tone={latest !== null && latest >= 0.05 ? "warning" : undefined}
                />
                <Stat label={t("author.reports")} value={format(plugin.openReports)} hint={t("author.reportsHint")} tone={plugin.openReports ? "warning" : undefined} />
            </div>

            <Section title={t("author.chart")} description={t("author.chartHint", { days })} id="dl-author-chart">
                {plugin.history.length >= 2
                    ? <ActiveChart history={plugin.history} />
                    : <Text variant="text-sm/normal" color="text-muted" className="dl-authorhub-quiet">{t("author.noHistory")}</Text>}
            </Section>

            <div className="dl-authorhub-columns">
                <Section title={t("author.troubleTitle")} description={t("author.troubleHint")} id="dl-author-trouble">
                    <Trouble builds={plugin.health.builds} />
                    {plugin.health.problems.length > 0 && (
                        <div className="dl-authorhub-failed">
                            <Text tag="h4" variant="text-sm/semibold" color="text-strong">{t("health.whatFailed")}</Text>
                            <Problems problems={plugin.health.problems} />
                        </div>
                    )}
                </Section>
                <Section title={t("author.reviewsTitle")} id="dl-author-reviews">
                    <Reviews plugin={plugin} />
                </Section>
            </div>
        </>
    );
}

/**
 * Saves the plugin's code into a folder you pick and opens it: Evi's own plugins as their source from
 * Evi's repository, so a co-author can keep working on one; others as the store has them
 */
function SourceButton({ plugin }: { plugin: AuthorPluginStats; }) {
    const [state, setState] = React.useState<{ busy?: boolean; done?: string; error?: string; }>({});
    if (!Native.authorSource) return null;
    const download = async () => {
        setState({ busy: true });
        const res = await Native.authorSource!(plugin.id).catch(err => ({ ok: false as const, error: String((err as Error)?.message ?? err) }));
        if (res.ok) setState({ done: t("author.sourceSaved", { version: res.version, folder: res.folder }) });
        else setState("error" in res ? { error: res.error } : {});
    };
    return (
        <>
            <span className="dl-authorhub-source-status" role="status">
                {state.done && <Status tone="success">{state.done}</Status>}
                {state.error && <Status tone="danger">{state.error}</Status>}
            </span>
            <Button icon="download" disabled={state.busy} title={t("author.downloadSourceHint")} onClick={() => void download()}>
                {t("author.downloadSource")}
            </Button>
        </>
    );
}

/** Picks "All plugins" in the switcher: an author with several starts on them side by side */
const ALL = "*";

export function AuthorDashboard({ stats, days, onDays }: { stats: AuthorStats; days: DayChoice; onDays(days: DayChoice): void; }) {
    const several = stats.plugins.length > 1;
    const [pick, setPick] = React.useState(several ? ALL : stats.plugins[0]?.id ?? "");
    const plugin = several && pick === ALL ? undefined : stats.plugins.find(p => p.id === pick) ?? stats.plugins[0];

    if (!stats.plugins.length) {
        return (
            <div className="dl-authorhub-empty">
                <Text variant="text-md/normal" color="text-muted">{t("author.noPlugins")}</Text>
                <Button variant="accent" onClick={() => void Native.authorOpen?.("publish")}>{t("author.openPublish")}</Button>
            </div>
        );
    }

    return (
        <div className="dl-authorhub">
            <div className="dl-authorhub-toolbar">
                {several
                    ? (
                        <div className="dl-authorhub-switcher">
                            <Dropdown
                                id="dl-author-plugin"
                                label={t("author.switcher")}
                                options={[
                                    { label: t("author.allPlugins"), value: ALL },
                                    ...stats.plugins.map(p => ({ label: p.coAuthored ? `${p.name} · ${t("author.credited")}` : p.name, value: p.id })),
                                ]}
                                value={plugin?.id ?? ALL}
                                onChange={setPick}
                            />
                        </div>
                    )
                    : (
                        <div className="dl-authorhub-single">
                            <Text tag="h3" variant="heading-md/semibold" color="text-strong">{plugin!.name}</Text>
                            {plugin!.coAuthored && <Badge>{t("author.credited")}</Badge>}
                        </div>
                    )}
                <FilterChips label={t("author.chartHint", { days })} options={DAY_CHOICES.map(d => ({ id: d, label: t("author.days", { days: d }) }))} value={days} onChange={onDays} />
            </div>
            {several && plugin?.version && (
                <Text variant="text-xs/normal" color="text-muted" className="dl-authorhub-version" tabular>v{plugin.version}</Text>
            )}

            {plugin ? <PluginDetail plugin={plugin} days={stats.days} /> : <Overview stats={stats} onPick={setPick} />}

            <footer className="dl-authorhub-foot">
                {plugin && plugin.crashes.unresolved > 0 && (
                    <Text tag="span" variant="text-sm/medium" color="text-warning" tabular>{`${t("author.crashes")}: ${format(plugin.crashes.unresolved)}`}</Text>
                )}
                {plugin && <SourceButton key={plugin.id} plugin={plugin} />}
                <Button onClick={() => void Native.authorOpen?.("publish")}>
                    {t("author.manage")}
                </Button>
            </footer>
        </div>
    );
}
