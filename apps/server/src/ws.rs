use serde::Serialize;
use tokio::sync::broadcast;

use crate::models::InteractionMode;

#[derive(Clone, Debug, Serialize)]
pub struct WsEvent {
    pub event: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub r#type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mode: Option<InteractionMode>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub generation: Option<String>,
}

#[derive(Clone, Debug)]
pub struct EventBus {
    sender: broadcast::Sender<WsEvent>,
}

impl EventBus {
    pub fn new() -> Self {
        let (sender, _) = broadcast::channel(64);
        Self { sender }
    }

    pub fn subscribe(&self) -> broadcast::Receiver<WsEvent> {
        self.sender.subscribe()
    }

    pub fn send_refresh(&self, kind: &str) {
        let _ = self.sender.send(WsEvent {
            event: "refresh".to_string(),
            r#type: Some(kind.to_string()),
            mode: None,
            generation: None,
        });
    }

    pub fn send_mode_changed(&self, mode: InteractionMode) {
        let _ = self.sender.send(WsEvent {
            event: "mode_changed".to_string(),
            r#type: None,
            mode: Some(mode),
            generation: None,
        });
    }

    pub fn send_dataset_replaced(&self, generation: String) {
        let _ = self.sender.send(WsEvent {
            event: "dataset_replaced".into(),
            r#type: None,
            mode: None,
            generation: Some(generation),
        });
    }
}

impl Default for EventBus {
    fn default() -> Self {
        Self::new()
    }
}
