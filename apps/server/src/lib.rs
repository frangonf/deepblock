pub mod aw;
pub mod bundle;
pub mod config;
pub mod context;
pub mod error;
pub mod history;
pub mod models;
pub mod modules;
pub mod persist;
pub mod range_review;
pub mod replacement;
pub mod request_policy;
pub mod review;
pub mod revision;
pub mod routes;
pub mod runtime;
pub mod state;
pub mod storage;
pub mod ws;

use std::net::SocketAddr;

use axum::Router;
use tokio::net::TcpListener;
use tracing::info;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

use crate::error::{AppError, AppResult};
use crate::state::AppState;

pub fn app(state: AppState) -> Router {
    routes::router(state)
}

pub async fn serve(host_override: Option<String>, port_override: Option<u16>) -> AppResult<()> {
    init_tracing();

    let paths = config::DeepBlockPaths::resolve()?;
    paths.ensure_dirs()?;
    // Never delete this lock file: its stable inode coordinates all processes
    // sharing the data root. Closing the handle releases even a crashed writer.
    let instance_lock = std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(paths.data_root.join("server.lock"))?;
    instance_lock.try_lock().map_err(|error| {
        std::io::Error::other(format!(
            "DeepBlock storage already has a writer or cannot be locked: {error}"
        ))
    })?;
    let state = AppState::load().await?;
    let endpoint = state
        .settings
        .read()
        .await
        .server
        .clone()
        .with_env_overrides();
    let host = host_override.unwrap_or(endpoint.host);
    let port = port_override.unwrap_or(endpoint.port);
    let addr = match host.parse() {
        Ok(ip) => SocketAddr::new(ip, port),
        Err(_) => format!("{host}:{port}").parse()?,
    };
    if !addr.ip().is_loopback() {
        return Err(AppError::BadRequest(
            "DeepBlock server must bind to a loopback IP address (127.0.0.1 or ::1)".into(),
        ));
    }

    let listener = TcpListener::bind(addr).await?;
    state.write_server_runtime(&host, port)?;
    info!("deepblock-server listening on http://{addr}");

    let server = axum::serve(listener, app(state.clone()).into_make_service());
    let shutdown = shutdown_signal();

    tokio::select! {
        result = server => {
            state.remove_server_runtime()?;
            result?;
        }
        _ = shutdown => {
            info!("shutdown signal received");
            state.remove_server_runtime()?;
        }
    }

    Ok(())
}

fn init_tracing() {
    let _ = tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()),
        )
        .with(tracing_subscriber::fmt::layer())
        .try_init();
}

async fn shutdown_signal() {
    #[cfg(unix)]
    {
        if let Ok(mut terminate) =
            tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
        {
            tokio::select! {
                _ = tokio::signal::ctrl_c() => {},
                _ = terminate.recv() => {},
            }
            return;
        }
    }
    let _ = tokio::signal::ctrl_c().await;
}
