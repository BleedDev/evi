/**
 * Swapping Discord's archive and Evi's loader, without ever leaving Discord with no app.asar or half a
 * loader: the loader is written beside app.asar and moved in last, and a failure puts Discord's archive
 * back. installer/src/ops.rs does the same.
 */
import { renameSync, rmSync, statSync, writeFileSync } from "fs";
import { join } from "path";

import { readAsarFile } from "../shared/asar";
import { createShimAsar, ORIGINAL_ASAR, ShimOptions } from "../shared/shim";
import type { InjectionState } from "./discord";

/** The loader is written here first, then moved over app.asar */
export const NEXT_ASAR = "app.asar.new";

/** Puts the loader in Discord's place (or refreshes it), keeping Discord's archive beside it */
export function swapIn(resources: string, state: InjectionState, shim: ShimOptions) {
    const asar = join(resources, "app.asar");
    const original = join(resources, ORIGINAL_ASAR);
    const next = join(resources, NEXT_ASAR);
    const clean = state === "clean";
    const pkg = JSON.parse(readAsarFile(clean ? asar : original, "package.json"));
    let moved = false;
    try {
        writeFileSync(next, createShimAsar(shim, pkg));
        if (clean) {
            renameSync(asar, original);
            moved = true;
        }
        // rename replaces an older loader in one step, on Windows too
        renameSync(next, asar);
    } catch (err) {
        try {
            if (moved) renameSync(original, asar);
            rmSync(next, { force: true });
        } catch { }
        throw err;
    }
}

/**
 * Discord's own archive back in place of the loader. False when it's missing: deleting the loader
 * then would leave no app.asar at all.
 */
export function swapOut(resources: string) {
    const original = join(resources, ORIGINAL_ASAR);
    if (!statSync(original, { throwIfNoEntry: false })?.isFile()) return false;
    // rename replaces the loader in one step, on Windows too
    renameSync(original, join(resources, "app.asar"));
    return true;
}
