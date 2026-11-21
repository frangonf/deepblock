use std::collections::{BTreeMap, BTreeSet};

use axum::{
    Json,
    extract::{Query, State},
};
use serde::Serialize;
use serde_json::{Value, json};

use crate::{
    error::{AppError, AppResult},
    models::{
        Block, BlockDiff, BlockDiffChangeType, CompareQuery, PlanComparisonResponse, today_string,
    },
    state::AppState,
};

fn block_summary_details(block: &Block) -> BTreeMap<String, Value> {
    BTreeMap::from([
        ("start".to_string(), Value::String(block.start.clone())),
        ("duration".to_string(), json!(block.duration)),
        ("type".to_string(), json!(block.block_type)),
    ])
}

fn insert_change<T: Serialize + PartialEq>(
    details: &mut BTreeMap<String, Value>,
    key: &str,
    before: &T,
    after: &T,
) {
    if before != after {
        details.insert(key.to_string(), json!({ "before": before, "after": after }));
    }
}

pub async fn compare_plan(
    State(state): State<AppState>,
    Query(query): Query<CompareQuery>,
) -> AppResult<Json<PlanComparisonResponse>> {
    let plan = state
        .load_plan_async(&query.date.unwrap_or_else(today_string))
        .await?;
    let base_revision = if let Some(base) = query.base {
        plan.revisions
            .iter()
            .find(|revision| revision.id == base)
            .ok_or_else(|| AppError::NotFound(format!("Revision '{base}' was not found")))?
    } else {
        plan.baseline_revision()
            .ok_or_else(|| AppError::BadRequest("No revisions available".to_string()))?
    };
    let compare_revision = if let Some(compare) = query.compare {
        plan.revisions
            .iter()
            .find(|revision| revision.id == compare)
            .ok_or_else(|| AppError::NotFound(format!("Revision '{compare}' was not found")))?
    } else {
        plan.revisions
            .last()
            .ok_or_else(|| AppError::BadRequest("No revisions available".to_string()))?
    };

    let base_map = base_revision
        .blocks
        .iter()
        .map(|block| (block.id.clone(), block))
        .collect::<BTreeMap<_, _>>();
    let compare_map = compare_revision
        .blocks
        .iter()
        .map(|block| (block.id.clone(), block))
        .collect::<BTreeMap<_, _>>();

    let mut added = Vec::new();
    let mut removed = Vec::new();
    let mut modified = Vec::new();

    let ids = base_map
        .keys()
        .chain(compare_map.keys())
        .cloned()
        .collect::<BTreeSet<_>>();

    for block_id in ids {
        match (base_map.get(&block_id), compare_map.get(&block_id)) {
            (None, Some(block)) => added.push(BlockDiff {
                block_id: block.id.clone(),
                label: block.label.clone(),
                change_type: BlockDiffChangeType::Added,
                details: block_summary_details(block),
            }),
            (Some(block), None) => removed.push(BlockDiff {
                block_id: block.id.clone(),
                label: block.label.clone(),
                change_type: BlockDiffChangeType::Removed,
                details: block_summary_details(block),
            }),
            (Some(before), Some(after)) if before != after => {
                let mut details = BTreeMap::new();
                insert_change(&mut details, "label", &before.label, &after.label);
                insert_change(&mut details, "start", &before.start, &after.start);
                insert_change(&mut details, "duration", &before.duration, &after.duration);
                insert_change(
                    &mut details,
                    "actual_duration",
                    &before.actual_duration,
                    &after.actual_duration,
                );
                insert_change(
                    &mut details,
                    "completed",
                    &before
                        .metadata
                        .get("outcome_completed")
                        .and_then(Value::as_bool),
                    &after
                        .metadata
                        .get("outcome_completed")
                        .and_then(Value::as_bool),
                );
                insert_change(&mut details, "type", &before.block_type, &after.block_type);
                insert_change(&mut details, "status", &before.status, &after.status);
                insert_change(
                    &mut details,
                    "focus_rating",
                    &before.focus_rating,
                    &after.focus_rating,
                );
                modified.push(BlockDiff {
                    block_id: after.id.clone(),
                    label: after.label.clone(),
                    change_type: BlockDiffChangeType::Modified,
                    details,
                });
            }
            _ => {}
        }
    }

    let response = PlanComparisonResponse {
        base_revision: base_revision.id.clone(),
        compare_revision: compare_revision.id.clone(),
        summary: format!(
            "{} added, {} removed, {} modified",
            added.len(),
            removed.len(),
            modified.len()
        ),
        added,
        removed,
        modified,
        change_log: plan
            .change_log
            .iter()
            .map(serde_json::to_value)
            .collect::<Result<Vec<Value>, _>>()?,
    };

    Ok(Json(response))
}
