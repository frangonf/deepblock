use deepblock_server::state::AppState;
use std::{
    process::{Child, Command, Stdio},
    time::{Duration, Instant},
};
use tempfile::tempdir;

struct Server(Child);
impl Drop for Server {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

#[tokio::test]
async fn server_rejects_a_non_loopback_bind_before_opening_a_listener() {
    let dir = tempdir().expect("tempdir");
    let output = tokio::time::timeout(
        Duration::from_secs(5),
        tokio::process::Command::new(env!("CARGO_BIN_EXE_deepblock-server"))
            .kill_on_drop(true)
            .env("XDG_DATA_HOME", dir.path().join("data"))
            .env("XDG_CONFIG_HOME", dir.path().join("config"))
            .env("XDG_STATE_HOME", dir.path().join("state"))
            .env("DEEPBLOCK_SERVER_HOST", "192.0.2.1")
            .env("DEEPBLOCK_SERVER_PORT", "0")
            .output(),
    )
    .await
    .expect("server must exit promptly")
    .expect("server process");
    assert!(!output.status.success());
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(
        stderr.contains("must bind to a loopback IP address"),
        "{stderr}"
    );
}

#[test]
fn second_process_cannot_write_the_same_storage_root() {
    let dir = tempdir().expect("tempdir");
    let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("port");
    let port = listener.local_addr().expect("address").port();
    drop(listener);
    let spawn = |port: u16| {
        Server(
            Command::new(env!("CARGO_BIN_EXE_deepblock-server"))
                .env("XDG_DATA_HOME", dir.path().join("data"))
                .env("XDG_CONFIG_HOME", dir.path().join("config"))
                .env("XDG_STATE_HOME", dir.path().join("state"))
                .env("DEEPBLOCK_SERVER_HOST", "127.0.0.1")
                .env("DEEPBLOCK_SERVER_PORT", port.to_string())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn()
                .expect("server"),
        )
    };
    let first = spawn(port);
    let deadline = Instant::now() + Duration::from_secs(5);
    while std::net::TcpStream::connect(("127.0.0.1", port)).is_err() {
        assert!(Instant::now() < deadline, "first server did not start");
        std::thread::sleep(Duration::from_millis(20));
    }
    let mut second = spawn(0);
    let deadline = Instant::now() + Duration::from_secs(2);
    let status = loop {
        if let Some(status) = second.0.try_wait().expect("status") {
            break Some(status);
        }
        if Instant::now() >= deadline {
            break None;
        }
        std::thread::sleep(Duration::from_millis(20));
    };
    assert!(
        status.is_some_and(|status| !status.success()),
        "second writer must fail to start"
    );
    drop(first);
    // OS locks must be released after a process exits, even abruptly.
    let mut replacement = spawn(port);
    std::thread::sleep(Duration::from_millis(100));
    assert!(
        replacement.0.try_wait().expect("status").is_none(),
        "storage lock should be reusable"
    );
}

#[test]
fn cleanup_preserves_another_process_runtime_metadata() {
    let dir = tempdir().expect("tempdir");
    let state = AppState::for_test(dir.path());
    deepblock_server::persist::write_json_pretty(
        &state.paths.server_runtime_file(),
        &deepblock_server::config::ServerRuntime {
            pid: std::process::id() + 1,
            host: "127.0.0.1".into(),
            port: 8000,
        },
    )
    .expect("runtime");
    std::fs::write(state.paths.pid_file(), "another process").expect("pid");
    state.remove_server_runtime().expect("cleanup");
    assert!(state.paths.server_runtime_file().exists());
    assert!(state.paths.pid_file().exists());
}
