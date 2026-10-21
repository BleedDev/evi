import type { ImportMode, ImportPreview } from "@shared/backup";
import type { BackupOpenResult } from "@shared/ipc";

import { Backup } from "../backup";
import { localeDate, t } from "../i18n";
import { React } from "../webpack/common";
import { Button, Section, SettingField, Status, Text, Tone } from "./components";

type Opened = Extract<BackupOpenResult, { ok: true; }>;
type Note = { tone: Tone; text: string; } | null;

const modes = () => [
    { value: "merge", label: t("backup.mode.merge") },
    { value: "replace", label: t("backup.mode.replace") },
] as const;

const modeHint = (mode: ImportMode) => t(mode === "merge" ? "backup.mode.mergeHint" : "backup.mode.replaceHint");

/** One line per kind of change, in plain words */
function describe(p: ImportPreview) {
    const lines: string[] = [];
    const line = (key: Parameters<typeof t>[0], items: string[]) => items.length && lines.push(t(key, { count: items.length, list: items.join(", ") }));
    line("backup.turnsOnPlugins", p.pluginsEnabled);
    line("backup.turnsOffPlugins", p.pluginsDisabled);
    line("backup.changesPluginSettings", p.pluginSettingsChanged);
    line("backup.addsThemes", p.themesAdded);
    line("backup.overwritesThemes", p.themesOverwritten);
    line("backup.turnsOnThemes", p.themesEnabled);
    line("backup.turnsOffThemes", p.themesDisabled);
    if (p.quickCss === "replaced") lines.push(t("backup.replacesQuickCss"));
    if (p.quickCss === "kept") lines.push(t("backup.keepsQuickCss"));
    if (p.quickCssToggle !== undefined) lines.push(t(p.quickCssToggle ? "backup.quickCssOn" : "backup.quickCssOff"));
    return lines;
}

const formatDate = (iso: string) => localeDate(new Date(iso), { dateStyle: "medium", timeStyle: "short" });

function Preview({ opened, onDone, onCancel }: { opened: Opened; onDone(note: Note): void; onCancel(): void; }) {
    const [mode, setMode] = React.useState<ImportMode>("merge");
    const [error, setError] = React.useState<string>();
    const [busy, setBusy] = React.useState(false);
    const preview = opened.previews[mode];
    const lines = describe(preview);
    const userMissing = preview.missingPlugins.filter(p => p.source === "user");
    const devMissing = preview.missingPlugins.filter(p => p.source === "dev");

    const apply = async () => {
        if (busy) return;
        setBusy(true);
        try {
            const result = await Backup.apply(opened.token, mode);
            if (result.ok) onDone({ tone: "success", text: t("backup.restored", { file: opened.fileName, count: result.preview.changes }) });
            else if (!result.canceled) setError(result.error);
        } catch (err) {
            setError(String((err as Error)?.message ?? err));
        } finally {
            setBusy(false);
        }
    };

    return (
        <article className="dl-card dl-backup-preview" aria-labelledby="dl-backup-file">
            <div className="dl-card-head">
                <div className="dl-grow dl-row-text">
                    <Text tag="h3" variant="heading-md/medium" color="text-strong" id="dl-backup-file" className="dl-mono">{opened.fileName}</Text>
                    <Text tag="p" variant="text-sm/normal" color="text-subtle">{t("backup.madeWith", { date: formatDate(opened.createdAt), version: opened.eviVersion })}</Text>
                </div>
            </div>
            <div className="dl-card-body">
                <SettingField
                    id="dl-backup-mode"
                    definition={{ type: "select", label: t("backup.howToRestore"), description: modeHint(mode), default: "merge", options: modes() }}
                    value={mode}
                    onChange={v => setMode(v as ImportMode)}
                />
                <div className="dl-field">
                    <div className="dl-label">{t("backup.whatChanges")}</div>
                    {lines.length ? (
                        <ul className="dl-backup-changes">{lines.map(line => <li key={line}>{line}</li>)}</ul>
                    ) : (
                        <p className="dl-hint">{t(preview.changes ? "backup.onlyMissingSettings" : "backup.noChanges")}</p>
                    )}
                </div>
                {preview.missingPlugins.length > 0 && (
                    <div className="dl-field">
                        <div className="dl-label">{t("backup.notInstalled")}</div>
                        <p className="dl-hint">{t("backup.notInstalledHint")}</p>
                        <ul className="dl-backup-changes">
                            {userMissing.map(p => <li key={p.id}>{p.name} <span className="dl-mono">plugins/{p.id}</span></li>)}
                            {devMissing.map(p => <li key={p.id}>{p.name} <span className="dl-badge">{t("common.dev")}</span></li>)}
                        </ul>
                    </div>
                )}
                <div className="dl-toolbar">
                    <Button variant="accent" onClick={apply} disabled={busy || !preview.changes}>
                        {t(mode === "merge" ? "backup.merge" : "backup.replace")}
                    </Button>
                    <Button onClick={onCancel} disabled={busy}>{t("common.cancel")}</Button>
                </div>
                <div role="status">{error && <Status tone="danger">{error}</Status>}</div>
            </div>
        </article>
    );
}

export function BackupTab() {
    const [exportNote, setExportNote] = React.useState<Note>(null);
    const [importNote, setImportNote] = React.useState<Note>(null);
    const [opened, setOpened] = React.useState<Opened | null>(null);
    const [busy, setBusy] = React.useState<"export" | "open" | null>(null);

    const run = async <T,>(kind: "export" | "open", task: () => Promise<T>) => {
        if (busy) return;
        setBusy(kind);
        try {
            return await task();
        } catch (err) {
            const note = { tone: "danger" as const, text: String((err as Error)?.message ?? err) };
            kind === "export" ? setExportNote(note) : setImportNote(note);
        } finally {
            setBusy(null);
        }
    };

    const exportBackup = () => run("export", async () => {
        setExportNote(null);
        const result = await Backup.export();
        if (result.ok) setExportNote({ tone: "success", text: t("backup.savedTo", { path: result.path }) });
        else if (!result.canceled) setExportNote({ tone: "danger", text: result.error });
    });

    const openBackup = () => run("open", async () => {
        setImportNote(null);
        const result = await Backup.open();
        if (result.ok) setOpened(result);
        else if (!result.canceled) setImportNote({ tone: "danger", text: result.error });
    });

    return (
        <div className="dl-tab dl-backup">
            <Section
                id="dl-backup-export"
                title={t("backup.saveTitle")}
                description={t("backup.saveHint")}
                action={<Button variant="accent" icon="download" onClick={exportBackup} disabled={busy === "export"}>{t("backup.export")}</Button>}
            >
                <div className="dl-add-status" role="status">{exportNote && <Status tone={exportNote.tone}>{exportNote.text}</Status>}</div>
            </Section>
            <Section
                id="dl-backup-import"
                title={t("backup.restoreTitle")}
                description={t("backup.restoreHint")}
                action={<Button icon="folder" onClick={openBackup} disabled={busy === "open"}>{t("backup.choose")}</Button>}
            >
                <div className="dl-add-status" role="status">{importNote && <Status tone={importNote.tone}>{importNote.text}</Status>}</div>
                {opened && (
                    <Preview
                        key={opened.token}
                        opened={opened}
                        onCancel={() => setOpened(null)}
                        onDone={note => {
                            setOpened(null);
                            setImportNote(note);
                        }}
                    />
                )}
            </Section>
        </div>
    );
}
