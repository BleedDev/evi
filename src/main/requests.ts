import type { OnBeforeRequestListenerDetails, Session } from "electron";

export type RequestFilter = (details: OnBeforeRequestListenerDetails) => { cancel?: boolean; redirectURL?: string; } | void;

/**
 * Electron allows a single onBeforeRequest listener per session, so plugins share this one.
 * It's only installed while something subscribes, to keep the network path free otherwise.
 */
const filters = new Set<RequestFilter>();
let installedOn: Session | undefined;

export function addRequestFilter(session: Session, filter: RequestFilter) {
    filters.add(filter);

    if (installedOn !== session) {
        installedOn = session;
        session.webRequest.onBeforeRequest((details, callback) => {
            for (const f of filters) {
                try {
                    const res = f(details);
                    if (res && (res.cancel || res.redirectURL)) return callback(res);
                } catch (err) {
                    console.error("[Evi] Request filter threw", err);
                }
            }
            callback({});
        });
    }

    return () => {
        filters.delete(filter);
        // The last one gone: requests stop going through main again
        if (filters.size || !installedOn) return;
        installedOn.webRequest.onBeforeRequest(null);
        installedOn = undefined;
    };
}
