use std::collections::BTreeMap;

use axum::{
    Json,
    extract::{Query, State},
};
use serde_json::Value;

use crate::{
    error::{AppError, AppResult},
    models::{
        AddBlockRequest, Block, ChangeLogEntry, ChangeType, DayPlan, ReplanOperation,
        ReplanRequest, ReviseRequest, RevisionCopyMode, now_timestamp, today_string,
    },
    revision::{append_revision, normalize_blocks},
    routes::blocks::{
        PlanDateQuery, active_block_index, block_update_details, displace_overlapping_blocks,
        resolve_plan_date, validate_block_request,
    },
    state::AppState,
};

pub async fn get_today_plan(State(state): State<AppState>) -> AppResult<Json<DayPlan>> {
    Ok(Json(state.load_today_plan_async().await?))
}

pub async fn get_plan_by_date(
    State(state): State<AppState>,
    axum::extract::Path(date): axum::extract::Path<String>,
) -> AppResult<Json<DayPlan>> {
    crate::models::validate_date_param(&date)?;
    Ok(Json(state.load_plan_async(&date).await?))
}

pub async fn revise_plan(
    State(state): State<AppState>,
    Json(request): Json<ReviseRequest>,
) -> AppResult<Json<DayPlan>> {
    let date = today_string();
    let date_lock = state.lock_for_date(&date);
    let _date_guard = date_lock.lock().await;
    let mut plan = state.load_plan_async(&date).await?;
    let mut history = state.load_history_async(&date).await?;
    history.snapshot(&plan);

    let copy_mode = request.copy_mode.unwrap_or(if request.copy_future_blocks {
        crate::models::RevisionCopyMode::All
    } else {
        crate::models::RevisionCopyMode::FromNow
    });

    append_revision(&mut plan, request.reason, copy_mode)?;

    state.commit_plan_async(&plan, &history).await?;
    state.events.send_refresh("plan_revised");

    Ok(Json(plan))
}

pub async fn undo_plan(State(state): State<AppState>) -> AppResult<Json<DayPlan>> {
    let date = today_string();
    let date_lock = state.lock_for_date(&date);
    let _date_guard = date_lock.lock().await;
    let current_plan = state.load_plan_async(&date).await?;
    let mut history = state.load_history_async(&date).await?;
    let previous_plan = history
        .undo(&current_plan)
        .ok_or_else(|| AppError::BadRequest("Nothing to undo".to_string()))?;

    state.commit_plan_async(&previous_plan, &history).await?;
    state.events.send_refresh("plan_undo");

    Ok(Json(previous_plan))
}

pub async fn redo_plan(State(state): State<AppState>) -> AppResult<Json<DayPlan>> {
    let date = today_string();
    let date_lock = state.lock_for_date(&date);
    let _date_guard = date_lock.lock().await;
    let current_plan = state.load_plan_async(&date).await?;
    let mut history = state.load_history_async(&date).await?;
    let next_plan = history
        .redo(&current_plan)
        .ok_or_else(|| AppError::BadRequest("Nothing to redo".to_string()))?;

    state.commit_plan_async(&next_plan, &history).await?;
    state.events.send_refresh("plan_redo");

    Ok(Json(next_plan))
}

/// Commits the first draft into an untouched bootstrap A; later batches
/// append one revision and one history snapshot, not one per operation. The whole batch is atomic: if any
/// operation fails, nothing is persisted.
pub async fn replan_batch(
    State(state): State<AppState>,
    Query(date_query): Query<PlanDateQuery>,
    Json(request): Json<ReplanRequest>,
) -> AppResult<Json<DayPlan>> {
    let date = resolve_plan_date(date_query.date)?;
    let date_lock = state.lock_for_date(&date);
    let _date_guard = date_lock.lock().await;

    let mut plan = state.load_plan_async(&date).await?;
    if request
        .base_revision
        .as_ref()
        .is_some_and(|base| Some(base) != plan.active_revision())
    {
        return Err(AppError::Conflict("The plan changed since this draft started. Your draft has not been saved; review the current plan before retrying.".into()));
    }
    let mut history = state.load_history_async(&date).await?;
    history.snapshot(&plan);

    let untouched_bootstrap = plan.revisions.len() == 1
        && plan.change_log.is_empty()
        && plan.active_revision().is_some_and(|revision| {
            revision.id == "A"
                && revision.blocks.is_empty()
                && revision.reason.as_deref() == Some("Initial plan")
        });
    if untouched_bootstrap {
        let initial = &mut plan.revisions[0];
        initial.created_at = now_timestamp();
        if request.reason.is_some() {
            initial.reason = request.reason;
        }
    } else {
        append_revision(
            &mut plan,
            request.reason,
            request.copy_mode.unwrap_or(RevisionCopyMode::All),
        )?;
    }

    // Client (draft) identifiers created inside this batch, mapped to the
    // server-generated block ids they resolve to.
    let mut created_ids: BTreeMap<String, String> = BTreeMap::new();
    let resolve_id = |created_ids: &BTreeMap<String, String>, block_id: &str| -> String {
        created_ids
            .get(block_id)
            .cloned()
            .unwrap_or_else(|| block_id.to_string())
    };

    for operation in &request.operations {
        match operation {
            ReplanOperation::Create { block_id, fields } => {
                let label = fields.label.clone().ok_or_else(|| {
                    AppError::BadRequest("create operation requires a label".to_string())
                })?;
                let start = fields.start.clone().ok_or_else(|| {
                    AppError::BadRequest("create operation requires a start".to_string())
                })?;
                let duration = fields.duration.ok_or_else(|| {
                    AppError::BadRequest("create operation requires a duration".to_string())
                })?;
                validate_block_request(&start, duration)?;

                let active_revision = plan
                    .active_revision_mut()
                    .ok_or_else(|| AppError::BadRequest("No active revision found".to_string()))?;
                let mut block = Block::from_request(
                    AddBlockRequest {
                        label,
                        start,
                        duration,
                        block_type: fields.block_type.unwrap_or_default(),
                        metadata: Default::default(),
                        artifacts: None,
                        ..Default::default()
                    },
                    &active_revision.blocks,
                );
                block.apply_update(fields.clone());

                if let Some(client_id) = block_id {
                    created_ids.insert(client_id.clone(), block.id.clone());
                }
                let entry = ChangeLogEntry {
                    timestamp: now_timestamp(),
                    change_type: ChangeType::Add,
                    block_id: block.id.clone(),
                    block_label: block.label.clone(),
                    details: Default::default(),
                };
                active_revision.blocks.push(block);
                normalize_blocks(&mut active_revision.blocks);
                plan.change_log.push(entry);
            }
            ReplanOperation::Update { block_id, payload } => {
                let resolved_id = resolve_id(&created_ids, block_id);
                let block_index = active_block_index(&plan, &resolved_id)?;
                let active_revision = plan
                    .active_revision_mut()
                    .ok_or_else(|| AppError::BadRequest("No active revision found".to_string()))?;
                let block = &mut active_revision.blocks[block_index];
                let before = block.clone();
                block.apply_update(payload.clone());
                validate_block_request(&block.start, block.duration)?;
                let affects_schedule =
                    before.start != block.start || before.duration != block.duration;

                if affects_schedule {
                    displace_overlapping_blocks(&mut active_revision.blocks, &resolved_id)?;
                } else {
                    normalize_blocks(&mut active_revision.blocks);
                }

                let after = plan
                    .active_revision()
                    .and_then(|revision| revision.blocks.iter().find(|b| b.id == resolved_id))
                    .cloned()
                    .ok_or_else(|| {
                        AppError::NotFound(format!("Block '{block_id}' was not found"))
                    })?;
                let details = block_update_details(&before, &after);

                plan.change_log.push(ChangeLogEntry {
                    timestamp: now_timestamp(),
                    change_type: ChangeType::Update,
                    block_id: after.id.clone(),
                    block_label: after.label.clone(),
                    details,
                });
            }
            ReplanOperation::Delete { block_id } => {
                let resolved_id = resolve_id(&created_ids, block_id);
                let block_index = active_block_index(&plan, &resolved_id)?;

                let active_revision = plan
                    .active_revision_mut()
                    .ok_or_else(|| AppError::BadRequest("No active revision found".to_string()))?;
                let removed = active_revision.blocks.remove(block_index);

                let mut details = BTreeMap::new();
                details.insert("removed".to_string(), Value::String(removed.id.clone()));
                plan.change_log.push(ChangeLogEntry {
                    timestamp: now_timestamp(),
                    change_type: ChangeType::Delete,
                    block_id: removed.id.clone(),
                    block_label: removed.label.clone(),
                    details,
                });
            }
        }
    }

    state.commit_plan_async(&plan, &history).await?;
    state.events.send_refresh("plan_replanned");

    Ok(Json(plan))
}
