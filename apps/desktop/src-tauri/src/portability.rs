//! Narrow file-dialog bridge. Only the chosen file is read/written; the backend owns storage.
use crate::DesktopRuntimeState;
use std::io::Write;
use tauri::Manager;
use tauri_plugin_dialog::DialogExt;

async fn choose(
    app: &tauri::AppHandle,
    save: bool,
    name: &str,
) -> Result<Option<std::path::PathBuf>, String> {
    let (send, receive) = tokio::sync::oneshot::channel();
    let dialog = app
        .dialog()
        .file()
        .add_filter("DeepBlock bundle", &["zip", "json"]);
    if save {
        dialog.set_file_name(name).save_file(move |file| {
            let _ = send.send(file);
        });
    } else {
        dialog.pick_file(move |file| {
            let _ = send.send(file);
        });
    }
    receive
        .await
        .map_err(|_| "File dialog closed unexpectedly".to_string())?
        .map(|file| file.into_path().map_err(|e| e.to_string()))
        .transpose()
}
#[tauri::command]
pub async fn desktop_import_preview(
    app: tauri::AppHandle,
) -> Result<Option<serde_json::Value>, String> {
    let Some(path) = choose(&app, false, "").await? else {
        return Ok(None);
    };
    let file = tokio::fs::File::open(path)
        .await
        .map_err(|e| e.to_string())?;
    if file.metadata().await.map_err(|e| e.to_string())?.len()
        > deepblock_server::bundle::MAX_BUNDLE
    {
        return Err("Import exceeds 1 GiB".into());
    }
    let base = app.state::<DesktopRuntimeState>().api_base_url.clone();
    let response = reqwest::Client::new()
        .post(format!("{base}/storage/import/preview"))
        .header("Content-Type", "application/octet-stream")
        .body(reqwest::Body::wrap_stream(
            tokio_util::io::ReaderStream::new(file),
        ))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !response.status().is_success() {
        return Err(response
            .text()
            .await
            .unwrap_or_else(|_| "Import preview failed".into()));
    }
    response.json().await.map(Some).map_err(|e| e.to_string())
}
#[tauri::command]
pub async fn desktop_export_bundle(app: tauri::AppHandle, recovery: bool) -> Result<bool, String> {
    let name = if recovery {
        "deepblock-recovery.zip"
    } else {
        "deepblock-export.zip"
    };
    let Some(path) = choose(&app, true, name).await? else {
        return Ok(false);
    };
    let base = app.state::<DesktopRuntimeState>().api_base_url.clone();
    let mut response = reqwest::Client::new()
        .get(format!(
            "{base}/storage/{}",
            if recovery { "recovery" } else { "export" }
        ))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !response.status().is_success() {
        return Err(response
            .text()
            .await
            .unwrap_or_else(|_| "Export failed".into()));
    }
    let parent = path.parent().ok_or("Invalid destination")?;
    let staged = tempfile::NamedTempFile::new_in(parent).map_err(|e| e.to_string())?;
    let mut file = tokio::fs::File::from_std(staged.reopen().map_err(|e| e.to_string())?);
    use tokio::io::AsyncWriteExt;
    while let Some(chunk) = response.chunk().await.map_err(|e| e.to_string())? {
        file.write_all(&chunk).await.map_err(|e| e.to_string())?;
    }
    file.sync_all().await.map_err(|e| e.to_string())?;
    drop(file);
    staged.persist(&path).map_err(|e| e.error.to_string())?;
    #[cfg(unix)]
    std::fs::File::open(parent)
        .and_then(|file| file.sync_all())
        .map_err(|e| e.to_string())?;
    Ok(true)
}
#[tauri::command]
pub async fn desktop_export_drafts(app: tauri::AppHandle, content: String) -> Result<bool, String> {
    if content.len() > 16 * 1024 * 1024 {
        return Err("Draft recovery exceeds 16 MiB".into());
    }
    let Some(path) = choose(&app, true, "deepblock-unsaved-drafts.json").await? else {
        return Ok(false);
    };
    tokio::task::spawn_blocking(move || {
        let parent = path
            .parent()
            .ok_or_else(|| std::io::Error::other("Invalid destination"))?;
        let mut staged = tempfile::NamedTempFile::new_in(parent)?;
        staged.write_all(content.as_bytes())?;
        staged.as_file().sync_all()?;
        staged.persist(&path).map_err(|e| e.error)?;
        Ok::<_, std::io::Error>(true)
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())
}
