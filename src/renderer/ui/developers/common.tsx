/**
 * Pieces the Developers tabs share: a confirm dialog for anything that changes evi.rest, a failed
 * load's notice, and what failed in a plugin (also on the Author page).
 */
import type { HealthProblem } from "@shared/health";
import type { ReactNode } from "react";

import { t } from "../../i18n";
import { React } from "../../webpack/common";
import { Button, Dialog, Notice, Text, TextField } from "../components";
import type { AdminResult } from "./data";

/**
 * Asks before a change, says what it does, and stays open with evi.rest's answer if it refuses.
 * With `noteLabel` it takes an optional note (a reason, shown to the author or reporter).
 */
export function Confirm({ id, title, body, confirmLabel, danger, noteLabel, noteRequired, children, onConfirm, onClose }: {
    id: string;
    title: string;
    body?: ReactNode;
    /** Says the consequence: "Publish to the store", never "OK" */
    confirmLabel: string;
    danger?: boolean;
    noteLabel?: string;
    noteRequired?: boolean;
    children?: ReactNode;
    onConfirm(note: string): Promise<AdminResult<unknown>>;
    onClose(): void;
}) {
    const [note, setNote] = React.useState("");
    const [busy, setBusy] = React.useState(false);
    const [error, setError] = React.useState<string>();
    return (
        <Dialog id={id} title={title} onClose={onClose}>
            {close => (
                <form
                    className="dl-stack-loose"
                    onSubmit={async e => {
                        e.preventDefault();
                        if (busy) return;
                        if (noteRequired && !note.trim()) {
                            setError(t("dev.noteRequired"));
                            return;
                        }
                        setBusy(true);
                        const res = await onConfirm(note.trim());
                        setBusy(false);
                        if (res.ok) close();
                        else setError(res.error);
                    }}
                >
                    {body && <Text tag="p" variant="text-sm/normal" color="text-subtle">{body}</Text>}
                    {noteLabel && <TextField id={`${id}-note`} label={noteLabel} value={note} onChange={setNote} multiline />}
                    {children}
                    {error && <Notice tone="danger">{error}</Notice>}
                    <div className="dl-toolbar">
                        <Button type="submit" variant={danger ? "danger" : "accent"} disabled={busy}>{confirmLabel}</Button>
                        <Button onClick={close}>{t("common.cancel")}</Button>
                    </div>
                </form>
            )}
        </Dialog>
    );
}

export function LoadError({ error, onRetry }: { error: string; onRetry(): void; }) {
    return <Notice tone="danger" action={<Button onClick={onRetry}>{t("common.tryAgain")}</Button>}>{t("dev.error", { error })}</Notice>;
}

/** What failed in a plugin as installs reported it: the line their Evi sent, and how many sent it */
export function Problems({ problems }: { problems: HealthProblem[]; }) {
    if (!problems.length) return null;
    return (
        <ul className="dl-dev-problems" aria-label={t("health.whatFailed")}>
            {problems.map(p => (
                <li key={`${p.kind}
${p.detail}`}>
                    <code className="dl-error">{p.detail}</code>
                    <Text tag="span" variant="text-xs/normal" color="text-muted" tabular>{t("community.authorInstalls", { count: p.installs })}</Text>
                </li>
            ))}
        </ul>
    );
}
