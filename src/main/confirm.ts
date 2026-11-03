/**
 * Asks the user directly, from main, before something only they should be able to allow.
 *
 * Plugins run in Discord's page next to Evi's own UI, so anything the page says ("the user agreed")
 * could come from a plugin. For the few actions that matter (installing a plugin with full access to
 * the computer, deleting a folder the store didn't make, badge admin actions) main shows its own
 * system dialog, which no page code can click or skip.
 *
 * Tests set EVI_TEST_CONFIRM: "yes" or "no" answers every question, "page" trusts what the page asked
 * for (the Electron test drives the store from the page). Plugins can't set main's environment.
 */
import { BrowserWindow, dialog, WebContents } from "electron";

import { mt } from "./locale";

const TEST_ANSWER = process.env.EVI_TEST_CONFIRM;

export interface ConfirmOptions {
    /** The question, one line: "Install No Track with full access to your computer?" */
    message: string;
    /** What happens and why it matters */
    detail: string;
    /** The button that says yes, naming the action: "Install" */
    confirm: string;
    /** What the page asked for, only used by the Electron test */
    pageSaid?: boolean;
    /** "info" for a question about something the Evi team already checked: no warning sign */
    type?: "info" | "warning";
}

export async function confirmWithUser(sender: WebContents | undefined, options: ConfirmOptions): Promise<boolean> {
    if (TEST_ANSWER === "yes") return true;
    if (TEST_ANSWER === "no") return false;
    if (TEST_ANSWER === "page") return options.pageSaid === true;

    const win = sender && !sender.isDestroyed() ? BrowserWindow.fromWebContents(sender) : null;
    const box: Electron.MessageBoxOptions = {
        type: options.type ?? "warning",
        title: "Evi",
        message: options.message,
        detail: options.detail,
        buttons: [options.confirm, mt("common.cancel")],
        defaultId: 1,
        cancelId: 1,
        noLink: true,
    };
    const { response } = await (win ? dialog.showMessageBox(win, box) : dialog.showMessageBox(box));
    return response === 0;
}
