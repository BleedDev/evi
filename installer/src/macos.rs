//! macOS only: Evi Setup moving itself into Applications, and asking for App Management first.
//!
//! Evi Setup comes as a zip, so it runs from Downloads, where Spotlight's app results, Launchpad and
//! Raycast don't look. It offers to move itself.
//!
//! Changing Discord.app needs App Management (System Settings > Privacy & Security). Without it the
//! swap fails halfway through an install; a probe at scan time asks macOS first, and makes Evi Setup
//! show up in that list, ready to be turned on.

use std::io;
use std::path::{Path, PathBuf};
use std::process::Command;

use crate::paths;

const APP_NAME: &str = "Evi Setup.app";
const PROBE: &str = ".evi-access-check";

/// Why Evi Setup can't change a Discord, if it can't
pub fn access_problem(resources: &Path) -> Option<&'static str> {
    if !cfg!(target_os = "macos") {
        return None;
    }
    let probe = resources.join(PROBE);
    let result = std::fs::OpenOptions::new().write(true).create(true).truncate(true).open(&probe);
    match result {
        Ok(file) => {
            drop(file);
            let _ = std::fs::remove_file(&probe);
            None
        }
        Err(e) => classify(&e),
    }
}

/// EPERM is macOS's privacy protection (App Management); EACCES is plain file permissions, an app
/// that belongs to another user or to root
fn classify(err: &io::Error) -> Option<&'static str> {
    match err.raw_os_error() {
        Some(1) => Some("app-management"),
        Some(13) => Some("no-access"),
        _ => None,
    }
}

pub fn open_app_management() -> Result<(), String> {
    Command::new("open")
        .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_AppBundles")
        .status()
        .map_err(|e| e.to_string())
        .and_then(|s| if s.success() { Ok(()) } else { Err(format!("open exited with {s}")) })
}

/// The .app this program runs from: …/Evi Setup.app/Contents/MacOS/evi-setup
fn bundle_of(exe: &Path) -> Option<PathBuf> {
    let bundle = exe.parent()?.parent()?.parent()?;
    let is_app = bundle.extension().is_some_and(|e| e == "app") && exe.parent()?.file_name()? == "MacOS";
    is_app.then(|| bundle.to_path_buf())
}

fn in_applications(bundle: &Path, home: &Path) -> bool {
    let parent = bundle.parent();
    parent == Some(Path::new("/Applications")) || parent == Some(&home.join("Applications"))
}

/// The bundle to offer moving, when it runs from anywhere but Applications
pub fn move_offer() -> Option<PathBuf> {
    if !cfg!(target_os = "macos") {
        return None;
    }
    let bundle = bundle_of(&std::env::current_exe().ok()?)?;
    (!in_applications(&bundle, &paths::user_home())).then_some(bundle)
}

/// Gatekeeper runs a downloaded app from a read-only copy (App Translocation) until it's moved; the
/// real one is somewhere else, most likely where the zip unpacked it
fn translocated(bundle: &Path) -> bool {
    bundle.to_string_lossy().contains("/AppTranslocation/")
}

fn same_contents(a: &Path, b: &Path) -> bool {
    matches!((std::fs::read(a), std::fs::read(b)), (Ok(a), Ok(b)) if a == b)
}

/// Copies the bundle into /Applications (~/Applications where that isn't writable), leaves the copy
/// in Downloads only when it can't be told apart, and returns the new bundle to open
pub fn move_to_applications() -> Result<PathBuf, String> {
    let bundle = move_offer().ok_or("Evi Setup is in Applications already.")?;
    let home = paths::user_home();
    let mut last = String::new();
    for dir in [PathBuf::from("/Applications"), home.join("Applications")] {
        match copy_into(&bundle, &dir) {
            Ok(target) => {
                remove_original(&bundle, &home);
                return Ok(target);
            }
            Err(e) => last = e,
        }
    }
    Err(last)
}

fn copy_into(bundle: &Path, dir: &Path) -> Result<PathBuf, String> {
    std::fs::create_dir_all(dir).map_err(|e| format!("Couldn’t write {}: {e}", dir.display()))?;
    let target = dir.join(APP_NAME);
    let incoming = dir.join(".Evi Setup.app.incoming");
    let _ = std::fs::remove_dir_all(&incoming);
    // --noqtn: the person already opened it once, Gatekeeper doesn't need to ask again
    let out = Command::new("ditto").arg("--noqtn").arg(bundle).arg(&incoming).output().map_err(|e| e.to_string())?;
    if !out.status.success() {
        let _ = std::fs::remove_dir_all(&incoming);
        return Err(format!("Couldn’t copy Evi Setup into {}: {}", dir.display(), String::from_utf8_lossy(&out.stderr).trim()));
    }
    // An older Evi Setup there is replaced, never left half-deleted: it moves aside first
    let old = dir.join(".Evi Setup.app.old");
    let had_old = target.exists();
    if had_old {
        let _ = std::fs::remove_dir_all(&old);
        if let Err(e) = std::fs::rename(&target, &old) {
            let _ = std::fs::remove_dir_all(&incoming);
            return Err(format!("Couldn’t replace the Evi Setup in {}: {e}", dir.display()));
        }
    }
    if let Err(e) = std::fs::rename(&incoming, &target) {
        if had_old {
            let _ = std::fs::rename(&old, &target);
        }
        let _ = std::fs::remove_dir_all(&incoming);
        return Err(format!("Couldn’t move Evi Setup into {}: {e}", dir.display()));
    }
    let _ = std::fs::remove_dir_all(&old);
    Ok(target)
}

fn remove_original(bundle: &Path, home: &Path) {
    let original = if translocated(bundle) {
        // Only a copy that's byte for byte this one: never someone's other Evi Setup
        let guess = home.join("Downloads").join(APP_NAME);
        let exe = |b: &Path| b.join("Contents").join("MacOS").join("evi-setup");
        if !same_contents(&exe(bundle), &exe(&guess)) {
            return;
        }
        guess
    } else {
        bundle.to_path_buf()
    };
    let _ = std::fs::remove_dir_all(original);
}

/// Opens the moved copy as a new instance; the caller quits this one
pub fn relaunch(bundle: &Path) -> Result<(), String> {
    Command::new("open").arg("-n").arg(bundle).status().map_err(|e| e.to_string()).and_then(|s| if s.success() { Ok(()) } else { Err(format!("open exited with {s}")) })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_the_bundle_it_runs_from() {
        let exe = Path::new("/Users/a/Downloads/Evi Setup.app/Contents/MacOS/evi-setup");
        assert_eq!(bundle_of(exe), Some(PathBuf::from("/Users/a/Downloads/Evi Setup.app")));
        assert_eq!(bundle_of(Path::new("/Users/a/.config/Evi/bin/evi-setup")), None);
        assert_eq!(bundle_of(Path::new("/Users/a/Evi Setup/Contents/MacOS/evi-setup")), None);
    }

    #[test]
    fn applications_are_where_it_belongs() {
        let home = Path::new("/Users/a");
        assert!(in_applications(Path::new("/Applications/Evi Setup.app"), home));
        assert!(in_applications(Path::new("/Users/a/Applications/Evi Setup.app"), home));
        assert!(!in_applications(Path::new("/Users/a/Downloads/Evi Setup.app"), home));
        assert!(!in_applications(Path::new("/Applications/Utilities/Evi Setup.app"), home));
    }

    #[test]
    fn translocated_runs_are_recognised() {
        assert!(translocated(Path::new("/private/var/folders/x/T/AppTranslocation/1234-ABCD/d/Evi Setup.app")));
        assert!(!translocated(Path::new("/Users/a/Downloads/Evi Setup.app")));
    }

    #[test]
    fn eperm_is_app_management_and_eacces_is_file_permissions() {
        assert_eq!(classify(&io::Error::from_raw_os_error(1)), Some("app-management"));
        assert_eq!(classify(&io::Error::from_raw_os_error(13)), Some("no-access"));
        assert_eq!(classify(&io::Error::from_raw_os_error(2)), None);
    }
}
