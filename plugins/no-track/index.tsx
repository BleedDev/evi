import { definePlugin, React, useLocale } from "@evi/api";
import type { PluginContext } from "@evi/api";

import { PATCHES } from "./patches";
import { t } from "./strings";

/** Analytics events the page patches stopped before Discord queued them */
let dropped = 0;

function BlockedCounter({ ctx }: { ctx: PluginContext; }) {
    useLocale();
    const [count, setCount] = React.useState<number | null>(null);
    const [stopped, setStopped] = React.useState(dropped);

    React.useEffect(() => {
        let alive = true;
        const refresh = () => {
            setStopped(dropped);
            // Main refuses while the native half isn't running: no count until it is
            ctx.native.call<number>("getBlockedCount").then(n => alive && setCount(n), () => alive && setCount(null));
        };
        refresh();
        const timer = setInterval(refresh, 2000);
        return () => {
            alive = false;
            clearInterval(timer);
        };
    }, []);

    return (
        <div role="status" style={{ fontVariantNumeric: "tabular-nums" }}>
            <p className="dl-hint">{t("counter.stopped", { count: stopped })}</p>
            <p className="dl-hint">{count === null ? t("counter.loading") : t("counter.blocked", { count })}</p>
        </div>
    );
}

/**
 * Two layers: patches.ts stops Discord's analytics, metrics and Sentry in the page, so the events
 * are never built, queued or retried, and skips the READY size report that only analytics reads;
 * native.ts blocks whatever still tries to leave, in the main process, Discord's own Sentry there
 * included.
 */
export default definePlugin({
    patches: [PATCHES.analytics, PATCHES.metrics, PATCHES.sentry, PATCHES.readySize],
    settingsPanel: ctx => <BlockedCounter ctx={ctx} />,
    /** Called by the patched analytics code for every event it stops */
    dropped() {
        dropped++;
    },
});
