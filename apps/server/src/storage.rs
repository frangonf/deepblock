//! Canonical structured planning storage. Never shared with observation workers.
use crate::{
    config::DeepBlockPaths,
    context::{ContextCatalog, IntentSnapshot},
    error::{AppError, AppResult},
    history::PlanHistory,
    models::{Backlog, DayPlan, GlobalState, validate_date_param},
    persist,
};
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
    time::Duration,
};

pub const STORAGE_VERSION: u32 = 1;
pub const DATABASE_VERSION: u32 = 2;

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct StoredDayPlan {
    #[serde(flatten)]
    pub plan: DayPlan,
    #[serde(default, rename = "_history")]
    pub history: Option<PlanHistory>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct PortablePlanning {
    pub format_version: u32,
    #[serde(deserialize_with = "unique_map")]
    pub days: BTreeMap<String, StoredDayPlan>,
    #[serde(deserialize_with = "unique_map")]
    pub resources: BTreeMap<String, Value>,
    pub intents: Vec<IntentSnapshot>,
    #[serde(deserialize_with = "unique_map")]
    pub notes: BTreeMap<String, String>,
    pub managed_note_root: String,
    pub configuration: Option<String>,
}

impl PortablePlanning {
    pub fn validate(&self) -> AppResult<()> {
        if self.format_version != STORAGE_VERSION {
            return Err(AppError::BadRequest(
                "Unsupported portable format version".into(),
            ));
        }
        let catalog: ContextCatalog = serde_json::from_value(
            self.resources
                .get("context")
                .cloned()
                .unwrap_or(serde_json::to_value(ContextCatalog::default())?),
        )?;
        catalog.validate()?;
        for (key, value) in &self.resources {
            match key.as_str() {
                "context" => {}
                "backlog" => {
                    let _: Vec<Backlog> = serde_json::from_value(value.clone())?;
                }
                "global" => {
                    let _: GlobalState = serde_json::from_value(value.clone())?;
                }
                _ => return Err(AppError::BadRequest("Unknown portable resource".into())),
            }
        }
        for (date, day) in &self.days {
            validate_date_param(date)?;
            validate_plan(date, &day.plan)?;
            if let Some(history) = &day.history {
                for plan in history.undo.iter().chain(&history.redo) {
                    validate_plan(date, plan)?;
                }
            }
            for block in day
                .plan
                .active_revision()
                .into_iter()
                .flat_map(|r| &r.blocks)
            {
                validate_associations(&block.metadata, &catalog)?;
            }
        }
        let mut versions = BTreeSet::new();
        for intent in &self.intents {
            if intent.schema_version != 1
                || uuid::Uuid::parse_str(&intent.version).is_err()
                || !versions.insert(&intent.version)
                || !self.days.contains_key(&intent.date)
                || chrono::DateTime::parse_from_rfc3339(&intent.recorded_at).is_err()
            {
                return Err(AppError::BadRequest(
                    "Invalid portable intent snapshot".into(),
                ));
            }
        }
        for date in self.notes.keys() {
            validate_date_param(date)?;
        }
        if let Some(configuration) = &self.configuration {
            let _: crate::config::Settings = toml::from_str(configuration)?;
        }
        Ok(())
    }
}

fn validate_plan(date: &str, plan: &DayPlan) -> AppResult<()> {
    if plan.date != date || plan.schema_version != 1 || plan.revisions.is_empty() {
        return Err(AppError::BadRequest(
            "Invalid daily plan date or schema".into(),
        ));
    }
    let mut revisions = BTreeSet::new();
    for revision in &plan.revisions {
        if revision.id.is_empty() || !revisions.insert(&revision.id) {
            return Err(AppError::BadRequest(
                "Duplicate or empty revision identity".into(),
            ));
        }
        let mut blocks = BTreeSet::new();
        for block in &revision.blocks {
            if block.id.is_empty() || !blocks.insert(&block.id) {
                return Err(AppError::BadRequest(
                    "Duplicate or empty block identity".into(),
                ));
            }
        }
    }
    Ok(())
}

pub fn validate_associations(
    metadata: &BTreeMap<String, Value>,
    catalog: &ContextCatalog,
) -> AppResult<()> {
    for (key, ids) in [
        (
            "project_id",
            catalog
                .projects
                .iter()
                .map(|p| p.id.as_str())
                .collect::<Vec<_>>(),
        ),
        (
            "goal_id",
            catalog.goals.iter().map(|g| g.id.as_str()).collect(),
        ),
    ] {
        if let Some(value) = metadata.get(key) {
            if value.is_null() {
                continue;
            }
            if !value.as_str().is_some_and(|id| ids.contains(&id)) {
                return Err(AppError::BadRequest(format!("Unresolved {key}")));
            }
        }
    }
    Ok(())
}

pub struct PlanningStore {
    connection: Mutex<Connection>,
}

impl PlanningStore {
    pub fn path(paths: &DeepBlockPaths) -> PathBuf {
        paths.data_root.join("planning.sqlite3")
    }

    pub fn open(paths: &DeepBlockPaths) -> AppResult<Self> {
        let target = Self::path(paths);
        if !target.exists() {
            let legacy = read_legacy(paths)?;
            Self::activate(paths, &legacy)?;
        }
        let connection =
            Connection::open_with_flags(&target, rusqlite::OpenFlags::SQLITE_OPEN_READ_WRITE)?;
        connection.busy_timeout(Duration::from_secs(2))?;
        connection.execute_batch("PRAGMA foreign_keys=ON; PRAGMA synchronous=FULL;")?;
        let version: u32 = connection.query_row("PRAGMA user_version", [], |r| r.get(0))?;
        if version == 1 {
            connection.execute_batch("BEGIN IMMEDIATE; CREATE TABLE dataset (singleton INTEGER PRIMARY KEY CHECK(singleton=1), generation TEXT NOT NULL); PRAGMA user_version=2;")?;
            connection.execute(
                "INSERT INTO dataset VALUES (1,?1)",
                [uuid::Uuid::new_v4().to_string()],
            )?;
            connection.execute_batch("COMMIT")?;
        } else if version != DATABASE_VERSION {
            return Err(AppError::BadRequest(
                "Unsupported planning database version".into(),
            ));
        }
        let check: String = connection.query_row("PRAGMA quick_check", [], |r| r.get(0))?;
        if check != "ok" {
            return Err(AppError::BadRequest(
                "Planning database integrity check failed".into(),
            ));
        }
        let store = Self {
            connection: Mutex::new(connection),
        };
        crate::replacement::recover(paths, &store)?;
        Ok(store)
    }

    fn lock(&self) -> AppResult<std::sync::MutexGuard<'_, Connection>> {
        self.connection
            .lock()
            .map_err(|_| std::io::Error::other("Planning storage lock poisoned").into())
    }

    fn activate(paths: &DeepBlockPaths, portable: &PortablePlanning) -> AppResult<()> {
        portable.validate()?;
        fs::create_dir_all(&paths.data_root)?;
        let staged = tempfile::NamedTempFile::new_in(&paths.data_root)?;
        {
            let mut connection = Connection::open(staged.path())?;
            connection.execute_batch("PRAGMA foreign_keys=ON; PRAGMA synchronous=FULL;")?;
            let transaction = connection.transaction()?;
            transaction.execute_batch(include_str!("planning-schema.sql"))?;
            transaction.execute(
                "INSERT INTO dataset VALUES (1,?1)",
                [uuid::Uuid::new_v4().to_string()],
            )?;
            for (date, day) in &portable.days {
                transaction.execute(
                    "INSERT INTO days VALUES (?1, ?2)",
                    params![date, serde_json::to_string(day)?],
                )?;
            }
            for (key, document) in &portable.resources {
                transaction.execute(
                    "INSERT INTO resources VALUES (?1, ?2)",
                    params![key, document.to_string()],
                )?;
            }
            for intent in &portable.intents {
                insert_intent(&transaction, intent)?;
            }
            transaction.commit()?;
            // Verify what SQLite actually retained before publishing it.
            let retained = read_structured(&connection)?;
            if retained.0 != portable.days
                || retained.1 != portable.resources
                || retained.2 != portable.intents
            {
                return Err(AppError::BadRequest("Migration verification failed".into()));
            }
            let result: String =
                connection.query_row("PRAGMA integrity_check", [], |r| r.get(0))?;
            if result != "ok" {
                return Err(AppError::BadRequest(
                    "Migration integrity check failed".into(),
                ));
            }
        }
        staged.as_file().sync_all()?;
        staged
            .persist_noclobber(Self::path(paths))
            .map_err(|e| e.error)?;
        #[cfg(unix)]
        fs::File::open(&paths.data_root)?.sync_all()?;
        Ok(())
    }

    pub fn load_day(&self, date: &str) -> AppResult<Option<StoredDayPlan>> {
        validate_date_param(date)?;
        let document: Option<String> = self
            .lock()?
            .query_row("SELECT document FROM days WHERE date=?1", [date], |r| {
                r.get(0)
            })
            .optional()?;
        document
            .map(|s| serde_json::from_str(&s).map_err(Into::into))
            .transpose()
    }

    pub fn generation(&self) -> AppResult<String> {
        Ok(self.lock()?.query_row(
            "SELECT generation FROM dataset WHERE singleton=1",
            [],
            |row| row.get(0),
        )?)
    }

    /// Called under exclusive maintenance ownership. Does not append intent.
    pub(crate) fn replace(&self, portable: &PortablePlanning, generation: &str) -> AppResult<()> {
        portable.validate()?;
        let mut connection = self.lock()?;
        let transaction = connection.transaction()?;
        transaction
            .execute_batch("DELETE FROM intents; DELETE FROM days; DELETE FROM resources;")?;
        for (date, day) in &portable.days {
            transaction.execute(
                "INSERT INTO days VALUES (?1,?2)",
                params![date, serde_json::to_string(day)?],
            )?;
        }
        for (key, document) in &portable.resources {
            transaction.execute(
                "INSERT INTO resources VALUES (?1,?2)",
                params![key, document.to_string()],
            )?;
        }
        for intent in &portable.intents {
            insert_intent(&transaction, intent)?;
        }
        transaction.execute(
            "UPDATE dataset SET generation=?1 WHERE singleton=1",
            [generation],
        )?;
        let retained = read_structured(&transaction)?;
        if retained
            != (
                portable.days.clone(),
                portable.resources.clone(),
                portable.intents.clone(),
            )
        {
            return Err(AppError::BadRequest(
                "Replacement verification failed".into(),
            ));
        }
        transaction.commit()?;
        Ok(())
    }

    pub fn commit_day(&self, day: &StoredDayPlan) -> AppResult<()> {
        validate_plan(&day.plan.date, &day.plan)?;
        let mut connection = self.lock()?;
        let transaction = connection.transaction()?;
        let catalog: ContextCatalog = read_resource(&transaction, "context")?.unwrap_or_default();
        for block in day
            .plan
            .active_revision()
            .into_iter()
            .flat_map(|r| &r.blocks)
        {
            validate_associations(&block.metadata, &catalog)?;
        }
        transaction.execute("INSERT INTO days(date,document) VALUES (?1,?2) ON CONFLICT(date) DO UPDATE SET document=excluded.document", params![day.plan.date, serde_json::to_string(day)?])?;
        append_changed_intent(&transaction, &day.plan, &catalog)?;
        transaction.commit()?;
        Ok(())
    }

    pub fn load_resource<T: serde::de::DeserializeOwned>(&self, key: &str) -> AppResult<Option<T>> {
        read_resource(&*self.lock()?, key)
    }

    pub fn save_resource<T: Serialize + ?Sized>(&self, key: &str, value: &T) -> AppResult<()> {
        self.lock()?.execute("INSERT INTO resources(key,document) VALUES (?1,?2) ON CONFLICT(key) DO UPDATE SET document=excluded.document", params![key, serde_json::to_string(value)?])?;
        Ok(())
    }

    pub fn days_between(&self, start: &str, end: &str) -> AppResult<Vec<DayPlan>> {
        crate::range_review::validate_range(start, end)?;
        let connection = self.lock()?;
        let mut statement = connection
            .prepare("SELECT document FROM days WHERE date >= ?1 AND date <= ?2 ORDER BY date")?;
        let mut days = Vec::new();
        for row in statement.query_map(params![start, end], |r| r.get::<_, String>(0))? {
            days.push(serde_json::from_str::<StoredDayPlan>(&row?)?.plan);
        }
        Ok(days)
    }

    pub fn export(&self, paths: &DeepBlockPaths) -> AppResult<PortablePlanning> {
        let mut connection = self.lock()?;
        let transaction = connection.transaction()?;
        let (days, resources, intents) = read_structured(&transaction)?;
        let mut portable = PortablePlanning {
            format_version: 1,
            days,
            resources,
            intents,
            notes: read_notes(paths)?,
            managed_note_root: paths.notes_dir().to_string_lossy().into_owned(),
            configuration: paths
                .config_file()
                .exists()
                .then(|| fs::read_to_string(paths.config_file()))
                .transpose()?,
        };
        portable.validate()?;
        // Paths in exports remain source references until restore retargets managed notes.
        transaction.commit()?;
        portable.intents.shrink_to_fit();
        Ok(portable)
    }

    pub fn update_catalog(
        &self,
        expected: &ContextCatalog,
        catalog: &ContextCatalog,
    ) -> AppResult<()> {
        catalog.validate()?;
        let mut connection = self.lock()?;
        let transaction = connection.transaction()?;
        let current: ContextCatalog = read_resource(&transaction, "context")?.unwrap_or_default();
        if &current != expected {
            return Err(AppError::Conflict(
                "Context changed; reload before saving".into(),
            ));
        }
        if current
            .projects
            .iter()
            .any(|p| !catalog.projects.iter().any(|n| n.id == p.id))
            || current
                .goals
                .iter()
                .any(|g| !catalog.goals.iter().any(|n| n.id == g.id))
        {
            return Err(AppError::BadRequest(
                "Existing context identities must be retained".into(),
            ));
        }
        transaction.execute("INSERT INTO resources(key,document) VALUES ('context',?1) ON CONFLICT(key) DO UPDATE SET document=excluded.document", [serde_json::to_string(catalog)?])?;
        for day in read_structured(&transaction)?.0.into_values() {
            append_changed_intent(&transaction, &day.plan, catalog)?;
        }
        transaction.commit()?;
        Ok(())
    }

    pub fn intents(&self, date: &str) -> AppResult<Vec<IntentSnapshot>> {
        validate_date_param(date)?;
        let connection = self.lock()?;
        let mut statement =
            connection.prepare("SELECT document FROM intents WHERE date=?1 ORDER BY sequence")?;
        let mut snapshots = Vec::new();
        for row in statement.query_map([date], |r| r.get::<_, String>(0))? {
            snapshots.push(serde_json::from_str(&row?)?);
        }
        Ok(snapshots)
    }

    pub fn effective_intent(&self, date: &str, at: &str) -> AppResult<Option<IntentSnapshot>> {
        validate_date_param(date)?;
        let document: Option<String> = self.lock()?.query_row("SELECT document FROM intents WHERE date=?1 AND recorded_at<=?2 ORDER BY recorded_at DESC, sequence DESC LIMIT 1", params![date, at], |r| r.get(0)).optional()?;
        document
            .map(|s| serde_json::from_str(&s).map_err(Into::into))
            .transpose()
    }

    pub fn backup_database(&self, destination: &Path) -> AppResult<()> {
        self.lock()?.backup(
            "main",
            destination,
            Some(|_: rusqlite::backup::Progress| {}),
        )?;
        Ok(())
    }
}

fn read_resource<T: serde::de::DeserializeOwned>(
    connection: &Connection,
    key: &str,
) -> AppResult<Option<T>> {
    let document: Option<String> = connection
        .query_row("SELECT document FROM resources WHERE key=?1", [key], |r| {
            r.get(0)
        })
        .optional()?;
    document
        .map(|s| serde_json::from_str(&s).map_err(Into::into))
        .transpose()
}

fn insert_intent(connection: &Connection, intent: &IntentSnapshot) -> AppResult<()> {
    let timestamp = chrono::DateTime::parse_from_rfc3339(&intent.recorded_at)
        .map_err(|_| AppError::BadRequest("Invalid intent timestamp".into()))?
        .with_timezone(&chrono::Utc)
        .to_rfc3339_opts(chrono::SecondsFormat::Nanos, true);
    connection.execute(
        "INSERT INTO intents(version,date,recorded_at,document) VALUES (?1,?2,?3,?4)",
        params![
            intent.version,
            intent.date,
            timestamp,
            serde_json::to_string(intent)?
        ],
    )?;
    Ok(())
}

fn append_changed_intent(
    connection: &Connection,
    plan: &DayPlan,
    catalog: &ContextCatalog,
) -> AppResult<()> {
    let next = IntentSnapshot::capture(plan, catalog);
    let previous: Option<String> = connection
        .query_row(
            "SELECT document FROM intents WHERE date=?1 ORDER BY sequence DESC LIMIT 1",
            [&plan.date],
            |r| r.get(0),
        )
        .optional()?;
    if previous
        .map(|s| serde_json::from_str::<IntentSnapshot>(&s))
        .transpose()?
        .is_none_or(|p| !p.same_intent(&next))
    {
        insert_intent(connection, &next)?;
    }
    Ok(())
}

type StructuredData = (
    BTreeMap<String, StoredDayPlan>,
    BTreeMap<String, Value>,
    Vec<IntentSnapshot>,
);
fn read_structured(connection: &Connection) -> AppResult<StructuredData> {
    let mut days = BTreeMap::new();
    let mut statement = connection.prepare("SELECT date,document FROM days ORDER BY date")?;
    for row in statement.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))? {
        let (date, document) = row?;
        days.insert(date, serde_json::from_str(&document)?);
    }
    let mut resources = BTreeMap::new();
    let mut statement = connection.prepare("SELECT key,document FROM resources ORDER BY key")?;
    for row in statement.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))? {
        let (key, document) = row?;
        resources.insert(key, serde_json::from_str(&document)?);
    }
    let mut intents = Vec::new();
    let mut statement = connection.prepare("SELECT document FROM intents ORDER BY sequence")?;
    for row in statement.query_map([], |r| r.get::<_, String>(0))? {
        intents.push(serde_json::from_str(&row?)?);
    }
    Ok((days, resources, intents))
}

fn read_notes(paths: &DeepBlockPaths) -> AppResult<BTreeMap<String, String>> {
    let mut notes = BTreeMap::new();
    if paths.notes_dir().exists() {
        for entry in fs::read_dir(paths.notes_dir())? {
            let entry = entry?;
            let path = entry.path();
            if path.extension().is_some_and(|e| e == "md") {
                if !entry.file_type()?.is_file() {
                    return Err(AppError::BadRequest(
                        "Managed notes must be regular Markdown files".into(),
                    ));
                }
                let date = path
                    .file_stem()
                    .and_then(|s| s.to_str())
                    .ok_or_else(|| AppError::BadRequest("Invalid note name".into()))?;
                validate_date_param(date)?;
                notes.insert(date.to_string(), fs::read_to_string(path)?);
            }
        }
    }
    Ok(notes)
}

fn read_legacy(paths: &DeepBlockPaths) -> AppResult<PortablePlanning> {
    let mut days = BTreeMap::new();
    if paths.plan_dir().exists() {
        for entry in fs::read_dir(paths.plan_dir())? {
            let path = entry?.path();
            if path.extension().is_some_and(|e| e == "json") {
                let date = path
                    .file_stem()
                    .and_then(|s| s.to_str())
                    .ok_or_else(|| AppError::BadRequest("Invalid daily filename".into()))?;
                validate_date_param(date)?;
                let mut day: StoredDayPlan = persist::read_json_file(&path)?;
                if day.history.is_none() && paths.history_file(date).exists() {
                    day.history = Some(persist::read_json_file(&paths.history_file(date))?);
                }
                days.insert(date.to_string(), day);
            }
        }
    }
    if paths.state_root.exists() {
        for entry in fs::read_dir(&paths.state_root)? {
            let path = entry?.path();
            if let Some(date) = path
                .file_name()
                .and_then(|s| s.to_str())
                .and_then(|s| s.strip_prefix("history-"))
                .and_then(|s| s.strip_suffix(".json"))
            {
                validate_date_param(date)?;
                if !days.contains_key(date) {
                    days.insert(
                        date.to_string(),
                        StoredDayPlan {
                            plan: DayPlan::new(date),
                            history: Some(persist::read_json_file(&path)?),
                        },
                    );
                }
            }
        }
    }
    let mut resources = BTreeMap::new();
    for (key, path) in [
        ("backlog", paths.backlog_file()),
        ("global", paths.state_file()),
    ] {
        if path.exists() {
            resources.insert(key.into(), persist::read_json_file(&path)?);
        }
    }
    let intents = days
        .values()
        .map(|d| IntentSnapshot::capture(&d.plan, &ContextCatalog::default()))
        .collect();
    Ok(PortablePlanning {
        format_version: 1,
        days,
        resources,
        intents,
        notes: read_notes(paths)?,
        managed_note_root: paths.notes_dir().to_string_lossy().into_owned(),
        configuration: paths
            .config_file()
            .exists()
            .then(|| fs::read_to_string(paths.config_file()))
            .transpose()?,
    })
}

/// Offline commands own the same stable lock as the server. Never delete it.
pub fn offline_lock(paths: &DeepBlockPaths) -> AppResult<fs::File> {
    paths.ensure_dirs()?;
    let lock = fs::OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(paths.data_root.join("server.lock"))?;
    lock.try_lock().map_err(|e| {
        std::io::Error::other(format!(
            "Stop the storage owner before portability operations: {e}"
        ))
    })?;
    Ok(lock)
}

pub fn restore_new(destination: &Path, mut portable: PortablePlanning) -> AppResult<()> {
    portable.validate()?;
    if destination.exists() {
        return Err(AppError::Conflict(
            "Restore requires a new destination directory".into(),
        ));
    }
    let parent = destination
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .unwrap_or(Path::new("."));
    fs::create_dir_all(parent)?;
    let staged = tempfile::tempdir_in(parent)?;
    let staged_paths = DeepBlockPaths::from_roots(
        staged.path().join("data/deepblock"),
        staged.path().join("config/deepblock"),
        staged.path().join("state/deepblock"),
    );
    staged_paths.ensure_dirs()?;
    let final_root = if destination.is_absolute() {
        destination.to_path_buf()
    } else {
        std::env::current_dir()?.join(destination)
    };
    let final_paths = DeepBlockPaths::from_roots(
        final_root.join("data/deepblock"),
        final_root.join("config/deepblock"),
        final_root.join("state/deepblock"),
    );
    crate::replacement::retarget(&mut portable, &final_paths);
    for (date, content) in &portable.notes {
        persist::write_text_file(&staged_paths.note_file(date), content)?;
    }
    if let Some(configuration) = &portable.configuration {
        persist::write_text_file(&staged_paths.config_file(), configuration)?;
    }
    PlanningStore::activate(&staged_paths, &portable)?;
    sync_staged_tree(staged.path())?;
    fs::rename(staged.path(), destination)?;
    #[cfg(unix)]
    fs::File::open(parent)?.sync_all()?;
    Ok(())
}

pub fn export_offline(paths: &DeepBlockPaths, destination: &Path) -> AppResult<()> {
    let _owner = offline_lock(paths)?;
    if destination.exists() {
        return Err(AppError::Conflict(
            "Export destination already exists".into(),
        ));
    }
    let store = PlanningStore::open(paths)?;
    if destination
        .extension()
        .is_some_and(|extension| extension == "zip")
    {
        crate::bundle::write(destination, &store.export(paths)?)
    } else {
        persist::write_json_pretty(destination, &store.export(paths)?)
    }
}

pub fn backup_offline(paths: &DeepBlockPaths, destination: &Path) -> AppResult<()> {
    let _owner = offline_lock(paths)?;
    if destination.exists() {
        return Err(AppError::Conflict(
            "Backup destination already exists".into(),
        ));
    }
    let parent = destination
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .unwrap_or(Path::new("."));
    fs::create_dir_all(parent)?;
    let staged = tempfile::tempdir_in(parent)?;
    let store = PlanningStore::open(paths)?;
    store.backup_database(&staged.path().join("planning.sqlite3"))?;
    persist::write_json_pretty(&staged.path().join("manifest.json"), &store.export(paths)?)?;
    fs::File::open(staged.path().join("planning.sqlite3"))?.sync_all()?;
    sync_staged_tree(staged.path())?;
    fs::rename(staged.path(), destination)?;
    Ok(())
}

pub fn import_new(source: &Path, destination: &Path) -> AppResult<()> {
    restore_new(destination, crate::bundle::read(source)?)
}

pub fn restore_backup(source: &Path, destination: &Path) -> AppResult<()> {
    let portable: PortablePlanning = persist::read_json_file(&source.join("manifest.json"))?;
    portable.validate()?;
    let connection = Connection::open_with_flags(
        source.join("planning.sqlite3"),
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
    )?;
    let check: String = connection.query_row("PRAGMA integrity_check", [], |r| r.get(0))?;
    let (days, resources, intents) = read_structured(&connection)?;
    if check != "ok"
        || days != portable.days
        || resources != portable.resources
        || intents != portable.intents
    {
        return Err(AppError::BadRequest(
            "Backup database does not match its portable manifest".into(),
        ));
    }
    restore_new(destination, portable)
}

pub(crate) fn unique_map<'de, D, T>(deserializer: D) -> Result<BTreeMap<String, T>, D::Error>
where
    D: serde::Deserializer<'de>,
    T: Deserialize<'de>,
{
    struct UniqueMap<T>(std::marker::PhantomData<T>);
    impl<'de, T: Deserialize<'de>> serde::de::Visitor<'de> for UniqueMap<T> {
        type Value = BTreeMap<String, T>;
        fn expecting(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
            f.write_str("a map without duplicate keys")
        }
        fn visit_map<A: serde::de::MapAccess<'de>>(
            self,
            mut access: A,
        ) -> Result<Self::Value, A::Error> {
            let mut result = BTreeMap::new();
            while let Some((key, value)) = access.next_entry::<String, T>()? {
                if result.insert(key, value).is_some() {
                    return Err(serde::de::Error::custom("Duplicate portable key"));
                }
            }
            Ok(result)
        }
    }
    deserializer.deserialize_map(UniqueMap(std::marker::PhantomData))
}

/// Only called on private staging trees. Make note/config/manifest files durable
/// before publishing the root beside the already-synchronized database.
fn sync_staged_tree(root: &Path) -> AppResult<()> {
    for entry in fs::read_dir(root)? {
        let entry = entry?;
        if entry.file_type()?.is_dir() {
            sync_staged_tree(&entry.path())?;
        } else {
            fs::OpenOptions::new()
                .write(true)
                .open(entry.path())?
                .sync_all()?;
        }
    }
    #[cfg(unix)]
    fs::File::open(root)?.sync_all()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::context::{ContextCatalog, IntentSnapshot, Project};
    use crate::models::{DayPlan, Revision};
    use crate::state::AppState;
    use std::collections::BTreeMap;

    fn project(id: &str) -> Project {
        Project {
            id: id.into(),
            name: "Project".into(),
            ownership: crate::context::Ownership::Personal,
        }
    }

    fn catalog(projects: Vec<Project>) -> ContextCatalog {
        ContextCatalog {
            schema_version: 1,
            projects,
            goals: Vec::new(),
        }
    }

    fn intent(date: &str) -> IntentSnapshot {
        IntentSnapshot {
            schema_version: 1,
            version: uuid::Uuid::new_v4().to_string(),
            recorded_at: chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Nanos, true),
            date: date.into(),
            revision_id: "A".into(),
            blocks: Vec::new(),
        }
    }

    fn portable_with(intents: Vec<IntentSnapshot>) -> PortablePlanning {
        let mut days = BTreeMap::new();
        for intent in &intents {
            days.insert(
                intent.date.clone(),
                StoredDayPlan {
                    plan: DayPlan::new(&intent.date),
                    history: None,
                },
            );
        }
        PortablePlanning {
            format_version: 1,
            days,
            resources: BTreeMap::new(),
            intents,
            notes: BTreeMap::new(),
            managed_note_root: "notes".into(),
            configuration: None,
        }
    }

    #[test]
    fn portable_validation_rejects_each_intent_defect_alone() {
        let date = "2026-01-05";
        let mut bad_schema = intent(date);
        bad_schema.schema_version = 2;
        portable_with(vec![bad_schema])
            .validate()
            .expect_err("wrong intent schema versions are rejected");

        let mut bad_uuid = intent(date);
        bad_uuid.version = "not-a-uuid".into();
        portable_with(vec![bad_uuid])
            .validate()
            .expect_err("intent versions must be UUIDs");

        let duplicate = intent(date);
        portable_with(vec![duplicate.clone(), duplicate])
            .validate()
            .expect_err("intent versions must be unique");

        let mut missing_day = portable_with(vec![intent(date)]);
        missing_day.days.clear();
        missing_day
            .validate()
            .expect_err("intents must reference a stored day");

        let mut bad_timestamp = intent(date);
        bad_timestamp.recorded_at = "yesterday".into();
        portable_with(vec![bad_timestamp])
            .validate()
            .expect_err("intent timestamps must be RFC 3339");

        portable_with(vec![intent(date)])
            .validate()
            .expect("a well-formed bundle validates");
    }

    #[test]
    fn plan_validation_rejects_each_defect_alone() {
        let date = "2026-01-05";
        let plan = DayPlan::new(date);
        validate_plan(date, &plan).expect("a fresh plan validates");

        let mut wrong_date = DayPlan::new("2026-01-06");
        validate_plan(date, &wrong_date).expect_err("dates must match the key");
        wrong_date.date = date.into();
        validate_plan(date, &wrong_date).expect("matching dates validate");

        let mut wrong_schema = DayPlan::new(date);
        wrong_schema.schema_version = 2;
        validate_plan(date, &wrong_schema).expect_err("schema version 1 is required");

        let mut no_revisions = DayPlan::new(date);
        no_revisions.revisions.clear();
        validate_plan(date, &no_revisions).expect_err("plans need at least one revision");

        let mut empty_id = DayPlan::new(date);
        empty_id.revisions[0].id.clear();
        validate_plan(date, &empty_id).expect_err("revision identities must be present");

        let mut duplicate = DayPlan::new(date);
        let clone: Revision = duplicate.revisions[0].clone();
        duplicate.revisions.push(clone);
        validate_plan(date, &duplicate).expect_err("revision identities must be unique");
    }

    #[test]
    fn update_catalog_blocks_dropping_but_allows_additions() {
        let dir = tempfile::tempdir().unwrap();
        let state = AppState::for_test(dir.path());
        let store = state.planning_store().unwrap();
        let first = project("0b6bb69c-4c74-4d63-bd50-a4b626a35a75");
        let second = project("16466e35-4c22-4c8f-8e2a-6db3924dd8f6");
        let third = project("24e25bf5-915c-4a2c-873e-6cbf10062028");

        store
            .update_catalog(
                &ContextCatalog::default(),
                &catalog(vec![first.clone(), second.clone()]),
            )
            .expect("the first catalog write succeeds");
        store
            .update_catalog(
                &catalog(vec![first.clone(), second.clone()]),
                &catalog(vec![first.clone(), second.clone(), third.clone()]),
            )
            .expect("adding projects is allowed");
        let error = store
            .update_catalog(
                &catalog(vec![first.clone(), second.clone(), third]),
                &catalog(vec![first, second]),
            )
            .expect_err("dropping a stored project is rejected");
        assert!(matches!(error, AppError::BadRequest(_)), "{error:?}");
    }
}
