mod common;
use axum::http::StatusCode;
use deepblock_server::{
    app,
    modules::{
        ExecutionLocation, JobStatus, JobTicket, ProcessingFuture, ProcessingReply, ProcessingTask,
        Processor, TransmissionPolicy, WorkerHost,
    },
    state::AppState,
};
use serde_json::json;
use std::{
    collections::BTreeSet,
    sync::Arc,
    time::{Duration, Instant},
};

struct FixtureProcessor;
impl Processor for FixtureProcessor {
    fn id(&self) -> &str {
        "fixture"
    }
    fn locations(&self) -> BTreeSet<ExecutionLocation> {
        [ExecutionLocation::DeviceLocal, ExecutionLocation::Hosted].into()
    }
    fn process(self: Arc<Self>, task: ProcessingTask) -> ProcessingFuture {
        Box::pin(async move {
            match task.payload["mode"].as_str() {
                Some("crash") => panic!("disposable processor crash"),
                Some("stall") => tokio::time::sleep(Duration::from_secs(10)).await,
                Some("cpu") => {
                    tokio::task::spawn_blocking(|| {
                        let mut total = 0_u64;
                        for n in 0..1_000_000 {
                            total = total.wrapping_add(std::hint::black_box(n));
                        }
                        total
                    })
                    .await
                    .map_err(|e| e.to_string())?;
                }
                _ => {}
            }
            Ok(ProcessingReply {
                api_version: 1,
                request_id: task.request_id,
                provider_id: "fixture".into(),
                location: task.location,
                output: json!({"unresolved":true}),
            })
        })
    }
}
fn task(mode: &str, timeout_ms: u64) -> ProcessingTask {
    let id = uuid::Uuid::new_v4().to_string();
    ProcessingTask {
        api_version: 1,
        request_id: id.clone(),
        idempotency_key: id,
        intent_version: None,
        location: ExecutionLocation::DeviceLocal,
        timeout_ms,
        payload: json!({"mode":mode}),
    }
}
fn host(capacity: usize) -> WorkerHost {
    WorkerHost::new(
        Arc::new(FixtureProcessor),
        capacity,
        TransmissionPolicy::default(),
    )
    .unwrap()
}

/// Job outcomes must arrive promptly; a wedged worker fails the test instead
/// of hanging the suite.
async fn outcome(ticket: JobTicket) -> JobStatus {
    tokio::time::timeout(Duration::from_secs(10), ticket.result())
        .await
        .expect("job reaches a terminal status")
}

#[tokio::test]
async fn cancellation_deadlines_policy_and_idempotency_are_explicit() {
    let worker = host(2);
    assert!(worker.submit(task("fast", 100)).is_err());
    worker.enable();
    let request = task("fast", 1000);
    let ticket = worker.submit(request.clone()).unwrap();
    let duplicate = worker.submit(request.clone()).unwrap();
    assert!(matches!(outcome(ticket).await, JobStatus::Completed { .. }));
    assert!(matches!(
        outcome(duplicate).await,
        JobStatus::Completed { .. }
    ));
    let mut conflict = request;
    conflict.payload = json!({"different":true});
    assert!(worker.submit(conflict).is_err());
    let mut external = task("fast", 100);
    external.location = ExecutionLocation::Hosted;
    assert!(worker.submit(external).is_err());
    let expired = worker.submit(task("stall", 20)).unwrap();
    assert!(matches!(outcome(expired).await, JobStatus::Expired));
    let cancelled = worker.submit(task("stall", 1000)).unwrap();
    cancelled.cancel();
    assert!(matches!(outcome(cancelled).await, JobStatus::Cancelled));
    let crashed = worker.submit(task("crash", 1000)).unwrap();
    assert!(matches!(outcome(crashed).await, JobStatus::Failed { .. }));
    assert!(matches!(
        outcome(worker.submit(task("fast", 1000)).unwrap()).await,
        JobStatus::Completed { .. }
    ));
    worker.pause();
    assert!(worker.submit(task("fast", 100)).is_err());
    worker.resume();
    worker.disable();
    assert!(worker.submit(task("fast", 100)).is_err());
}

#[tokio::test]
async fn saturated_and_failing_optional_workers_leave_plan_and_note_saves_responsive() {
    let root = tempfile::tempdir().unwrap();
    let state = AppState::for_test(root.path());
    let worker = Arc::new(host(2));
    worker.enable();
    state
        .modules
        .register("processing", worker.clone())
        .unwrap();
    let router = app(state);
    let stalled = worker.submit(task("stall", 2000)).unwrap();
    for _ in 0..50 {
        if matches!(stalled.status(), JobStatus::Running) {
            break;
        }
        tokio::time::sleep(Duration::from_millis(1)).await;
    }
    let queued = worker.submit(task("stall", 2000)).unwrap();
    let queued_second = worker.submit(task("stall", 2000)).unwrap();
    assert!(worker.submit(task("fast", 100)).is_err());
    let mut latencies = Vec::new();
    for n in 0..30 {
        let start = Instant::now();
        let (status, body) = common::request(
            &router,
            "POST",
            "/blocks",
            Some(json!({"label":format!("Work {n}"),"start":"09:00","duration":5})),
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{body}");
        let today = deepblock_server::models::today_string();
        assert_eq!(
            common::request(
                &router,
                "PUT",
                &format!("/notes/{today}"),
                Some(json!({"content":format!("Note {n}")}))
            )
            .await
            .0,
            StatusCode::OK
        );
        latencies.push(start.elapsed().as_millis());
    }
    latencies.sort_unstable();
    eprintln!(
        "optional-worker saturation: combined plan+note endpoint p95={}ms (30 saves)",
        latencies[28]
    );
    // A generous local regression ceiling, distinct from production UI budgets.
    assert!(
        latencies[28] < 250,
        "planning blocked by optional processing: {latencies:?}"
    );
    worker.disable();
    assert!(matches!(outcome(stalled).await, JobStatus::Cancelled));
    assert!(matches!(outcome(queued).await, JobStatus::Cancelled));
    assert!(matches!(outcome(queued_second).await, JobStatus::Cancelled));
    worker.enable();
    let crashed = worker.submit(task("crash", 1000)).unwrap();
    assert!(matches!(outcome(crashed).await, JobStatus::Failed { .. }));
    let cpu = worker.submit(task("cpu", 1000)).unwrap();
    assert_eq!(
        common::request(&router, "GET", "/plan/today", None).await.0,
        StatusCode::OK
    );
    assert!(matches!(outcome(cpu).await, JobStatus::Completed { .. }));
    let (_, health) = common::request(&router, "GET", "/modules", None).await;
    assert_eq!(health["modules"][1]["state"], "degraded");
    assert_eq!(health["modules"][0]["state"], "unconfigured");
    worker.shutdown();
}
