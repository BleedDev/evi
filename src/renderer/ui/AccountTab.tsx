/**
 * Linking this install to an Evi account on evi.rest. Evi gets a short code and opens the website to
 * confirm it with Discord; meanwhile this checks every few seconds until the link shows up. Linked
 * installs share their stars, and the dashboard lists them.
 */
import type { AccountUser } from "@shared/account";

import { t } from "../i18n";
import { Developer } from "../developer";
import { Native } from "../native";
import { React } from "../webpack/common";
import { Button, discordAvatarUrl, Section, Status, Text } from "./components";
import { SupporterPerks } from "./SupporterPerks";
import { syncProfileNow } from "../accountSync";

const POLL_MS = 3000;
const CODE_TTL_MS = 10 * 60 * 1000;

type State =
    | { kind: "loading"; }
    | { kind: "offline"; error: string; }
    | { kind: "idle"; note?: string; }
    | { kind: "starting"; }
    | { kind: "waiting"; code: string; since: number; }
    | { kind: "linked"; user: AccountUser; };

export function AccountTab() {
    const [state, setState] = React.useState<State>({ kind: "loading" });

    const check = React.useCallback(async () => {
        const res = await Native.accountStatus();
        // Linked or unlinked: the Developers page follows
        void Developer.refresh();
        if (!res.ok) setState({ kind: "offline", error: res.error });
        else setState(res.user ? { kind: "linked", user: res.user } : { kind: "idle" });
    }, []);

    React.useEffect(() => void check(), [check]);

    // While a code is out, check for the link to land
    React.useEffect(() => {
        if (state.kind !== "waiting") return;
        const timer = setInterval(async () => {
            if (Date.now() - state.since > CODE_TTL_MS) {
                setState({ kind: "idle", note: t("account.codeExpired") });
                return;
            }
            const res = await Native.accountStatus();
            if (res.ok && res.user) {
                setState({ kind: "linked", user: res.user });
                void Developer.refresh();
                // Just linked: the account takes this Discord's current name and avatar
                syncProfileNow();
            }
        }, POLL_MS);
        return () => clearInterval(timer);
    }, [state]);

    const start = async () => {
        setState({ kind: "starting" });
        const res = await Native.linkAccount();
        setState(res.ok ? { kind: "waiting", code: res.code, since: Date.now() } : { kind: "idle", note: res.error });
    };

    return (
        <div className="dl-tab">
        <Section
            title={t("account.title")}
            description={t("account.description")}
        >
            <div className="dl-account-card" aria-live="polite">
                {state.kind === "loading" && <Text variant="text-sm/normal" color="text-muted">{t("account.checking")}</Text>}

                {state.kind === "offline" && (
                    <>
                        <div className="dl-account-text">
                            <Text variant="text-md/semibold" color="text-strong">{t("account.offline")}</Text>
                            <Status tone="danger">{state.error}</Status>
                        </div>
                        <Button onClick={() => { setState({ kind: "loading" }); check(); }}>{t("common.tryAgain")}</Button>
                    </>
                )}

                {(state.kind === "idle" || state.kind === "starting") && (
                    <>
                        <div className="dl-account-text">
                            <Text variant="text-md/semibold" color="text-strong">{t("account.notLinked")}</Text>
                            <Text variant="text-sm/normal" color="text-subtle">{t("account.notLinkedHint")}</Text>
                            {state.kind === "idle" && state.note && <Status tone="danger">{state.note}</Status>}
                        </div>
                        <Button variant="accent" icon="link" onClick={start} disabled={state.kind === "starting"}>
                            {state.kind === "starting" ? t("account.opening") : t("account.link")}
                        </Button>
                    </>
                )}

                {state.kind === "waiting" && (
                    <div className="dl-account-waiting">
                        <Text variant="text-sm/normal" color="text-subtle">{t("account.confirmCode")}</Text>
                        <span className="dl-account-code">{state.code}</span>
                        <Status tone="muted">{t("account.waiting")}</Status>
                        <div className="dl-account-actions">
                            <Button onClick={start}>{t("account.newCode")}</Button>
                            <Button onClick={() => setState({ kind: "idle" })}>{t("common.cancel")}</Button>
                        </div>
                    </div>
                )}

                {state.kind === "linked" && (
                    <>
                        <img className="dl-account-avatar" src={discordAvatarUrl(state.user.id, state.user.avatar, 80, "auto")} alt="" width={40} height={40} />
                        <div className="dl-account-text">
                            <Text variant="text-md/semibold" color="text-strong">{state.user.globalName || state.user.username}</Text>
                            <Status tone="success" quiet>{t("account.linkedAs", { username: state.user.username })}</Status>
                        </div>
                        <Button onClick={() => Native.openDashboard()}>{t("account.openDashboard")}</Button>
                    </>
                )}
            </div>
        </Section>
        {/* Perks follow the account: evi.rest only takes them from a linked Evi */}
        {state.kind === "linked" && <SupporterPerks />}
        </div>
    );
}
