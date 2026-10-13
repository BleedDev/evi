/**
 * Plugin toolkit: toasts, context menu items and slash commands, built on Discord's own systems.
 * Plugins use them through ctx (auto-removed on stop) or @evi/api.
 */
import { builtInCommandsFilter, getRegisteredCommands, isCommandsHooked } from "./commands";
import { ensureMenuArgsPatch, isMenuHooked, menuFilter, resolveMenuComponents } from "./contextMenu";
import { injectMenuArgs } from "./menuArgs";
import { ensurePanelPatch } from "./panel";
import { showEviToast } from "./toastFallback";
import { legacyShowToastFilter, routerShowToastFilter, showToastFilter, toastBackend } from "./toasts";

/**
 * Registers the toolkit's source patches before Discord's modules run, but only those an enabled
 * plugin will use: the menu props patch touches ~190 modules and costs nothing when skipped.
 */
export function registerToolkitPatches(enabledPluginCode: string[]) {
    if (enabledPluginCode.some(code => /\bcontextMenu\(|addContextMenuPatch\(/.test(code))) ensureMenuArgsPatch();
    if (enabledPluginCode.some(code => /\bpanelToggle\(/.test(code))) ensurePanelPatch();
}

/** For tests and debugging */
export const Toolkit = {
    filters: { showToast: showToastFilter, routerShowToast: routerShowToastFilter, legacyShowToast: legacyShowToastFilter, menu: menuFilter, builtInCommands: builtInCommandsFilter },
    /** Which of Discord's toast systems toasts go through, or "evi" when Evi draws them */
    toastBackend,
    /** Evi's own toast, the one shown when Discord's can't be found */
    showEviToast,
    isMenuHooked,
    isCommandsHooked,
    resolveMenuComponents,
    getRegisteredCommands,
    /** What the navId patch does to a module's source */
    rewriteMenuArgs: (code: string) => code.replace(/(?<=[{,])navId:/g, injectMenuArgs),
};
