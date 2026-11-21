#![cfg(unix)]
use deepblock_server::{
    config::{DeepBlockPaths, ServerRuntime},
    persist,
};
use nix::{
    sys::signal::{Signal, kill},
    unistd::Pid,
};
use std::{
    process::{Child, Command, Stdio},
    time::{Duration, Instant},
};
use tempfile::tempdir;

struct Process(Child);
impl Drop for Process {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}
fn roots(dir: &std::path::Path) -> DeepBlockPaths {
    DeepBlockPaths::from_roots(
        dir.join("data/deepblock"),
        dir.join("config/deepblock"),
        dir.join("state/deepblock"),
    )
}
fn cli(dir: &std::path::Path) -> Command {
    let mut command = Command::new(env!("CARGO_BIN_EXE_deepb"));
    command
        .env("XDG_DATA_HOME", dir.join("data"))
        .env("XDG_CONFIG_HOME", dir.join("config"))
        .env("XDG_STATE_HOME", dir.join("state"));
    command
}

#[test]
fn stop_can_signal_the_recorded_owner_even_when_health_is_unresponsive() {
    let dir = tempdir().expect("tempdir");
    let paths = roots(dir.path());
    let socket = std::net::TcpListener::bind("127.0.0.1:0").expect("port");
    let port = socket.local_addr().expect("address").port();
    drop(socket);
    let mut owner = Process(
        cli(dir.path())
            .args(["serve", "--host", "127.0.0.1", "--port", &port.to_string()])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .expect("owner"),
    );
    let deadline = Instant::now() + Duration::from_secs(5);
    while !paths.server_runtime_file().exists()
        || std::net::TcpStream::connect(("127.0.0.1", port)).is_err()
    {
        assert!(Instant::now() < deadline, "owner must start");
        std::thread::sleep(Duration::from_millis(20));
    }
    let pid = Pid::from_raw(owner.0.id() as i32);
    kill(pid, Signal::SIGSTOP).expect("pause health responses");
    let output = cli(dir.path()).arg("stop").output().expect("stop");
    assert!(
        output.status.success(),
        "stop must not depend on a healthy endpoint: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    kill(pid, Signal::SIGCONT).expect("resume owner so it can handle TERM");
    let deadline = Instant::now() + Duration::from_secs(3);
    while owner.0.try_wait().expect("status").is_none() {
        assert!(Instant::now() < deadline, "owner must stop");
        std::thread::sleep(Duration::from_millis(20));
    }
}

#[test]
fn stop_refuses_stale_pid_files_without_a_storage_owner() {
    let dir = tempdir().expect("tempdir");
    let paths = roots(dir.path());
    paths.ensure_dirs().expect("dirs");
    // Use a disposable process, never the test harness or a user process.
    let mut unrelated = Process(Command::new("/bin/sleep").arg("60").spawn().expect("sleep"));
    persist::write_json_pretty(
        &paths.server_runtime_file(),
        &ServerRuntime {
            pid: unrelated.0.id(),
            host: "127.0.0.1".into(),
            port: 1,
        },
    )
    .expect("stale metadata");
    std::fs::write(paths.pid_file(), unrelated.0.id().to_string()).expect("stale pid");
    let output = cli(dir.path()).arg("stop").output().expect("stop");
    assert!(
        !output.status.success(),
        "an unlocked root cannot identify a running owner"
    );
    assert!(unrelated.0.try_wait().expect("status").is_none());
}
