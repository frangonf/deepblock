use deepblock_server::{
    config::DeepBlockPaths,
    history::PlanHistory,
    models::{Block, DayPlan},
    persist,
    state::AppState,
    storage::{self, PlanningStore},
};
use serde_json::json;

#[test]
fn legacy_history_metadata_and_files_survive_canonical_cutover_and_restore() {
    let root = tempfile::tempdir().unwrap();
    let state = AppState::for_test(root.path());
    let mut plan = DayPlan::new("2026-01-05");
    let mut block = Block::from_request(serde_json::from_value(json!({"label":"Legacy", "start":"09:00", "duration":60, "metadata":{"nested":{"arbitrary":[1,true,null]}}, "actual_duration":0})).unwrap(), &[]);
    block.id = "kept-id".into();
    plan.active_revision_mut().unwrap().blocks.push(block);
    plan.note_path = Some(state.note_file(&plan.date).to_string_lossy().into_owned());
    let mut history = PlanHistory::default();
    history.snapshot(&plan);
    persist::write_json_pretty(&state.paths.day_plan_file(&plan.date), &plan).unwrap();
    persist::write_json_pretty(&state.paths.history_file(&plan.date), &history).unwrap();
    state.save_note(&plan.date, "Keep this Markdown").unwrap();
    let original = std::fs::read(state.paths.day_plan_file(&plan.date)).unwrap();
    assert_eq!(state.load_plan(&plan.date).unwrap(), plan);
    assert_eq!(state.load_history(&plan.date).unwrap(), history);
    assert_eq!(
        std::fs::read(state.paths.day_plan_file(&plan.date)).unwrap(),
        original
    );
    // Legacy files are no longer writable authority after activation.
    std::fs::write(state.paths.day_plan_file(&plan.date), "stale JSON").unwrap();
    assert_eq!(state.load_plan(&plan.date).unwrap(), plan);
    let portable = state
        .planning_store()
        .unwrap()
        .export(&state.paths)
        .unwrap();
    let destination = root.path().join("restored");
    storage::restore_new(&destination, portable.clone()).unwrap();
    let restored = AppState::new(
        DeepBlockPaths::from_roots(
            destination.join("data/deepblock"),
            destination.join("config/deepblock"),
            destination.join("state/deepblock"),
        ),
        Default::default(),
    );
    let mut restored_plan = restored.load_plan(&plan.date).unwrap();
    assert_eq!(
        restored_plan.note_path,
        Some(
            restored
                .note_file(&plan.date)
                .to_string_lossy()
                .into_owned()
        )
    );
    restored_plan.note_path = plan.note_path.clone();
    assert_eq!(restored_plan, plan);
    assert_eq!(
        restored.load_note(&plan.date).unwrap().as_deref(),
        Some("Keep this Markdown")
    );
    assert_eq!(
        restored
            .planning_store()
            .unwrap()
            .export(&restored.paths)
            .unwrap()
            .intents,
        portable.intents
    );
    let backup = root.path().join("backup");
    storage::backup_offline(&state.paths, &backup).unwrap();
    storage::restore_backup(&backup, &root.path().join("backup-restored")).unwrap();
}

#[test]
fn invalid_migration_never_activates_and_retry_preserves_originals() {
    let root = tempfile::tempdir().unwrap();
    let state = AppState::for_test(root.path());
    let file = state.paths.day_plan_file("2026-01-05");
    std::fs::write(&file, "invalid JSON").unwrap();
    assert!(PlanningStore::open(&state.paths).is_err());
    assert!(!PlanningStore::path(&state.paths).exists());
    assert_eq!(std::fs::read_to_string(&file).unwrap(), "invalid JSON");
    persist::write_json_pretty(&file, &DayPlan::new("2026-01-05")).unwrap();
    assert!(PlanningStore::open(&state.paths).is_ok());
}

#[test]
fn future_schema_fails_closed_and_portability_refuses_an_owned_root() {
    let root = tempfile::tempdir().unwrap();
    let state = AppState::for_test(root.path());
    state.load_plan("2026-01-05").unwrap();
    let connection = rusqlite::Connection::open(PlanningStore::path(&state.paths)).unwrap();
    connection.execute_batch("PRAGMA user_version=99").unwrap();
    assert!(PlanningStore::open(&state.paths).is_err());
    let owner = storage::offline_lock(&state.paths).unwrap();
    assert!(storage::export_offline(&state.paths, &root.path().join("export.json")).is_err());
    drop(owner);
}

#[test]
fn malformed_restore_does_not_publish_any_destination() {
    let root = tempfile::tempdir().unwrap();
    let paths = DeepBlockPaths::from_roots(
        root.path().join("data"),
        root.path().join("config"),
        root.path().join("state"),
    );
    let _owner = storage::offline_lock(&paths).unwrap();
    let mut portable = PlanningStore::open(&paths).unwrap().export(&paths).unwrap();
    portable.notes.insert("../../escape".into(), "bad".into());
    let destination = root.path().join("invalid-restore");
    assert!(storage::restore_new(&destination, portable).is_err());
    assert!(!destination.exists());
}

#[tokio::test]
async fn storage_requests_bypass_a_held_maintenance_write_permit() {
    use axum::body::Body;
    use axum::http::{Request, StatusCode};
    use tower::ServiceExt;

    let root = tempfile::tempdir().unwrap();
    let state = AppState::for_test(root.path());
    let router = deepblock_server::app(state);
    // Storage handlers take the exclusive maintenance permit themselves; if
    // middleware also held a shared permit for them, this export would
    // deadlock instead of coordinating its own lifetime.
    let response = tokio::time::timeout(
        std::time::Duration::from_secs(2),
        router.oneshot(
            Request::builder()
                .uri("/storage/export")
                .body(Body::empty())
                .unwrap(),
        ),
    )
    .await
    .expect("storage requests bypass maintenance coordination")
    .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
}

#[test]
fn portability_destinations_create_missing_parent_directories() {
    let root = tempfile::tempdir().unwrap();
    let state = AppState::for_test(root.path());
    let portable = state
        .planning_store()
        .unwrap()
        .export(&state.paths)
        .unwrap();
    let nested = root.path().join("missing/nested/restored");
    storage::restore_new(&nested, portable).unwrap();
    assert!(nested.exists());

    let deeper = root.path().join("missing/nested/backup");
    storage::backup_offline(&state.paths, &deeper).unwrap();
    assert!(deeper.join("manifest.json").is_file());
}

#[test]
fn export_offline_writes_json_or_bundles_by_extension() {
    let root = tempfile::tempdir().unwrap();
    let state = AppState::for_test(root.path());

    let json_path = root.path().join("export.json");
    storage::export_offline(&state.paths, &json_path).unwrap();
    let portable: deepblock_server::storage::PortablePlanning =
        serde_json::from_slice(&std::fs::read(&json_path).unwrap()).unwrap();
    assert_eq!(portable.format_version, 1);

    let zip_path = root.path().join("export.zip");
    storage::export_offline(&state.paths, &zip_path).unwrap();
    deepblock_server::bundle::read(&zip_path).expect("zip destinations hold real bundles");
}

#[test]
fn restore_backup_rejects_a_manifest_that_disagrees_with_the_database() {
    let root = tempfile::tempdir().unwrap();
    let state = AppState::for_test(root.path());
    let backup = root.path().join("backup");
    storage::backup_offline(&state.paths, &backup).unwrap();

    let manifest_path = backup.join("manifest.json");
    let mut manifest: deepblock_server::storage::PortablePlanning =
        serde_json::from_slice(&std::fs::read(&manifest_path).unwrap()).unwrap();
    manifest.days.insert(
        "2026-01-06".into(),
        deepblock_server::storage::StoredDayPlan {
            plan: DayPlan::new("2026-01-06"),
            history: None,
        },
    );
    std::fs::write(
        &manifest_path,
        serde_json::to_vec_pretty(&manifest).unwrap(),
    )
    .unwrap();

    let destination = root.path().join("from-backup");
    assert!(
        storage::restore_backup(&backup, &destination).is_err(),
        "a manifest day missing from the database is rejected"
    );
    assert!(!destination.exists());
}
