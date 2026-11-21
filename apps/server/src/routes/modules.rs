use crate::{
    error::AppResult,
    modules::{MODULE_API_VERSION, ModuleHealth},
    state::AppState,
};
use axum::{Json, extract::State};
use serde::Serialize;

#[derive(Serialize)]
pub struct ModulesResponse {
    pub api_version: u32,
    pub planning_intent_version: u32,
    pub max_queue_capacity: usize,
    pub max_payload_bytes: usize,
    pub modules: Vec<ModuleHealth>,
}
pub async fn capabilities(State(state): State<AppState>) -> AppResult<Json<ModulesResponse>> {
    Ok(Json(ModulesResponse {
        api_version: MODULE_API_VERSION,
        planning_intent_version: 1,
        max_queue_capacity: 64,
        max_payload_bytes: 65_536,
        modules: state.modules.health()?,
    }))
}
