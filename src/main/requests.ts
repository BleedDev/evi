import type { OnBeforeRequestListenerDetails, Session } from "electron";

export type RequestFilter = (details: OnBeforeRequestListenerDetails) => { cancel?: boolean; redirectURL?: string; } | void;

/**
 * Electron allows a single onBeforeRequest listener per session, so plugins share this one.
 * It's only installed while something subscribes, to keep the network path free otherwise.
 *
 * Filters may name the URLs they want (Chrome match patterns). The listener is registered for
 * all of them together, and Electron matches those in C++, so other requests never reach main's
 * JS (or wait on it). Every filter still sees every request that does, and checks it itself.
 */
const filters = new Map<RequestFilter, readonly string[] | undefined>();
let installedOn: Session | undefined;
/** The URL patterns the listener is registered with, joined; "" for every request */
let installedUrls: string | undefined;

function listener(details: OnBeforeRequestListenerDetails, callback: (res: { cancel?: boolean; redirectURL?: string; }) => void) {
    for (const f of filters.keys()) {
        try {
            const res = f(details);
            if (res && (res.cancel || res.redirectURL)) return callback(res);
        } catch (err) {
            console.error("[Evi] Request filter threw", err);
        }
    }
    callback({});
}

/** (Re-)registers the listener for what the filters ask for, or takes it off when none are left */
function sync(session: Session) {
    if (!filters.size) {
        // The last one gone: requests stop going through main again
        installedOn?.webRequest.onBeforeRequest(null);
        installedOn = installedUrls = undefined;
        return;
    }

    const wanted = [...filters.values()];
    const urls = wanted.some(u => !u) ? [] : [...new Set(wanted.flat() as string[])];
    const key = urls.join("\n");
    if (installedOn === session && installedUrls === key) return;

    installedOn = session;
    installedUrls = key;
    if (!urls.length) return session.webRequest.onBeforeRequest(listener);
    try {
        session.webRequest.onBeforeRequest({ urls }, listener);
    } catch (err) {
        // Electron refuses the whole list over one bad pattern: every request then, so no filter misses any
        console.error("[Evi] Invalid request filter URL pattern", err);
        installedUrls = "";
        session.webRequest.onBeforeRequest(listener);
    }
}

/** `urls`: the Chrome match patterns the filter wants. Left out (or empty), it gets every request. */
export function addRequestFilter(session: Session, filter: RequestFilter, urls?: readonly string[]) {
    filters.set(filter, urls?.length ? [...urls] : undefined);
    sync(session);

    return () => {
        if (!filters.delete(filter) || !installedOn) return;
        sync(installedOn);
    };
}
