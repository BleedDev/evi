import { MAX_REPORT_CHARS } from "@shared/crashReports";
import { healthWarns, PluginHealth } from "@shared/health";
import { isPluginEnabled } from "@shared/ipc";
import { keybindConflict, KeybindOwner, matchesPlugin, matchingSettings, normalizeQuery, SearchablePlugin } from "@shared/pluginSearch";

import { buildCrashReport, copyText, discordBuild } from "../crashReport";
import { t } from "../i18n";
import { Native } from "../native";
import { getPatchRecords } from "../patching/source";
import { diagnoseLookups, isLookupProblem } from "../plugins/lookups";
import { PluginManager, PluginState } from "../plugins/manager";
import { SafeMode } from "../safeMode";
import { crashKey, fitReport } from "../sentReports";
import { Settings } from "../settings";
import { Store } from "../store";
import { React } from "../webpack/common";
import { Badge, Button, Dialog, Icon, Dropdown, EmptyState, IconButton, Notice, Pagination, scrollToTop, SearchField, SettingField, Status, Switch, Text, usePages, useStore } from "./components";
import { openStore, PluginTarget, showTab, subscribeTabs, takePluginTarget } from "./nav";
import { PluginDetailsButton } from "./PluginPermissions";
import { SafeModeNotice } from "./SafeModeNotice";
import { Glyph, healthLabel, useStoreState } from "./Store";
import { HotfixNote, PulledNotice } from "./Trust";

type Filter = "all" | "enabled" | "disabled" | "settings" | "dev" | "trouble";

/** A custom settings panel needs the running plugin's ctx, so it only counts while the plugin runs */
function hasSettings({ definition, ctx }: PluginState) {
    return !!definition && (Object.keys(definition.settings ?? {}).length > 0 || (!!definition.settingsPanel && !!ctx));
}

const filterTests: Record<Filter, (p: PluginState) => boolean> = {
    all: () => true,
    enabled: p => isPluginEnabled(Settings.data, p.manifest),
    disabled: p => !isPluginEnabled(Settings.data, p.manifest),
    settings: hasSettings,
    dev: p => p.source === "dev",
    trouble: p => !!troubleOf(p),
};

/** What the search looks at, here and in Discord's settings search (settingsSearch.ts) */
export const searchablePlugin = (p: PluginState): SearchablePlugin => ({
    name: p.manifest.name,
    description: p.manifest.description,
    id: p.manifest.id,
    authors: Store.authorsOf(p),
    settings: p.definition?.settings,
});

const matchesQuery = (p: PluginState, q: string) => matchesPlugin(searchablePlugin(p), q);

/** Every shortcut set in a turned-on plugin, to say when two plugins want the same keys */
function keybindOwners(): KeybindOwner[] {
    const owners: KeybindOwner[] = [];
    for (const p of PluginManager.getSnapshot()) {
        if (!isPluginEnabled(Settings.data, p.manifest)) continue;
        const stored = Settings.plugin(p.manifest.id).settings ?? {};
        for (const [key, def] of Object.entries(p.definition?.settings ?? {})) {
            if (def.type !== "keybind") continue;
            const value = key in stored ? String(stored[key] ?? "") : def.default;
            if (value) owners.push({ pluginId: p.manifest.id, pluginName: p.manifest.name, key, label: def.label, value });
        }
    }
    return owners;
}

/** What evi.rest knows about the version installed, when it's a problem (dev builds aren't the store's) */
function knownProblem(state: PluginState): PluginHealth | undefined {
    const known = state.source === "dev" ? undefined : Store.healthOf(state.manifest.id);
    return healthWarns(known, Store.installedPlugin(state.manifest.id)?.version ?? state.manifest.version) ? known : undefined;
}

/** Parts of Discord the running plugin waited for that never showed up */
const lookupProblemsOf = (state: PluginState) => state.running ? diagnoseLookups(state.manifest.id).filter(d => isLookupProblem(d.health)) : [];

interface Trouble {
    tone: "danger" | "warning";
    title: string;
    body?: string;
    /** It's what evi.rest knows, so the banner already says what the card's note would */
    reported?: boolean;
}

/**
 * Why a plugin isn't working, worst first: it didn't start, its patches don't apply, it can't find
 * parts of Discord, or other installs report it broken. Undefined for a plugin that works. Runtime
 * problems only count while it's on; what evi.rest knows counts either way, so you hear it before
 * turning one on. A pulled version has its own notice (PulledNotice), so it gets no text here.
 */
function troubleOf(state: PluginState, lookups = lookupProblemsOf(state), health = knownProblem(state)): Trouble | undefined {
    if (state.pulled) return { tone: "danger", title: "" };
    const enabled = isPluginEnabled(Settings.data, state.manifest);
    if (enabled && state.error) return { tone: "danger", title: t("plugins.trouble.start"), body: t("plugins.trouble.startBody") };
    const patches = enabled ? getPatchRecords(state.manifest.id) : [];
    if (patches.some(r => r.state === "failed" || r.state === "partial")) return { tone: "danger", title: t("health.brokenAuto"), body: t("plugins.trouble.patchesBody") };
    if (lookups.some(d => d.health === "broken")) return { tone: "danger", title: t("health.brokenAuto"), body: t("plugins.trouble.lookupsBody") };
    if (health) {
        // Whoever set it said why (the author, or Evi's team); otherwise it's installs reporting it
        const body = health.message
            ? `${health.setBy ? `${health.setBy}: ` : ""}${health.message}`
            : t(health.state === "investigating" ? "plugins.trouble.investigatingBody" : "plugins.trouble.reportedBody");
        return { tone: health.state === "investigating" ? "warning" : "danger", title: healthLabel(health), body, reported: true };
    }
    if (lookups.length) return { tone: "warning", title: t("plugins.trouble.missing"), body: t("plugins.trouble.missingBody") };
}

/** The first thing a card says when its plugin isn't working, so a broken plugin can't pass for a working one */
function TroubleBanner({ trouble, updateReady }: { trouble: Trouble; updateReady: boolean; }) {
    return (
        <div className="dl-plugin-trouble" data-tone={trouble.tone}>
            <Icon name={trouble.tone === "danger" ? "circleError" : "warning"} size={20} />
            <div className="dl-plugin-trouble-text">
                <Text variant="text-sm/semibold" color="text-strong">{trouble.title}</Text>
                {trouble.body && <Text tag="p" variant="text-sm/normal" color="text-default">{trouble.body}</Text>}
                {updateReady && <Text tag="p" variant="text-sm/medium" color="text-strong">{t("plugins.trouble.updateMayFix")}</Text>}
            </div>
        </div>
    );
}

function PluginSettings({ state, highlight = [] }: { state: PluginState; highlight?: string[]; }) {
    const { definition, ctx, manifest } = state;
    const schema = definition?.settings ?? {};
    // Re-render on any settings change
    useStore(Settings.subscribe, () => Settings.data);
    const stored = Settings.plugin(manifest.id).settings ?? {};

    const set = (key: string, value: unknown) => Settings.update(d => {
        ((d.plugins[manifest.id] ??= {}).settings ??= {})[key] = value;
    });

    return (
        <div className="dl-row-settings">
            {Object.entries(schema).map(([key, def]) => {
                const field = (
                    <SettingField
                        key={key}
                        id={`dl-setting-${manifest.id}-${key}`}
                        definition={def}
                        value={key in stored ? stored[key] : def.default}
                        onChange={v => set(key, v)}
                        keybindUsedBy={value => keybindConflict(keybindOwners(), value, { pluginId: manifest.id, key })}
                    />
                );
                if (!highlight.includes(key)) return field;
                // The dialog opens on the first setting the search found
                return <div key={key} className="dl-setting-match" data-dialog-start={key === highlight[0] ? "" : undefined}>{field}</div>;
            })}
            {ctx && definition?.settingsPanel?.(ctx)}
        </div>
    );
}

function SettingsDialog({ state, highlight, onClose }: { state: PluginState; highlight: string[]; onClose(): void; }) {
    return (
        <Dialog id={`dl-plugin-${state.manifest.id}-settings`} title={t("plugins.settingsOf", { name: state.manifest.name })} onClose={onClose}>
            <PluginSettings state={state} highlight={highlight} />
        </Dialog>
    );
}

/** Crash reports sent this session, to who: the same crash isn't sent twice */
const sentCrashes = new Map<string, string>();

/** Everything needed to hand a failing plugin's problem to its author, one click to copy */
function CrashReport({ state }: { state: PluginState; }) {
    const [copied, setCopied] = React.useState<"copied" | "failed">();
    const copy = () => copyText(buildCrashReport(state)).then(() => setCopied("copied"), () => setCopied("failed"));
    // Store plugins only: evi.rest finds their author from the registry
    const installed = Store.installedPlugin(state.manifest.id);
    const entry = Store.getSnapshot().plugins.find(p => p.id === state.manifest.id);
    const version = installed?.version ?? state.manifest.version;
    const canSend = !!installed?.fromStore && !!entry && !!version && !!Native.sendCrashReport;

    return (
        <div className="dl-toolbar dl-crash">
            <Button icon="copy" onClick={copy}>{t("crash.copy")}</Button>
            {canSend && <SendToAuthor state={state} version={version!} author={entry!.authors.join(", ")} />}
            <span role="status">
                {copied === "copied" && <Status tone="success">{t("crash.copied", { name: state.manifest.name })}</Status>}
                {copied === "failed" && <Status tone="danger">{t("crash.clipboardFailed")}</Status>}
            </span>
        </div>
    );
}

/** The same report as Copy, sent to the plugin's author through evi.rest after showing exactly what goes */
function SendToAuthor({ state, version, author }: { state: PluginState; version: string; author: string; }) {
    const { id } = state.manifest;
    const [asking, setAsking] = React.useState<string>();
    const [dontAsk, setDontAsk] = React.useState(false);
    const [sending, setSending] = React.useState(false);
    const [error, setError] = React.useState<string>();
    const report = () => fitReport(buildCrashReport(state), MAX_REPORT_CHARS);
    const sentTo = sentCrashes.get(crashKey(id, version, report()));

    const send = async (text: string) => {
        setAsking(undefined);
        if (dontAsk) Settings.update(d => void (d.crashReportConsent = true));
        setSending(true);
        setError(undefined);
        const result = await Native.sendCrashReport({ plugin: id, version, eviVersion: EVI_VERSION, discordBuild: discordBuild(), report: text })
            .catch(err => ({ ok: false as const, error: String(err) }));
        if (result.ok) sentCrashes.set(crashKey(id, version, text), result.author ?? author);
        else setError(result.error);
        setSending(false);
    };
    const start = () => {
        const text = report();
        if (Settings.data.crashReportConsent) void send(text);
        else setAsking(text);
    };

    return (
        <>
            <Button disabled={sending || !!sentTo} onClick={start}>{sentTo ? t("crash.sent") : sending ? t("common.sending") : t("crash.sendToAuthor")}</Button>
            <span role="status">
                {sentTo && <Status tone="success">{t("crash.sentTo", { author: sentTo })}</Status>}
                {!sentTo && error && <Status tone="danger">{t("crash.sendFailed", { error })}</Status>}
            </span>
            {asking !== undefined && (
                <Dialog id={`dl-crash-send-${id}`} title={t("crash.confirmTitle", { author })} onClose={() => setAsking(undefined)}>
                    <div className="dl-stack">
                        <pre className="dl-crash-text" tabIndex={0} aria-label={t("crash.reportLabel")}>{asking}</pre>
                        <Text tag="p" variant="text-sm/normal" color="text-subtle">
                            {t("crash.confirmBody", { author })}
                        </Text>
                        <label className="dl-check">
                            <input type="checkbox" checked={dontAsk} onChange={e => setDontAsk(e.currentTarget.checked)} />
                            {t("common.dontAskAgain")}
                        </label>
                        <div className="dl-toolbar">
                            <Button variant="accent" onClick={() => void send(asking)}>{t("common.sendReport")}</Button>
                            <Button onClick={() => setAsking(undefined)}>{t("common.cancel")}</Button>
                        </div>
                    </div>
                </Dialog>
            )}
        </>
    );
}

/** Cards per page: six rows of two */
const PAGE_SIZE = 12;

function PluginCard({ state, query }: { state: PluginState; query: string; }) {
    const { manifest } = state;
    const [settingsOpen, setSettingsOpen] = React.useState(false);
    // Settings the search found, highlighted when the dialog opens from the card's link
    const [highlight, setHighlight] = React.useState<string[]>([]);
    const [confirmingUninstall, setConfirmingUninstall] = React.useState(false);
    const enabled = isPluginEnabled(Settings.data, manifest);
    const titleId = `dl-plugin-${manifest.id}`;
    const settingsId = `dl-plugin-${manifest.id}-settings`;
    const withSettings = hasSettings(state);
    const schema = state.definition?.settings ?? {};
    const matched = withSettings ? matchingSettings(schema, query) : [];
    const paused = SafeMode.active && enabled;

    const fromStore = !!Store.installedPlugin(manifest.id)?.fromStore;
    const action = Store.pluginAction(manifest.id);
    const entry = Store.getSnapshot().plugins.find(p => p.id === manifest.id);
    const op = Store.getSnapshot().ops[manifest.id];
    const busy = op?.type === "busy";
    const lookupProblems = lookupProblemsOf(state);
    const health = knownProblem(state);
    const trouble = troubleOf(state, lookupProblems, health);
    // Evi turned this version off everywhere: it can't run, and says why instead
    const { pulled } = state;
    const authors = Store.authorsOf(state);
    const removeLabel = fromStore ? t("common.uninstallName", { name: manifest.name }) : t("common.removeName", { name: manifest.name });
    const reloadNote = state.needsReload && state.reloadReason;

    // Full-access updates, and ones that ask for more, go through the plugin's store page, which asks first
    const update = () => entry?.native || Store.growthOf(manifest.id) ? openStore("plugin", manifest.id) : Store.install(manifest.id);

    return (
        <li className="dl-plugin-card" aria-labelledby={titleId} data-trouble={trouble?.tone}>
            <div className="dl-plugin-card-top">
                <Glyph name={manifest.name} />
                <div className="dl-plugin-card-title">
                    <div className="dl-row-title">
                        <Text tag="h3" variant="text-md/semibold" color="text-strong" id={titleId}>{manifest.name}</Text>
                        {state.source === "dev" && <Badge>{t("common.dev")}</Badge>}
                        {fromStore && <Badge>{t("common.store")}</Badge>}
                        {manifest.native && <Badge tone="warning">{t("plugins.badge.native")}</Badge>}
                    </div>
                    <Text variant="text-xs/normal" color="text-muted" tabular className="dl-plugin-card-byline">
                        {[manifest.version && `v${manifest.version}`, authors.length > 0 && t("common.by", { author: authors.join(", ") })].filter(Boolean).join(" · ")}
                    </Text>
                </div>
                {/* Off while pulled, whatever it's set to; the notice below says why */}
                <Switch checked={enabled && !pulled} disabled={!!pulled} labelledBy={titleId} onChange={v => PluginManager.setEnabled(manifest.id, v)} />
            </div>
            {trouble?.title && <TroubleBanner trouble={trouble} updateReady={action === "update"} />}
            {manifest.description && <Text tag="p" variant="text-sm/normal" color="text-subtle" className="dl-plugin-card-desc">{manifest.description}</Text>}
            {matched.length > 0 && (
                <Text tag="p" variant="text-sm/normal" color="text-subtle" className="dl-plugin-card-matches">
                    <Icon name="settings" size={14} />
                    <button
                        type="button"
                        className="dl-link-button"
                        onClick={() => {
                            setHighlight(matched);
                            setSettingsOpen(true);
                        }}
                    >
                        {t("plugins.matchingSettings", { names: matched.map(key => schema[key].label).join(", ") })}
                    </button>
                </Text>
            )}
            <div className="dl-plugin-card-foot">
                {/* Only what needs you: a plugin that just works says nothing */}
                <span className="dl-row-meta dl-grow" role="status">
                    {op?.type === "busy" && <Status tone="muted">{op.label}</Status>}
                    {op?.type === "error" && <Status tone="danger">{op.error}</Status>}
                    {op?.type === "done" && <Status tone="success">{op.message}</Status>}
                    {pulled && <Status tone="danger">{t("pulled.label")}</Status>}
                    {!op && !pulled && action === "update" && <Status tone="warning">{t("plugins.versionAvailable", { version: entry?.version ?? "" })}</Status>}
                    {state.needsReload && <Status tone="warning">{t("plugins.reloadToApply")}</Status>}
                    {paused && !pulled && <Status tone="muted">{t("plugins.pausedSafeMode")}</Status>}
                </span>
                <div className="dl-row-controls dl-plugin-card-actions">
                    {action === "update" && !pulled && <Button variant="accent" icon="download" disabled={busy} onClick={update}>{t("common.update")}</Button>}
                    {withSettings && (
                        <IconButton
                            icon="settings"
                            label={t("plugins.settingsOf", { name: manifest.name })}
                            aria-controls={settingsOpen ? settingsId : undefined}
                            onClick={() => {
                                setHighlight(matched);
                                setSettingsOpen(true);
                            }}
                        />
                    )}
                    <PluginDetailsButton state={state} />
                    <IconButton icon="trash" label={removeLabel} onClick={() => setConfirmingUninstall(true)} />
                </div>
            </div>
            {pulled && <PulledNotice pull={pulled} update={action === "update" && entry ? { version: entry.version, busy, run: update } : undefined} />}
            {state.error && <pre className="dl-error">{state.error}</pre>}
            {!state.error && lookupProblems.length > 0 && (
                <>
                    <Text tag="p" variant="text-sm/normal" color="text-subtle" className="dl-row-note">
                        {health && `${t("plugins.othersSeeing")} `}
                        {lookupProblems.some(d => d.health === "broken")
                            ? t("plugins.lookupsBroken")
                            : t("plugins.lookupsMissing")}
                    </Text>
                    {lookupProblems.map((d, i) => <pre key={i} className="dl-error">{d.target}</pre>)}
                </>
            )}
            {health?.message && !trouble?.reported && (
                <Text tag="p" variant="text-sm/normal" color="text-subtle" className="dl-row-note">{health.setBy ? `${health.setBy}: ` : ""}{health.message}</Text>
            )}
            {state.hotfix && enabled && !pulled && !health && <HotfixNote hotfix={state.hotfix} />}
            {(state.error || lookupProblems.length > 0) && <CrashReport state={state} />}
            {reloadNote && <Text tag="p" variant="text-sm/normal" color="text-subtle" className="dl-row-note">{t("plugins.couldntApplyLive", { reason: reloadNote })}</Text>}
            {confirmingUninstall && (
                <Dialog id={`dl-plugin-${manifest.id}-uninstall`} title={`${removeLabel}?`} onClose={() => setConfirmingUninstall(false)}>
                    {close => (
                        <div className="dl-stack">
                            <Text tag="p" variant="text-sm/normal" color="text-subtle">
                                {fromStore
                                    ? t("plugins.uninstallBody")
                                    : `${state.source === "dev" ? t("plugins.removeDev") : t("plugins.removeFiles")} ${entry ? t("plugins.removeStaysStore") : t("plugins.removeStays")}`}
                            </Text>
                            <div className="dl-toolbar">
                                <Button
                                    variant="danger"
                                    disabled={busy}
                                    onClick={() => {
                                        close();
                                        Store.uninstall(manifest.id);
                                    }}
                                >
                                    {fromStore ? t("common.uninstall") : t("common.remove")}
                                </Button>
                                <Button onClick={close}>{t("common.cancel")}</Button>
                            </div>
                        </div>
                    )}
                </Dialog>
            )}
            {withSettings && settingsOpen && <SettingsDialog state={state} highlight={highlight} onClose={() => setSettingsOpen(false)} />}
        </li>
    );
}

interface Undo {
    message: string;
    previous: Record<string, boolean>;
}

/** Turn everything off, or back to each plugin's default, with one-click undo */
function BulkActions({ plugins, onDone }: { plugins: PluginState[]; onDone(undo: Undo): void; }) {
    const [busy, setBusy] = React.useState(false);
    const enabledNow = plugins.filter(p => isPluginEnabled(Settings.data, p.manifest));
    const offDefault = plugins.filter(p => isPluginEnabled(Settings.data, p.manifest) !== (p.manifest.enabledByDefault ?? false));

    const apply = async (changes: [PluginState, boolean][], message: string) => {
        setBusy(true);
        const previous = Object.fromEntries(changes.map(([p]) => [p.manifest.id, isPluginEnabled(Settings.data, p.manifest)]));
        try {
            for (const [p, on] of changes) await PluginManager.setEnabled(p.manifest.id, on);
        } finally {
            setBusy(false);
        }
        onDone({ message, previous });
    };

    return (
        <div className="dl-bulk" role="group" aria-label={t("plugins.all")}>
            <Button
                disabled={busy || !enabledNow.length}
                onClick={() => apply(enabledNow.map(p => [p, false]), t("plugins.turnedOff", { count: enabledNow.length }))}
            >
                {t("plugins.turnAllOff")}
            </Button>
            <Button
                disabled={busy || !offDefault.length}
                onClick={() => apply(offDefault.map(p => [p, p.manifest.enabledByDefault ?? false]), t("plugins.wereReset", { count: offDefault.length }))}
            >
                {t("plugins.resetDefaults")}
            </Button>
        </div>
    );
}

/** The installed plugins: search, a filter, and the plugins as cards, a page at a time */
export function InstalledPlugins() {
    const plugins = useStore(PluginManager.subscribe, PluginManager.getSnapshot);
    useStore(Settings.subscribe, () => Settings.data);
    // Cards show store badges, updates and known problems
    const store = useStoreState();
    React.useEffect(() => Store.loadReports(), []);
    const [undo, setUndo] = React.useState<Undo>();
    const [query, setQuery] = React.useState("");
    const [filter, setFilter] = React.useState<Filter>("all");
    const q = normalizeQuery(query);
    // Sent here by Discord's settings search: the plugin's card, searched for by name, and its
    // settings open on the setting it found. Before the first paint, so the whole list never flashes by
    const [opened, setOpened] = React.useState<PluginTarget>();
    React.useLayoutEffect(() => {
        const open = (target = takePluginTarget()) => {
            const plugin = target && PluginManager.getSnapshot().find(p => p.manifest.id === target.id);
            if (!target || !plugin) return;
            setQuery(plugin.manifest.name);
            setFilter("all");
            setOpened(target.setting ? target : undefined);
        };
        open();
        return subscribeTabs(() => open());
    }, []);
    const openedState = opened && plugins.find(p => p.manifest.id === opened.id);
    const listRef = React.useRef<HTMLDivElement>(null);

    // Plugins that aren't working go first. Once seen, one keeps its place for as long as the tab is open:
    // turning it off clears its runtime problem, and the card shouldn't jump away from the switch
    const troubled = React.useRef(new Set<string>()).current;
    const notWorking = plugins.filter(p => {
        const trouble = !!troubleOf(p);
        if (trouble) troubled.add(p.manifest.id);
        return trouble && (!!p.pulled || isPluginEnabled(Settings.data, p.manifest));
    }).length;
    const troubledKey = [...troubled].join("\n");

    // Which plugins a filter shows is decided when the filter or search changes, not on every toggle:
    // switching a plugin off under "Enabled" leaves it in place instead of pulling it from under the cursor
    const ids = plugins.map(p => p.manifest.id).join("\n");
    const shown = React.useMemo(
        () => plugins
            .filter(p => filterTests[filter](p) && matchesQuery(p, q))
            .map(p => p.manifest.id)
            .sort((a, b) => Number(troubled.has(b)) - Number(troubled.has(a))),
        [filter, q, ids, troubledKey],
    );
    const byId = new Map(plugins.map(p => [p.manifest.id, p]));
    const visible = shown.flatMap(id => byId.get(id) ?? []);
    const paged = usePages(visible, PAGE_SIZE, `${filter}\n${q}`);

    const count = (f: Filter) => plugins.filter(filterTests[f]).length;
    const enabledCount = count("enabled");
    const devCount = count("dev");
    const needsReload = plugins.some(p => p.needsReload);
    const updates = store.plugins.filter(p => Store.pluginAction(p.id) === "update").length;
    const filtered = filter !== "all" || !!q;

    const clear = () => {
        setQuery("");
        setFilter("all");
    };
    const filterOptions: { value: Filter; label: string; }[] = [
        { value: "all", label: `${t("plugins.all")} (${plugins.length})` },
        { value: "enabled", label: `${t("plugins.filter.enabled")} (${enabledCount})` },
        { value: "disabled", label: `${t("plugins.filter.disabled")} (${plugins.length - enabledCount})` },
        { value: "settings", label: `${t("plugins.filter.settings")} (${count("settings")})` },
        ...devCount ? [{ value: "dev" as const, label: `${t("common.dev")} (${devCount})` }] : [],
        ...troubled.size ? [{ value: "trouble" as const, label: `${t("plugins.filter.trouble")} (${count("trouble")})` }] : [],
    ];

    return (
        <div className="dl-tab dl-tab-compact">
            {SafeMode.active && <SafeModeNotice />}
            {notWorking > 0 && filter !== "trouble" && (
                <Notice tone="danger" action={<Button id="dl-plugin-show-trouble" onClick={() => setFilter("trouble")}>{t("plugins.showTrouble", { count: notWorking })}</Button>}>
                    {t("plugins.troubleCount", { count: notWorking })}
                </Notice>
            )}
            {needsReload && (
                <Notice tone="warning" action={<Button variant="accent" onClick={() => location.reload()}>{t("common.reloadDiscord")}</Button>}>
                    {t("plugins.needsReload")}
                </Notice>
            )}
            {updates > 0 && (
                <Notice tone="info" action={<Button id="dl-plugin-see-updates" onClick={() => showTab("plugins", "store")}>{t("store.seeUpdates")}</Button>}>
                    {t("plugins.updatesReady", { count: updates })}
                </Notice>
            )}

            <div className="dl-toolbar">
                <div className="dl-grow">
                    <SearchField id="dl-plugin-search" label={t("plugins.search")} placeholder={t("plugins.search")} value={query} onChange={setQuery} />
                </div>
                <div className="dl-toolbar-select">
                    <Dropdown<Filter> id="dl-plugin-filter" label={t("plugins.filterLabel")} options={filterOptions} value={filter} onChange={setFilter} />
                </div>
                <IconButton icon="folder" label={t("plugins.openFolder")} onClick={() => Native.openPath("plugins")} />
            </div>

            <div className="dl-stack" ref={listRef}>
                <div className="dl-toolbar">
                    <Text variant="text-sm/medium" color="text-subtle" role="status" tabular className="dl-grow">
                        {!plugins.length
                            ? t("plugins.noneInstalled")
                            : filtered
                                ? t("plugins.showing", { shown: visible.length, count: plugins.length })
                                : t("plugins.count", { count: plugins.length, enabled: enabledCount })}
                    </Text>
                    {plugins.length > 0 && <BulkActions plugins={plugins} onDone={setUndo} />}
                </div>
                {undo && (
                    <Notice
                        tone="info"
                        action={
                            <Button
                                id="dl-bulk-undo"
                                onClick={async () => {
                                    setUndo(undefined);
                                    for (const [id, on] of Object.entries(undo.previous)) await PluginManager.setEnabled(id, on);
                                }}
                            >
                                {t("common.undo")}
                            </Button>
                        }
                    >
                        {undo.message}
                    </Notice>
                )}
                {visible.length ? (
                    <>
                        <ul className="dl-plugin-grid" aria-label={t("tabs.plugins")}>{paged.items.map(p => <PluginCard key={p.manifest.id} state={p} query={q} />)}</ul>
                        <Pagination
                            label={t("plugins.pages")}
                            page={paged.page}
                            count={paged.count}
                            onChange={n => {
                                paged.setPage(n);
                                scrollToTop(listRef.current);
                            }}
                        />
                    </>
                ) : plugins.length ? (
                    <EmptyState
                        icon="search"
                        title={q ? t("plugins.noMatch", { query: query.trim() }) : t("plugins.noneInFilter")}
                        action={<Button onClick={clear}>{t("plugins.showAll")}</Button>}
                    >
                        {q ? t("plugins.noMatchHint") : t("plugins.noneInFilterHint")}
                    </EmptyState>
                ) : (
                    <EmptyState icon="puzzle" title={t("plugins.emptyTitle")} action={<Button icon="folder" onClick={() => Native.openPath("plugins")}>{t("plugins.openFolder")}</Button>}>
                        {t("plugins.emptyBody")}
                    </EmptyState>
                )}
            </div>
            {opened?.setting && openedState && hasSettings(openedState) && (
                <SettingsDialog key={`${opened.id}:${opened.setting}`} state={openedState} highlight={[opened.setting]} onClose={() => setOpened(undefined)} />
            )}
        </div>
    );
}
