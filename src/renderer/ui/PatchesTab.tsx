import { CORE_HOTFIX_ID } from "@shared/hotfixes";
import type { EviKey } from "@shared/locales";

import { CoreHotfix } from "../coreHotfix";
import { t } from "../i18n";
import { diagnosePatches, PatchDiagnosis, PatchHealth } from "../patching/diagnose";
import { diagnoseLookups, LookupDiagnosis, LookupHealth } from "../plugins/lookups";
import { PluginManager } from "../plugins/manager";
import { React } from "../webpack/common";
import { Badge, Button, EmptyState, List, Section, Status, Text, Tone } from "./components";

const health: Record<PatchHealth, { tone: Tone; label: EviKey; hint?: EviKey; order: number; }> = {
    broken: { tone: "danger", label: "patches.broken", hint: "patches.brokenHint", order: 0 },
    failed: { tone: "danger", label: "patches.failed", hint: "patches.failedHint", order: 0 },
    partial: { tone: "danger", label: "patches.partial", hint: "patches.partialHint", order: 0 },
    ambiguous: { tone: "warning", label: "patches.ambiguous", hint: "patches.ambiguousHint", order: 1 },
    waiting: { tone: "success", label: "patches.waiting", hint: "patches.waitingHint", order: 2 },
    applied: { tone: "success", label: "patches.applied", order: 3 },
};

function PatchRow({ d }: { d: PatchDiagnosis; }) {
    const info = health[d.health];
    const titleId = `dl-patch-${d.plugin}-${d.index}`;
    // Registered with Evi's fix in place (shared/hotfixes.ts), so what's checked here is the fix
    const hotfix = d.plugin === CORE_HOTFIX_ID ? CoreHotfix.get() : PluginManager.get(d.plugin)?.hotfix;
    const fixed = !!hotfix?.patches.some(p => p.index === d.index);
    return (
        <li className="dl-row" aria-labelledby={titleId}>
            <div className="dl-row-head">
                <div className="dl-row-text">
                    <div className="dl-row-title">
                        <Text tag="h3" variant="heading-md/medium" color="text-strong" id={titleId}>{d.plugin}</Text>
                        <Text variant="text-xs/medium" color="text-muted" className="dl-version" tabular>{t("patches.patchNumber", { n: d.index + 1 })}</Text>
                        {fixed && <Badge>{t("hotfix.label")}</Badge>}
                    </div>
                    <p className="dl-code-inline"><span className="dl-code-key">find</span>{String(d.patch.find)}</p>
                    {info.hint && <Text tag="p" variant="text-sm/normal" color="text-subtle">{t(info.hint)}</Text>}
                    {d.modules.length > 0 && (
                        <Text tag="p" variant="text-xs/normal" color="text-muted" className="dl-mono">
                            {t("patches.modules", { count: d.modules.length, list: d.modules.join(", ") })}
                        </Text>
                    )}
                </div>
                <div className="dl-row-controls">
                    <Status tone={info.tone}>{t(info.label)}</Status>
                </div>
            </div>
            {d.errors.map((e, i) => <pre key={i} className="dl-error">{e}</pre>)}
        </li>
    );
}

const lookupHealth: Record<LookupHealth, { tone: Tone; label: EviKey; hint: (d: LookupDiagnosis) => string; order: number; }> = {
    broken: {
        tone: "danger", label: "patches.notFound", order: 0,
        hint: d => t(d.candidates.length ? "patches.lookupBrokenLoaded" : "patches.lookupBroken"),
    },
    missing: {
        tone: "warning", label: "patches.notFoundYet", order: 1,
        hint: () => t("patches.lookupMissing"),
    },
    waiting: { tone: "success", label: "patches.foundWhenNeeded", order: 2, hint: () => t("patches.lookupWaiting") },
    found: { tone: "success", label: "patches.found", order: 3, hint: () => "" },
};

function LookupRow({ d, index }: { d: LookupDiagnosis; index: number; }) {
    const info = lookupHealth[d.health];
    const titleId = `dl-lookup-${d.plugin}-${index}`;
    const hint = info.hint(d);
    return (
        <li className="dl-row" aria-labelledby={titleId}>
            <div className="dl-row-head">
                <div className="dl-row-text">
                    <div className="dl-row-title">
                        <Text tag="h3" variant="heading-md/medium" color="text-strong" id={titleId}>{d.plugin}</Text>
                    </div>
                    <p className="dl-code-inline"><span className="dl-code-key">finds</span>{d.target}</p>
                    {hint && <Text tag="p" variant="text-sm/normal" color="text-subtle">{hint}</Text>}
                    {d.candidates.length > 0 && (
                        <Text tag="p" variant="text-xs/normal" color="text-muted" className="dl-mono">
                            {t("patches.modules", { count: d.candidates.length, list: d.candidates.join(", ") })}
                        </Text>
                    )}
                </div>
                <div className="dl-row-controls">
                    <Status tone={info.tone}>{t(info.label)}</Status>
                </div>
            </div>
        </li>
    );
}

export function PatchesTab() {
    const check = () => ({ patches: diagnosePatches(), lookups: diagnoseLookups(undefined, performance.now(), 0) });
    const [{ patches: results, lookups }, setResults] = React.useState(check);
    // What needs attention first; the sort is stable, so plugin order holds within each group
    const sorted = [...results].sort((a, b) => health[a.health].order - health[b.health].order);
    const sortedLookups = lookups
        .map((d, index) => ({ d, index }))
        .sort((a, b) => lookupHealth[a.d.health].order - lookupHealth[b.d.health].order);
    const problems = results.filter(r => health[r.health].tone === "danger").length
        + lookups.filter(d => lookupHealth[d.health].tone !== "success").length;

    const counts = [
        results.length && t("patches.sourcePatchCount", { count: results.length }),
        lookups.length && t("patches.lookupCount", { count: lookups.length }),
    ].filter(Boolean).join(", ");

    return (
        <div className="dl-tab">
            <div className="dl-toolbar">
                <div className="dl-grow">
                    <Text variant="text-sm/medium" color="text-subtle" role="status" tabular>
                        {counts
                            ? problems ? t("patches.summaryProblems", { counts, count: problems }) : t("patches.summaryOk", { counts })
                            : t("patches.none")}
                    </Text>
                </div>
                <Button icon="refresh" onClick={() => setResults(check())}>{t("common.checkAgain")}</Button>
            </div>
            {results.length ? (
                <List label={t("patches.sourcePatches")}>{sorted.map(d => <PatchRow key={`${d.plugin}-${d.index}`} d={d} />)}</List>
            ) : !lookups.length && (
                <EmptyState icon="wrench" title={t("patches.emptyTitle")}>
                    {t("patches.emptyBody")}
                </EmptyState>
            )}
            {lookups.length > 0 && (
                <Section
                    id="dl-lookups"
                    title={t("patches.lookups")}
                    description={t("patches.lookupsHint")}
                >
                    <List label={t("patches.lookups")}>{sortedLookups.map(({ d, index }) => <LookupRow key={`${d.plugin}-${index}`} d={d} index={index} />)}</List>
                </Section>
            )}
        </div>
    );
}
