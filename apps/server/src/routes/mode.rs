use axum::{Json, extract::State};

use crate::{
    error::AppResult,
    models::{GlobalState, ModeRequest},
    state::AppState,
};

pub async fn get_mode(State(state): State<AppState>) -> AppResult<Json<GlobalState>> {
    Ok(Json(state.load_global_state_async().await?))
}

pub async fn set_mode(
    State(state): State<AppState>,
    Json(request): Json<ModeRequest>,
) -> AppResult<Json<GlobalState>> {
    let global_state = GlobalState { mode: request.mode };
    state.save_global_state_async(&global_state).await?;
    state.events.send_mode_changed(global_state.mode);
    Ok(Json(global_state))
}
