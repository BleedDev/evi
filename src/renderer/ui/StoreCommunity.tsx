/**
 * The store's community side (shared/storeHome.ts, shared/reviews.ts): the front page, ratings and
 * reviews, hearts, previews, related plugins, known issues, the author's note, betas, following
 * authors and author banners. Everything here is extra: without evi.rest the store works as before,
 * these parts just don't show.
 */
import type { AuthorProfile } from "@shared/authors";
import type { PluginIssue, RatingSummary, Review } from "@shared/reviews";
import { MAX_REVIEW_CHARS } from "@shared/reviews";
import { parseStarKey } from "@shared/stars";
import { STAFF_PICKS } from "@shared/storeHome";
import type { RegistryEntry } from "@shared/store";

import { Badges } from "../badges";
import { I18n, t, timeAgo as ago } from "../i18n";
import { Settings } from "../settings";
import { Store, StoreKind } from "../store";
import { React } from "../webpack/common";
import { findStore } from "../webpack/find";
import { Badge, Button, discordAvatarUrl, Icon, Status, SwitchRow, Text, useStore } from "./components";
import { SettingsUI } from "./index";

/** The Discord account Evi runs under, for "you" in the store: supporters, your own review */
export function currentUserId(): string | undefined {
    try {
        return findStore<any>("UserStore")?.getCurrentUser?.()?.id;
    } catch {
        return undefined;
    }
}

/** Whether you support Evi, as evi.rest's badge list says */
export const isSupporter = () => Badges.supporterSince(currentUserId()) !== undefined;

const oneDecimal = (n: number) => n.toLocaleString(I18n.discordLocale, { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** Five stars filled to `value` (0-5), for showing a rating; the words carry it for screen readers */
export function Stars({ value, size = 14 }: { value: number; size?: number; }) {
    const row = [0, 1, 2, 3, 4].map(i => <Icon key={i} name="star" size={size} />);
    // A muted row, and a gold one on top cut to the rating
    return (
        <span className="dl-stars" aria-hidden="true">
            <span className="dl-stars-row">{row}</span>
            <span className="dl-stars-row dl-stars-fill" style={{ inlineSize: `${Math.max(0, Math.min(5, value)) * 20}%` }}>{row}</span>
        </span>
    );
}

/** "★ 4.6 (23)" on cards and tiles, nothing while it has no ratings */
export function RatingMini({ rating }: { rating?: RatingSummary; }) {
    if (!rating?.count) return null;
    return (
        <span className="dl-rating-mini" aria-label={t("community.ratingLabel", { average: oneDecimal(rating.average), count: rating.count })}>
            <Icon name="star" size={12} />
            <span className="dl-tabular" aria-hidden="true">{oneDecimal(rating.average)}</span>
            <span className="dl-tabular dl-rating-count" aria-hidden="true">({rating.count})</span>
        </span>
    );
}

/** A heart: you hear in the inbox when it updates, gets a beta or works again */
export function WishButton({ kind, id, name, large }: { kind: StoreKind; id: string; name: string; large?: boolean; }) {
    useStore(Settings.subscribe, () => Settings.data.wishlist);
    const wished = Store.isWished(kind, id);
    return (
        <button
            type="button"
            className="dl-wish"
            data-size={large ? "lg" : undefined}
            aria-pressed={wished}
            aria-label={t(wished ? "community.unwishLabel" : "community.wishLabel", { name })}
            title={t(wished ? "community.wished" : "community.wish")}
            onClick={() => Store.toggleWish(kind, id)}
        >
            <Icon name="heart" size={large ? 18 : 14} />
            {large && <span>{t(wished ? "community.wished" : "community.wish")}</span>}
        </button>
    );
}

interface Tile {
    id: string;
    entry: { name: string; description: string; version: string; supporters?: boolean; };
}

function HomeTile({ kind, tile, onOpen, large }: { kind: StoreKind; tile: Tile; onOpen(id: string): void; large?: boolean; }) {
    const state = useStore(Store.subscribe, Store.getSnapshot);
    const installed = kind === "plugin" ? !!Store.installedPlugin(tile.id) : !!state.installedThemes[tile.id];
    const rating = Store.rating(kind, tile.id);
    return (
        <li className="dl-home-tile" data-size={large ? "lg" : undefined} data-supporters={tile.entry.supporters || undefined}>
            <button type="button" className="dl-home-tile-button" onClick={() => onOpen(tile.id)}>
                <span className="dl-store-glyph" aria-hidden="true">{tile.entry.name.charAt(0)}</span>
                <span className="dl-home-tile-text">
                    <span className="dl-home-tile-title">
                        <Text tag="span" variant="text-sm/semibold" color="text-strong" className="dl-home-tile-name">{tile.entry.name}</Text>
                        {/* Installed: a check by the name, rather than a line of its own */}
                        {installed && <span className="dl-home-tile-installed" role="img" aria-label={t("store.installed")} title={t("store.installed")}><Icon name="circleCheck" size={14} /></span>}
                    </span>
                    {rating && rating.count > 0 && <span className="dl-home-tile-meta"><RatingMini rating={rating} /></span>}
                    {tile.entry.description && <Text tag="span" variant="text-xs/normal" color="text-subtle" className="dl-home-tile-desc">{tile.entry.description}</Text>}
                </span>
            </button>
        </li>
    );
}

function HomeRow({ id, title, description, kind, tiles, onOpen, hero }: { id: string; title: string; description?: string; kind: StoreKind; tiles: Tile[]; onOpen(id: string): void; hero?: boolean; }) {
    if (!tiles.length) return null;
    const headingId = `dl-home-${kind}-${id}`;
    return (
        <section className="dl-home-row" data-hero={hero ? "" : undefined} aria-labelledby={headingId}>
            <div className="dl-home-row-head">
                <Text tag="h3" variant={hero ? "heading-lg/semibold" : "heading-md/semibold"} color="text-strong" id={headingId}>{title}</Text>
                {description && <Text tag="p" variant="text-sm/normal" color="text-subtle">{description}</Text>}
            </div>
            <ul className="dl-home-tiles" data-hero={hero ? "" : undefined}>
                {tiles.map(tile => <HomeTile key={tile.id} kind={kind} tile={tile} onOpen={onOpen} large={hero} />)}
            </ul>
        </section>
    );
}

/**
 * The store's front page, above everything else when you haven't searched or filtered: staff picks,
 * what's trending and Evi's collections. Only this store's kind of items.
 */
export function StoreHome({ kind, onOpen }: { kind: StoreKind; onOpen(id: string): void; }) {
    const state = useStore(Store.subscribe, Store.getSnapshot);
    const home = state.home;
    if (!home) return null;
    const listed: (Tile["entry"] & { id: string; })[] = kind === "plugin" ? state.plugins : state.themes;
    const entries = new Map(listed.map(e => [e.id, e]));
    const tiles = (items: string[], max = 8): Tile[] => items.flatMap(key => {
        const item = parseStarKey(key);
        const entry = item?.kind === kind ? entries.get(item.id) : undefined;
        return entry ? [{ id: item!.id, entry }] : [];
    }).slice(0, max);

    const picks = home.collections.find(c => c.id === STAFF_PICKS);
    const rows = [
        picks && <HomeRow key="picks" id="picks" hero title={picks.title || t("community.staffPicks")} description={picks.description} kind={kind} tiles={tiles(picks.items, 4)} onOpen={onOpen} />,
        <HomeRow key="trending" id="trending" title={t("community.trending")} kind={kind} tiles={tiles(home.trending)} onOpen={onOpen} />,
        ...home.collections.filter(c => c.id !== STAFF_PICKS).map(c => (
            <HomeRow key={c.id} id={c.id} title={c.title} description={c.description} kind={kind} tiles={tiles(c.items)} onOpen={onOpen} />
        )),
    ];
    return <div className="dl-home">{rows}</div>;
}

/** The plugin in use: a short video (muted, looping, paused for reduced motion) or GIF */
export function PreviewPlayer({ url, name }: { url: string; name: string; }) {
    const [media, setMedia] = React.useState<{ url: string; video: boolean; } | null | undefined>();
    const [failed, setFailed] = React.useState(false);
    React.useEffect(() => {
        let live = true;
        Store.previewMedia(url).then(m => live && setMedia(m));
        return () => void (live = false);
    }, [url]);
    if (media === null || failed) return null;
    const reduced = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    const label = t("community.previewOf", { name });
    return (
        <figure className="dl-store-preview" data-loading={media ? undefined : ""}>
            {media?.video && (
                <video src={media.url} aria-label={label} muted loop playsInline autoPlay={!reduced} controls={reduced} onError={() => setFailed(true)} />
            )}
            {media && !media.video && <img src={media.url} alt={label} onError={() => setFailed(true)} />}
        </figure>
    );
}

/** Opting into a plugin's betas: shown on its page while it has one */
export function BetaSwitch({ entry }: { entry: RegistryEntry; }) {
    useStore(Settings.subscribe, () => Settings.data.pluginBetas);
    if (!entry.beta) return null;
    return (
        <div className="dl-store-beta">
            <SwitchRow
                id={`dl-store-beta-${entry.id}`}
                label={t("community.getBetas")}
                description={t("community.getBetasHint", { version: entry.beta.version })}
                checked={Store.hasBetas(entry.id)}
                onChange={on => Store.setBetas(entry.id, on)}
            />
        </div>
    );
}

/** What the author says about the version, from their dashboard on evi.rest */
export function AuthorNote({ note }: { note: { version: string; text: string; }; }) {
    return (
        <section className="dl-store-access dl-store-note" aria-label={t("community.fromTheAuthor")}>
            <Icon name="pencil" size={20} />
            <div>
                <Text variant="text-md/semibold" color="text-strong">{t("community.fromTheAuthor")}</Text>
                <Text tag="p" variant="text-sm/normal" color="text-default">{note.text}</Text>
                <Text tag="p" variant="text-xs/normal" color="text-muted" tabular>{t("community.aboutVersion", { version: note.version })}</Text>
            </div>
        </section>
    );
}

/** Known problems beyond what the page already shows (its health and a pull have callouts of their own) */
export function KnownIssues({ issues }: { issues: PluginIssue[]; }) {
    if (!issues.length) return null;
    return (
        <section className="dl-stack" aria-label={t("community.knownIssues")}>
            <Text tag="h3" variant="heading-md/semibold" color="text-strong">{t("community.knownIssues")}</Text>
            <ul className="dl-issues">
                {issues.map((issue, i) => (
                    <li key={i}>
                        <Status tone={issue.kind === "hotfix" ? "success" : issue.kind === "status" ? "muted" : "warning"}>{issue.text}</Status>
                        {issue.since && <Text tag="span" variant="text-xs/normal" color="text-muted"> · {ago(issue.since)}</Text>}
                    </li>
                ))}
            </ul>
        </section>
    );
}

/** Plugins people who run this one also run */
export function RelatedPlugins({ ids, onOpen }: { ids: string[]; onOpen(id: string): void; }) {
    const state = useStore(Store.subscribe, Store.getSnapshot);
    const tiles = ids.flatMap(id => {
        const entry = state.plugins.find(p => p.id === id);
        return entry ? [{ id, entry }] : [];
    });
    return <HomeRow id="related" title={t("community.alsoInstall")} kind="plugin" tiles={tiles} onOpen={onOpen} />;
}

/** Choosing 1 to 5 stars: a radio group, arrow keys move between them, focus going along */
function StarPicker({ value, onChange, labelledBy }: { value: number; onChange(n: number): void; labelledBy: string; }) {
    const buttons = React.useRef<(HTMLButtonElement | null)[]>([]);
    return (
        <div className="dl-star-picker" role="radiogroup" aria-labelledby={labelledBy}>
            {[1, 2, 3, 4, 5].map(n => (
                <button
                    key={n}
                    ref={el => void (buttons.current[n - 1] = el)}
                    type="button"
                    role="radio"
                    aria-checked={value === n}
                    aria-label={t("community.starsN", { count: n })}
                    tabIndex={value === n || (!value && n === 1) ? 0 : -1}
                    data-on={n <= value ? "" : undefined}
                    onClick={() => onChange(n)}
                    onKeyDown={e => {
                        let next: number;
                        if (e.key === "ArrowRight" || e.key === "ArrowUp") next = Math.min(5, (value || 0) + 1);
                        else if (e.key === "ArrowLeft" || e.key === "ArrowDown") next = Math.max(1, (value || 2) - 1);
                        else return;
                        e.preventDefault();
                        onChange(next);
                        buttons.current[next - 1]?.focus();
                    }}
                >
                    <Icon name="star" size={24} />
                </button>
            ))}
        </div>
    );
}

/** Your own review: write it, change it or take it back. Needs this Evi linked to an account. */
function YourReview({ id, mine, linked }: { id: string; mine: (Review & { hidden: boolean; }) | null; linked?: boolean; }) {
    const [editing, setEditing] = React.useState(!mine);
    const [rating, setRating] = React.useState(mine?.rating ?? 0);
    const [body, setBody] = React.useState(mine?.body ?? "");
    const [busy, setBusy] = React.useState(false);
    const [error, setError] = React.useState<string>();
    const labelId = `dl-review-${id}-label`;

    if (linked === false) {
        return (
            <div className="dl-review-mine">
                <Text tag="p" variant="text-sm/normal" color="text-subtle">{t("community.linkToReview")}</Text>
                <div><Button icon="link" onClick={() => SettingsUI.openTab("general", "account")}>{t("community.linkAccount")}</Button></div>
            </div>
        );
    }
    if (!Store.installedPlugin(id)) return <Text tag="p" variant="text-sm/normal" color="text-muted">{t("community.installToReview")}</Text>;

    const save = async (next: { rating: number; body: string; } | null) => {
        setBusy(true);
        setError(undefined);
        const result = await Store.review(id, next);
        setBusy(false);
        if (!result.ok) return setError(result.error);
        setEditing(false);
        if (!next) {
            setRating(0);
            setBody("");
            setEditing(true);
        }
    };

    if (mine && !editing) {
        return (
            <div className="dl-review-mine">
                <div className="dl-row-title">
                    <Text variant="text-sm/semibold" color="text-strong">{t("community.yourReview")}</Text>
                    {mine.hidden && <Badge tone="warning">{t("community.reviewHidden")}</Badge>}
                </div>
                <Stars value={mine.rating} />
                {mine.body && <Text tag="p" variant="text-sm/normal" color="text-default" className="dl-review-body">{mine.body}</Text>}
                <div className="dl-toolbar">
                    <Button onClick={() => setEditing(true)}>{t("community.editReview")}</Button>
                    <Button variant="danger" disabled={busy} onClick={() => save(null)}>{t("community.deleteReview")}</Button>
                </div>
                {error && <Status tone="danger">{error}</Status>}
            </div>
        );
    }

    return (
        <form className="dl-review-mine" onSubmit={e => { e.preventDefault(); if (rating) void save({ rating, body }); }}>
            <Text variant="text-sm/semibold" color="text-strong" id={labelId}>{mine ? t("community.editYourReview") : t("community.rateIt")}</Text>
            <StarPicker value={rating} onChange={setRating} labelledBy={labelId} />
            <label className="dl-sr-only" htmlFor={`dl-review-${id}-body`}>{t("community.reviewText")}</label>
            <textarea
                id={`dl-review-${id}-body`}
                className="dl-textarea"
                rows={3}
                maxLength={MAX_REVIEW_CHARS}
                placeholder={t("community.reviewPlaceholder")}
                value={body}
                onChange={e => setBody(e.currentTarget.value)}
            />
            <div className="dl-toolbar">
                <Button type="submit" variant="accent" disabled={busy || !rating}>{busy ? t("common.sending") : mine ? t("community.saveReview") : t("community.postReview")}</Button>
                {mine && <Button onClick={() => setEditing(false)}>{t("common.cancel")}</Button>}
                <Text tag="span" variant="text-xs/normal" color="text-muted" tabular className="dl-grow dl-align-end">{`${body.length}/${MAX_REVIEW_CHARS}`}</Text>
            </div>
            {!rating && <Text tag="p" variant="text-xs/normal" color="text-muted">{t("community.pickStars")}</Text>}
            {error && <Status tone="danger">{error}</Status>}
        </form>
    );
}

function ReviewItem({ review }: { review: Review; }) {
    const [reported, setReported] = React.useState<"sending" | "done" | string>();
    const report = async () => {
        setReported("sending");
        const result = await Store.reportReview(review.id);
        setReported(result.ok ? "done" : result.error);
    };
    const mine = review.user.id === currentUserId();
    return (
        <li className="dl-review">
            <img className="dl-review-avatar" src={discordAvatarUrl(review.user.id, review.user.avatar, 64)} alt="" width={32} height={32} loading="lazy" />
            <div className="dl-review-main">
                <div className="dl-row-title">
                    <Text variant="text-sm/semibold" color="text-strong">{review.user.name}</Text>
                    <Stars value={review.rating} size={12} />
                    <span className="dl-sr-only">{t("community.starsN", { count: review.rating })}</span>
                    <Text tag="span" variant="text-xs/normal" color="text-muted" tabular>{[ago(review.updatedAt), review.version && `v${review.version}`].filter(Boolean).join(" · ")}</Text>
                </div>
                {review.body && <Text tag="p" variant="text-sm/normal" color="text-default" className="dl-review-body">{review.body}</Text>}
                {!mine && (
                    <div className="dl-review-actions" role="status">
                        {reported === "done"
                            ? <Status tone="success" quiet>{t("community.reported")}</Status>
                            : reported && reported !== "sending"
                                ? <Status tone="danger">{reported}</Status>
                                : <button type="button" className="dl-link-button" disabled={reported === "sending"} onClick={report}>{t("community.reportReview")}</button>}
                    </div>
                )}
            </div>
        </li>
    );
}

/** Ratings and reviews on a plugin's page: the summary, yours, and everyone's, newest first */
export function ReviewsSection({ id, headingId }: { id: string; headingId: string; }) {
    const state = useStore(Store.subscribe, Store.getSnapshot);
    const page = state.pages[id];
    if (!page || page.status === "error") return null;
    if (page.status === "loading") return <Status tone="muted">{t("community.loadingReviews")}</Status>;
    const { rating, reviews, mine } = page.page;
    const others = reviews.filter(r => r.user.id !== mine?.user.id);

    return (
        <section className="dl-stack dl-reviews" aria-labelledby={headingId}>
            <Text tag="h3" variant="heading-md/semibold" color="text-strong" id={headingId}>{t("community.ratings")}</Text>
            {rating.count ? (
                <div className="dl-rating-summary">
                    <div className="dl-rating-big">
                        <span className="dl-rating-average dl-tabular">{oneDecimal(rating.average)}</span>
                        <Stars value={rating.average} size={16} />
                        <Text variant="text-xs/normal" color="text-muted">{t("community.ratingsCount", { count: rating.count })}</Text>
                    </div>
                    <ol className="dl-rating-bars" aria-label={t("community.ratingBreakdown")}>
                        {[5, 4, 3, 2, 1].map(n => {
                            const count = rating.counts[n - 1];
                            return (
                                <li key={n}>
                                    <span className="dl-tabular">{n}</span>
                                    <span className="dl-rating-bar" aria-hidden="true"><span style={{ inlineSize: `${rating.count ? count / rating.count * 100 : 0}%` }} /></span>
                                    <span className="dl-tabular dl-rating-bar-count">{count}</span>
                                    <span className="dl-sr-only">{t("community.barLabel", { stars: n, count })}</span>
                                </li>
                            );
                        })}
                    </ol>
                </div>
            ) : (
                <Text tag="p" variant="text-sm/normal" color="text-muted">{t("community.noRatings")}</Text>
            )}
            <YourReview key={mine ? `mine-${mine.id}-${mine.updatedAt}` : "new"} id={id} mine={mine} linked={state.linked} />
            {others.length > 0 && <ul className="dl-review-list">{others.map(r => <ReviewItem key={r.id} review={r} />)}</ul>}
        </section>
    );
}

/** Following an author puts their new plugins and versions in your inbox. Needs a linked Evi. */
export function FollowButton({ profile }: { profile: AuthorProfile; }) {
    const state = useStore(Store.subscribe, Store.getSnapshot);
    const [busy, setBusy] = React.useState(false);
    const [error, setError] = React.useState<string>();
    if (profile.userId === currentUserId()) return null;
    const following = Store.isFollowing(profile.slug);
    if (state.linked === false) {
        return <Button icon="link" onClick={() => SettingsUI.openTab("general", "account")}>{t("community.linkToFollow")}</Button>;
    }
    return (
        <span className="dl-follow">
            <Button
                variant={following ? "secondary" : "accent"}
                disabled={busy}
                aria-pressed={following}
                onClick={async () => {
                    setBusy(true);
                    setError(undefined);
                    const result = await Store.follow(profile.slug, !following);
                    setBusy(false);
                    if (!result.ok) setError(result.error);
                }}
            >
                {following ? t("community.following") : t("community.follow")}
            </Button>
            {error && <Status tone="danger">{error}</Status>}
        </span>
    );
}

/** An author's banner, fetched by main (Discord's page can't load it from evi.rest itself) */
export function AuthorBanner({ url }: { url: string; }) {
    const [src, setSrc] = React.useState<string | null>();
    React.useEffect(() => {
        let live = true;
        Store.image(url).then(s => live && setSrc(s));
        return () => void (live = false);
    }, [url]);
    if (!src) return null;
    return <img className="dl-author-banner" src={src} alt="" />;
}
