/**
 *   bun scripts/coreData.ts <dir>
 *
 * The core's data files, which main reads when one is needed instead of every window carrying them in
 * its bundle: locale-<tag>.json for each of Evi's languages but English (bundled, the fallback).
 * scripts/build.ts runs this in its own process each build, so --watch reads the sources fresh: Bun
 * keeps what a process imported once.
 */
import { writeFileSync } from "fs";
import { join } from "path";

import { CATALOGS } from "../src/shared/locales";

const out = process.argv[2];
if (!out) {
    console.error("Usage: bun scripts/coreData.ts <dir>");
    process.exit(1);
}

for (const [tag, messages] of Object.entries(CATALOGS)) {
    if (tag !== "en") writeFileSync(join(out, `locale-${tag}.json`), JSON.stringify(messages));
}
