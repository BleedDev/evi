/**
 * Chromium reads a switch given twice as its last value, so Discord's own startup code (which sets
 * --disable-features after Evi applied plugins' switches) would silently drop the features Evi and
 * plugins asked for. These switches hold comma-separated lists, which can be merged instead.
 * --js-flags is merged too (mergeJsFlags): Discord appends --verify-snapshot-checksum to it.
 */
export const LIST_SWITCHES: ReadonlySet<string> = new Set(["enable-features", "disable-features", "enable-blink-features", "disable-blink-features"]);

/** Both lists, in order, each entry once */
export function mergeSwitchList(existing: string, added: string) {
    const entries = [...existing.split(","), ...added.split(",")].map(e => e.trim()).filter(Boolean);
    return [...new Set(entries)].join(",");
}

/** V8's flags for every renderer, space-separated */
export const JS_FLAGS = "js-flags";

/** Both sets of V8 flags. A flag in both keeps the later one: --foo_bar, --foo-bar and --no-foo-bar are one flag to V8 */
export function mergeJsFlags(existing: string, added: string) {
    const flags = new Map<string, string>();
    for (const flag of `${existing} ${added}`.split(/\s+/).filter(Boolean)) {
        const key = flag.replace(/^--?/, "").split("=")[0].replace(/_/g, "-").replace(/^no-/, "");
        flags.delete(key);
        flags.set(key, flag);
    }
    return [...flags.values()].join(" ");
}

/**
 * Settings > Performance > Lower memory: V8 keeps a smaller heap in Discord's page and Activities.
 * A young generation of 16 MB instead of up to 64 MB, an old generation that grows to 1.3x what's
 * live instead of up to 4x, and one more memory-reducing GC when idle. Read when a renderer starts.
 */
export const LOWER_MEMORY_JS_FLAGS = "--max-semi-space-size=8 --heap-growing-percent=30 --memory-reducer-gc-count=3";
