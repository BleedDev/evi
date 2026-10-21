/**
 * Keeps the find index (findCache.ts) for this start: hands the saved one to the patcher, and once
 * Discord has started, re-indexes in idle slices whatever it didn't cover and saves it through main.
 */
import { Logger } from "../logger";
import { allRuntimes, getOriginalFactory, wreq } from "../webpack/runtime";
import { buildFindIndex, FindCache, FindCacheData, findKey, indexSaver, parseFindCache } from "./findCache";
import { getPatchRecords, matchesFind, setFindCache } from "./source";

const logger = new Logger("FindCache", "#f7a072");

/** Long enough for Discord's startup to be over: indexing a new build reads every module once */
const FIRST_DELAY = 15_000;
const AGAIN_DELAY = 60_000;

export const currentBuild = (): string | undefined => {
    const id = (window as any).GLOBAL_ENV?.SENTRY_TAGS?.buildId;
    return typeof id === "string" && id ? id : undefined;
};

/** [id, source] of every module factory registered so far, Discord's main runtime first */
function* registeredSources(): Generator<[string, () => string]> {
    const runtimes = wreq ? [wreq, ...[...allRuntimes].filter(r => r !== wreq)] : [...allRuntimes];
    for (const runtime of runtimes) {
        for (const id of Object.keys(runtime.m)) {
            const factory = getOriginalFactory(runtime.m[id]);
            if (typeof factory === "function") yield [id, () => Function.prototype.toString.call(factory)];
        }
    }
}

export function startFindCache(raw: string | undefined, save: ((data: string) => void) | undefined) {
    if (!save) return;
    // Not the saved text itself: that would keep the whole index JSON for the session
    const saveIndex = indexSaver(raw, save);
    let timer: ReturnType<typeof setTimeout> | undefined;
    let running = false;
    let missedWhileRunning = false;
    let lastRun = 0;

    const cache = new FindCache(parseFindCache(raw), currentBuild, () => schedule());
    setFindCache(cache);

    function schedule(delay = Math.max(FIRST_DELAY, lastRun + AGAIN_DELAY - Date.now())) {
        if (running) missedWhileRunning = true;
        if (timer || running) return;
        timer = setTimeout(() => {
            timer = undefined;
            run();
        }, delay);
    }

    function run() {
        const build = currentBuild();
        const finds = new Map<string, string | RegExp>();
        for (const { patch } of getPatchRecords()) finds.set(findKey(patch.find), patch.find);
        if (!build || !finds.size) return;

        running = true;
        const steps = buildFindIndex(cache, build, [...registeredSources(), ...cache.takeUnindexed()], finds, matchesFind);
        const slice = (deadline: IdleDeadline) => {
            try {
                let step = steps.next();
                while (!step.done && deadline.timeRemaining() > 1) step = steps.next();
                if (!step.done) return void requestIdleCallback(slice);
                finish(step.value);
            } catch (err) {
                running = false;
                logger.error("Indexing failed", err);
            }
        };
        requestIdleCallback(slice);
    }

    function finish(data: FindCacheData) {
        running = false;
        lastRun = Date.now();
        cache.replace(data);
        if (missedWhileRunning) {
            missedWhileRunning = false;
            schedule();
        }
        const json = JSON.stringify(data);
        if (saveIndex(json) === "tooBig") logger.warn(`Index too big to save (${json.length} bytes)`);
    }
}
