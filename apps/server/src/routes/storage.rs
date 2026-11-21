use crate::{
    bundle,
    error::{AppError, AppResult},
    replacement,
    state::AppState,
    storage::PortablePlanning,
};
use axum::{
    Json,
    body::{Body, Bytes},
    extract::{Request, State},
    http::{HeaderMap, StatusCode, header},
    response::{IntoResponse, Response},
};
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use std::{
    sync::atomic::Ordering,
    time::{Duration, Instant},
};
use tempfile::NamedTempFile;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
pub const GENERATION_HEADER: &str = "x-deepblock-dataset-generation";
pub struct PreparedImport {
    token: String,
    fingerprint: String,
    generation: String,
    created: Instant,
    file: NamedTempFile,
}
#[derive(Serialize)]
pub struct StorageStatus {
    generation: String,
    recovery_available: bool,
    unavailable: bool,
}
#[derive(Serialize)]
struct Counts {
    days: usize,
    revisions: usize,
    intent_snapshots: usize,
    backlog_items: usize,
    projects: usize,
    goals: usize,
    notes: usize,
    first_date: Option<String>,
    last_date: Option<String>,
}
#[derive(Serialize)]
pub struct Preview {
    preview_id: String,
    current: Counts,
    incoming: Counts,
    notes_added: Vec<String>,
    notes_overwritten: Vec<String>,
    notes_removed: Vec<String>,
    configuration_included: bool,
}
fn counts(value: &PortablePlanning) -> Counts {
    let catalog = value.resources.get("context");
    Counts {
        days: value.days.len(),
        revisions: value.days.values().map(|d| d.plan.revisions.len()).sum(),
        intent_snapshots: value.intents.len(),
        backlog_items: value
            .resources
            .get("backlog")
            .and_then(|v| v.as_array())
            .map_or(0, Vec::len),
        projects: catalog
            .and_then(|v| v.get("projects"))
            .and_then(|v| v.as_array())
            .map_or(0, Vec::len),
        goals: catalog
            .and_then(|v| v.get("goals"))
            .and_then(|v| v.as_array())
            .map_or(0, Vec::len),
        notes: value.notes.len(),
        first_date: value.days.keys().next().cloned(),
        last_date: value.days.keys().next_back().cloned(),
    }
}
pub async fn status(State(state): State<AppState>) -> AppResult<Json<StorageStatus>> {
    let guard = state.maintenance.clone().read_owned().await;
    state
        .io(move |s| {
            let _guard = guard;
            Ok(Json(StorageStatus {
                generation: s.planning_store()?.generation()?,
                recovery_available: replacement::recovery_path(&s.paths).exists(),
                unavailable: s.storage_unavailable.load(Ordering::SeqCst),
            }))
        })
        .await
}
fn available(state: &AppState) -> AppResult<()> {
    if state.storage_unavailable.load(Ordering::SeqCst) {
        return Err(AppError::Conflict(
            "Storage recovery is required; restart the backend before editing".into(),
        ));
    }
    Ok(())
}
fn generation_matches(headers: &HeaderMap, generation: &str) -> AppResult<()> {
    if headers.get(GENERATION_HEADER).and_then(|v| v.to_str().ok()) != Some(generation) {
        return Err(AppError::Conflict(
            "Dataset changed; reload before continuing".into(),
        ));
    }
    Ok(())
}
async fn prepare(state: AppState, file: NamedTempFile) -> AppResult<Json<Preview>> {
    // Decode outside the maintenance gate so malformed archives cannot pause planning.
    let (file, incoming) = state
        .io(move |_| {
            let incoming = bundle::read(file.path())?;
            Ok((file, incoming))
        })
        .await?;
    let guard = state.maintenance.clone().write_owned().await;
    let (prepared, preview) = state
        .io(move |s| {
            let _guard = guard;
            available(&s)?;
            let store = s.planning_store()?;
            let current = store.export(&s.paths)?;
            let token = uuid::Uuid::new_v4().to_string();
            let preview = Preview {
                preview_id: token.clone(),
                current: counts(&current),
                incoming: counts(&incoming),
                notes_added: incoming
                    .notes
                    .keys()
                    .filter(|k| !current.notes.contains_key(*k))
                    .cloned()
                    .collect(),
                notes_overwritten: incoming
                    .notes
                    .keys()
                    .filter(|k| current.notes.contains_key(*k))
                    .cloned()
                    .collect(),
                notes_removed: current
                    .notes
                    .keys()
                    .filter(|k| !incoming.notes.contains_key(*k))
                    .cloned()
                    .collect(),
                configuration_included: incoming.configuration.is_some(),
            };
            Ok((
                PreparedImport {
                    token,
                    fingerprint: bundle::fingerprint(&current)?,
                    generation: store.generation()?,
                    created: Instant::now(),
                    file,
                },
                preview,
            ))
        })
        .await?;
    *state.previews.lock().await = Some(prepared);
    Ok(Json(preview))
}
pub async fn preview(State(state): State<AppState>, request: Request) -> AppResult<Json<Preview>> {
    let _slot = state
        .import_slots
        .clone()
        .acquire_owned()
        .await
        .map_err(|_| std::io::Error::other("Import queue closed"))?;
    // Spool the upload; do not materialize a potentially large ZIP in the HTTP executor.
    let file = NamedTempFile::new()?;
    let mut output = tokio::fs::File::from_std(file.reopen()?);
    let mut stream = request.into_body().into_data_stream();
    let mut size = 0_u64;
    while let Some(chunk) = stream.next().await {
        let chunk =
            chunk.map_err(|_| AppError::BadRequest("Could not read uploaded file".into()))?;
        size = size
            .checked_add(chunk.len() as u64)
            .ok_or_else(|| AppError::BadRequest("Import too large".into()))?;
        if size > bundle::MAX_BUNDLE {
            return Err(AppError::BadRequest("Import exceeds 1 GiB".into()));
        }
        output.write_all(&chunk).await?;
    }
    output.flush().await?;
    drop(output);
    prepare(state, file).await
}
pub async fn recovery_preview(State(state): State<AppState>) -> AppResult<Json<Preview>> {
    let _slot = state
        .import_slots
        .clone()
        .acquire_owned()
        .await
        .map_err(|_| std::io::Error::other("Import queue closed"))?;
    let guard = state.maintenance.clone().write_owned().await;
    let file = state
        .io(move |s| {
            let _guard = guard;
            let source = replacement::recovery_path(&s.paths);
            if !source.exists() {
                return Err(AppError::NotFound("No recovery copy is available".into()));
            }
            let file = NamedTempFile::new()?;
            std::fs::copy(source, file.path())?;
            Ok(file)
        })
        .await?;
    prepare(state, file).await
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Commit {
    preview_id: String,
}
pub async fn commit(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<Commit>,
) -> AppResult<Json<serde_json::Value>> {
    let prepared = {
        let mut preview = state.previews.lock().await;
        let staged = preview
            .as_ref()
            .ok_or_else(|| AppError::Conflict("Preview expired; select the file again".into()))?;
        if staged.token != body.preview_id {
            return Err(AppError::Conflict(
                "Preview does not match; select the file again".into(),
            ));
        }
        let staged = preview
            .take()
            .ok_or_else(|| AppError::Conflict("Preview expired; select the file again".into()))?;
        if staged.created.elapsed() > Duration::from_secs(600) {
            return Err(AppError::Conflict(
                "Preview expired; select the file again".into(),
            ));
        }
        staged
    };
    let guard = state.maintenance.clone().write_owned().await;
    let generation = state
        .io(move |s| {
            let _guard = guard;
            available(&s)?;
            let store = s.planning_store()?;
            generation_matches(&headers, &store.generation()?)?;
            if store.generation()? != prepared.generation
                || bundle::fingerprint(&store.export(&s.paths)?)? != prepared.fingerprint
            {
                return Err(AppError::Conflict(
                    "Data changed since preview; preview the import again".into(),
                ));
            }
            let incoming = bundle::read(prepared.file.path())?;
            let result = replacement::replace(&s.paths, store, incoming);
            if s.paths.data_root.join("replacement.json").exists() {
                s.storage_unavailable.store(true, Ordering::SeqCst);
            }
            result
        })
        .await?;
    state.events.send_dataset_replaced(generation.clone());
    Ok(Json(serde_json::json!({"generation":generation})))
}
pub async fn export(State(state): State<AppState>) -> AppResult<Response> {
    download(state, false).await
}
pub async fn recovery(State(state): State<AppState>) -> AppResult<Response> {
    download(state, true).await
}
async fn download(state: AppState, recovery: bool) -> AppResult<Response> {
    let guard = state.maintenance.clone().write_owned().await;
    let (file, snapshot) = state
        .io(move |s| {
            let _guard = guard;
            available(&s)?;
            let file = NamedTempFile::new()?;
            if recovery {
                let source = replacement::recovery_path(&s.paths);
                if !source.exists() {
                    return Err(AppError::NotFound("No recovery copy is available".into()));
                }
                std::fs::copy(source, file.path())?;
                Ok((file, None))
            } else {
                Ok((file, Some(s.planning_store()?.export(&s.paths)?)))
            }
        })
        .await?;
    // Compress the captured snapshot after releasing the maintenance gate.
    let file = state
        .io(move |_| {
            if let Some(snapshot) = snapshot {
                let staged = tempfile::tempdir()?;
                let destination = staged.path().join("export.zip");
                bundle::write(&destination, &snapshot)?;
                std::fs::copy(destination, file.path())?;
            }
            Ok(file)
        })
        .await?;
    let reader = tokio::fs::File::from_std(file.reopen()?);
    let stream =
        futures_util::stream::try_unfold((reader, file), |(mut reader, file)| async move {
            let mut buffer = vec![0_u8; 64 * 1024];
            let count = reader.read(&mut buffer).await?;
            if count == 0 {
                Ok::<_, std::io::Error>(None)
            } else {
                buffer.truncate(count);
                Ok(Some((Bytes::from(buffer), (reader, file))))
            }
        });
    let mut response = (StatusCode::OK, Body::from_stream(stream)).into_response();
    response.headers_mut().insert(
        header::CONTENT_TYPE,
        "application/zip"
            .parse()
            .map_err(|_| std::io::Error::other("Invalid content type"))?,
    );
    response.headers_mut().insert(
        header::CONTENT_DISPOSITION,
        if recovery {
            "attachment; filename=deepblock-recovery.zip"
        } else {
            "attachment; filename=deepblock-export.zip"
        }
        .parse()
        .map_err(|_| std::io::Error::other("Invalid disposition"))?,
    );
    Ok(response)
}
