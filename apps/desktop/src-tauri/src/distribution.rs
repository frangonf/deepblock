use std::{io, process::Child, sync::Mutex};

use deepblock_server::config::ActivityWatchConfig;
use serde::Serialize;
#[cfg(target_os = "macos")]
use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
    thread,
    time::{Duration, Instant},
};
use tauri::{AppHandle, Runtime};
#[cfg(target_os = "macos")]
use tauri::{Manager, path::BaseDirectory};
#[cfg(target_os = "macos")]
use tracing::{info, warn};

#[cfg(any(target_os = "macos", test))]
const DEFAULT_ACTIVITYWATCH_PORT: u16 = 5600;

#[derive(Default)]
pub struct ManagedChildren {
    children: Mutex<Vec<Child>>,
}

impl ManagedChildren {
    pub fn terminate_all(&self) {
        if let Ok(mut children) = self.children.lock() {
            for child in children.iter_mut() {
                let _ = child.kill();
                let _ = child.wait();
            }
            children.clear();
        }
    }
}

#[derive(Clone, Debug, Serialize)]
pub struct CliShimStatus {
    pub bundled_path: Option<String>,
    pub install_path: Option<String>,
    pub bundled_cli_present: bool,
    pub installed: bool,
    pub managed_by_deepblock: bool,
    pub blocked_by_existing_entry: bool,
    pub shell_path_hint: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
pub struct ActivityWatchRuntimeStatus {
    pub enabled: bool,
    pub configured_url: String,
    pub configured_port: Option<u16>,
    pub local_url: bool,
    pub automatic_runtime_enabled: bool,
    pub system_install_detected: bool,
    pub system_install_path: Option<String>,
    pub server_reachable: bool,
    pub bundled_binaries_present: bool,
    pub bundled_processes_running: bool,
    pub preferred_source: String,
}

#[derive(Clone, Debug, Serialize)]
pub struct DesktopDistributionStatus {
    pub supported: bool,
    pub cli: CliShimStatus,
    pub activitywatch: ActivityWatchRuntimeStatus,
}

#[cfg(any(target_os = "macos", test))]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum ActivityWatchLaunchStrategy {
    Skip,
    LaunchSystemInstall,
    LaunchBundledFallback,
}

pub fn ensure_macos_cli_shim<R: Runtime>(app: &AppHandle<R>) {
    #[cfg(target_os = "macos")]
    if let Err(error) = install_macos_cli_shim_impl(app) {
        warn!("unable to install bundled deepb shim: {error}");
    }

    #[cfg(not(target_os = "macos"))]
    let _ = app;
}

pub fn current_distribution_status<R: Runtime>(
    app: &AppHandle<R>,
    settings: &ActivityWatchConfig,
    children: &ManagedChildren,
) -> io::Result<DesktopDistributionStatus> {
    #[cfg(target_os = "macos")]
    {
        current_distribution_status_impl(app, settings, children)
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, settings, children);
        Ok(DesktopDistributionStatus {
            supported: false,
            cli: CliShimStatus {
                bundled_path: None,
                install_path: None,
                bundled_cli_present: false,
                installed: false,
                managed_by_deepblock: false,
                blocked_by_existing_entry: false,
                shell_path_hint: None,
            },
            activitywatch: ActivityWatchRuntimeStatus {
                enabled: settings.enabled,
                configured_url: settings.url.clone(),
                configured_port: activitywatch_port(&settings.url),
                local_url: is_local_activitywatch_url(&settings.url),
                automatic_runtime_enabled: settings.launch_bundled_components,
                system_install_detected: false,
                system_install_path: None,
                server_reachable: false,
                bundled_binaries_present: false,
                bundled_processes_running: false,
                preferred_source: "unsupported".to_string(),
            },
        })
    }
}

pub fn install_macos_cli_shim<R: Runtime>(
    app: &AppHandle<R>,
    settings: &ActivityWatchConfig,
    children: &ManagedChildren,
) -> io::Result<DesktopDistributionStatus> {
    #[cfg(target_os = "macos")]
    {
        install_macos_cli_shim_impl(app)?;
        current_distribution_status_impl(app, settings, children)
    }

    #[cfg(not(target_os = "macos"))]
    {
        current_distribution_status(app, settings, children)
    }
}

pub fn ensure_activitywatch_runtime<R: Runtime>(
    app: &AppHandle<R>,
    settings: &ActivityWatchConfig,
    children: &ManagedChildren,
) {
    #[cfg(target_os = "macos")]
    if let Err(error) = ensure_activitywatch_runtime_impl(app, settings, children, false) {
        warn!("unable to ensure ActivityWatch runtime availability: {error}");
    }

    #[cfg(not(target_os = "macos"))]
    let _ = (app, settings, children);
}

pub fn launch_bundled_activitywatch_fallback<R: Runtime>(
    app: &AppHandle<R>,
    settings: &ActivityWatchConfig,
    children: &ManagedChildren,
) -> io::Result<DesktopDistributionStatus> {
    #[cfg(target_os = "macos")]
    {
        ensure_activitywatch_runtime_impl(app, settings, children, true)
    }

    #[cfg(not(target_os = "macos"))]
    {
        current_distribution_status(app, settings, children)
    }
}

#[cfg(target_os = "macos")]
fn install_macos_cli_shim_impl<R: Runtime>(app: &AppHandle<R>) -> io::Result<()> {
    let cli_path = bundled_binary_path(app, "deepb")?;
    if !cli_path.exists() {
        return Ok(());
    }

    let link_path = cli_shim_install_path()?;
    install_cli_link(&cli_path, &link_path)
}

#[cfg(target_os = "macos")]
fn install_cli_link(cli_path: &Path, link_path: &Path) -> io::Result<()> {
    if let Some(parent) = link_path.parent() {
        fs::create_dir_all(parent)?;
    }

    match fs::symlink_metadata(link_path) {
        // Never claim ownership merely because an entry is a symlink. This
        // also preserves dangling links and links to a different app bundle.
        Ok(_) => return Ok(()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => {}
        Err(error) => return Err(error),
    }

    std::os::unix::fs::symlink(cli_path, link_path)?;
    info!("installed deepb shim at {}", link_path.display());
    Ok(())
}

#[cfg(target_os = "macos")]
fn current_distribution_status_impl<R: Runtime>(
    app: &AppHandle<R>,
    settings: &ActivityWatchConfig,
    managed: &ManagedChildren,
) -> io::Result<DesktopDistributionStatus> {
    let cli = cli_shim_status(app)?;
    let activitywatch = activitywatch_runtime_status(app, settings, managed)?;

    Ok(DesktopDistributionStatus {
        supported: true,
        cli,
        activitywatch,
    })
}

#[cfg(target_os = "macos")]
fn ensure_activitywatch_runtime_impl<R: Runtime>(
    app: &AppHandle<R>,
    settings: &ActivityWatchConfig,
    managed: &ManagedChildren,
    force_bundled_fallback: bool,
) -> io::Result<DesktopDistributionStatus> {
    let port = activitywatch_port(&settings.url).unwrap_or(DEFAULT_ACTIVITYWATCH_PORT);
    let system_app_path = system_activitywatch_app_path();
    let strategy = select_activitywatch_launch_strategy(
        settings,
        port,
        is_port_open(port),
        system_app_path.is_some(),
        force_bundled_fallback,
    );

    match strategy {
        ActivityWatchLaunchStrategy::Skip => {}
        ActivityWatchLaunchStrategy::LaunchSystemInstall => {
            if let Some(path) = system_app_path.as_ref() {
                launch_system_activitywatch(path)?;
                if wait_for_local_port(port, Duration::from_secs(12)) {
                    info!(
                        "launched installed ActivityWatch app from {}",
                        path.display()
                    );
                } else {
                    warn!(
                        "installed ActivityWatch app was opened from {} but port {port} was not ready in time",
                        path.display()
                    );
                }
            }
        }
        ActivityWatchLaunchStrategy::LaunchBundledFallback => {
            launch_bundled_activitywatch_impl(app, port, managed)?;
        }
    }

    current_distribution_status_impl(app, settings, managed)
}

#[cfg(target_os = "macos")]
fn cli_shim_status<R: Runtime>(app: &AppHandle<R>) -> io::Result<CliShimStatus> {
    let bundled_path = bundled_binary_path(app, "deepb")?;
    let install_path = cli_shim_install_path()?;
    let bundled_cli_present = bundled_path.exists();

    let (installed, managed_by_deepblock, blocked_by_existing_entry) =
        match fs::symlink_metadata(&install_path) {
            Ok(metadata) if metadata.file_type().is_symlink() => {
                let managed =
                    fs::read_link(&install_path).ok().as_deref() == Some(bundled_path.as_path());
                (true, managed, !managed)
            }
            Ok(_) => (true, false, true),
            Err(error) if error.kind() == io::ErrorKind::NotFound => (false, false, false),
            Err(error) => return Err(error),
        };

    let shell_path_hint = install_path.parent().map(|parent| {
        format!(
            "If `{}` is not already on your shell PATH, add `export PATH=\"{}:$PATH\"` to your shell profile.",
            parent.display(),
            parent.display()
        )
    });

    Ok(CliShimStatus {
        bundled_path: Some(bundled_path.display().to_string()),
        install_path: Some(install_path.display().to_string()),
        bundled_cli_present,
        installed,
        managed_by_deepblock,
        blocked_by_existing_entry,
        shell_path_hint,
    })
}

#[cfg(target_os = "macos")]
fn activitywatch_runtime_status<R: Runtime>(
    app: &AppHandle<R>,
    settings: &ActivityWatchConfig,
    managed: &ManagedChildren,
) -> io::Result<ActivityWatchRuntimeStatus> {
    let configured_port = activitywatch_port(&settings.url);
    let server_reachable = configured_port.is_some_and(is_port_open);
    let system_install_path = system_activitywatch_app_path();
    let bundled_processes_running = bundled_children_running(managed)?;
    let bundled_binaries_present = bundled_activitywatch_binaries_present(app)?;
    let preferred_source = if server_reachable {
        "existing_server"
    } else if system_install_path.is_some() {
        "system_install"
    } else if bundled_binaries_present {
        "bundled_fallback"
    } else {
        "none"
    };

    Ok(ActivityWatchRuntimeStatus {
        enabled: settings.enabled,
        configured_url: settings.url.clone(),
        configured_port,
        local_url: is_local_activitywatch_url(&settings.url),
        automatic_runtime_enabled: settings.launch_bundled_components,
        system_install_detected: system_install_path.is_some(),
        system_install_path: system_install_path.map(|path| path.display().to_string()),
        server_reachable,
        bundled_binaries_present,
        bundled_processes_running,
        preferred_source: preferred_source.to_string(),
    })
}

#[cfg(target_os = "macos")]
fn cli_shim_install_path() -> io::Result<PathBuf> {
    let home_dir =
        home_dir().ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "HOME is not set"))?;
    Ok(home_dir.join(".local/bin/deepb"))
}

#[cfg(target_os = "macos")]
fn bundled_children_running(managed: &ManagedChildren) -> io::Result<bool> {
    let children = managed
        .children
        .lock()
        .map_err(|_| io::Error::other("activitywatch child lock poisoned"))?;
    Ok(!children.is_empty())
}

#[cfg(target_os = "macos")]
fn bundled_activitywatch_binaries_present<R: Runtime>(app: &AppHandle<R>) -> io::Result<bool> {
    Ok(["aw-server-rust", "aw-watcher-afk", "aw-watcher-window"]
        .into_iter()
        .all(|name| bundled_binary_path(app, name).is_ok_and(|path| path.exists())))
}

#[cfg(target_os = "macos")]
fn launch_bundled_activitywatch_impl<R: Runtime>(
    app: &AppHandle<R>,
    port: u16,
    managed: &ManagedChildren,
) -> io::Result<()> {
    let server_binary = bundled_binary_path(app, "aw-server-rust")?;
    let afk_binary = bundled_binary_path(app, "aw-watcher-afk")?;
    let window_binary = bundled_binary_path(app, "aw-watcher-window")?;

    if !server_binary.exists() || !afk_binary.exists() || !window_binary.exists() {
        return Ok(());
    }

    let mut children = managed
        .children
        .lock()
        .map_err(|_| io::Error::other("activitywatch child lock poisoned"))?;
    if !children.is_empty() {
        return Ok(());
    }

    let mut server_child = Command::new(&server_binary)
        .arg("--port")
        .arg(port.to_string())
        .spawn()?;

    if !wait_for_local_port(port, Duration::from_secs(8)) {
        let _ = server_child.kill();
        let _ = server_child.wait();
        return Ok(());
    }

    let afk_child = Command::new(&afk_binary).spawn()?;
    let window_child = Command::new(&window_binary).spawn()?;

    children.push(server_child);
    children.push(afk_child);
    children.push(window_child);

    info!("launched bundled ActivityWatch components from the macOS app bundle");
    Ok(())
}

#[cfg(any(target_os = "macos", test))]
fn select_activitywatch_launch_strategy(
    settings: &ActivityWatchConfig,
    port: u16,
    port_open: bool,
    system_install_exists: bool,
    force_bundled_fallback: bool,
) -> ActivityWatchLaunchStrategy {
    if !settings.enabled || !is_local_activitywatch_url(&settings.url) {
        return ActivityWatchLaunchStrategy::Skip;
    }

    if port != DEFAULT_ACTIVITYWATCH_PORT || port_open {
        return ActivityWatchLaunchStrategy::Skip;
    }

    if force_bundled_fallback {
        return ActivityWatchLaunchStrategy::LaunchBundledFallback;
    }

    if !settings.launch_bundled_components {
        return ActivityWatchLaunchStrategy::Skip;
    }

    if system_install_exists {
        return ActivityWatchLaunchStrategy::LaunchSystemInstall;
    }

    ActivityWatchLaunchStrategy::LaunchBundledFallback
}

#[cfg(target_os = "macos")]
fn system_activitywatch_app_path() -> Option<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(path) = std::env::var_os("DEEPBLOCK_ACTIVITYWATCH_APP") {
        candidates.push(PathBuf::from(path));
    }
    candidates.push(PathBuf::from("/Applications/ActivityWatch.app"));
    if let Some(home) = home_dir() {
        candidates.push(home.join("Applications/ActivityWatch.app"));
    }

    candidates.into_iter().find(|path| path.exists())
}

#[cfg(target_os = "macos")]
fn launch_system_activitywatch(app_path: &Path) -> io::Result<()> {
    let status = Command::new("/usr/bin/open").arg(app_path).status()?;
    if status.success() {
        Ok(())
    } else {
        Err(io::Error::other(format!(
            "failed to open installed ActivityWatch app at {}",
            app_path.display()
        )))
    }
}

#[cfg(target_os = "macos")]
fn bundled_binary_path<R: Runtime>(app: &AppHandle<R>, name: &str) -> io::Result<PathBuf> {
    let filename = if cfg!(windows) {
        format!("{name}.exe")
    } else {
        name.to_string()
    };
    let mut fallback = None;
    for relative_path in [
        format!("resources/bin/{filename}"),
        format!("bin/{filename}"),
    ] {
        let resolved = app
            .path()
            .resolve(&relative_path, BaseDirectory::Resource)
            .map_err(io::Error::other)?;
        if resolved.exists() {
            return Ok(resolved);
        }
        if fallback.is_none() {
            fallback = Some(resolved);
        }
    }

    fallback.ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "no bundled binary path"))
}

#[cfg(target_os = "macos")]
fn home_dir() -> Option<PathBuf> {
    std::env::var_os("HOME").map(PathBuf::from)
}

#[cfg(target_os = "macos")]
fn is_port_open(port: u16) -> bool {
    std::net::TcpStream::connect(("127.0.0.1", port)).is_ok()
}

#[cfg(target_os = "macos")]
fn wait_for_local_port(port: u16, timeout: Duration) -> bool {
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        if is_port_open(port) {
            return true;
        }
        thread::sleep(Duration::from_millis(100));
    }
    false
}

fn is_local_activitywatch_url(url: &str) -> bool {
    match authority_without_scheme(url)
        .split('/')
        .next()
        .unwrap_or_default()
    {
        value if value.starts_with('[') => value == "[::1]" || value.starts_with("[::1]:"),
        value => {
            let host = value
                .split(':')
                .next()
                .unwrap_or_default()
                .to_ascii_lowercase();
            matches!(host.as_str(), "localhost" | "127.0.0.1")
        }
    }
}

fn activitywatch_port(url: &str) -> Option<u16> {
    let authority = authority_without_scheme(url);
    if authority.starts_with('[') {
        return authority
            .rsplit_once("]:")
            .and_then(|(_, port)| port.parse::<u16>().ok());
    }

    authority
        .split('/')
        .next()
        .and_then(|value| value.rsplit_once(':'))
        .and_then(|(_, port)| port.parse::<u16>().ok())
}

fn authority_without_scheme(url: &str) -> &str {
    url.split("://").nth(1).unwrap_or(url)
}

#[cfg(test)]
mod tests {
    use super::{
        ActivityWatchLaunchStrategy, DEFAULT_ACTIVITYWATCH_PORT, activitywatch_port,
        is_local_activitywatch_url, select_activitywatch_launch_strategy,
    };
    use deepblock_server::config::ActivityWatchConfig;

    #[cfg(target_os = "macos")]
    #[test]
    fn cli_install_preserves_unrelated_and_dangling_symlinks() {
        let dir = tempfile::tempdir().expect("tempdir");
        let bundled = dir.path().join("bundled-deepb");
        let link = dir.path().join("deepb");
        std::fs::write(&bundled, "bundled").expect("bundle");
        for target in [
            dir.path().join("custom-deepb"),
            dir.path().join("missing-deepb"),
        ] {
            std::os::unix::fs::symlink(&target, &link).expect("existing symlink");
            super::install_cli_link(&bundled, &link).expect("install");
            assert_eq!(std::fs::read_link(&link).expect("link"), target);
            std::fs::remove_file(&link).expect("cleanup");
        }
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn cli_install_preserves_regular_files_and_is_idempotent() {
        let dir = tempfile::tempdir().expect("tempdir");
        let bundled = dir.path().join("bundled-deepb");
        let link = dir.path().join("deepb");
        std::fs::write(&bundled, "bundled").expect("bundle");
        std::fs::write(&link, "user-owned").expect("existing file");
        super::install_cli_link(&bundled, &link).expect("install");
        assert_eq!(std::fs::read_to_string(&link).expect("file"), "user-owned");
        std::fs::remove_file(&link).expect("cleanup");
        super::install_cli_link(&bundled, &link).expect("first install");
        super::install_cli_link(&bundled, &link).expect("second install");
        assert_eq!(std::fs::read_link(&link).expect("link"), bundled);
    }

    #[test]
    fn parses_activitywatch_port_from_local_url() {
        assert_eq!(activitywatch_port("http://localhost:5600"), Some(5600));
        assert_eq!(activitywatch_port("localhost:5601"), Some(5601));
        assert_eq!(activitywatch_port("http://[::1]:5600"), Some(5600));
    }

    #[test]
    fn recognizes_local_activitywatch_urls() {
        assert!(is_local_activitywatch_url("http://localhost:5600"));
        assert!(is_local_activitywatch_url("127.0.0.1:5600"));
        assert!(is_local_activitywatch_url("http://[::1]:5600"));
        assert!(!is_local_activitywatch_url(
            "http://localhost.example.com:5600"
        ));
        assert!(!is_local_activitywatch_url(
            "http://activitywatch.example.com:5600"
        ));
    }

    #[test]
    fn prefers_system_install_before_bundled_fallback() {
        let settings = ActivityWatchConfig::default();
        assert_eq!(
            select_activitywatch_launch_strategy(
                &settings,
                DEFAULT_ACTIVITYWATCH_PORT,
                false,
                true,
                false,
            ),
            ActivityWatchLaunchStrategy::LaunchSystemInstall
        );
    }

    #[test]
    fn uses_bundled_fallback_when_no_system_install_exists() {
        let settings = ActivityWatchConfig::default();
        assert_eq!(
            select_activitywatch_launch_strategy(
                &settings,
                DEFAULT_ACTIVITYWATCH_PORT,
                false,
                false,
                false,
            ),
            ActivityWatchLaunchStrategy::LaunchBundledFallback
        );
    }

    #[test]
    fn explicit_bundled_launch_overrides_system_install_preference() {
        let settings = ActivityWatchConfig::default();
        assert_eq!(
            select_activitywatch_launch_strategy(
                &settings,
                DEFAULT_ACTIVITYWATCH_PORT,
                false,
                true,
                true,
            ),
            ActivityWatchLaunchStrategy::LaunchBundledFallback
        );
    }

    #[test]
    fn skips_auto_launch_when_local_server_is_already_reachable() {
        let settings = ActivityWatchConfig::default();
        assert_eq!(
            select_activitywatch_launch_strategy(
                &settings,
                DEFAULT_ACTIVITYWATCH_PORT,
                true,
                true,
                false,
            ),
            ActivityWatchLaunchStrategy::Skip
        );
    }
}
