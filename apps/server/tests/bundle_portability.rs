mod common;
use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use deepblock_server::{
    app, bundle, config::Settings, history::PlanHistory, models::Block, persist, state::AppState,
};
use http_body_util::BodyExt;
use serde_json::json;
use tower::ServiceExt;

#[test]
fn digests_match_sha256_vectors_with_zero_padded_lowercase_hex() {
    for (bytes, expected) in [
        (
            b"".as_slice(),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        ),
        (
            b"abc".as_slice(),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
        ),
        (
            b"\0\xff\x80".as_slice(),
            "f742b965f156c10374bc23aea96e3a8aff8facd6fc079defeaa30219ad86f211",
        ),
    ] {
        assert_eq!(bundle::digest(bytes), expected);
    }
}

fn seed(state: &AppState) {
    let project = uuid::Uuid::new_v4().to_string();
    let goal = uuid::Uuid::new_v4().to_string();
    let catalog = serde_json::from_value(json!({"schema_version":1,"projects":[{"id":project,"name":"Personal project","ownership":"personal"}],"goals":[{"id":goal,"label":"Ship"}]})).unwrap();
    state
        .planning_store()
        .unwrap()
        .update_catalog(&Default::default(), &catalog)
        .unwrap();
    for date in ["2026-01-05", "2026-01-06"] {
        let mut plan = state.load_plan(date).unwrap();
        plan.note_path = Some(state.note_file(date).to_string_lossy().into_owned());
        let block = Block::from_request(serde_json::from_value(json!({"label":"Write","start":"09:00","duration":30,"actual_duration":0,"metadata":{"project_id":project,"goal_id":goal,"nested":{"large":9007199254740993_u64}},"artifacts":["/external/vault/note.md", state.note_file(date).to_string_lossy()],"content_path":state.note_file(date).to_string_lossy()})).unwrap(), &[]);
        plan.active_revision_mut().unwrap().blocks.push(block);
        let mut history = PlanHistory::default();
        history.snapshot(&plan);
        state.commit_plan(&plan, &history).unwrap();
        state
            .save_note(date, "# Unicode 🦀\n\n[External](../vault/doc.md)\n")
            .unwrap();
    }
    state.save_note("2026-01-07", "").unwrap(); // orphan and empty note
    persist::write_toml_file(&state.paths.config_file(), &Settings::default()).unwrap();
    state
        .planning_store()
        .unwrap()
        .save_resource(
            "backlog",
            &json!([{"id":"task","label":"Next","status":"todo"}]),
        )
        .unwrap();
}

#[test]
fn bundle_and_actual_legacy_json_files_restore_all_logical_data() {
    let dir = tempfile::tempdir().unwrap();
    let state = AppState::for_test(dir.path());
    seed(&state);
    let expected = state
        .planning_store()
        .unwrap()
        .export(&state.paths)
        .unwrap();
    let source = dir.path().join("bundle.zip");
    bundle::write(&source, &expected).unwrap();
    assert_eq!(bundle::read(&source).unwrap(), expected);
    let mut zip = zip::ZipArchive::new(std::fs::File::open(&source).unwrap()).unwrap();
    assert!(zip.by_name("notes/2026-01-07.md").is_ok());
    let mut planning = String::new();
    use std::io::Read;
    zip.by_name("planning.json")
        .unwrap()
        .read_to_string(&mut planning)
        .unwrap();
    assert!(!planning.contains("Unicode"));
    assert!(planning.contains("9007199254740993"));
    for (file, destination) in [
        (source, dir.path().join("zip-restored")),
        (
            dir.path().join("legacy.json"),
            dir.path().join("json-restored"),
        ),
    ] {
        if file.extension().unwrap() == "json" {
            persist::write_json_pretty(&file, &expected).unwrap();
        }
        deepblock_server::storage::import_new(&file, &destination).unwrap();
        let paths = deepblock_server::config::DeepBlockPaths::from_roots(
            destination.join("data/deepblock"),
            destination.join("config/deepblock"),
            destination.join("state/deepblock"),
        );
        let restored = deepblock_server::storage::PlanningStore::open(&paths).unwrap();
        let mut actual = restored.export(&paths).unwrap();
        let mut normalized = expected.clone();
        deepblock_server::replacement::retarget(&mut normalized, &paths);
        actual.managed_note_root = normalized.managed_note_root.clone();
        assert_eq!(actual, normalized);
    }
}

#[tokio::test]
async fn live_export_replace_recovery_and_stale_client_protection() {
    let dir = tempfile::tempdir().unwrap();
    let state = AppState::for_test(dir.path());
    seed(&state);
    let router = app(state.clone());
    let generation = state.planning_store().unwrap().generation().unwrap();
    let response = tokio::time::timeout(
        std::time::Duration::from_secs(5),
        router.clone().oneshot(
            Request::builder()
                .uri("/storage/export")
                .body(Body::empty())
                .unwrap(),
        ),
    )
    .await
    .expect("export must not hang")
    .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    let mut baseline = state
        .planning_store()
        .unwrap()
        .export(&state.paths)
        .unwrap();
    state.save_note("2026-01-08", "After export").unwrap();
    let mut local_settings = Settings::default();
    local_settings.client.display.start_hour = 6;
    persist::write_toml_file(&state.paths.config_file(), &local_settings).unwrap();
    let config = std::fs::read(state.paths.config_file()).unwrap();
    baseline.configuration = Some(String::from_utf8(config.clone()).unwrap());
    let preview = tokio::time::timeout(
        std::time::Duration::from_secs(5),
        router.clone().oneshot(
            Request::builder()
                .method("POST")
                .uri("/storage/import/preview")
                .body(Body::from(bytes))
                .unwrap(),
        ),
    )
    .await
    .expect("import preview must not hang")
    .unwrap();
    assert_eq!(preview.status(), StatusCode::OK);
    let preview: serde_json::Value =
        serde_json::from_slice(&preview.into_body().collect().await.unwrap().to_bytes()).unwrap();
    assert_eq!(preview["notes_removed"], json!(["2026-01-08"]));
    // A mismatched confirmation must not consume the valid staged preview.
    assert_eq!(
        common::request(
            &router,
            "POST",
            "/storage/import/commit",
            Some(json!({"preview_id":"incorrect-token"}))
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
    assert_eq!(
        common::request(
            &router,
            "POST",
            "/storage/import/commit",
            Some(json!({"preview_id":preview["preview_id"]}))
        )
        .await
        .0,
        StatusCode::OK
    );
    assert_ne!(
        state.planning_store().unwrap().generation().unwrap(),
        generation
    );
    assert_eq!(
        state
            .planning_store()
            .unwrap()
            .export(&state.paths)
            .unwrap(),
        baseline
    );
    assert_eq!(std::fs::read(state.paths.config_file()).unwrap(), config);
    assert!(state.load_note("2026-01-08").unwrap().is_none());
    for (header, status) in [
        (None, StatusCode::PRECONDITION_REQUIRED),
        (Some(generation), StatusCode::CONFLICT),
    ] {
        let mut request = Request::builder()
            .method("PUT")
            .uri("/notes/2026-01-08")
            .header("content-type", "application/json");
        if let Some(generation) = header {
            request = request.header("x-deepblock-dataset-generation", generation);
        }
        let response = tokio::time::timeout(
            std::time::Duration::from_secs(5),
            router.clone().oneshot(
                request
                    .body(Body::from(r#"{"content":"Stale write"}"#))
                    .unwrap(),
            ),
        )
        .await
        .expect("stale write must not hang")
        .unwrap();
        assert_eq!(response.status(), status);
    }
    let (status, preview) =
        common::request(&router, "POST", "/storage/recovery/preview", None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        common::request(
            &router,
            "POST",
            "/storage/import/commit",
            Some(json!({"preview_id":preview["preview_id"]}))
        )
        .await
        .0,
        StatusCode::OK
    );
    assert_eq!(
        state.load_note("2026-01-08").unwrap().as_deref(),
        Some("After export")
    );
}

#[tokio::test]
async fn changed_data_invalidates_preview_without_replacing_notes() {
    let dir = tempfile::tempdir().unwrap();
    let state = AppState::for_test(dir.path());
    seed(&state);
    let router = app(state.clone());
    let portable = state
        .planning_store()
        .unwrap()
        .export(&state.paths)
        .unwrap();
    let (status, preview) = common::request(
        &router,
        "POST",
        "/storage/import/preview",
        Some(serde_json::to_value(portable).unwrap()),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    state.save_note("2026-01-08", "New work").unwrap();
    assert_eq!(
        common::request(
            &router,
            "POST",
            "/storage/import/commit",
            Some(json!({"preview_id":preview["preview_id"]}))
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
    assert_eq!(
        state.load_note("2026-01-08").unwrap().as_deref(),
        Some("New work")
    );
}

#[test]
fn archives_reject_traversal_duplicates_and_corruption() {
    use std::io::Write;
    for names in [
        vec!["../notes/2026-01-05.md"],
        vec!["manifest.json", "manifesX.json"],
        vec!["notes/2026-01-05.md"],
    ] {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("invalid.zip");
        let mut zip = zip::ZipWriter::new(std::fs::File::create(&path).unwrap());
        for name in names {
            zip.start_file(name, zip::write::SimpleFileOptions::default())
                .unwrap();
            zip.write_all(b"{} ").unwrap();
        }
        zip.finish().unwrap();
        let bytes = std::fs::read(&path).unwrap();
        let mut bytes = bytes;
        let target = b"manifesX.json";
        for index in 0..bytes.len().saturating_sub(target.len()) {
            if &bytes[index..index + target.len()] == target {
                bytes[index..index + target.len()].copy_from_slice(b"manifest.json");
            }
        }
        std::fs::write(&path, bytes).unwrap();
        assert!(bundle::read(&path).is_err());
    }
}

#[test]
fn invalid_utf8_archive_names_are_rejected_as_bad_requests() {
    use std::io::Write;
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("invalid-name.zip");
    let name = "manifést.json";
    let mut zip = zip::ZipWriter::new(std::fs::File::create(&path).unwrap());
    zip.start_file(name, zip::write::SimpleFileOptions::default())
        .unwrap();
    zip.write_all(b"{}").unwrap();
    zip.finish().unwrap();
    let mut bytes = std::fs::read(&path).unwrap();
    let mut patched = 0;
    for offset in 0..=bytes.len() - name.len() {
        if &bytes[offset..offset + name.len()] == name.as_bytes() {
            bytes[offset + 5] = 0xff;
            patched += 1;
        }
    }
    assert_eq!(
        patched, 2,
        "Patch both local and central-directory filenames"
    );
    std::fs::write(&path, bytes).unwrap();
    assert!(matches!(
        bundle::read(&path),
        Err(deepblock_server::error::AppError::BadRequest(_))
    ));
}

#[test]
fn schema_one_upgrade_preserves_data_and_persists_generation() {
    let dir = tempfile::tempdir().unwrap();
    let state = AppState::for_test(dir.path());
    seed(&state);
    let paths = state.paths.clone();
    let expected = state.planning_store().unwrap().export(&paths).unwrap();
    drop(state);
    let connection =
        rusqlite::Connection::open(deepblock_server::storage::PlanningStore::path(&paths)).unwrap();
    connection
        .execute_batch("DROP TABLE dataset; PRAGMA user_version=1;")
        .unwrap();
    drop(connection);
    let store = deepblock_server::storage::PlanningStore::open(&paths).unwrap();
    let generation = store.generation().unwrap();
    assert_eq!(store.export(&paths).unwrap(), expected);
    drop(store);
    let store = deepblock_server::storage::PlanningStore::open(&paths).unwrap();
    assert_eq!(store.generation().unwrap(), generation);
}

#[test]
fn checksum_future_version_missing_entry_and_symlink_are_rejected() {
    use std::io::Write;
    for (version, name, symlink, declared_size) in [
        (1, "planning.json", false, 2),
        (2, "planning.json", false, 2),
        (1, "notes/2026-01-05.md", true, 2),
        (1, "planning.json", false, bundle::MAX_JSON + 1),
    ] {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("invalid.zip");
        let mut zip = zip::ZipWriter::new(std::fs::File::create(&path).unwrap());
        zip.start_file("manifest.json", zip::write::SimpleFileOptions::default())
            .unwrap();
        let manifest = json!({"bundle_version":version,"files":{name:{"size":declared_size,"sha256":"bad checksum"}}});
        zip.write_all(manifest.to_string().as_bytes()).unwrap();
        if symlink {
            zip.add_symlink(
                name,
                "../../outside",
                zip::write::SimpleFileOptions::default(),
            )
            .unwrap();
        } else {
            zip.start_file(name, zip::write::SimpleFileOptions::default())
                .unwrap();
            zip.write_all(b"{}").unwrap();
        }
        zip.finish().unwrap();
        assert!(bundle::read(&path).is_err());
    }
}
