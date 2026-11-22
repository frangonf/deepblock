//! Narrow file-dialog bridge. Only the chosen file is read/written; the backend owns storage.
use crate::DesktopRuntimeState;
use std::{
    io::Write,
    net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr},
};
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
    let base = app.state::<DesktopRuntimeState>().api_base_url.clone();
    import_preview(&base, &path).await.map(Some)
}

async fn import_preview(base: &str, path: &std::path::Path) -> Result<serde_json::Value, String> {
    let invalid_endpoint = "Import preview requires a loopback HTTP(S) endpoint";
    let mut url = reqwest::Url::parse(base).map_err(|_| invalid_endpoint)?;
    if !matches!(url.scheme(), "http" | "https")
        || !url.host_str().is_some_and(|host| {
            host == "localhost"
                || host
                    .trim_matches(['[', ']'])
                    .parse::<IpAddr>()
                    .is_ok_and(|ip| ip.is_loopback())
        })
    {
        return Err(invalid_endpoint.into());
    }
    url.path_segments_mut()
        .map_err(|_| invalid_endpoint)?
        .pop_if_empty()
        .extend(["storage", "import", "preview"]);

    let file = tokio::fs::File::open(path)
        .await
        .map_err(|e| e.to_string())?;
    if file.metadata().await.map_err(|e| e.to_string())?.len()
        > deepblock_server::bundle::MAX_BUNDLE
    {
        return Err("Import exceeds 1 GiB".into());
    }
    let response = reqwest::Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .resolve_to_addrs(
            "localhost",
            &[
                SocketAddr::from((Ipv4Addr::LOCALHOST, 0)),
                SocketAddr::from((Ipv6Addr::LOCALHOST, 0)),
            ],
        )
        .build()
        .map_err(|e| e.to_string())?
        .post(url)
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
    response.json().await.map_err(|e| e.to_string())
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

#[cfg(test)]
mod tests {
    use super::import_preview;
    use std::time::Duration;
    use tokio::{
        io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
        net::TcpListener,
    };

    #[tokio::test]
    async fn import_rejects_non_loopback_http_endpoints_before_opening_the_archive() {
        let dir = tempfile::tempdir().unwrap();
        let missing_archive = dir.path().join("missing.zip");
        for base in [
            "http://example.invalid:5605",
            "http://localhost.example.invalid:5605",
            "http://localhost@example.invalid:5605",
            "http://0.0.0.0:5605",
            "http://192.0.2.1:5605",
            "http://[::]:5605",
            "ftp://127.0.0.1:5605",
            "not a URL",
        ] {
            let error = import_preview(base, &missing_archive).await.unwrap_err();
            assert_eq!(
                error, "Import preview requires a loopback HTTP(S) endpoint",
                "{base}"
            );
        }
    }

    #[tokio::test]
    async fn import_accepts_explicit_loopback_endpoints() {
        let dir = tempfile::tempdir().unwrap();
        let missing_archive = dir.path().join("missing.zip");
        let missing_error = std::fs::File::open(&missing_archive)
            .unwrap_err()
            .to_string();
        for base in [
            "http://localhost:8081",
            "http://127.0.0.2:5605",
            "https://[::1]:8443",
        ] {
            let error = import_preview(base, &missing_archive).await.unwrap_err();
            assert_eq!(error, missing_error, "{base}");
        }
    }

    #[tokio::test]
    async fn import_does_not_follow_redirects() {
        let archive = tempfile::NamedTempFile::new().unwrap();
        let listener = TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let redirect = async move {
            let (stream, _) = listener.accept().await.unwrap();
            drop(listener);
            let mut stream = BufReader::new(stream);
            let mut line = String::new();
            stream.read_line(&mut line).await.unwrap();
            assert_eq!(line, "POST /storage/import/preview HTTP/1.1\r\n");
            loop {
                line.clear();
                if stream.read_line(&mut line).await.unwrap() == 0 || line == "\r\n" {
                    break;
                }
            }
            stream.get_mut().write_all(
                b"HTTP/1.1 303 See Other\r\nLocation: /other\r\nContent-Length: 8\r\nConnection: close\r\n\r\nredirect",
            ).await.unwrap();
            stream
        };
        let (result, _connection) = tokio::time::timeout(Duration::from_secs(5), async {
            tokio::join!(import_preview(&base, archive.path()), redirect)
        })
        .await
        .unwrap();
        assert_eq!(result.unwrap_err(), "redirect");
    }
}
