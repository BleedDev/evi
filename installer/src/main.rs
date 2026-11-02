//! Evi Setup: a GUI by default, or a terminal installer with --no-default-features.
//! Both builds accept commands; --headless is the legacy alias for --json.
#![cfg_attr(all(feature = "gui", not(debug_assertions)), windows_subsystem = "windows")]

mod asar;
mod autorepair;
mod cli;
mod discord;
#[cfg(feature = "gui")]
mod gui;
#[cfg(feature = "gui")]
mod macos;
mod ops;
mod paths;
mod release;

use clap::Parser;
use std::process::ExitCode;

const VERSION: &str = env!("EVI_SETUP_VERSION");

fn main() -> ExitCode {
    let cli = cli::Cli::parse();
    paths::migrate_legacy_data_dir();
    #[cfg(feature = "gui")]
    if cli.command.is_none() && !cli.json {
        gui::start();
        return ExitCode::SUCCESS;
    }
    match cli::run(cli) {
        Ok(ok) => ExitCode::from(u8::from(!ok)),
        Err(error) => {
            eprintln!("{error}");
            ExitCode::FAILURE
        }
    }
}
