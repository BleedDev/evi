/**
 * The store, for plugins and themes alike: a tab next to the installed ones with the listing
 * (search, categories, sorting, pages, Update all, auto-update), a detail page per item and a page
 * per verified author. Evi's own plugins say so; everyone else's are marked Community,
 * and the first install of each asks first.
 */
import { AuthorProfile, authorPageUrl, isOfficialListing, OFFICIAL_AUTHOR } from "@shared/authors";
import type { DeclaredPermissions, PermissionGrowth } from "@shared/declaredPermissions";
import { healthWarns, PluginHealth } from "@shared/health";
import { entriesBetween } from "@shared/pluginChangelog";
import type { PulledPlugin } from "@shared/pulls";
import type { EviKey } from "@shared/locales";
import { sharePluginUrl } from "@shared/share";
import { Searchable, searchItems } from "@shared/storeSearch";
import { ListingInfo, ListingSort, RegistryEntry, sortListings, ThemeEntry } from "@shared/store";

import { I18n, t, timeAgo as ago, tNodes } from "../i18n";
import { PluginManager } from "../plugins/manager";
import { Settings } from "../settings";
import { Store, StoreKind, StoreOp, UpdateAllResult } from "../store";
import { React } from "../webpack/common";
import { Badge, Button, Collapse, Dialog, discordAvatarUrl, Dropdown, EmptyState, FilterChips, Icon, IconButton, List, Notice, Pagination, scrollToTop, SearchField, Status, SwitchRow, Text, Tooltip, useStore } from "./components";
import { SettingsUI } from "./index";
import { openStore, showTab, takeStoreTarget } from "./nav";
import { PluginChangelogSetting } from "./PluginChangelog";
import { DeclaredPermissionsList, PermissionGrowthList, StorePluginPermissions } from "./PluginPermissions";
import type { PluginPage } from "@shared/reviews";

import { ReportRow } from "./Trust";
import { AuthorBanner, AuthorNote, BetaSwitch, FollowButton, isSupporter, KnownIssues, PreviewPlayer, RatingMini, RelatedPlugins, ReviewsSection, StoreHome, WishButton } from "./StoreCommunity";

const storeName = (kind: StoreKind) => t(`store.name.${kind}`);

const healthLabel = (health: PluginHealth) => t(
    health.state === "investigating" ? "health.investigating"
        : health.state === "fixed" ? health.hotfix ? "hotfix.label" : "health.fixed"
            : health.automatic ? "health.brokenAuto" : "health.broken",
);

type Action = ReturnType<typeof Store.pluginAction>;

/** Everything the UI needs about one store item, whichever kind it is */
interface Item {
    kind: StoreKind;
    entry: ListingInfo & { minEviVersion?: string; };
    native: boolean;
    action: Action;
    installedVersion?: string;
    fromStore: boolean;
    op?: StoreOp;
    /** A known problem with the version you have, or would install */
    health?: PluginHealth;
    /** One of Evi's own, rather than a community plugin */
    official: boolean;
    /** Evi pulled the listed version: it can't be installed */
    pulled?: PulledPlugin;
    /** Plugins: what it declares it needs. Undefined: it doesn't declare (see `declares`), or a theme. */
    permissions?: DeclaredPermissions;
    /** A plugin that says what it needs, so Evi holds it to that. Always true for themes. */
    declares: boolean;
    /** An update that asks for more than the installed version: asked before it's installed */
    growth?: PermissionGrowth;
    /** The stable entry as the registry lists it, for plugins: `entry` is its beta when you opted in */
    listed?: RegistryEntry;
    /** Showing its beta, because you opted into this plugin's betas */
    beta: boolean;
    /** Only for people supporting Evi */
    supportersOnly: boolean;
    /** Supporters only, and you aren't one (yet): it can't be installed from here */
    locked: boolean;
    install(options?: { allowNative?: boolean; allowMore?: boolean; }): Promise<unknown>;
    uninstall(): Promise<unknown>;
}

function itemsOf(kind: StoreKind): Item[] {
    const state = Store.getSnapshot();
    if (kind === "plugin") {
        return state.plugins.map((listed: RegistryEntry) => {
            const entry = Store.entryFor(listed);
            const installed = Store.installedPlugin(entry.id);
            const health = Store.healthOf(entry.id);
            const supportersOnly = !!listed.supporters;
            return {
                kind, entry, listed, native: entry.native,
                beta: entry !== listed,
                supportersOnly,
                locked: supportersOnly && !installed && !isSupporter(),
                action: Store.pluginAction(entry.id),
                installedVersion: installed?.version,
                fromStore: !!installed?.fromStore,
                op: state.ops[entry.id],
                health: healthWarns(health, installed?.version ?? entry.version) ? health : undefined,
                official: isOfficialListing(entry),
                pulled: Store.pullOf(entry.id, entry.version),
                permissions: entry.permissions,
                declares: !!entry.permissions,
                growth: Store.growthOf(entry.id),
                install: (options = {}) => Store.install(entry.id, options),
                uninstall: () => Store.uninstall(entry.id),
            };
        });
    }
    return state.themes.map((entry: ThemeEntry) => {
        const installed = state.installedThemes[entry.id];
        const supportersOnly = !!entry.supporters;
        return {
            kind, entry, native: false,
            beta: false,
            supportersOnly,
            locked: supportersOnly && !installed && !isSupporter(),
            action: Store.themeAction(entry.id),
            installedVersion: installed?.version,
            fromStore: !!installed,
            op: state.themeOps[entry.id],
            official: isOfficialListing(entry),
            declares: true,
            install: () => Store.installTheme(entry.id),
            uninstall: () => Store.uninstallTheme(entry.id),
        };
    });
}

/** Loads the registry the first time anything store-related shows */
export function useStoreState() {
    const state = useStore(Store.subscribe, Store.getSnapshot);
    // Pulls arrive through the plugin manager
    useStore(PluginManager.subscribe, PluginManager.getSnapshot);
    React.useEffect(() => {
        if (state.status === "idle") Store.refresh();
    }, []);
    return state;
}

const formatDate = (date: string) => new Date(`${date}T00:00:00`).toLocaleDateString(I18n.discordLocale, { dateStyle: "medium" });

function OpStatus({ op }: { op: StoreOp | undefined; }) {
    if (!op) return null;
    if (op.type === "busy") return <Status tone="muted">{op.label}</Status>;
    if (op.type === "done") return <Status tone="success">{op.message}</Status>;
    return <Status tone="danger">{op.error}</Status>;
}

/** `short` for cards, where the footer only has room for a word or two */
function ItemStatus({ item, short }: { item: Item; short?: boolean; }) {
    const { op, action, installedVersion, entry } = item;
    if (op) return <OpStatus op={op} />;
    if (action === "installed") return <Status tone="success" quiet>{!short && installedVersion ? t("store.installedVersion", { version: installedVersion }) : t("store.installed")}</Status>;
    if (action === "update") return <Status tone="warning">{short ? `v${installedVersion} → v${entry.version}` : t("store.updateYouHave", { version: installedVersion ?? "" })}</Status>;
    if (action === "local") return <Status tone="success" quiet>{short ? t("store.installed") : installedVersion ? t("store.installedOutsideVersion", { version: installedVersion }) : t("store.installedOutside")}</Status>;
    if (action === "incompatible") return <Status tone="danger">{t("store.needsEvi", { version: entry.minEviVersion ?? "" })}</Status>;
    if (action === "pulled") return <Status tone="danger">{short ? t("store.pulled") : installedVersion ? t("store.pulledByEviHave", { version: installedVersion }) : t("store.pulledByEvi")}</Status>;
    return null;
}

/** What a community plugin's page and its first install say about it */
const trustNote = (entry: ListingInfo) => t("store.trustNote", { authors: entry.authors.join(", ") });

/** Not one of Evi's own: made by someone else, reviewed before it was listed */
function CommunityLabel() {
    return <span className="dl-store-label"><Icon name="people" size={14} />{t("store.community")}</span>;
}

// Community plugins installed before, by id: only the first install of each asks. Discord deletes
// window.localStorage once it starts; Evi runs before it, so keep a reference now.
const COMMUNITY_KEY = "evi-community-installs";
const storage = (() => {
    try {
        return window.localStorage;
    } catch {
        return undefined;
    }
})();
let communityFallback: string[] = [];

function communityInstalls(): string[] {
    try {
        const saved = JSON.parse(storage?.getItem(COMMUNITY_KEY) ?? "null");
        return Array.isArray(saved) ? saved.filter((id): id is string => typeof id === "string") : communityFallback;
    } catch {
        return communityFallback;
    }
}

function rememberCommunityInstall(id: string) {
    communityFallback = [...new Set([...communityInstalls(), id])];
    try {
        storage?.setItem(COMMUNITY_KEY, JSON.stringify(communityFallback));
    } catch { }
}

/** The first install of a community plugin asks first, in a dialog, saying who made it */
function CommunityConfirm({ item, onConfirm, onClose }: { item: Item; onConfirm(): void; onClose(): void; }) {
    return (
        <Dialog id={`dl-store-community-${item.entry.id}`} title={t("store.communityConfirm")} onClose={onClose}>
            {close => (
                <div className="dl-stack">
                    <Text tag="p" variant="text-sm/normal" color="text-subtle">{trustNote(item.entry)}</Text>
                    <DeclaredPermissionsList permissions={item.permissions} native={item.native} />
                    <div className="dl-toolbar">
                        <Button
                            variant="accent"
                            onClick={() => {
                                onConfirm();
                                close();
                            }}
                        >
                            {t("common.install")}
                        </Button>
                        <Button onClick={close}>{t("common.cancel")}</Button>
                    </div>
                </div>
            )}
        </Dialog>
    );
}

/** Native plugins get their own step, in a dialog: what full access means, and a button that repeats it */
function NativeConfirm({ item, onConfirm, onClose }: { item: Item; onConfirm(): void; onClose(): void; }) {
    return (
        <Dialog
            id={`dl-store-confirm-${item.entry.id}`}
            title={<span className="dl-store-confirm-title"><Icon name="warning" size={20} />{t("store.nativeTitle", { name: item.entry.name })}</span>}
            onClose={onClose}
        >
            {close => (
                <div className="dl-stack">
                    <Text tag="p" variant="text-sm/normal" color="text-subtle">{t("store.nativeBody", { authors: item.entry.authors.join(", ") })}</Text>
                    <DeclaredPermissionsList permissions={item.permissions} native={false} />
                    <div className="dl-toolbar">
                        <Button
                            variant="accent"
                            onClick={() => {
                                onConfirm();
                                close();
                            }}
                        >
                            {t("store.installFullAccess")}
                        </Button>
                        <Button onClick={close}>{t("common.cancel")}</Button>
                    </div>
                </div>
            )}
        </Dialog>
    );
}

/**
 * An update that asks for more than the installed version declares gets its own step, like full
 * access: what's new, and a button that says it allows it. Main asks once more before installing.
 */
function MoreAccessConfirm({ item, growth, onConfirm, onClose }: { item: Item; growth: PermissionGrowth; onConfirm(): void; onClose(): void; }) {
    return (
        <Dialog id={`dl-store-more-${item.entry.id}`} title={t("declared.moreTitle", { name: item.entry.name })} onClose={onClose}>
            {close => (
                <div className="dl-stack">
                    <Text tag="p" variant="text-sm/normal" color="text-subtle">{t("declared.moreBody", { version: item.entry.version })}</Text>
                    <PermissionGrowthList growth={growth} />
                    <div className="dl-toolbar">
                        <Button
                            variant="accent"
                            onClick={() => {
                                onConfirm();
                                close();
                            }}
                        >
                            {t("declared.allowAndUpdate")}
                        </Button>
                        <Button onClick={close}>{t("common.cancel")}</Button>
                    </div>
                </div>
            )}
        </Dialog>
    );
}

/**
 * Install / Update / Uninstall, with a step in between for native plugins (full access), for updates
 * that ask for more access, and for the first install of a community plugin (who made it)
 */
function useItemActions(item: Item) {
    const [confirming, setConfirming] = React.useState<"native" | "more" | "community">();
    const busy = item.op?.type === "busy";
    const install = () => {
        // Updates ask again: a new version may do more than the one you agreed to
        if (item.native) return setConfirming("native");
        if (item.growth) return setConfirming("more");
        if (item.kind === "plugin" && item.action === "install" && !item.official && !communityInstalls().includes(item.entry.id)) return setConfirming("community");
        item.install();
    };

    const buttons = (
        <>
            {item.fromStore && <Button disabled={busy} onClick={() => item.uninstall()}>{t("common.uninstall")}</Button>}
            {/* Plugins Evi shipped with, or put in the folder by hand: removable here too */}
            {!item.fromStore && item.kind === "plugin" && item.action === "local" && <Button disabled={busy} onClick={() => item.uninstall()}>{t("common.remove")}</Button>}
            {item.action === "install" && item.locked && <Button disabled aria-describedby={`dl-store-locked-${item.entry.id}`}>{t("community.forSupporters")}</Button>}
            {item.action === "install" && !item.locked && <Button variant="accent" icon="download" disabled={busy || !!confirming} onClick={install}>{t("common.install")}</Button>}
            {item.action === "update" && <Button variant="accent" icon="download" disabled={busy || !!confirming} onClick={install}>{t("common.update")}</Button>}
        </>
    );
    // The dialog closes itself (with its exit), then says so; installing starts as soon as it's confirmed
    // Full access covers whatever else a native update asks for
    const confirm = confirming === "native"
        ? <NativeConfirm item={item} onClose={() => setConfirming(undefined)} onConfirm={() => item.install({ allowNative: true, allowMore: true })} />
        : confirming === "more" && item.growth
        ? <MoreAccessConfirm item={item} growth={item.growth} onClose={() => setConfirming(undefined)} onConfirm={() => item.install({ allowMore: true })} />
        : confirming === "community" && (
            <CommunityConfirm
                item={item}
                onClose={() => setConfirming(undefined)}
                onConfirm={() => {
                    rememberCommunityInstall(item.entry.id);
                    item.install();
                }}
            />
        );
    return { buttons, confirm };
}

/** GitHub-style: one star per install. Hidden while the stars server can't be reached. */
function StarButton({ item, large }: { item: Item; large?: boolean; }) {
    const state = useStore(Store.subscribe, Store.getSnapshot);
    if (!state.stars) return null;
    const starred = Store.isStarred(item.kind, item.entry.id);
    const count = Store.stars(item.kind, item.entry.id);
    return (
        <button
            type="button"
            className="dl-star"
            data-size={large ? "lg" : undefined}
            aria-pressed={starred}
            aria-label={t(starred ? "store.unstarLabel" : "store.starLabel", { name: item.entry.name, count })}
            onClick={() => Store.toggleStar(item.kind, item.entry.id)}
        >
            <Icon name="star" size={large ? 18 : 14} />
            <span className="dl-tabular">{large ? `${t(starred ? "store.starred" : "store.star")} · ${count}` : count}</span>
        </button>
    );
}

/** Known to be broken right now, from evi.rest: enough installs reported it, or its author said so */
export function HealthPill({ health }: { health: PluginHealth; }) {
    return (
        <span className="dl-health" data-state={health.state}>
            <Icon name="warning" size={12} />
            {healthLabel(health)}
        </span>
    );
}

/** The whole story on a plugin's page: what's wrong, who says so and since when */
function HealthCallout({ health }: { health: PluginHealth; }) {
    const who = health.setBy
        ? t("store.setBy", { name: health.setBy })
        : health.reports ? t("store.installsReported", { count: health.reports }) : undefined;
    return (
        <section className="dl-store-access dl-store-health" aria-label={t("store.knownProblem")}>
            <Icon name="warning" size={20} />
            <div>
                <Text variant="text-md/semibold" color="text-strong">{healthLabel(health)}</Text>
                {health.message && <Text tag="p" variant="text-sm/normal" color="text-default">{health.message}</Text>}
                <Text tag="p" variant="text-xs/normal" color="text-muted">{[who, ago(health.since)].filter(Boolean).join(" · ")}</Text>
            </div>
        </section>
    );
}

/** A version Evi pulled from every install: why, and since when */
function PulledCallout({ pull, version }: { pull: PulledPlugin; version: string; }) {
    return (
        <section className="dl-store-access dl-store-pulled" aria-label={t("store.pulledByEvi")}>
            <Icon name="circleError" size={20} />
            <div>
                <Text variant="text-md/semibold" color="text-strong">{t("store.pulledTitle", { version })}</Text>
                <Text tag="p" variant="text-sm/normal" color="text-default">{pull.reason}</Text>
                <Text tag="p" variant="text-xs/normal" color="text-muted">{`${t("store.cantInstall")} · ${ago(pull.at)}`}</Text>
            </div>
        </section>
    );
}

function VerifiedCheck({ size = 14 }: { size?: number; }) {
    return (
        <Tooltip text={t("store.verifiedAuthor")}>
            <span className="dl-verified"><Icon name="circleCheck" size={size} /></span>
        </Tooltip>
    );
}

/**
 * The listed authors; the ones verified on evi.rest open their page. Evi's own plugins are by Evi
 * with the check, whether or not its profile has loaded.
 */
function Authors({ entry, onAuthor }: { entry: ListingInfo; onAuthor(slug: string): void; }) {
    const official = isOfficialListing(entry);
    return (
        <>
            {entry.authors.map((name, i) => {
                const evi = official && i === 0;
                const slug = evi ? OFFICIAL_AUTHOR : entry.authorIds?.[i];
                const profile = slug ? Store.authorOf(slug) : undefined;
                return (
                    <React.Fragment key={i}>
                        {i > 0 && ", "}
                        {profile?.verified
                            ? (
                                <button type="button" className="dl-link-button dl-author" aria-label={t("store.verifiedAuthorName", { name: profile.name })} onClick={() => onAuthor(profile.slug)}>
                                    {profile.name}<VerifiedCheck size={12} />
                                </button>
                            )
                            : evi ? <span className="dl-author">Evi<VerifiedCheck size={12} /></span> : name}
                    </React.Fragment>
                );
            })}
        </>
    );
}

/** A letter tile standing in for an icon */
export function Glyph({ name, size }: { name: string; size?: "lg"; }) {
    return <span className="dl-store-glyph" data-size={size} aria-hidden="true">{name.charAt(0)}</span>;
}

function StoreCard({ item, onOpen, onAuthor, pinned }: { item: Item; onOpen(): void; onAuthor(slug: string): void; pinned?: boolean; }) {
    const { entry } = item;
    const { buttons, confirm } = useItemActions(item);
    const titleId = `dl-store-${item.kind}-${entry.id}`;

    // The whole card opens the detail page (the title's button stretches over it); the star and the
    // action buttons sit above that layer
    return (
        <li className="dl-store-card" aria-labelledby={titleId} data-store-id={entry.id} data-supporters={item.supportersOnly || undefined}>
            <div className="dl-store-card-top">
                <Glyph name={entry.name} />
                <div className="dl-store-card-title">
                    <Text tag="h3" variant="text-md/semibold" color="text-strong" id={titleId}>
                        <button type="button" className="dl-link-button dl-store-card-link" onClick={onOpen}>{entry.name}</button>
                    </Text>
                    <Text variant="text-xs/normal" color="text-muted" tabular>v{entry.version} · {tNodes("store.byAuthors", { authors: <Authors entry={entry} onAuthor={onAuthor} /> })}</Text>
                    <RatingMini rating={Store.rating(item.kind, entry.id)} />
                </div>
                <div className="dl-store-card-marks">
                    <WishButton kind={item.kind} id={entry.id} name={entry.name} />
                    <StarButton item={item} />
                </div>
            </div>
            {entry.description && <Text tag="p" variant="text-sm/normal" color="text-subtle" className="dl-store-card-desc">{entry.description}</Text>}
            {/* Categories are in the filter and on the item's page, the card keeps to what to watch out for */}
            {(item.native || item.health || !item.official || !item.declares || item.beta || item.supportersOnly || pinned) && (
                <div className="dl-store-card-tags">
                    {item.health && <HealthPill health={item.health} />}
                    {pinned && <Badge>{t("community.pinned")}</Badge>}
                    {item.beta && <Badge>{t("community.beta")}</Badge>}
                    {item.supportersOnly && <SupportersPill />}
                    {!item.official && <CommunityLabel />}
                    {item.native && <Badge tone="warning">{t("plugins.badge.native")}</Badge>}
                    {!item.declares && <Badge>{t("declared.undeclared")}</Badge>}
                </div>
            )}
            <div className="dl-store-card-foot">
                <span className="dl-store-status" role="status"><ItemStatus item={item} short /></span>
                <div className="dl-row-controls">{buttons}</div>
            </div>
            {confirm}
        </li>
    );
}

const NOTES_SHOWN = 3;

/** One pending update: what it is, old → new version, what changed, and its own Update button */
function UpdateRow({ item }: { item: Item; }) {
    const [expanded, setExpanded] = React.useState(false);
    const { entry, installedVersion } = item;
    const entries = installedVersion ? entriesBetween(entry.changelog, installedVersion, entry.version) : [];
    const notes = entries.flatMap(e => e.notes.map(note => ({ version: e.version, note })));
    const shown = expanded ? notes : notes.slice(0, NOTES_SHOWN);
    const busy = item.op?.type === "busy";
    const multiVersion = entries.length > 1;

    return (
        <li className="dl-store-update">
            <div className="dl-store-update-head">
                <Text variant="text-sm/semibold" color="text-strong">{entry.name}</Text>
                <span className="dl-store-update-version">
                    {installedVersion ? `${installedVersion} → ${entry.version}` : entry.version}
                </span>
                {item.native && <Badge tone="warning">{t("plugins.badge.native")}</Badge>}
                {!item.native && item.growth && <Badge tone="warning">{t("declared.asksForMore")}</Badge>}
                <span className="dl-grow" />
                {/* Full-access plugins and updates that ask for more go through Update all, which asks first */}
                {!item.native && !item.growth && (
                    <Button size="sm" disabled={busy} onClick={() => void item.install()} aria-label={t("store.updateName", { name: entry.name })}>
                        {busy ? t("common.updating") : t("common.update")}
                    </Button>
                )}
            </div>
            {notes.length
                ? (
                    <ul className="dl-store-update-notes">
                        {shown.map(({ version, note }, i) => (
                            <li key={i}>
                                {multiVersion && <span className="dl-store-update-note-version">{version}</span>}
                                {note}
                            </li>
                        ))}
                    </ul>
                )
                : <p className="dl-hint">{t("store.noNotes")}</p>}
            {notes.length > NOTES_SHOWN && (
                <button type="button" className="dl-link-button" onClick={() => setExpanded(e => !e)} aria-expanded={expanded}>
                    {expanded ? t("common.showLess") : t("common.showMore", { count: notes.length - NOTES_SHOWN })}
                </button>
            )}
        </li>
    );
}

/**
 * Update all, with one question for the updates that need one: full-access plugins, and updates that
 * ask for more than the installed version declares
 */
function UpdateAll({ kind, items }: { kind: StoreKind; items: Item[]; }) {
    const state = useStore(Store.subscribe, Store.getSnapshot);
    const [asking, setAsking] = React.useState(false);
    const [result, setResult] = React.useState<UpdateAllResult>();
    const updates = items.filter(i => i.action === "update");
    const native = updates.filter(i => i.native);
    const more = updates.filter(i => !i.native && i.growth);

    const run = async (includeAsking: boolean) => {
        setAsking(false);
        setResult(await Store.updateAll(kind, { includeNative: includeAsking, includeMoreAccess: includeAsking }));
    };

    if (result && !updates.length) {
        const text = result.failed.length
            ? t("store.updatedFailed", { updated: result.updated.length, count: result.failed.length, list: result.failed.join(", ") })
            : t(`store.updated.${kind}`, { count: result.updated.length });
        return <Notice tone={result.failed.length ? "danger" : "info"}>{text}</Notice>;
    }
    if (!updates.length) return null;

    return (
        <div className="dl-store-updates" role="group" aria-label={t("tabs.updates")}>
            <div className="dl-store-updates-head">
                <Icon name="download" size={20} />
                <Text variant="text-md/semibold" color="text-strong" className="dl-grow">
                    {t("store.updatesAvailable", { count: updates.length })}
                </Text>
                <Button
                    variant="accent"
                    id={`dl-${kind}-update-all`}
                    disabled={!!state.updatingAll || asking}
                    onClick={() => native.length || more.length ? setAsking(true) : run(false)}
                >
                    {state.updatingAll === kind ? t("common.updating") : t("store.updateAll")}
                </Button>
            </div>
            <ul className="dl-store-update-list" aria-label={t("store.pendingUpdates")}>
                {updates.map(item => <UpdateRow key={item.entry.id} item={item} />)}
            </ul>
            {asking && (
                <div className="dl-store-confirm" role="group" aria-label={t(native.length ? "store.fullAccessUpdates" : "declared.moreUpdates")}>
                    {native.length > 0 && <p className="dl-store-confirm-title"><Icon name="warning" size={20} />{t("store.nativeUpdateTitle", { names: native.map(i => i.entry.name).join(", "), count: native.length })}</p>}
                    {more.length > 0 && <p className="dl-store-confirm-title"><Icon name="warning" size={20} />{t("declared.moreUpdateTitle", { names: more.map(i => i.entry.name).join(", "), count: more.length })}</p>}
                    <p className="dl-hint">{t("store.nativeUpdateHint", { count: native.length + more.length })}</p>
                    <div className="dl-toolbar">
                        <Button variant="accent" onClick={() => run(true)}>{t(native.length ? "store.updateAllNative" : "declared.updateAllMore")}</Button>
                        {updates.length > native.length + more.length && <Button onClick={() => run(false)}>{t("store.onlyOthers")}</Button>}
                        <Button onClick={() => setAsking(false)}>{t("common.cancel")}</Button>
                    </div>
                </div>
            )}
        </div>
    );
}

type Filter = "all" | "new" | "updates" | "installed" | "uninstalled" | "official" | "community";

/** Cards per page: four rows of three, or six of two */
const PAGE_SIZE = 12;

const sortOptions = () => [
    { value: "name", label: t("store.sort.name") },
    { value: "stars", label: t("store.sort.stars") },
    { value: "rating", label: t("community.sortRating") },
    { value: "trending", label: t("community.sortTrending") },
    { value: "updated", label: t("store.sort.updated") },
] as const satisfies readonly { value: ListingSort; label: string; }[];

/**
 * Where you were in a store's list, so going back from a plugin's page (or switching tabs and back)
 * lands on the same search, filters, page and scroll, with the card you opened focused. The scroll
 * is only put back into the same scroller it was read from: a fresh open of settings starts at the top.
 */
interface ListMemory {
    query: string;
    filter: Filter;
    category: string;
    sort: ListingSort;
    page: number;
    scroll?: { scroller: WeakRef<HTMLElement>; top: number; };
    /** The card whose page was opened, focused again on the way back */
    focus?: string;
}
const listMemory: Partial<Record<StoreKind, ListMemory>> = {};
const memoryOf = (kind: StoreKind): ListMemory => listMemory[kind] ??= { query: "", filter: "all", category: "all", sort: "name", page: 0 };

/** The element that scrolls the store: Evi's panel body, or Discord's settings scroller around it */
function scrollerOf(el: HTMLElement | null): HTMLElement | undefined {
    for (let node = el?.parentElement; node; node = node.parentElement) {
        const { overflowY } = getComputedStyle(node);
        if ((overflowY === "auto" || overflowY === "scroll") && node.scrollHeight > node.clientHeight) return node;
    }
}

/**
 * Puts a scroller back where it was. The list may still be growing (the front page's rows, pictures),
 * so the browser clamps the first try: it's tried again as the content grows, for a moment, and never
 * against the user, who wins as soon as they scroll or press a key.
 */
function restoreScroll(scroller: HTMLElement, top: number, content: HTMLElement | null) {
    scroller.scrollTop = top;
    if (Math.abs(scroller.scrollTop - top) <= 1 || !content) return;
    const stop = () => {
        observer.disconnect();
        clearTimeout(timer);
        for (const type of ["wheel", "pointerdown", "keydown", "touchstart"]) scroller.removeEventListener(type, stop);
    };
    const observer = new ResizeObserver(() => {
        scroller.scrollTop = top;
        if (Math.abs(scroller.scrollTop - top) <= 1) stop();
    });
    observer.observe(content);
    const timer = setTimeout(stop, 1500);
    for (const type of ["wheel", "pointerdown", "keydown", "touchstart"]) scroller.addEventListener(type, stop, { passive: true });
}

export function StoreView({ kind }: { kind: StoreKind; }) {
    const state = useStoreState();
    const memory = memoryOf(kind);
    const [query, setQueryState] = React.useState(memory.query);
    const [filter, setFilterState] = React.useState<Filter>(memory.filter);
    const [category, setCategoryState] = React.useState(memory.category);
    const [sort, setSortState] = React.useState<ListingSort>(memory.sort);
    const [page, setPage] = React.useState(memory.page);
    // A new search, filter, category or order starts from the first page
    const fresh = <T,>(set: (v: T) => void) => (v: T) => {
        set(v);
        setPage(0);
    };
    const setQuery = fresh(setQueryState), setFilter = fresh(setFilterState), setCategory = fresh(setCategoryState), setSort = fresh(setSortState);
    React.useEffect(() => void Object.assign(memory, { query, filter, category, sort, page }), [memory, query, filter, category, sort, page]);
    // Opened from an installed plugin's Update: straight to its page
    const [selected, setSelected] = React.useState(() => takeStoreTarget(kind));
    const listRef = React.useRef<HTMLDivElement>(null);
    // An author's page, over the list or over the plugin page it was opened from
    const [author, setAuthor] = React.useState<string>();
    const topRef = React.useRef<HTMLDivElement>(null);

    // Leaving the list for a page: remember the card; the list keeps its scroll up to date itself
    const openFromList = (id: string) => {
        memory.focus = id;
        setSelected(id);
    };
    const authorFromList = (slug: string) => {
        memory.focus = undefined;
        setAuthor(slug);
    };

    // The mouse's back button and Alt+Left go back from a page too, like the Back button
    React.useEffect(() => {
        if (!selected && !author) return;
        const back = () => author ? setAuthor(undefined) : setSelected(undefined);
        const visible = () => !!topRef.current?.isConnected && topRef.current.getClientRects().length > 0;
        const onKey = (e: KeyboardEvent) => {
            if (!e.altKey || e.key !== "ArrowLeft" || e.ctrlKey || e.metaKey || e.shiftKey || !visible()) return;
            e.preventDefault();
            e.stopImmediatePropagation();
            back();
        };
        const onMouse = (e: MouseEvent) => {
            if (e.button !== 3 || !visible()) return;
            e.preventDefault();
            e.stopImmediatePropagation();
            if (e.type === "mouseup") back();
        };
        window.addEventListener("keydown", onKey, true);
        window.addEventListener("mousedown", onMouse, true);
        window.addEventListener("mouseup", onMouse, true);
        return () => {
            window.removeEventListener("keydown", onKey, true);
            window.removeEventListener("mousedown", onMouse, true);
            window.removeEventListener("mouseup", onMouse, true);
        };
    }, [selected, author]);

    // Detail pages start at their top, wherever the list was scrolled to: only when one opens or
    // closes, never when the Store itself opens (that scrolled Discord's settings under its sticky
    // header), and only if the top is out of sight. A block body on purpose: Chrome's scrollIntoView
    // now returns a promise, and React would call it as the cleanup.
    const opened = React.useRef(false);
    React.useEffect(() => {
        if (!opened.current) {
            opened.current = true;
            return;
        }
        // Back on the list, it puts its own scroll back (see StoreListing)
        if (selected || author) scrollToTop(topRef.current);
    }, [selected, author]);

    const items = itemsOf(kind);
    const current = selected ? items.find(i => i.entry.id === selected) : undefined;
    const profile = author ? Store.authorOf(author) : undefined;
    if (profile) {
        return (
            <div ref={topRef}>
                <AuthorView
                    kind={kind}
                    profile={profile}
                    items={items.filter(i => profile.plugins.includes(i.entry.id) || !!i.entry.authorIds?.includes(profile.slug))}
                    backLabel={current ? current.entry.name : storeName(kind)}
                    onBack={() => setAuthor(undefined)}
                    onOpen={id => {
                        setAuthor(undefined);
                        setSelected(id);
                    }}
                    onAuthor={setAuthor}
                />
            </div>
        );
    }
    if (current) {
        return <div ref={topRef}><StoreDetail key={current.entry.id} item={current} onBack={() => setSelected(undefined)} onAuthor={setAuthor} onOpen={setSelected} /></div>;
    }

    return (
        <StoreListing
            kind={kind}
            state={state}
            items={items}
            query={query}
            setQuery={setQuery}
            filter={filter}
            setFilter={setFilter}
            category={category}
            setCategory={setCategory}
            sort={sort}
            setSort={setSort}
            page={page}
            setPage={setPage}
            memory={memory}
            topRef={topRef}
            listRef={listRef}
            onOpen={openFromList}
            onAuthor={authorFromList}
        />
    );
}

/** A store tag in Discord's language: the ones Evi knows are translated, any other is shown as written, capitalized */
const tagLabel = (tag: string) => {
    const key = `store.tag.${tag}` as EviKey;
    const text = t(key);
    return text === key ? tag[0].toUpperCase() + tag.slice(1) : text;
};

/** What search matches for an entry: as shown, as the registry wrote it, and in every translation */
function searchable(kind: StoreKind, entry: ListingInfo & { locales?: RegistryEntry["locales"]; }): Searchable {
    const original = Store.original(kind, entry.id);
    const translations = Object.values(entry.locales ?? {});
    return {
        id: entry.id,
        name: entry.name,
        description: entry.description,
        tags: entry.tags,
        authors: entry.authors,
        alsoNamed: [original?.name, ...translations.map(l => l.name)].filter((n): n is string => !!n),
        alsoDescribed: [original?.description, ...translations.map(l => l.description)].filter((d): d is string => !!d),
    };
}

function StoreListing({ kind, state, items, query, setQuery, filter, setFilter, category, setCategory, sort, setSort, page, setPage, memory, topRef, listRef, onOpen, onAuthor }: {
    kind: StoreKind;
    state: ReturnType<typeof Store.getSnapshot>;
    items: Item[];
    query: string;
    setQuery(query: string): void;
    filter: Filter;
    setFilter(filter: Filter): void;
    category: string;
    setCategory(category: string): void;
    sort: ListingSort;
    setSort(sort: ListingSort): void;
    page: number;
    setPage(page: number): void;
    memory: ListMemory;
    topRef: React.RefObject<HTMLDivElement | null>;
    listRef: React.RefObject<HTMLDivElement | null>;
    onOpen(id: string): void;
    onAuthor(slug: string): void;
}) {
    const tags = [...new Set(items.flatMap(i => i.entry.tags))].sort();
    // First listed this week, from evi.rest's front page (store home)
    const fresh = new Set(state.home?.fresh ?? []);
    const tests: Record<Filter, (i: Item) => boolean> = {
        all: () => true,
        new: i => fresh.has(`${kind}:${i.entry.id}`),
        updates: i => i.action === "update",
        installed: i => i.action === "installed" || i.action === "update" || i.action === "local",
        // What you could still add: not installed from the store or by hand
        uninstalled: i => i.action === "install" || i.action === "incompatible" || (i.action === "pulled" && !i.installedVersion),
        official: i => i.official,
        community: i => !i.official,
    };
    const inCategory = (i: Item) => category === "all" || i.entry.tags.includes(category);
    const count = (f: Filter) => items.filter(i => tests[f](i) && inCategory(i)).length;

    const q = query.trim();
    const score = (id: string) => sort === "rating" ? Store.ratingScore(kind, id) : sort === "trending" ? Store.trendingScore(kind, id) : Store.stars(kind, id);
    const order = new Map(sortListings(items.map(i => i.entry), sort, e => score(e.id)).map((e, n) => [e.id, n]));
    // The front page is for browsing: it steps aside once you search, filter or pick a category
    const showHome = !q && filter === "all" && category === "all" && !!state.home;
    // Sorted as chosen, then while searching the best matches first (ties keep the chosen order)
    const sorted = items.filter(i => tests[filter](i) && inCategory(i)).sort((a, b) => order.get(a.entry.id)! - order.get(b.entry.id)!);
    const visible = searchItems(sorted, q, i => searchable(kind, i.entry));
    // The page lives in StoreView, so it outlasts a visit to a plugin's page
    const pageCount = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
    const shownPage = Math.min(page, pageCount - 1);
    const paged = { page: shownPage, count: pageCount, items: visible.slice(shownPage * PAGE_SIZE, (shownPage + 1) * PAGE_SIZE), setPage };

    // Keep where the list is scrolled, and put it back once the cards are there: after a plugin's
    // page, or switching tabs and back, as long as it's the same scroller (the same open settings)
    const restoring = React.useRef(true);
    const ready = paged.items.length > 0;
    React.useLayoutEffect(() => {
        const scroller = scrollerOf(topRef.current);
        if (restoring.current && ready) {
            restoring.current = false;
            const saved = memory.scroll;
            if (scroller && saved && saved.scroller.deref() === scroller) restoreScroll(scroller, saved.top, topRef.current);
            const focus = memory.focus;
            memory.focus = undefined;
            if (focus) topRef.current?.querySelector<HTMLElement>(`li[data-store-id="${CSS.escape(focus)}"] .dl-store-card-link`)?.focus({ preventScroll: true });
        }
        if (!scroller || restoring.current) return;
        const save = () => void (memory.scroll = { scroller: new WeakRef(scroller), top: scroller.scrollTop });
        save();
        scroller.addEventListener("scroll", save, { passive: true });
        return () => scroller.removeEventListener("scroll", save);
    }, [ready, memory, topRef]);
    const categories = [{ value: "all", label: t("store.allCategories") }, ...tags.map(tag => ({ value: tag, label: tagLabel(tag) }))];

    return (
        <div className="dl-tab dl-tab-compact" ref={topRef}>
            <div className="dl-controls dl-store-controls">
                <div className="dl-toolbar">
                    <div className="dl-grow">
                        <SearchField id={`dl-${kind}-store-search`} label={t(`store.searchLabel.${kind}`)} placeholder={t(`store.search.${kind}`)} value={query} onChange={setQuery} />
                    </div>
                    {tags.length > 0 && (
                        <div className="dl-toolbar-select">
                            <Dropdown id={`dl-${kind}-store-category`} label={t("store.category")} options={categories} value={category} onChange={setCategory} />
                        </div>
                    )}
                    <div className="dl-toolbar-select">
                        <Dropdown<ListingSort> id={`dl-${kind}-store-sort`} label={t("store.sortBy")} options={sortOptions()} value={sort} onChange={setSort} />
                    </div>
                    <IconButton icon="refresh" label={t("common.refresh")} onClick={() => state.status !== "loading" && Store.refresh()} />
                </div>
                <FilterChips<Filter>
                    label={t(`store.show.${kind}`)}
                    value={filter}
                    onChange={setFilter}
                    options={[
                        { id: "all", label: t("plugins.filter.all"), count: count("all") },
                        { id: "new", label: t("store.filter.new"), count: count("new") },
                        { id: "updates", label: t("tabs.updates"), count: count("updates") },
                        { id: "installed", label: t("store.installed"), count: count("installed") },
                        { id: "uninstalled", label: t("store.notInstalled"), count: count("uninstalled") },
                        { id: "official", label: t("store.official"), count: count("official") },
                        { id: "community", label: t("store.community"), count: count("community") },
                    ]}
                />
            </div>

            <UpdateAll kind={kind} items={items} />

            {showHome && <StoreHome kind={kind} onOpen={onOpen} />}

            <div className="dl-stack" ref={listRef}>
                {showHome && <Text tag="h3" variant="heading-md/semibold" color="text-strong">{t(`community.browseAll.${kind}`)}</Text>}
                <div role="status" className="dl-store-registry">
                    {state.status === "loading" && <Status tone="muted">{t("store.loading")}</Status>}
                    {state.status === "error" && <Status tone="danger">{t("store.loadFailed", { error: state.error ?? "" })}</Status>}
                    {state.status === "ready" && state.problems.length > 0 && (
                        <Status tone="warning">{t("store.skipped", { count: state.problems.length })}</Status>
                    )}
                </div>
                {visible.length ? (
                    <>
                        <ul className="dl-store-grid" aria-label={t(`store.gridLabel.${kind}`)}>
                            {paged.items.map(i => <StoreCard key={i.entry.id} item={i} onOpen={() => onOpen(i.entry.id)} onAuthor={onAuthor} />)}
                        </ul>
                        <Pagination
                            label={t("store.pages")}
                            page={paged.page}
                            count={paged.count}
                            onChange={n => {
                                paged.setPage(n);
                                scrollToTop(listRef.current);
                            }}
                        />
                    </>
                ) : state.status === "ready" && (
                    <EmptyState
                        icon={items.length ? "search" : "store"}
                        title={!items.length ? t(`store.emptyStore.${kind}`) : q ? t(`store.noMatch.${kind}`, { query: query.trim() }) : t(`store.noneInFilter.${kind}`)}
                        action={items.length ? <Button onClick={() => { setQuery(""); setFilter("all"); setCategory("all"); }}>{t("store.showEverything")}</Button> : undefined}
                    >
                        {t(!items.length ? "store.emptyStoreHint" : "store.noMatchHint")}
                    </EmptyState>
                )}
            </div>

            <StoreSettings kind={kind} registryUrl={state.registryUrl} />
        </div>
    );
}

/** Auto-update and the reporting switches, folded away under the listing */
function StoreSettings({ kind, registryUrl }: { kind: StoreKind; registryUrl?: string; }) {
    const settings = useStore(Settings.subscribe, () => Settings.data);
    const [open, setOpen] = React.useState(false);
    const id = `dl-${kind}-store-settings`;

    return (
        <section className="dl-stack">
            <button type="button" className="dl-disclosure" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
                <Icon name="chevronRight" size={16} />
                <Text tag="span" variant="text-sm/semibold" color="text-subtle">{t("store.settings")}</Text>
            </button>
            <Collapse open={open} id={id}>
                <div className="dl-stack">
                    <List label={t("store.settings")}>
                        <li className="dl-row">
                            <SwitchRow
                                id="dl-store-auto-update"
                                label={t("store.autoUpdate")}
                                description={t("store.autoUpdateHint")}
                                checked={!!settings.autoUpdate}
                                onChange={Store.setAutoUpdate}
                            />
                        </li>
                        {kind === "plugin" && (
                            <li className="dl-row">
                                <SwitchRow
                                    id="dl-store-health-reports"
                                    label={t("store.healthReports")}
                                    description={t("store.healthReportsHint")}
                                    checked={settings.healthReports !== false}
                                    onChange={on => Settings.update(d => {
                                        d.healthReports = on;
                                    })}
                                />
                            </li>
                        )}
                        {kind === "plugin" && (
                            <li className="dl-row">
                                <SwitchRow
                                    id="dl-store-crash-consent"
                                    label={t("store.askCrash")}
                                    description={t("store.askCrashHint")}
                                    checked={!settings.crashReportConsent}
                                    onChange={ask => Settings.update(d => {
                                        d.crashReportConsent = !ask;
                                    })}
                                />
                            </li>
                        )}
                        {kind === "plugin" && <PluginChangelogSetting />}
                        {kind === "plugin" && (
                            <li className="dl-row">
                                <SwitchRow
                                    id="dl-store-share-usage"
                                    label={t("community.shareUsage")}
                                    description={t("community.shareUsageHint")}
                                    checked={settings.shareUsage !== false}
                                    onChange={on => Settings.update(d => {
                                        d.shareUsage = on;
                                    })}
                                />
                            </li>
                        )}
                    </List>
                    {registryUrl && (
                        <p className="dl-hint">
                            {tNodes("store.registryHint", {
                                url: <span className="dl-mono">{registryUrl}</span>,
                                key: <span className="dl-mono">registryUrl</span>,
                                file: <span className="dl-mono">store.json</span>,
                            })}
                        </p>
                    )}
                </div>
            </Collapse>
        </section>
    );
}

function Screenshot({ url, name, index }: { url: string; name: string; index: number; }) {
    const [src, setSrc] = React.useState<string | null | undefined>();
    React.useEffect(() => {
        let live = true;
        Store.image(url).then(s => live && setSrc(s));
        return () => void (live = false);
    }, [url]);

    if (src === null) return null;
    return (
        <figure className="dl-store-shot" data-loading={src ? undefined : ""}>
            {src && <img src={src} alt={t("store.screenshot", { name, n: index + 1 })} loading="lazy" />}
        </figure>
    );
}

function Fact({ label, children }: { label: string; children: React.ReactNode; }) {
    return (
        <div className="dl-store-fact">
            <dt><Text variant="text-xs/semibold" color="text-muted">{label}</Text></dt>
            <dd><Text variant="text-sm/medium" color="text-strong">{children}</Text></dd>
        </div>
    );
}

function StoreDetail({ item, onBack, onAuthor, onOpen }: { item: Item; onBack(): void; onAuthor(slug: string): void; onOpen(id: string): void; }) {
    const { entry, kind } = item;
    const { buttons, confirm } = useItemActions(item);
    const headingId = `dl-store-detail-${entry.id}`;
    const state = useStore(Store.subscribe, Store.getSnapshot);
    React.useEffect(() => {
        if (kind === "plugin") void Store.loadPage(entry.id);
    }, [entry.id]);
    const page = kind === "plugin" && state.pages[entry.id]?.status === "ready" ? (state.pages[entry.id] as { page: PluginPage; }).page : undefined;
    // Health and a pull have their own callouts; the rest of what evi.rest knows goes under Known issues
    const issues = page?.issues.filter(i => (i.kind === "status" || i.kind === "hotfix") && !item.health) ?? [];
    // A community listing's own link is whatever its author wrote (a port may point at the original):
    // its source is the exact code evi.rest serves, the version shown here
    const code = item.official ? undefined : kind === "plugin" ? (entry as RegistryEntry).files["index.js"]?.url : (entry as ThemeEntry).file?.url;

    return (
        <article className="dl-tab dl-store-detail" aria-labelledby={headingId} data-store-detail={entry.id} data-supporters={item.supportersOnly || undefined}>
            <div>
                <Button icon="chevronLeft" onClick={onBack}>{storeName(kind)}</Button>
            </div>

            <header className="dl-store-detail-head">
                <Glyph name={entry.name} size="lg" />
                <div className="dl-store-detail-title">
                    <div className="dl-row-title">
                        <Text tag="h2" variant="heading-xl/bold" color="text-strong" id={headingId}>{entry.name}</Text>
                        {item.supportersOnly && <SupportersPill />}
                        {!item.official && <CommunityLabel />}
                        {item.native && <Badge tone="warning">{t("plugins.badge.native")}</Badge>}
                        {!item.declares && <Badge>{t("declared.undeclared")}</Badge>}
                    </div>
                    <Text variant="text-sm/normal" color="text-subtle">{tNodes("store.byAuthors", { authors: <Authors entry={entry} onAuthor={onAuthor} /> })}</Text>
                    <span className="dl-store-status" role="status"><ItemStatus item={item} /></span>
                </div>
                <div className="dl-row-controls"><WishButton kind={kind} id={entry.id} name={entry.name} large /><StarButton item={item} large />{kind === "plugin" && <CopyShareLink id={entry.id} />}{buttons}</div>
            </header>
            {item.supportersOnly && <SupportersBanner locked={item.locked} id={entry.id} />}
            {!item.official && (
                <p className="dl-store-trust"><Icon name="info" size={16} /><span>{trustNote(entry)}</span></p>
            )}
            {confirm}

            {entry.description && <Text tag="p" variant="text-md/normal" color="text-default" className="dl-store-detail-desc">{entry.description}</Text>}

            {item.pulled && <PulledCallout pull={item.pulled} version={entry.version} />}
            {item.health && <HealthCallout health={item.health} />}
            {page?.note && <AuthorNote note={page.note} />}

            {entry.preview && <PreviewPlayer url={entry.preview} name={entry.name} />}
            {entry.screenshots.length > 0 && (
                <div className="dl-store-shots">
                    {entry.screenshots.map((url, i) => <Screenshot key={url} url={url} name={entry.name} index={i} />)}
                </div>
            )}

            <dl className="dl-store-facts">
                <Fact label={t("store.fact.version")}>v{entry.version}{item.installedVersion && item.installedVersion !== entry.version && ` ${t("store.youHave", { version: item.installedVersion })}`}</Fact>
                {entry.updatedAt && <Fact label={t("store.fact.updated")}>{formatDate(entry.updatedAt)}</Fact>}
                {entry.minEviVersion && <Fact label={t("store.fact.needs")}>Evi {entry.minEviVersion}+</Fact>}
                {page?.installs != null && <Fact label={t("community.fact.installs")}>{page.installs.toLocaleString(I18n.discordLocale)}</Fact>}
                {item.health && <Fact label={t("store.fact.status")}><HealthPill health={item.health} /></Fact>}
                {entry.tags.length > 0 && <Fact label={t("store.fact.categories")}>{entry.tags.map(tagLabel).join(", ")}</Fact>}
            </dl>

            <section className="dl-store-access" data-native={item.native ? "" : undefined} aria-label={t("store.access")}>
                <Icon name={item.native ? "warning" : "circleCheck"} size={20} />
                <div>
                    <Text variant="text-md/semibold" color="text-strong">
                        {t(item.native ? "store.access.native" : kind === "theme" ? "store.access.theme" : "store.access.plugin")}
                    </Text>
                    <Text tag="p" variant="text-sm/normal" color="text-subtle">
                        {t(item.native ? "store.access.nativeHint" : kind === "theme" ? "store.access.themeHint" : "store.access.pluginHint")}
                    </Text>
                </div>
            </section>
            {kind === "plugin" && item.listed && <BetaSwitch entry={item.listed} />}
            {kind === "plugin" && <StorePluginPermissions id={entry.id} version={entry.version} native={item.native} permissions={item.permissions} headingId={`${headingId}-permissions`} />}
            <KnownIssues issues={issues} />

            {(code || entry.source) && (
                <div className="dl-store-links">
                    <a className="dl-store-source" href={code ?? entry.source} target="_blank" rel="noreferrer noopener">
                        <Icon name="link" size={16} />{t("store.viewSource")}
                    </a>
                    {code && entry.source && (
                        <a className="dl-store-source" href={entry.source} target="_blank" rel="noreferrer noopener">
                            <Icon name="link" size={16} />{t("store.projectLink")}
                        </a>
                    )}
                </div>
            )}

            <section className="dl-stack" aria-labelledby={`${headingId}-changes`}>
                <Text tag="h3" variant="heading-md/semibold" color="text-strong" id={`${headingId}-changes`}>{t("store.whatsNew")}</Text>
                {entry.changelog.length ? (
                    <ol className="dl-changelog">
                        {entry.changelog.map(c => (
                            <li key={c.version}>
                                <div className="dl-row-title">
                                    <Text variant="text-sm/semibold" color="text-strong" tabular>v{c.version}</Text>
                                    {c.version === item.installedVersion && <Badge>{t("store.installed")}</Badge>}
                                </div>
                                <ul>{c.notes.map(n => <li key={n}><Text variant="text-sm/normal" color="text-subtle">{n}</Text></li>)}</ul>
                            </li>
                        ))}
                    </ol>
                ) : (
                    <Text tag="p" variant="text-sm/normal" color="text-muted">{t(`store.noChangelog.${kind}`)}</Text>
                )}
            </section>

            {kind === "plugin" && <ReviewsSection id={entry.id} headingId={`${headingId}-reviews`} />}
            {page && page.related.length > 0 && <RelatedPlugins ids={page.related} onOpen={onOpen} />}

            <ReportRow kind={kind} id={entry.id} name={entry.name} version={item.installedVersion ?? entry.version} />
        </article>
    );
}

/** Their Discord avatar, or Discord's default one for their account */
/** A verified author: who they are, where to find them, and what they've published here */
function AuthorView({ kind, profile, items, backLabel, onBack, onOpen, onAuthor }: {
    kind: StoreKind;
    profile: AuthorProfile;
    items: Item[];
    backLabel: string;
    onBack(): void;
    onOpen(id: string): void;
    /** Another author of one of these, for plugins made together */
    onAuthor(slug: string): void;
}) {
    const site = useStore(Store.subscribe, Store.getSnapshot).authorSite;
    const headingId = `dl-store-author-${profile.slug}`;
    const link = (href: string, icon: "github" | "link", label: string) => (
        <a className="dl-store-source" href={href} target="_blank" rel="noreferrer noopener"><Icon name={icon} size={16} />{label}</a>
    );
    const Many = t(`tabs.${kind}s`);
    // Pinned ones first, in the author's order
    const pinned = profile.pinned ?? [];
    const ordered = [...items].sort((a, b) => (pinned.indexOf(a.entry.id) + 1 || Infinity) - (pinned.indexOf(b.entry.id) + 1 || Infinity));
    const facts = [
        t(profile.verified ? "store.verifiedAuthor" : "store.author"),
        t(`store.inStore.${kind}`, { count: items.length }),
        profile.followers ? t("community.followers", { count: profile.followers }) : undefined,
        profile.installs ? t("community.authorInstalls", { count: profile.installs }) : undefined,
    ].filter(Boolean).join(" · ");

    return (
        <article className="dl-tab dl-store-detail" aria-labelledby={headingId} data-store-author={profile.slug}>
            <div>
                <Button icon="chevronLeft" onClick={onBack}>{backLabel}</Button>
            </div>

            {profile.banner && <AuthorBanner url={profile.banner} />}
            <header className="dl-store-detail-head">
                <img className="dl-author-avatar" src={discordAvatarUrl(profile.userId, profile.avatar, 64)} alt="" width={64} height={64} />
                <div className="dl-store-detail-title">
                    <div className="dl-row-title">
                        <Text tag="h2" variant="heading-xl/bold" color="text-strong" id={headingId}>{profile.name}</Text>
                        {profile.verified && <VerifiedCheck size={18} />}
                    </div>
                    <Text variant="text-sm/normal" color="text-subtle" tabular>{facts}</Text>
                </div>
                <div className="dl-row-controls"><FollowButton profile={profile} /></div>
            </header>

            {profile.bio && <Text tag="p" variant="text-md/normal" color="text-default" className="dl-store-detail-desc">{profile.bio}</Text>}

            <div className="dl-author-links">
                {profile.links.github && link(profile.links.github, "github", "GitHub")}
                {profile.links.site && link(profile.links.site, "link", t("store.website"))}
                {site && link(authorPageUrl(site, profile.slug), "link", t("store.viewOnSite"))}
            </div>

            <section className="dl-stack" aria-labelledby={`${headingId}-items`}>
                <Text tag="h3" variant="heading-md/semibold" color="text-strong" id={`${headingId}-items`}>{Many}</Text>
                {items.length ? (
                    <ul className="dl-store-grid" aria-label={t(`store.byAuthor.${kind}`, { name: profile.name })}>
                        {ordered.map(i => <StoreCard key={i.entry.id} item={i} pinned={pinned.includes(i.entry.id)} onOpen={() => onOpen(i.entry.id)} onAuthor={onAuthor} />)}
                    </ul>
                ) : (
                    <Text tag="p" variant="text-sm/normal" color="text-muted">{t(`store.noneFromAuthor.${kind}`, { name: profile.name })}</Text>
                )}
            </section>
        </article>
    );
}

/** A plugin shared in chat (evi.rest/p/<id>): the card Evi draws under the message, in place of Discord's embed */
export function SharedPluginCard({ id }: { id: string; }) {
    const state = useStoreState();
    const item = itemsOf("plugin").find(i => i.entry.id === id);
    if (!item) {
        const loading = state.status === "idle" || state.status === "loading";
        return (
            <div className="dl-share-card" data-empty="">
                <Glyph name="?" />
                <Text variant="text-sm/normal" color="text-muted">{t(loading ? "share.loading" : "share.missing")}</Text>
            </div>
        );
    }
    return <SharedPluginItem item={item} />;
}

function SharedPluginItem({ item }: { item: Item; }) {
    const { entry } = item;
    const { buttons, confirm } = useItemActions(item);
    const open = () => {
        openStore("plugin", entry.id);
        SettingsUI.open("plugins");
    };
    return (
        <div className="dl-share-card" data-store-id={entry.id} data-supporters={item.supportersOnly || undefined}>
            <Text variant="text-xs/semibold" color="text-muted" className="dl-share-kicker">{t("share.kicker")}</Text>
            <div className="dl-store-card-top">
                <Glyph name={entry.name} />
                <div className="dl-store-card-title">
                    <Text tag="h3" variant="text-md/semibold" color="text-strong">
                        <button type="button" className="dl-link-button" onClick={open}>{entry.name}</button>
                    </Text>
                    <Text variant="text-xs/normal" color="text-muted" tabular>v{entry.version} · {t("store.byAuthors", { authors: entry.authors.join(", ") })}</Text>
                </div>
            </div>
            {entry.description && <Text tag="p" variant="text-sm/normal" color="text-subtle" className="dl-store-card-desc">{entry.description}</Text>}
            {(item.native || !item.official || item.supportersOnly) && (
                <div className="dl-store-card-tags">
                    {item.supportersOnly && <SupportersPill />}
                    {!item.official && <CommunityLabel />}
                    {item.native && <Badge tone="warning">{t("plugins.badge.native")}</Badge>}
                </div>
            )}
            {item.locked && <p className="dl-store-trust" id={`dl-store-locked-${entry.id}`}><Icon name="heart" size={16} /><span>{t("community.supportersOnlyHint")}</span></p>}
            <div className="dl-store-card-foot">
                <span className="dl-store-status" role="status"><ItemStatus item={item} short /></span>
                <div className="dl-row-controls"><Button onClick={open}>{t("share.view")}</Button>{buttons}</div>
            </div>
            {confirm}
        </div>
    );
}

/** Copies a plugin's share link: Evi users get an install card in chat, everyone else evi.rest's page */
function CopyShareLink({ id }: { id: string; }) {
    const [copied, setCopied] = React.useState(false);
    const copy = () => void navigator.clipboard.writeText(sharePluginUrl(id)).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    });
    return <Button icon="link" onClick={copy}>{t(copied ? "share.copied" : "share.copy")}</Button>;
}

/** "Supporters", in the gold of the supporter trophies */
function SupportersPill() {
    return <span className="dl-supporters-pill"><Icon name="heart" size={12} />{t("community.supportersOnly")}</span>;
}

/** A supporter plugin's page: a thank-you when you support Evi, the way in when you don't */
function SupportersBanner({ locked, id }: { locked: boolean; id: string; }) {
    return (
        <section className="dl-supporters-banner" data-locked={locked || undefined} aria-labelledby={`dl-supporters-${id}`}>
            <span className="dl-supporters-banner-icon" aria-hidden="true"><Icon name="heart" size={20} /></span>
            <div className="dl-supporters-banner-text">
                <Text tag="h3" variant="text-md/semibold" color="text-strong" id={`dl-supporters-${id}`}>{t(locked ? "supporters.bannerLockedTitle" : "supporters.bannerTitle")}</Text>
                <Text tag="p" variant="text-sm/normal" color="text-subtle" id={locked ? `dl-store-locked-${id}` : undefined}>{t(locked ? "community.supportersOnlyHint" : "supporters.bannerThanks")}</Text>
            </div>
            {locked && <Button variant="accent" onClick={() => { showTab("general", "account"); SettingsUI.open("general"); }}>{t("supporters.become")}</Button>}
        </section>
    );
}
