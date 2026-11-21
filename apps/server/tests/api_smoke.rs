use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use chrono::{Duration, Local};
use deepblock_server::{
    app,
    models::{
        Backlog, Block, BlockType, ClientConfigResponse, DayPlan, PlanComparisonResponse,
        PlanReviewResponse, RevisionStrategy, today_string,
    },
    persist,
    state::AppState,
};
use tempfile::tempdir;
use tower::ServiceExt;

mod common;
use common::request;

#[tokio::test]
async fn health_identifies_the_deepblock_service() {
    let dir = tempdir().expect("tempdir");
    let (_, health) = request(&app(AppState::for_test(dir.path())), "GET", "/health", None).await;
    assert_eq!(health["service"], "deepblock");
}

#[tokio::test]
async fn get_today_plan_bootstraps_revision_a() {
    let temp_dir = tempdir().expect("tempdir should be created");
    let app = app(AppState::for_test(temp_dir.path()));

    let (response_status, body) = request(&app, "GET", "/plan/today", None).await;

    assert_eq!(response_status, StatusCode::OK);

    let plan: DayPlan = serde_json::from_value(body).expect("day plan should deserialize");

    assert_eq!(plan.revisions.len(), 1);
    assert_eq!(plan.revisions[0].id, "A");
}

#[tokio::test]
async fn add_block_returns_updated_plan() {
    let temp_dir = tempdir().expect("tempdir should be created");
    let app = app(AppState::for_test(temp_dir.path()));

    let (response_status, body) = request(
        &app,
        "POST",
        "/blocks",
        Some(
            serde_json::json!({"label":"Deep Work","start":"09:00","duration":120,"type":"focus"}),
        ),
    )
    .await;

    assert_eq!(response_status, StatusCode::OK);

    let plan: DayPlan = serde_json::from_value(body).expect("day plan should deserialize");

    assert_eq!(plan.revisions[0].blocks.len(), 1);
    assert_eq!(plan.revisions[0].blocks[0].label, "Deep Work");
}

#[tokio::test]
async fn patch_block_updates_fields_and_returns_plan() {
    let temp_dir = tempdir().expect("tempdir should be created");
    let app = app(AppState::for_test(temp_dir.path()));

    let (_, create_body) = request(
        &app,
        "POST",
        "/blocks",
        Some(
            serde_json::json!({"label":"Deep Work","start":"09:00","duration":120,"type":"focus"}),
        ),
    )
    .await;

    let created_plan: DayPlan =
        serde_json::from_value(create_body).expect("day plan should deserialize");
    let block_id = created_plan.revisions[0].blocks[0].id.clone();

    let (response_status, body) = request(
        &app,
        "PATCH",
        &format!("/blocks/{block_id}"),
        Some(serde_json::json!({"label":"Deep Work++","focus_rating":5,"duration":90})),
    )
    .await;

    assert_eq!(response_status, StatusCode::OK);

    let plan: DayPlan = serde_json::from_value(body).expect("day plan should deserialize");

    assert_eq!(plan.revisions[0].blocks[0].label, "Deep Work++");
    assert_eq!(plan.revisions[0].blocks[0].focus_rating, Some(5));
    assert_eq!(plan.revisions[0].blocks[0].duration, 90);
}

#[tokio::test]
async fn patch_block_with_every_change_strategy_creates_a_new_revision() {
    let temp_dir = tempdir().expect("tempdir should be created");
    let state = AppState::for_test(temp_dir.path());
    state.settings.write().await.client.revision.strategy = RevisionStrategy::EveryChange;
    let app = app(state);

    let (_, create_body) = request(
        &app,
        "POST",
        "/blocks",
        Some(
            serde_json::json!({"label":"Deep Work","start":"09:00","duration":120,"type":"focus"}),
        ),
    )
    .await;

    let created_plan: DayPlan =
        serde_json::from_value(create_body).expect("day plan should deserialize");
    let block_id = created_plan.revisions[0].blocks[0].id.clone();

    let (response_status, body) = request(
        &app,
        "PATCH",
        &format!("/blocks/{block_id}"),
        Some(serde_json::json!({"duration":90})),
    )
    .await;

    assert_eq!(response_status, StatusCode::OK);

    let plan: DayPlan = serde_json::from_value(body).expect("day plan should deserialize");

    assert_eq!(plan.revisions.len(), 2);
    assert_eq!(plan.revisions[0].blocks[0].duration, 120);
    assert_eq!(plan.revisions[1].id, "B");
    assert_eq!(
        plan.revisions[1].reason.as_deref(),
        Some("Auto: updated 'Deep Work' (duration 120m -> 90m)")
    );
    assert_eq!(plan.revisions[1].blocks[0].duration, 90);
}

#[tokio::test]
async fn patch_block_with_forced_revision_creates_a_new_revision() {
    let temp_dir = tempdir().expect("tempdir should be created");
    let app = app(AppState::for_test(temp_dir.path()));

    let (_, create_body) = request(
        &app,
        "POST",
        "/blocks",
        Some(
            serde_json::json!({"label":"Deep Work","start":"09:00","duration":120,"type":"focus"}),
        ),
    )
    .await;

    let created_plan: DayPlan =
        serde_json::from_value(create_body).expect("day plan should deserialize");
    let block_id = created_plan.revisions[0].blocks[0].id.clone();

    let (response_status, body) = request(
        &app,
        "PATCH",
        &format!("/blocks/{block_id}"),
        Some(serde_json::json!({"start":"09:30","duration":90,"force_revision":true})),
    )
    .await;

    assert_eq!(response_status, StatusCode::OK);

    let plan: DayPlan = serde_json::from_value(body).expect("day plan should deserialize");

    assert_eq!(plan.revisions.len(), 2);
    assert_eq!(plan.revisions[0].blocks[0].start, "09:00");
    assert_eq!(plan.revisions[0].blocks[0].duration, 120);
    assert_eq!(plan.revisions[1].id, "B");
    assert_eq!(
        plan.revisions[1].reason.as_deref(),
        Some("Auto: updated 'Deep Work' (time 09:00 -> 09:30, duration 120m -> 90m)")
    );
    assert_eq!(plan.revisions[1].blocks[0].start, "09:30");
    assert_eq!(plan.revisions[1].blocks[0].duration, 90);
}

#[tokio::test]
async fn patch_block_with_timed_strategy_inside_grace_stays_in_active_revision() {
    let temp_dir = tempdir().expect("tempdir should be created");
    let state = AppState::for_test(temp_dir.path());
    state.settings.write().await.client.revision.strategy = RevisionStrategy::Timed;
    state.settings.write().await.client.revision.grace_minutes = 10;
    let app = app(state);

    let (_, create_body) = request(
        &app,
        "POST",
        "/blocks",
        Some(
            serde_json::json!({"label":"Deep Work","start":"09:00","duration":120,"type":"focus"}),
        ),
    )
    .await;

    let created_plan: DayPlan =
        serde_json::from_value(create_body).expect("day plan should deserialize");
    let block_id = created_plan.revisions[0].blocks[0].id.clone();

    let (response_status, body) = request(
        &app,
        "PATCH",
        &format!("/blocks/{block_id}"),
        Some(serde_json::json!({"duration":90})),
    )
    .await;

    assert_eq!(response_status, StatusCode::OK);

    let plan: DayPlan = serde_json::from_value(body).expect("day plan should deserialize");

    assert_eq!(plan.revisions.len(), 1);
    assert_eq!(plan.revisions[0].blocks[0].duration, 90);
}

#[tokio::test]
async fn delete_block_with_timed_strategy_after_grace_creates_a_new_revision() {
    let temp_dir = tempdir().expect("tempdir should be created");
    let state = AppState::for_test(temp_dir.path());
    state.settings.write().await.client.revision.strategy = RevisionStrategy::Timed;
    state.settings.write().await.client.revision.grace_minutes = 5;

    let created_at = (Local::now().naive_local() - Duration::minutes(15))
        .format("%Y-%m-%dT%H:%M:%S%.6f")
        .to_string();
    let mut plan = DayPlan::new(today_string());
    plan.revisions[0].blocks.push(Block {
        id: "focus-1".to_string(),
        label: "Deep Work".to_string(),
        start: "09:00".to_string(),
        duration: 60,
        block_type: BlockType::Focus,
        status: deepblock_server::models::BlockStatus::Proposed,
        created_at,
        metadata: Default::default(),
        content_path: None,
        focus_rating: None,
        actual_duration: None,
        next_action: None,
        artifacts: Vec::new(),
        reality: None,
    });
    state.save_plan(&plan).expect("plan should save");

    let app = app(state);
    let (response_status, body) = request(&app, "DELETE", "/blocks/focus-1", None).await;

    assert_eq!(response_status, StatusCode::OK);

    let plan: DayPlan = serde_json::from_value(body).expect("day plan should deserialize");

    assert_eq!(plan.revisions.len(), 2);
    assert_eq!(plan.revisions[0].blocks.len(), 1);
    assert!(plan.revisions[1].blocks.is_empty());
    assert_eq!(
        plan.revisions[1].reason.as_deref(),
        Some("Auto: deleted 'Deep Work'")
    );
}

#[tokio::test]
async fn compare_plan_uses_selected_date_and_rejects_invalid_dates() {
    let temp_dir = tempdir().expect("tempdir should be created");
    let state = AppState::for_test(temp_dir.path());
    let mut plan = state.load_plan("2024-02-29").expect("historical plan");
    plan.revisions[0].id = "historical".to_string();
    state.save_plan(&plan).expect("save historical plan");
    let app = app(state);
    let (response_status, body) = request(
        &app,
        "GET",
        "/plan/compare?date=2024-02-29&base=historical&compare=historical",
        None,
    )
    .await;
    assert_eq!(response_status, StatusCode::OK);

    let comparison: PlanComparisonResponse = serde_json::from_value(body).expect("comparison");
    assert_eq!(comparison.base_revision, "historical");
    let (response_status, _) = request(&app, "GET", "/plan/compare?date=2026-02-30", None).await;
    assert_eq!(response_status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn compare_plan_returns_field_level_details() {
    let temp_dir = tempdir().expect("tempdir should be created");
    let app = app(AppState::for_test(temp_dir.path()));

    let (_, create_body) = request(
        &app,
        "POST",
        "/blocks",
        Some(
            serde_json::json!({"label":"Deep Work","start":"09:00","duration":120,"type":"focus"}),
        ),
    )
    .await;

    let created_plan: DayPlan =
        serde_json::from_value(create_body).expect("day plan should deserialize");
    let block_id = created_plan.revisions[0].blocks[0].id.clone();

    let (revise_response_status, _) = request(
        &app,
        "POST",
        "/plan/revise",
        Some(serde_json::json!({"copy_mode":"all"})),
    )
    .await;
    assert_eq!(revise_response_status, StatusCode::OK);

    let (patch_response_status, _) = request(
        &app,
        "PATCH",
        &format!("/blocks/{block_id}"),
        Some(serde_json::json!({"start":"10:30","duration":90})),
    )
    .await;
    assert_eq!(patch_response_status, StatusCode::OK);

    let (response_status, body) =
        request(&app, "GET", "/plan/compare?base=A&compare=B", None).await;

    assert_eq!(response_status, StatusCode::OK);

    let comparison: PlanComparisonResponse =
        serde_json::from_value(body).expect("comparison should deserialize");
    let modified = comparison
        .modified
        .first()
        .expect("modified block should exist");

    assert!(modified.details.contains_key("start"));
    assert!(modified.details.contains_key("duration"));
}

#[tokio::test]
async fn review_plan_returns_variance_reports_without_audit_dependency() {
    let temp_dir = tempdir().expect("tempdir should be created");
    let state = AppState::for_test(temp_dir.path());
    let mut plan = DayPlan::new(today_string());
    plan.revisions[0]
        .blocks
        .push(deepblock_server::models::Block {
            id: "focus-1".to_string(),
            label: "Deep Work".to_string(),
            start: "09:00".to_string(),
            duration: 60,
            block_type: deepblock_server::models::BlockType::Focus,
            status: deepblock_server::models::BlockStatus::Done,
            created_at: deepblock_server::models::now_timestamp(),
            metadata: Default::default(),
            content_path: None,
            focus_rating: Some(2),
            actual_duration: Some(90),
            next_action: None,
            artifacts: Vec::new(),
            reality: None,
        });
    state.save_plan(&plan).expect("plan should save");

    let app = app(state);
    let (response_status, body) = request(&app, "GET", "/plan/review", None).await;

    assert_eq!(response_status, StatusCode::OK);

    let review: PlanReviewResponse =
        serde_json::from_value(body).expect("review should deserialize");

    // This block is shorter on plan than in self-report and also has a low focus rating,
    // so the review should surface both duration_mismatch and focus_mismatch.
    assert_eq!(review.summary.reviewed_blocks, 1);
    assert_eq!(review.summary.total_reports, 2);
    assert_eq!(review.reports.len(), 2);
}

#[tokio::test]
async fn patch_config_updates_block_notification_settings() {
    let temp_dir = tempdir().expect("tempdir should be created");
    let app = app(AppState::for_test(temp_dir.path()));

    let (response_status, body) = request(&app, "PATCH", "/config", Some(serde_json::json!({"notifications_enabled":false,"notify_minutes_before":0,"notify_on_block_start":true,"notify_on_block_end":false}))).await;

    assert_eq!(response_status, StatusCode::OK);

    let config: ClientConfigResponse =
        serde_json::from_value(body).expect("config should deserialize");

    assert!(!config.notifications_enabled);
    assert_eq!(config.notify_minutes_before, 0);
    assert!(config.notify_on_block_start);
    assert!(!config.notify_on_block_end);
}

#[tokio::test]
async fn patch_config_rejects_out_of_bounds_display_hours() {
    let temp_dir = tempdir().expect("tempdir should be created");
    let app = app(AppState::for_test(temp_dir.path()));

    for invalid in [
        serde_json::json!({"start_hour":24}),
        serde_json::json!({"end_hour":25}),
        serde_json::json!({"end_hour":0}),
    ] {
        let (response_status, _) = request(&app, "PATCH", "/config", Some(invalid.clone())).await;

        assert_eq!(
            response_status,
            StatusCode::BAD_REQUEST,
            "payload {invalid} should be rejected"
        );
    }
}

#[tokio::test]
async fn patch_config_rejects_start_hour_not_before_end_hour() {
    let temp_dir = tempdir().expect("tempdir should be created");
    let app = app(AppState::for_test(temp_dir.path()));

    let (response_status, _) = request(
        &app,
        "PATCH",
        "/config",
        Some(serde_json::json!({"start_hour":20,"end_hour":8})),
    )
    .await;

    assert_eq!(response_status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn patch_config_accepts_valid_hour_window() {
    let temp_dir = tempdir().expect("tempdir should be created");
    let app = app(AppState::for_test(temp_dir.path()));

    let (response_status, _) = request(
        &app,
        "PATCH",
        "/config",
        Some(serde_json::json!({"start_hour":6,"end_hour":22})),
    )
    .await;

    assert_eq!(response_status, StatusCode::OK);
}

#[tokio::test]
async fn ensure_note_creates_note_path_and_content() {
    let temp_dir = tempdir().expect("tempdir should be created");
    let state = AppState::for_test(temp_dir.path());
    let app = app(state.clone());

    let (response_status, _) = request(&app, "POST", "/notes/ensure", None).await;

    assert_eq!(response_status, StatusCode::OK);

    let plan = state.load_today_plan().expect("plan should load");
    assert!(plan.note_path.is_some());
    let note_content = state
        .load_note(&plan.date)
        .expect("note should load")
        .expect("note should exist");
    assert!(note_content.contains("# Daily Note"));
}

#[tokio::test]
async fn backlog_update_round_trip_updates_status() {
    let temp_dir = tempdir().expect("tempdir should be created");
    let state = AppState::for_test(temp_dir.path());
    persist::write_json_pretty(
        &state.paths.backlog_file(),
        &[Backlog {
            id: "task-1".to_string(),
            label: "Ship desktop shell".to_string(),
            status: deepblock_server::models::BacklogStatus::Todo,
        }],
    )
    .expect("backlog should be written");
    let app = app(state);

    let (response_status, body) = request(
        &app,
        "PATCH",
        "/backlog/task-1",
        Some(serde_json::json!({"status":"inprogress"})),
    )
    .await;

    assert_eq!(response_status, StatusCode::OK);

    let backlog: Vec<Backlog> = serde_json::from_value(body).expect("backlog should deserialize");

    assert_eq!(
        backlog[0].status,
        deepblock_server::models::BacklogStatus::InProgress
    );
}

#[tokio::test]
async fn backlog_crud_round_trip_supports_create_update_and_delete() {
    let temp_dir = tempdir().expect("tempdir should be created");
    let app = app(AppState::for_test(temp_dir.path()));

    let (create_response_status, create_body) = request(
        &app,
        "POST",
        "/backlog",
        Some(serde_json::json!({"label":"Schedule review"})),
    )
    .await;

    assert_eq!(create_response_status, StatusCode::OK);

    let created_backlog: Vec<Backlog> =
        serde_json::from_value(create_body).expect("backlog should deserialize");
    let task = created_backlog.first().expect("task should exist");

    assert_eq!(task.label, "Schedule review");
    assert_eq!(task.status, deepblock_server::models::BacklogStatus::Todo);

    let (update_response_status, _) = request(
        &app,
        "PATCH",
        &format!("/backlog/{}", task.id),
        Some(serde_json::json!({"status":"done"})),
    )
    .await;

    assert_eq!(update_response_status, StatusCode::OK);

    let (delete_response_status, delete_body) =
        request(&app, "DELETE", &format!("/backlog/{}", task.id), None).await;

    assert_eq!(delete_response_status, StatusCode::OK);

    let backlog: Vec<Backlog> =
        serde_json::from_value(delete_body).expect("backlog should deserialize");
    assert!(backlog.is_empty());
}

#[tokio::test]
async fn artifact_round_trip_adds_and_removes_artifacts() {
    let temp_dir = tempdir().expect("tempdir should be created");
    let app = app(AppState::for_test(temp_dir.path()));

    let (_, create_body) = request(
        &app,
        "POST",
        "/blocks",
        Some(
            serde_json::json!({"label":"Deep Work","start":"09:00","duration":120,"type":"focus"}),
        ),
    )
    .await;

    let created_plan: DayPlan =
        serde_json::from_value(create_body).expect("day plan should deserialize");
    let block_id = created_plan.revisions[0].blocks[0].id.clone();

    let (add_response_status, add_body) = request(
        &app,
        "POST",
        &format!("/blocks/{block_id}/artifacts"),
        Some(serde_json::json!({"artifact":"artifact-1"})),
    )
    .await;

    assert_eq!(add_response_status, StatusCode::OK);

    let added_plan: DayPlan =
        serde_json::from_value(add_body).expect("day plan should deserialize");
    assert_eq!(
        added_plan.revisions[0].blocks[0].artifacts,
        vec!["artifact-1"]
    );

    let (remove_response_status, remove_body) = request(
        &app,
        "DELETE",
        &format!("/blocks/{block_id}/artifacts?artifact=artifact-1"),
        None,
    )
    .await;

    assert_eq!(remove_response_status, StatusCode::OK);

    let removed_plan: DayPlan =
        serde_json::from_value(remove_body).expect("day plan should deserialize");
    assert!(removed_plan.revisions[0].blocks[0].artifacts.is_empty());
}

#[tokio::test]
async fn undo_and_redo_restore_the_previous_plan_state() {
    let temp_dir = tempdir().expect("tempdir should be created");
    let app = app(AppState::for_test(temp_dir.path()));

    let (add_response_status, _) = request(
        &app,
        "POST",
        "/blocks",
        Some(
            serde_json::json!({"label":"Deep Work","start":"09:00","duration":120,"type":"focus"}),
        ),
    )
    .await;
    assert_eq!(add_response_status, StatusCode::OK);

    let (undo_response_status, undo_body) = request(&app, "POST", "/plan/undo", None).await;

    assert_eq!(undo_response_status, StatusCode::OK);

    let undone_plan: DayPlan =
        serde_json::from_value(undo_body).expect("day plan should deserialize");
    assert!(undone_plan.revisions[0].blocks.is_empty());

    let (redo_response_status, redo_body) = request(&app, "POST", "/plan/redo", None).await;

    assert_eq!(redo_response_status, StatusCode::OK);

    let redone_plan: DayPlan =
        serde_json::from_value(redo_body).expect("day plan should deserialize");
    assert_eq!(redone_plan.revisions[0].blocks.len(), 1);
    assert_eq!(redone_plan.revisions[0].blocks[0].label, "Deep Work");
}

#[tokio::test]
async fn cors_allows_local_clients_and_rejects_other_origins() {
    let temp_dir = tempdir().expect("tempdir should be created");
    let app = app(AppState::for_test(temp_dir.path()));

    let allowed_dev = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/health")
                .header("Origin", "http://localhost:5173")
                .body(Body::empty())
                .expect("request should be built"),
        )
        .await
        .expect("request should succeed");

    assert_eq!(
        allowed_dev
            .headers()
            .get("access-control-allow-origin")
            .and_then(|value| value.to_str().ok()),
        Some("http://localhost:5173")
    );

    let allowed_preview = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/health")
                .header("Origin", "http://127.0.0.1:4173")
                .body(Body::empty())
                .expect("request should be built"),
        )
        .await
        .expect("request should succeed");

    assert_eq!(
        allowed_preview
            .headers()
            .get("access-control-allow-origin")
            .and_then(|value| value.to_str().ok()),
        Some("http://127.0.0.1:4173")
    );

    let preflight = app
        .clone()
        .oneshot(
            Request::builder()
                .method("OPTIONS")
                .uri("/blocks")
                .header("Origin", "http://localhost:5173")
                .header("Access-Control-Request-Method", "POST")
                .header(
                    "Access-Control-Request-Headers",
                    "content-type, cache-control, accept",
                )
                .body(Body::empty())
                .expect("request should be built"),
        )
        .await
        .expect("preflight should succeed");

    assert_eq!(preflight.status(), StatusCode::OK);
    assert_eq!(
        preflight
            .headers()
            .get("access-control-allow-origin")
            .and_then(|value| value.to_str().ok()),
        Some("http://localhost:5173")
    );

    let denied = app
        .oneshot(
            Request::builder()
                .uri("/health")
                .header("Origin", "https://example.com")
                .body(Body::empty())
                .expect("request should be built"),
        )
        .await
        .expect("request should succeed");

    assert!(
        denied
            .headers()
            .get("access-control-allow-origin")
            .is_none()
    );
}

#[tokio::test]
async fn websocket_upgrade_rejects_unauthorized_origin_and_allows_local() {
    let temp_dir = tempdir().expect("tempdir should be created");
    let app = app(AppState::for_test(temp_dir.path()));

    let denied = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/ws/events")
                .header("connection", "upgrade")
                .header("upgrade", "websocket")
                .header("sec-websocket-version", "13")
                .header("sec-websocket-key", "dGhlIHNhbXBsZSBub25jZQ==")
                .header("origin", "https://evil.com")
                .body(Body::empty())
                .expect("request should be built"),
        )
        .await
        .expect("request should succeed");

    assert_eq!(denied.status(), StatusCode::FORBIDDEN);

    let missing_origin = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/ws/events")
                .header("connection", "upgrade")
                .header("upgrade", "websocket")
                .header("sec-websocket-version", "13")
                .header("sec-websocket-key", "dGhlIHNhbXBsZSBub25jZQ==")
                .body(Body::empty())
                .expect("request should be built"),
        )
        .await
        .expect("request should succeed");

    assert_eq!(missing_origin.status(), StatusCode::FORBIDDEN);

    let allowed = app
        .oneshot(
            Request::builder()
                .uri("/ws/events")
                .header("connection", "upgrade")
                .header("upgrade", "websocket")
                .header("sec-websocket-version", "13")
                .header("sec-websocket-key", "dGhlIHNhbXBsZSBub25jZQ==")
                .header("origin", "http://localhost:5173")
                .body(Body::empty())
                .expect("request should be built"),
        )
        .await
        .expect("request should succeed");

    // In a synthetic oneshot test without a live TCP stream, passing origin validation
    // reaches WebSocketUpgrade which responds with UPGRADE_REQUIRED (not FORBIDDEN).
    assert_ne!(allowed.status(), StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn get_plan_by_date_path_traversal_returns_400() {
    let temp_dir = tempdir().expect("tempdir should be created");
    let app = app(AppState::for_test(temp_dir.path()));

    let (response_status, _) = request(&app, "GET", "/plan/..%2F..%2Fetc%2Fpasswd", None).await;

    assert_eq!(response_status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn get_notes_path_traversal_returns_400() {
    let temp_dir = tempdir().expect("tempdir should be created");
    let app = app(AppState::for_test(temp_dir.path()));

    let (response_status, _) = request(&app, "GET", "/notes/..%2F..%2Fetc%2Fpasswd", None).await;

    assert_eq!(response_status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn add_block_ending_after_midnight_returns_400() {
    let temp_dir = tempdir().expect("tempdir should be created");
    let state = AppState::for_test(temp_dir.path());
    let app = app(state.clone());

    let (response_status, _) = request(
        &app,
        "POST",
        "/blocks",
        Some(serde_json::json!({"label":"Late","start":"23:00","duration":480,"type":"focus"})),
    )
    .await;

    assert_eq!(response_status, StatusCode::BAD_REQUEST);

    let plan = state.load_today_plan().expect("plan should load");
    assert!(
        plan.active_revision()
            .expect("revision should exist")
            .blocks
            .is_empty(),
        "rejected block must not be persisted"
    );
}

#[tokio::test]
async fn reposition_displacing_past_midnight_returns_400_and_keeps_plan() {
    let temp_dir = tempdir().expect("tempdir should be created");
    let state = AppState::for_test(temp_dir.path());
    let app = app(state.clone());

    for (label, start, duration) in [("Anchor", "08:00", 60), ("Late", "23:00", 60)] {
        let (response_status, _) = request(&app, "POST", "/blocks", Some(serde_json::json!({"label": label, "start": start, "duration": duration, "type": "focus"}))).await;
        assert_eq!(response_status, StatusCode::OK);
    }

    let plan = state.load_today_plan().expect("plan should load");
    let anchor_id = plan
        .active_revision()
        .and_then(|revision| revision.blocks.iter().find(|b| b.label == "Anchor"))
        .map(|b| b.id.clone())
        .expect("anchor block should exist");

    let (response_status, _) = request(
        &app,
        "PATCH",
        &format!("/blocks/{anchor_id}/reposition"),
        Some(serde_json::json!({"start":"23:30"})),
    )
    .await;

    assert_eq!(response_status, StatusCode::BAD_REQUEST);

    let reloaded = state.load_today_plan().expect("plan should reload");
    let late = reloaded
        .active_revision()
        .expect("revision should exist")
        .blocks
        .iter()
        .find(|b| b.label == "Late")
        .expect("late block should survive");
    assert_eq!(late.start, "23:00", "displacement must not be persisted");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn concurrent_block_additions_do_not_lose_writes() {
    let temp_dir = tempdir().expect("tempdir should be created");
    let state = AppState::for_test(temp_dir.path());
    let app = app(state.clone());

    let mut handles = Vec::new();
    for i in 0..12 {
        let app = app.clone();
        handles.push(tokio::spawn(async move {
            let (response_status, _) = request(&app, "POST", "/blocks", Some(serde_json::json!({"label": format!("Concurrent {i}"), "start": "08:00", "duration": 30, "type": "focus"}))).await;
            assert_eq!(response_status, StatusCode::OK);
        }));
    }

    for handle in handles {
        handle.await.expect("concurrent request should finish");
    }

    let plan = state.load_today_plan().expect("plan should load");
    let block_count = plan
        .active_revision()
        .expect("revision should exist")
        .blocks
        .len();
    assert_eq!(block_count, 12, "every concurrent write must survive");
}

#[tokio::test]
async fn review_plan_uses_requested_date() {
    let temp_dir = tempdir().expect("tempdir should be created");
    let state = AppState::for_test(temp_dir.path());
    let date = Local::now().date_naive() + Duration::days(3);
    let date = date.format("%Y-%m-%d").to_string();

    let mut plan = DayPlan::new(date.clone());
    plan.revisions[0]
        .blocks
        .push(deepblock_server::models::Block {
            id: "focus-9".to_string(),
            label: "Past work".to_string(),
            start: "09:00".to_string(),
            duration: 60,
            block_type: deepblock_server::models::BlockType::Focus,
            status: deepblock_server::models::BlockStatus::Done,
            created_at: deepblock_server::models::now_timestamp(),
            metadata: Default::default(),
            content_path: None,
            focus_rating: Some(2),
            actual_duration: Some(180),
            next_action: None,
            artifacts: Vec::new(),
            reality: None,
        });
    state.save_plan(&plan).expect("plan should save");

    let app = app(state);
    let (response_status, body) =
        request(&app, "GET", &format!("/plan/review?date={date}"), None).await;

    assert_eq!(response_status, StatusCode::OK);

    let review: PlanReviewResponse =
        serde_json::from_value(body).expect("review should deserialize");

    assert_eq!(review.date, date);
    assert!(
        !review.reports.is_empty(),
        "requested date's plan is reviewed"
    );
}

#[tokio::test]
async fn review_plan_rejects_invalid_date_query() {
    let temp_dir = tempdir().expect("tempdir should be created");
    let app = app(AppState::for_test(temp_dir.path()));

    let (response_status, _) = request(&app, "GET", "/plan/review?date=..%2F..%2Fetc", None).await;

    assert_eq!(response_status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn block_mutations_apply_to_requested_date() {
    let temp_dir = tempdir().expect("tempdir should be created");
    let state = AppState::for_test(temp_dir.path());
    let app = app(state.clone());
    let date = (Local::now().date_naive() + Duration::days(5))
        .format("%Y-%m-%d")
        .to_string();

    let (response_status, _) = request(
        &app,
        "POST",
        &format!("/blocks?date={date}"),
        Some(serde_json::json!({"label":"Other day","start":"10:00","duration":30,"type":"focus"})),
    )
    .await;
    assert_eq!(response_status, StatusCode::OK);

    let other_day = state.load_plan(&date).expect("plan should load");
    let block_id = other_day
        .active_revision()
        .expect("revision should exist")
        .blocks
        .iter()
        .find(|block| block.label == "Other day")
        .map(|block| block.id.clone())
        .expect("block should be created on the requested date");

    let today = state.load_today_plan().expect("today should load");
    assert!(
        today
            .active_revision()
            .expect("revision should exist")
            .blocks
            .is_empty(),
        "today's plan must stay untouched"
    );

    let (response_status, _) = request(
        &app,
        "PATCH",
        &format!("/blocks/{block_id}?date={date}"),
        Some(serde_json::json!({"label":"Renamed"})),
    )
    .await;
    assert_eq!(response_status, StatusCode::OK);

    let (response_status, _) = request(
        &app,
        "DELETE",
        &format!("/blocks/{block_id}?date={date}"),
        None,
    )
    .await;
    assert_eq!(response_status, StatusCode::OK);

    let final_plan = state.load_plan(&date).expect("plan should reload");
    assert!(
        final_plan
            .active_revision()
            .expect("revision should exist")
            .blocks
            .is_empty(),
        "delete must apply to the requested date"
    );
}

#[tokio::test]
async fn block_mutations_reject_invalid_date_query() {
    let temp_dir = tempdir().expect("tempdir should be created");
    let app = app(AppState::for_test(temp_dir.path()));

    let (response_status, _) = request(
        &app,
        "POST",
        "/blocks?date=..%2F..%2Fetc",
        Some(serde_json::json!({"label":"Evil","start":"10:00","duration":30,"type":"focus"})),
    )
    .await;

    assert_eq!(response_status, StatusCode::BAD_REQUEST);
}

async fn seed_block(app: &axum::Router, label: &str, start: &str) {
    let (response_status, _) = request(
        app,
        "POST",
        "/blocks",
        Some(serde_json::json!({"label": label, "start": start, "duration": 30, "type": "focus"})),
    )
    .await;
    assert_eq!(response_status, StatusCode::OK);
}

#[tokio::test]
async fn replan_batch_applies_all_operations_in_a_single_revision() {
    let temp_dir = tempdir().expect("tempdir should be created");
    let state = AppState::for_test(temp_dir.path());
    let app = app(state.clone());

    seed_block(&app, "Keep", "08:00").await;
    seed_block(&app, "Drop", "09:00").await;
    let before = state.load_today_plan().expect("plan should load");
    let revisions_before = before.revisions.len();
    let drop_id = before
        .active_revision()
        .and_then(|revision| revision.blocks.iter().find(|b| b.label == "Drop"))
        .map(|b| b.id.clone())
        .expect("drop block should exist");

    let payload = serde_json::json!({
        "reason": "Replanned from calendar draft",
        "operations": [
            {"op": "create", "block_id": "draft-1", "label": "Fresh", "start": "10:00", "duration": 45, "type": "shallow", "status": "confirmed", "focus_rating": 4},
            {"op": "update", "block_id": "draft-1", "label": "Fresh (renamed)"},
            {"op": "delete", "block_id": drop_id}
        ]
    });

    let (response_status, _) = request(&app, "POST", "/plan/replan", Some(payload)).await;

    assert_eq!(response_status, StatusCode::OK);

    let after = state.load_today_plan().expect("plan should reload");
    assert_eq!(
        after.revisions.len(),
        revisions_before + 1,
        "the whole batch must produce exactly one new revision"
    );

    let active = after.active_revision().expect("revision should exist");
    let fresh = active
        .blocks
        .iter()
        .find(|block| block.label == "Fresh (renamed)")
        .expect("created block should carry the batch-internal update");
    assert_eq!(
        fresh.status,
        deepblock_server::models::BlockStatus::Confirmed
    );
    assert_eq!(fresh.focus_rating, Some(4));
    assert_eq!(fresh.duration, 45);
    assert_eq!(
        fresh.id.len(),
        8,
        "created block must have a server-generated id"
    );

    let labels: Vec<&str> = active.blocks.iter().map(|b| b.label.as_str()).collect();
    assert!(labels.contains(&"Fresh (renamed)"));
    assert!(labels.contains(&"Keep"), "unrelated block survives");
    assert!(!labels.contains(&"Drop"), "deleted block is gone");

    let history = state.load_history(&today_string()).expect("history loads");
    assert_eq!(
        history.undo.len(),
        3,
        "three writes: two seeds plus one batch"
    );
}

#[tokio::test]
async fn replan_batch_is_atomic_when_an_operation_fails() {
    let temp_dir = tempdir().expect("tempdir should be created");
    let state = AppState::for_test(temp_dir.path());
    let app = app(state.clone());

    seed_block(&app, "Keep", "08:00").await;
    let before = state.load_today_plan().expect("plan should load");
    let revisions_before = before.revisions.len();

    let (response_status, _) = request(&app, "POST", "/plan/replan", Some(serde_json::json!({
                        "reason": "Broken batch",
                        "operations": [
                            {"op": "delete", "block_id": "nonexistent"},
                            {"op": "create", "label": "Never", "start": "10:00", "duration": 30, "type": "focus"}
                        ]
                    }))).await;

    assert_eq!(response_status, StatusCode::NOT_FOUND);

    let after = state.load_today_plan().expect("plan should reload");
    assert_eq!(after.revisions.len(), revisions_before);
    let labels: Vec<&str> = after
        .active_revision()
        .expect("revision should exist")
        .blocks
        .iter()
        .map(|b| b.label.as_str())
        .collect();
    assert!(
        !labels.contains(&"Never"),
        "failed batch must not persist anything"
    );
}
