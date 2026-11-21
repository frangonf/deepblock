//! Optional processing contracts and bounded supervision. No planning writer or
//! desktop-action capability is passed to a processor. Production capture is
//! deliberately absent; fault fixtures register disposable processors.
use crate::error::{AppError, AppResult};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::{BTreeMap, BTreeSet},
    future::Future,
    pin::Pin,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, AtomicU64, Ordering},
    },
    time::{Duration, Instant},
};
use tokio::sync::{mpsc, watch};

pub const MODULE_API_VERSION: u32 = 1;
const MAX_RETAINED_JOBS: usize = 128;
const MAX_PAYLOAD_BYTES: usize = 65_536;

#[derive(Clone, Copy, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ExecutionLocation {
    DeviceLocal,
    SelfHosted,
    Hosted,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ProcessingTask {
    pub api_version: u32,
    pub request_id: String,
    pub idempotency_key: String,
    pub intent_version: Option<String>,
    pub location: ExecutionLocation,
    pub timeout_ms: u64,
    pub payload: Value,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct ProcessingReply {
    pub api_version: u32,
    pub request_id: String,
    pub provider_id: String,
    pub location: ExecutionLocation,
    pub output: Value,
}

#[derive(Clone, Debug, Serialize)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum JobStatus {
    Queued,
    Running,
    Completed { reply: ProcessingReply },
    Failed { reason: String },
    Cancelled,
    Expired,
}
impl JobStatus {
    pub fn terminal(&self) -> bool {
        !matches!(self, Self::Queued | Self::Running)
    }
}

pub type ProcessingFuture = Pin<Box<dyn Future<Output = Result<ProcessingReply, String>> + Send>>;
pub trait Processor: Send + Sync + 'static {
    fn id(&self) -> &str;
    fn locations(&self) -> BTreeSet<ExecutionLocation>;
    fn process(self: Arc<Self>, task: ProcessingTask) -> ProcessingFuture;
}

/// Explicitly configured destinations. A failure never changes this policy or
/// routes a local request to an external processor.
#[derive(Clone, Debug, Default)]
pub struct TransmissionPolicy {
    pub permitted_external: BTreeSet<ExecutionLocation>,
}

#[derive(Clone)]
pub struct JobTicket {
    status: watch::Receiver<JobStatus>,
    cancellation: watch::Sender<bool>,
}
impl JobTicket {
    pub fn status(&self) -> JobStatus {
        self.status.borrow().clone()
    }
    pub fn cancel(&self) {
        self.cancellation.send_replace(true);
    }
    pub async fn result(mut self) -> JobStatus {
        loop {
            let status = self.status.borrow().clone();
            if status.terminal() {
                return status;
            }
            if self.status.changed().await.is_err() {
                return JobStatus::Failed {
                    reason: "Worker unavailable".into(),
                };
            }
        }
    }
}

struct JobRecord {
    task: ProcessingTask,
    status: watch::Sender<JobStatus>,
    cancellation: watch::Sender<bool>,
}
struct Work {
    task: ProcessingTask,
    status: watch::Sender<JobStatus>,
    cancellation: watch::Receiver<bool>,
    queued_at: Instant,
}

pub struct WorkerHost {
    provider_id: String,
    locations: BTreeSet<ExecutionLocation>,
    policy: TransmissionPolicy,
    enabled: Arc<AtomicBool>,
    paused: AtomicBool,
    failures: Arc<AtomicU64>,
    jobs: Mutex<BTreeMap<String, JobRecord>>,
    queue: mpsc::Sender<Work>,
    shutdown: watch::Sender<bool>,
}

impl WorkerHost {
    /// The optional worker owns a separate runtime/thread. Startup cannot become
    /// a synchronous prerequisite for a plan or note save.
    pub fn new(
        processor: Arc<dyn Processor>,
        capacity: usize,
        policy: TransmissionPolicy,
    ) -> AppResult<Self> {
        if capacity == 0 || capacity > 64 {
            return Err(AppError::BadRequest(
                "Worker queue capacity must be 1–64".into(),
            ));
        }
        let provider_id = processor.id().to_string();
        let locations = processor.locations();
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .max_blocking_threads(1)
            .build()?;
        let (queue, receiver) = mpsc::channel(capacity);
        let (shutdown, stop) = watch::channel(false);
        let failures = Arc::new(AtomicU64::new(0));
        let enabled = Arc::new(AtomicBool::new(false));
        let worker_failures = failures.clone();
        let worker_enabled = enabled.clone();
        std::thread::Builder::new()
            .name("deepblock-optional-processor".into())
            .spawn(move || {
                runtime.block_on(supervise(
                    processor,
                    receiver,
                    stop,
                    worker_failures,
                    worker_enabled,
                ));
            })?;
        Ok(Self {
            provider_id,
            locations,
            policy,
            enabled,
            paused: AtomicBool::new(false),
            failures,
            jobs: Mutex::new(BTreeMap::new()),
            queue,
            shutdown,
        })
    }

    pub fn enable(&self) {
        self.enabled.store(true, Ordering::SeqCst);
    }
    pub fn pause(&self) {
        self.paused.store(true, Ordering::SeqCst);
        self.cancel_outstanding();
    }
    pub fn resume(&self) {
        self.paused.store(false, Ordering::SeqCst);
    }
    pub fn disable(&self) {
        self.enabled.store(false, Ordering::SeqCst);
        self.cancel_outstanding();
    }
    pub fn shutdown(&self) {
        self.disable();
        self.shutdown.send_replace(true);
    }

    fn cancel_outstanding(&self) {
        if let Ok(jobs) = self.jobs.lock() {
            for job in jobs.values().filter(|j| !j.status.borrow().terminal()) {
                job.cancellation.send_replace(true);
            }
        }
    }

    pub fn submit(&self, task: ProcessingTask) -> AppResult<JobTicket> {
        if !self.enabled.load(Ordering::SeqCst) || self.paused.load(Ordering::SeqCst) {
            return Err(AppError::Conflict("Worker disabled or paused".into()));
        }
        if task.api_version != MODULE_API_VERSION
            || uuid::Uuid::parse_str(&task.request_id).is_err()
            || task
                .intent_version
                .as_ref()
                .is_some_and(|id| uuid::Uuid::parse_str(id).is_err())
            || task.idempotency_key.is_empty()
            || task.idempotency_key.len() > 128
            || task.timeout_ms == 0
            || task.timeout_ms > 30_000
            || serde_json::to_vec(&task.payload)?.len() > MAX_PAYLOAD_BYTES
        {
            return Err(AppError::BadRequest(
                "Invalid processing contract, deadline or payload size".into(),
            ));
        }
        if !self.locations.contains(&task.location)
            || (task.location != ExecutionLocation::DeviceLocal
                && !self.policy.permitted_external.contains(&task.location))
        {
            return Err(AppError::BadRequest(
                "Execution location is unsupported or transmission is not permitted".into(),
            ));
        }
        let mut jobs = self
            .jobs
            .lock()
            .map_err(|_| std::io::Error::other("Worker jobs lock poisoned"))?;
        if let Some(previous) = jobs.get(&task.idempotency_key) {
            if previous.task != task {
                return Err(AppError::Conflict(
                    "Idempotency key already belongs to a different task".into(),
                ));
            }
            return Ok(JobTicket {
                status: previous.status.subscribe(),
                cancellation: previous.cancellation.clone(),
            });
        }
        if jobs.len() >= MAX_RETAINED_JOBS {
            let finished = jobs
                .iter()
                .find(|(_, j)| j.status.borrow().terminal())
                .map(|(key, _)| key.clone());
            if let Some(key) = finished {
                jobs.remove(&key);
            } else {
                return Err(AppError::Conflict("Worker result capacity reached".into()));
            }
        }
        let (status, ticket_status) = watch::channel(JobStatus::Queued);
        let (cancellation, cancel_receiver) = watch::channel(false);
        self.queue
            .try_send(Work {
                task: task.clone(),
                status: status.clone(),
                cancellation: cancel_receiver,
                queued_at: Instant::now(),
            })
            .map_err(|_| AppError::Conflict("Worker queue saturated or unavailable".into()))?;
        jobs.insert(
            task.idempotency_key.clone(),
            JobRecord {
                task,
                status,
                cancellation: cancellation.clone(),
            },
        );
        Ok(JobTicket {
            status: ticket_status,
            cancellation,
        })
    }

    pub fn health(&self, module_id: &str) -> ModuleHealth {
        let failures = self.failures.load(Ordering::SeqCst);
        ModuleHealth {
            module_id: module_id.into(),
            state: if !self.enabled.load(Ordering::SeqCst) {
                "disabled"
            } else if self.paused.load(Ordering::SeqCst) {
                "paused"
            } else if failures > 0 {
                "degraded"
            } else {
                "healthy"
            }
            .into(),
            provider_id: Some(self.provider_id.clone()),
            execution_locations: self.locations.iter().copied().collect(),
            failures,
            queued: self.queue.max_capacity() - self.queue.capacity(),
        }
    }
}
impl Drop for WorkerHost {
    fn drop(&mut self) {
        self.shutdown();
    }
}

async fn supervise(
    processor: Arc<dyn Processor>,
    mut queue: mpsc::Receiver<Work>,
    mut stop: watch::Receiver<bool>,
    failures: Arc<AtomicU64>,
    enabled: Arc<AtomicBool>,
) {
    loop {
        let work = tokio::select! { biased; _ = stop.changed() => break, work = queue.recv() => match work { Some(work) => work, None => break } };
        let Work {
            task,
            status,
            mut cancellation,
            queued_at,
        } = work;
        if *cancellation.borrow() || !enabled.load(Ordering::SeqCst) {
            status.send_replace(JobStatus::Cancelled);
            continue;
        }
        let deadline = queued_at + Duration::from_millis(task.timeout_ms);
        if Instant::now() >= deadline {
            status.send_replace(JobStatus::Expired);
            continue;
        }
        status.send_replace(JobStatus::Running);
        let expected = task.clone();
        let provider = processor.clone();
        let mut attempt = tokio::spawn(async move { provider.process(task).await });
        let outcome = tokio::select! {
            biased;
            _ = stop.changed() => JobStatus::Cancelled,
            _ = cancellation.changed() => JobStatus::Cancelled,
            _ = tokio::time::sleep_until(tokio::time::Instant::from_std(deadline)) => JobStatus::Expired,
            result = &mut attempt => match result {
                Ok(Ok(reply)) if reply.api_version == MODULE_API_VERSION && reply.request_id == expected.request_id && reply.location == expected.location && reply.provider_id == processor.id() && serde_json::to_vec(&reply.output).is_ok_and(|bytes| bytes.len() <= MAX_PAYLOAD_BYTES) => JobStatus::Completed { reply },
                Ok(Ok(_)) => JobStatus::Failed { reason: "Incompatible provider provenance".into() },
                Ok(Err(reason)) => JobStatus::Failed { reason },
                Err(_) => JobStatus::Failed { reason: "Provider crashed".into() },
            }
        };
        attempt.abort();
        if matches!(outcome, JobStatus::Failed { .. } | JobStatus::Expired) {
            failures.fetch_add(1, Ordering::SeqCst);
            status.send_replace(outcome);
            tokio::time::sleep(Duration::from_millis(10)).await;
        } else {
            status.send_replace(outcome);
        }
        if *stop.borrow() {
            break;
        }
    }
    queue.close();
    while let Some(work) = queue.recv().await {
        work.status.send_replace(JobStatus::Cancelled);
    }
}

#[derive(Clone, Debug, Serialize)]
pub struct ModuleHealth {
    pub module_id: String,
    pub state: String,
    pub provider_id: Option<String>,
    pub execution_locations: Vec<ExecutionLocation>,
    pub failures: u64,
    pub queued: usize,
}

#[derive(Default)]
pub struct ModuleRegistry {
    hosts: Mutex<BTreeMap<String, Arc<WorkerHost>>>,
}
impl ModuleRegistry {
    pub fn register(&self, module_id: &str, host: Arc<WorkerHost>) -> AppResult<()> {
        if !["recording", "processing", "assessment", "assistance"].contains(&module_id) {
            return Err(AppError::BadRequest("Unknown module identity".into()));
        }
        let mut hosts = self
            .hosts
            .lock()
            .map_err(|_| std::io::Error::other("Module registry poisoned"))?;
        if hosts.contains_key(module_id) {
            return Err(AppError::Conflict("Module already registered".into()));
        }
        hosts.insert(module_id.into(), host);
        Ok(())
    }
    pub fn health(&self) -> AppResult<Vec<ModuleHealth>> {
        let hosts = self
            .hosts
            .lock()
            .map_err(|_| std::io::Error::other("Module registry poisoned"))?;
        Ok(["recording", "processing", "assessment", "assistance"]
            .iter()
            .map(|id| {
                hosts
                    .get(*id)
                    .map(|h| h.health(id))
                    .unwrap_or(ModuleHealth {
                        module_id: (*id).into(),
                        state: "unconfigured".into(),
                        provider_id: None,
                        execution_locations: Vec::new(),
                        failures: 0,
                        queued: 0,
                    })
            })
            .collect())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::sync::Arc;

    struct StubProcessor;
    impl Processor for StubProcessor {
        fn id(&self) -> &str {
            "stub"
        }
        fn locations(&self) -> BTreeSet<ExecutionLocation> {
            BTreeSet::from([ExecutionLocation::DeviceLocal])
        }
        fn process(self: Arc<Self>, task: ProcessingTask) -> ProcessingFuture {
            Box::pin(async move {
                Ok(ProcessingReply {
                    api_version: task.api_version,
                    request_id: task.request_id,
                    provider_id: "stub".into(),
                    location: task.location,
                    output: task.payload,
                })
            })
        }
    }

    fn host() -> WorkerHost {
        let host = WorkerHost::new(Arc::new(StubProcessor), 4, TransmissionPolicy::default())
            .expect("stub host builds");
        host.enable();
        host
    }

    fn task() -> ProcessingTask {
        ProcessingTask {
            api_version: MODULE_API_VERSION,
            request_id: "9e5b64a7-2e2f-4c67-8bd2-4d21d1e69f31".into(),
            idempotency_key: "key".into(),
            intent_version: None,
            location: ExecutionLocation::DeviceLocal,
            timeout_ms: 5_000,
            payload: json!({ "work": true }),
        }
    }

    #[test]
    fn submit_rejects_each_contract_violation_and_keeps_the_boundaries() {
        let host = host();
        for (label, mutate) in [
            (
                "api version",
                Box::new(|t: &mut ProcessingTask| {
                    t.api_version += 1;
                }) as Box<dyn Fn(&mut ProcessingTask)>,
            ),
            (
                "request id",
                Box::new(|t: &mut ProcessingTask| {
                    t.request_id = "not-a-uuid".into();
                }),
            ),
            (
                "intent version",
                Box::new(|t: &mut ProcessingTask| {
                    t.intent_version = Some("not-a-uuid".into());
                }),
            ),
            (
                "empty idempotency key",
                Box::new(|t: &mut ProcessingTask| {
                    t.idempotency_key.clear();
                }),
            ),
            (
                "oversized idempotency key",
                Box::new(|t: &mut ProcessingTask| {
                    t.idempotency_key = "k".repeat(129);
                }),
            ),
            (
                "zero timeout",
                Box::new(|t: &mut ProcessingTask| {
                    t.timeout_ms = 0;
                }),
            ),
            (
                "timeout above the ceiling",
                Box::new(|t: &mut ProcessingTask| {
                    t.timeout_ms = 30_001;
                }),
            ),
            (
                "oversized payload",
                Box::new(|t: &mut ProcessingTask| {
                    t.payload = json!({ "blob": "x".repeat(MAX_PAYLOAD_BYTES) });
                }),
            ),
            (
                "unsupported location",
                Box::new(|t: &mut ProcessingTask| {
                    t.location = ExecutionLocation::SelfHosted;
                }),
            ),
        ] {
            let mut invalid = task();
            mutate(&mut invalid);
            let outcome = host.submit(invalid);
            assert!(
                matches!(
                    outcome,
                    Err(AppError::BadRequest(_)) | Err(AppError::Conflict(_))
                ),
                "{label} is rejected"
            );
        }
        let mut boundary = task();
        boundary.idempotency_key = "k".repeat(128);
        boundary.timeout_ms = 30_000;
        assert!(
            host.submit(boundary).is_ok(),
            "the 128-character key and 30 s deadline stay valid"
        );
        drop(host);
    }

    #[test]
    fn pause_resume_and_shutdown_gates_submission() {
        let host = host();
        host.pause();
        assert!(
            matches!(host.submit(task()), Err(AppError::Conflict(_))),
            "paused workers reject submissions"
        );
        host.resume();
        assert!(host.submit(task()).is_ok(), "resume reopens submissions");
        host.shutdown();
        assert!(
            matches!(host.submit(task()), Err(AppError::Conflict(_))),
            "shutdown disables the worker"
        );
    }

    #[test]
    fn health_reports_state_failures_and_queue_depth() {
        let host = host();
        let health = host.health("stub");
        assert_eq!(health.state, "healthy");
        assert_eq!(health.failures, 0);
        assert_eq!(health.queued, 0, "an empty queue reports zero depth");
        host.pause();
        assert_eq!(host.health("stub").state, "paused");
        host.shutdown();
        let health = host.health("stub");
        assert_eq!(health.state, "disabled", "shutdown disables the host");
    }
}
