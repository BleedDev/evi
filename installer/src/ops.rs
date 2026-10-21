//! Install, uninstall and status, ported from src/cli/index.ts. The difference from the CLI: the core
//! comes from a release download instead of being embedded, and Discord is always closed and started
//! again (the GUI's buttons are the --restart).

use std::io;
use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::asar::{create_shim_asar, read_asar_file, ORIGINAL_ASAR};
use crate::discord::{self, DiscordInstall, InjectionState};
use crate::{autorepair, paths};
use crate::release::{self, CorePayload};

/// Mirrors src/shared/store.ts
const REMOVED_PLUGINS_FILE: &str = "removed-plugins.json";
const STORE_MARKER: &str = ".evi-store.json";
const RETIRED_PLUGINS: &[&str] = &["badges", "toolkit-demo"];
/// The loader is written here first, then moved over app.asar
const NEXT_ASAR: &str = "app.asar.new";

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct InstallInfo {
    pub flavor: &'static str,
    pub label: &'static str,
    /// "missing" when this Discord isn't installed, otherwise clean, evi or other-mod
    pub state: String,
    pub discord_version: Option<String>,
    pub evi_version: Option<String>,
    /// The loader points at a repo's build (evi install --dev) rather than the data folder
    pub dev_build: bool,
    pub running: bool,
    pub path: Option<String>,
    /// macOS and Linux: a watcher puts Evi back after Discord updates (autorepair.rs)
    pub auto_repair: bool,
}

pub fn status() -> Vec<InstallInfo> {
    let found = discord::find_installs();
    let core_dir = paths::data_dir().join("core");
    discord::FLAVORS
        .iter()
        .map(|&(flavor, _, label)| {
            let Some(install) = found.iter().find(|i| i.flavor == flavor) else {
                return InstallInfo { flavor, label, state: "missing".into(), discord_version: None, evi_version: None, dev_build: false, running: false, path: None, auto_repair: false };
            };
            let latest = &install.versions[0];
            let state = discord::injection_state(&latest.resources);
            let shim_core = (state == InjectionState::Evi).then(|| discord::shim_core_dir(&latest.resources)).flatten();
            let dev_build = shim_core.as_ref().is_some_and(|dir| !same_path(dir, &core_dir));
            InstallInfo {
                flavor,
                label,
                state: serde_json::to_value(state).unwrap().as_str().unwrap().to_string(),
                discord_version: Some(latest.version.clone()),
                evi_version: shim_core.as_deref().and_then(discord::core_version),
                dev_build,
                running: discord::is_discord_running(install),
                path: Some(install.root.to_string_lossy().into_owned()),
                auto_repair: autorepair::enabled(flavor),
            }
        })
        .collect()
}

fn same_path(a: &Path, b: &Path) -> bool {
    let norm = |p: &Path| paths::node_path(p).trim_end_matches(['/', '\\']).to_string();
    if cfg!(windows) {
        norm(a).eq_ignore_ascii_case(&norm(b))
    } else {
        norm(a) == norm(b)
    }
}

/// Plugin ids and file names come from a download: never let one reach outside its folder
fn safe_name(name: &str) -> bool {
    !name.is_empty() && name != "." && name != ".." && !name.contains(['/', '\\', ':', '\0'])
}

/// src/shared/store.ts isPluginId
fn is_plugin_id(id: &str) -> bool {
    let b = id.as_bytes();
    let ok = |c: &u8| c.is_ascii_lowercase() || c.is_ascii_digit();
    !b.is_empty() && b.len() <= 64 && ok(&b[0]) && ok(&b[b.len() - 1]) && b.iter().all(|c| ok(c) || *c == b'-')
}

fn removed_plugins(data_dir: &Path) -> Vec<String> {
    let Ok(text) = std::fs::read_to_string(data_dir.join(REMOVED_PLUGINS_FILE)) else { return vec![] };
    match serde_json::from_str::<serde_json::Value>(&text) {
        Ok(serde_json::Value::Array(list)) => list.iter().filter_map(|v| v.as_str()).filter(|id| is_plugin_id(id)).map(String::from).collect(),
        _ => vec![],
    }
}

/// Writes the core into the data folder and refreshes official plugins already there. Returns the path the loader points at.
pub fn prepare_core(payload: &CorePayload) -> io::Result<PathBuf> {
    let data_dir = paths::data_dir();
    let bad = |what: &str| io::Error::new(io::ErrorKind::InvalidData, format!("{} has an unsafe {what}", release::CORE_ASSET));
    if payload.core.keys().any(|f| !safe_name(f)) {
        return Err(bad("core file name"));
    }
    if payload.plugins.iter().any(|(id, files)| !safe_name(id) || files.keys().any(|f| !safe_name(f))) {
        return Err(bad("plugin file name"));
    }

    let core_dir = data_dir.join("core");
    let _ = std::fs::remove_dir_all(&core_dir);
    std::fs::create_dir_all(&core_dir)?;
    for (file, content) in &payload.core {
        std::fs::write(core_dir.join(file), content)?;
    }
    std::fs::write(core_dir.join("package.json"), r#"{"type":"commonjs"}"#)?;

    // Evi comes with no plugins: they're added from the store. Official plugins someone already has
    // (from before, when every install laid them all down) are kept up to date; ones they removed or
    // installed from the store are left alone, and nothing new is added.
    let removed = removed_plugins(&data_dir);
    for (id, files) in &payload.plugins {
        let dir = data_dir.join("plugins").join(id);
        if removed.contains(id) || !dir.join("manifest.json").exists() || dir.join(STORE_MARKER).exists() {
            continue;
        }
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir)?;
        for (file, content) in files {
            std::fs::write(dir.join(file), content)?;
        }
    }

    // Official plugins that are now part of Evi itself would show up twice
    let retired = RETIRED_PLUGINS.iter().map(|s| s.to_string()).chain(payload.retired.iter().filter(|id| safe_name(id)).cloned());
    for id in retired {
        let dir = data_dir.join("plugins").join(&id);
        if !dir.join(STORE_MARKER).exists() {
            let _ = std::fs::remove_dir_all(&dir);
        }
    }
    paths::give_back_to_user(&data_dir);

    Ok(core_dir.join("main.js"))
}

/// Why the archives couldn't be swapped, in plain words with what to do about it
fn explain(install: &DiscordInstall, err: &io::Error) -> String {
    let root = install.root.display();
    // Windows: access denied, file in use. Elsewhere: EPERM, EACCES
    let codes: &[i32] = if cfg!(windows) { &[5, 32] } else { &[1, 13] };
    if err.kind() == io::ErrorKind::PermissionDenied || err.raw_os_error().is_some_and(|c| codes.contains(&c)) {
        if cfg!(target_os = "macos") {
            return format!("macOS didn’t let the installer change {root}. Allow it in System Settings > Privacy & Security > App Management, then try again.");
        }
        if cfg!(windows) {
            return format!("Windows didn’t let the installer change {root}. Quit Discord fully (tray icon > Quit) and try again.");
        }
        if !paths::is_root() {
            return format!("{root} belongs to root, and Evi Setup couldn’t ask for your password (it needs pkexec, which comes with most desktops).");
        }
    }
    format!("Couldn’t change {root}: {err}")
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Outcome {
    pub flavor: &'static str,
    pub label: &'static str,
    pub ok: bool,
    pub message: String,
}

pub struct Progress<'a>(pub &'a dyn Fn(&str));

/// Closes Discord if it's running (the archive is locked while it is), runs the swap, and reports
/// whether Discord was running. Starting it again is up to the caller.
fn with_discord_closed(install: &DiscordInstall, progress: &Progress, action: impl FnOnce() -> io::Result<()>) -> (bool, io::Result<()>) {
    let running = discord::is_discord_running(install);
    if running {
        (progress.0)(&format!("Closing Discord {}…", discord::flavor_label(install.flavor)));
        discord::kill_discord(install);
    }
    (running, action())
}

/// Puts the loader in Discord's place (or refreshes it), keeping Discord's archive beside it. The loader
/// is written beside app.asar and moved in last, and a failure puts Discord's archive back, so Discord
/// is never left without an app.asar or with half a loader.
fn swap_in(resources: &Path, state: InjectionState, core_path: &str) -> io::Result<()> {
    let asar = resources.join("app.asar");
    let original = resources.join(ORIGINAL_ASAR);
    let clean = state == InjectionState::Clean;
    let pkg: serde_json::Value = serde_json::from_str(&read_asar_file(if clean { &asar } else { &original }, "package.json")?)
        .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, format!("Discord’s package.json is broken: {e}")))?;

    let next = resources.join(NEXT_ASAR);
    let undo = |err: io::Error, moved: bool| {
        if moved {
            let _ = std::fs::rename(&original, &asar);
        }
        let _ = std::fs::remove_file(&next);
        Err(err)
    };
    if let Err(e) = std::fs::write(&next, create_shim_asar(core_path, &pkg)) {
        return undo(e, false);
    }
    if clean {
        if let Err(e) = std::fs::rename(&asar, &original) {
            return undo(e, false);
        }
    }
    // rename replaces an older loader in one step, on Windows too
    std::fs::rename(&next, &asar).or_else(|e| undo(e, clean))
}

/// Discord's own archive back in place of the loader in one version folder
fn swap_out_folder(resources: &Path) -> io::Result<()> {
    let original = resources.join(ORIGINAL_ASAR);
    // Deleting the loader first would leave no app.asar at all when Discord's archive is gone or can't move
    if !original.is_file() {
        return Err(io::Error::new(io::ErrorKind::NotFound, format!("Discord’s own archive ({ORIGINAL_ASAR}) is missing from {}, so Evi was left there", resources.display())));
    }
    // rename replaces the loader in one step, on Windows too
    std::fs::rename(&original, resources.join("app.asar"))
}

/// Discord's own archive back in place, in every version folder that has Evi. Returns how many
fn swap_out(install: &DiscordInstall) -> io::Result<usize> {
    let mut removed = 0;
    let mut failed = None;
    // Every version folder, the auto-repair may have injected older ones too. One that can't be
    // restored doesn't stop the others
    for v in &install.versions {
        if discord::injection_state(&v.resources) != InjectionState::Evi {
            continue;
        }
        match swap_out_folder(&v.resources) {
            Ok(()) => removed += 1,
            Err(e) => failed = failed.or(Some(e)),
        }
    }
    failed.map_or(Ok(removed), Err)
}

fn denied(err: &io::Error) -> bool {
    err.kind() == io::ErrorKind::PermissionDenied || (!cfg!(windows) && err.raw_os_error().is_some_and(|c| c == 1 || c == 13))
}

/// Linux installs from packages belong to root. Instead of sending people to a terminal, run this
/// same program as root through pkexec, which shows the desktop's own password prompt, for just the
/// part that needs it. None when that isn't possible here (not Linux, already root, no pkexec).
/// Ok holds the last line the helper printed, if any.
fn elevated(args: &[&str]) -> Option<Result<String, String>> {
    if !cfg!(target_os = "linux") || paths::is_root() {
        return None;
    }
    let exe = std::env::current_exe().ok()?;
    let out = std::process::Command::new("pkexec").arg(exe).arg("--headless").args(args).output().ok()?;
    // pkexec: 126 when the password prompt was dismissed, 127 when not authorized
    Some(match out.status.code() {
        Some(0) => Ok(String::from_utf8_lossy(&out.stdout).trim().lines().last().unwrap_or("").to_string()),
        Some(126) | Some(127) => Err("Evi Setup needs your password to change Discord’s folder, which belongs to root.".into()),
        _ => Err(String::from_utf8_lossy(&out.stderr).trim().lines().last().unwrap_or("The part that needs your password failed.").to_string()),
    })
}

/// What an install says about Discord updates, once the watcher is set up or couldn't be
fn after_updates(watcher: Result<(), String>) -> String {
    match watcher {
        Ok(()) => " It comes back by itself after Discord updates.".into(),
        Err(e) => format!(" Discord updates will remove it: open Evi Setup again after one ({e})."),
    }
}

/// Sets up the watcher and says so. The loader itself is already in, so a failure here is only a note
fn keep_after_updates(install: &DiscordInstall, core_path: &str) -> String {
    if cfg!(windows) {
        return String::new();
    }
    after_updates(autorepair::enable(install, core_path))
}

pub struct RunResult {
    pub outcomes: Vec<Outcome>,
    /// Discords we closed or installed into, to start again
    pub restart: Vec<DiscordInstall>,
}

pub fn install(flavors: &[String], payload: &CorePayload, progress: &Progress) -> Result<RunResult, String> {
    let mut result = RunResult { outcomes: vec![], restart: vec![] };
    let outcome = |discord: &DiscordInstall, ok, message: String| Outcome { flavor: discord.flavor, label: discord::flavor_label(discord.flavor), ok, message };

    // The core is shared by every Discord: only rewrite it when at least one can take Evi
    let mut targets = vec![];
    for discord in selected(flavors)? {
        let state = discord::injection_state(&discord.versions[0].resources);
        if state == InjectionState::OtherMod {
            let message = format!("Another client mod (Vencord, Equicord, …) is installed in Discord {}. Uninstall it first.", discord::flavor_label(discord.flavor));
            result.outcomes.push(outcome(&discord, false, message));
        } else {
            targets.push((discord, state));
        }
    }
    if targets.is_empty() {
        return Ok(result);
    }

    (progress.0)("Writing Evi’s files…");
    let core_path = prepare_core(payload).map_err(|e| format!("Couldn’t write Evi’s files to {}: {e}", paths::data_dir().display()))?;
    let core_path = paths::node_path(&core_path);

    for (discord, state) in targets {
        let label = discord::flavor_label(discord.flavor);
        let latest = &discord.versions[0];
        (progress.0)(&format!("Installing into Discord {label}…"));
        let (was_running, swapped) = with_discord_closed(&discord, progress, || swap_in(&latest.resources, state, &core_path));
        let swapped = match swapped {
            Ok(()) => Ok(keep_after_updates(&discord, &core_path)),
            Err(e) if denied(&e) => {
                (progress.0)("Asking for your password…");
                // The helper sets up the watcher too: Discord's folder being root's, so is the watcher.
                // It prints why when only the watcher couldn't be set up
                elevated(&["swap", "--flavor", discord.flavor, "--core", &core_path])
                    .unwrap_or_else(|| Err(explain(&discord, &e)))
                    .map(|note| after_updates(if note.is_empty() { Ok(()) } else { Err(note) }))
            }
            Err(e) => Err(explain(&discord, &e)),
        };
        // Started again whether or not it worked: a Discord we closed never stays closed
        if swapped.is_ok() || was_running {
            result.restart.push(discord.clone());
        }
        match swapped {
            Ok(note) => {
                let verb = if state == InjectionState::Evi { "Updated" } else { "Installed" };
                result.outcomes.push(outcome(&discord, true, format!("{verb} Evi {} in Discord {label} {}.{note}", payload.version, latest.version)));
            }
            Err(message) => result.outcomes.push(outcome(&discord, false, message)),
        }
    }
    Ok(result)
}

pub fn uninstall(flavors: &[String], progress: &Progress) -> Result<RunResult, String> {
    let mut result = RunResult { outcomes: vec![], restart: vec![] };
    for discord in selected(flavors)? {
        let label = discord::flavor_label(discord.flavor);
        let outcome = |ok, message: String| Outcome { flavor: discord.flavor, label, ok, message };
        (progress.0)(&format!("Removing Evi from Discord {label}…"));
        // The watcher goes first, or it would put Evi straight back
        autorepair::disable(discord.flavor);
        // Nothing to remove: never close a Discord (and drop its call) for that
        if !discord.versions.iter().any(|v| discord::injection_state(&v.resources) == InjectionState::Evi) {
            result.outcomes.push(outcome(true, format!("Evi wasn’t installed in Discord {label}")));
            continue;
        }
        let mut removed = 0;
        let (was_running, swapped) = with_discord_closed(&discord, progress, || swap_out(&discord).map(|n| removed = n));
        let swapped = match swapped {
            Ok(()) => Ok(removed > 0),
            Err(e) if denied(&e) => {
                (progress.0)("Asking for your password…");
                elevated(&["unswap", "--flavor", discord.flavor]).unwrap_or_else(|| Err(explain(&discord, &e))).map(|_| true)
            }
            Err(e) => Err(explain(&discord, &e)),
        };
        // Started again whether or not it worked: a Discord we closed never stays closed
        if was_running {
            result.restart.push(discord.clone());
        }
        match swapped {
            Ok(removed) => {
                let message = if removed { format!("Removed Evi from Discord {label}") } else { format!("Evi wasn’t installed in Discord {label}") };
                result.outcomes.push(outcome(true, message));
            }
            Err(message) => result.outcomes.push(outcome(false, message)),
        }
    }
    Ok(result)
}

fn selected(flavors: &[String]) -> Result<Vec<DiscordInstall>, String> {
    let installs = discord::find_installs();
    if installs.is_empty() {
        return Err(format!("No Discord installation found in {}.", discord::searched_locations()));
    }
    let all = flavors.iter().any(|f| f == "all");
    let picked: Vec<_> = installs.into_iter().filter(|i| all || flavors.iter().any(|f| f == i.flavor)).collect();
    if picked.is_empty() {
        return Err("None of the chosen Discord installs were found.".into());
    }
    Ok(picked)
}

/// Starts the Discords again. Returns the labels that have to be started by hand (under sudo).
pub fn restart(installs: &[DiscordInstall]) -> Vec<&'static str> {
    installs.iter().filter(|i| !discord::start_discord(i)).map(|i| discord::flavor_label(i.flavor)).collect()
}

fn one(flavor: &str) -> Result<DiscordInstall, String> {
    discord::find_installs().into_iter().find(|i| i.flavor == flavor).ok_or_else(|| format!("Discord {flavor} isn’t installed."))
}

/// What the watcher runs when Discord's folder changed. Puts the loader back only where Discord's own
/// archive is in place again: never closes Discord, never touches another mod, never rewrites the core.
pub fn relink(flavor: &str, core_path: &str) -> Result<bool, String> {
    // Evi's data folder is gone: a loader pointing at nothing would only start Discord vanilla
    if !Path::new(core_path).exists() {
        return Ok(false);
    }
    // An update writes many files: give it a moment to finish before looking
    std::thread::sleep(std::time::Duration::from_secs(3));
    let install = one(flavor)?;
    let resources = &install.versions[0].resources;
    if discord::injection_state(resources) != InjectionState::Clean {
        return Ok(false);
    }
    swap_in(resources, InjectionState::Clean, core_path).map_err(|e| explain(&install, &e))?;
    Ok(true)
}

/// The part of an install that needs root, run through pkexec by an Evi Setup that doesn't have it.
/// Discord is already closed and the core written: only the loader and the watcher are left. The
/// loader is what counts: a watcher that couldn't be set up comes back as a note, not a failure.
pub fn elevated_swap(flavor: &str, core_path: &str) -> Result<Option<String>, String> {
    let install = one(flavor)?;
    let resources = &install.versions[0].resources;
    let state = discord::injection_state(resources);
    if state == InjectionState::OtherMod {
        return Err(format!("Another client mod is installed in Discord {}.", discord::flavor_label(flavor)));
    }
    swap_in(resources, state, core_path).map_err(|e| explain(&install, &e))?;
    Ok(autorepair::enable(&install, core_path).err())
}

/// The part of an uninstall that needs root: the system watcher, then Discord's own archive back
pub fn elevated_unswap(flavor: &str) -> Result<(), String> {
    let install = one(flavor)?;
    autorepair::disable(flavor);
    swap_out(&install).map(|_| ()).map_err(|e| explain(&install, &e))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::asar::{create_asar, SHIM_MARKER};

    fn resources(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("evi-ops-test-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn discord_asar() -> Vec<u8> {
        create_asar(&[("package.json", r#"{"name":"discord","productName":"Discord"}"#.to_string()), ("index.js", "// discord".to_string())])
    }

    fn read(path: PathBuf) -> Vec<u8> {
        std::fs::read(path).unwrap()
    }

    #[test]
    fn swap_in_moves_discord_aside_and_back() {
        let dir = resources("swap");
        std::fs::write(dir.join("app.asar"), discord_asar()).unwrap();
        swap_in(&dir, InjectionState::Clean, "/x/core/main.js").unwrap();
        assert!(read_asar_file(&dir.join("app.asar"), "index.js").unwrap().starts_with(SHIM_MARKER));
        assert_eq!(read(dir.join(ORIGINAL_ASAR)), discord_asar());
        assert!(!dir.join(NEXT_ASAR).exists());

        // An update replaces the loader
        swap_in(&dir, InjectionState::Evi, "/y/core/main.js").unwrap();
        assert!(read_asar_file(&dir.join("app.asar"), "index.js").unwrap().contains("/y/core/main.js"));

        swap_out_folder(&dir).unwrap();
        assert_eq!(read(dir.join("app.asar")), discord_asar());
        assert!(!dir.join(ORIGINAL_ASAR).exists());
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn failed_install_leaves_discord_as_it_was() {
        let dir = resources("install-fails");
        std::fs::write(dir.join("app.asar"), discord_asar()).unwrap();
        // Something in the way of the new loader: the write fails
        std::fs::create_dir(dir.join(NEXT_ASAR)).unwrap();
        assert!(swap_in(&dir, InjectionState::Clean, "/x/core/main.js").is_err());
        assert_eq!(read(dir.join("app.asar")), discord_asar());
        assert!(!dir.join(ORIGINAL_ASAR).exists());

        // A broken archive is read before anything moves
        std::fs::write(dir.join("app.asar"), b"broken").unwrap();
        assert!(swap_in(&dir, InjectionState::Clean, "/x/core/main.js").is_err());
        assert_eq!(read(dir.join("app.asar")), b"broken");
        assert!(!dir.join(ORIGINAL_ASAR).exists());
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn failed_update_keeps_the_old_loader() {
        let dir = resources("update-fails");
        std::fs::write(dir.join("app.asar"), discord_asar()).unwrap();
        swap_in(&dir, InjectionState::Clean, "/x/core/main.js").unwrap();
        let loader = read(dir.join("app.asar"));
        std::fs::create_dir(dir.join(NEXT_ASAR)).unwrap();
        assert!(swap_in(&dir, InjectionState::Evi, "/y/core/main.js").is_err());
        assert_eq!(read(dir.join("app.asar")), loader);
        assert_eq!(read(dir.join(ORIGINAL_ASAR)), discord_asar());
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn uninstall_keeps_the_loader_when_discords_archive_is_gone() {
        let dir = resources("unswap-missing");
        std::fs::write(dir.join("app.asar"), discord_asar()).unwrap();
        swap_in(&dir, InjectionState::Clean, "/x/core/main.js").unwrap();
        let loader = read(dir.join("app.asar"));
        std::fs::remove_file(dir.join(ORIGINAL_ASAR)).unwrap();
        assert!(swap_out_folder(&dir).is_err());
        assert_eq!(read(dir.join("app.asar")), loader);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn a_watcher_that_failed_is_only_a_note() {
        assert_eq!(after_updates(Ok(())), " It comes back by itself after Discord updates.");
        assert!(after_updates(Err("it needs systemd".into())).starts_with(" Discord updates will remove it"));
    }
}
