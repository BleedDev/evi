/**
 * "Publish your own" at the top right of the Plugins page, and what it opens: an author's numbers
 * when this Evi is linked to a verified author, how to become one when it's linked to anyone else,
 * and linking first when it isn't linked at all. evi.rest decides which (GET /v1/me/author/stats).
 */
import type { AuthorStats } from "@shared/authorStats";

import { t, useLocale } from "../../i18n";
import { Native } from "../../native";
import { React } from "../../webpack/common";
import { AccountTab } from "../AccountTab";
import { Button, Dialog, Notice, Text } from "../components";
import { LoadError } from "../developers/common";
import { AuthorDashboard, DayChoice } from "./AuthorDashboard";

type State =
    | { kind: "loading"; }
    | { kind: "unlinked"; }
    | { kind: "notAuthor"; }
    | { kind: "error"; error: string; }
    | { kind: "author"; stats: AuthorStats; };

/** While unlinked, look again this often: linking happens in the account section right below */
const RECHECK_MS = 4000;

function useAuthorStats(days: DayChoice) {
    const [state, setState] = React.useState<State>({ kind: "loading" });
    const load = React.useCallback(async () => {
        if (!Native.authorStats) return setState({ kind: "error", error: t("author.unsupported") });
        const res = await Native.authorStats(Number(days)).catch((e: unknown) => ({ ok: false as const, error: String(e) }));
        if (res.ok) setState({ kind: "author", stats: res.value });
        else if ("unlinked" in res && res.unlinked) setState({ kind: "unlinked" });
        else if ("notAuthor" in res && res.notAuthor) setState({ kind: "notAuthor" });
        else setState({ kind: "error", error: res.error });
    }, [days]);
    React.useEffect(() => void load(), [load]);
    React.useEffect(() => {
        if (state.kind !== "unlinked") return;
        const timer = setInterval(() => void load(), RECHECK_MS);
        return () => clearInterval(timer);
    }, [state.kind, load]);
    return { state, load };
}

/** How to get a plugin into the store, for a linked account that isn't an author yet */
function BecomeAuthor() {
    const steps = ["author.step1", "author.step2", "author.step3", "author.step4"] as const;
    return (
        <div className="dl-authorhub-become">
            <Text tag="p" variant="text-md/normal" color="text-default">{t("author.becomeBody")}</Text>
            <ol className="dl-authorhub-steps">
                {steps.map((key, i) => (
                    <li key={key}>
                        <span className="dl-authorhub-step-n" aria-hidden="true">{i + 1}</span>
                        <Text tag="span" variant="text-sm/normal" color="text-default">{t(key)}</Text>
                    </li>
                ))}
            </ol>
            <div className="dl-authorhub-actions">
                <Button onClick={() => void Native.authorOpen?.("docs")}>{t("author.openDocs")}</Button>
                <Button variant="accent" onClick={() => void Native.authorOpen?.("publish")}>{t("author.openPublish")}</Button>
            </div>
        </div>
    );
}

function AuthorBody({ state, load, days, setDays }: { state: State; load(): void; days: DayChoice; setDays(days: DayChoice): void; }) {
    switch (state.kind) {
        case "loading":
            return <Text variant="text-sm/normal" color="text-muted" className="dl-authorhub-loading" role="status">{t("author.loading")}</Text>;
        case "unlinked":
            return (
                <div className="dl-authorhub-link">
                    <Notice tone="info">{t("author.linkBody")}</Notice>
                    <AccountTab />
                </div>
            );
        case "notAuthor":
            return <BecomeAuthor />;
        case "error":
            return <LoadError error={state.error} onRetry={load} />;
        case "author":
            return <AuthorDashboard stats={state.stats} days={days} onDays={setDays} />;
    }
}

function AuthorDialog({ onClose }: { onClose(): void; }) {
    useLocale();
    const [days, setDays] = React.useState<DayChoice>("30");
    const { state, load } = useAuthorStats(days);
    // Authors see their plugins; everyone else, how to publish their own
    const title = state.kind === "author" ? t("author.title")
        : state.kind === "unlinked" ? t("author.linkTitle")
        : state.kind === "loading" ? t("author.button")
        : t("author.becomeTitle");
    return (
        <Dialog id="dl-author" title={title} className="dl-authorhub-dialog" onClose={onClose}>
            <AuthorBody state={state} load={() => void load()} days={days} setDays={setDays} />
        </Dialog>
    );
}

/** The button at the top right of the Plugins page, and its dialog */
export function PublishButton() {
    useLocale();
    const [open, setOpen] = React.useState(false);
    return (
        <>
            <Button icon="code" className="dl-authorhub-button" title={t("author.buttonHint")} aria-haspopup="dialog" onClick={() => setOpen(true)}>
                {t("author.button")}
            </Button>
            {open && <AuthorDialog onClose={() => setOpen(false)} />}
        </>
    );
}
