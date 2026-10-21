import { Components, definePlugin, Dispatcher, filters, findStore, React } from "@evi/api";
import type { FluxAction, HookContext, PluginContext } from "@evi/api";

import { t } from "./strings";
import {
    CAP, countByFilter, decide, Filter, FILTERS, filterEntries, KINDS, KnownUser, missedChanges, notification, NotificationKind, NotificationLog, OFFLINE_WORDING,
    paginate, parseHistory, parseSnapshot, parseTime, RelationshipNotification, RelationshipType, Scope, settleSnapshot, Snapshot, storedHistory, storeLookup, Tracker,
    unansweredRequests,
} from "./events";

/**
 * Tells you when someone removes you as a friend, declines your friend request, accepts it or leaves
 * it unanswered for a week, or removes you from a group DM or server. No source patches, and no
 * requests to Discord's API: everything is read from what the client already has.
 *
 * - A "before" hook on Dispatcher.dispatch sees each action before any store applies it, so the
 *   friend, group or server is still in the stores and its name can be shown. A request you sent
 *   turning into a friendship (RELATIONSHIP_ADD/UPDATE while the store still says outgoing) is an
 *   accepted request.
 * - Things you do yourself go through Discord's action creators (removeFriend, leaveGuild,
 *   closePrivateChannel...). Those are hooked to mark the id as yours, and never reported.
 * - Unanswered requests: RelationshipStore's "since" for each outgoing request, checked on connect
 *   and hourly. Each is reported once; the ids are kept until the request goes away.
 * - While offline: your friends, sent requests and servers (ids and names, for your account only)
 *   are kept in this plugin's settings, saved 5 seconds after they change and on disconnect. On
 *   CONNECTION_OPEN (Discord starting, a reconnect) whatever's gone since is reported.
 * - History: the last 500, newest first, kept in this plugin's settings under a key the settings
 *   panel doesn't show, unless "Keep history" is off (then memory only, like before 1.2.0).
 *
 * Blocks can't be told apart: Discord removes the friendship or the request either way and says
 * nothing more, so the texts say so instead of guessing.
 */

const settings = {
    friendRemoved: { type: "boolean", get label() { return t("settings.friendRemoved"); }, get description() { return t("settings.friendRemoved.description"); }, default: true },
    requestCancelled: { type: "boolean", get label() { return t("settings.requestCancelled"); }, get description() { return t("settings.requestCancelled.description"); }, default: true },
    requestAccepted: { type: "boolean", get label() { return t("settings.requestAccepted"); }, get description() { return t("settings.requestAccepted.description"); }, default: true },
    requestUnanswered: { type: "boolean", get label() { return t("settings.requestUnanswered"); }, get description() { return t("settings.requestUnanswered.description"); }, default: true },
    groupRemoved: { type: "boolean", get label() { return t("settings.groupRemoved"); }, get description() { return t("settings.groupRemoved.description"); }, default: true },
    serverRemoved: { type: "boolean", get label() { return t("settings.serverRemoved"); }, get description() { return t("settings.serverRemoved.description"); }, default: true },
    showToasts: { type: "boolean", get label() { return t("settings.showToasts"); }, get description() { return t("settings.showToasts.description"); }, default: true },
    whileOffline: { type: "boolean", get label() { return t("settings.whileOffline"); }, get description() { return t("settings.whileOffline.description"); }, default: true },
    keepHistory: { type: "boolean", get label() { return t("settings.keepHistory"); }, get description() { return t("settings.keepHistory.description"); }, default: true },
} as const satisfies Record<NotificationKind | "showToasts" | "whileOffline" | "keepHistory", unknown>;

type Ctx = PluginContext<typeof settings>;

/** This plugin's settings entry also keeps its data, under keys that aren't settings */
type Storage = { get(key: string): unknown; set(key: string, value: unknown): void; };
const HISTORY = "history";
const SNAPSHOT = "snapshot";
const UNANSWERED = "unanswered";

const TYPES = new Set(["RELATIONSHIP_REMOVE", "RELATIONSHIP_ADD", "RELATIONSHIP_UPDATE", "CHANNEL_DELETE", "CHANNEL_RECIPIENT_REMOVE", "GUILD_DELETE"]);
/** What changes the snapshot */
const SNAPSHOT_TYPES = ["RELATIONSHIP_ADD", "RELATIONSHIP_UPDATE", "RELATIONSHIP_REMOVE", "GUILD_CREATE", "GUILD_UPDATE", "GUILD_DELETE"];
const SAVE_DELAY = 5000;
const HOUR = 60 * 60 * 1000;
/** Toasts for one batch (changes while offline, unanswered requests): the last one sums up the rest */
const TOASTS_PER_BATCH = 3;

let active: { log: NotificationLog; ctx: Ctx; } | undefined;

function store(name: string): any {
    try {
        return findStore(name);
    } catch {
        return undefined;
    }
}

/** RelationshipStore's relationships (a Map of id to type) as entries */
const relationshipsOf = (all: any): Iterable<[string, number]> => typeof all?.entries === "function" ? all.entries() : Object.entries(all ?? {});

/** Hooks each of `methods` that exists on the export, marking its first argument as your own action */
function markOwn(ctx: Ctx, tracker: Tracker, props: string[], methods: string[], scope: Scope) {
    ctx.waitFor(filters.byProps(...props), module => {
        for (const method of methods) {
            if (typeof module?.[method] !== "function") continue;
            ctx.hook.before(module, method, ({ args }: HookContext) => {
                const id = args[0];
                if (typeof id === "string") tracker.markSelf(scope, id);
            });
        }
    });
}

/** Your friends, sent requests and servers right now, or undefined before Discord has them */
function takeSnapshot(): Snapshot | undefined {
    const user: string | undefined = store("UserStore")?.getCurrentUser?.()?.id;
    const all = store("RelationshipStore")?.getMutableRelationships?.();
    const guilds = store("GuildStore")?.getGuilds?.();
    if (!user || !all || !guilds) return undefined;
    const lookup = storeLookup(store);
    const snapshot: Snapshot = { user, at: Date.now(), friends: {}, requests: {}, servers: {} };
    for (const [id, type] of relationshipsOf(all)) {
        if (type !== RelationshipType.FRIEND && type !== RelationshipType.OUTGOING) continue;
        const known: KnownUser = { name: lookup.userName(id) ?? `User ${id}` };
        const username = lookup.username?.(id);
        // Only when it adds something: the snapshot is kept for every friend
        if (username && username !== known.name) known.username = username;
        if (type === RelationshipType.OUTGOING) {
            snapshot.requests[id] = known;
            continue;
        }
        const since = lookup.since?.(id);
        if (since !== undefined) known.since = since;
        snapshot.friends[id] = known;
    }
    for (const guild of Object.values<any>(guilds)) if (typeof guild?.id === "string" && typeof guild.name === "string") snapshot.servers[guild.id] = guild.name;
    return snapshot;
}

/** What the toast and log say, in Discord's language (the entry keeps its English text) */
const textOf = (entry: RelationshipNotification) => entry.offlineSince !== undefined && OFFLINE_WORDING.has(entry.kind)
    ? t(`offline.${entry.kind as "friendRemoved" | "requestCancelled" | "serverRemoved"}`, { name: entry.name })
    : t(`text.${entry.kind}`, { name: entry.name });

/** "While you were offline", "Friends since 3 Mar 2024" */
function detailsOf(entry: RelationshipNotification) {
    const details: string[] = [];
    if (entry.offlineSince !== undefined) details.push(t("log.offline"));
    if (entry.since !== undefined) details.push(t("log.friendsSince", { date: new Date(entry.since).toLocaleDateString([], { dateStyle: "medium" }) }));
    return details.join(" · ");
}

function formatTime(ms: number) {
    const date = new Date(ms);
    return date.toDateString() === new Date().toDateString()
        ? date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
        : date.toLocaleString([], { dateStyle: "short", timeStyle: "short" });
}

function SmallButton({ children, onClick, disabled, danger }: { children: React.ReactNode; onClick(): void; disabled?: boolean; danger?: boolean; }) {
    const Button = Components.Button as any;
    return Button
        ? <Button color={danger ? Button.Colors?.RED : Button.Colors?.PRIMARY} size={Button.Sizes?.SMALL} disabled={disabled} onClick={onClick}>{children}</Button>
        : <button type="button" className="dl-button" disabled={disabled} onClick={onClick}>{children}</button>;
}

function LogPanel({ log, ctx }: { log: NotificationLog; ctx: Ctx; }) {
    const entries = React.useSyncExternalStore(log.subscribe, () => log.entries);
    const { keepHistory } = ctx.settings.use();
    const [filter, setFilter] = React.useState<Filter>("all");
    const [query, setQuery] = React.useState("");
    const [page, setPage] = React.useState(0);
    // Clearing 500 kept entries takes a second click
    const [armed, setArmed] = React.useState(false);
    React.useEffect(() => {
        if (!armed) return;
        const handle = setTimeout(() => setArmed(false), 4000);
        return () => clearTimeout(handle);
    }, [armed]);

    const counts = React.useMemo(() => countByFilter(entries), [entries]);
    const shown = React.useMemo(() => filterEntries(entries, filter, query), [entries, filter, query]);
    const paged = paginate(shown, page);
    const show = (next: Filter) => {
        setFilter(next);
        setPage(0);
    };
    const clear = () => {
        if (!armed) return setArmed(true);
        setArmed(false);
        setPage(0);
        log.clear();
    };

    return (
        <div>
            <div className="dl-field-row">
                <div className="dl-field-text">
                    <div className="dl-label">{t("log.title")}</div>
                    <p className="dl-hint" role="status">
                        {entries.length ? t("log.count", { count: entries.length }) : t("log.empty")} {keepHistory ? t("log.kept") : t("log.memory")}
                    </p>
                </div>
                <SmallButton danger disabled={!entries.length} onClick={clear}>{armed ? t("log.confirm") : t("log.clear")}</SmallButton>
            </div>
            {entries.length > 0 && (
                <>
                    <input
                        className="dl-input"
                        type="search"
                        placeholder={t("log.search")}
                        aria-label={t("log.search")}
                        autoComplete="off"
                        spellCheck={false}
                        value={query}
                        onChange={e => {
                            setQuery(e.currentTarget.value);
                            setPage(0);
                        }}
                    />
                    <div role="group" aria-label={t("log.filters")} style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", margin: "0.5rem 0" }}>
                        {FILTERS.filter(f => f === "all" || f === filter || counts[f] > 0).map(f => (
                            <button key={f} type="button" className="dl-chip" aria-pressed={filter === f} onClick={() => show(f)}>
                                {t(`filter.${f}`)}<span>{counts[f]}</span>
                            </button>
                        ))}
                    </div>
                    {shown.length ? (
                        <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                            {paged.items.map(entry => {
                                const details = detailsOf(entry);
                                return (
                                    <li key={`${entry.at}-${entry.kind}-${entry.id}`} className="dl-hint" style={{ padding: "0.125rem 0" }}>
                                        <time dateTime={new Date(entry.at).toISOString()} style={{ fontVariantNumeric: "tabular-nums", marginInlineEnd: "0.5rem" }}>
                                            {formatTime(entry.at)}
                                        </time>
                                        {textOf(entry)}
                                        {details && ` · ${details}`}
                                    </li>
                                );
                            })}
                        </ul>
                    ) : <p className="dl-hint">{t("log.noMatch")}</p>}
                    {paged.pages > 1 && (
                        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginTop: "0.5rem" }}>
                            <SmallButton disabled={paged.page === 0} onClick={() => setPage(paged.page - 1)}>{t("log.previous")}</SmallButton>
                            <span className="dl-hint" aria-live="polite" style={{ margin: 0, fontVariantNumeric: "tabular-nums" }}>
                                {t("log.page", { page: paged.page + 1, pages: paged.pages })}
                            </span>
                            <SmallButton disabled={paged.page >= paged.pages - 1} onClick={() => setPage(paged.page + 1)}>{t("log.next")}</SmallButton>
                        </div>
                    )}
                </>
            )}
        </div>
    );
}

export default definePlugin({
    settings,

    start(ctx) {
        const kept = ctx.settings as unknown as Storage;
        if (!ctx.settings.get("keepHistory") && kept.get(HISTORY) !== undefined) kept.set(HISTORY, undefined);
        if (!ctx.settings.get("whileOffline") && kept.get(SNAPSHOT) !== undefined) kept.set(SNAPSHOT, undefined);

        const log = new NotificationLog(CAP, ctx.settings.get("keepHistory") ? parseHistory(kept.get(HISTORY)) : []);
        const tracker = new Tracker();
        const runtime = { log, ctx };
        active = runtime;
        log.subscribe(() => {
            if (ctx.settings.get("keepHistory")) kept.set(HISTORY, storedHistory(log.entries));
        });

        markOwn(ctx, tracker, ["removeRelationship", "addRelationship"], ["removeRelationship", "removeFriend", "cancelFriendRequest", "blockUser"], "relationship");
        markOwn(ctx, tracker, ["leaveGuild"], ["leaveGuild", "deleteGuild"], "guild");
        markOwn(ctx, tracker, ["closePrivateChannel"], ["closePrivateChannel"], "channel");

        /** Logs what's switched on and toasts it. A batch toasts a few, then sums up the rest in one. */
        const report = (entries: RelationshipNotification[]) => {
            const added = entries.filter(entry => ctx.settings.get(entry.kind) && log.add(entry));
            if (!added.length || !ctx.settings.get("showToasts")) return;
            const toasted = added.length > TOASTS_PER_BATCH ? added.slice(0, TOASTS_PER_BATCH - 1) : added;
            for (const entry of toasted) ctx.toast(textOf(entry), { type: "info", duration: 6000 });
            if (added.length > toasted.length) ctx.toast(t("toast.more", { count: added.length - toasted.length }), { type: "info", duration: 6000 });
        };

        // Before any store applies the action, so names are still there. Reported once the dispatch
        // is done: saving the history notifies settings subscribers, which shouldn't run inside it.
        ctx.hook.before(Dispatcher, "dispatch", ({ args }: HookContext) => {
            const action = args[0] as FluxAction;
            if (!action || !TYPES.has(action.type)) return;
            try {
                const entry = decide(action, storeLookup(store), tracker);
                if (entry) queueMicrotask(() => void (active === runtime && report([entry])));
            } catch (e) {
                ctx.logger.error("Couldn't check", action.type, e);
            }
        });

        // Snapshots are only taken while connected: before READY the stores can be empty or cached
        let online = !!store("GatewayConnectionStore")?.isConnected?.();
        let pendingSave: ReturnType<typeof setTimeout> | undefined;
        /** The saved snapshot's contents, so an unchanged one isn't written again */
        let lastSaved: string | undefined;
        const unavailable = (id: string) => !!store("GuildAvailabilityStore")?.isUnavailable?.(id);

        const saveSnapshot = (now = takeSnapshot(), stillThere = unavailable) => {
            clearTimeout(pendingSave);
            pendingSave = undefined;
            if (!online || !now || !ctx.settings.get("whileOffline")) return;
            const settled = settleSnapshot(parseSnapshot(kept.get(SNAPSHOT)), now, stillThere);
            const { at: _at, ...contents } = settled;
            const key = JSON.stringify(contents);
            if (key === lastSaved) return;
            lastSaved = key;
            kept.set(SNAPSHOT, settled);
        };
        const scheduleSave = () => {
            if (!online || !ctx.settings.get("whileOffline")) return;
            clearTimeout(pendingSave);
            pendingSave = setTimeout(() => saveSnapshot(), SAVE_DELAY);
        };
        const flushSnapshot = () => void (pendingSave !== undefined && saveSnapshot());

        /** Reports what's gone since the saved snapshot, then saves the new one. `listed`: servers READY listed. */
        const catchUp = (listed?: ReadonlySet<string>) => {
            if (!ctx.settings.get("whileOffline")) return;
            const now = takeSnapshot();
            if (!now) return;
            const stillThere = (id: string) => !!listed?.has(id) || unavailable(id);
            report(missedChanges(parseSnapshot(kept.get(SNAPSHOT)), now, Date.now(), stillThere));
            lastSaved = undefined;
            saveSnapshot(now, stillThere);
        };

        const checkUnanswered = () => {
            if (!online || !ctx.settings.get("requestUnanswered")) return;
            const relationships = store("RelationshipStore");
            const all = relationships?.getMutableRelationships?.();
            if (!all) return;
            const sinces = relationships.getSinces?.() ?? {};
            const outgoing = [...relationshipsOf(all)].filter(([, type]) => type === RelationshipType.OUTGOING).map(([id]) => [id, parseTime(sinces[id])] as const);
            const stored = kept.get(UNANSWERED);
            const reported = new Set(Array.isArray(stored) ? stored.filter((id): id is string => typeof id === "string") : []);
            const now = Date.now();
            const { due, remember } = unansweredRequests(outgoing, reported, now);
            if (due.length || remember.length !== reported.size) kept.set(UNANSWERED, remember);
            const lookup = storeLookup(store);
            report(due.map(id => notification({ kind: "requestUnanswered", id, name: lookup.userName(id) ?? `User ${id}`, username: lookup.username?.(id), at: now })));
        };

        for (const type of SNAPSHOT_TYPES) ctx.flux.subscribe(type, scheduleSave);
        ctx.flux.subscribe("CONNECTION_OPEN", (action: FluxAction) => {
            const listed = new Set<string>((Array.isArray(action.guilds) ? action.guilds : []).map((guild: any) => guild?.id).filter((id: unknown) => typeof id === "string"));
            // Once every store has READY
            queueMicrotask(() => {
                if (active !== runtime) return;
                online = true;
                catchUp(listed);
                checkUnanswered();
            });
        });
        // What you had when the connection dropped is what a reconnect is compared with
        ctx.flux.subscribe("CONNECTION_CLOSED", () => {
            flushSnapshot();
            online = false;
        });
        addEventListener("beforeunload", flushSnapshot);
        ctx.onDispose(() => {
            removeEventListener("beforeunload", flushSnapshot);
            flushSnapshot();
            if (active === runtime) active = undefined;
        });
        ctx.setInterval(checkUnanswered, HOUR);

        let previous = ctx.settings.all;
        ctx.settings.onChange(values => {
            if (values.keepHistory !== previous.keepHistory) kept.set(HISTORY, values.keepHistory ? storedHistory(log.entries) : undefined);
            if (values.whileOffline !== previous.whileOffline) {
                lastSaved = undefined;
                if (values.whileOffline) saveSnapshot();
                else {
                    clearTimeout(pendingSave);
                    pendingSave = undefined;
                    kept.set(SNAPSHOT, undefined);
                }
            }
            if (values.requestUnanswered && !previous.requestUnanswered) checkUnanswered();
            previous = values;
        });

        // Started while Discord is already connected (turned on, or reloaded)
        if (online) {
            catchUp();
            checkUnanswered();
        }

        ctx.command({
            name: "relationships",
            get description() { return t("command.description"); },
            options: [
                {
                    name: "show",
                    get description() { return t("command.option.show"); },
                    choices: KINDS.map(kind => ({ get name() { return t(`filter.${kind}`); }, value: kind })),
                },
                { name: "search", get description() { return t("command.option.search"); } },
                { name: "page", get description() { return t("command.option.page"); }, type: "integer" },
            ],
            execute(args) {
                const entries = log.entries;
                if (!entries.length) return { ephemeral: t("command.empty") };
                const filter: Filter = (FILTERS as readonly string[]).includes(args.show) ? args.show : "all";
                const shown = filterEntries(entries, filter, typeof args.search === "string" ? args.search : "");
                if (!shown.length) return { ephemeral: t("command.noMatch") };
                const paged = paginate(shown, (Number(args.page) || 1) - 1);
                const lines = paged.items.map(e => `${formatTime(e.at)}  ${textOf(e)}`);
                if (paged.pages > 1) lines.unshift(t("command.page", { page: paged.page + 1, pages: paged.pages }));
                return { ephemeral: lines.join("\n") };
            },
        });
    },

    settingsPanel: () => active && <LogPanel log={active.log} ctx={active.ctx} />,

    /** The running plugin's log, for tests and debugging */
    getLog: () => active?.log,
});
