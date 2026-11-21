mod portability;
use portability::{desktop_export_bundle, desktop_export_drafts, desktop_import_preview};
use std::time::{Duration, Instant};

use deepblock_server::{
    config::{DeepBlockPaths, ServerRuntime, load_settings},
    error::{AppError, AppResult},
    persist,
    runtime::{discover_server, is_healthy_server, remove_owned_runtime, storage_is_owned},
};
use serde::Serialize;
use tauri::{AppHandle, Manager, State};
#[cfg(target_os = "macos")]
use tauri::{
    menu::{MenuBuilder, MenuItemBuilder},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

mod distribution;

use distribution::{
    DesktopDistributionStatus, ManagedChildren, current_distribution_status,
    ensure_activitywatch_runtime, ensure_macos_cli_shim, install_macos_cli_shim,
    launch_bundled_activitywatch_fallback,
};

#[derive(Clone, Debug, Serialize)]
struct DesktopMetadata {
    api_base_url: String,
    version: String,
}

#[derive(Clone, Debug)]
struct DesktopRuntimeState {
    api_base_url: String,
    embedded_server: Option<EmbeddedServerTarget>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct EmbeddedServerTarget {
    host: String,
    port: u16,
}

const DEFAULT_DESKTOP_SERVER_HOST: &str = "127.0.0.1";
const DESKTOP_EMBEDDED_PORT_CANDIDATES: [u16; 5] = [5605, 5606, 5607, 5608, 5609];
#[cfg(target_os = "macos")]
const TRAY_MENU_SHOW: &str = "show";
#[cfg(target_os = "macos")]
const TRAY_MENU_HIDE: &str = "hide";
#[cfg(target_os = "macos")]
const TRAY_MENU_QUIT: &str = "quit";

fn init_tracing() {
    let _ = tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()),
        )
        .with(tracing_subscriber::fmt::layer())
        .try_init();
}

fn default_server_url(host: &str, port: u16) -> String {
    format!("http://{host}:{port}")
}

fn wait_for_server_ready(api_base: &str, timeout: Duration) -> bool {
    let deadline = Instant::now() + timeout;

    while Instant::now() < deadline {
        if tauri::async_runtime::block_on(is_healthy_server(api_base)) {
            return true;
        }
        std::thread::sleep(Duration::from_millis(100));
    }

    false
}

fn verify_embedded_backend(paths: &DeepBlockPaths, url: &str) -> AppResult<()> {
    if storage_is_owned(paths)? && paths.server_runtime_file().exists() {
        let runtime = persist::read_json_file::<ServerRuntime>(&paths.server_runtime_file())?;
        if runtime.pid == std::process::id() && runtime.base_url() == url {
            return Ok(());
        }
    }
    Err(AppError::BadRequest("The embedded backend did not acquire the expected runtime; refusing to connect to another storage owner.".into()))
}

fn first_available_embedded_port() -> AppResult<u16> {
    DESKTOP_EMBEDDED_PORT_CANDIDATES
        .into_iter()
        .find(|port| std::net::TcpListener::bind((DEFAULT_DESKTOP_SERVER_HOST, *port)).is_ok())
        .ok_or_else(|| {
            AppError::BadRequest("No free embedded backend port is available (5605–5609).".into())
        })
}

fn select_desktop_runtime_state(
    server_url: Option<&str>,
    embedded_port: u16,
) -> DesktopRuntimeState {
    if let Some(url) = server_url {
        return DesktopRuntimeState {
            api_base_url: url.to_string(),
            embedded_server: None,
        };
    }

    DesktopRuntimeState {
        api_base_url: default_server_url(DEFAULT_DESKTOP_SERVER_HOST, embedded_port),
        embedded_server: Some(EmbeddedServerTarget {
            host: DEFAULT_DESKTOP_SERVER_HOST.to_string(),
            port: embedded_port,
        }),
    }
}

async fn determine_desktop_runtime_state() -> AppResult<DesktopRuntimeState> {
    let paths = DeepBlockPaths::resolve()?;
    let url = discover_server(&paths, std::env::var("DEEPBLOCK_SERVER_URL").ok()).await?;
    let port = if url.is_none() {
        first_available_embedded_port()?
    } else {
        DESKTOP_EMBEDDED_PORT_CANDIDATES[0]
    };
    Ok(select_desktop_runtime_state(url.as_deref(), port))
}

#[cfg(target_os = "macos")]
fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

#[cfg(target_os = "macos")]
fn hide_main_window(window: &tauri::WebviewWindow) {
    let _ = window.hide();
}

#[cfg(target_os = "macos")]
fn build_tray(app: &tauri::App) -> tauri::Result<()> {
    let show = MenuItemBuilder::with_id(TRAY_MENU_SHOW, "Show DeepBlock").build(app)?;
    let hide = MenuItemBuilder::with_id(TRAY_MENU_HIDE, "Hide DeepBlock").build(app)?;
    let quit = MenuItemBuilder::with_id(TRAY_MENU_QUIT, "Quit DeepBlock").build(app)?;
    let menu = MenuBuilder::new(app)
        .items(&[&show, &hide, &quit])
        .build()?;

    let tray_builder = TrayIconBuilder::with_id("deepblock-tray")
        .icon(tauri::include_image!("icons/tray.png"))
        .icon_as_template(true);

    tray_builder
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            TRAY_MENU_SHOW => show_main_window(app),
            TRAY_MENU_HIDE => {
                if let Some(window) = app.get_webview_window("main") {
                    hide_main_window(&window);
                }
            }
            TRAY_MENU_QUIT => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main_window(tray.app_handle());
            }
        })
        .build(app)?;

    Ok(())
}

#[tauri::command]
fn desktop_metadata(runtime: State<'_, DesktopRuntimeState>) -> DesktopMetadata {
    DesktopMetadata {
        api_base_url: runtime.api_base_url.clone(),
        version: env!("CARGO_PKG_VERSION").to_string(),
    }
}

fn load_desktop_settings() -> Result<deepblock_server::config::Settings, String> {
    let paths = DeepBlockPaths::resolve().map_err(|error| error.to_string())?;
    load_settings(&paths).map_err(|error| error.to_string())
}

fn remove_embedded_server_runtime_files() {
    if let Ok(paths) = DeepBlockPaths::resolve()
        && let Err(error) = remove_owned_runtime(&paths)
    {
        tracing::warn!("unable to clean up owned desktop runtime: {error}");
    }
}

#[tauri::command]
fn desktop_distribution_status(
    app: AppHandle,
    managed_children: State<'_, ManagedChildren>,
) -> Result<DesktopDistributionStatus, String> {
    let settings = load_desktop_settings()?;
    current_distribution_status(&app, &settings.activitywatch, managed_children.inner())
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn desktop_install_bundled_cli(
    app: AppHandle,
    managed_children: State<'_, ManagedChildren>,
) -> Result<DesktopDistributionStatus, String> {
    let settings = load_desktop_settings()?;
    install_macos_cli_shim(&app, &settings.activitywatch, managed_children.inner())
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn desktop_launch_bundled_activitywatch(
    app: AppHandle,
    managed_children: State<'_, ManagedChildren>,
) -> Result<DesktopDistributionStatus, String> {
    let settings = load_desktop_settings()?;
    launch_bundled_activitywatch_fallback(&app, &settings.activitywatch, managed_children.inner())
        .map_err(|error| error.to_string())
}

pub fn run() {
    init_tracing();

    let managed_children = ManagedChildren::default();
    let runtime_state = match tauri::async_runtime::block_on(determine_desktop_runtime_state()) {
        Ok(runtime) => runtime,
        Err(error) => {
            tracing::error!("unable to connect desktop backend: {error}");
            std::process::exit(1);
        }
    };

    tauri::Builder::default()
        .manage(managed_children)
        .manage(runtime_state.clone())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .on_window_event(|window, event| {
            #[cfg(not(target_os = "macos"))]
            let _ = (window, event);

            #[cfg(target_os = "macos")]
            if window.label() != "main" {
                return;
            }

            #[cfg(target_os = "macos")]
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                if let Some(main_window) = window.app_handle().get_webview_window("main") {
                    hide_main_window(&main_window);
                }
            }
        })
        .setup(|app| {
            let runtime = app.state::<DesktopRuntimeState>().inner().clone();
            let api_base = runtime.api_base_url.clone();
            let embedded = runtime.embedded_server.is_some();
            if let Some(target) = runtime.embedded_server {
                tauri::async_runtime::spawn(async move {
                    if let Err(error) =
                        deepblock_server::serve(Some(target.host), Some(target.port)).await
                    {
                        tracing::warn!("desktop server bootstrap exited: {error}");
                    }
                });
            }
            if !wait_for_server_ready(&api_base, Duration::from_secs(8)) {
                return Err(std::io::Error::other(format!("DeepBlock backend is unavailable at {api_base}; check storage ownership and stop an unreachable owner before retrying.")).into());
            }
            // A healthy service can win the bind race after the port probe.
            // Embedded mode must prove this process started the expected owner.
            if embedded {
                verify_embedded_backend(&DeepBlockPaths::resolve()?, &api_base)?;
            }
            #[cfg(target_os = "macos")]
            build_tray(app)?;
            ensure_macos_cli_shim(app.handle());
            if let Ok(paths) = DeepBlockPaths::resolve()
                && let Ok(settings) = load_settings(&paths)
            {
                let managed = app.state::<ManagedChildren>();
                ensure_activitywatch_runtime(app.handle(), &settings.activitywatch, &managed);
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            desktop_metadata,
            desktop_distribution_status,
            desktop_install_bundled_cli,
            desktop_launch_bundled_activitywatch,
            desktop_export_bundle,
            desktop_import_preview,
            desktop_export_drafts
        ])
        .build(tauri::generate_context!())
        .expect("failed to build DeepBlock desktop shell")
        .run(|app, event| {
            if matches!(event, tauri::RunEvent::Exit) {
                app.state::<ManagedChildren>().terminate_all();
                if app.state::<DesktopRuntimeState>().embedded_server.is_some() {
                    remove_embedded_server_runtime_files();
                }
            }
        });
}

#[cfg(test)]
mod tests {
    use super::select_desktop_runtime_state;

    #[test]
    fn discovered_servers_are_not_owned_by_desktop() {
        let state = select_desktop_runtime_state(Some("http://127.0.0.1:5607"), 5605);
        assert_eq!(state.api_base_url, "http://127.0.0.1:5607");
        assert!(state.embedded_server.is_none());
    }

    #[test]
    fn refuses_an_exhausted_embedded_port_set() {
        let _leases: Vec<_> = super::DESKTOP_EMBEDDED_PORT_CANDIDATES
            .into_iter()
            .filter_map(|port| std::net::TcpListener::bind(("127.0.0.1", port)).ok())
            .collect();
        assert!(super::first_available_embedded_port().is_err());
    }

    #[test]
    fn embedded_readiness_requires_the_current_storage_owner_and_endpoint() {
        use deepblock_server::{
            config::{DeepBlockPaths, ServerRuntime},
            persist,
        };
        let dir = tempfile::tempdir().expect("tempdir");
        let paths = DeepBlockPaths::from_roots(
            dir.path().join("data"),
            dir.path().join("config"),
            dir.path().join("state"),
        );
        paths.ensure_dirs().expect("dirs");
        let mut runtime = ServerRuntime {
            pid: std::process::id(),
            host: "127.0.0.1".into(),
            port: 5605,
        };
        persist::write_json_pretty(&paths.server_runtime_file(), &runtime).expect("metadata");
        let url = runtime.base_url();
        assert!(
            super::verify_embedded_backend(&paths, &url).is_err(),
            "a stale own-PID record is not a live backend"
        );
        let lock = std::fs::OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(paths.data_root.join("server.lock"))
            .expect("lock");
        lock.try_lock().expect("ownership");
        super::verify_embedded_backend(&paths, &url).expect("current owner at expected endpoint");
        assert!(super::verify_embedded_backend(&paths, "http://127.0.0.1:5606").is_err());
        runtime.pid += 1;
        persist::write_json_pretty(&paths.server_runtime_file(), &runtime)
            .expect("foreign metadata");
        assert!(
            super::verify_embedded_backend(&paths, &url).is_err(),
            "another owner is not this embedded backend"
        );
    }

    #[test]
    fn starts_embedded_only_when_discovery_found_no_backend() {
        let state = select_desktop_runtime_state(None, 5606);
        assert_eq!(state.api_base_url, "http://127.0.0.1:5606");
        assert_eq!(state.embedded_server.expect("embedded target").port, 5606);
    }
}
