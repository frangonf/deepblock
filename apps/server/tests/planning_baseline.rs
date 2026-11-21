mod common;

use axum::http::StatusCode;
use deepblock_server::{app, models::Block, state::AppState};
use serde_json::json;
use std::time::Instant;

/// An isolated multi-day workflow reused after storage cutover. No tracker is
/// installed, and restarting the state discards all in-memory plan data.
#[tokio::test]
async fn intentions_notes_and_feedback_survive_restart_across_days() {
    let dir = tempfile::tempdir().unwrap();
    let state = AppState::for_test(dir.path());
    let router = app(state.clone());
    for date in ["2026-01-05", "2026-01-06", "2026-01-07"] {
        let mut plan = state.load_plan(date).unwrap();
        let mut block = Block::from_request(
            serde_json::from_value(json!({
                "label": "Ship change", "start": "09:00", "duration": 60,
                "type": "focus", "status": "confirmed"
            }))
            .unwrap(),
            &[],
        );
        block.id = "work".into();
        plan.active_revision_mut().unwrap().blocks.push(block);
        state.save_plan(&plan).unwrap();
        let (status, _) = common::request(
            &router,
            "PUT",
            &format!("/notes/{date}"),
            Some(json!({"content": "Interrupted; resumed after lunch."})),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        let before = state.load_plan(date).unwrap();
        let (status, _) = common::request(
            &router,
            "PATCH",
            &format!("/blocks/work/outcome?date={date}"),
            Some(json!({"actual_duration": 0, "focus_rating": 3, "completed": false})),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        let after = state.load_plan(date).unwrap();
        assert_eq!(before.revisions.len(), after.revisions.len());
        assert_eq!(after.active_revision().unwrap().blocks[0].duration, 60);
    }
    drop(router);
    drop(state);
    let restored = AppState::for_test(dir.path());
    for date in ["2026-01-05", "2026-01-06", "2026-01-07"] {
        let plan = restored.load_plan(date).unwrap();
        let block = &plan.active_revision().unwrap().blocks[0];
        assert_eq!(block.id, "work");
        assert_eq!(block.actual_duration, Some(0));
        assert_eq!(block.focus_rating, Some(3));
        assert_eq!(
            restored.load_note(date).unwrap().as_deref(),
            Some("Interrupted; resumed after lunch.")
        );
        assert!(!restored.load_history(date).unwrap().undo.is_empty());
    }
}

#[test]
fn report_storage_save_baseline() {
    let dir = tempfile::tempdir().unwrap();
    let state = AppState::for_test(dir.path());
    let plan = state.load_plan("2026-01-05").unwrap();
    let mut plan_times = Vec::new();
    let mut note_times = Vec::new();
    for _ in 0..100 {
        let start = Instant::now();
        state.save_plan(&plan).unwrap();
        plan_times.push(start.elapsed().as_micros());
        let start = Instant::now();
        state
            .save_note(&plan.date, "Representative note.\n".repeat(100).as_str())
            .unwrap();
        note_times.push(start.elapsed().as_micros());
    }
    plan_times.sort_unstable();
    note_times.sort_unstable();
    eprintln!(
        "storage baseline (100 saves, microseconds): plan p50={} p95={}; note p50={} p95={}",
        plan_times[49], plan_times[94], note_times[49], note_times[94]
    );
}
