/**
 * Prints a version's release notes, from its entry in src/shared/changelog.ts, as the markdown the
 * GitHub release gets. Fails when the version doesn't match package.json or has no entry.
 *
 *   bun scripts/release-notes.ts 0.5.3 > notes.md
 */
import pkg from "../package.json";
import { RELEASES, releaseMarkdown } from "../src/shared/changelog";

const version = process.argv[2]?.replace(/^v/, "");
if (version !== pkg.version) {
    console.error(`✗ package.json says ${pkg.version}, not ${version ?? "(no version given)"}`);
    process.exit(1);
}
const release = RELEASES.find(r => r.version === version);
if (!release) {
    console.error(`✗ No entry for ${version} in src/shared/changelog.ts. Add one, with what changed, before releasing.`);
    process.exit(1);
}
process.stdout.write(releaseMarkdown(release));
