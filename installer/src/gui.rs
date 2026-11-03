//! Window and IPC only. Installation and the headless protocol stay shared with the CLI.
use std::sync::atomic::{AtomicBool, Ordering};

use tauri::{AppHandle, Emitter};

use crate::macos;
use crate::ops::{self, Action, Latest, RunReport, Scan};

/// An install or uninstall is running: the window doesn't close until it's done
static BUSY: AtomicBool = AtomicBool::new(false);

#[tauri::command]
async fn scan() -> Scan {
    tauri::async_runtime::spawn_blocking(ops::scan).await.unwrap()
}

/// macOS: where Evi Setup runs from, when that isn't Applications (macos.rs)
#[tauri::command]
fn move_offer() -> Option<String> {
    macos::move_offer().map(|b| b.to_string_lossy().into_owned())
}

/// Moves Evi Setup into Applications and opens it from there; this one quits
#[tauri::command]
async fn move_to_applications(app: AppHandle) -> Result<(), String> {
    let target = tauri::async_runtime::spawn_blocking(macos::move_to_applications).await.map_err(|e| e.to_string())??;
    macos::relaunch(&target)?;
    app.exit(0);
    Ok(())
}

#[tauri::command]
fn open_app_management() -> Result<(), String> {
    macos::open_app_management()
}

#[tauri::command]
async fn latest_release() -> Latest {
    tauri::async_runtime::spawn_blocking(ops::check).await.unwrap()
}

#[tauri::command]
async fn run(app: AppHandle, action: Action, flavors: Vec<String>) -> RunReport {
    BUSY.store(true, Ordering::SeqCst);
    let report = tauri::async_runtime::spawn_blocking(move || {
        let emit = |text: &str| {
            let _ = app.emit("progress", text);
        };
        ops::run(action, &flavors, true, true, &emit)
    })
    .await;
    BUSY.store(false, Ordering::SeqCst);
    report.unwrap()
}

pub fn start() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![scan, latest_release, run, move_offer, move_to_applications, open_app_management])
        // Alt+F4 or the taskbar's Close during a run would quit between closing Discord and starting it
        // again, or mid-swap. The title bar's own button is already off while busy
        .on_window_event(|_, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if BUSY.load(Ordering::SeqCst) {
                    api.prevent_close();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running Evi Setup");
}
