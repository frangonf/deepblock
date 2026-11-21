use std::{
    collections::BTreeMap,
    path::{Path, PathBuf},
    sync::Arc,
};

use tokio::sync::RwLock;

tokio::task_local! {
    pub(crate) static REQUEST_PERMIT: Arc<tokio::sync::OwnedRwLockReadGuard<()>>;
}

use crate::{
    config::{DeepBlockPaths, ServerRuntime, Settings, load_settings},
    error::AppResult,
    history::PlanHistory,
    models::{Backlog, DayPlan, GlobalState, today_string, validate_date_param},
    persist,
    ws::EventBus,
};

#[derive(Clone)]
pub struct AppState {
    pub maintenance: Arc<RwLock<()>>,
    pub previews: Arc<tokio::sync::Mutex<Option<crate::routes::storage::PreparedImport>>>,
    pub import_slots: Arc<tokio::sync::Semaphore>,
    pub storage_unavailable: Arc<std::sync::atomic::AtomicBool>,
    pub paths: DeepBlockPaths,
    storage: Arc<std::sync::OnceLock<Result<crate::storage::PlanningStore, String>>>,
    pub settings: Arc<RwLock<Settings>>,
    pub events: EventBus,
    pub modules: Arc<crate::modules::ModuleRegistry>,
    pub request_policy: Arc<crate::request_policy::RequestPolicy>,
    pub(crate) backlog_lock: Arc<tokio::sync::Mutex<()>>,
    /// Per-date async mutexes serialising read-modify-write cycles on day
    /// plans so concurrent requests cannot silently drop each other's writes.
    plan_locks: Arc<std::sync::Mutex<BTreeMap<String, Arc<tokio::sync::Mutex<()>>>>>,
}

impl AppState {
    pub async fn load() -> AppResult<Self> {
        let paths = DeepBlockPaths::resolve()?;
        paths.ensure_dirs()?;
        let settings = load_settings(&paths)?;
        let mut state = Self::new(paths, settings);
        state.request_policy = Arc::new(crate::request_policy::RequestPolicy::from_environment()?);
        state
            .io(|s| {
                s.store()?;
                Ok(())
            })
            .await?;
        Ok(state)
    }

    pub fn new(paths: DeepBlockPaths, settings: Settings) -> Self {
        Self {
            maintenance: Arc::new(RwLock::new(())),
            previews: Arc::new(tokio::sync::Mutex::new(None)),
            import_slots: Arc::new(tokio::sync::Semaphore::new(1)),
            storage_unavailable: Arc::new(std::sync::atomic::AtomicBool::new(false)),
            paths,
            storage: Arc::new(std::sync::OnceLock::new()),
            settings: Arc::new(RwLock::new(settings)),
            events: EventBus::new(),
            modules: Arc::new(crate::modules::ModuleRegistry::default()),
            request_policy: Arc::new(crate::request_policy::RequestPolicy::default()),
            backlog_lock: Arc::new(tokio::sync::Mutex::new(())),
            plan_locks: Arc::new(std::sync::Mutex::new(BTreeMap::new())),
        }
    }

    pub fn for_test(base_dir: &Path) -> Self {
        let paths = DeepBlockPaths::from_roots(
            base_dir.join("data"),
            base_dir.join("config"),
            base_dir.join("state"),
        );
        paths
            .ensure_dirs()
            .expect("test directories should be created");
        Self::new(paths, Settings::default())
    }

    /// Returns the mutex that serialises mutations for `date`. Acquire it
    /// around every load→modify→save cycle touching that date's plan.
    pub fn lock_for_date(&self, date: &str) -> Arc<tokio::sync::Mutex<()>> {
        let mut locks = self.plan_locks.lock().expect("plan lock map poisoned");
        locks.entry(date.to_string()).or_default().clone()
    }

    pub fn load_plan(&self, date: &str) -> AppResult<DayPlan> {
        validate_date_param(date)?;
        if let Some(day) = self.store()?.load_day(date)? {
            Ok(day.plan)
        } else {
            let mut plan = DayPlan::new(date.to_string());
            plan.revisions[0].created_at = format!("{date}T00:00:00.000000");
            Ok(plan)
        }
    }

    pub fn load_today_plan(&self) -> AppResult<DayPlan> {
        self.load_plan(&today_string())
    }

    pub fn save_plan(&self, plan: &DayPlan) -> AppResult<()> {
        let history = self.load_history(&plan.date)?;
        self.commit_plan(plan, &history)
    }

    pub fn commit_plan(&self, plan: &DayPlan, history: &PlanHistory) -> AppResult<()> {
        validate_date_param(&plan.date)?;
        self.store()?.commit_day(&crate::storage::StoredDayPlan {
            plan: plan.clone(),
            history: Some(history.clone()),
        })
    }

    fn store(&self) -> AppResult<&crate::storage::PlanningStore> {
        self.storage
            .get_or_init(|| {
                crate::storage::PlanningStore::open(&self.paths).map_err(|e| e.to_string())
            })
            .as_ref()
            .map_err(|e| std::io::Error::other(e.clone()).into())
    }

    pub async fn io<T: Send + 'static>(
        &self,
        operation: impl FnOnce(Self) -> AppResult<T> + Send + 'static,
    ) -> AppResult<T> {
        let state = self.clone();
        let permit = REQUEST_PERMIT.try_with(Arc::clone).ok();
        tokio::task::spawn_blocking(move || {
            let _permit = permit;
            operation(state)
        })
        .await
        .map_err(|e| std::io::Error::other(format!("Storage task failed: {e}")))?
    }

    pub fn planning_store(&self) -> AppResult<&crate::storage::PlanningStore> {
        self.store()
    }

    pub fn load_global_state(&self) -> AppResult<GlobalState> {
        Ok(self.store()?.load_resource("global")?.unwrap_or_default())
    }
    pub fn save_global_state(&self, state: &GlobalState) -> AppResult<()> {
        self.store()?.save_resource("global", state)
    }
    pub fn load_history(&self, date: &str) -> AppResult<PlanHistory> {
        validate_date_param(date)?;
        Ok(self
            .store()?
            .load_day(date)?
            .and_then(|d| d.history)
            .unwrap_or_default())
    }
    pub fn save_history(&self, date: &str, history: &PlanHistory) -> AppResult<()> {
        let plan = self.load_plan(date)?;
        self.commit_plan(&plan, history)
    }
    pub fn load_backlog(&self) -> AppResult<Vec<Backlog>> {
        Ok(self.store()?.load_resource("backlog")?.unwrap_or_default())
    }
    pub fn save_backlog(&self, backlog: &[Backlog]) -> AppResult<()> {
        self.store()?.save_resource("backlog", backlog)
    }

    pub async fn load_today_plan_async(&self) -> AppResult<DayPlan> {
        self.io(|s| s.load_today_plan()).await
    }
    pub async fn load_global_state_async(&self) -> AppResult<GlobalState> {
        self.io(|s| s.load_global_state()).await
    }
    pub async fn load_backlog_async(&self) -> AppResult<Vec<Backlog>> {
        self.io(|s| s.load_backlog()).await
    }
    pub async fn load_plan_async(&self, date: &str) -> AppResult<DayPlan> {
        let date = date.to_string();
        self.io(move |s| s.load_plan(&date)).await
    }
    pub async fn load_history_async(&self, date: &str) -> AppResult<PlanHistory> {
        let date = date.to_string();
        self.io(move |s| s.load_history(&date)).await
    }
    pub async fn load_note_async(&self, date: &str) -> AppResult<Option<String>> {
        let date = date.to_string();
        self.io(move |s| s.load_note(&date)).await
    }
    pub async fn save_plan_async(&self, plan: &DayPlan) -> AppResult<()> {
        let plan = plan.clone();
        self.io(move |s| s.save_plan(&plan)).await
    }
    pub async fn save_global_state_async(&self, state: &GlobalState) -> AppResult<()> {
        let state = state.clone();
        self.io(move |s| s.save_global_state(&state)).await
    }
    pub async fn save_backlog_async(&self, backlog: &[Backlog]) -> AppResult<()> {
        let backlog = backlog.to_vec();
        self.io(move |s| s.save_backlog(&backlog)).await
    }
    pub async fn commit_plan_async(&self, plan: &DayPlan, history: &PlanHistory) -> AppResult<()> {
        let plan = plan.clone();
        let history = history.clone();
        self.io(move |s| s.commit_plan(&plan, &history)).await
    }
    pub async fn save_note_async(&self, date: &str, content: &str) -> AppResult<PathBuf> {
        let date = date.to_string();
        let content = content.to_string();
        self.io(move |s| s.save_note(&date, &content)).await
    }

    pub fn note_file(&self, date: &str) -> PathBuf {
        self.paths.note_file(date)
    }

    pub fn load_note(&self, date: &str) -> AppResult<Option<String>> {
        validate_date_param(date)?;
        let path = self.note_file(date);
        if path.exists() {
            Ok(Some(persist::read_text_file(&path)?))
        } else {
            Ok(None)
        }
    }

    pub fn save_note(&self, date: &str, content: &str) -> AppResult<PathBuf> {
        validate_date_param(date)?;
        let path = self.note_file(date);
        persist::write_text_file(&path, content)?;
        Ok(path)
    }

    pub fn write_server_runtime(&self, host: &str, port: u16) -> AppResult<()> {
        std::fs::write(self.paths.pid_file(), std::process::id().to_string())?;
        persist::write_json_pretty(
            &self.paths.server_runtime_file(),
            &ServerRuntime {
                pid: std::process::id(),
                host: host.to_string(),
                port,
            },
        )?;
        Ok(())
    }

    pub fn remove_server_runtime(&self) -> AppResult<()> {
        crate::runtime::remove_owned_runtime(&self.paths)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::AppError;
    use crate::models::{Block, BlockStatus, BlockType, now_timestamp};

    fn state() -> (tempfile::TempDir, AppState) {
        let dir = tempfile::tempdir().expect("tempdir should be created");
        let state = AppState::for_test(dir.path());
        (dir, state)
    }

    fn plan_for(date: &str) -> DayPlan {
        let mut plan = DayPlan::new(date.to_string());
        plan.active_revision_mut().unwrap().blocks.push(Block {
            id: "aaaaaaaa".to_string(),
            label: "Test".to_string(),
            start: "09:00".to_string(),
            duration: 30,
            block_type: BlockType::Focus,
            status: BlockStatus::Proposed,
            created_at: now_timestamp(),
            metadata: Default::default(),
            content_path: None,
            focus_rating: None,
            actual_duration: None,
            next_action: None,
            artifacts: Vec::new(),
            reality: None,
        });
        plan
    }

    #[test]
    fn load_plan_rejects_invalid_dates() {
        let (_dir, state) = state();

        for date in ["../..", "../../etc/passwd", "2026-4-17", ""] {
            let error = state
                .load_plan(date)
                .expect_err("invalid date must be rejected");
            assert!(matches!(error, AppError::BadRequest(_)), "got {error:?}");
        }
    }

    #[test]
    fn save_plan_rejects_invalid_dates() {
        let (_dir, state) = state();

        let error = state
            .save_plan(&plan_for("../../evil"))
            .expect_err("invalid date must be rejected");
        assert!(matches!(error, AppError::BadRequest(_)), "got {error:?}");
    }

    #[test]
    fn history_round_trip_rejects_invalid_dates() {
        let (_dir, state) = state();

        let load_error = state
            .load_history("../..")
            .expect_err("invalid date must be rejected");
        assert!(matches!(load_error, AppError::BadRequest(_)));

        let save_error = state
            .save_history("../..", &crate::history::PlanHistory::default())
            .expect_err("invalid date must be rejected");
        assert!(matches!(save_error, AppError::BadRequest(_)));
    }

    #[test]
    fn note_round_trip_rejects_invalid_dates() {
        let (_dir, state) = state();

        let load_error = state
            .load_note("../..")
            .expect_err("invalid date must be rejected");
        assert!(matches!(load_error, AppError::BadRequest(_)));

        let save_error = state
            .save_note("../..", "content")
            .expect_err("invalid date must be rejected");
        assert!(matches!(save_error, AppError::BadRequest(_)));
    }

    #[test]
    fn valid_dates_still_round_trip() {
        let (_dir, state) = state();

        state
            .save_plan(&plan_for("2026-04-17"))
            .expect("valid date should save");
        let loaded = state
            .load_plan("2026-04-17")
            .expect("valid date should load");
        assert_eq!(loaded.date, "2026-04-17");
        assert_eq!(loaded.active_revision().unwrap().blocks.len(), 1);
    }
}

#[cfg(test)]
mod maintenance_tests {
    use super::*;
    #[tokio::test]
    async fn disconnected_request_cannot_release_running_blocking_work() {
        let dir = tempfile::tempdir().unwrap();
        let state = AppState::for_test(dir.path());
        let gate = state.maintenance.clone();
        let permit = Arc::new(gate.clone().read_owned().await);
        let (started, ready) = tokio::sync::oneshot::channel();
        let (release, wait) = std::sync::mpsc::channel();
        let request = tokio::spawn(REQUEST_PERMIT.scope(permit, async move {
            state
                .io(move |_| {
                    let _ = started.send(());
                    wait.recv().map_err(std::io::Error::other)?;
                    Ok(())
                })
                .await
        }));
        ready.await.unwrap();
        request.abort();
        let _ = request.await;
        assert!(
            tokio::time::timeout(
                std::time::Duration::from_millis(30),
                gate.clone().write_owned()
            )
            .await
            .is_err()
        );
        release.send(()).unwrap();
        let _guard = tokio::time::timeout(std::time::Duration::from_secs(2), gate.write_owned())
            .await
            .unwrap();
    }
}
