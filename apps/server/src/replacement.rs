//! Recoverable live replacement across SQLite and managed Markdown files.
use crate::{
    bundle,
    config::DeepBlockPaths,
    error::AppResult,
    persist,
    storage::{PlanningStore, PortablePlanning},
};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
};
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Journal {
    generation: String,
}
fn journal(paths: &DeepBlockPaths) -> PathBuf {
    paths.data_root.join("replacement.json")
}
fn staged_backup(paths: &DeepBlockPaths) -> PathBuf {
    paths.data_root.join("replacement-backup.zip")
}
pub fn recovery_path(paths: &DeepBlockPaths) -> PathBuf {
    paths.data_root.join("recovery.zip")
}

pub fn retarget(portable: &mut PortablePlanning, paths: &DeepBlockPaths) {
    let source = Path::new(&portable.managed_note_root);
    let destination = paths.notes_dir();
    let remap = |value: &mut String| {
        let path = Path::new(value);
        let Some(date) = path.file_stem().and_then(|v| v.to_str()) else {
            return;
        };
        if crate::models::validate_date_param(date).is_ok()
            && path == source.join(format!("{date}.md"))
        {
            *value = destination
                .join(format!("{date}.md"))
                .to_string_lossy()
                .into_owned();
        }
    };
    for day in portable.days.values_mut() {
        for plan in std::iter::once(&mut day.plan).chain(
            day.history
                .iter_mut()
                .flat_map(|h| h.undo.iter_mut().chain(h.redo.iter_mut())),
        ) {
            if let Some(value) = &mut plan.note_path {
                remap(value);
            }
            for block in plan.revisions.iter_mut().flat_map(|r| &mut r.blocks) {
                if let Some(value) = &mut block.content_path {
                    remap(value);
                }
                for value in &mut block.artifacts {
                    remap(value);
                }
            }
        }
    }
    // Relocate physical locators, preserving snapshot IDs, timestamps and meaning.
    for block in portable.intents.iter_mut().flat_map(|i| &mut i.blocks) {
        if let Some(value) = &mut block.content_path {
            remap(value);
        }
        for value in &mut block.artifacts {
            remap(value);
        }
    }
    portable.managed_note_root = destination.to_string_lossy().into_owned();
}
fn apply_notes(paths: &DeepBlockPaths, portable: &PortablePlanning) -> AppResult<()> {
    for entry in fs::read_dir(paths.notes_dir())? {
        let entry = entry?;
        let path = entry.path();
        if path.extension().is_some_and(|s| s == "md") {
            let date = path.file_stem().and_then(|s| s.to_str()).unwrap_or("");
            if crate::models::validate_date_param(date).is_ok()
                && !portable.notes.contains_key(date)
            {
                fs::remove_file(path)?;
            }
        }
    }
    for (date, content) in &portable.notes {
        persist::write_text_file(&paths.note_file(date), content)?;
    }
    bundle::sync_dir(&paths.notes_dir())
}
/// Must finish before reopening the API, both at startup and after a failed operation.
pub fn recover(paths: &DeepBlockPaths, store: &PlanningStore) -> AppResult<()> {
    if !journal(paths).exists() {
        return Ok(());
    }
    let marker: Journal = persist::read_json_file(&journal(paths))?;
    if store.generation()? == marker.generation {
        if staged_backup(paths).exists() {
            fs::rename(staged_backup(paths), recovery_path(paths))?;
            bundle::sync_dir(&paths.data_root)?;
        }
    } else {
        let original = bundle::read(&staged_backup(paths))?;
        apply_notes(paths, &original)?;
    }
    fs::remove_file(journal(paths))?;
    bundle::sync_dir(&paths.data_root)?;
    if staged_backup(paths).exists() {
        fs::remove_file(staged_backup(paths))?;
    }
    Ok(())
}
pub fn replace(
    paths: &DeepBlockPaths,
    store: &PlanningStore,
    mut incoming: PortablePlanning,
) -> AppResult<String> {
    incoming.validate()?;
    recover(paths, store)?;
    if staged_backup(paths).exists() {
        fs::remove_file(staged_backup(paths))?;
    }
    bundle::write(&staged_backup(paths), &store.export(paths)?)?;
    let generation = uuid::Uuid::new_v4().to_string();
    persist::write_json_pretty(
        &journal(paths),
        &Journal {
            generation: generation.clone(),
        },
    )?;
    bundle::sync_dir(&paths.data_root)?;
    retarget(&mut incoming, paths);
    let result = apply_notes(paths, &incoming).and_then(|()| store.replace(&incoming, &generation));
    // Once SQL committed, report success after completing journal promotion. If
    // cleanup fails, leave the journal for startup recovery and fail closed.
    match result {
        Ok(()) => {
            recover(paths, store)?;
            Ok(generation)
        }
        Err(error) => {
            recover(paths, store)?;
            Err(error)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::AppState;
    #[test]
    fn startup_rolls_back_partial_notes_and_finalizes_committed_replacement() {
        for committed in [false, true] {
            let dir = tempfile::tempdir().unwrap();
            let state = AppState::for_test(dir.path());
            state.save_note("2026-01-05", "Original").unwrap();
            let store = state.planning_store().unwrap();
            let mut incoming = store.export(&state.paths).unwrap();
            bundle::write(&staged_backup(&state.paths), &incoming).unwrap();
            let generation = uuid::Uuid::new_v4().to_string();
            persist::write_json_pretty(
                &journal(&state.paths),
                &Journal {
                    generation: generation.clone(),
                },
            )
            .unwrap();
            incoming
                .notes
                .insert("2026-01-05".into(), "Replacement".into());
            apply_notes(&state.paths, &incoming).unwrap();
            if committed {
                store.replace(&incoming, &generation).unwrap();
            }
            let paths = state.paths.clone();
            drop(state);
            let restarted = PlanningStore::open(&paths).unwrap();
            assert_eq!(
                restarted.export(&paths).unwrap().notes["2026-01-05"],
                if committed { "Replacement" } else { "Original" }
            );
            assert!(!journal(&paths).exists());
            assert_eq!(recovery_path(&paths).exists(), committed);
        }
    }
    #[test]
    fn retarget_only_moves_date_files_under_the_managed_root() {
        use crate::models::{AddBlockRequest, Block};
        use crate::storage::{PortablePlanning, StoredDayPlan};

        let dir = tempfile::tempdir().unwrap();
        let state = AppState::for_test(dir.path());
        let paths = state.paths.clone();
        let mut plan = crate::models::DayPlan::new("2026-01-05");
        plan.note_path = Some("imported-notes/2026-01-05.md".into());
        let block = |content_path: &str| {
            let request = AddBlockRequest {
                label: "Work".into(),
                start: "09:00".into(),
                duration: 60,
                ..Default::default()
            };
            let mut block = Block::from_request(request, &[]);
            block.content_path = Some(content_path.into());
            block
        };
        plan.revisions[0].blocks = vec![
            block("imported-notes/2026-01-05.md"),
            block("elsewhere/notes/2026-01-05.md"),
            block("imported-notes/README.md"),
        ];
        let mut portable = PortablePlanning {
            format_version: 1,
            days: std::collections::BTreeMap::from([(
                "2026-01-05".into(),
                StoredDayPlan {
                    plan,
                    history: None,
                },
            )]),
            resources: std::collections::BTreeMap::new(),
            intents: Vec::new(),
            notes: std::collections::BTreeMap::new(),
            managed_note_root: "imported-notes".into(),
            configuration: None,
        };
        retarget(&mut portable, &paths);
        let plan = &portable.days["2026-01-05"].plan;
        let expected = paths
            .notes_dir()
            .join("2026-01-05.md")
            .to_string_lossy()
            .into_owned();
        assert_eq!(plan.note_path.as_deref(), Some(expected.as_str()));
        let content_paths: Vec<_> = plan.revisions[0]
            .blocks
            .iter()
            .map(|b| b.content_path.as_deref().unwrap())
            .collect();
        assert_eq!(content_paths[0], expected);
        assert_eq!(content_paths[1], "elsewhere/notes/2026-01-05.md");
        assert_eq!(content_paths[2], "imported-notes/README.md");
    }

    #[test]
    fn apply_notes_keeps_non_date_markdown_files() {
        use crate::storage::PortablePlanning;

        let dir = tempfile::tempdir().unwrap();
        let state = AppState::for_test(dir.path());
        let paths = state.paths.clone();
        fs::write(paths.notes_dir().join("README.md"), "keep me").unwrap();
        fs::write(paths.notes_dir().join("2026-01-05.md"), "stale").unwrap();
        let portable = PortablePlanning {
            format_version: 1,
            days: std::collections::BTreeMap::new(),
            resources: std::collections::BTreeMap::new(),
            intents: Vec::new(),
            notes: std::collections::BTreeMap::from([("2026-01-06".into(), "fresh".into())]),
            managed_note_root: paths.notes_dir().to_string_lossy().into_owned(),
            configuration: None,
        };
        apply_notes(&paths, &portable).unwrap();
        assert_eq!(
            fs::read_to_string(paths.notes_dir().join("README.md")).unwrap(),
            "keep me",
            "non-date markdown is not imported content and must survive"
        );
        assert!(
            !paths.notes_dir().join("2026-01-05.md").exists(),
            "stale date notes are removed"
        );
        assert_eq!(
            fs::read_to_string(paths.notes_dir().join("2026-01-06.md")).unwrap(),
            "fresh"
        );
    }

    #[test]
    fn failed_sql_commit_restores_notes_and_preserves_previous_recovery() {
        let dir = tempfile::tempdir().unwrap();
        let state = AppState::for_test(dir.path());
        state.save_note("2026-01-05", "Original").unwrap();
        let store = state.planning_store().unwrap();
        let original = store.export(&state.paths).unwrap();
        bundle::write(&recovery_path(&state.paths), &original).unwrap();
        let before = fs::read(recovery_path(&state.paths)).unwrap();
        let mut incoming = original.clone();
        incoming.notes.clear();
        let connection = rusqlite::Connection::open(PlanningStore::path(&state.paths)).unwrap();
        connection.execute_batch("CREATE TRIGGER fail_generation BEFORE UPDATE ON dataset BEGIN SELECT RAISE(ABORT,'Injected failure'); END;").unwrap();
        assert!(replace(&state.paths, store, incoming).is_err());
        assert_eq!(store.export(&state.paths).unwrap(), original);
        assert_eq!(fs::read(recovery_path(&state.paths)).unwrap(), before);
    }
}
