use std::time::{Duration, Instant};

use axum::{
    extract::{
        State,
        ws::{Message, WebSocket, WebSocketUpgrade},
    },
    http::{HeaderMap, StatusCode, header},
    middleware::Next,
    response::{IntoResponse, Response},
};

use tokio::time::MissedTickBehavior;

use crate::{request_policy::RequestPolicy, state::AppState, ws::WsEvent};

pub async fn validate_origin(
    State(policy): State<std::sync::Arc<RequestPolicy>>,
    headers: HeaderMap,
    request: axum::extract::Request,
    next: Next,
) -> Response {
    let origin = headers.get(header::ORIGIN);
    if origin.is_none_or(|origin| !policy.allows(origin)) {
        return (StatusCode::FORBIDDEN, "Origin not allowed").into_response();
    }

    next.run(request).await
}

pub async fn events(ws: WebSocketUpgrade, State(state): State<AppState>) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_socket(socket, state))
}

/// Server-driven keepalive timings for event sockets.
#[derive(Clone, Copy, Debug)]
pub struct Keepalive {
    /// How often the server pings a connected client.
    pub ping_interval: Duration,
    /// How long a ping may stay unanswered before the connection is
    /// considered stale and gets closed.
    pub pong_timeout: Duration,
}

impl Default for Keepalive {
    fn default() -> Self {
        Self {
            ping_interval: Duration::from_secs(30),
            pong_timeout: Duration::from_secs(20),
        }
    }
}

/// A connection is stale when a ping has been pending for longer than the
/// pong timeout without any inbound traffic in the meantime.
fn is_stale(pending_ping: Option<Instant>, now: Instant, pong_timeout: Duration) -> bool {
    pending_ping.is_some_and(|sent_at| now.duration_since(sent_at) > pong_timeout)
}

async fn handle_socket(socket: WebSocket, state: AppState) {
    handle_socket_with(socket, state, Keepalive::default()).await
}

pub async fn handle_socket_with(mut socket: WebSocket, state: AppState, keepalive: Keepalive) {
    let mut receiver = state.events.subscribe();
    let mut ping_ticker = tokio::time::interval(keepalive.ping_interval);
    // Avoid ping bursts after long pauses; the immediate first tick of a
    // fresh interval is harmless (no ping is pending yet).
    ping_ticker.set_missed_tick_behavior(MissedTickBehavior::Delay);
    let mut pending_ping: Option<Instant> = None;

    loop {
        tokio::select! {
            event = receiver.recv() => match event {
                Ok(event) => {
                    if send_event(&mut socket, &event).await.is_err() {
                        break;
                    }
                }
                Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
                Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
            },
            _ = ping_ticker.tick() => {
                if is_stale(pending_ping, Instant::now(), keepalive.pong_timeout) {
                    break;
                }
                // At most one ping stays outstanding: re-pinging every tick
                // would constantly reset the staleness clock and a dead
                // client would never be detected.
                if pending_ping.is_none() {
                    if socket.send(Message::Ping(Vec::new().into())).await.is_err() {
                        break;
                    }
                    pending_ping = Some(Instant::now());
                }
            }
            message = socket.recv() => match message {
                // Any inbound frame (including a Pong) proves the client is
                // alive and retires the pending ping.
                Some(Ok(Message::Close(_))) | None | Some(Err(_)) => break,
                Some(Ok(_)) => pending_ping = None,
            },
        }
    }
}

async fn send_event(socket: &mut WebSocket, event: &WsEvent) -> Result<(), axum::Error> {
    let payload = serde_json::to_string(event).map_err(axum::Error::new)?;
    socket.send(Message::Text(payload.into())).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn is_stale_requires_an_overdue_pending_ping() {
        let now = Instant::now();
        let timeout = Duration::from_secs(20);

        assert!(!is_stale(None, now, timeout));
        assert!(!is_stale(Some(now), now, timeout));
        assert!(!is_stale(Some(now - Duration::from_secs(19)), now, timeout));
        assert!(is_stale(Some(now - Duration::from_secs(21)), now, timeout));
    }
}
