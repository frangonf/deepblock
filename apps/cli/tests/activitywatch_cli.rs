use deepblock_server::{
    config::{DeepBlockPaths, Settings},
    persist,
};
use std::{fs, path::Path, process::Command};

fn isolate(root: &Path) -> DeepBlockPaths {
    let paths = DeepBlockPaths::from_roots(
        root.join("data/deepblock"),
        root.join("config/deepblock"),
        root.join("state/deepblock"),
    );
    paths.ensure_dirs().unwrap();
    paths
}

fn aw_cli(root: &Path, args: &[&str]) -> std::process::Output {
    Command::new(env!("CARGO_BIN_EXE_deepb"))
        .env("XDG_DATA_HOME", root.join("data"))
        .env("XDG_CONFIG_HOME", root.join("config"))
        .env("XDG_STATE_HOME", root.join("state"))
        .args(args)
        .output()
        .expect("cli binary runs")
}

fn write_settings(paths: &DeepBlockPaths, enabled: bool, url: &str) {
    let mut settings = Settings::default();
    settings.activitywatch.enabled = enabled;
    settings.activitywatch.url = url.to_string();
    persist::write_toml_file(&paths.config_file(), &settings).unwrap();
}

fn plant_local_binary(paths: &DeepBlockPaths, name: &str) {
    let bin_dir = paths.state_root.join("bin");
    fs::create_dir_all(&bin_dir).unwrap();
    fs::write(bin_dir.join(name), "#!/bin/sh\n").unwrap();
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn aw_status_reports_detected_binaries_and_reachability() {
    let root = tempfile::tempdir().unwrap();
    let paths = isolate(root.path());
    plant_local_binary(&paths, "aw-server");

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    tokio::spawn(async move {
        axum::serve(
            listener,
            axum::Router::new().route(
                "/api/0/info",
                axum::routing::get(|| async {
                    axum::Json(serde_json::json!({"hostname": "t", "testing": false}))
                }),
            ),
        )
        .await
        .unwrap();
    });
    write_settings(&paths, true, &url);

    let output = aw_cli(root.path(), &["aw", "status"]);
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let stdout = String::from_utf8_lossy(&output.stdout);
    assert!(
        stdout.contains("activitywatch enabled: yes"),
        "got: {stdout}"
    );
    assert!(
        stdout.contains(&format!("configured url: {url}")),
        "got: {stdout}"
    );
    assert!(stdout.contains("server reachable: yes"), "got: {stdout}");
    assert!(
        stdout.contains("local binaries: aw-server"),
        "got: {stdout}"
    );

    let output = aw_cli(root.path(), &["--json", "aw", "status"]);
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let status: serde_json::Value =
        serde_json::from_str(String::from_utf8_lossy(&output.stdout).trim()).unwrap();
    assert_eq!(status["enabled"], true);
    assert_eq!(status["reachable"], true);
    assert_eq!(status["url"], url.as_str());
    assert_eq!(status["local_binaries"], serde_json::json!(["aw-server"]));
    assert_eq!(status["system_install_path"], serde_json::Value::Null);
}

#[test]
fn aw_doctor_without_integration_explains_how_to_enable_it() {
    let root = tempfile::tempdir().unwrap();
    let paths = isolate(root.path());
    plant_local_binary(&paths, "aw-server");
    write_settings(&paths, false, "http://127.0.0.1:5600");

    let output = aw_cli(root.path(), &["aw", "doctor"]);
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let stdout = String::from_utf8_lossy(&output.stdout);
    assert!(
        stdout.contains("Enable [activitywatch].enabled = true"),
        "got: {stdout}"
    );
    assert!(!stdout.contains("Recommended setup:"), "got: {stdout}");
}

#[test]
fn aw_doctor_lists_setup_steps_and_unreachable_server() {
    let root = tempfile::tempdir().unwrap();
    let paths = isolate(root.path());
    plant_local_binary(&paths, "aw-watcher-afk");
    write_settings(&paths, true, "http://127.0.0.1:9");

    let output = aw_cli(root.path(), &["aw", "doctor"]);
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let stdout = String::from_utf8_lossy(&output.stdout);
    assert!(stdout.contains("ActivityWatch doctor"), "got: {stdout}");
    assert!(
        stdout.contains("local binaries: aw-watcher-afk"),
        "got: {stdout}"
    );
    assert!(stdout.contains("Recommended setup:"), "got: {stdout}");
    assert!(
        stdout.contains("Install the ActivityWatch desktop app"),
        "got: {stdout}"
    );
    assert!(
        stdout.contains("ActivityWatch server is not reachable right now"),
        "got: {stdout}"
    );
}

#[test]
fn stop_reports_runtime_ownership_mismatch() {
    let root = tempfile::tempdir().unwrap();
    let paths = isolate(root.path());

    use std::fs::OpenOptions;
    let lock = OpenOptions::new()
        .create(true)
        .read(true)
        .write(true)
        .truncate(false)
        .open(paths.data_root.join("server.lock"))
        .unwrap();
    std::fs::File::lock(&lock).unwrap();
    fs::write(paths.pid_file(), "43210").unwrap();
    fs::write(
        paths.server_runtime_file(),
        serde_json::to_string(&deepblock_server::config::ServerRuntime {
            pid: 999,
            host: "127.0.0.1".into(),
            port: 8000,
        })
        .unwrap(),
    )
    .unwrap();

    let output = aw_cli(root.path(), &["stop"]);
    assert!(!output.status.success(), "mismatched pid must fail");
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(
        stderr.contains("do not agree"),
        "expected ownership mismatch, got: {stderr}"
    );
}
