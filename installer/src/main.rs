//! Evi Setup: a small window that installs Evi into Discord, updates it and removes it, on Windows,
//! macOS and Linux. The evi CLI (src/cli) does the same work, and is only for developing Evi now.
//!
//!   Evi-Setup.exe                                   the window
//!   Evi-Setup.exe --headless status                 no window: print what it found (used by scripts/test-installer.ts)
//!   Evi-Setup.exe --headless check                  no window: print the Evi it would install
//!   Evi-Setup.exe --headless install|uninstall [--flavor stable,ptb|all] [--no-restart]
//!
//! It always installs the latest release, so one build of it serves every release: releases reuse
//! its files, and it's only built again when installer/ changes.
//!
//! And for itself, on macOS and Linux:
//!   --headless relink --flavor <f> --core <main.js>   what the watcher runs after a Discord update (autorepair.rs)
//!   --headless swap --flavor <f> --core <main.js>     the root part of an install, through pkexec
//!   --headless unswap --flavor <f>                    the root part of an uninstall, through pkexec
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod asar;
mod autorepair;
mod discord;
mod ops;
mod paths;
mod release;

use serde::Serialize;
use tauri::{AppHandle, Emitter};

use ops::{Outcome, Progress};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Scan {
    version: String,
    data_dir: String,
    installs: Vec<ops::InstallInfo>,
}

/// The Evi an install would lay down, for the window's title
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Latest {
    version: Option<String>,
    error: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RunReport {
    ok: bool,
    error: Option<String>,
    version: Option<String>,
    outcomes: Vec<Outcome>,
    restarted: Vec<&'static str>,
    start_by_hand: Vec<&'static str>,
}

fn scan_now(version: &str) -> Scan {
    Scan { version: version.to_string(), data_dir: paths::data_dir().to_string_lossy().into_owned(), installs: ops::status() }
}

fn check_now() -> Latest {
    match release::latest() {
        Ok(Some(r)) if release::has_core(&r) => Latest { version: Some(r.version), error: None },
        Ok(_) => Latest { version: None, error: None },
        Err(e) => Latest { version: None, error: Some(e) },
    }
}

/// The Evi to install: the latest release. A local file in EVI_CORE_FILE wins, for trying out a build
/// without publishing it.
fn load_core(progress: &Progress) -> Result<release::CorePayload, String> {
    if let Some(file) = std::env::var("EVI_CORE_FILE").ok().filter(|f| !f.is_empty()) {
        (progress.0)("Reading Evi from a local file…");
        return release::parse_core(&std::fs::read(&file).map_err(|e| format!("Couldn’t read {file}: {e}"))?);
    }
    (progress.0)("Looking up the release…");
    let release = release::latest()?.ok_or("No Evi release has been published yet.")?;
    (progress.0)(&format!("Downloading Evi {}…", release.version));
    release::download_core(&release, || (progress.0)("Checking the download…"))
}

fn run_now(action: &str, flavors: &[String], restart: bool, progress: &Progress) -> RunReport {
    let fail = |error: String| RunReport { ok: false, error: Some(error), version: None, outcomes: vec![], restarted: vec![], start_by_hand: vec![] };
    let (result, version) = match action {
        "install" => {
            let payload = match load_core(progress) {
                Ok(p) => p,
                Err(e) => return fail(e),
            };
            (ops::install(flavors, &payload, progress), Some(payload.version.clone()))
        }
        "uninstall" => (ops::uninstall(flavors, progress), None),
        other => return fail(format!("Unknown action {other}")),
    };
    let result = match result {
        Ok(r) => r,
        Err(e) => return fail(e),
    };
    let mut report = RunReport { ok: result.outcomes.iter().all(|o| o.ok), error: None, version, outcomes: result.outcomes, restarted: vec![], start_by_hand: vec![] };
    if restart && !result.restart.is_empty() {
        (progress.0)("Starting Discord…");
        report.start_by_hand = ops::restart(&result.restart);
        report.restarted = result.restart.iter().map(|i| discord::flavor_label(i.flavor)).filter(|l| !report.start_by_hand.contains(l)).collect();
    }
    report
}

fn own_version(app: &AppHandle) -> String {
    app.package_info().version.to_string()
}

#[tauri::command]
async fn scan(app: AppHandle) -> Scan {
    let version = own_version(&app);
    tauri::async_runtime::spawn_blocking(move || scan_now(&version)).await.unwrap()
}

#[tauri::command]
async fn latest_release() -> Latest {
    tauri::async_runtime::spawn_blocking(check_now).await.unwrap()
}

#[tauri::command]
async fn run(app: AppHandle, action: String, flavors: Vec<String>) -> RunReport {
    tauri::async_runtime::spawn_blocking(move || {
        let emit = |text: &str| {
            let _ = app.emit("progress", text);
        };
        run_now(&action, &flavors, true, &Progress(&emit))
    })
    .await
    .unwrap()
}

/// No window: for scripts and scripts/test-installer.ts. Prints JSON, exits 1 when something failed.
fn headless(args: &[String], version: &str) -> i32 {
    let action = args.first().map(String::as_str).unwrap_or("status");
    let flag = |name: &str| args.iter().any(|a| a == name);
    let flavors: Vec<String> = args
        .iter()
        .position(|a| a == "--flavor")
        .and_then(|i| args.get(i + 1))
        .map(|v| v.split(',').map(str::to_string).collect())
        .unwrap_or_else(|| vec!["stable".into()]);
    let print = |value: serde_json::Value| println!("{value}");
    let value = |name: &str| args.iter().position(|a| a == name).and_then(|i| args.get(i + 1)).cloned().unwrap_or_default();
    let done = |result: Result<(), String>| match result {
        Ok(()) => 0,
        Err(e) => {
            eprintln!("{e}");
            1
        }
    };
    match action {
        "relink" => match ops::relink(&value("--flavor"), &value("--core")) {
            Ok(changed) => {
                if changed {
                    println!("Put Evi back into Discord {}", value("--flavor"));
                }
                0
            }
            Err(e) => done(Err(e)),
        },
        "swap" => done(ops::elevated_swap(&value("--flavor"), &value("--core"))),
        "unswap" => done(ops::elevated_unswap(&value("--flavor"))),
        "status" => {
            print(serde_json::to_value(scan_now(version)).unwrap());
            0
        }
        "check" => {
            let check = check_now();
            let failed = check.error.is_some();
            print(serde_json::to_value(check).unwrap());
            failed as i32
        }
        _ => {
            let log = |text: &str| eprintln!("{text}");
            let report = run_now(action, &flavors, !flag("--no-restart"), &Progress(&log));
            let ok = report.ok;
            print(serde_json::to_value(report).unwrap());
            (!ok) as i32
        }
    }
}

fn main() {
    paths::migrate_legacy_data_dir();

    let context = tauri::generate_context!();
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.first().is_some_and(|a| a == "--headless") {
        let version = context.package_info().version.to_string();
        std::process::exit(headless(&args[1..], &version));
    }

    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![scan, latest_release, run])
        .run(context)
        .expect("error while running Evi Setup");
}
