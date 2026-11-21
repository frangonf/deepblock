use axum::{Json, extract::State};

use crate::{
    aw::ActivityWatchClient,
    error::{AppError, AppResult},
    models::ActivityWatchSummaryResponse,
    state::AppState,
};

pub async fn get_activitywatch_status(State(state): State<AppState>) -> Json<serde_json::Value> {
    let settings = state.settings.read().await.activitywatch.clone();
    let available = settings.enabled && ActivityWatchClient::new(&settings).is_available().await;
    Json(
        serde_json::json!({ "enabled": settings.enabled, "url": settings.url, "available": available }),
    )
}

pub async fn get_activitywatch_summary(
    State(state): State<AppState>,
) -> AppResult<Json<ActivityWatchSummaryResponse>> {
    let settings = state.settings.read().await.clone();
    if !settings.activitywatch.enabled {
        return Err(AppError::NotFound(
            "ActivityWatch is disabled in the current configuration".to_string(),
        ));
    }

    let client = ActivityWatchClient::new(&settings.activitywatch);
    if !client.is_available().await {
        return Err(AppError::NotFound(
            "ActivityWatch is not currently reachable".to_string(),
        ));
    }

    Ok(Json(client.explorer_summary().await?))
}
