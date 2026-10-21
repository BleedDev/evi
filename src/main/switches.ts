import { JS_FLAGS, LIST_SWITCHES, LOWER_MEMORY_JS_FLAGS, mergeJsFlags, mergeSwitchList } from "@shared/chromiumSwitches";
import { app } from "electron";

import { SafeMode } from "./safeMode";
import { settings } from "./settings";

/**
 * Makes every later appendSwitch of a feature list, or of --js-flags, add to what's there instead
 * of replacing it, Discord's and Sentry's included. Runs before anything appends one.
 */
export function mergeListSwitches() {
    const commandLine = app.commandLine;
    const append = commandLine.appendSwitch.bind(commandLine);
    commandLine.appendSwitch = (name: string, value?: string) => {
        if (value !== undefined && commandLine.hasSwitch(name)) {
            if (LIST_SWITCHES.has(name)) value = mergeSwitchList(commandLine.getSwitchValue(name), String(value));
            else if (name === JS_FLAGS) value = mergeJsFlags(commandLine.getSwitchValue(name), String(value));
        }
        append(name, value);
    };
}

/** Settings > Performance > Lower memory, from the start after it's turned on: V8's smaller heap */
export function applyLowerMemory() {
    if (settings.lowerMemory !== true || SafeMode.active) return;
    app.commandLine.appendSwitch(JS_FLAGS, LOWER_MEMORY_JS_FLAGS);
    console.log(`[Evi] Lower memory: --${JS_FLAGS}=${LOWER_MEMORY_JS_FLAGS}`);
}
