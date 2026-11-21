mod common;
use axum::http::StatusCode;
use deepblock_server::{
    app,
    models::{Block, BlockStatus, DayPlan},
    state::AppState,
};
use serde_json::json;

fn block(label: &str, minutes: u16, focus: Option<u8>) -> Block {
    Block::from_request(
        serde_json::from_value(
            json!({"label":label,"start":"09:00","duration":minutes,"focus_rating":focus}),
        )
        .unwrap(),
        &[],
    )
}

#[tokio::test]
async fn final_plan_baseline_and_sparse_feedback_are_explicit() {
    let root = tempfile::tempdir().unwrap();
    let state = AppState::for_test(root.path());
    let mut first = DayPlan::new("2026-01-05");
    first.revisions[0].blocks.push(block("Original", 60, None));
    let mut final_revision = first.revisions[0].clone();
    final_revision.id = "B".into();
    final_revision.reason = Some("Interrupted".into());
    final_revision.blocks[0].duration = 90;
    final_revision.blocks[0].actual_duration = Some(0);
    final_revision.blocks[0].focus_rating = Some(5);
    final_revision.blocks[0]
        .metadata
        .insert("outcome_completed".into(), json!(true));
    let mut cancelled = block("Cancelled", 999, Some(5));
    cancelled.status = BlockStatus::Cancelled;
    final_revision.blocks.push(cancelled);
    first.revisions.push(final_revision);
    state.save_plan(&first).unwrap();
    let mut second = DayPlan::new("2026-01-06");
    second.revisions[0]
        .blocks
        .extend([block("Second", 30, Some(1)), block("Third", 30, Some(1))]);
    second.revisions[0].blocks[0].status = BlockStatus::Done;
    state.save_plan(&second).unwrap();
    let router = app(state);
    let (status, review) = common::request(
        &router,
        "GET",
        "/review/range?start=2026-01-05&end=2026-01-08",
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(review["baseline"], "final_active_revision");
    assert_eq!(review["totals"]["planned_minutes"], 150);
    assert_eq!(review["totals"]["reported_minutes"], 0);
    assert_eq!(review["totals"]["minutes_reported_blocks"], 1);
    assert_eq!(review["totals"]["eligible_blocks"], 3);
    assert_eq!(review["totals"]["completion_reported_blocks"], 2);
    assert!((review["totals"]["focus_mean"].as_f64().unwrap() - 7.0 / 3.0).abs() < 1e-10);
    assert!(review["days"][1]["totals"]["reported_minutes"].is_null());
    assert!(review["days"][2]["revision_id"].is_null());
    assert_eq!(review["days"][0]["revision_reasons"][1], "Interrupted");
    for query in [
        "start=2026-01-06&end=2026-01-05",
        "start=2026-01-01&end=2026-02-01",
        "start=../..&end=2026-01-05",
    ] {
        assert_eq!(
            common::request(&router, "GET", &format!("/review/range?{query}"), None)
                .await
                .0,
            StatusCode::BAD_REQUEST
        );
    }
}
