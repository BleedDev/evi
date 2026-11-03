//! Putting Evi back after Discord updates on macOS and Linux.
//!
//! Windows and Linux bootstrap installs use app-x.y.z folders and Evi's core moves itself
//! along (src/main/persist.ts). On macOS and Linux system packages an update replaces files in place: the
//! .app bundle on macOS, the package's files on Linux. The loader goes with them, and nothing of Evi
//! runs inside Discord any more to put it back.
//!
//! So installing leaves a watcher outside Discord: a launchd agent on macOS, a systemd path unit on
//! Linux. When Discord's folder changes it runs a copy of Evi Setup with `--headless relink`, which
//! puts the loader back if Discord's own archive is in its place again. The core and plugins stay in
//! the data folder, so that's a few KB, and Discord is never closed: Evi is back the next time it starts.

use std::path::{Path, PathBuf};
use std::process::Command;

use crate::discord::DiscordInstall;
use crate::paths;

const LABEL: &str = "rest.evi.relink";

pub struct Watcher<'a> {
    pub flavor: &'a str,
    /// The Evi Setup copy the watcher runs
    pub exe: String,
    /// The core main.js the loader points at
    pub core_path: String,
    /// Folders whose changes mean Discord may have been replaced
    pub watch: Vec<String>,
}

pub fn relink_args(w: &Watcher) -> Vec<String> {
    [w.exe.as_str(), "--headless", "relink", "--flavor", w.flavor, "--core", w.core_path.as_str()].iter().map(|s| s.to_string()).collect()
}

fn xml(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;")
}

pub fn launch_agent_plist(w: &Watcher) -> String {
    let strings = |list: &[String]| list.iter().map(|s| format!("        <string>{}</string>", xml(s))).collect::<Vec<_>>().join("\n");
    format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>{LABEL}.{flavor}</string>
    <key>ProgramArguments</key>
    <array>
{args}
    </array>
    <key>WatchPaths</key>
    <array>
{watch}
    </array>
    <key>RunAtLoad</key>
    <true/>
</dict>
</plist>
"#,
        flavor = w.flavor,
        args = strings(&relink_args(w)),
        watch = strings(&w.watch),
    )
}

/// systemd splits ExecStart on spaces unless quoted, and expands % specifiers
fn unit_arg(s: &str) -> String {
    let escaped = s.replace('%', "%%").replace('\\', "\\\\").replace('"', "\\\"");
    if s.contains(|c: char| c.is_whitespace() || c == '"' || c == '\'' || c == '\\') {
        format!("\"{escaped}\"")
    } else {
        escaped
    }
}

pub fn unit_name(flavor: &str) -> String {
    format!("evi-relink-{flavor}")
}

/// (.path unit, .service unit)
pub fn systemd_units(w: &Watcher, system: bool) -> (String, String) {
    let description = format!("Put Evi back into Discord {} after it updates", w.flavor);
    let paths = w.watch.iter().map(|p| format!("PathChanged={}", unit_arg(p))).collect::<Vec<_>>().join("\n");
    let target = if system { "multi-user.target" } else { "default.target" };
    let exec = relink_args(w).iter().map(|a| unit_arg(a)).collect::<Vec<_>>().join(" ");
    (
        format!("[Unit]\nDescription={description}\n\n[Path]\n{paths}\n\n[Install]\nWantedBy={target}\n"),
        format!("[Unit]\nDescription={description}\n\n[Service]\nType=oneshot\nExecStart={exec}\n"),
    )
}

struct Locations {
    /// A system unit, run as root: Discord's folder belongs to root
    system: bool,
    exe: PathBuf,
    dir: PathBuf,
}

/// A system unit runs its copy of Evi Setup as root, so that copy has to be root's too: one in the
/// user's home would let any program of theirs run as root.
fn locations() -> Locations {
    let system = cfg!(target_os = "linux") && paths::is_root();
    let exe = if system { PathBuf::from("/usr/local/lib/evi/evi-setup") } else { paths::data_dir().join("bin").join("evi-setup") };
    let dir = if cfg!(target_os = "macos") {
        paths::user_home().join("Library").join("LaunchAgents")
    } else if system {
        PathBuf::from("/etc/systemd/system")
    } else {
        paths::app_data().join("systemd").join("user")
    };
    Locations { system, exe, dir }
}

fn run(cmd: &[&str]) -> Result<(), String> {
    match Command::new(cmd[0]).args(&cmd[1..]).output() {
        Ok(out) if out.status.success() => Ok(()),
        Ok(out) => Err(format!("{}{}", String::from_utf8_lossy(&out.stdout), String::from_utf8_lossy(&out.stderr)).trim().to_string()),
        Err(e) => Err(e.to_string()),
    }
}

/// launchctl and systemctl --user have to run as the user, not as root under sudo
fn run_as_user(cmd: &[&str]) -> Result<(), String> {
    match paths::invoking_user() {
        Some(user) => run(&[&["sudo", "-u", &user.name, "--preserve-env=XDG_RUNTIME_DIR,DBUS_SESSION_BUS_ADDRESS"], cmd].concat()),
        None => run(cmd),
    }
}

fn gui_domain() -> String {
    let uid = paths::invoking_user().map(|u| u.uid).unwrap_or_else(paths::uid);
    format!("gui/{uid}")
}

fn systemctl(system: bool, args: &[&str]) -> Result<(), String> {
    if system {
        run(&[&["systemctl"], args].concat())
    } else {
        run_as_user(&[&["systemctl", "--user"], args].concat())
    }
}

pub fn watched_paths(install: &DiscordInstall) -> Vec<String> {
    let resources = &install.versions[0].resources;
    if !cfg!(any(target_os = "macos", target_os = "linux"))
        || (cfg!(target_os = "linux") && resources.parent() != Some(install.root.as_path()))
    {
        return vec![];
    }
    let mut watch = vec![paths::node_path(resources)];
    // A replaced .app bundle shows up as a change in the folder that holds it
    if cfg!(target_os = "macos") {
        if let Some(parent) = install.root.parent() {
            watch.push(paths::node_path(parent));
        }
    }
    watch
}

fn install_copy(from: &Path, to: &Path) -> std::io::Result<()> {
    if matches!((std::fs::canonicalize(from), std::fs::canonicalize(to)), (Ok(a), Ok(b)) if a == b) {
        return Ok(());
    }
    std::fs::create_dir_all(to.parent().unwrap())?;
    // Copy next to it, then rename: a watcher may be running the old copy right now
    let tmp = to.with_extension("new");
    std::fs::copy(from, &tmp)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&tmp, std::fs::Permissions::from_mode(0o755))?;
    }
    std::fs::rename(&tmp, to)
}

/// In-place installs need an external watcher; app-x.y.z installs persist inside Discord.
pub fn enable(install: &DiscordInstall, core_path: &str) -> Result<(), String> {
    let watch = watched_paths(install);
    if watch.is_empty() {
        return Ok(());
    }
    let loc = locations();
    let exe = std::env::current_exe().map_err(|e| format!("couldn’t find Evi Setup’s own file: {e}"))?;
    install_copy(&exe, &loc.exe).map_err(|e| format!("couldn’t write {}: {e}", loc.exe.display()))?;
    std::fs::create_dir_all(&loc.dir).map_err(|e| format!("couldn’t write {}: {e}", loc.dir.display()))?;
    let w = Watcher { flavor: install.flavor, exe: paths::node_path(&loc.exe), core_path: core_path.to_string(), watch };

    if cfg!(target_os = "macos") {
        let plist = loc.dir.join(format!("{LABEL}.{}.plist", w.flavor));
        std::fs::write(&plist, launch_agent_plist(&w)).map_err(|e| e.to_string())?;
        paths::give_back_to_user(&plist);
        let plist = paths::node_path(&plist);
        let _ = run_as_user(&["launchctl", "bootout", &gui_domain(), &plist]);
        return run_as_user(&["launchctl", "bootstrap", &gui_domain(), &plist]).map_err(|e| format!("launchctl: {e}"));
    }

    if run(&["systemctl", "--version"]).is_err() {
        return Err("it needs systemd, which this system doesn’t use".into());
    }
    let name = unit_name(w.flavor);
    let (path_unit, service_unit) = systemd_units(&w, loc.system);
    let write = |ext: &str, text: &str| std::fs::write(loc.dir.join(format!("{name}.{ext}")), text).map_err(|e| e.to_string());
    write("path", &path_unit)?;
    write("service", &service_unit)?;
    if !loc.system {
        paths::give_back_to_user(&paths::app_data().join("systemd"));
    }
    let _ = systemctl(loc.system, &["daemon-reload"]);
    systemctl(loc.system, &["enable", "--now", &format!("{name}.path")]).map_err(|e| format!("systemctl: {e}"))
}

/// Removes one Discord's watcher, and the watcher's copy of Evi Setup once no watcher is left
pub fn disable(flavor: &str) {
    if !cfg!(any(target_os = "macos", target_os = "linux")) {
        return;
    }
    let loc = locations();
    if cfg!(target_os = "macos") {
        let plist = loc.dir.join(format!("{LABEL}.{flavor}.plist"));
        if plist.exists() {
            let _ = run_as_user(&["launchctl", "bootout", &gui_domain(), &paths::node_path(&plist)]);
            let _ = std::fs::remove_file(&plist);
        }
    } else {
        let name = unit_name(flavor);
        if loc.dir.join(format!("{name}.path")).exists() {
            let _ = systemctl(loc.system, &["disable", "--now", &format!("{name}.path")]);
            let _ = std::fs::remove_file(loc.dir.join(format!("{name}.path")));
            let _ = std::fs::remove_file(loc.dir.join(format!("{name}.service")));
            let _ = systemctl(loc.system, &["daemon-reload"]);
        }
    }
    let left = std::fs::read_dir(&loc.dir).is_ok_and(|mut entries| {
        entries.any(|e| e.is_ok_and(|e| {
            let name = e.file_name();
            let name = name.to_string_lossy();
            name.starts_with(LABEL) || name.starts_with("evi-relink-")
        }))
    });
    if !left {
        if let Some(bin) = loc.exe.parent() {
            let _ = std::fs::remove_dir_all(bin);
        }
    }
}

/// Whether this Discord has a watcher, either the user's own or the system's
pub fn enabled(flavor: &str) -> bool {
    if cfg!(target_os = "macos") {
        return paths::user_home().join("Library").join("LaunchAgents").join(format!("{LABEL}.{flavor}.plist")).exists();
    }
    if cfg!(target_os = "linux") {
        let file = format!("{}.path", unit_name(flavor));
        return Path::new("/etc/systemd/system").join(&file).exists() || paths::app_data().join("systemd").join("user").join(&file).exists();
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    fn watcher() -> Watcher<'static> {
        Watcher {
            flavor: "stable",
            exe: "/home/a b/.config/Evi/bin/evi-setup".into(),
            core_path: "/home/a b/.config/Evi/core/main.js".into(),
            watch: vec!["/opt/discord/resources".into()],
        }
    }

    #[test]
    fn relink_gets_the_flavor_and_core() {
        assert_eq!(relink_args(&watcher())[1..], ["--headless", "relink", "--flavor", "stable", "--core", "/home/a b/.config/Evi/core/main.js"]);
    }

    #[test]
    fn systemd_quotes_paths_with_spaces() {
        let (path, service) = systemd_units(&watcher(), true);
        assert!(path.contains("PathChanged=/opt/discord/resources"));
        assert!(path.contains("WantedBy=multi-user.target"));
        assert!(service.contains(r#"ExecStart="/home/a b/.config/Evi/bin/evi-setup" --headless relink --flavor stable --core "/home/a b/.config/Evi/core/main.js""#));
        assert!(systemd_units(&watcher(), false).0.contains("WantedBy=default.target"));
    }

    #[test]
    fn systemd_specifiers_are_escaped() {
        let w = Watcher { core_path: "/x/100%/main.js".into(), ..watcher() };
        assert!(systemd_units(&w, false).1.contains("/x/100%%/main.js"));
    }

    #[test]
    fn launch_agent_escapes_xml() {
        let w = Watcher { core_path: "/Users/a&b/core/main.js".into(), watch: vec!["/Applications".into()], ..watcher() };
        let plist = launch_agent_plist(&w);
        assert!(plist.contains("<string>rest.evi.relink.stable</string>"));
        assert!(plist.contains("<string>/Applications</string>"));
        assert!(plist.contains("<string>/Users/a&amp;b/core/main.js</string>"));
        assert!(plist.contains("<key>RunAtLoad</key>"));
    }
}
