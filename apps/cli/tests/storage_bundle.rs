use deepblock_server::{
    config::{DeepBlockPaths, Settings},
    persist,
    state::AppState,
};
use std::{path::Path, process::Command};
fn cli(root: &Path) -> Command {
    let mut command = Command::new(env!("CARGO_BIN_EXE_deepb"));
    command
        .env("XDG_DATA_HOME", root.join("data"))
        .env("XDG_CONFIG_HOME", root.join("config"))
        .env("XDG_STATE_HOME", root.join("state"));
    command
}
#[test]
fn real_cli_exports_and_imports_zip_and_legacy_json() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().join("source");
    let paths = DeepBlockPaths::from_roots(
        root.join("data/deepblock"),
        root.join("config/deepblock"),
        root.join("state/deepblock"),
    );
    paths.ensure_dirs().unwrap();
    let state = AppState::new(paths.clone(), Settings::default());
    let plan = state.load_plan("2026-01-05").unwrap();
    state.save_plan(&plan).unwrap();
    state.save_note(&plan.date, "# CLI 🦀\n").unwrap();
    persist::write_toml_file(&paths.config_file(), &Settings::default()).unwrap();
    let expected = state.planning_store().unwrap().export(&paths).unwrap();
    drop(state);
    for extension in ["zip", "json"] {
        let source = dir.path().join(format!("export.{extension}"));
        let output = cli(&root)
            .args(["storage", "export"])
            .arg(&source)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        let destination = dir.path().join(format!("restored-{extension}"));
        let output = cli(&root)
            .args(["storage", "import"])
            .arg(&source)
            .arg(&destination)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        let restored_paths = DeepBlockPaths::from_roots(
            destination.join("data/deepblock"),
            destination.join("config/deepblock"),
            destination.join("state/deepblock"),
        );
        let store = deepblock_server::storage::PlanningStore::open(&restored_paths).unwrap();
        let mut normalized = expected.clone();
        deepblock_server::replacement::retarget(&mut normalized, &restored_paths);
        assert_eq!(store.export(&restored_paths).unwrap(), normalized);
    }
}
