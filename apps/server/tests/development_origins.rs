use std::{
    process::{Child, Command, Stdio},
    time::Duration,
};

use reqwest::{Client, StatusCode};
use tempfile::{TempDir, tempdir};

/// Bound probes and requests so a wedged server fails the test instead of
/// hanging the whole suite.
fn client() -> Client {
    Client::builder()
        .timeout(Duration::from_secs(5))
        .build()
        .expect("test client")
}

struct Server {
    child: Child,
    _root: TempDir,
    url: String,
}

impl Drop for Server {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

async fn start(origins: Option<&str>, mode: bool) -> Server {
    let root = tempdir().expect("tempdir");
    let socket = std::net::TcpListener::bind("127.0.0.1:0").expect("port");
    let port = socket.local_addr().expect("address").port();
    drop(socket);
    let mut command = Command::new(env!("CARGO_BIN_EXE_deepblock-server"));
    command
        .env("XDG_DATA_HOME", root.path().join("data"))
        .env("XDG_CONFIG_HOME", root.path().join("config"))
        .env("XDG_STATE_HOME", root.path().join("state"))
        .env("DEEPBLOCK_SERVER_HOST", "127.0.0.1")
        .env("DEEPBLOCK_SERVER_PORT", port.to_string())
        .env_remove("DEEPBLOCK_DEV_MODE")
        .env_remove("DEEPBLOCK_DEV_ORIGINS")
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    if mode {
        command.env("DEEPBLOCK_DEV_MODE", "1");
    }
    if let Some(origins) = origins {
        command.env("DEEPBLOCK_DEV_ORIGINS", origins);
    }
    let mut server = Server {
        child: command.spawn().expect("server"),
        _root: root,
        url: format!("http://127.0.0.1:{port}"),
    };
    for _ in 0..100 {
        if client()
            .get(format!("{}/health", server.url))
            .send()
            .await
            .is_ok()
        {
            return server;
        }
        assert!(
            server.child.try_wait().expect("child status").is_none(),
            "server exited before ready"
        );
        tokio::time::sleep(Duration::from_millis(30)).await;
    }
    panic!("server did not start");
}

#[tokio::test]
async fn configured_development_origin_can_write_and_pass_preflight() {
    let server = start(Some("http://192.168.1.20:5173"), true).await;
    let client = client();
    let status: serde_json::Value = client
        .get(format!("{}/storage/status", server.url))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let write = client
        .post(format!("{}/mode", server.url))
        .header(
            "x-deepblock-dataset-generation",
            status["generation"].as_str().unwrap(),
        )
        .header("origin", "http://192.168.1.20:5173")
        .json(&serde_json::json!({"mode": "focus"}))
        .send()
        .await
        .expect("write");
    assert_eq!(write.status(), StatusCode::OK);
    let preflight = client
        .request(reqwest::Method::OPTIONS, format!("{}/mode", server.url))
        .header("origin", "http://192.168.1.20:5173")
        .header("access-control-request-method", "POST")
        .header(
            "access-control-request-headers",
            "content-type,x-deepblock-dataset-generation",
        )
        .send()
        .await
        .expect("preflight");
    assert_eq!(preflight.status(), StatusCode::OK);
    assert_eq!(
        preflight.headers()["access-control-allow-origin"],
        "http://192.168.1.20:5173"
    );
}

#[tokio::test]
async fn development_policy_still_rejects_foreign_origins_and_hosts() {
    let server = start(Some("http://devbox.lan:5173"), true).await;
    let client = client();
    for origin in [
        "http://devbox.lan.evil:5173",
        "http://devbox.lan:5174",
        "null",
        "https://evil.example",
    ] {
        let response = client
            .get(format!("{}/health", server.url))
            .header("origin", origin)
            .send()
            .await
            .expect("response");
        assert_eq!(response.status(), StatusCode::FORBIDDEN, "{origin}");
    }
    let response = client
        .get(format!("{}/health", server.url))
        .header("host", "devbox.lan:8000")
        .send()
        .await
        .expect("response");
    assert_eq!(response.status(), StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn configured_development_origin_can_upgrade_websocket() {
    use tokio_tungstenite::tungstenite::client::IntoClientRequest;
    let server = start(Some("http://devbox.lan:5173"), true).await;
    let url = format!("{}/ws/events", server.url.replace("http:", "ws:"));
    let mut request = url.as_str().into_client_request().expect("request");
    request
        .headers_mut()
        .insert("origin", "http://devbox.lan:5173".parse().expect("origin"));
    let (mut socket, response) = tokio_tungstenite::connect_async(request)
        .await
        .expect("upgrade");
    assert_eq!(response.status(), StatusCode::SWITCHING_PROTOCOLS);
    socket.close(None).await.expect("close");
    assert!(
        tokio_tungstenite::connect_async(url).await.is_err(),
        "missing Origin rejected"
    );
}

#[tokio::test]
async fn production_default_rejects_lan_origins() {
    let server = start(None, false).await;
    let response = client()
        .get(format!("{}/health", server.url))
        .header("origin", "http://devbox.lan:5173")
        .send()
        .await
        .expect("response");
    assert_eq!(response.status(), StatusCode::FORBIDDEN);
}
