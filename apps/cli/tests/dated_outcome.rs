use deepblock_server::{
    app,
    models::{Block, DayPlan},
    state::AppState,
};
use serde_json::json;

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn real_cli_records_and_clears_dated_feedback_without_rewriting_intention() {
    let root = tempfile::tempdir().unwrap();
    let state = AppState::for_test(root.path());
    let mut plan = DayPlan::new("2026-01-05");
    let mut block = Block::from_request(
        serde_json::from_value(json!({"label":"Work","start":"09:00","duration":60})).unwrap(),
        &[],
    );
    block.id = "feedback".into();
    plan.active_revision_mut().unwrap().blocks.push(block);
    state.save_plan(&plan).unwrap();
    let before = state.planning_store().unwrap().intents(&plan.date).unwrap();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let endpoint = format!("http://{}", listener.local_addr().unwrap());
    let router = app(state.clone());
    let server = tokio::spawn(async move {
        axum::serve(listener, router).await.unwrap();
    });
    for arguments in [
        vec!["--actual-duration", "0", "--completed", "false"],
        vec!["--clear-actual-duration", "--focus-rating", "4"],
    ] {
        let endpoint = endpoint.clone();
        let output = tokio::task::spawn_blocking(move || {
            std::process::Command::new(env!("CARGO_BIN_EXE_deepb"))
                .args([
                    "--server",
                    &endpoint,
                    "outcome",
                    "feedback",
                    "--date",
                    "2026-01-05",
                ])
                .args(arguments)
                .output()
                .unwrap()
        })
        .await
        .unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
    }
    let saved = state.load_plan(&plan.date).unwrap();
    assert_eq!(saved.revisions.len(), plan.revisions.len());
    assert_eq!(saved.active_revision().unwrap().blocks[0].start, "09:00");
    assert_eq!(
        saved.active_revision().unwrap().blocks[0].actual_duration,
        None
    );
    assert_eq!(
        saved.active_revision().unwrap().blocks[0].focus_rating,
        Some(4)
    );
    assert_eq!(
        saved.active_revision().unwrap().blocks[0].metadata["outcome_completed"],
        false
    );
    assert_eq!(
        state.planning_store().unwrap().intents(&plan.date).unwrap(),
        before
    );
    server.abort();
}
