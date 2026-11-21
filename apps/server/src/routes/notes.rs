use std::path::Path;

use axum::{
    Json,
    extract::{Path as AxumPath, State},
};

use crate::{
    error::AppResult,
    models::{EnsureNoteResponse, NoteContentResponse, SaveNoteRequest, today_string},
    state::AppState,
};

fn default_note_content(date: &str) -> String {
    format!(
        "# Daily Note - {date}\n\n## Morning Intentions\n\n## Key Observations\n\n## End of Day Reflection\n"
    )
}

async fn sync_plan_note_path(state: &AppState, date: &str, note_path: &Path) -> AppResult<()> {
    let mut plan = state.load_plan_async(date).await?;
    let note_path = note_path.to_string_lossy().to_string();

    if plan.note_path.as_deref() != Some(note_path.as_str()) {
        plan.note_path = Some(note_path);
        state.save_plan_async(&plan).await?;
    }

    Ok(())
}

pub async fn get_note(
    State(state): State<AppState>,
    AxumPath(date): AxumPath<String>,
) -> AppResult<Json<NoteContentResponse>> {
    crate::models::validate_date_param(&date)?;
    let content = state.load_note_async(&date).await?.unwrap_or_default();

    Ok(Json(NoteContentResponse { content }))
}

pub async fn save_note(
    State(state): State<AppState>,
    AxumPath(date): AxumPath<String>,
    Json(request): Json<SaveNoteRequest>,
) -> AppResult<Json<NoteContentResponse>> {
    crate::models::validate_date_param(&date)?;
    let date_lock = state.lock_for_date(&date);
    let _date_guard = date_lock.lock().await;
    let note_path = state.save_note_async(&date, &request.content).await?;
    sync_plan_note_path(&state, &date, &note_path).await?;
    state.events.send_refresh("note_saved");

    Ok(Json(NoteContentResponse {
        content: request.content,
    }))
}

pub async fn ensure_note(State(state): State<AppState>) -> AppResult<Json<EnsureNoteResponse>> {
    let date = today_string();
    let date_lock = state.lock_for_date(&date);
    let _date_guard = date_lock.lock().await;
    let content = state
        .load_note_async(&date)
        .await?
        .unwrap_or_else(|| default_note_content(&date));
    let note_path = state.save_note_async(&date, &content).await?;
    sync_plan_note_path(&state, &date, &note_path).await?;
    state.events.send_refresh("note_ready");

    Ok(Json(EnsureNoteResponse {
        path: note_path.to_string_lossy().to_string(),
    }))
}
