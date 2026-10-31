/**
 * Store plugins as the developers watch them: how many installs use each, which ones Discord broke
 * (installs reporting patches that no longer find their place) and what failed, and the kill switch, which turns
 * a plugin off on every Evi. Turned-off plugins are listed first, with a way back.
 */
import { parseHealth, PluginHealth, Pull } from "@shared/devAdmin";

import { t, timeAgo } from "../../i18n";
import { React } from "../../webpack/common";
import { Badge, Button, EmptyState, List, SearchField, Section, Status, SwitchRow, Text } from "../components";
import { Confirm, LoadError, Problems } from "./common";
import { admin, format, useAdmin, useLive } from "./data";

type Ask = { kind: "pull"; plugin: PluginHealth; } | { kind: "lift"; pull: Pull; };

function PullDialog({ plugin, onClose, onDone }: { plugin: PluginHealth; onClose(): void; onDone(): void; }) {
    const [remove, setRemove] = React.useState(false);
    return (
        <Confirm
            id="dl-dev-pull"
            title={t("dev.pullTitle", { name: plugin.name })}
            body={t("dev.pullBody")}
            confirmLabel={t("dev.pullConfirm")}
            danger
            noteLabel={t("dev.pullReason")}
            noteRequired
            onConfirm={async reason => {
                const res = await admin("POST", `/admin/plugins/${plugin.id}/pull`, { reason, remove });
                if (res.ok) onDone();
                return res;
            }}
            onClose={onClose}
        >
            <SwitchRow id="dl-dev-pull-remove" label={t("dev.pullRemove")} description={t("dev.pullRemoveHint")} checked={remove} onChange={setRemove} />
        </Confirm>
    );
}

export function PluginsTab() {
    const health = useAdmin("/admin/health", parseHealth);
    const { live } = useLive();
    const [query, setQuery] = React.useState("");
    const [ask, setAsk] = React.useState<Ask>();

    const installs = new Map(live?.topPlugins.map(p => [p.id, p.installs]));
    const pulled = new Map(health.value?.pulls.map(p => [p.plugin, p]));
    const q = query.trim().toLowerCase();
    // Broken first, then the most used
    const plugins = (health.value?.plugins ?? [])
        .filter(p => !q || p.name.toLowerCase().includes(q) || p.id.includes(q))
        .sort((a, b) => b.brokenPatches - a.brokenPatches || (installs.get(b.id) ?? b.installsReporting) - (installs.get(a.id) ?? a.installsReporting));

    if (health.error) return <LoadError error={health.error} onRetry={health.reload} />;
    if (!health.value) return <EmptyState icon="clock" title={t("dev.loading")} />;

    return (
        <div className="dl-dev">
            {!!health.value.pulls.length && (
                <Section title={t("dev.pulled")} description={t("dev.pulledHint")} id="dl-dev-pulled">
                    <List>
                        {health.value.pulls.map(p => (
                            <li key={p.plugin} className="dl-row">
                                <div className="dl-row-head">
                                    <div className="dl-row-text">
                                        <div className="dl-row-title">
                                            <Text tag="h3" variant="text-md/semibold" color="text-strong">{p.plugin}</Text>
                                            <Text tag="span" variant="text-sm/normal" color="text-muted">{p.versions === "all" ? t("dev.allVersions") : p.versions.join(", ")}</Text>
                                            {p.removed && <Badge tone="warning">{t("dev.outOfStore")}</Badge>}
                                        </div>
                                        <Text tag="p" variant="text-sm/normal" color="text-subtle" className="dl-row-desc">{p.reason}</Text>
                                        <Text tag="p" variant="text-xs/normal" color="text-muted">{timeAgo(p.at)}</Text>
                                    </div>
                                    <div className="dl-row-controls">
                                        <Button onClick={() => setAsk({ kind: "lift", pull: p })}>{t("dev.liftPull")}</Button>
                                    </div>
                                </div>
                            </li>
                        ))}
                    </List>
                </Section>
            )}

            <Section title={t("dev.health")} description={t("dev.healthHint")} id="dl-dev-health" action={<div className="dl-dev-search"><SearchField id="dl-dev-plugin-search" label={t("dev.searchPlugins")} placeholder={t("dev.searchPlugins")} value={query} onChange={setQuery} /></div>}>
                {plugins.length ? (
                    <List>
                        {plugins.map(p => {
                            const used = installs.get(p.id);
                            return (
                                <li key={p.id} className="dl-row">
                                    <div className="dl-row-head">
                                        <div className="dl-row-text">
                                            <div className="dl-row-title">
                                                <Text tag="h3" variant="text-md/semibold" color="text-strong">{p.name}</Text>
                                                <span className="dl-row-meta">
                                                    {p.brokenPatches > 0
                                                        ? <Status tone="danger">{t("dev.broken", { count: format(p.brokenPatches), total: format(p.installsReporting) })}</Status>
                                                        : <Status tone="success" quiet>{t("dev.healthy")}</Status>}
                                                </span>
                                            </div>
                                            <Text tag="p" variant="text-xs/normal" color="text-muted">
                                                {[used !== undefined && t("dev.usedBy", { count: format(used) }), p.lastReportAt && t("dev.lastReport", { time: timeAgo(p.lastReportAt) })].filter(Boolean).join(" · ") || p.id}
                                            </Text>
                                        </div>
                                        {!pulled.has(p.id) && (
                                            <div className="dl-row-controls dl-dev-row-action" data-shown={p.brokenPatches > 0 ? "" : undefined}>
                                                <Button variant="danger" onClick={() => setAsk({ kind: "pull", plugin: p })}>{t("dev.pull")}</Button>
                                            </div>
                                        )}
                                    </div>
                                    <Problems problems={p.problems} />
                                </li>
                            );
                        })}
                    </List>
                ) : <EmptyState icon="search" title={q ? t("dev.noMatch") : t("dev.noHealth")} />}
            </Section>

            {ask?.kind === "pull" && <PullDialog plugin={ask.plugin} onClose={() => setAsk(undefined)} onDone={health.reload} />}
            {ask?.kind === "lift" && (
                <Confirm
                    id="dl-dev-lift"
                    title={t("dev.liftTitle", { name: ask.pull.plugin })}
                    body={t("dev.liftBody")}
                    confirmLabel={t("dev.liftPull")}
                    onConfirm={async () => {
                        const res = await admin("DELETE", `/admin/plugins/${ask.pull.plugin}/pull`);
                        if (res.ok) health.reload();
                        return res;
                    }}
                    onClose={() => setAsk(undefined)}
                />
            )}
        </div>
    );
}
