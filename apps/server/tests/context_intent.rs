mod common;
use axum::http::StatusCode;
use deepblock_server::{app, context::ContextCatalog, state::AppState};
use serde_json::json;

#[tokio::test]
async fn manual_context_is_versioned_feedback_independent_and_conflict_checked() {
    let root = tempfile::tempdir().unwrap();
    let state = AppState::for_test(root.path());
    let router = app(state.clone());
    let personal = uuid::Uuid::new_v4().to_string();
    let employer = uuid::Uuid::new_v4().to_string();
    let goal = uuid::Uuid::new_v4().to_string();
    let catalog = json!({"schema_version":1,"projects":[{"id":personal,"name":"Personal","ownership":"personal"},{"id":employer,"name":"Employer","ownership":"employer"}],"goals":[{"id":goal,"label":"Ship"}]});
    let empty = serde_json::to_value(ContextCatalog::default()).unwrap();
    assert_eq!(
        common::request(
            &router,
            "PUT",
            "/context",
            Some(json!({"base":empty,"catalog":catalog}))
        )
        .await
        .0,
        StatusCode::OK
    );
    let (status, plan) = common::request(&router,"POST","/blocks",Some(json!({"label":"Work","start":"09:00","duration":60,"metadata":{"untouched":{"nested":true}}}))).await;
    assert_eq!(status, StatusCode::OK);
    let id = plan["revisions"][0]["blocks"][0]["id"].as_str().unwrap();
    assert_eq!(
        common::request(
            &router,
            "PATCH",
            &format!("/blocks/{id}"),
            Some(json!({"project_id":personal,"goal_id":goal}))
        )
        .await
        .0,
        StatusCode::OK
    );
    let date = deepblock_server::models::today_string();
    let snapshots = state.planning_store().unwrap().intents(&date).unwrap();
    let committed = snapshots.last().unwrap().clone();
    assert_eq!(
        committed.blocks[0].project.as_ref().unwrap().ownership,
        deepblock_server::context::Ownership::Personal
    );
    assert_eq!(
        common::request(
            &router,
            "PATCH",
            &format!("/blocks/{id}/outcome"),
            Some(json!({"actual_duration":0,"completed":true}))
        )
        .await
        .0,
        StatusCode::OK
    );
    assert_eq!(
        state.planning_store().unwrap().intents(&date).unwrap(),
        snapshots
    );
    let mut renamed = catalog.clone();
    renamed["projects"][0]["name"] = json!("Renamed");
    assert_eq!(
        common::request(
            &router,
            "PUT",
            "/context",
            Some(json!({"base":catalog,"catalog":renamed}))
        )
        .await
        .0,
        StatusCode::OK
    );
    let latest = state.planning_store().unwrap().intents(&date).unwrap();
    assert_eq!(latest[latest.len() - 2], committed);
    assert_eq!(
        latest.last().unwrap().blocks[0]
            .project
            .as_ref()
            .unwrap()
            .name,
        "Renamed"
    );
    let (status, effective) = common::request(
        &router,
        "GET",
        &format!("/intent/{date}?at={}", committed.recorded_at),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(effective["version"], committed.version);
    assert_eq!(
        common::request(
            &router,
            "PUT",
            "/context",
            Some(json!({"base":catalog,"catalog":renamed}))
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
    assert_eq!(
        common::request(
            &router,
            "PATCH",
            &format!("/blocks/{id}"),
            Some(json!({"project_id":null}))
        )
        .await
        .0,
        StatusCode::OK
    );
    let saved = state.load_today_plan().unwrap();
    let block = &saved.active_revision().unwrap().blocks[0];
    assert!(!block.metadata.contains_key("project_id"));
    assert_eq!(block.metadata["goal_id"], goal);
    assert_eq!(block.metadata["untouched"], json!({"nested":true}));
    let before = saved.clone();
    assert_eq!(
        common::request(
            &router,
            "PATCH",
            &format!("/blocks/{id}"),
            Some(json!({"project_id":"unresolved"}))
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(state.load_today_plan().unwrap(), before);
}
