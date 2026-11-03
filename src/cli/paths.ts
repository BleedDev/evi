import { lchownSync, lstatSync, readdirSync, readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";

/** Running as root through sudo: Linux installs live in root-owned folders, so that's the usual way there */
export function isSudo() {
    return process.platform !== "win32" && process.getuid?.() === 0 && !!process.env.SUDO_USER && process.env.SUDO_USER !== "root";
}

/** The home of whoever ran us, not root's under sudo: that's where their Discord keeps Evi's data */
export function userHome() {
    if (isSudo()) {
        try {
            const entry = readFileSync("/etc/passwd", "utf8").split("\n").find(line => line.startsWith(`${process.env.SUDO_USER}:`));
            const home = entry?.split(":")[5];
            if (home) return home;
        } catch { }
    }
    return homedir();
}

/** Electron's app.getPath("appData"), which the app's data folder lives in */
function appData() {
    if (process.platform === "win32") return process.env.APPDATA ?? "";
    if (process.platform === "darwin") return join(userHome(), "Library", "Application Support");
    // sudo usually keeps XDG_CONFIG_HOME out, and root's would be the wrong one anyway
    return (!isSudo() && process.env.XDG_CONFIG_HOME) || join(userHome(), ".config");
}

export const APP_DATA = appData();

/** Files we wrote as root under sudo go back to the user, or their Discord couldn't write its settings */
export function giveBackToUser(path: string) {
    if (!isSudo()) return;
    const uid = Number(process.env.SUDO_UID), gid = Number(process.env.SUDO_GID);
    if (!Number.isInteger(uid) || !Number.isInteger(gid)) return;
    const walk = (p: string) => {
        try {
            lchownSync(p, uid, gid);
            if (lstatSync(p).isDirectory()) for (const entry of readdirSync(p)) walk(join(p, entry));
        } catch { }
    };
    walk(path);
}
