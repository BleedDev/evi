import { existsSync, readdirSync, readFileSync, readlinkSync, realpathSync, statSync } from "fs";
import { dirname, join } from "path";

import { readAsarFile } from "../shared/asar";
import { Flavor, FLAVORS } from "../shared/release";
import { LEGACY_SHIM_MARKERS, ORIGINAL_ASAR, SHIM_MARKER } from "../shared/shim";
import { compareVersions } from "../shared/store";
import { APP_DATA, isSudo, userHome } from "./paths";

export type InjectionState = "clean" | "evi" | "other-mod";

export interface DiscordInstall {
    flavor: Flavor;
    /** %LOCALAPPDATA%\Discord on Windows, the .app bundle on macOS, the install folder on Linux */
    root: string;
    /** Versions, newest first. macOS and Linux system packages keep one in place */
    versions: { version: string; resources: string; }[];
}

/** Discord's .app names on macOS */
const MAC_APPS: Record<Flavor, string> = {
    stable: "Discord.app",
    ptb: "Discord PTB.app",
    canary: "Discord Canary.app",
    development: "Discord Development.app",
};

/** Where findInstalls looks, for the "not found" message */
export function searchedLocations() {
    if (process.platform === "win32") return "%LOCALAPPDATA%";
    if (process.platform === "darwin") return "/Applications and ~/Applications";
    return "/usr/share, /usr/lib, /opt, ~/.local/share, ~/.config and ~ (Flatpak and Snap aren't supported)";
}

function buildVersion(resources: string) {
    try {
        return String(JSON.parse(readFileSync(join(resources, "build_info.json"), "utf8")).version ?? "?");
    } catch {
        return "?";
    }
}

/** app-x.y.z folders inside `root`, newest first (Windows %LOCALAPPDATA%\Discord, Linux ~/.config/discord) */
function findAppInstall(flavor: Flavor, root: string): DiscordInstall | undefined {
    if (!existsSync(root)) return;
    const versions = readdirSync(root)
        .filter(d => /^app-\d/.test(d) && existsSync(join(root, d, "resources", "app.asar")))
        .map(d => ({ version: d.slice(4), resources: join(root, d, "resources") }))
        .sort((a, b) => compareVersions(b.version, a.version));
    return versions.length ? { flavor, root, versions } : undefined;
}

/** Discord keeps one version in place on macOS and Linux system packages: the first candidate folder that has it wins */
function findInPlace(flavor: Flavor, candidates: string[], resourcesDir: string): DiscordInstall | undefined {
    const found = candidates.find(root => existsSync(join(root, resourcesDir, "app.asar")));
    if (!found) return;
    // /usr/share/discord is often a link to /opt/discord, and running processes report the real path
    const root = realpathSync(found);
    const resources = join(root, resourcesDir);
    return { flavor, root, versions: [{ version: buildVersion(resources), resources }] };
}

export function findInstalls(): DiscordInstall[] {
    const flavors = Object.keys(FLAVORS) as Flavor[];
    if (process.platform === "win32") {
        const local = process.env.LOCALAPPDATA;
        return local ? flavors.flatMap(f => findAppInstall(f, join(local, FLAVORS[f])) ?? []) : [];
    }
    const home = userHome();
    if (process.platform === "darwin") {
        return flavors.flatMap(f => findInPlace(f, ["/Applications", join(home, "Applications")].map(dir => join(dir, MAC_APPS[f])), join("Contents", "Resources")) ?? []);
    }
    if (process.platform === "linux") {
        return flavors.flatMap(flavor => {
            const slug = flavor === "stable" ? "discord" : `discord-${flavor}`;
            return findAppInstall(flavor, join(APP_DATA, FLAVORS[flavor].toLowerCase())) ?? findInPlace(flavor, [
                `/usr/share/${slug}`, `/usr/lib/${slug}`, `/usr/lib64/${slug}`, `/opt/${slug}`, `/opt/${FLAVORS[flavor]}`,
                join(home, ".local", "share", slug), join(home, FLAVORS[flavor]),
            ], "resources") ?? [];
        });
    }
    return [];
}

function isOurShim(asar: string) {
    try {
        const code = readAsarFile(asar, "index.js");
        return [SHIM_MARKER, ...LEGACY_SHIM_MARKERS].some(marker => code.startsWith(marker));
    } catch {
        return false;
    }
}

/**
 * Loaders are a few KB, Discord's own archive is megabytes. On Linux a package upgrade puts Discord's
 * archive back as app.asar and leaves the old _app.asar beside it, which isn't another mod.
 */
function isDiscordArchive(asar: string) {
    try {
        return statSync(asar).size > 256 * 1024;
    } catch {
        return false;
    }
}

export function injectionState(resources: string): InjectionState {
    const asar = join(resources, "app.asar");
    if (isOurShim(asar)) return "evi";
    if (process.platform !== "win32" && isDiscordArchive(asar) && !existsSync(join(resources, "app"))) return "clean";
    // Vencord, Equicord and friends use the same _app.asar swap, or an app folder
    if (existsSync(join(resources, ORIGINAL_ASAR)) || existsSync(join(resources, "app"))) return "other-mod";
    return "clean";
}

function windowsProcesses(install: DiscordInstall): number[] {
    const script = `Get-Process -Name "${FLAVORS[install.flavor]}" -ErrorAction SilentlyContinue | ForEach-Object { "$($_.Id)|$($_.Path)" }`;
    const out = Bun.spawnSync(["powershell", "-NoProfile", "-NonInteractive", "-Command", script]).stdout.toString();
    const root = install.root.toLowerCase() + "\\";
    return out.split(/\r?\n/).flatMap(line => {
        const [id, path] = line.trim().split("|");
        return path?.toLowerCase().startsWith(root) ? [Number(id)] : [];
    });
}

/** Every process's executable: /proc on Linux, ps on macOS (where the comm column is the full path) */
function unixProcesses(): { pid: number; exe: string; }[] {
    if (process.platform === "linux") {
        return readdirSync("/proc").filter(d => /^\d+$/.test(d)).flatMap(pid => {
            try {
                return [{ pid: Number(pid), exe: readlinkSync(`/proc/${pid}/exe`) }];
            } catch {
                return [];
            }
        });
    }
    const out = Bun.spawnSync(["ps", "-axww", "-o", "pid=,comm="]).stdout.toString();
    return out.split("\n").flatMap(line => {
        const match = line.match(/^\s*(\d+)\s+(.+)$/);
        return match ? [{ pid: Number(match[1]), exe: match[2].trim() }] : [];
    });
}

/** Ids of this install's running processes. Matched by path, so other installs are never touched. */
function discordProcesses(install: DiscordInstall): number[] {
    if (process.platform === "win32") return windowsProcesses(install);
    const root = install.root + "/";
    return unixProcesses().filter(p => p.pid !== process.pid && p.exe.startsWith(root)).map(p => p.pid);
}

export function isDiscordRunning(install: DiscordInstall) {
    return discordProcesses(install).length > 0;
}

/**
 * Waits up to `timeout` ms for this install's processes to be gone, without touching them. For the
 * in-app updater, which starts the installer as Discord quits. False if Discord is still (or again) running.
 */
export async function waitForExit(install: DiscordInstall, timeout = 60_000) {
    const until = Date.now() + timeout;
    while (isDiscordRunning(install)) {
        if (Date.now() > until) return false;
        await Bun.sleep(500);
    }
    return true;
}

export async function killDiscord(install: DiscordInstall) {
    if (process.platform === "win32") {
        for (const pid of discordProcesses(install)) Bun.spawnSync(["taskkill", "/F", "/PID", String(pid)]);
    } else {
        const signal = (name: NodeJS.Signals) => {
            for (const pid of discordProcesses(install)) {
                try {
                    process.kill(pid, name);
                } catch { }
            }
        };
        // A chance to quit cleanly first, like the tray's Quit
        signal("SIGTERM");
        for (let i = 0; i < 30 && isDiscordRunning(install); i++) await Bun.sleep(100);
        signal("SIGKILL");
    }
    // Wait until every process is gone, the archive stays locked until then
    for (let i = 0; i < 50 && isDiscordRunning(install); i++) await Bun.sleep(100);
}

/** False when launching failed or would run Discord as root under sudo. */
export function startDiscord(install: DiscordInstall) {
    if (isSudo()) return false;
    const cmd = process.platform === "win32" ? [join(install.root, "Update.exe"), "--processStart", `${FLAVORS[install.flavor]}.exe`]
        : process.platform === "darwin" ? ["open", install.root] : [join(dirname(install.versions[0].resources), FLAVORS[install.flavor])];
    try {
        Bun.spawn(cmd, { detached: true, stdio: ["ignore", "ignore", "ignore"] }).unref();
        return true;
    } catch {
        return false;
    }
}
