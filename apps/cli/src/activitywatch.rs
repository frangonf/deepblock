use std::{env, path::PathBuf};

use anyhow::Result;
use deepblock_server::{
    aw::ActivityWatchClient,
    config::{DeepBlockPaths, load_settings},
};

#[derive(Debug)]
struct ActivityWatchStatus {
    enabled: bool,
    url: String,
    reachable: bool,
    os: String,
    local_binaries: Vec<String>,
    system_install_path: Option<String>,
}

pub async fn print_status(json: bool) -> Result<()> {
    let status = collect_status().await?;
    if json {
        println!(
            "{}",
            serde_json::to_string_pretty(&serde_json::json!({
                "enabled": status.enabled,
                "url": status.url,
                "reachable": status.reachable,
                "os": status.os,
                "local_binaries": status.local_binaries,
                "system_install_path": status.system_install_path,
            }))?
        );
        return Ok(());
    }

    println!("activitywatch enabled: {}", yes_no(status.enabled));
    println!("configured url: {}", status.url);
    println!("server reachable: {}", yes_no(status.reachable));
    if status.local_binaries.is_empty() {
        println!(
            "local binaries: none detected under {}",
            bin_dir()?.display()
        );
    } else {
        println!("local binaries: {}", status.local_binaries.join(", "));
    }
    if let Some(path) = &status.system_install_path {
        println!("system install: {}", path);
    }
    Ok(())
}

pub async fn print_doctor(json: bool) -> Result<()> {
    let status = collect_status().await?;
    let guidance = recommended_steps(&status.os);

    if json {
        println!(
            "{}",
            serde_json::to_string_pretty(&serde_json::json!({
                "enabled": status.enabled,
                "url": status.url,
                "reachable": status.reachable,
                "os": status.os,
                "local_binaries": status.local_binaries,
                "system_install_path": status.system_install_path,
                "recommended_steps": guidance,
            }))?
        );
        return Ok(());
    }

    println!("ActivityWatch doctor");
    println!("OS: {}", status.os);
    println!("integration enabled: {}", yes_no(status.enabled));
    println!("configured url: {}", status.url);
    println!("server reachable: {}", yes_no(status.reachable));
    if status.local_binaries.is_empty() {
        println!("local binaries: none detected");
    } else {
        println!("local binaries: {}", status.local_binaries.join(", "));
    }
    if let Some(path) = &status.system_install_path {
        println!("system install: {}", path);
    }
    println!();
    if !status.enabled {
        println!(
            "Enable [activitywatch].enabled = true in config.toml to turn the reality layer on."
        );
        return Ok(());
    }
    println!("Recommended setup:");
    for step in guidance {
        println!("- {step}");
    }
    println!(
        "- Use `deepb check` or the desktop Reality page to run audits against completed blocks."
    );
    if !status.reachable {
        println!(
            "- The ActivityWatch server is not reachable right now; start aw-qt or aw-server before auditing."
        );
    }
    Ok(())
}

async fn collect_status() -> Result<ActivityWatchStatus> {
    let paths = DeepBlockPaths::resolve()?;
    paths.ensure_dirs()?;
    let settings = load_settings(&paths)?;
    let reachable = ActivityWatchClient::new(&settings.activitywatch)
        .is_available()
        .await;
    let url = settings.activitywatch.url;

    Ok(ActivityWatchStatus {
        enabled: settings.activitywatch.enabled,
        url,
        reachable,
        os: env::consts::OS.to_string(),
        local_binaries: detected_binaries()?,
        system_install_path: detected_system_install(),
    })
}

fn detected_binaries() -> Result<Vec<String>> {
    let mut present = Vec::new();
    for name in [
        "aw-server",
        "aw-server-rust",
        "aw-watcher-afk",
        "aw-watcher-window",
    ] {
        if binary_path(name)?.exists() {
            present.push(name.to_string());
        }
    }
    Ok(present)
}

fn binary_path(name: &str) -> Result<PathBuf> {
    let filename = if cfg!(windows) {
        format!("{name}.exe")
    } else {
        name.to_string()
    };
    Ok(bin_dir()?.join(filename))
}

fn bin_dir() -> Result<PathBuf> {
    Ok(DeepBlockPaths::resolve()?.state_root.join("bin"))
}

fn recommended_steps(os: &str) -> &'static [&'static str] {
    match os {
        "macos" => &[
            "Install the ActivityWatch desktop app (aw-qt) and launch it once.",
            "Enable auto-start in Login Items so aw-server and the default watchers stay running.",
            "If you use DeepBlock.app, Settings > Bundled desktop tools can launch the bundled fallback without replacing an existing ActivityWatch install.",
        ],
        "windows" => &[
            "Install the ActivityWatch desktop app (aw-qt) for Windows and launch it once.",
            "Enable Startup Apps integration so the server and watchers come up automatically.",
        ],
        _ => &[
            "Install the ActivityWatch desktop app (aw-qt) or run aw-server plus the default watchers yourself.",
            "Enable your desktop environment's auto-start integration so the server and watchers stay available.",
        ],
    }
}

fn yes_no(value: bool) -> &'static str {
    if value { "yes" } else { "no" }
}

fn detected_system_install() -> Option<String> {
    #[cfg(target_os = "macos")]
    {
        let mut candidates = vec![PathBuf::from("/Applications/ActivityWatch.app")];
        if let Ok(home) = env::var("HOME") {
            candidates.push(PathBuf::from(home).join("Applications/ActivityWatch.app"));
        }
        candidates
            .into_iter()
            .find(|path| path.exists())
            .map(|path| path.display().to_string())
    }

    #[cfg(not(target_os = "macos"))]
    {
        None
    }
}
