//! Where Evi's data lives, ported from src/cli/paths.ts.

use std::path::{Path, PathBuf};

/// Who ran us through sudo, or through pkexec (Evi Setup asks for the password that way on Linux)
#[cfg_attr(not(unix), allow(dead_code))]
pub struct InvokingUser {
    pub name: String,
    pub uid: u32,
    pub gid: u32,
    pub home: PathBuf,
}

pub fn is_root() -> bool {
    uid() == 0
}

pub fn uid() -> u32 {
    #[cfg(unix)]
    {
        unsafe { libc::getuid() }
    }
    #[cfg(not(unix))]
    {
        u32::MAX
    }
}

/// /etc/passwd's entry for the user who ran us as root. None when we weren't run as root for someone
pub fn invoking_user() -> Option<InvokingUser> {
    if !is_root() {
        return None;
    }
    let by_name = std::env::var("SUDO_USER").ok().filter(|u| !u.is_empty() && u != "root");
    let by_uid = std::env::var("PKEXEC_UID").ok().and_then(|v| v.parse::<u32>().ok()).filter(|&u| u != 0);
    if by_name.is_none() && by_uid.is_none() {
        return None;
    }
    let passwd = std::fs::read_to_string("/etc/passwd").ok()?;
    passwd.lines().find_map(|line| {
        let f: Vec<&str> = line.split(':').collect();
        if f.len() < 6 {
            return None;
        }
        let uid = f[2].parse::<u32>().ok()?;
        let matches = by_name.as_deref() == Some(f[0]) || by_uid == Some(uid);
        matches.then(|| InvokingUser { name: f[0].to_string(), uid, gid: f[3].parse().unwrap_or(uid), home: PathBuf::from(f[5]) })
    })
}

/// Running as root for a user (sudo, pkexec): Linux installs live in root-owned folders, so that's the usual way there
pub fn is_sudo() -> bool {
    invoking_user().is_some()
}

/// The home of whoever ran us, not root's under sudo: that's where their Discord keeps Evi's data
pub fn user_home() -> PathBuf {
    if let Some(user) = invoking_user().filter(|u| !u.home.as_os_str().is_empty()) {
        return user.home;
    }
    let var = if cfg!(windows) { "USERPROFILE" } else { "HOME" };
    std::env::var_os(var).map(PathBuf::from).unwrap_or_default()
}

/// Electron's app.getPath("appData"), which the app's data folder lives in
pub fn app_data() -> PathBuf {
    if cfg!(windows) {
        return std::env::var_os("APPDATA").map(PathBuf::from).unwrap_or_default();
    }
    if cfg!(target_os = "macos") {
        return user_home().join("Library").join("Application Support");
    }
    // sudo usually keeps XDG_CONFIG_HOME out, and root's would be the wrong one anyway
    match std::env::var("XDG_CONFIG_HOME") {
        Ok(dir) if !is_sudo() && !dir.is_empty() => PathBuf::from(dir),
        _ => user_home().join(".config"),
    }
}

/// %APPDATA%\Evi and its equivalents
pub fn data_dir() -> PathBuf {
    app_data().join("Evi")
}

/// Before the rename to Evi the data folder was %APPDATA%/Delight: move it over once
pub fn migrate_legacy_data_dir() {
    let app_data = app_data();
    if app_data.as_os_str().is_empty() {
        return;
    }
    let (current, legacy) = (app_data.join("Evi"), app_data.join("Delight"));
    if !current.exists() && legacy.exists() {
        let _ = std::fs::rename(legacy, current);
    }
}

/// Files we wrote as root under sudo go back to the user, or their Discord couldn't write its settings
pub fn give_back_to_user(path: &Path) {
    #[cfg(unix)]
    {
        let Some(user) = invoking_user() else { return };
        fn walk(p: &Path, uid: u32, gid: u32) {
            if std::os::unix::fs::lchown(p, Some(uid), Some(gid)).is_ok() && std::fs::symlink_metadata(p).is_ok_and(|m| m.is_dir()) {
                if let Ok(entries) = std::fs::read_dir(p) {
                    for entry in entries.flatten() {
                        walk(&entry.path(), uid, gid);
                    }
                }
            }
        }
        walk(path, user.uid, user.gid);
    }
    #[cfg(not(unix))]
    let _ = path;
}

/// A path as Node's path.join would write it, so the loader's JSON matches the CLI's byte for byte
pub fn node_path(path: &Path) -> String {
    let s = path.to_string_lossy().into_owned();
    if cfg!(windows) {
        s.replace('/', "\\")
    } else {
        s
    }
}
