/**
 * Develop a source patch live against Discord's real code: see which modules the find hits, what the
 * match catches, the code before and after, and whether the patched module still compiles.
 */
import { CORE_HOTFIX_ID, hotfixDraft } from "@shared/hotfixes";
import type { ReactNode } from "react";

import { t, tNodes, useLocale } from "../i18n";
import { moduleSources } from "../patching/diagnose";
import { evaluatePatch, Excerpt, parsePatchValue, PatchDraft, PatchHelperResult } from "../patching/helper";
import { coreOriginalPatch, getPatchRecords, SourcePatch } from "../patching/source";
import { PluginManager } from "../plugins/manager";
import { React } from "../webpack/common";
import { ApiText } from "./ApiText";
import { Button, Dropdown, EmptyState, Section, Status, Text, TextField } from "./components";

/** Scanning every module isn't free, wait for a typing pause */
const DEBOUNCE_MS = 250;
const MAX_LISTED_MODULES = 20;

// Kept outside the component so the draft survives switching tabs and closing the panel
const draft: PatchDraft = { find: "", match: "", replace: "" };

function Code({ label, excerpt, kind }: { label: string; excerpt: Excerpt; kind?: "removed" | "added"; }) {
    return (
        <figure className="dl-code-figure">
            <figcaption className="dl-code-label">{label}</figcaption>
            <pre className="dl-code">
                {excerpt.clippedStart && "…"}
                <ApiText text={excerpt.lead} />
                <mark data-kind={kind} data-empty={excerpt.mark ? undefined : ""}><ApiText text={excerpt.mark} /></mark>
                <ApiText text={excerpt.tail} />
                {excerpt.clippedEnd && "…"}
            </pre>
        </figure>
    );
}

function ResultCard({ id, title, status, children }: { id: string; title: string; status: ReactNode; children?: ReactNode; }) {
    return (
        <section className="dl-card" id={id} aria-labelledby={`${id}-title`}>
            <div className="dl-card-head">
                <Text tag="h3" variant="heading-md/medium" color="text-strong" id={`${id}-title`} className="dl-grow">{title}</Text>
                {status}
            </div>
            {children && <div className="dl-card-body">{children}</div>}
        </section>
    );
}

function ModuleCard({ result, scanned, onPick }: { result: PatchHelperResult; scanned: number; onPick(id: string): void; }) {
    const { candidates, moduleId, errors } = result;
    if (errors.find) {
        return (
            <ResultCard id="dl-ph-modules" title={t("patchHelper.module.title")} status={<Status tone="danger">{t("patchHelper.invalidRegex")}</Status>}>
                <pre className="dl-error">{errors.find}</pre>
            </ResultCard>
        );
    }

    const status = candidates.length === 0
        ? <Status tone="danger">{t("patchHelper.module.none")}</Status>
        : <Status tone={candidates.length === 1 ? "success" : "warning"}>{t("patchHelper.module.count", { count: candidates.length })}</Status>;

    return (
        <ResultCard id="dl-ph-modules" title={t("patchHelper.module.title")} status={status}>
            {candidates.length === 0 && (
                <p className="dl-hint">{t("patchHelper.module.noneHint", { modules: scanned.toLocaleString() })}</p>
            )}
            {candidates.length === 1 && <p className="dl-hint dl-mono">{t("patchHelper.module.id", { id: moduleId ?? "" })}</p>}
            {candidates.length > 1 && (
                <>
                    <p className="dl-hint">{t("patchHelper.module.many")}</p>
                    <div className="dl-chips" role="group" aria-label={t("patchHelper.module.list")}>
                        {candidates.slice(0, MAX_LISTED_MODULES).map(id => (
                            <button key={id} type="button" className="dl-chip dl-mono" aria-pressed={id === moduleId} onClick={() => onPick(id)}>{id}</button>
                        ))}
                        {candidates.length > MAX_LISTED_MODULES && <span className="dl-hint">{t("patchHelper.module.more", { count: candidates.length - MAX_LISTED_MODULES })}</span>}
                    </div>
                </>
            )}
        </ResultCard>
    );
}

function MatchCard({ result, hasMatch }: { result: PatchHelperResult; hasMatch: boolean; }) {
    let status: ReactNode;
    if (result.errors.match) status = <Status tone="danger">{t("patchHelper.invalidRegex")}</Status>;
    else if (!hasMatch) status = <Status tone="muted">{t("patchHelper.match.empty")}</Status>;
    else if (!result.matchCount) status = <Status tone="danger">{t("patchHelper.match.none")}</Status>;
    else status = <Status tone="success">{result.matchCount === 1 ? t("patchHelper.match.once") : t("patchHelper.match.times", { count: result.matchCount })}</Status>;

    return (
        <ResultCard id="dl-ph-match" title={t("patchHelper.match.label")} status={status}>
            {result.errors.match && <pre className="dl-error">{result.errors.match}</pre>}
            {result.match && <Code label={result.matchCount > 1 ? t("patchHelper.match.first") : t("patchHelper.match.code")} excerpt={result.match} />}
            {result.groups.length > 0 && (
                <dl className="dl-groups dl-mono">
                    {result.groups.map((g, i) => (
                        <div key={i}><dt>${i + 1}</dt><dd>{g === undefined ? t("patchHelper.match.noGroup") : JSON.stringify(g)}</dd></div>
                    ))}
                </dl>
            )}
        </ResultCard>
    );
}

function ResultChangeCard({ result }: { result: PatchHelperResult; }) {
    if (!result.changed) {
        return (
            <ResultCard id="dl-ph-result" title={t("patchHelper.result.title")} status={<Status tone="danger">{t("patchHelper.result.noChange")}</Status>}>
                <p className="dl-hint">{t("patchHelper.result.noChangeHint")}</p>
            </ResultCard>
        );
    }
    const { compile } = result;
    const status = compile?.ok
        ? <Status tone="success">{t("patchHelper.result.compiles")}</Status>
        : <Status tone="danger">{t("patchHelper.result.broken")}</Status>;
    return (
        <ResultCard id="dl-ph-result" title={t("patchHelper.result.title")} status={status}>
            <div className="dl-diff">
                {result.before && <Code label={t("patchHelper.result.before")} excerpt={result.before} kind="removed" />}
                {result.after && <Code label={t("patchHelper.result.after")} excerpt={result.after} kind="added" />}
            </div>
            {compile && !compile.ok && (
                <pre className="dl-error">{compile.error}{"\n"}{t("patchHelper.result.revert")}</pre>
            )}
        </ResultCard>
    );
}

/** Copies `text`, and says so for a moment: the icon swaps to a check, and screen readers hear `done` */
function useCopy(text: string) {
    const [copied, setCopied] = React.useState(false);
    React.useEffect(() => setCopied(false), [text]);
    React.useEffect(() => {
        if (!copied) return;
        const timer = setTimeout(() => setCopied(false), 2000);
        return () => clearTimeout(timer);
    }, [copied]);

    // Only animate the icon once it actually swaps, not when the card first appears
    const swapped = React.useRef(false);
    const copy = () => navigator.clipboard.writeText(text).then(() => {
        swapped.current = true;
        setCopied(true);
    }, () => { });
    return { copied, copy, className: swapped.current ? "dl-icon-swap" : undefined };
}

function SnippetCard({ snippet }: { snippet: string; }) {
    const { copied, copy, className } = useCopy(snippet);
    return (
        <ResultCard
            id="dl-ph-snippet"
            title={t("patchHelper.patch.title")}
            status={<Button icon={copied ? "check" : "copy"} className={className} onClick={copy}>{copied ? t("patchHelper.copied") : t("patchHelper.patch.copy")}</Button>}
        >
            <p className="dl-hint">{tNodes("patchHelper.patch.hint", { patches: <code className="dl-mono">patches</code> })}</p>
            <pre className="dl-code"><ApiText text={snippet} /></pre>
            <span className="dl-sr-only" role="status">{copied ? t("patchHelper.patch.copied") : ""}</span>
        </ResultCard>
    );
}

/** The draft as a hotfix for the patch it's fixing (shared/hotfixes.ts), for Evi's team to publish */
function HotfixCard({ json }: { json: string; }) {
    const { copied, copy, className } = useCopy(json);
    return (
        <ResultCard
            id="dl-ph-hotfix"
            title={t("patchHelper.hotfix.title")}
            status={<Button icon={copied ? "check" : "copy"} className={className} onClick={copy}>{copied ? t("patchHelper.copied") : t("patchHelper.hotfix.copy")}</Button>}
        >
            <p className="dl-hint">{t("patchHelper.hotfix.hint")}</p>
            <pre className="dl-code">{json}</pre>
            <span className="dl-sr-only" role="status">{copied ? t("patchHelper.hotfix.copied") : ""}</span>
        </ResultCard>
    );
}

/** "plugin:index", or "" for a new patch. Kept with the draft. */
let fixing = "";

/** How the fields show a find or match: text as is, a RegExp as /…/flags (what parsePatchValue reads back) */
const asField = (value: string | RegExp) => typeof value === "string" ? value : `/${value.source}/${value.flags}`;

/** Every patch a plugin registered, as the plugin wrote it (not with a hotfix already in place) */
interface FixablePatch {
    value: string;
    label: string;
    /** The plugin id, or CORE_HOTFIX_ID for Evi's own */
    plugin: string;
    /** The plugin's version, or Evi's: the range a hotfix drafted from it gets */
    version?: string;
    original: SourcePatch;
    index: number;
}

/** Every registered patch a hotfix can fix, plugins' and Evi's own, as written */
function fixablePatches(): FixablePatch[] {
    return getPatchRecords().flatMap(r => {
        const value = `${r.plugin}:${r.index}`;
        if (r.plugin === CORE_HOTFIX_ID) {
            const original = coreOriginalPatch(r.index);
            return original ? [{ value, label: t("patchHelper.target.patch", { plugin: "Evi", number: r.index + 1 }), plugin: r.plugin, version: EVI_VERSION, original, index: r.index }] : [];
        }
        const state = PluginManager.get(r.plugin);
        const original = state?.definition?.patches?.[r.index];
        return state && original ? [{ value, label: t("patchHelper.target.patch", { plugin: state.manifest.name, number: r.index + 1 }), plugin: r.plugin, version: state.manifest.version, original, index: r.index }] : [];
    });
}

/** The draft as a hotfix for the patch being fixed, when there's one and the draft parses */
function hotfixJson(draft: PatchDraft): string | undefined {
    const target = fixablePatches().find(p => p.value === fixing);
    if (!target || !draft.find || !draft.match) return;
    try {
        return JSON.stringify(hotfixDraft({
            plugin: target.plugin,
            version: target.version,
            index: target.index,
            was: target.original.find,
            find: parsePatchValue(draft.find),
            match: parsePatchValue(draft.match),
            replace: draft.replace,
        }), null, 2);
    } catch {
        return undefined;
    }
}

export function PatchHelperTab() {
    useLocale();
    const [input, setInput] = React.useState<PatchDraft>(() => ({ ...draft }));
    const [preferred, setPreferred] = React.useState<string>();
    const [state, setState] = React.useState<{ result: PatchHelperResult; scanned: number; } | null>(null);
    const [checking, setChecking] = React.useState(false);

    React.useEffect(() => {
        Object.assign(draft, input);
        if (!input.find) {
            setState(null);
            setChecking(false);
            return;
        }
        setChecking(true);
        const timer = setTimeout(() => {
            const sources = moduleSources();
            setState({ result: evaluatePatch(input, sources, preferred), scanned: sources.length });
            setChecking(false);
        }, DEBOUNCE_MS);
        return () => clearTimeout(timer);
    }, [input.find, input.match, input.replace, preferred]);

    const field = (key: keyof PatchDraft) => (value: string) => setInput(prev => ({ ...prev, [key]: value }));
    const result = state?.result;

    // Starting from a plugin's own patch fills the fields in with it, and offers the result as a hotfix
    const [target, setTarget] = React.useState(fixing);
    const targets = fixablePatches();
    const pick = (value: string) => {
        fixing = value;
        setTarget(value);
        const picked = targets.find(p => p.value === value);
        if (!picked) return;
        const [first] = [picked.original.replace].flat();
        setInput({ find: asField(picked.original.find), match: first ? asField(first.match) : "", replace: typeof first?.with === "string" ? first.with : "" });
    };
    const hotfix = target && result?.snippet ? hotfixJson(input) : undefined;

    return (
        <div className="dl-tab">
            <Section id="dl-ph-draft" title={t("patchHelper.patch.title")} description={t("patchHelper.draft.description")}>
                <div className="dl-ph-fields dl-stack-loose">
                    {targets.length > 0 && (
                        <div className="dl-field">
                            <Text variant="text-md/medium" color="text-strong" id="dl-ph-target-label">{t("patchHelper.target.label")}</Text>
                            <p className="dl-hint">{t("patchHelper.target.hint")}</p>
                            <Dropdown
                                id="dl-ph-target"
                                label={t("patchHelper.target.label")}
                                labelledBy="dl-ph-target-label"
                                options={[{ label: t("patchHelper.target.new"), value: "" }, ...targets.map(({ label, value }) => ({ label, value }))]}
                                value={targets.some(p => p.value === target) ? target : ""}
                                onChange={pick}
                            />
                        </div>
                    )}
                    <TextField
                        id="dl-ph-find"
                        label={t("patchHelper.find.label")}
                        description={t("patchHelper.find.description")}
                        placeholder="Object.defineProperties(this,{isDeveloper"
                        spellCheck={false}
                        value={input.find}
                        onChange={field("find")}
                    />
                    <TextField
                        id="dl-ph-match"
                        label={t("patchHelper.match.label")}
                        description={t("patchHelper.match.description")}
                        placeholder="/(?<=isDeveloper:\{[^}]*?get:\(\)=>)\i/"
                        spellCheck={false}
                        value={input.match}
                        onChange={field("match")}
                    />
                    <TextField
                        id="dl-ph-replace"
                        label={t("patchHelper.replace.label")}
                        description={t("patchHelper.replace.description")}
                        placeholder="true"
                        spellCheck={false}
                        value={input.replace}
                        onChange={field("replace")}
                    />
                </div>
            </Section>

            <Section id="dl-ph-results" title={t("patchHelper.results.title")}>
                <p className="dl-hint dl-tabular" role="status" aria-live="polite">
                    {!input.find ? "" : checking || !state ? t("patchHelper.results.checking") : t("patchHelper.results.checked", { count: state.scanned, modules: state.scanned.toLocaleString() })}
                </p>

                {!input.find ? (
                    <EmptyState icon="beaker" title={t("patchHelper.empty.title")}>
                        {t("patchHelper.empty.body")}
                    </EmptyState>
                ) : result && (
                    <div className="dl-stack" aria-busy={checking} data-checking={checking ? "" : undefined}>
                        <ModuleCard result={result} scanned={state.scanned} onPick={setPreferred} />
                        {result.moduleId && <MatchCard result={result} hasMatch={!!input.match} />}
                        {result.matchCount > 0 && <ResultChangeCard result={result} />}
                        {result.snippet && <SnippetCard snippet={result.snippet} />}
                        {hotfix && <HotfixCard json={hotfix} />}
                    </div>
                )}
            </Section>
        </div>
    );
}
