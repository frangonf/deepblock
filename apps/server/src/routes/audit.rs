use axum::{Json, extract::State};

use crate::{
    aw::ActivityWatchClient,
    error::AppResult,
    models::{DayPlan, today_string},
    state::AppState,
};

pub async fn audit_plan(State(state): State<AppState>) -> AppResult<Json<DayPlan>> {
    let settings = state.settings.read().await.clone();
    let date = today_string();
    let plan = state.load_plan_async(&date).await?;

    if !settings.activitywatch.enabled {
        return Ok(Json(plan));
    }

    let client = ActivityWatchClient::new(&settings.activitywatch);
    let audited_plan = client.audit_day_plan(&plan).await?;
    let date_lock = state.lock_for_date(&date);
    let _date_guard = date_lock.lock().await;
    let mut current = state.load_plan_async(&date).await?;
    // Enrichment is fetched outside the writer lock. Merge only unchanged
    // blocks in the same revision; never save the stale whole-plan snapshot.
    if let (Some(before), Some(audited), Some(head)) = (
        plan.active_revision(),
        audited_plan.active_revision(),
        current.active_revision_mut(),
    ) && head.id == before.id
        && head.created_at == before.created_at
    {
        for block in &mut head.blocks {
            if before.blocks.iter().any(|original| original == block)
                && let Some(enriched) = audited
                    .blocks
                    .iter()
                    .find(|enriched| enriched.id == block.id)
            {
                block.reality = enriched.reality.clone();
            }
        }
    }
    state.save_plan_async(&current).await?;
    state.events.send_refresh("plan_audited");

    Ok(Json(current))
}
