use axum::{Json, Router, routing::get};
use deepblock_server::{
    config::{DeepBlockPaths, ServerRuntime},
    persist,
    runtime::discover_server,
};
use tempfile::tempdir;

#[tokio::test]
async fn reuses_the_recorded_storage_owner_on_an_alternate_port() {
    let dir = tempdir().expect("tempdir");
    let paths = DeepBlockPaths::from_roots(
        dir.path().join("data"),
        dir.path().join("config"),
        dir.path().join("state"),
    );
    paths.ensure_dirs().expect("dirs");
    let lock = std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(paths.data_root.join("server.lock"))
        .expect("lock file");
    lock.try_lock().expect("ownership");
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .expect("listener");
    let port = listener.local_addr().expect("address").port();
    let server = tokio::spawn(async move {
        axum::serve(
            listener,
            Router::new().route(
                "/health",
                get(|| async {
                    Json(serde_json::json!({"service":"deepblock","status":"ok","version":"test"}))
                }),
            ),
        )
        .await
        .expect("server");
    });
    persist::write_json_pretty(
        &paths.server_runtime_file(),
        &ServerRuntime {
            pid: std::process::id(),
            host: "127.0.0.1".into(),
            port,
        },
    )
    .expect("metadata");
    assert_eq!(
        discover_server(&paths, None).await.expect("discovery"),
        Some(format!("http://127.0.0.1:{port}"))
    );
    server.abort();
}

#[tokio::test]
async fn an_unreachable_owner_is_not_bypassed_with_another_port() {
    let dir = tempdir().expect("tempdir");
    let paths = DeepBlockPaths::from_roots(
        dir.path().join("data"),
        dir.path().join("config"),
        dir.path().join("state"),
    );
    paths.ensure_dirs().expect("dirs");
    let lock = std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(paths.data_root.join("server.lock"))
        .expect("lock");
    lock.try_lock().expect("ownership");
    let error = discover_server(&paths, None)
        .await
        .expect_err("must not replace an owner");
    assert!(error.to_string().contains("already has a writer"));
}

#[tokio::test]
async fn unrelated_http_services_are_not_adopted_as_deepblock() {
    let dir = tempdir().expect("tempdir");
    let paths = DeepBlockPaths::from_roots(
        dir.path().join("data"),
        dir.path().join("config"),
        dir.path().join("state"),
    );
    paths.ensure_dirs().expect("dirs");
    let lock = std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(paths.data_root.join("server.lock"))
        .expect("lock");
    lock.try_lock().expect("ownership");
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .expect("listener");
    let port = listener.local_addr().expect("address").port();
    let server = tokio::spawn(async move {
        axum::serve(
            listener,
            Router::new().route(
                "/health",
                get(|| async {
                    Json(
                        serde_json::json!({"service":"another-app","status":"ok","version":"test"}),
                    )
                }),
            ),
        )
        .await
        .expect("server");
    });
    persist::write_json_pretty(
        &paths.server_runtime_file(),
        &ServerRuntime {
            pid: std::process::id(),
            host: "127.0.0.1".into(),
            port,
        },
    )
    .expect("metadata");
    assert!(discover_server(&paths, None).await.is_err());
    server.abort();
}

#[tokio::test]
async fn configured_backends_are_reused_without_deleting_stale_metadata() {
    use deepblock_server::config::{Settings, save_settings};
    let dir = tempdir().expect("tempdir");
    let paths = DeepBlockPaths::from_roots(
        dir.path().join("data"),
        dir.path().join("config"),
        dir.path().join("state"),
    );
    paths.ensure_dirs().expect("dirs");
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .expect("listener");
    let port = listener.local_addr().expect("address").port();
    let server = tokio::spawn(async move {
        axum::serve(
            listener,
            Router::new().route(
                "/health",
                get(|| async {
                    Json(serde_json::json!({"service":"deepblock","status":"ok","version":"test"}))
                }),
            ),
        )
        .await
        .expect("server");
    });
    let mut settings = Settings::default();
    settings.server.port = port;
    save_settings(&paths, &settings).expect("settings");
    persist::write_json_pretty(
        &paths.server_runtime_file(),
        &ServerRuntime {
            pid: u32::MAX,
            host: "127.0.0.1".into(),
            port: 1,
        },
    )
    .expect("stale metadata");
    std::fs::write(paths.pid_file(), u32::MAX.to_string()).expect("stale pid");
    assert_eq!(
        discover_server(&paths, None).await.expect("discovery"),
        Some(format!("http://127.0.0.1:{port}"))
    );
    assert_eq!(
        persist::read_json_file::<ServerRuntime>(&paths.server_runtime_file())
            .expect("unchanged metadata")
            .pid,
        u32::MAX
    );
    assert!(paths.pid_file().exists());
    server.abort();
}

#[tokio::test]
async fn health_checks_have_a_bounded_deadline() {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .expect("listener");
    let address = listener.local_addr().expect("address");
    let server = tokio::spawn(async move {
        axum::serve(
            listener,
            Router::new().route(
                "/health",
                get(|| async { std::future::pending::<Json<serde_json::Value>>().await }),
            ),
        )
        .await
        .expect("server");
    });
    let healthy = tokio::time::timeout(
        std::time::Duration::from_secs(3),
        deepblock_server::runtime::is_healthy_server(&format!("http://{address}")),
    )
    .await
    .expect("bounded probe");
    assert!(!healthy);
    server.abort();
}

#[tokio::test]
async fn explicit_endpoints_are_preserved_without_touching_runtime_files() {
    let dir = tempdir().expect("tempdir");
    let paths = DeepBlockPaths::from_roots(
        dir.path().join("data"),
        dir.path().join("config"),
        dir.path().join("state"),
    );
    assert_eq!(
        discover_server(&paths, Some("http://127.0.0.1:8010/".into()))
            .await
            .expect("explicit"),
        Some("http://127.0.0.1:8010".into())
    );
    assert!(!paths.data_root.exists());
}
