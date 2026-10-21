/**
 * What Discord's popout windows (a popped-out call or stream, Pop Out Chat) get instead of Evi's
 * renderer: src/preload/index.ts runs this there, before the page's own script.
 *
 * A popout is drawn into by the main window, whose React and webpack it shares; the page itself has
 * no webpack, so Evi's plugins could never start there. What the main window can't do for it is CSS:
 * the fixes to Discord's stylesheets have to hold back this window's own <link>s, and Discord doesn't
 * copy <style>s in, so Evi's themes, Quick CSS and the rest are mirrored from the main window.
 */
import { startPopout } from "./popoutStyles";

startPopout(window);
