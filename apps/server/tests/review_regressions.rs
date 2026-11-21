use axum::{
    Router,
    body::Body,
    http::{Request, StatusCode},
};
use deepblock_server::{app, state::AppState};
use serde_json::{Value, json};
use tempfile::tempdir;
use tower::ServiceExt;

mod common;
use common::request;

#[tokio::test]
async fn activitywatch_status_reports_backend_availability_without_a_native_shell() {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .expect("listener");
    let address = listener.local_addr().expect("address");
    let upstream = Router::new().route(
        "/api/0/info",
        axum::routing::get(|| async { StatusCode::OK }),
    );
    let server =
        tokio::spawn(async move { axum::serve(listener, upstream).await.expect("upstream") });
    let dir = tempdir().expect("tempdir");
    let state = AppState::for_test(dir.path());
    state.settings.write().await.activitywatch.url = format!("http://{address}");
    let app = app(state.clone());
    let (status, value) = request(&app, "GET", "/activitywatch/status", None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(value["available"], true);
    assert_eq!(value["enabled"], true);
    state.settings.write().await.activitywatch.enabled = false;
    let (_, value) = request(&app, "GET", "/activitywatch/status", None).await;
    assert_eq!(value["available"], false);
    assert_eq!(value["enabled"], false);
    server.abort();
}

#[tokio::test]
async fn first_draft_can_commit_against_an_empty_unpersisted_plan() {
    let dir = tempdir().expect("tempdir");
    let app = app(AppState::for_test(dir.path()));
    let (_, plan) = request(&app, "GET", "/plan/today", None).await;
    let (status, saved) = request(&app, "POST", "/plan/replan", Some(json!({"base_revision":plan["revisions"][0],"operations":[{"op":"create","label":"First","start":"09:00","duration":30}]}))).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(saved["revisions"].as_array().expect("revisions").len(), 1);
    assert_eq!(saved["revisions"][0]["id"], "A");
    let (_, revised) = request(&app, "POST", "/plan/replan", Some(json!({"base_revision":saved["revisions"][0],"operations":[{"op":"update","block_id":saved["revisions"][0]["blocks"][0]["id"],"start":"10:00"}]}))).await;
    assert_eq!(revised["revisions"][0], saved["revisions"][0]);
    assert_eq!(revised["revisions"][1]["id"], "B");
}

#[tokio::test]
async fn default_comparison_uses_the_first_committed_plan_and_preserves_legacy_history() {
    use deepblock_server::models::{AddBlockRequest, Block, DayPlan};
    let dir = tempdir().expect("tempdir");
    let state = AppState::for_test(dir.path());
    let mut plan = DayPlan::new("2026-07-26");
    let mut first = plan.revisions[0].clone();
    first.id = "B".into();
    first.blocks.push(Block::from_request(
        AddBlockRequest {
            label: "Work".into(),
            start: "09:00".into(),
            duration: 60,
            ..Default::default()
        },
        &[],
    ));
    let mut later = first.clone();
    later.id = "C".into();
    later.blocks[0].start = "10:00".into();
    later.blocks[0].actual_duration = Some(95);
    later.blocks[0]
        .metadata
        .insert("outcome_completed".into(), json!(true));
    plan.revisions.extend([first, later]);
    state.save_plan(&plan).expect("legacy plan");
    let app = app(state.clone());
    let (_, comparison) = request(&app, "GET", "/plan/compare?date=2026-07-26", None).await;
    assert_eq!(comparison["base_revision"], "B");
    assert_eq!(comparison["summary"], "0 added, 0 removed, 1 modified");
    assert_eq!(
        comparison["modified"][0]["details"]["actual_duration"]["after"],
        95
    );
    assert_eq!(
        comparison["modified"][0]["details"]["completed"]["after"],
        true
    );
    let (_, explicit) = request(
        &app,
        "GET",
        "/plan/compare?date=2026-07-26&base=A&compare=B",
        None,
    )
    .await;
    assert_eq!(explicit["base_revision"], "A");
    assert_eq!(explicit["added"].as_array().expect("added").len(), 1);
    assert_eq!(state.load_plan("2026-07-26").expect("unchanged plan"), plan);
}

#[tokio::test]
async fn historical_outcomes_do_not_rewrite_scheduling_intent_or_append_revisions() {
    use deepblock_server::models::{AddBlockRequest, Block, DayPlan, RevisionStrategy};
    let dir = tempdir().expect("tempdir");
    let state = AppState::for_test(dir.path());
    state.settings.write().await.client.revision.strategy = RevisionStrategy::EveryChange;
    let mut plan = DayPlan::new("2020-01-02");
    let mut block = Block::from_request(
        AddBlockRequest {
            label: "Work".into(),
            start: "09:00".into(),
            duration: 60,
            ..Default::default()
        },
        &[],
    );
    block.metadata.insert("project".into(), json!("DeepBlock"));
    plan.revisions[0].blocks.push(block.clone());
    state.save_plan(&plan).expect("plan");
    let app = app(state.clone());
    let uri = format!("/blocks/{}/outcome?date=2020-01-02", block.id);
    let (status, saved) = request(
        &app,
        "PATCH",
        &uri,
        Some(json!({"actual_duration":95,"focus_rating":3,"completed":true})),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(saved["revisions"].as_array().expect("revisions").len(), 1);
    let after = &saved["revisions"][0]["blocks"][0];
    for field in ["label", "start", "duration", "type", "status", "created_at"] {
        assert_eq!(
            after[field],
            serde_json::to_value(&block).expect("block")[field],
            "{field} is scheduling intent"
        );
    }
    assert_eq!(after["metadata"]["project"], "DeepBlock");
    assert_eq!(after["metadata"]["outcome_completed"], true);
    assert_eq!(after["actual_duration"], 95);
    assert_eq!(after["focus_rating"], 3);
    let (_, review) = request(&app, "GET", "/plan/review?date=2020-01-02", None).await;
    assert_eq!(review["summary"]["observed_blocks"], 1);
    let (status, cleared) = request(
        &app,
        "PATCH",
        &uri,
        Some(json!({"actual_duration":null,"focus_rating":null,"completed":null})),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        cleared["revisions"][0]["blocks"][0]["actual_duration"],
        Value::Null
    );
    assert!(
        cleared["revisions"][0]["blocks"][0]["metadata"]
            .get("outcome_completed")
            .is_none()
    );
    let (status, _) = request(&app, "PATCH", &uri, Some(json!({"actual_duration":0}))).await;
    assert_eq!(status, StatusCode::OK);
    let (_, review) = request(&app, "GET", "/plan/review?date=2020-01-02", None).await;
    assert_eq!(
        review["summary"]["observed_blocks"], 1,
        "an explicit self-reported zero is evidence"
    );
}

#[tokio::test]
async fn outcomes_reject_invalid_evidence_and_scheduling_fields_without_writing() {
    use deepblock_server::models::{AddBlockRequest, Block, DayPlan};
    let dir = tempdir().expect("tempdir");
    let state = AppState::for_test(dir.path());
    let mut plan = DayPlan::new("2020-01-02");
    plan.revisions[0].blocks.push(Block::from_request(
        AddBlockRequest {
            label: "Work".into(),
            start: "09:00".into(),
            duration: 60,
            ..Default::default()
        },
        &[],
    ));
    state.save_plan(&plan).expect("plan");
    let app = app(state.clone());
    let uri = format!(
        "/blocks/{}/outcome?date=2020-01-02",
        plan.revisions[0].blocks[0].id
    );
    for payload in [
        json!({"actual_duration":1441}),
        json!({"actual_duration":-1}),
        json!({"focus_rating":0}),
        json!({"focus_rating":6}),
        json!({"start":"10:00"}),
        json!({"duration":30}),
        json!({"status":"done"}),
        json!({"force_revision":true}),
    ] {
        let (status, _) = request(&app, "PATCH", &uri, Some(payload)).await;
        assert!(status.is_client_error(), "{status}");
        assert_eq!(state.load_plan("2020-01-02").expect("plan"), plan);
    }
}

#[tokio::test]
async fn future_days_and_cancelled_blocks_cannot_receive_outcomes() {
    use deepblock_server::models::{AddBlockRequest, Block, BlockStatus, DayPlan};
    let dir = tempdir().expect("tempdir");
    let state = AppState::for_test(dir.path());
    let app = app(state.clone());
    for (date, status) in [
        ("2099-01-02", BlockStatus::Proposed),
        ("2020-01-02", BlockStatus::Cancelled),
    ] {
        let mut plan = DayPlan::new(date);
        plan.revisions[0].blocks.push(Block::from_request(
            AddBlockRequest {
                label: "Work".into(),
                start: "09:00".into(),
                duration: 60,
                status,
                ..Default::default()
            },
            &[],
        ));
        state.save_plan(&plan).expect("plan");
        let uri = format!(
            "/blocks/{}/outcome?date={date}",
            plan.revisions[0].blocks[0].id
        );
        let (response, _) = request(&app, "PATCH", &uri, Some(json!({"actual_duration":30}))).await;
        assert_eq!(response, StatusCode::BAD_REQUEST);
        assert_eq!(state.load_plan(date).expect("unchanged plan"), plan);
    }
}

#[tokio::test]
async fn stale_batch_base_is_rejected_without_overwriting_newer_values() {
    let dir = tempdir().expect("tempdir");
    let state = AppState::for_test(dir.path());
    let app = app(state.clone());
    let (_, before) = request(
        &app,
        "POST",
        "/blocks",
        Some(json!({"label":"Work","start":"09:00","duration":30,"focus_rating":1})),
    )
    .await;
    let base = before["revisions"][0].clone();
    let id = base["blocks"][0]["id"].clone();
    request(
        &app,
        "PATCH",
        &format!("/blocks/{}", id.as_str().expect("id")),
        Some(json!({"focus_rating":5})),
    )
    .await;
    let current = state.load_today_plan().expect("plan");
    let history = state.load_history(&current.date).expect("history");
    let (status, _) = request(&app, "POST", "/plan/replan", Some(json!({"base_revision":base,"operations":[{"op":"update","block_id":id,"focus_rating":1}]}))).await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(state.load_today_plan().expect("plan"), current);
    assert_eq!(state.load_history(&current.date).expect("history"), history);
}

#[tokio::test]
async fn audit_does_not_hold_the_plan_lock_while_waiting_for_upstream() {
    use axum::routing::get;
    let entered = std::sync::Arc::new(tokio::sync::Notify::new());
    let release = std::sync::Arc::new(tokio::sync::Notify::new());
    let upstream = Router::new().route(
        "/api/0/info",
        get({
            let entered = entered.clone();
            let release = release.clone();
            move || {
                let entered = entered.clone();
                let release = release.clone();
                async move {
                    entered.notify_one();
                    release.notified().await;
                    StatusCode::SERVICE_UNAVAILABLE
                }
            }
        }),
    );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .expect("listener");
    let address = listener.local_addr().expect("address");
    let server =
        tokio::spawn(async move { axum::serve(listener, upstream).await.expect("upstream") });
    let dir = tempdir().expect("tempdir");
    let state = AppState::for_test(dir.path());
    state.settings.write().await.activitywatch.url = format!("http://{address}");
    let app = app(state.clone());
    let audit_app = app.clone();
    let audit = tokio::spawn(async move { request(&audit_app, "POST", "/plan/audit", None).await });
    entered.notified().await;
    let mutation = tokio::time::timeout(
        std::time::Duration::from_millis(300),
        request(
            &app,
            "POST",
            "/blocks",
            Some(json!({"label":"During audit","start":"09:00","duration":30})),
        ),
    )
    .await;
    release.notify_one();
    audit.await.expect("audit");
    server.abort();
    assert_eq!(
        mutation
            .expect("mutations must not wait for ActivityWatch")
            .0,
        StatusCode::OK
    );
    assert_eq!(
        state.load_today_plan().expect("plan").revisions[0]
            .blocks
            .len(),
        1,
        "audit must not overwrite concurrent edits"
    );
}

#[tokio::test]
async fn create_preserves_optional_accountability_fields() {
    let dir = tempdir().expect("tempdir");
    let app = app(AppState::for_test(dir.path()));
    let (status, plan) = request(&app, "POST", "/blocks", Some(json!({"label":"Complete","start":"09:00","duration":30,"status":"done","focus_rating":4,"actual_duration":35,"next_action":"Ship","content_path":"work.md"}))).await;
    assert_eq!(status, StatusCode::OK);
    let block = &plan["revisions"][0]["blocks"][0];
    assert_eq!(block["status"], "done");
    assert_eq!(block["focus_rating"], 4);
    assert_eq!(block["actual_duration"], 35);
    assert_eq!(block["next_action"], "Ship");
    assert_eq!(block["content_path"], "work.md");
}

#[tokio::test]
async fn schedule_changes_invalidate_reality_only_in_the_new_head() {
    let dir = tempdir().expect("tempdir");
    let state = AppState::for_test(dir.path());
    let app = app(state.clone());
    request(
        &app,
        "POST",
        "/blocks",
        Some(json!({"label":"A","start":"09:00","duration":60})),
    )
    .await;
    request(
        &app,
        "POST",
        "/blocks",
        Some(json!({"label":"B","start":"10:00","duration":60})),
    )
    .await;
    let mut plan = state.load_today_plan().expect("plan");
    for block in &mut plan.revisions[0].blocks {
        block.reality = Some(Default::default());
    }
    state.save_plan(&plan).expect("seed reality");
    let id = plan.revisions[0].blocks[0].id.clone();
    let (_, updated) = request(
        &app,
        "PATCH",
        &format!("/blocks/{id}"),
        Some(json!({"start":"10:00","force_revision":true})),
    )
    .await;
    assert!(
        updated["revisions"][0]["blocks"][0]["reality"].is_object(),
        "old intent retains its audit"
    );
    for block in updated["revisions"][1]["blocks"]
        .as_array()
        .expect("blocks")
    {
        assert!(
            block["reality"].is_null(),
            "moved and displaced blocks must be re-audited"
        );
    }
}

#[tokio::test]
async fn batch_change_log_records_accountability_fields() {
    let dir = tempdir().expect("tempdir");
    let app = app(AppState::for_test(dir.path()));
    let (_, plan) = request(
        &app,
        "POST",
        "/blocks",
        Some(json!({"label":"Work","start":"09:00","duration":60})),
    )
    .await;
    let id = plan["revisions"][0]["blocks"][0]["id"].clone();
    let (_, plan) = request(&app, "POST", "/plan/replan", Some(json!({"operations":[{"op":"update","block_id":id,"type":"focus","status":"done","focus_rating":4,"actual_duration":75,"next_action":"Ship","content_path":"work.md","metadata":{"project":"P"},"artifacts":["proof"]}]}))).await;
    let details = &plan["change_log"]
        .as_array()
        .expect("log")
        .last()
        .expect("entry")["details"];
    for field in [
        "type",
        "status",
        "focus_rating",
        "actual_duration",
        "next_action",
        "content_path",
        "metadata",
        "artifacts",
    ] {
        assert!(details.get(field).is_some(), "missing {field}");
    }
}

#[tokio::test]
async fn batch_label_edits_do_not_displace_unchanged_schedules() {
    let dir = tempdir().expect("tempdir");
    let app = app(AppState::for_test(dir.path()));
    request(
        &app,
        "POST",
        "/blocks",
        Some(json!({"label":"A","start":"09:00","duration":60})),
    )
    .await;
    let (_, plan) = request(
        &app,
        "POST",
        "/blocks",
        Some(json!({"label":"B","start":"09:00","duration":60})),
    )
    .await;
    let id = plan["revisions"][0]["blocks"][0]["id"].clone();
    let (status, plan) = request(&app, "POST", "/plan/replan", Some(json!({"operations":[{"op":"update","block_id":id,"label":"A renamed","start":"09:00","duration":60}]}))).await;
    assert_eq!(status, StatusCode::OK);
    for block in plan["revisions"]
        .as_array()
        .expect("revisions")
        .last()
        .expect("head")["blocks"]
        .as_array()
        .expect("blocks")
    {
        assert_eq!(block["start"], "09:00");
    }
}

#[tokio::test]
async fn calendar_inputs_are_real_dates_and_canonical_times() {
    let dir = tempdir().expect("tempdir");
    let app = app(AppState::for_test(dir.path()));
    for date in ["2026-99-99", "2026-02-29", "2026-04-31"] {
        assert_eq!(
            request(&app, "GET", &format!("/plan/{date}"), None).await.0,
            StatusCode::BAD_REQUEST,
            "{date}"
        );
    }
    assert_eq!(
        request(&app, "GET", "/plan/2024-02-29", None).await.0,
        StatusCode::OK
    );
    for start in ["9:00", "09:0", "+9:00", "09:60"] {
        assert_eq!(
            request(
                &app,
                "POST",
                "/blocks",
                Some(json!({"label":"Invalid", "start":start,"duration":30}))
            )
            .await
            .0,
            StatusCode::BAD_REQUEST,
            "{start}"
        );
    }
}

#[tokio::test]
async fn nullable_block_fields_can_be_cleared_without_affecting_omitted_fields() {
    let dir = tempdir().expect("tempdir");
    let app = app(AppState::for_test(dir.path()));
    let (_, plan) = request(
        &app,
        "POST",
        "/blocks",
        Some(json!({"label":"Clear", "start":"09:00", "duration":30})),
    )
    .await;
    let id = plan["revisions"][0]["blocks"][0]["id"]
        .as_str()
        .expect("id");
    for batch in [false, true] {
        let fields = json!({"focus_rating":4,"actual_duration":35,"next_action":"old","content_path":"old.md","artifacts":["proof"]});
        request(&app, "PATCH", &format!("/blocks/{id}"), Some(fields)).await;
        let clear = json!({"focus_rating":null,"actual_duration":null,"next_action":null,"content_path":null,"artifacts":null});
        let (status, plan) = if batch {
            let mut operation = clear;
            operation["op"] = json!("update");
            operation["block_id"] = json!(id);
            request(
                &app,
                "POST",
                "/plan/replan",
                Some(json!({"operations":[operation]})),
            )
            .await
        } else {
            request(&app, "PATCH", &format!("/blocks/{id}"), Some(clear)).await
        };
        assert_eq!(status, StatusCode::OK);
        let block = plan["revisions"]
            .as_array()
            .expect("revisions")
            .last()
            .expect("head")["blocks"][0]
            .clone();
        for field in [
            "focus_rating",
            "actual_duration",
            "next_action",
            "content_path",
        ] {
            assert!(block[field].is_null(), "{field}: {}", block[field]);
        }
        assert_eq!(block["artifacts"], json!([]));
        assert_eq!(block["label"], "Clear");
    }
    let serialized = serde_json::to_value(deepblock_server::models::UpdateBlockRequest::default())
        .expect("serialize");
    assert!(
        serialized.get("next_action").is_none(),
        "CLI omissions must not serialize as explicit clears"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn concurrent_config_patches_preserve_independent_fields() {
    let dir = tempdir().expect("tempdir");
    let state = AppState::for_test(dir.path());
    let app = app(state.clone());
    for _ in 0..20 {
        request(
            &app,
            "PATCH",
            "/config",
            Some(json!({"notify_minutes_before":5,"toast_duration_ms":4000})),
        )
        .await;
        let guard = state.settings.write().await;
        let a = app.clone();
        let b = app.clone();
        let a = tokio::spawn(async move {
            request(
                &a,
                "PATCH",
                "/config",
                Some(json!({"notify_minutes_before":9})),
            )
            .await
        });
        let b = tokio::spawn(async move {
            request(
                &b,
                "PATCH",
                "/config",
                Some(json!({"toast_duration_ms":9000})),
            )
            .await
        });
        tokio::task::yield_now().await;
        drop(guard);
        assert_eq!(a.await.expect("patch").0, StatusCode::OK);
        assert_eq!(b.await.expect("patch").0, StatusCode::OK);
        let config = request(&app, "GET", "/config", None).await.1;
        assert_eq!(config["notify_minutes_before"], 9);
        assert_eq!(config["toast_duration_ms"], 9000);
        assert_eq!(
            deepblock_server::config::load_settings(&state.paths)
                .expect("disk settings")
                .as_client_config(),
            state.settings.read().await.as_client_config()
        );
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn concurrent_backlog_creations_preserve_every_task() {
    let dir = tempdir().expect("tempdir");
    let state = AppState::for_test(dir.path());
    let app = app(state.clone());
    let mut tasks = Vec::new();
    for i in 0..64 {
        let app = app.clone();
        tasks.push(tokio::spawn(async move {
            assert_eq!(
                request(
                    &app,
                    "POST",
                    "/backlog",
                    Some(json!({"label":format!("Task {i}")}))
                )
                .await
                .0,
                StatusCode::OK
            );
        }));
    }
    for task in tasks {
        task.await.expect("task");
    }
    assert_eq!(state.load_backlog().expect("backlog").len(), 64);
}

#[cfg(unix)]
#[tokio::test]
async fn failed_batch_persistence_preserves_redo() {
    let dir = tempdir().expect("tempdir");
    let state = AppState::for_test(dir.path());
    let app = app(state.clone());
    assert_eq!(
        request(
            &app,
            "POST",
            "/blocks",
            Some(json!({"label":"Redo me", "start":"09:00", "duration":30}))
        )
        .await
        .0,
        StatusCode::OK
    );
    assert_eq!(
        request(&app, "POST", "/plan/undo", None).await.0,
        StatusCode::OK
    );
    let before = state.load_today_plan().expect("plan");
    let history = state.load_history(&before.date).expect("history");
    let database =
        rusqlite::Connection::open(deepblock_server::storage::PlanningStore::path(&state.paths))
            .expect("database");
    database.execute_batch("CREATE TRIGGER fail_save BEFORE UPDATE ON days BEGIN SELECT RAISE(ABORT, 'injected disk failure'); END;").expect("inject failed transaction");
    let response = request(&app, "POST", "/plan/replan", Some(json!({"operations":[{"op":"create", "label":"Cannot save", "start":"10:00", "duration":30}]}))).await;
    database
        .execute_batch("DROP TRIGGER fail_save")
        .expect("remove fault");
    assert_eq!(response.0, StatusCode::INTERNAL_SERVER_ERROR);
    assert_eq!(state.load_today_plan().expect("plan"), before);
    assert_eq!(state.load_history(&before.date).expect("history"), history);
    assert_eq!(
        request(&app, "POST", "/plan/redo", None).await.0,
        StatusCode::OK
    );
}

#[tokio::test]
async fn foreign_host_cannot_read_local_data() {
    let dir = tempdir().expect("tempdir");
    let app = app(AppState::for_test(dir.path()));
    for host in [
        "attacker.example:8000",
        "localhost.evil:8000",
        "localhost:8000@evil.example",
    ] {
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/plan/today")
                    .header("host", host)
                    .body(Body::empty())
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(response.status(), StatusCode::FORBIDDEN, "host {host}");
    }
    for host in ["localhost:8000", "127.0.0.1:8000", "[::1]:8000"] {
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/health")
                    .header("host", host)
                    .body(Body::empty())
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(response.status(), StatusCode::OK, "host {host}");
    }
}

#[tokio::test]
async fn foreign_origin_cannot_undo_a_plan() {
    let dir = tempdir().expect("tempdir");
    let state = AppState::for_test(dir.path());
    let app = app(state.clone());
    assert_eq!(
        request(
            &app,
            "POST",
            "/blocks",
            Some(json!({"label":"Keep", "start":"09:00", "duration":30}))
        )
        .await
        .0,
        StatusCode::OK
    );
    let before = state.load_today_plan().expect("plan");
    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/plan/undo")
                .header("origin", "https://evil.example")
                .body(Body::empty())
                .expect("request"),
        )
        .await
        .expect("response");
    assert_eq!(response.status(), StatusCode::FORBIDDEN);
    assert_eq!(state.load_today_plan().expect("plan"), before);
}
