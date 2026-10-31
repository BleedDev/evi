/**
 * Tells evi.rest when a store plugin is broken on this Discord: it can't find parts of Discord, its
 * patches fail, or it doesn't start. Enough installs saying the same marks the plugin broken for
 * everyone (the pill on store cards and in the Plugins list), usually before anyone files a bug.
 *
 * Only store plugins, and only the plugin, its version, Discord's build, the kind of problem, what
 * failed (which patches and why, which lookups, or the start error with paths and ids blanked) so its
 * author knows what to fix, and the revision of Evi's hotfix when the plugin runs with one
 * (shared/hotfixes.ts). At most once a day per plugin, version and build. Off with "Help spot broken plugins".
 */
import { type HealthKind, type HealthReportInput, lookupDetail, MAX_HEALTH_DETAILS, patchDetail, scrubError } from "@shared/health";
import { hotfixTag, inHotfixRange } from "@shared/hotfixes";
import { isPluginEnabled } from "@shared/ipc";
import { isVersion } from "@shared/store";

import { discordBuild } from "./crashReport";
import { Logger } from "./logger";
import { Native } from "./native";
import { hasPatchProblems } from "./patching/diagnose";
import { getPatchRecords } from "./patching/source";
import { diagnoseLookups, LOOKUP_GRACE_MS } from "./plugins/lookups";
import { PluginManager, PluginState } from "./plugins/manager";
import { SafeMode } from "./safeMode";
import { dueHealthReports, HealthMemory, healthKey, readHealthMemory } from "./sentReports";
import { Settings } from "./settings";
import { Store } from "./store";

const logger = new Logger("Health", "#f0b232");

/** Lookups get their grace period, then a little more for patches on code Discord loads right after */
const CHECK_AFTER_MS = LOOKUP_GRACE_MS + 10_000;
const CHECK_EVERY = 30 * 60 * 1000;
const MEMORY_KEY = "evi-health-reports";

// Discord deletes window.localStorage once it starts; Evi runs before it, so keep a reference now
const storage = (() => {
    try {
        return window.localStorage;
    } catch {
        return undefined;
    }
})();
let memoryFallback: HealthMemory = {};

function readMemory(): HealthMemory {
    try {
        return storage ? readHealthMemory(storage.getItem(MEMORY_KEY)) : memoryFallback;
    } catch {
        return memoryFallback;
    }
}

function writeMemory(memory: HealthMemory) {
    memoryFallback = memory;
    try {
        storage?.setItem(MEMORY_KEY, JSON.stringify(memory));
    } catch { }
}

interface Problem {
    kind: HealthKind;
    /** What failed, for the plugin's author (shared/health.ts) */
    detail: string[];
}

/** What's wrong with a plugin right now, if anything. Worst first: not starting, then patches, then lookups. */
function problemOf(state: PluginState): Problem | undefined {
    const { id } = state.manifest;
    if (!isPluginEnabled(Settings.data, state.manifest)) return;
    if (state.error && !state.running) return { kind: "start", detail: [scrubError(state.error)].filter(Boolean) };
    if (!state.running) return;
    if (hasPatchProblems(id)) {
        const failed = getPatchRecords(id).filter(r => r.state === "failed" || r.state === "partial");
        return { kind: "patches", detail: failed.slice(0, MAX_HEALTH_DETAILS).map(r => patchDetail(r.index, r.patch.find, r.errors)) };
    }
    // Only lookups known to be broken. A missing one may just not be loaded yet: Discord fetches some code
    // only when it's first used (search's actions, for Search Highlight), and every install that hadn't
    // searched yet reported it broken. Like a patch still waiting, it isn't reported
    const lookups = diagnoseLookups(id).filter(d => d.health === "broken");
    if (lookups.length) return { kind: "lookups", detail: lookups.slice(0, MAX_HEALTH_DETAILS).map(d => lookupDetail(d.target)) };
}

let checking = false;

/** Looks at every plugin once and reports the store ones with problems that weren't reported today */
export async function checkHealth() {
    if (checking || SafeMode.active || Settings.data.healthReports === false || !Native.reportHealth) return;
    checking = true;
    try {
        const found = PluginManager.getSnapshot()
            .filter(p => p.source !== "dev")
            .map(p => ({ state: p, problem: problemOf(p) }))
            .filter((p): p is { state: PluginState; problem: Problem; } => !!p.problem);
        if (!found.length) return;

        // Which plugins came from the store is in its installed list, loaded only when something's wrong
        if (Store.getSnapshot().status === "idle") await Store.refresh();
        const build = discordBuild();
        const reports: HealthReportInput[] = [];
        for (const { state, problem: { kind, detail } } of found) {
            const installed = Store.installedPlugin(state.manifest.id);
            const version = installed?.version ?? state.manifest.version;
            if (!installed?.fromStore || !isVersion(version)) continue;
            // Still broken with Evi's fix: said so, so evi.rest knows the fix isn't enough
            const hotfix = state.hotfix && inHotfixRange(state.hotfix, version) ? hotfixTag(state.hotfix) : undefined;
            reports.push({ plugin: state.manifest.id, version, discordBuild: build, kind, ...(hotfix && { hotfix }), ...(detail.length && { detail }) });
        }

        const { due, memory } = dueHealthReports(reports, readMemory(), Date.now());
        for (const report of due) {
            const result = await Native.reportHealth(report).catch(err => ({ ok: false as const, error: String(err) }));
            if (result.ok) logger.info(`Told evi.rest ${report.plugin} v${report.version} has a problem (${report.kind})`);
            else logger.warn(`Couldn't report ${report.plugin}: ${result.error}`);
            // Answered either way: tried again tomorrow, not every half hour
            memory[healthKey(report)] = Date.now();
        }
        writeMemory(memory);
    } catch (err) {
        logger.warn("Checking plugin health failed", err);
    } finally {
        checking = false;
    }
}

let started = false;
let timer: ReturnType<typeof setTimeout> | undefined;

function checkSoon() {
    clearTimeout(timer);
    timer = setTimeout(() => void checkHealth(), CHECK_AFTER_MS);
}

const runningIds = () => new Set(PluginManager.getSnapshot().filter(p => p.running || p.error).map(p => p.manifest.id));

/** Checks once plugins have had time to find what they need, again when one starts later, and every half hour */
export function startHealthReports() {
    if (started || SafeMode.active) return;
    started = true;
    checkSoon();
    setInterval(() => void checkHealth(), CHECK_EVERY);

    // A plugin turned on, installed or updated later gets the same grace period before its own look
    let before = runningIds();
    PluginManager.subscribe(() => {
        const now = runningIds();
        if ([...now].some(id => !before.has(id))) checkSoon();
        before = now;
    });
}
