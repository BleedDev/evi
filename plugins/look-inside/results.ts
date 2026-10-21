/**
 * What Look Inside has read per attachment, kept for the session. Pure (the reading is passed in), so
 * tests/lookInside.test.ts can run it.
 *
 * The warnings under a card only need the review; the file list is only drawn while a card is open.
 * So only the last few full lists are kept: older ones are let go, keeping their review, and opening
 * such a card reads its list again (one more directory read).
 */
import { type Listing, listZip, type Reader, type Review, review } from "./zip";

/** A list that was let go; its review is still there */
export type Dropped = { kind: "dropped"; };

export type Result = { listing: Listing | Dropped; review?: Review; } | { error: true; review?: Review; };

export const isDropped = (r: Result | undefined) => !!r && "listing" in r && r.listing.kind === "dropped";

/** Results kept (a few hundred at most) */
export const MAX_RESULTS = 300;
/** Full file lists kept, for the cards checked or opened last; older ones keep only their warnings */
export const LISTINGS_KEPT = 16;

/** Keyed without the query: Discord signs attachment links with an expiry and hands out new ones for the same file */
export const keyOf = (url: string) => url.split("?")[0];

export function createResults(readerFor: (url: string) => Reader, warn: (err: unknown) => void = () => { }) {
    const results = new Map<string, Promise<Result>>();
    const settled = new Map<string, Result>();
    /** Keys whose full list is kept, least recently checked first */
    const withListing = new Set<string>();

    function keepListing(key: string) {
        withListing.delete(key);
        withListing.add(key);
        while (withListing.size > LISTINGS_KEPT) {
            const old = withListing.values().next().value!;
            withListing.delete(old);
            const r = settled.get(old);
            if (r && "listing" in r && r.listing.kind === "list") {
                const lite: Result = { listing: { kind: "dropped" }, review: r.review };
                // Same keys: the order the 300 are evicted in doesn't change
                settled.set(old, lite);
                results.set(old, Promise.resolve(lite));
            }
        }
    }

    /**
     * Reads a zip's list once per attachment. `full`: the list itself is wanted (the card is open),
     * so one that was let go is read again. Calls at the same time share one read.
     */
    function inspect(url: string, size: number, full = false): Promise<Result> {
        const key = keyOf(url);
        const before = settled.get(key);
        const dropped = full && isDropped(before) ? before : undefined;
        if (dropped) {
            results.delete(key);
            settled.delete(key);
        }
        let pending = results.get(key);
        if (!pending) {
            const read: Promise<Result> = listZip(readerFor(url), size)
                .then((listing): Result => ({ listing, review: listing.kind === "list" ? review(listing.entries) : undefined }))
                .catch((err): Result => {
                    warn(err);
                    // A failure isn't kept: the next look tries again. A list that was let go keeps its warnings.
                    if (dropped && results.get(key) === read) {
                        settled.set(key, dropped);
                        results.set(key, Promise.resolve(dropped));
                    } else if (results.get(key) === read) results.delete(key);
                    return { error: true, review: dropped?.review };
                })
                .then(result => {
                    // Evicted while reading: not kept
                    if ("error" in result || results.get(key) !== read) return result;
                    settled.set(key, result);
                    if (result.listing.kind === "list") keepListing(key);
                    return result;
                });
            pending = read;
            if (results.size >= MAX_RESULTS) {
                const oldest = results.keys().next().value!;
                results.delete(oldest);
                settled.delete(oldest);
                withListing.delete(oldest);
            }
            results.set(key, pending);
        }
        return pending;
    }

    return { inspect, settled: (url: string) => settled.get(keyOf(url)) };
}
