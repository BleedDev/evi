//! Finding Discord installs, telling whether Evi is in them, and closing/starting them.
//! Ported from src/cli/discord.ts.

use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::Serialize;

use crate::asar::{read_asar_file, LEGACY_SHIM_MARKERS, ORIGINAL_ASAR, SHIM_MARKER};

/// (flavor, folder in %LOCALAPPDATA% and executable name, label)
pub const FLAVORS: [(&str, &str, &str); 4] = [
    ("stable", "Discord", "Stable"),
    ("ptb", "DiscordPTB", "PTB"),
    ("canary", "DiscordCanary", "Canary"),
    ("development", "DiscordDevelopment", "Development"),
];

fn flavor_entry(flavor: &str) -> Option<&'static (&'static str, &'static str, &'static str)> {
    FLAVORS.iter().find(|f| f.0 == flavor)
}

pub fn flavor_folder(flavor: &str) -> &'static str {
    flavor_entry(flavor).map_or("Discord", |f| f.1)
}

pub fn flavor_label(flavor: &str) -> &'static str {
    flavor_entry(flavor).map_or("Discord", |f| f.2)
}

#[derive(Clone, Copy, PartialEq, Eq, Serialize, Debug)]
#[serde(rename_all = "kebab-case")]
pub enum InjectionState {
    Missing,
    Clean,
    Evi,
    OtherMod,
}

#[derive(Clone, Debug)]
pub struct DiscordVersion {
    pub version: String,
    pub resources: PathBuf,
}

#[derive(Clone, Debug)]
pub struct DiscordInstall {
    pub flavor: &'static str,
    /// %LOCALAPPDATA%\Discord on Windows, the .app bundle on macOS, the install folder on Linux
    pub root: PathBuf,
    /// Versions, newest first. macOS and Linux system packages keep one in place
    pub versions: Vec<DiscordVersion>,
}

#[cfg(not(target_os = "macos"))]
fn version_key(s: &str) -> Vec<u64> {
    s.split('.').map(|p| p.parse().unwrap_or(0)).collect()
}

/// app-x.y.z folders inside `root`, newest first (Windows %LOCALAPPDATA%\Discord, Linux ~/.config/discord)
#[cfg(not(target_os = "macos"))]
fn find_app_install(flavor: &'static str, root: PathBuf) -> Option<DiscordInstall> {
    let entries = std::fs::read_dir(&root).ok()?;
    let mut versions: Vec<DiscordVersion> = entries
        .flatten()
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().into_owned();
            let digit = name.strip_prefix("app-").and_then(|rest| rest.chars().next()).is_some_and(|c| c.is_ascii_digit());
            let resources = root.join(&name).join("resources");
            (digit && resources.join("app.asar").exists()).then(|| DiscordVersion { version: name[4..].to_string(), resources })
        })
        .collect();
    versions.sort_by_key(|v| std::cmp::Reverse(version_key(&v.version)));
    (!versions.is_empty()).then_some(DiscordInstall { flavor, root, versions })
}

/// Where find_installs looks, for the "not found" message
pub fn searched_locations() -> &'static str {
    if cfg!(windows) {
        "%LOCALAPPDATA%"
    } else if cfg!(target_os = "macos") {
        "/Applications and ~/Applications"
    } else {
        "/usr/share, /usr/lib, /opt, ~/.local/share, ~/.config and ~ (Flatpak and Snap aren't supported)"
    }
}

#[cfg(unix)]
fn build_version(resources: &Path) -> String {
    std::fs::read_to_string(resources.join("build_info.json"))
        .ok()
        .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
        .and_then(|v| v.get("version").filter(|v| !v.is_null()).map(|v| v.as_str().map_or_else(|| v.to_string(), String::from)))
        .unwrap_or_else(|| "?".into())
}

#[cfg(windows)]
pub fn find_installs() -> Vec<DiscordInstall> {
    let Some(local) = std::env::var_os("LOCALAPPDATA").filter(|v| !v.is_empty()) else { return vec![] };
    FLAVORS.into_iter().filter_map(|(flavor, folder, _)| find_app_install(flavor, PathBuf::from(&local).join(folder))).collect()
}

/// Discord keeps one version in place on macOS and Linux system packages: the first candidate folder that has it wins
#[cfg(unix)]
fn find_in_place(flavor: &'static str, candidates: &[PathBuf], resources_dir: &Path) -> Option<DiscordInstall> {
    let found = candidates.iter().find(|root| root.join(resources_dir).join("app.asar").exists())?;
    // /usr/share/discord is often a link to /opt/discord, and running processes report the real path
    let root = std::fs::canonicalize(found).unwrap_or_else(|_| found.clone());
    let resources = root.join(resources_dir);
    Some(DiscordInstall { flavor, root, versions: vec![DiscordVersion { version: build_version(&resources), resources }] })
}

#[cfg(target_os = "macos")]
pub fn find_installs() -> Vec<DiscordInstall> {
    let home = crate::paths::user_home();
    let resources = Path::new("Contents").join("Resources");
    FLAVORS
        .into_iter()
        .filter_map(|(flavor, _, label)| {
            let app = if flavor == "stable" { "Discord.app".to_string() } else { format!("Discord {label}.app") };
            find_in_place(flavor, &[PathBuf::from("/Applications").join(&app), home.join("Applications").join(&app)], &resources)
        })
        .collect()
}

#[cfg(all(unix, not(target_os = "macos")))]
pub fn find_installs() -> Vec<DiscordInstall> {
    let home = crate::paths::user_home();
    let config = crate::paths::app_data();
    FLAVORS
        .into_iter()
        .filter_map(|(flavor, folder, _)| {
            // Official updater_bootstrap installs to ~/.config/<discord|discordptb|discordcanary|discorddevelopment>/app-x.y.z
            find_app_install(flavor, config.join(folder.to_ascii_lowercase())).or_else(|| {
                let slug = if flavor == "stable" { "discord".to_string() } else { format!("discord-{flavor}") };
                let candidates = [
                    PathBuf::from(format!("/usr/share/{slug}")),
                    PathBuf::from(format!("/usr/lib/{slug}")),
                    PathBuf::from(format!("/usr/lib64/{slug}")),
                    PathBuf::from(format!("/opt/{slug}")),
                    PathBuf::from(format!("/opt/{folder}")),
                    home.join(".local").join("share").join(&slug),
                    home.join(folder),
                ];
                find_in_place(flavor, &candidates, Path::new("resources"))
            })
        })
        .collect()
}

/// A write probe triggers macOS's App Management prompt before an install starts.
pub fn access_problem(resources: &Path) -> Option<&'static str> {
    if !cfg!(target_os = "macos") {
        return None;
    }
    let probe = resources.join(".evi-access-check");
    match std::fs::write(&probe, b"") {
        Ok(()) => {
            let _ = std::fs::remove_file(probe);
            None
        }
        Err(e) => match e.raw_os_error() {
            Some(1) => Some("app-management"), // EPERM: macOS privacy protection
            Some(13) => Some("no-access"), // EACCES: file permissions
            _ => None,
        },
    }
}

pub fn is_our_shim(asar: &Path) -> bool {
    read_asar_file(asar, "index.js")
        .is_ok_and(|code| std::iter::once(SHIM_MARKER).chain(LEGACY_SHIM_MARKERS.iter().copied()).any(|m| code.starts_with(m)))
}

/// Loaders are a few KB, Discord's own archive is megabytes. On Linux a package upgrade puts Discord's
/// archive back as app.asar and leaves the old _app.asar beside it, which isn't another mod.
fn is_discord_archive(asar: &Path) -> bool {
    std::fs::metadata(asar).is_ok_and(|m| m.len() > 256 * 1024)
}

pub fn injection_state(resources: &Path) -> InjectionState {
    let asar = resources.join("app.asar");
    if is_our_shim(&asar) {
        return InjectionState::Evi;
    }
    if !cfg!(windows) && is_discord_archive(&asar) && !resources.join("app").exists() {
        return InjectionState::Clean;
    }
    // Vencord, Equicord and friends use the same _app.asar swap, or an app folder
    if resources.join(ORIGINAL_ASAR).exists() || resources.join("app").exists() {
        return InjectionState::OtherMod;
    }
    InjectionState::Clean
}

/// Which Evi the loader starts: the core folder it points at, read back from the loader's code
pub fn shim_core_dir(resources: &Path) -> Option<PathBuf> {
    let code = read_asar_file(&resources.join("app.asar"), "index.js").ok()?;
    // Every require("…") of a JSON string literal; the core's main.js is the one the loader starts
    code.match_indices("require(\"").find_map(|(i, _)| {
        let path = serde_json::Deserializer::from_str(&code[i + "require(".len()..]).into_iter::<String>().next()?.ok()?;
        Path::new(&path).parent().filter(|_| path.ends_with("main.js")).map(Path::to_path_buf)
    })
}

/// The version of the core in a folder: the build inlines it into main.js's startup line
pub fn core_version(core_dir: &Path) -> Option<String> {
    let main = std::fs::read_to_string(core_dir.join("main.js")).ok()?;
    let (_, rest) = main.split_once("[Evi] v${\"")?;
    let (version, _) = rest.split_once('"')?;
    (!version.is_empty() && version.len() < 40).then(|| version.to_string())
}

#[cfg(windows)]
fn discord_processes(install: &DiscordInstall) -> Vec<u32> {
    use windows_sys::Win32::Foundation::{CloseHandle, INVALID_HANDLE_VALUE};
    use windows_sys::Win32::System::Diagnostics::ToolHelp::{CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS};
    use windows_sys::Win32::System::Threading::{OpenProcess, QueryFullProcessImageNameW, PROCESS_QUERY_LIMITED_INFORMATION};

    let exe_name = format!("{}.exe", flavor_folder(install.flavor)).to_lowercase();
    let root = format!("{}\\", install.root.to_string_lossy().to_lowercase());
    let mut pids = Vec::new();
    unsafe {
        let snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
        if snap == INVALID_HANDLE_VALUE {
            return pids;
        }
        let mut entry: PROCESSENTRY32W = std::mem::zeroed();
        entry.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
        let mut ok = Process32FirstW(snap, &mut entry);
        while ok != 0 {
            let len = entry.szExeFile.iter().position(|&c| c == 0).unwrap_or(entry.szExeFile.len());
            let name = String::from_utf16_lossy(&entry.szExeFile[..len]).to_lowercase();
            if name == exe_name {
                let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, entry.th32ProcessID);
                if !handle.is_null() {
                    let mut buf = [0u16; 1024];
                    let mut size = buf.len() as u32;
                    if QueryFullProcessImageNameW(handle, 0, buf.as_mut_ptr(), &mut size) != 0 {
                        let path = String::from_utf16_lossy(&buf[..size as usize]).to_lowercase();
                        if path.starts_with(&root) {
                            pids.push(entry.th32ProcessID);
                        }
                    }
                    CloseHandle(handle);
                }
            }
            ok = Process32NextW(snap, &mut entry);
        }
        CloseHandle(snap);
    }
    pids
}

/// Every process's executable: /proc on Linux, ps on macOS (where the comm column is the full path)
#[cfg(unix)]
fn unix_processes() -> Vec<(u32, String)> {
    if cfg!(target_os = "linux") {
        let Ok(entries) = std::fs::read_dir("/proc") else { return vec![] };
        return entries
            .flatten()
            .filter_map(|e| {
                let pid = e.file_name().to_string_lossy().parse::<u32>().ok()?;
                let exe = std::fs::read_link(e.path().join("exe")).ok()?;
                Some((pid, exe.to_string_lossy().into_owned()))
            })
            .collect();
    }
    let Ok(out) = std::process::Command::new("ps").args(["-axww", "-o", "pid=,comm="]).output() else { return vec![] };
    String::from_utf8_lossy(&out.stdout)
        .lines()
        .filter_map(|line| {
            let line = line.trim_start();
            let (pid, exe) = line.split_once(char::is_whitespace)?;
            Some((pid.parse().ok()?, exe.trim().to_string()))
        })
        .collect()
}

/// Ids of this install's running processes. Matched by path, so other installs are never touched.
#[cfg(unix)]
fn discord_processes(install: &DiscordInstall) -> Vec<u32> {
    let root = format!("{}/", install.root.to_string_lossy());
    let me = std::process::id();
    unix_processes().into_iter().filter(|(pid, exe)| *pid != me && exe.starts_with(&root)).map(|(pid, _)| pid).collect()
}

pub fn is_discord_running(install: &DiscordInstall) -> bool {
    !discord_processes(install).is_empty()
}

fn wait_until_closed(install: &DiscordInstall, tries: u32) {
    for _ in 0..tries {
        if !is_discord_running(install) {
            return;
        }
        std::thread::sleep(Duration::from_millis(100));
    }
}

pub fn kill_discord(install: &DiscordInstall) {
    #[cfg(windows)]
    unsafe {
        use windows_sys::Win32::Foundation::CloseHandle;
        use windows_sys::Win32::System::Threading::{OpenProcess, TerminateProcess, PROCESS_TERMINATE};
        for pid in discord_processes(install) {
            let handle = OpenProcess(PROCESS_TERMINATE, 0, pid);
            if !handle.is_null() {
                TerminateProcess(handle, 1);
                CloseHandle(handle);
            }
        }
    }
    #[cfg(unix)]
    {
        let signal = |sig: i32| {
            for pid in discord_processes(install) {
                unsafe { libc::kill(pid as i32, sig) };
            }
        };
        // A chance to quit cleanly first, like the tray's Quit
        signal(libc::SIGTERM);
        wait_until_closed(install, 30);
        signal(libc::SIGKILL);
    }
    // Wait until every process is gone, the archive stays locked until then
    wait_until_closed(install, 50);
}

/// False when Discord has to be started by hand: under sudo it would run as root
pub fn start_discord(install: &DiscordInstall) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        const DETACHED_PROCESS: u32 = 0x0000_0008;
        std::process::Command::new(install.root.join("Update.exe"))
            .args(["--processStart", &format!("{}.exe", flavor_folder(install.flavor))])
            .creation_flags(CREATE_NO_WINDOW | DETACHED_PROCESS)
            .spawn()
            .is_ok()
    }
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        use std::process::Stdio;
        if crate::paths::is_sudo() {
            return false;
        }
        let mut cmd = if cfg!(target_os = "macos") {
            let mut c = std::process::Command::new("open");
            c.arg(&install.root);
            c
        } else {
            std::process::Command::new(install.versions[0].resources.with_file_name(flavor_folder(install.flavor)))
        };
        cmd.stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null()).process_group(0).spawn().is_ok()
    }
}
