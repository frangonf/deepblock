use std::collections::BTreeMap;

use axum::{
    Json,
    extract::{Path, Query, State},
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::{
    error::{AppError, AppResult},
    models::{
        AddBlockRequest, ArtifactRequest, Block, BlockStatus, BlockType, ChangeLogEntry,
        ChangeType, DayPlan, MoveBlockRequest, RepositionBlockRequest, RevisionCopyMode,
        RevisionStrategy, UpdateBlockRequest, now_timestamp, today_string, validate_date_param,
    },
    revision::{append_revision, block_is_past_grace_period, normalize_blocks},
    state::AppState,
};

const MAX_BLOCK_DURATION_MINUTES: u16 = 480;
const MINUTES_PER_DAY: u16 = 24 * 60;

/// Optional `?date=YYYY-MM-DD` scoping for plan mutations. Without it the
/// mutation targets today's plan, preserving the existing frontend contract.
#[derive(Debug, Default, Deserialize)]
pub struct PlanDateQuery {
    pub(crate) date: Option<String>,
}

pub(crate) fn resolve_plan_date(date: Option<String>) -> AppResult<String> {
    match date {
        Some(date) => {
            validate_date_param(&date)?;
            Ok(date)
        }
        None => Ok(today_string()),
    }
}

fn parse_hhmm(value: &str) -> AppResult<u16> {
    if value.len() != 5
        || !value.bytes().enumerate().all(|(i, b)| {
            if i == 2 {
                b == b':'
            } else {
                b.is_ascii_digit()
            }
        })
    {
        return Err(AppError::BadRequest(format!(
            "Invalid time '{value}', expected HH:MM"
        )));
    }
    let (hours, minutes) = value
        .split_once(':')
        .ok_or_else(|| AppError::BadRequest(format!("Invalid time '{value}', expected HH:MM")))?;
    let hours = hours
        .parse::<u16>()
        .map_err(|_| AppError::BadRequest(format!("Invalid time '{value}', expected HH:MM")))?;
    let minutes = minutes
        .parse::<u16>()
        .map_err(|_| AppError::BadRequest(format!("Invalid time '{value}', expected HH:MM")))?;

    if hours >= 24 || minutes >= 60 {
        return Err(AppError::BadRequest(format!(
            "Invalid time '{value}', expected HH:MM"
        )));
    }

    Ok(hours * 60 + minutes)
}

fn format_hhmm(total_minutes: u16) -> String {
    format!("{:02}:{:02}", total_minutes / 60, total_minutes % 60)
}

fn validate_duration(duration: u16) -> AppResult<()> {
    if duration == 0 || duration > MAX_BLOCK_DURATION_MINUTES {
        return Err(AppError::BadRequest(format!(
            "Duration must be between 1 and {MAX_BLOCK_DURATION_MINUTES} minutes"
        )));
    }

    Ok(())
}

pub(crate) fn validate_block_request(start: &str, duration: u16) -> AppResult<()> {
    let start_minutes = parse_hhmm(start)?;
    validate_duration(duration)?;
    if start_minutes.saturating_add(duration) > MINUTES_PER_DAY {
        return Err(AppError::BadRequest(format!(
            "Block starting at {start} with duration {duration}m would end after 24:00"
        )));
    }
    Ok(())
}

pub(crate) fn displace_overlapping_blocks(
    blocks: &mut [Block],
    moved_block_id: &str,
) -> AppResult<()> {
    normalize_blocks(blocks);

    let moved_index = blocks
        .iter()
        .position(|block| block.id == moved_block_id)
        .ok_or_else(|| AppError::NotFound(format!("Block '{moved_block_id}' was not found")))?;

    if blocks[moved_index].status == BlockStatus::Cancelled {
        return Ok(());
    }
    let moved_start = parse_hhmm(&blocks[moved_index].start)?;
    let moved_duration = blocks[moved_index].duration;
    let moved_end = moved_start.saturating_add(moved_duration);
    if moved_end > MINUTES_PER_DAY {
        return Err(AppError::BadRequest(format!(
            "Block '{}' would end after 24:00",
            blocks[moved_index].label
        )));
    }

    let mut current_end = moved_end;
    let mut displacements = Vec::new();

    // Compute and validate every displacement before mutating any start time
    // so a rejected plan keeps its previous schedule intact.
    for (index, block) in blocks.iter().enumerate() {
        if block.id == moved_block_id || block.status == BlockStatus::Cancelled {
            continue;
        }

        let block_start = parse_hhmm(&block.start)?;
        let block_end = block_start.saturating_add(block.duration);
        if block_start < current_end && block_end > moved_start {
            let new_end = current_end.saturating_add(block.duration);
            if new_end > MINUTES_PER_DAY {
                return Err(AppError::BadRequest(format!(
                    "Displacing '{}' to {} would push it past 24:00",
                    block.label,
                    format_hhmm(current_end)
                )));
            }
            displacements.push((index, current_end));
            current_end = new_end;
        }
    }

    for (index, new_start) in displacements {
        blocks[index].set_start(format_hhmm(new_start));
    }

    normalize_blocks(blocks);
    Ok(())
}

fn recalculate_start_times_from(blocks: &mut [Block], from_index: usize) -> AppResult<()> {
    if blocks.is_empty() || from_index >= blocks.len() {
        return Ok(());
    }

    let Some(from_index) =
        (from_index..blocks.len()).find(|index| blocks[*index].status != BlockStatus::Cancelled)
    else {
        return Ok(());
    };
    let mut previous_start = parse_hhmm(&blocks[from_index].start)?;
    let mut previous_end = previous_start.saturating_add(blocks[from_index].duration);
    if previous_end > MINUTES_PER_DAY {
        return Err(AppError::BadRequest(format!(
            "Block '{}' would end after 24:00",
            blocks[from_index].label
        )));
    }

    let mut new_starts = Vec::new();
    for (index, block) in blocks.iter().enumerate().skip(from_index + 1) {
        if block.status == BlockStatus::Cancelled {
            continue;
        }
        previous_start = previous_end;
        previous_end = previous_start.saturating_add(block.duration);
        if previous_end > MINUTES_PER_DAY {
            return Err(AppError::BadRequest(format!(
                "Block '{}' would end after 24:00",
                block.label
            )));
        }
        new_starts.push((index, previous_start));
    }

    for (index, start) in new_starts {
        blocks[index].set_start(format_hhmm(start));
    }

    Ok(())
}

fn build_change_pair<T: Serialize + PartialEq>(before: &T, after: &T) -> Option<Value> {
    if before == after {
        None
    } else {
        Some(json!({ "before": before, "after": after }))
    }
}

pub(crate) fn block_update_details(before: &Block, after: &Block) -> BTreeMap<String, Value> {
    let mut details = BTreeMap::new();

    if let Some(value) = build_change_pair(&before.label, &after.label) {
        details.insert("label".to_string(), value);
    }
    if let Some(value) = build_change_pair(&before.start, &after.start) {
        details.insert("start".to_string(), value);
    }
    if let Some(value) = build_change_pair(&before.duration, &after.duration) {
        details.insert("duration".to_string(), value);
    }
    if let Some(value) = build_change_pair(&before.block_type, &after.block_type) {
        details.insert("type".to_string(), value);
    }
    if let Some(value) = build_change_pair(&before.status, &after.status) {
        details.insert("status".to_string(), value);
    }
    if let Some(value) = build_change_pair(&before.focus_rating, &after.focus_rating) {
        details.insert("focus_rating".to_string(), value);
    }
    if let Some(value) = build_change_pair(&before.actual_duration, &after.actual_duration) {
        details.insert("actual_duration".to_string(), value);
    }
    if let Some(value) = build_change_pair(&before.next_action, &after.next_action) {
        details.insert("next_action".to_string(), value);
    }
    if let Some(value) = build_change_pair(&before.content_path, &after.content_path) {
        details.insert("content_path".to_string(), value);
    }
    if let Some(value) = build_change_pair(&before.metadata, &after.metadata) {
        details.insert("metadata".to_string(), value);
    }
    if let Some(value) = build_change_pair(&before.artifacts, &after.artifacts) {
        details.insert("artifacts".to_string(), value);
    }

    details
}

fn block_type_name(block_type: BlockType) -> &'static str {
    match block_type {
        BlockType::Focus => "focus",
        BlockType::Shallow => "shallow",
        BlockType::Urgent => "urgent",
        BlockType::Break => "break",
    }
}

fn block_status_name(status: BlockStatus) -> &'static str {
    match status {
        BlockStatus::Proposed => "proposed",
        BlockStatus::Confirmed => "confirmed",
        BlockStatus::Cancelled => "cancelled",
        BlockStatus::Done => "done",
    }
}

pub(crate) fn active_block_index(plan: &DayPlan, block_id: &str) -> AppResult<usize> {
    let active_revision = plan
        .active_revision()
        .ok_or_else(|| AppError::BadRequest("No active revision found".to_string()))?;

    active_revision
        .blocks
        .iter()
        .position(|block| block.id == block_id)
        .ok_or_else(|| AppError::NotFound(format!("Block '{block_id}' was not found")))
}

fn auto_update_reason(before: &Block, after: &Block) -> String {
    let mut changes = Vec::new();

    if before.start != after.start {
        changes.push(format!("time {} -> {}", before.start, after.start));
    }
    if before.duration != after.duration {
        changes.push(format!(
            "duration {}m -> {}m",
            before.duration, after.duration
        ));
    }
    if before.label != after.label {
        changes.push(format!("label '{}' -> '{}'", before.label, after.label));
    }
    if before.block_type != after.block_type {
        changes.push(format!(
            "type {} -> {}",
            block_type_name(before.block_type),
            block_type_name(after.block_type)
        ));
    }
    if before.status != after.status {
        changes.push(format!(
            "status {} -> {}",
            block_status_name(before.status),
            block_status_name(after.status)
        ));
    }
    if before.focus_rating != after.focus_rating {
        changes.push(format!(
            "focus rating {} -> {}",
            before
                .focus_rating
                .map(|value| value.to_string())
                .unwrap_or_else(|| "none".to_string()),
            after
                .focus_rating
                .map(|value| value.to_string())
                .unwrap_or_else(|| "none".to_string())
        ));
    }

    if changes.is_empty() {
        format!("Auto: updated '{}'", before.label)
    } else {
        format!("Auto: updated '{}' ({})", before.label, changes.join(", "))
    }
}

async fn maybe_append_auto_revision(
    state: &AppState,
    plan: &mut DayPlan,
    block: &Block,
    reason: String,
) -> AppResult<()> {
    let settings = state.settings.read().await;
    let strategy = settings.client.revision.strategy;
    let grace_minutes = settings.client.revision.grace_minutes;
    drop(settings);

    let should_append = match strategy {
        RevisionStrategy::Manual | RevisionStrategy::Never => false,
        RevisionStrategy::EveryChange => true,
        RevisionStrategy::Timed => block_is_past_grace_period(block, grace_minutes),
    };

    if should_append {
        append_revision(plan, Some(reason), RevisionCopyMode::All)?;
    }

    Ok(())
}

async fn maybe_append_requested_or_auto_revision(
    state: &AppState,
    plan: &mut DayPlan,
    block: &Block,
    reason: String,
    force_revision: bool,
) -> AppResult<()> {
    if force_revision {
        append_revision(plan, Some(reason), RevisionCopyMode::All)?;
        return Ok(());
    }

    maybe_append_auto_revision(state, plan, block, reason).await
}

pub async fn add_block(
    State(state): State<AppState>,
    Query(date_query): Query<PlanDateQuery>,
    Json(request): Json<AddBlockRequest>,
) -> AppResult<Json<DayPlan>> {
    let date = resolve_plan_date(date_query.date)?;
    let date_lock = state.lock_for_date(&date);
    let _date_guard = date_lock.lock().await;
    let mut plan = state.load_plan_async(&date).await?;
    validate_block_request(&request.start, request.duration)?;
    let mut history = state.load_history_async(&date).await?;
    history.snapshot(&plan);

    let existing_blocks = plan
        .active_revision()
        .map(|r| r.blocks.as_slice())
        .unwrap_or(&[]);
    let block = Block::from_request(request, existing_blocks);
    {
        let active_revision = plan
            .active_revision_mut()
            .ok_or_else(|| AppError::BadRequest("No active revision found".to_string()))?;
        active_revision.blocks.push(block.clone());
        normalize_blocks(&mut active_revision.blocks);
    }
    plan.change_log.push(ChangeLogEntry {
        timestamp: now_timestamp(),
        change_type: ChangeType::Add,
        block_id: block.id.clone(),
        block_label: block.label.clone(),
        details: Default::default(),
    });

    state.commit_plan_async(&plan, &history).await?;
    state.events.send_refresh("block_added");

    Ok(Json(plan))
}

pub async fn delete_block(
    State(state): State<AppState>,
    Path(block_id): Path<String>,
    Query(date_query): Query<PlanDateQuery>,
) -> AppResult<Json<DayPlan>> {
    let date = resolve_plan_date(date_query.date)?;
    let date_lock = state.lock_for_date(&date);
    let _date_guard = date_lock.lock().await;
    let mut plan = state.load_plan_async(&date).await?;

    let block_index = active_block_index(&plan, &block_id)?;
    let removed_block = plan
        .active_revision()
        .ok_or_else(|| AppError::BadRequest("No active revision found".to_string()))?
        .blocks[block_index]
        .clone();
    let mut history = state.load_history_async(&date).await?;
    history.snapshot(&plan);
    maybe_append_auto_revision(
        &state,
        &mut plan,
        &removed_block,
        format!("Auto: deleted '{}'", removed_block.label),
    )
    .await?;

    let removed_block = {
        // Re-fetch from the active revision in case automatic revisioning created a new head.
        let block_index = active_block_index(&plan, &block_id)?;
        let active_revision = plan
            .active_revision_mut()
            .ok_or_else(|| AppError::BadRequest("No active revision found".to_string()))?;
        active_revision.blocks.remove(block_index)
    };

    let mut details = BTreeMap::new();
    details.insert(
        "removed".to_string(),
        Value::String(removed_block.id.clone()),
    );
    plan.change_log.push(ChangeLogEntry {
        timestamp: now_timestamp(),
        change_type: ChangeType::Delete,
        block_id: removed_block.id.clone(),
        block_label: removed_block.label.clone(),
        details,
    });

    state.commit_plan_async(&plan, &history).await?;
    state.events.send_refresh("block_deleted");

    Ok(Json(plan))
}

pub async fn patch_block(
    State(state): State<AppState>,
    Path(block_id): Path<String>,
    Query(date_query): Query<PlanDateQuery>,
    Json(request): Json<UpdateBlockRequest>,
) -> AppResult<Json<DayPlan>> {
    let date = resolve_plan_date(date_query.date)?;
    let date_lock = state.lock_for_date(&date);
    let _date_guard = date_lock.lock().await;
    let mut plan = state.load_plan_async(&date).await?;

    let block_index = active_block_index(&plan, &block_id)?;
    let before = plan
        .active_revision()
        .ok_or_else(|| AppError::BadRequest("No active revision found".to_string()))?
        .blocks[block_index]
        .clone();
    let mut after_candidate = before.clone();
    after_candidate.apply_update(request.clone());
    validate_block_request(&after_candidate.start, after_candidate.duration)?;

    if before == after_candidate {
        return Ok(Json(plan));
    }

    let mut history = state.load_history_async(&date).await?;
    history.snapshot(&plan);
    maybe_append_requested_or_auto_revision(
        &state,
        &mut plan,
        &before,
        auto_update_reason(&before, &after_candidate),
        request.force_revision,
    )
    .await?;

    let affects_schedule =
        before.start != after_candidate.start || before.duration != after_candidate.duration;
    {
        // Re-fetch from the active revision in case automatic revisioning created a new head.
        let block_index = active_block_index(&plan, &block_id)?;
        let active_revision = plan
            .active_revision_mut()
            .ok_or_else(|| AppError::BadRequest("No active revision found".to_string()))?;
        active_revision.blocks[block_index].apply_update(request);
        if affects_schedule {
            displace_overlapping_blocks(&mut active_revision.blocks, &block_id)?;
        } else {
            normalize_blocks(&mut active_revision.blocks);
        }
    }

    let after = plan
        .active_revision()
        .ok_or_else(|| AppError::BadRequest("No active revision found".to_string()))?
        .blocks
        .iter()
        .find(|block| block.id == block_id)
        .cloned()
        .ok_or_else(|| AppError::NotFound(format!("Block '{block_id}' was not found")))?;
    let details = block_update_details(&before, &after);

    plan.change_log.push(ChangeLogEntry {
        timestamp: now_timestamp(),
        change_type: ChangeType::Update,
        block_id: after.id.clone(),
        block_label: after.label.clone(),
        details,
    });

    state.commit_plan_async(&plan, &history).await?;
    state.events.send_refresh("block_updated");

    Ok(Json(plan))
}

pub async fn move_block(
    State(state): State<AppState>,
    Path(block_id): Path<String>,
    Query(date_query): Query<PlanDateQuery>,
    Json(request): Json<MoveBlockRequest>,
) -> AppResult<Json<DayPlan>> {
    if !matches!(request.direction, -1 | 1) {
        return Err(AppError::BadRequest(
            "direction must be -1 or 1".to_string(),
        ));
    }

    let date = resolve_plan_date(date_query.date)?;
    let date_lock = state.lock_for_date(&date);
    let _date_guard = date_lock.lock().await;
    let mut plan = state.load_plan_async(&date).await?;

    {
        let active_revision = plan
            .active_revision_mut()
            .ok_or_else(|| AppError::BadRequest("No active revision found".to_string()))?;
        normalize_blocks(&mut active_revision.blocks);
    }

    let active_revision = plan
        .active_revision()
        .ok_or_else(|| AppError::BadRequest("No active revision found".to_string()))?;
    let block_index = active_block_index(&plan, &block_id)?;
    let block = active_revision.blocks[block_index].clone();
    let target_index = if request.direction < 0 {
        block_index
            .checked_sub(1)
            .ok_or_else(|| AppError::BadRequest("Block is already first".to_string()))?
    } else {
        let next_index = block_index + 1;
        if next_index >= active_revision.blocks.len() {
            return Err(AppError::BadRequest("Block is already last".to_string()));
        }
        next_index
    };

    let mut history = state.load_history_async(&date).await?;
    history.snapshot(&plan);
    maybe_append_auto_revision(
        &state,
        &mut plan,
        &block,
        format!(
            "Auto: moved '{}' {}",
            block.label,
            if request.direction < 0 { "up" } else { "down" }
        ),
    )
    .await?;

    let from_index = block_index.min(target_index);
    let moved_block = {
        // Re-fetch from the active revision in case automatic revisioning created a new head.
        let block_index = active_block_index(&plan, &block_id)?;
        let active_revision = plan
            .active_revision_mut()
            .ok_or_else(|| AppError::BadRequest("No active revision found".to_string()))?;
        let anchor_start = active_revision.blocks[from_index].start.clone();
        active_revision.blocks.swap(block_index, target_index);
        active_revision.blocks[from_index].set_start(anchor_start);
        recalculate_start_times_from(&mut active_revision.blocks, from_index)?;
        active_revision.blocks[target_index].clone()
    };
    let mut details = BTreeMap::new();
    details.insert("direction".to_string(), json!(request.direction));
    details.insert("to_index".to_string(), json!(target_index));

    plan.change_log.push(ChangeLogEntry {
        timestamp: now_timestamp(),
        change_type: ChangeType::Move,
        block_id: moved_block.id.clone(),
        block_label: moved_block.label.clone(),
        details,
    });

    state.commit_plan_async(&plan, &history).await?;
    state.events.send_refresh("block_moved");

    Ok(Json(plan))
}

pub async fn reposition_block(
    State(state): State<AppState>,
    Path(block_id): Path<String>,
    Query(date_query): Query<PlanDateQuery>,
    Json(request): Json<RepositionBlockRequest>,
) -> AppResult<Json<DayPlan>> {
    let date = resolve_plan_date(date_query.date)?;
    let date_lock = state.lock_for_date(&date);
    let _date_guard = date_lock.lock().await;
    let mut plan = state.load_plan_async(&date).await?;
    parse_hhmm(&request.start)?;

    let block_index = active_block_index(&plan, &block_id)?;
    let before = plan
        .active_revision()
        .ok_or_else(|| AppError::BadRequest("No active revision found".to_string()))?
        .blocks[block_index]
        .clone();

    if before.start == request.start {
        return Ok(Json(plan));
    }

    let mut history = state.load_history_async(&date).await?;
    history.snapshot(&plan);
    maybe_append_auto_revision(
        &state,
        &mut plan,
        &before,
        format!(
            "Auto: repositioned '{}' {} -> {}",
            before.label, before.start, request.start
        ),
    )
    .await?;

    {
        // Re-fetch from the active revision in case automatic revisioning created a new head.
        let block_index = active_block_index(&plan, &block_id)?;
        let active_revision = plan
            .active_revision_mut()
            .ok_or_else(|| AppError::BadRequest("No active revision found".to_string()))?;
        active_revision.blocks[block_index].set_start(request.start);
        displace_overlapping_blocks(&mut active_revision.blocks, &block_id)?;
    }

    let after = plan
        .active_revision()
        .ok_or_else(|| AppError::BadRequest("No active revision found".to_string()))?
        .blocks
        .iter()
        .find(|block| block.id == block_id)
        .cloned()
        .ok_or_else(|| AppError::NotFound(format!("Block '{block_id}' was not found")))?;

    plan.change_log.push(ChangeLogEntry {
        timestamp: now_timestamp(),
        change_type: ChangeType::Reposition,
        block_id: after.id.clone(),
        block_label: after.label.clone(),
        details: block_update_details(&before, &after),
    });

    state.commit_plan_async(&plan, &history).await?;
    state.events.send_refresh("block_repositioned");

    Ok(Json(plan))
}

pub async fn add_artifact(
    State(state): State<AppState>,
    Path(block_id): Path<String>,
    Query(date_query): Query<PlanDateQuery>,
    Json(request): Json<ArtifactRequest>,
) -> AppResult<Json<DayPlan>> {
    let artifact = request.artifact.trim().to_string();
    if artifact.is_empty() {
        return Err(AppError::BadRequest("Artifact cannot be empty".to_string()));
    }

    let date = resolve_plan_date(date_query.date)?;
    let date_lock = state.lock_for_date(&date);
    let _date_guard = date_lock.lock().await;
    let mut plan = state.load_plan_async(&date).await?;
    let active_revision = plan
        .active_revision()
        .ok_or_else(|| AppError::BadRequest("No active revision found".to_string()))?;
    let block_index = active_revision
        .blocks
        .iter()
        .position(|block| block.id == block_id)
        .ok_or_else(|| AppError::NotFound(format!("Block '{block_id}' was not found")))?;
    let block = &active_revision.blocks[block_index];

    if block.artifacts.iter().any(|item| item == &artifact) {
        return Err(AppError::BadRequest(
            "Artifact is already attached to this block".to_string(),
        ));
    }

    let mut history = state.load_history_async(&date).await?;
    history.snapshot(&plan);

    let updated_block = {
        let active_revision = plan
            .active_revision_mut()
            .ok_or_else(|| AppError::BadRequest("No active revision found".to_string()))?;
        let block = &mut active_revision.blocks[block_index];
        block.artifacts.push(artifact.clone());
        block.clone()
    };
    let mut details = BTreeMap::new();
    details.insert("artifact".to_string(), Value::String(artifact));

    plan.change_log.push(ChangeLogEntry {
        timestamp: now_timestamp(),
        change_type: ChangeType::Update,
        block_id: updated_block.id.clone(),
        block_label: updated_block.label.clone(),
        details,
    });

    state.commit_plan_async(&plan, &history).await?;
    state.events.send_refresh("artifact_added");

    Ok(Json(plan))
}

/// Query for artifact removal: the artifact identifier plus the optional
/// plan date scoping shared by all block mutations.
#[derive(Debug, Deserialize)]
pub struct RemoveArtifactQuery {
    artifact: String,
    date: Option<String>,
}

pub async fn remove_artifact(
    State(state): State<AppState>,
    Path(block_id): Path<String>,
    Query(query): Query<RemoveArtifactQuery>,
) -> AppResult<Json<DayPlan>> {
    let date = resolve_plan_date(query.date)?;
    let date_lock = state.lock_for_date(&date);
    let _date_guard = date_lock.lock().await;
    let mut plan = state.load_plan_async(&date).await?;
    let active_revision = plan
        .active_revision()
        .ok_or_else(|| AppError::BadRequest("No active revision found".to_string()))?;
    let block_index = active_revision
        .blocks
        .iter()
        .position(|block| block.id == block_id)
        .ok_or_else(|| AppError::NotFound(format!("Block '{block_id}' was not found")))?;
    let block = &active_revision.blocks[block_index];

    let artifact_index = block
        .artifacts
        .iter()
        .position(|artifact| artifact == &query.artifact)
        .ok_or_else(|| {
            AppError::NotFound(format!(
                "Artifact '{}' was not found on block '{}'",
                query.artifact, block_id
            ))
        })?;

    let mut history = state.load_history_async(&date).await?;
    history.snapshot(&plan);

    let (updated_block, removed_artifact) = {
        let active_revision = plan
            .active_revision_mut()
            .ok_or_else(|| AppError::BadRequest("No active revision found".to_string()))?;
        let block = &mut active_revision.blocks[block_index];
        let removed_artifact = block.artifacts.remove(artifact_index);
        (block.clone(), removed_artifact)
    };
    let mut details = BTreeMap::new();
    details.insert("artifact".to_string(), Value::String(removed_artifact));

    plan.change_log.push(ChangeLogEntry {
        timestamp: now_timestamp(),
        change_type: ChangeType::Update,
        block_id: updated_block.id.clone(),
        block_label: updated_block.label.clone(),
        details,
    });

    state.commit_plan_async(&plan, &history).await?;
    state.events.send_refresh("artifact_removed");

    Ok(Json(plan))
}

#[cfg(test)]
mod tests {
    use super::*;
    use proptest::prelude::*;

    fn block(id: &str, label: &str, start: &str, duration: u16) -> Block {
        Block {
            id: id.to_string(),
            label: label.to_string(),
            start: start.to_string(),
            duration,
            block_type: BlockType::Focus,
            status: BlockStatus::Proposed,
            created_at: now_timestamp(),
            metadata: BTreeMap::new(),
            content_path: None,
            focus_rating: None,
            actual_duration: None,
            next_action: None,
            artifacts: Vec::new(),
            reality: None,
        }
    }

    #[test]
    fn validate_block_request_rejects_blocks_ending_after_midnight() {
        let result = validate_block_request("23:30", 480);
        assert!(result.is_err());

        let exact_fit = validate_block_request("23:00", 60);
        assert!(exact_fit.is_ok());
    }

    #[test]
    fn displacement_rejects_cascade_past_midnight_and_keeps_blocks_unchanged() {
        let mut blocks = vec![
            block("a", "Late", "23:00", 60),
            block("m", "Moved", "08:00", 60),
        ];

        blocks[1].start = "23:30".to_string();
        let result = displace_overlapping_blocks(&mut blocks, "m");

        assert!(result.is_err());
        assert_eq!(blocks[0].start, "23:00");
        assert_eq!(blocks[1].start, "23:30");
    }

    #[test]
    fn displacement_allows_exactly_fitting_until_midnight() {
        let mut blocks = vec![
            block("a", "Early", "22:00", 30),
            block("m", "Moved", "20:00", 90),
        ];

        blocks[1].start = "22:00".to_string();
        displace_overlapping_blocks(&mut blocks, "m").expect("should fit");

        let displaced = blocks
            .iter()
            .find(|b| b.id == "a")
            .expect("block a survives");
        assert_eq!(displaced.start, "23:30");
    }

    #[test]
    fn ripple_displaces_every_block_overlapping_the_moved_window() {
        let mut blocks = vec![
            block("z", "Zebra", "09:00", 30),
            block("a", "Alpha", "09:00", 30),
            block("m", "Moved", "09:00", 60),
        ];
        displace_overlapping_blocks(&mut blocks, "m").expect("fits");
        assert_eq!(
            blocks
                .iter()
                .find(|block| block.id == "a")
                .expect("alpha")
                .start,
            "10:00"
        );
        assert_eq!(
            blocks
                .iter()
                .find(|block| block.id == "z")
                .expect("zebra")
                .start,
            "10:30"
        );
    }

    #[test]
    fn cancelled_blocks_do_not_participate_in_displacement() {
        let mut cancelled = block("c", "Cancelled", "23:00", 60);
        cancelled.status = BlockStatus::Cancelled;
        let mut blocks = vec![cancelled, block("m", "Moved", "23:00", 30)];
        displace_overlapping_blocks(&mut blocks, "m").expect("cancelled block must not overflow");
        assert_eq!(
            blocks
                .iter()
                .find(|b| b.id == "c")
                .expect("cancelled")
                .start,
            "23:00"
        );
    }

    #[test]
    fn cancelled_targets_do_not_displace_active_blocks() {
        let mut cancelled = block("c", "Cancelled", "23:00", 60);
        cancelled.status = BlockStatus::Cancelled;
        let mut blocks = vec![cancelled, block("m", "Work", "23:00", 30)];
        displace_overlapping_blocks(&mut blocks, "c").expect("cancelled target");
        assert_eq!(
            blocks.iter().find(|b| b.id == "m").expect("work").start,
            "23:00"
        );
    }

    #[test]
    fn recalculate_skips_cancelled_rows() {
        let mut cancelled = block("c", "Cancelled", "23:00", 60);
        cancelled.status = BlockStatus::Cancelled;
        let mut blocks = vec![
            block("m", "Work", "23:00", 30),
            cancelled,
            block("n", "Next", "22:00", 30),
        ];
        recalculate_start_times_from(&mut blocks, 0).expect("fits without cancelled row");
        assert_eq!(blocks[1].start, "23:00");
        assert_eq!(blocks[2].start, "23:30");
    }

    #[test]
    fn recalculate_start_times_rejects_cascade_past_midnight() {
        let mut blocks = vec![
            block("a", "First", "23:30", 60),
            block("b", "Second", "22:00", 60),
        ];

        let result = recalculate_start_times_from(&mut blocks, 0);

        assert!(result.is_err());
        assert_eq!(blocks[1].start, "22:00");
    }

    proptest! {
        #![proptest_config(ProptestConfig {
            cases: 128,
            max_shrink_iters: 4096,
            ..ProptestConfig::default()
        })]

        #[test]
        fn property_request_validation_matches_day_and_duration_limits(
            hour in 0_u16..100,
            minute in 0_u16..100,
            duration in 0_u16..2000,
        ) {
            let start = format!("{hour:02}:{minute:02}");
            let expected = hour < 24 && minute < 60
                && (1..=480).contains(&duration)
                && u32::from(hour) * 60 + u32::from(minute) + u32::from(duration) <= 1440;
            prop_assert_eq!(validate_block_request(&start, duration).is_ok(), expected);
        }

        #[test]
        fn property_blocks_may_end_at_midnight_but_not_one_minute_later(duration in 1_u16..481) {
            let exact_start = format_hhmm(1440 - duration);
            let overflow_start = format_hhmm(1441 - duration);
            prop_assert!(validate_block_request(&exact_start, duration).is_ok());
            // A one-minute block cannot start at 24:00; it is rejected by time validation.
            prop_assert!(validate_block_request(&overflow_start, duration).is_err());
        }

        #[test]
        fn property_ripple_preserves_cancelled_blocks_and_is_atomic_on_overflow(
            start in prop_oneof![0_u16..1440, 1200_u16..1440],
            moved_duration in 1_u16..241,
            durations in proptest::collection::vec(1_u16..121, 1..9),
            cancelled_start in 0_u16..1440,
            reverse in any::<bool>(),
        ) {
            // All active rows overlap the moved row. The independently computed sum
            // determines whether the complete cascade fits, including exact midnight.
            let mut blocks = vec![block("m", "Moved", &format_hhmm(start), moved_duration)];
            for (index, duration) in durations.iter().enumerate() {
                blocks.push(block(
                    &format!("active-{index}"),
                    &format!("Active {index:02}"),
                    &format_hhmm(start),
                    *duration,
                ));
            }
            let mut cancelled = block("cancelled", "Cancelled", &format_hhmm(cancelled_start), 480);
            cancelled.status = BlockStatus::Cancelled;
            blocks.push(cancelled.clone());
            if reverse {
                blocks.reverse();
            }
            let before = blocks.clone();
            let end = u32::from(start) + u32::from(moved_duration)
                + durations.iter().map(|duration| u32::from(*duration)).sum::<u32>();
            let result = displace_overlapping_blocks(&mut blocks, "m");
            prop_assert_eq!(result.is_ok(), end <= 1440);
            prop_assert_eq!(blocks.len(), before.len());
            prop_assert_eq!(blocks.iter().find(|row| row.id == "cancelled"), Some(&cancelled));

            if result.is_err() {
                // Sorting is allowed; rejected operations must preserve every row's data.
                for original in &before {
                    prop_assert_eq!(blocks.iter().find(|row| row.id == original.id), Some(original));
                }
            } else {
                let mut expected_start = start + moved_duration;
                for (index, duration) in durations.iter().enumerate() {
                    let id = format!("active-{index}");
                    let displaced = blocks.iter().find(|row| row.id == id).expect("row survives");
                    prop_assert_eq!(&displaced.start, &format_hhmm(expected_start));
                    let mut expected = before.iter().find(|row| row.id == id).expect("original").clone();
                    expected.start = format_hhmm(expected_start);
                    prop_assert_eq!(displaced, &expected);
                    expected_start += duration;
                }
                prop_assert_eq!(blocks.iter().find(|row| row.id == "m"), before.iter().find(|row| row.id == "m"));
                let after_first = blocks.clone();
                displace_overlapping_blocks(&mut blocks, "m").expect("same ripple fits");
                prop_assert_eq!(blocks, after_first);
            }
        }

        #[test]
        fn property_recalculate_packs_active_rows_or_preserves_every_row(
            start in prop_oneof![0_u16..1440, 1200_u16..1440],
            rows in proptest::collection::vec((1_u16..481, any::<bool>(), 0_u16..1440), 0..10),
        ) {
            let mut blocks: Vec<_> = rows.iter().enumerate().map(|(index, (duration, cancelled, minute))| {
                let mut row = block(&format!("row-{index}"), "Row", &format_hhmm(*minute), *duration);
                if *cancelled {
                    row.status = BlockStatus::Cancelled;
                }
                row
            }).collect();
            if let Some(first_active) = blocks.iter_mut().find(|row| row.status != BlockStatus::Cancelled) {
                first_active.start = format_hhmm(start);
            }
            let before = blocks.clone();
            let active_duration: u32 = blocks.iter().filter(|row| row.status != BlockStatus::Cancelled)
                .map(|row| u32::from(row.duration)).sum();
            let result = recalculate_start_times_from(&mut blocks, 0);
            prop_assert_eq!(result.is_ok(), active_duration == 0 || u32::from(start) + active_duration <= 1440);
            if result.is_err() {
                prop_assert_eq!(blocks, before);
            } else {
                let mut expected_start = start;
                for (row, original) in blocks.iter().zip(&before) {
                    let mut expected = original.clone();
                    if row.status != BlockStatus::Cancelled {
                        expected.start = format_hhmm(expected_start);
                        expected_start += row.duration;
                    }
                    prop_assert_eq!(row, &expected);
                }
            }
        }
    }
}
