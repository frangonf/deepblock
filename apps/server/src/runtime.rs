//! Shared local-backend discovery and owner-checked runtime cleanup.
use crate::{
    config::{DeepBlockPaths, ServerRuntime, load_settings},
    error::{AppError, AppResult},
    models::HealthResponse,
    persist,
};
use std::{fs::OpenOptions, io::ErrorKind, time::Duration};

pub const DEFAULT_SERVER_URL: &str = "http://127.0.0.1:8000";

pub async fn is_healthy_server(url: &str) -> bool {
    let response = reqwest::Client::new()
        .get(format!("{}/health", url.trim_end_matches('/')))
        .timeout(Duration::from_secs(1))
        .send()
        .await;
    match response {
        Ok(response) if response.status().is_success() => response
            .json::<HealthResponse>()
            .await
            .is_ok_and(|health| health.service == "deepblock" && health.status == "ok"),
        _ => false,
    }
}

pub fn storage_is_owned(paths: &DeepBlockPaths) -> AppResult<bool> {
    let lock_path = paths.data_root.join("server.lock");
    Ok(if lock_path.exists() {
        let lock = OpenOptions::new().read(true).write(true).open(lock_path)?;
        match lock.try_lock() {
            Ok(()) => false,
            Err(std::fs::TryLockError::WouldBlock) => true,
            Err(std::fs::TryLockError::Error(error)) => return Err(error.into()),
        }
    } else {
        false
    })
}

pub async fn discover_server(
    paths: &DeepBlockPaths,
    explicit: Option<String>,
) -> AppResult<Option<String>> {
    if let Some(url) = explicit {
        return Ok(Some(url.trim_end_matches('/').to_string()));
    }
    if storage_is_owned(paths)? {
        let runtime_path = paths.server_runtime_file();
        if runtime_path.exists() {
            let runtime = persist::read_json_file::<ServerRuntime>(&runtime_path)?;
            if is_healthy_server(&runtime.base_url()).await {
                return Ok(Some(runtime.base_url()));
            }
        }
        return Err(AppError::BadRequest("DeepBlock storage already has a writer, but its backend is unavailable or incompatible. Stop that owner before starting a replacement.".into()));
    }
    let configured = load_settings(paths)?.server.with_env_overrides().base_url();
    for url in [&configured, DEFAULT_SERVER_URL] {
        if is_healthy_server(url).await {
            return Ok(Some(url.to_string()));
        }
        if configured == DEFAULT_SERVER_URL {
            break;
        }
    }
    Ok(None)
}

pub fn remove_owned_runtime(paths: &DeepBlockPaths) -> AppResult<()> {
    let runtime_file = paths.server_runtime_file();
    if !runtime_file.exists()
        || persist::read_json_file::<ServerRuntime>(&runtime_file)?.pid != std::process::id()
    {
        return Ok(());
    }
    for file in [paths.pid_file(), runtime_file] {
        match std::fs::remove_file(file) {
            Ok(()) => {}
            Err(error) if error.kind() == ErrorKind::NotFound => {}
            Err(error) => return Err(error.into()),
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::AppState;

    #[test]
    fn remove_owned_runtime_tolerates_missing_files_and_only_removes_owned_ones() {
        let dir = tempfile::tempdir().unwrap();
        let state = AppState::for_test(dir.path());
        let paths = state.paths.clone();
        persist::write_json_pretty(
            &paths.server_runtime_file(),
            &crate::config::ServerRuntime {
                pid: std::process::id(),
                host: "127.0.0.1".into(),
                port: 5600,
            },
        )
        .unwrap();
        // The pid file is already gone; removing owned runtime state must
        // still tolerate the missing file and clean the runtime record.
        remove_owned_runtime(&paths).expect("missing pid file is tolerated");
        assert!(!paths.server_runtime_file().exists());

        persist::write_json_pretty(
            &paths.server_runtime_file(),
            &crate::config::ServerRuntime {
                pid: std::process::id() + 1,
                host: "127.0.0.1".into(),
                port: 5600,
            },
        )
        .unwrap();
        remove_owned_runtime(&paths).expect("other runtimes are left alone");
        assert!(
            paths.server_runtime_file().exists(),
            "a foreign runtime record stays on disk"
        );
    }
}
