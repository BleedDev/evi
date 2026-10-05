/**
 * Where Evi runs: Discord's app, on its three release channels. Not any other *.discord.com page
 * (support, status, the developer portal), which the session preload also reaches.
 */
export const DISCORD_APP_HOSTS: readonly string[] = ["discord.com", "ptb.discord.com", "canary.discord.com"];

/**
 * Discord's in-game overlay: discord.com/overlay in its own see-through window over the game, which
 * clicks go through. Nothing of Evi's may float there (it couldn't be clicked away), and when a game
 * or its anti-cheat closes that window, it isn't Discord crashing.
 */
export function isOverlayUrl(url: string) {
    try {
        return /^\/overlay(\/|$)/.test(new URL(url).pathname);
    } catch {
        return false;
    }
}

/**
 * Discord's newer overlay (Overlay V3, "out of process"): not the /overlay page but a see-through
 * popout at /popout, opened with window.open("/popout", this name) and drawn into by the main window
 */
export const OOP_OVERLAY_WINDOW = "DISCORD_OutOfProcessOverlay";

/** Either in-game overlay: the /overlay page, or the popout the newer overlay opens over the game */
export function isOverlayWindow(url: string, name: string) {
    return isOverlayUrl(url) || name === OOP_OVERLAY_WINDOW;
}

export function isDiscordAppUrl(url: string) {
    try {
        const u = new URL(url);
        return u.protocol === "https:" && DISCORD_APP_HOSTS.includes(u.hostname);
    } catch {
        return false;
    }
}
