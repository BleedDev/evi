/**
 * What's new's notes for the page, read from releases.json next to main.js (scripts/coreData.ts) each
 * time it opens, which is about once per update: kept by nobody in between, in main or the page.
 */
import { ReleaseData, whatsNewNotes, WhatsNewNotes } from "@shared/changelogNotes";
import { readFileSync } from "fs";
import { join } from "path";

/** The releases since `seen` (the newest one with `seen` null) in `locale`; null when there are none or the file can't be read */
export function readWhatsNew(seen: unknown, locale: unknown, current = EVI_VERSION): WhatsNewNotes | null {
    if ((seen !== null && typeof seen !== "string") || typeof locale !== "string") return null;
    try {
        const data: ReleaseData = JSON.parse(readFileSync(join(globalThis.__eviCoreDir, "releases.json"), "utf8"));
        return whatsNewNotes(data, seen, current, locale);
    } catch {
        return null;
    }
}
