//! Terminal frontend. The GUI and CLI use the same scan, download and installation operations.
use clap::{Args, Parser, Subcommand};

use crate::discord::InjectionState;
use crate::ops::{self, Action};
use crate::VERSION;

#[derive(Parser)]
#[command(name = "evi-setup", version = VERSION, about = "Install or remove Evi from Discord")]
pub struct Cli {
    /// Print the result as JSON (progress still goes to stderr)
    #[arg(long, alias = "headless", global = true)]
    pub json: bool,
    #[command(subcommand)]
    pub command: Option<Command>,
}

#[derive(Subcommand)]
pub enum Command {
    /// Show Discord installations and their Evi status
    Status,
    /// Check which Evi release would be installed
    Check,
    /// Install or update Evi from the latest release; closes Discord if running
    Install(Selection),
    /// Restore Discord's original archive; closes Discord if running
    Uninstall(Selection),
    #[command(hide = true)]
    Relink(Link),
    #[command(hide = true)]
    Swap(Link),
    #[command(hide = true)]
    Unswap {
        #[arg(long)]
        flavor: String,
    },
}

#[derive(Args)]
pub struct Selection {
    /// Discord flavors, comma-separated, or all
    #[arg(long = "flavor", value_delimiter = ',', default_value = "stable", value_parser = ["stable", "ptb", "canary", "development", "all"])]
    flavors: Vec<String>,
    /// Do not start Discord after the operation (it may still be closed)
    #[arg(long)]
    no_restart: bool,
}

#[derive(Args)]
pub struct Link {
    #[arg(long)]
    flavor: String,
    #[arg(long)]
    core: String,
}

pub fn run(cli: Cli) -> Result<bool, String> {
    let (action, selection) = match cli.command.unwrap_or(Command::Status) {
        Command::Status => {
            let scan = ops::scan();
            if cli.json {
                println!("{}", serde_json::to_string(&scan).unwrap());
            } else {
                for install in &scan.installs {
                    let state = match install.state {
                        InjectionState::Missing => "not found",
                        InjectionState::Clean => "Evi not installed",
                        InjectionState::Evi => "Evi installed",
                        InjectionState::OtherMod => "another client mod is installed",
                    };
                    let version = install.evi_version.as_ref().map(|v| format!(" ({v})")).unwrap_or_default();
                    println!("Discord {}: {state}{version}", install.label);
                }
                println!("Data folder: {}", scan.data_dir);
            }
            return Ok(true);
        }
        Command::Check => {
            let check = ops::check();
            if cli.json {
                println!("{}", serde_json::to_string(&check).unwrap());
                return Ok(check.error.is_none());
            }
            if let Some(error) = check.error {
                return Err(error);
            }
            match check.version {
                Some(version) => println!("Latest Evi: {version}"),
                None => println!("No Evi release with a core was found."),
            }
            return Ok(true);
        }
        Command::Install(selection) => (Action::Install, selection),
        Command::Uninstall(selection) => (Action::Uninstall, selection),
        Command::Relink(link) => {
            if ops::relink(&link.flavor, &link.core)? {
                println!("Put Evi back into Discord {}", link.flavor);
            }
            return Ok(true);
        }
        Command::Swap(link) => {
            if let Some(note) = ops::elevated_swap(&link.flavor, &link.core)? {
                println!("{}", note.replace(['\r', '\n'], " "));
            }
            return Ok(true);
        }
        Command::Unswap { flavor } => return ops::elevated_unswap(&flavor).map(|()| true),
    };
    let report = ops::run(action, &selection.flavors, !selection.no_restart, false, &|text| eprintln!("{text}"));
    if cli.json {
        println!("{}", serde_json::to_string(&report).unwrap());
    } else {
        if let Some(error) = &report.error {
            eprintln!("{error}");
        }
        for outcome in &report.outcomes {
            if outcome.ok { println!("{}", outcome.message); } else { eprintln!("{}", outcome.message); }
        }
        for flavor in &report.restarted {
            println!("Started Discord {flavor}.");
        }
        for flavor in &report.start_by_hand {
            println!("Start Discord {flavor} manually.");
        }
    }
    Ok(report.ok)
}
