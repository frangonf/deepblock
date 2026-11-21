use crate::{
    error::{AppError, AppResult},
    models::{
        BlockOutcomeRequest, BlockStatus, ChangeLogEntry, ChangeType, DayPlan, now_timestamp,
        today_string,
    },
    routes::blocks::{PlanDateQuery, active_block_index, block_update_details, resolve_plan_date},
    state::AppState,
};
use axum::{
    Json,
    extract::{Path, Query, State},
};
use serde_json::json;

/// Annotate the active head's outcome without changing scheduling intent or
/// applying the automatic plan-revision policy, including for historical days.
pub async fn patch_outcome(
    State(state): State<AppState>,
    Path(block_id): Path<String>,
    Query(query): Query<PlanDateQuery>,
    Json(request): Json<BlockOutcomeRequest>,
) -> AppResult<Json<DayPlan>> {
    let date = resolve_plan_date(query.date)?;
    if date > today_string() {
        return Err(AppError::BadRequest(
            "Outcomes can only be recorded for today or past days.".into(),
        ));
    }
    if request
        .actual_duration
        .flatten()
        .is_some_and(|minutes| minutes > 1440)
    {
        return Err(AppError::BadRequest(
            "Actual duration must be 0–1440 minutes.".into(),
        ));
    }
    if request
        .focus_rating
        .flatten()
        .is_some_and(|rating| !(1..=5).contains(&rating))
    {
        return Err(AppError::BadRequest("Focus rating must be 1–5.".into()));
    }
    let lock = state.lock_for_date(&date);
    let _guard = lock.lock().await;
    let mut plan = state.load_plan_async(&date).await?;
    let index = active_block_index(&plan, &block_id)?;
    let before = plan
        .revisions
        .last()
        .ok_or_else(|| AppError::BadRequest("No active revision".into()))?
        .blocks[index]
        .clone();
    if before.status == BlockStatus::Cancelled {
        return Err(AppError::BadRequest(
            "Cancelled blocks do not need outcomes.".into(),
        ));
    }
    let mut after = before.clone();
    if let Some(value) = request.actual_duration {
        after.actual_duration = value;
    }
    if let Some(value) = request.focus_rating {
        after.focus_rating = value;
    }
    if let Some(value) = request.completed {
        match value {
            Some(completed) => {
                after
                    .metadata
                    .insert("outcome_completed".into(), json!(completed));
            }
            None => {
                after.metadata.remove("outcome_completed");
            }
        }
    }
    if before == after {
        return Ok(Json(plan));
    }
    let mut history = state.load_history_async(&date).await?;
    history.snapshot(&plan);
    let details = block_update_details(&before, &after);
    plan.active_revision_mut()
        .ok_or_else(|| AppError::BadRequest("No active revision".into()))?
        .blocks[index] = after;
    plan.change_log.push(ChangeLogEntry {
        timestamp: now_timestamp(),
        change_type: ChangeType::Update,
        block_id,
        block_label: before.label,
        details,
    });
    state.commit_plan_async(&plan, &history).await?;
    state.events.send_refresh("block_outcome_updated");
    Ok(Json(plan))
}
