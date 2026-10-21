import type { SourcePatch } from "@evi/api";

/**
 * Stops Discord's tracking where it starts, in the page. Blocking the uploads in main alone left
 * Discord building, queueing and batching every event, retrying the failed uploads, and running
 * Sentry, which wraps fetch, XHR, console, timers and DOM listeners to collect breadcrumbs.
 *
 * Every patch is optional: if Discord changes one of these spots, that piece of tracking simply
 * runs again (and main still blocks its upload). Nothing here touches what the API sees otherwise.
 */
export const PATCHES = {
    /**
     * Discord's analytics module (AnalyticsTrackingStore and trackMaker, one module):
     *     eg=e=>{let{addBreadcrumb:t,analyticEventConfigs:i,dispatcher:r,TRACK_ACTION_NAME:a}=e,s=...;return function(e,r){...}}
     * returns the `track` every event goes through: a Sentry breadcrumb plus a TRACK dispatch through
     * Flux, then queued for upload. It resolves now, so code that awaits an event (some wait for a
     * flush) carries on, where before a blocked upload left it waiting.
     *
     *     Y.handleTrack=function(e){...}
     * queues a TRACK dispatched by anything else: dropped, resolved the same way.
     *
     *     function g(e,t){let n=Date.now(),r=e.map(e=>({...e,properties:{...e.properties,client_send_timestamp:n}}));...
     * sends a batch (also the hourly client telemetry): never posts, so nothing is retried.
     *
     * Evi's own collectibles patch this module first (they take Evi SKUs out of every event) and
     * put a call at the start of each of these functions, `function g(e,t){…scrubAll(e);let n=…`
     * included. So the batch match allows a few statements before `let`, but no braces, which
     * keeps it inside that one function.
     */
    analytics: {
        find: '"AnalyticsTrackingStore"',
        optional: true,
        replace: [
            {
                match: /(?<=TRACK_ACTION_NAME:\i\}=\i,[^]{0,400}?)return function\(\i,\i\)\{/,
                with: "$&return $self?.dropped?.(),Promise.resolve();",
            },
            {
                match: /\.handleTrack=function\((\i)\)\{/,
                with: "$&return $self?.dropped?.(),$1?.resolve?.(),!1;",
            },
            {
                match: /function \i\(\i,\i\)\{(?=[^{}]{0,200}?let \i=Date\.now\(\),\i=\i\.map\(\i=>\(\{\.\.\.\i,properties:\{\.\.\.\i\.properties,client_send_timestamp)/,
                with: "$&return Promise.resolve();",
            },
        ],
    },

    /**
     * Discord's metrics counters (POST /metrics/v2 every two minutes or every 100 metrics):
     *     _flush(){if(this._metrics.length>0){...url:o.Rsh.METRICS_V2...}this._metrics=[]}
     * Flushing just empties the list.
     */
    metrics: {
        find: ".METRICS_V2,body:{metrics:",
        optional: true,
        replace: {
            match: /_flush\(\)\{(?=if\(this\._metrics\.length>0\))/,
            with: "$&this._metrics=[];return;",
        },
    },

    /**
     * Discord's Sentry, its own little bundle:
     *     window.DiscordSentry=function(){t.Ts({tunnel:"/error-reporting-proxy/web",dsn:...,integrations:[...]})...}()
     * With `enabled: false` Sentry never sets up its integrations (the fetch/XHR/console/DOM
     * wrappers and global error handlers) and never sends. window.DiscordSentry stays, so Discord's
     * calls into it still work and do nothing.
     */
    sentry: {
        find: "window.DiscordSentry=function(){",
        optional: true,
        replace: {
            match: /(?<=window\.DiscordSentry=function\(\)\{\i\.\i\(\{)/,
            with: "enabled:!1,defaultIntegrations:!1,",
        },
    },
} satisfies Record<string, SourcePatch>;
