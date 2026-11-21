use axum::{Json, extract::State};

use crate::{
    error::AppResult,
    models::{ClientConfigResponse, ClientConfigUpdate},
    state::AppState,
};

pub async fn get_config(State(state): State<AppState>) -> AppResult<Json<ClientConfigResponse>> {
    let settings = state.settings.read().await.clone();
    Ok(Json(settings.as_client_config()))
}

pub async fn patch_config(
    State(state): State<AppState>,
    Json(update): Json<ClientConfigUpdate>,
) -> AppResult<Json<ClientConfigResponse>> {
    let mut guard = state.settings.write().await;
    let mut settings = guard.clone();
    settings.apply_client_update(&update)?;
    crate::config::save_settings(&state.paths, &settings)?;
    *guard = settings;
    state.events.send_refresh("config_updated");
    Ok(Json(guard.as_client_config()))
}
