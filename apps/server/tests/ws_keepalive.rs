use std::time::Duration;

use axum::{
    Router,
    extract::{
        State,
        ws::{WebSocket, WebSocketUpgrade},
    },
    routing::get,
};
use deepblock_server::{routes::ws::Keepalive, state::AppState};
use futures_util::{SinkExt, StreamExt};
use tempfile::tempdir;
use tokio::net::TcpListener;
use tokio_tungstenite::tungstenite::Message;

fn short_keepalive() -> Keepalive {
    Keepalive {
        ping_interval: Duration::from_millis(40),
        pong_timeout: Duration::from_millis(200),
    }
}

async fn upgrade_with_short_keepalive(
    ws: WebSocketUpgrade,
    State(state): State<AppState>,
) -> impl axum::response::IntoResponse {
    ws.on_upgrade(move |socket: WebSocket| {
        deepblock_server::routes::ws::handle_socket_with(socket, state, short_keepalive())
    })
}

async fn spawn_server(state: AppState) -> String {
    let app = Router::new()
        .route("/ws/test", get(upgrade_with_short_keepalive))
        .with_state(state);
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("test listener should bind");
    let addr = listener
        .local_addr()
        .expect("listener should expose address");
    tokio::spawn(async move {
        axum::serve(listener, app)
            .await
            .expect("server should serve");
    });
    format!("ws://{addr}/ws/test")
}

#[tokio::test]
async fn silent_websocket_is_closed_after_pong_timeout() {
    let temp_dir = tempdir().expect("tempdir should be created");
    let url = spawn_server(AppState::for_test(temp_dir.path())).await;

    let (mut socket, _response) = tokio_tungstenite::connect_async(url)
        .await
        .expect("client should connect");

    // Stay completely silent: never read (so tungstenite never auto-answers
    // pings) and never write. The server must close the stale connection.
    tokio::time::sleep(Duration::from_millis(400)).await;

    let closed = tokio::time::timeout(Duration::from_secs(2), async {
        loop {
            match socket.next().await {
                Some(Ok(Message::Close(_))) | None | Some(Err(_)) => break true,
                Some(Ok(_)) => continue,
            }
        }
    })
    .await;

    assert!(
        closed.unwrap_or(false),
        "stale socket should be closed by server"
    );
}

#[tokio::test]
async fn responsive_websocket_survives_and_receives_pings() {
    let temp_dir = tempdir().expect("tempdir should be created");
    let state = AppState::for_test(temp_dir.path());
    let url = spawn_server(state.clone()).await;

    let (mut socket, _response) = tokio_tungstenite::connect_async(url)
        .await
        .expect("client should connect");

    tokio::time::timeout(Duration::from_secs(2), async {
        let mut pings = 0;
        while pings < 8 {
            match socket.next().await {
                Some(Ok(Message::Ping(_))) => {
                    // Flush tungstenite's automatically queued pong. Eight
                    // cycles keep the socket alive beyond the stale deadline.
                    socket.flush().await.expect("flush pong");
                    pings += 1;
                }
                Some(Ok(Message::Close(_))) | None | Some(Err(_)) => {
                    panic!("responsive connection closed")
                }
                Some(Ok(_)) => {}
            }
        }
        state.events.send_refresh("healthy_after_multiple_pongs");
        loop {
            match socket.next().await {
                Some(Ok(Message::Text(text))) => {
                    if text.contains("healthy_after_multiple_pongs") {
                        break;
                    }
                }
                Some(Ok(Message::Ping(_))) => socket.flush().await.expect("flush pong"),
                Some(Ok(Message::Close(_))) | None | Some(Err(_)) => {
                    panic!("connection stopped delivering events")
                }
                Some(Ok(_)) => {}
            }
        }
    })
    .await
    .expect("live connection must receive multiple pings and subsequent events");
}
