/**
 * Discord's own Game Mode, which it ships behind an experiment that's off for everyone
 * (`2026-08-game-mode`). While a game runs and Discord is neither focused nor hovered, Discord caps
 * its window at 10 frames per second (30 for the in-game overlay), and turns off GIF autoplay and
 * animated emoji, with stickers animating on hover, until you come back.
 *
 * Discord's version doesn't look at calls: a stream or camera you watch on another screen would drop
 * to 10 fps. So it's a switch in Evi's Performance tab, off by default, and Evi holds it off while
 * you're in a voice channel or call.
 */
import { Logger } from "./logger";
import type { SourcePatch } from "./patching/source";
import { getPatchRecords, registerPatches } from "./patching/source";
import { SafeMode } from "./safeMode";
import { Settings } from "./settings";
import { filters, waitFor } from "./webpack/find";

const logger = new Logger("GameMode");

/**
 * GameModeStore (checked 2026-10-08):
 *     get enabled(){return c.enabled??this.isActive}...get hasRunningGame(){return u}...
 *     get isActive(){return!1!==c.enabled&&!!u&&!!l.isPlatformEmbedded&&(0,o.v)({location:"GameModeStore"}).enabled}
 * Until 2026-10-03 they were `return d.enabled` and `return!!d.enabled&&!!c&&...`; both forms match.
 * `enabled` is Discord's own choice (hover tracking keys off it), `isActive` what throttling reads.
 * With Evi's switch on, both answer for Evi; off, Discord's code runs as it was.
 */
export const gameModePatch: SourcePatch = {
    find: 'displayName="GameModeStore"',
    optional: true,
    group: true,
    replace: [
        {
            // Wrapped: Discord's `??` can't sit next to `||` without brackets
            match: /(?<=get enabled\(\)\{return )([^}]+)(?=\})/,
            with: "!!window.Evi?.gameMode?.on()||($1)",
        },
        {
            match: /(?<=get isActive\(\)\{return)(?=[^}]*\.enabled&&!!\i&&)/,
            with: " window.Evi?.gameMode?.on()?this.hasRunningGame&&!window.Evi.gameMode.held():",
        },
    ],
};

interface Store {
    emitChange(): void;
    addChangeListener(listener: () => void): void;
}
interface SelectedChannelStore extends Store {
    getVoiceChannelId(): string | null | undefined;
}

let channels: SelectedChannelStore | undefined;
const inCall = () => {
    // Can't tell before the store is there: held, never throttled by mistake
    if (!channels) return true;
    return channels.getVoiceChannelId() != null;
};

export const GameMode = {
    /** Called by the patched store */
    on: () => Settings.data.gameMode === true && !SafeMode.active,
    /** Called by the patched store: in a voice channel or call, where a stream or camera may be watched */
    held: inCall,
    /** Whether Discord's store took the patch, so the switch can do anything */
    get available() {
        return getPatchRecords("evi").some(r => r.patch === gameModePatch && r.state === "applied");
    },
    set(on: boolean) {
        Settings.update(d => void (d.gameMode = on));
    },
};

/** From boot, before Discord's modules run */
export function installGameMode() {
    registerPatches("evi", [gameModePatch]);
}

/** Tells GameModeStore when Evi's answers change: Game Mode applies itself when its store changes */
export function startGameMode() {
    waitFor<Store>(filters.byStoreName("GameModeStore"), store => {
        const changed = () => {
            try {
                store.emitChange();
            } catch (err) {
                logger.error("Couldn't update Game Mode", err);
            }
        };
        let on = GameMode.on();
        Settings.subscribe(() => {
            if (on === GameMode.on()) return;
            on = !on;
            changed();
        });
        waitFor<SelectedChannelStore>(filters.byStoreName("SelectedChannelStore"), found => {
            channels = found;
            let held = inCall();
            found.addChangeListener(() => {
                if (held === inCall()) return;
                held = !held;
                if (on) changed();
            });
            if (on) changed();
        });
    });
}
