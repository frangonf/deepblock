use deepblock_server::{app, models::DayPlan, state::AppState};
use serde_json::{Value, json};
use std::process::Command;
async fn run_cli(endpoint: &str, args: &[&str]) -> String {
    let arguments: Vec<String> = ["--server", endpoint]
        .into_iter()
        .chain(args.iter().copied())
        .map(str::to_string)
        .collect();
    let joined = arguments.join(" ");
    let output = tokio::task::spawn_blocking(move || {
        Command::new(env!("CARGO_BIN_EXE_deepb"))
            .args(&arguments)
            .output()
            .expect("cli binary runs")
    })
    .await
    .expect("spawn");
    assert!(
        output.status.success(),
        "deepb {joined} failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8_lossy(&output.stdout).into_owned()
}

async fn plan_json(endpoint: &str) -> Value {
    let stdout = run_cli(endpoint, &["--json", "list"]).await;
    serde_json::from_str(stdout.trim()).expect("plan JSON parses")
}

fn active_blocks(plan: &Value) -> &Vec<Value> {
    plan["revisions"]
        .as_array()
        .and_then(|revisions| revisions.last())
        .and_then(|revision| revision["blocks"].as_array())
        .expect("plan has an active revision with blocks")
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn real_cli_prints_and_roundtrips_core_flows() {
    let today = deepblock_server::models::today_string();
    let root = tempfile::tempdir().unwrap();
    let state = AppState::for_test(root.path());
    let mut plan = DayPlan::new(&today);
    let mut block = deepblock_server::models::Block::from_request(
        serde_json::from_value(json!({"label":"Work","start":"09:00","duration":60})).unwrap(),
        &[],
    );
    block.id = "seeded".into();
    plan.active_revision_mut().unwrap().blocks.push(block);
    state.save_plan(&plan).unwrap();

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let endpoint = format!("http://{}", listener.local_addr().unwrap());
    let router = app(state.clone());
    let server = tokio::spawn(async move {
        axum::serve(listener, router).await.unwrap();
    });

    // Human-readable plan and status output.
    let stdout = run_cli(&endpoint, &["list"]).await;
    assert!(
        stdout.contains(&format!("DeepBlock {today}")),
        "got: {stdout}"
    );
    assert!(stdout.contains("09:00 Work (60 min"), "got: {stdout}");

    let stdout = run_cli(&endpoint, &["status"]).await;
    assert!(stdout.contains("status: ok (v"), "got: {stdout}");

    // JSON output round-trips the stored plan.
    let plan = plan_json(&endpoint).await;
    assert_eq!(plan["date"], today.as_str());
    let active = active_blocks(&plan);
    assert_eq!(active[0]["start"], "09:00");
    assert_eq!(active[0]["label"], "Work");

    // Add sends every request field to the server.
    let stdout = run_cli(
        &endpoint,
        &[
            "add",
            "Deep work",
            "--start",
            "11:00",
            "--duration",
            "45",
            "--type",
            "focus",
        ],
    )
    .await;
    assert!(
        stdout.contains("11:00 Deep work (45 min, Focus)"),
        "got: {stdout}"
    );

    // Move swaps order in both directions.
    let current = plan_json(&endpoint).await;
    let ids: Vec<String> = active_blocks(&current)
        .iter()
        .map(|block| block["id"].as_str().unwrap().to_string())
        .collect();
    assert_eq!(ids.len(), 2, "seeded and added blocks are both active");
    run_cli(&endpoint, &["move", &ids[1], "up"]).await;
    let moved_plan = plan_json(&endpoint).await;
    assert_eq!(active_blocks(&moved_plan)[0]["id"], ids[1].as_str());
    run_cli(&endpoint, &["move", &ids[1], "down"]).await;
    let restored_plan = plan_json(&endpoint).await;
    assert_eq!(active_blocks(&restored_plan)[0]["id"], ids[0].as_str());

    // Single-flag outcome invocations stay valid (each flag alone is enough).
    run_cli(&endpoint, &["outcome", "seeded", "--actual-duration", "30"]).await;
    run_cli(&endpoint, &["outcome", "seeded", "--completed", "true"]).await;

    // Backlog lifecycle prints real rows in both formats.
    let stdout = run_cli(&endpoint, &["--json", "backlog", "add", "Side task"]).await;
    let backlog: Value = serde_json::from_str(stdout.trim()).expect("backlog JSON parses");
    let task_id = backlog[0]["id"].as_str().unwrap().to_string();
    assert_eq!(backlog[0]["label"], "Side task");

    let stdout = run_cli(&endpoint, &["backlog", "list"]).await;
    assert!(stdout.contains("Side task"), "got: {stdout}");

    run_cli(
        &endpoint,
        &["--json", "backlog", "update", &task_id, "done"],
    )
    .await;
    let stdout = run_cli(&endpoint, &["backlog", "list"]).await;
    assert!(stdout.contains("Done"), "got: {stdout}");

    run_cli(&endpoint, &["--json", "backlog", "delete", &task_id]).await;
    let stdout = run_cli(&endpoint, &["backlog", "list"]).await;
    assert!(stdout.contains("Backlog is empty"), "got: {stdout}");

    // Mode round-trips a non-default value.
    let stdout = run_cli(&endpoint, &["--json", "mode", "focus"]).await;
    let mode: Value = serde_json::from_str(stdout.trim()).expect("mode JSON parses");
    assert_eq!(mode["mode"], "focus");
    let stdout = run_cli(&endpoint, &["--json", "mode"]).await;
    let mode: Value = serde_json::from_str(stdout.trim()).expect("mode JSON parses");
    assert_eq!(mode["mode"], "focus");

    // Partial config updates succeed; full updates persist every field.
    run_cli(
        &endpoint,
        &["config", "set", "--notifications-enabled", "true"],
    )
    .await;
    run_cli(
        &endpoint,
        &[
            "config",
            "set",
            "--notifications-enabled",
            "false",
            "--notify-minutes-before",
            "10",
            "--notify-on-block-start",
            "false",
            "--notify-on-block-end",
            "false",
        ],
    )
    .await;
    let stdout = run_cli(&endpoint, &["--json", "config", "get"]).await;
    let config: Value = serde_json::from_str(stdout.trim()).expect("config JSON parses");
    assert_eq!(config["notifications_enabled"], false);
    assert_eq!(config["notify_minutes_before"], 10);
    assert_eq!(config["notify_on_block_start"], false);
    assert_eq!(config["notify_on_block_end"], false);

    // Review prints its summary header.
    let stdout = run_cli(&endpoint, &["review"]).await;
    assert!(stdout.contains("Plan review"), "got: {stdout}");
    assert!(stdout.contains("report(s)"), "got: {stdout}");

    server.abort();
}
