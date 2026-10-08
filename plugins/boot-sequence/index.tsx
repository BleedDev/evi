import { definePlugin, I18n, React, showToast, useLocale } from "@evi/api";
import type { PluginContext } from "@evi/api";

import { ACCENTS, type BootConfig, EN_STRINGS, REPORT_PREFIX, type StringKey } from "./boot";
import { t } from "./strings";

/**
 * Tells main what Evi starts, as it starts it. Runs when Evi evaluates this plugin at boot, before it
 * starts any plugin: Evi starts them one by one once Discord's core modules exist, and lets its
 * listeners know after each. Main reads these lines from the console while Discord's splash is up
 * (native.ts), so nothing waits on this plugin's own turn to start.
 */
function reportBoot() {
    const evi = (window as any).Evi;
    // Not a fresh start (turned on later, or Evi isn't there): nothing to report
    if (!evi?.plugins?.subscribe || performance.now() > 60_000) return;
    if (evi.plugins.getSnapshot().some((p: any) => p.running)) return;

    const report = (data: unknown) => console.debug(REPORT_PREFIX + JSON.stringify(data));
    const lower = (name: string) => {
        try {
            return name.toLocaleLowerCase(I18n.discordLocale || undefined);
        } catch {
            return name.toLowerCase();
        }
    };

    // Evi is still loading plugins as this runs: list them once it's done, which is before any starts
    queueMicrotask(() => {
        try {
            const settings = evi.settings?.data;
            const safe = !!evi.safeMode?.active;
            const runs = (p: any) => !p.pulled && (settings?.plugins?.[p.manifest.id]?.enabled ?? p.manifest.enabledByDefault ?? false);
            // The order Evi starts them in: the order of its plugin folders
            const plugins = safe ? [] : evi.plugins.getSnapshot().filter(runs)
                .sort((a: any, b: any) => a.manifest.id < b.manifest.id ? -1 : a.manifest.id > b.manifest.id ? 1 : 0);
            const themes = (evi.themes?.getSnapshot?.() ?? []).filter((th: any) => evi.themes.isEnabled?.(th.file)).map((th: any) => th.name);
            report({ t: "hello", evi: String(evi.version ?? ""), themes, safe, plugins: plugins.map((p: any) => ({ id: p.manifest.id, name: lower(p.manifest.name) })) });

            const told = new Set<string>();
            const check = () => {
                for (const p of evi.plugins.getSnapshot()) {
                    const id = p.manifest.id;
                    if (told.has(id) || !plugins.some((q: any) => q.manifest.id === id)) continue;
                    // Started, or failed: to evaluate (no start ever comes) or in its start()
                    if (p.running) report({ t: "plugin", id, ok: true });
                    else if (p.error) report({ t: "plugin", id, ok: false });
                    else continue;
                    told.add(id);
                }
                if (told.size >= plugins.length) stop();
            };
            const unsubscribe = evi.plugins.subscribe(check);
            const timer = setTimeout(() => stop(), 60_000);
            const stop = () => {
                unsubscribe();
                clearTimeout(timer);
            };
            check();
        } catch (err) {
            console.error("[Boot Sequence]", err);
        }
    });
}

try {
    reportBoot();
} catch { }

type Settings = typeof settings;
const settings = {
    showPlugins: {
        type: "boolean",
        get label() { return t("settings.showPlugins"); },
        get description() { return t("settings.showPlugins.description"); },
        default: true,
    },
    accent: {
        type: "select",
        get label() { return t("settings.accent"); },
        get description() { return t("settings.accent.description"); },
        default: "white",
        options: (Object.keys(ACCENTS) as (keyof typeof ACCENTS)[]).map(value => ({ get label() { return t(`accent.${value}`); }, value })),
    },
    compact: {
        type: "boolean",
        get label() { return t("settings.compact"); },
        get description() { return t("settings.compact.description"); },
        default: false,
    },
} as const;

/** The splash's texts in Discord's language now, placeholders kept for main to fill */
function strings() {
    const vars = { current: "{current}", total: "{total}", seconds: "{seconds}", done: "{done}" };
    return Object.fromEntries((Object.keys(EN_STRINGS) as StringKey[]).map(key => [key, t(`boot.${key}`, vars)]));
}

function configOf(ctx: PluginContext<Settings>): BootConfig {
    const v = ctx.settings.all;
    return { showPlugins: v.showPlugins, accent: v.accent as BootConfig["accent"], compact: v.compact };
}

function save(ctx: PluginContext<Settings>) {
    ctx.native.call("save", { config: configOf(ctx), strings: strings() }).catch(err => console.error("[Boot Sequence] save failed", err));
}

function PreviewButton({ ctx }: { ctx: PluginContext<Settings>; }) {
    useLocale();
    const play = () => {
        const evi = (window as any).Evi;
        const plugins = (evi?.plugins?.getSnapshot?.() ?? [])
            .filter((p: any) => p.running)
            .sort((a: any, b: any) => a.manifest.id < b.manifest.id ? -1 : 1)
            .map((p: any) => ({ id: p.manifest.id, name: p.manifest.name.toLocaleLowerCase() }));
        const themes = (evi?.themes?.getSnapshot?.() ?? []).filter((th: any) => evi.themes.isEnabled?.(th.file)).map((th: any) => th.name);
        ctx.native.call("preview", { config: configOf(ctx), strings: strings(), evi: String(evi?.version ?? ""), themes, plugins })
            .then(ok => ok || showToast(t("preview.failed"), { type: "failure" }))
            .catch(() => showToast(t("preview.failed"), { type: "failure" }));
    };
    return (
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <p className="dl-hint" style={{ flex: 1 }}>{t("preview.hint")}</p>
            <button type="button" className="dl-button" data-variant="accent" onClick={play}>{t("preview")}</button>
        </div>
    );
}

export default definePlugin({
    settings,
    start(ctx) {
        // Main can't ask the page before Discord starts: it reads what the page saved last time
        save(ctx);
        ctx.settings.onChange(() => save(ctx));
        const unsubscribe = I18n.subscribe(() => save(ctx));
        ctx.onDispose(() => void unsubscribe?.());
    },
    settingsPanel: ctx => <PreviewButton ctx={ctx} />,
});
