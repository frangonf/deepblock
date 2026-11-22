use std::{fs, process::Command};

use anyhow::{Result, anyhow};
use deepblock_server::{
    config::{DeepBlockPaths, ServerRuntime, load_settings},
    models::{
        AddBlockRequest, ArtifactRequest, Backlog, BacklogStatus, BlockStatus, BlockType,
        ClientConfigResponse, ClientConfigUpdate, CreateBacklogTaskRequest, DayPlan,
        EnsureNoteResponse, GlobalState, HealthResponse, ModeRequest, MoveBlockRequest,
        NoteContentResponse, PlanComparisonResponse, PlanReviewResponse, RepositionBlockRequest,
        ReviseRequest, RevisionCopyMode, SaveNoteRequest, UpdateBacklogTaskRequest,
        UpdateBlockRequest, today_string,
    },
    persist,
    runtime::{DEFAULT_SERVER_URL, discover_server, storage_is_owned},
};
use reqwest::{Client, RequestBuilder};
use serde::de::DeserializeOwned;

pub struct DeepBlockClient {
    base_url: String,
    client: Client,
    generation: tokio::sync::OnceCell<String>,
}

impl DeepBlockClient {
    async fn send_json<T: DeserializeOwned>(&self, request: RequestBuilder) -> Result<T> {
        let generation = self
            .generation
            .get_or_try_init(|| async {
                let value: serde_json::Value = self
                    .client
                    .get(format!("{}/storage/status", self.base_url))
                    .send()
                    .await?
                    .error_for_status()?
                    .json()
                    .await?;
                value["generation"]
                    .as_str()
                    .map(str::to_owned)
                    .ok_or_else(|| {
                        anyhow!("Backend does not expose dataset generation; update the backend")
                    })
            })
            .await?;
        let response = request
            .header("x-deepblock-dataset-generation", generation)
            .send()
            .await?
            .error_for_status()?;
        if response
            .headers()
            .get("x-deepblock-dataset-generation")
            .and_then(|v| v.to_str().ok())
            .is_some_and(|value| value != generation)
        {
            return Err(anyhow!("Dataset changed; rerun the command"));
        }
        Ok(response.json().await?)
    }

    pub async fn outcome(
        &self,
        block_id: &str,
        date: &str,
        request: &deepblock_server::models::BlockOutcomeRequest,
    ) -> Result<DayPlan> {
        self.send_json(
            self.client
                .patch(format!("{}/blocks/{block_id}/outcome", self.base_url))
                .query(&[("date", date)])
                .json(request),
        )
        .await
    }
    pub fn new(base_url: String) -> Self {
        Self {
            base_url,
            client: Client::new(),
            generation: tokio::sync::OnceCell::new(),
        }
    }

    pub async fn health(&self) -> Result<HealthResponse> {
        Ok(self
            .client
            .get(format!("{}/health", self.base_url))
            .send()
            .await?
            .error_for_status()?
            .json()
            .await?)
    }

    pub async fn get_plan(&self, date: Option<&str>) -> Result<DayPlan> {
        let path = if let Some(date) = date {
            format!("{}/plan/{date}", self.base_url)
        } else {
            format!("{}/plan/today", self.base_url)
        };

        self.send_json(self.client.get(path)).await
    }

    pub async fn add_block(
        &self,
        label: String,
        start: String,
        duration: u16,
        block_type: String,
    ) -> Result<DayPlan> {
        let request = AddBlockRequest {
            label,
            start,
            duration,
            block_type: parse_block_type(&block_type)?,
            ..Default::default()
        };

        self.send_json(
            self.client
                .post(format!("{}/blocks", self.base_url))
                .json(&request),
        )
        .await
    }

    pub async fn delete_block(&self, block_id: &str) -> Result<DayPlan> {
        self.send_json(
            self.client
                .delete(format!("{}/blocks/{block_id}", self.base_url)),
        )
        .await
    }

    pub async fn edit_block(&self, block_id: &str, request: UpdateBlockRequest) -> Result<DayPlan> {
        self.send_json(
            self.client
                .patch(format!("{}/blocks/{block_id}", self.base_url))
                .json(&request),
        )
        .await
    }

    pub async fn move_block(&self, block_id: &str, direction: String) -> Result<DayPlan> {
        let direction = match direction.as_str() {
            "up" => -1,
            "down" => 1,
            _ => return Err(anyhow!("invalid direction: {direction}")),
        };

        self.send_json(
            self.client
                .patch(format!("{}/blocks/{block_id}/move", self.base_url))
                .json(&MoveBlockRequest { direction }),
        )
        .await
    }

    pub async fn reposition_block(&self, block_id: &str, start: String) -> Result<DayPlan> {
        self.send_json(
            self.client
                .patch(format!("{}/blocks/{block_id}/reposition", self.base_url))
                .json(&RepositionBlockRequest { start }),
        )
        .await
    }

    pub async fn add_artifact(&self, block_id: &str, artifact: String) -> Result<DayPlan> {
        self.send_json(
            self.client
                .post(format!("{}/blocks/{block_id}/artifacts", self.base_url))
                .json(&ArtifactRequest { artifact }),
        )
        .await
    }

    pub async fn remove_artifact(&self, block_id: &str, artifact: String) -> Result<DayPlan> {
        self.send_json(
            self.client
                .delete(format!("{}/blocks/{block_id}/artifacts", self.base_url))
                .query(&[("artifact", artifact)]),
        )
        .await
    }

    pub async fn revise(
        &self,
        reason: Option<String>,
        copy_mode: Option<String>,
    ) -> Result<DayPlan> {
        let request = ReviseRequest {
            reason,
            copy_future_blocks: true,
            copy_mode: copy_mode.as_deref().map(parse_copy_mode).transpose()?,
        };

        self.send_json(
            self.client
                .post(format!("{}/plan/revise", self.base_url))
                .json(&request),
        )
        .await
    }

    pub async fn compare(
        &self,
        base: Option<String>,
        compare: Option<String>,
    ) -> Result<PlanComparisonResponse> {
        let mut request = self.client.get(format!("{}/plan/compare", self.base_url));
        if let Some(base) = base {
            request = request.query(&[("base", base)]);
        }
        if let Some(compare) = compare {
            request = request.query(&[("compare", compare)]);
        }

        self.send_json(request).await
    }

    pub async fn undo(&self) -> Result<DayPlan> {
        self.send_json(self.client.post(format!("{}/plan/undo", self.base_url)))
            .await
    }

    pub async fn redo(&self) -> Result<DayPlan> {
        self.send_json(self.client.post(format!("{}/plan/redo", self.base_url)))
            .await
    }

    pub async fn get_mode(&self) -> Result<GlobalState> {
        self.send_json(self.client.get(format!("{}/mode", self.base_url)))
            .await
    }

    pub async fn set_mode(&self, mode: String) -> Result<GlobalState> {
        self.send_json(
            self.client
                .post(format!("{}/mode", self.base_url))
                .json(&ModeRequest {
                    mode: parse_mode(&mode)?,
                }),
        )
        .await
    }

    pub async fn audit(&self) -> Result<DayPlan> {
        self.send_json(self.client.post(format!("{}/plan/audit", self.base_url)))
            .await
    }

    pub async fn review(&self) -> Result<PlanReviewResponse> {
        self.send_json(self.client.get(format!("{}/plan/review", self.base_url)))
            .await
    }

    pub async fn ensure_note(&self) -> Result<EnsureNoteResponse> {
        self.send_json(self.client.post(format!("{}/notes/ensure", self.base_url)))
            .await
    }

    pub async fn get_note(&self, date: Option<&str>) -> Result<NoteContentResponse> {
        let date = date.map(ToOwned::to_owned).unwrap_or_else(today_string);

        self.send_json(self.client.get(format!("{}/notes/{date}", self.base_url)))
            .await
    }

    pub async fn save_note(
        &self,
        date: Option<&str>,
        content: String,
    ) -> Result<NoteContentResponse> {
        let date = date.map(ToOwned::to_owned).unwrap_or_else(today_string);

        self.send_json(
            self.client
                .put(format!("{}/notes/{date}", self.base_url))
                .json(&SaveNoteRequest { content }),
        )
        .await
    }

    pub async fn get_backlog(&self) -> Result<Vec<Backlog>> {
        self.send_json(self.client.get(format!("{}/backlog", self.base_url)))
            .await
    }

    pub async fn add_backlog_task(&self, label: String) -> Result<Vec<Backlog>> {
        self.send_json(
            self.client
                .post(format!("{}/backlog", self.base_url))
                .json(&CreateBacklogTaskRequest { label }),
        )
        .await
    }

    pub async fn update_backlog_task(&self, task_id: &str, status: String) -> Result<Vec<Backlog>> {
        self.send_json(
            self.client
                .patch(format!("{}/backlog/{task_id}", self.base_url))
                .json(&UpdateBacklogTaskRequest {
                    status: parse_backlog_status(&status)?,
                }),
        )
        .await
    }

    pub async fn delete_backlog_task(&self, task_id: &str) -> Result<Vec<Backlog>> {
        self.send_json(
            self.client
                .delete(format!("{}/backlog/{task_id}", self.base_url)),
        )
        .await
    }

    pub async fn get_config(&self) -> Result<ClientConfigResponse> {
        self.send_json(self.client.get(format!("{}/config", self.base_url)))
            .await
    }

    pub async fn patch_config(&self, request: ClientConfigUpdate) -> Result<ClientConfigResponse> {
        self.send_json(
            self.client
                .patch(format!("{}/config", self.base_url))
                .json(&request),
        )
        .await
    }

    pub fn ui_url(&self) -> String {
        std::env::var("DEEPBLOCK_WEB_URL")
            .unwrap_or_else(|_| "http://127.0.0.1:5173/planner".to_string())
    }

    pub fn open_ui(&self) -> Result<()> {
        let url = self.ui_url();
        #[cfg(target_os = "macos")]
        {
            Command::new("open").arg(&url).status()?;
            return Ok(());
        }
        #[cfg(target_os = "linux")]
        {
            Command::new("xdg-open").arg(&url).status()?;
            return Ok(());
        }
        #[cfg(target_os = "windows")]
        {
            Command::new("cmd")
                .args(["/C", "start", "", &url])
                .status()?;
            return Ok(());
        }
        #[allow(unreachable_code)]
        Err(anyhow!(
            "opening the UI is not supported on this platform yet"
        ))
    }
}

pub async fn resolve_base_url(explicit: Option<String>) -> Result<String> {
    if let Some(url) = explicit {
        return Ok(normalize_base_url(url));
    }

    let paths = DeepBlockPaths::resolve()?;

    if let Some(url) = discover_server(&paths, None).await? {
        return Ok(url);
    }
    Ok(if paths.config_file().exists() {
        load_settings(&paths)?
            .server
            .with_env_overrides()
            .base_url()
    } else {
        DEFAULT_SERVER_URL.to_string()
    })
}

fn normalize_base_url(url: String) -> String {
    url.trim_end_matches('/').to_string()
}

pub fn parse_block_type(value: &str) -> Result<BlockType> {
    match value {
        "focus" => Ok(BlockType::Focus),
        "shallow" => Ok(BlockType::Shallow),
        "urgent" => Ok(BlockType::Urgent),
        "break" => Ok(BlockType::Break),
        _ => Err(anyhow!("invalid block type: {value}")),
    }
}

fn parse_copy_mode(value: &str) -> Result<RevisionCopyMode> {
    match value {
        "all" => Ok(RevisionCopyMode::All),
        "from_now" => Ok(RevisionCopyMode::FromNow),
        "empty" => Ok(RevisionCopyMode::Empty),
        _ => Err(anyhow!("invalid copy mode: {value}")),
    }
}

fn parse_mode(value: &str) -> Result<deepblock_server::models::InteractionMode> {
    match value {
        "focus" => Ok(deepblock_server::models::InteractionMode::Focus),
        "reflect" => Ok(deepblock_server::models::InteractionMode::Reflect),
        _ => Err(anyhow!("invalid mode: {value}")),
    }
}

pub fn parse_block_status(value: &str) -> Result<BlockStatus> {
    match value {
        "proposed" => Ok(BlockStatus::Proposed),
        "confirmed" => Ok(BlockStatus::Confirmed),
        "cancelled" => Ok(BlockStatus::Cancelled),
        "done" => Ok(BlockStatus::Done),
        _ => Err(anyhow!("invalid block status: {value}")),
    }
}

fn parse_backlog_status(value: &str) -> Result<BacklogStatus> {
    match value {
        "todo" => Ok(BacklogStatus::Todo),
        "inprogress" => Ok(BacklogStatus::InProgress),
        "done" => Ok(BacklogStatus::Done),
        _ => Err(anyhow!("invalid backlog status: {value}")),
    }
}

pub fn read_pid() -> Result<u32> {
    let paths = DeepBlockPaths::resolve()?;
    if !storage_is_owned(&paths)? {
        return Err(anyhow!(
            "No running storage owner is recorded; refusing to use a stale PID file."
        ));
    }
    let runtime = persist::read_json_file::<ServerRuntime>(&paths.server_runtime_file())?;
    let pid: u32 = fs::read_to_string(paths.pid_file())?.trim().parse()?;
    if pid == 0 || pid != runtime.pid {
        return Err(anyhow!(
            "Runtime ownership records do not agree; refusing to signal a process."
        ));
    }
    Ok(pid)
}

pub fn stop_server_process() -> Result<()> {
    let pid = read_pid()?;

    #[cfg(unix)]
    {
        use nix::{
            sys::signal::{Signal, kill},
            unistd::Pid,
        };
        let pid = i32::try_from(pid).map_err(|_| anyhow!("Invalid process identifier"))?;
        kill(Pid::from_raw(pid), Signal::SIGTERM)?;
        return Ok(());
    }

    #[allow(unreachable_code)]
    Err(anyhow!(
        "deepb stop is only implemented on unix-like platforms in this scaffold"
    ))
}

#[cfg(test)]
mod tests {
    use super::normalize_base_url;

    #[tokio::test]
    async fn health_preserves_json_and_http_errors() {
        use tokio::{
            io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
            net::TcpListener,
        };
        for (status, body, succeeds) in [
            (
                "200 OK",
                r#"{"service":"deepblock","status":"ok","version":"test"}"#,
                true,
            ),
            (
                "503 Service Unavailable",
                r#"{"status":"ok","version":"test"}"#,
                false,
            ),
            ("200 OK", "not JSON", false),
        ] {
            let listener = TcpListener::bind("127.0.0.1:0").await.expect("listener");
            let address = listener.local_addr().expect("address");
            let server = tokio::spawn(async move {
                let (socket, _) = listener.accept().await.expect("connection");
                let mut socket = BufReader::new(socket);
                let mut request = String::new();
                socket.read_line(&mut request).await.expect("request");
                assert_eq!(request, "GET /health HTTP/1.1\r\n");
                socket.get_mut().write_all(format!(
                    "HTTP/1.1 {status}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len()
                ).as_bytes()).await.expect("response");
            });
            let result = super::DeepBlockClient::new(format!("http://{address}"))
                .health()
                .await;
            assert_eq!(result.is_ok(), succeeds, "{status}: {body}");
            if let Ok(health) = result {
                assert_eq!(health.version, "test");
            }
            server.await.expect("server");
        }
    }

    #[test]
    fn normalizes_base_url_trailing_slash() {
        assert_eq!(
            normalize_base_url("http://127.0.0.1:5605/".to_string()),
            "http://127.0.0.1:5605"
        );
    }

    #[test]
    fn cli_parsers_map_every_keyword_and_reject_others() {
        use super::{
            parse_backlog_status, parse_block_status, parse_block_type, parse_copy_mode, parse_mode,
        };
        use deepblock_server::models::{
            BacklogStatus, BlockStatus, BlockType, InteractionMode, RevisionCopyMode,
        };

        for (keyword, expected) in [
            ("focus", BlockType::Focus),
            ("shallow", BlockType::Shallow),
            ("urgent", BlockType::Urgent),
            ("break", BlockType::Break),
        ] {
            assert_eq!(parse_block_type(keyword).expect(keyword), expected);
        }
        assert!(parse_block_type("nonsense").is_err());

        for (keyword, expected) in [
            ("proposed", BlockStatus::Proposed),
            ("confirmed", BlockStatus::Confirmed),
            ("cancelled", BlockStatus::Cancelled),
            ("done", BlockStatus::Done),
        ] {
            assert_eq!(parse_block_status(keyword).expect(keyword), expected);
        }
        assert!(parse_block_status("nonsense").is_err());

        for (keyword, expected) in [
            ("all", RevisionCopyMode::All),
            ("from_now", RevisionCopyMode::FromNow),
            ("empty", RevisionCopyMode::Empty),
        ] {
            assert_eq!(parse_copy_mode(keyword).expect(keyword), expected);
        }
        assert!(parse_copy_mode("nonsense").is_err());

        for (keyword, expected) in [
            ("focus", InteractionMode::Focus),
            ("reflect", InteractionMode::Reflect),
        ] {
            assert_eq!(parse_mode(keyword).expect(keyword), expected);
        }
        assert!(parse_mode("nonsense").is_err());

        for (keyword, expected) in [
            ("todo", BacklogStatus::Todo),
            ("inprogress", BacklogStatus::InProgress),
            ("done", BacklogStatus::Done),
        ] {
            assert_eq!(parse_backlog_status(keyword).expect(keyword), expected);
        }
        assert!(parse_backlog_status("nonsense").is_err());
    }

    #[test]
    fn ui_url_defaults_to_the_local_planner() {
        let client = super::DeepBlockClient::new("http://127.0.0.1:1".to_string());
        assert_eq!(client.ui_url(), "http://127.0.0.1:5173/planner");
    }

    #[tokio::test]
    async fn move_block_rejects_unknown_directions_before_any_request() {
        let client = super::DeepBlockClient::new("http://127.0.0.1:9".to_string());
        let error = client
            .move_block("block-0001", "sideways".to_string())
            .await
            .expect_err("unknown directions are rejected");
        assert!(error.to_string().contains("invalid direction"));
    }
}
