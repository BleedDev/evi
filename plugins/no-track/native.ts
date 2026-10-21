import type { NativePlugin } from "@evi/api/native";

const TRACKING = [
    /^https:\/\/(?:[\w-]+\.)?discord(?:app)?\.com\/api\/v\d+\/(?:science|metrics)/,
    // The page's Sentry reports go through Discord's own proxy
    /^https:\/\/(?:[\w-]+\.)?discord(?:app)?\.com\/error-reporting-proxy\//,
    // Sentry itself: Discord's main process reports there directly
    /^https:\/\/(?:[\w-]+\.)*sentry\.io\//,
];

/**
 * The same, as match patterns Electron checks before main's JS sees a request: everything else
 * Discord loads (pictures, media, the rest of the API) passes without a stop in main. Looser than
 * TRACKING (a v* also spans /users/@me/science-settings), which still decides.
 */
export const TRACKING_URLS = [
    "https://*.discord.com/api/v*/science*",
    "https://*.discord.com/api/v*/metrics*",
    "https://*.discordapp.com/api/v*/science*",
    "https://*.discordapp.com/api/v*/metrics*",
    "https://*.discord.com/error-reporting-proxy/*",
    "https://*.discordapp.com/error-reporting-proxy/*",
    "https://*.sentry.io/*",
];

export const isTracking = (url: string) => TRACKING.some(re => re.test(url));

let blocked = 0;

export default {
    start(ctx) {
        ctx.onBeforeRequest(({ url }) => {
            if (!isTracking(url)) return;
            blocked++;
            return { cancel: true };
        }, TRACKING_URLS);
    },

    /** Called from the renderer via ctx.native.call("getBlockedCount") */
    getBlockedCount() {
        return blocked;
    },
} satisfies NativePlugin;
