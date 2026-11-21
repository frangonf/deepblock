use crate::error::AppResult;

use std::collections::BTreeMap;

use chrono::Local;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;

pub fn now_timestamp() -> String {
    Local::now()
        .naive_local()
        .format("%Y-%m-%dT%H:%M:%S%.6f")
        .to_string()
}

pub fn validate_date_param(date: &str) -> AppResult<()> {
    if date.len() != 10 {
        return Err(crate::error::AppError::BadRequest(
            "Invalid date format".to_string(),
        ));
    }
    let chars: Vec<char> = date.chars().collect();
    for (i, c) in chars.iter().enumerate() {
        if i == 4 || i == 7 {
            if *c != '-' {
                return Err(crate::error::AppError::BadRequest(
                    "Invalid date format".to_string(),
                ));
            }
        } else if !c.is_ascii_digit() {
            return Err(crate::error::AppError::BadRequest(
                "Invalid date format".to_string(),
            ));
        }
    }
    chrono::NaiveDate::parse_from_str(date, "%Y-%m-%d")
        .map_err(|_| crate::error::AppError::BadRequest("Invalid calendar date".to_string()))?;
    Ok(())
}
pub fn today_string() -> String {
    Local::now().format("%Y-%m-%d").to_string()
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum InteractionMode {
    Focus,
    #[default]
    Reflect,
}

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
pub struct GlobalState {
    pub mode: InteractionMode,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum BlockType {
    Focus,
    #[default]
    Shallow,
    Urgent,
    Break,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum BlockStatus {
    #[default]
    Proposed,
    Confirmed,
    Cancelled,
    Done,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RevisionCopyMode {
    #[default]
    All,
    FromNow,
    Empty,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RevisionStrategy {
    #[default]
    Manual,
    Timed,
    EveryChange,
    Never,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
pub enum TimeFormat {
    #[serde(rename = "12h")]
    TwelveHour,
    #[default]
    #[serde(rename = "24h")]
    TwentyFourHour,
}

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
pub struct RealityLog {
    #[serde(default)]
    pub total_active_seconds: u64,
    pub focus_score: u8,
    #[serde(default = "default_top_app")]
    pub top_app: String,
    #[serde(default)]
    pub category_breakdown: BTreeMap<String, u64>,
}

fn default_top_app() -> String {
    "Unknown".to_string()
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct Block {
    pub id: String,
    pub label: String,
    pub start: String,
    pub duration: u16,
    #[serde(rename = "type", default)]
    pub block_type: BlockType,
    #[serde(default)]
    pub status: BlockStatus,
    pub created_at: String,
    #[serde(default)]
    pub metadata: BTreeMap<String, Value>,
    pub content_path: Option<String>,
    pub focus_rating: Option<u8>,
    pub actual_duration: Option<u16>,
    pub next_action: Option<String>,
    #[serde(default)]
    pub artifacts: Vec<String>,
    pub reality: Option<RealityLog>,
}

impl Block {
    pub fn from_request(request: AddBlockRequest, existing_blocks: &[Block]) -> Self {
        let id = loop {
            let candidate = Uuid::new_v4().to_string()[..8].to_string();
            if existing_blocks.iter().all(|block| block.id != candidate) {
                break candidate;
            }
        };

        Self {
            id,
            label: request.label,
            start: request.start,
            duration: request.duration,
            block_type: request.block_type,
            status: request.status,
            created_at: now_timestamp(),
            metadata: request.metadata,
            content_path: request.content_path,
            focus_rating: request.focus_rating,
            actual_duration: request.actual_duration,
            next_action: request.next_action,
            artifacts: request.artifacts.unwrap_or_default(),
            reality: None,
        }
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct Revision {
    pub id: String,
    pub created_at: String,
    pub reason: Option<String>,
    #[serde(default)]
    pub blocks: Vec<Block>,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ChangeType {
    Add,
    Update,
    Delete,
    Move,
    Reposition,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct ChangeLogEntry {
    pub timestamp: String,
    pub change_type: ChangeType,
    pub block_id: String,
    pub block_label: String,
    #[serde(default)]
    pub details: BTreeMap<String, Value>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct DayPlan {
    pub schema_version: u8,
    pub date: String,
    #[serde(default)]
    pub revisions: Vec<Revision>,
    pub note_path: Option<String>,
    #[serde(default)]
    pub change_log: Vec<ChangeLogEntry>,
}

impl DayPlan {
    pub fn new(date: impl Into<String>) -> Self {
        Self {
            schema_version: 1,
            date: date.into(),
            revisions: vec![Revision {
                id: "A".to_string(),
                created_at: now_timestamp(),
                reason: Some("Initial plan".to_string()),
                blocks: Vec::new(),
            }],
            note_path: None,
            change_log: Vec::new(),
        }
    }

    pub fn active_revision_mut(&mut self) -> Option<&mut Revision> {
        self.revisions.last_mut()
    }

    pub fn active_revision(&self) -> Option<&Revision> {
        self.revisions.last()
    }

    /// Legacy days can start with an empty bootstrap. Keep it selectable,
    /// but compare against the first actual plan by default.
    pub fn baseline_revision(&self) -> Option<&Revision> {
        self.revisions
            .iter()
            .find(|revision| !revision.blocks.is_empty())
            .or_else(|| self.revisions.first())
    }
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
pub struct AddBlockRequest {
    pub label: String,
    pub start: String,
    pub duration: u16,
    #[serde(rename = "type", default)]
    pub block_type: BlockType,
    #[serde(default)]
    pub metadata: BTreeMap<String, Value>,
    pub artifacts: Option<Vec<String>>,
    #[serde(default)]
    pub status: BlockStatus,
    pub focus_rating: Option<u8>,
    pub actual_duration: Option<u16>,
    pub next_action: Option<String>,
    pub content_path: Option<String>,
}

pub(crate) fn deserialize_nullable<'de, D, T>(
    deserializer: D,
) -> Result<Option<Option<T>>, D::Error>
where
    D: serde::Deserializer<'de>,
    T: Deserialize<'de>,
{
    Option::<T>::deserialize(deserializer).map(Some)
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
pub struct UpdateBlockRequest {
    #[serde(
        default,
        deserialize_with = "deserialize_nullable",
        skip_serializing_if = "Option::is_none"
    )]
    pub project_id: Option<Option<String>>,
    #[serde(
        default,
        deserialize_with = "deserialize_nullable",
        skip_serializing_if = "Option::is_none"
    )]
    pub goal_id: Option<Option<String>>,
    pub label: Option<String>,
    pub start: Option<String>,
    pub duration: Option<u16>,
    #[serde(rename = "type")]
    pub block_type: Option<BlockType>,
    pub metadata: Option<BTreeMap<String, Value>>,
    #[serde(
        default,
        deserialize_with = "deserialize_nullable",
        skip_serializing_if = "Option::is_none"
    )]
    pub focus_rating: Option<Option<u8>>,
    #[serde(
        default,
        deserialize_with = "deserialize_nullable",
        skip_serializing_if = "Option::is_none"
    )]
    pub actual_duration: Option<Option<u16>>,
    #[serde(
        default,
        deserialize_with = "deserialize_nullable",
        skip_serializing_if = "Option::is_none"
    )]
    pub next_action: Option<Option<String>>,
    #[serde(
        default,
        deserialize_with = "deserialize_nullable",
        skip_serializing_if = "Option::is_none"
    )]
    pub content_path: Option<Option<String>>,
    pub status: Option<BlockStatus>,
    #[serde(
        default,
        deserialize_with = "deserialize_nullable",
        skip_serializing_if = "Option::is_none"
    )]
    pub artifacts: Option<Option<Vec<String>>>,
    #[serde(default)]
    pub force_revision: bool,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct BlockOutcomeRequest {
    #[serde(
        default,
        deserialize_with = "deserialize_nullable",
        skip_serializing_if = "Option::is_none"
    )]
    pub actual_duration: Option<Option<u16>>,
    #[serde(
        default,
        deserialize_with = "deserialize_nullable",
        skip_serializing_if = "Option::is_none"
    )]
    pub focus_rating: Option<Option<u8>>,
    #[serde(
        default,
        deserialize_with = "deserialize_nullable",
        skip_serializing_if = "Option::is_none"
    )]
    pub completed: Option<Option<bool>>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct MoveBlockRequest {
    pub direction: i32,
}

/// A single operation inside a `POST /plan/replan` batch. The `op` tag is
/// deliberately not `type` — flattened block payloads already use `type` for
/// the block type.
#[derive(Clone, Debug, Deserialize)]
#[serde(tag = "op", rename_all = "snake_case")]
pub enum ReplanOperation {
    Create {
        /// Optional client-side (e.g. draft) identifier; later operations in
        /// the same batch may reference the created block through it.
        block_id: Option<String>,
        #[serde(flatten)]
        fields: UpdateBlockRequest,
    },
    Update {
        block_id: String,
        #[serde(flatten)]
        payload: UpdateBlockRequest,
    },
    Delete {
        block_id: String,
    },
}

#[derive(Clone, Debug, Default, Deserialize)]
pub struct ReplanRequest {
    /// Optional optimistic precondition: a full snapshot, not just a revision
    /// letter (the active revision can be edited without changing its id).
    pub base_revision: Option<Revision>,
    pub reason: Option<String>,
    #[serde(default)]
    pub operations: Vec<ReplanOperation>,
    pub copy_mode: Option<RevisionCopyMode>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct RepositionBlockRequest {
    pub start: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct ArtifactRequest {
    pub artifact: String,
}

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
pub struct ReviseRequest {
    pub reason: Option<String>,
    #[serde(default = "default_copy_future_blocks")]
    pub copy_future_blocks: bool,
    pub copy_mode: Option<RevisionCopyMode>,
}

fn default_copy_future_blocks() -> bool {
    true
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct ModeRequest {
    pub mode: InteractionMode,
}

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
pub struct ClientConfigUpdate {
    pub default_revision_copy_mode: Option<RevisionCopyMode>,
    pub revision_strategy: Option<RevisionStrategy>,
    pub revision_grace_minutes: Option<u16>,
    pub start_hour: Option<u8>,
    pub end_hour: Option<u8>,
    pub pixels_per_minute: Option<u16>,
    pub show_current_time_line: Option<bool>,
    pub toast_duration_ms: Option<u32>,
    pub time_format: Option<TimeFormat>,
    pub default_duration: Option<u16>,
    #[serde(rename = "default_type")]
    pub default_block_type: Option<BlockType>,
    pub rounding_interval: Option<u8>,
    pub min_duration: Option<u16>,
    pub max_duration: Option<u16>,
    pub notifications_enabled: Option<bool>,
    pub notify_minutes_before: Option<u16>,
    pub notify_on_block_start: Option<bool>,
    pub notify_on_block_end: Option<bool>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct ClientConfigResponse {
    pub default_revision_copy_mode: RevisionCopyMode,
    pub revision_strategy: RevisionStrategy,
    pub revision_grace_minutes: u16,
    pub start_hour: u8,
    pub end_hour: u8,
    pub pixels_per_minute: u16,
    pub show_current_time_line: bool,
    pub toast_duration_ms: u32,
    pub time_format: TimeFormat,
    pub default_duration: u16,
    #[serde(rename = "default_type")]
    pub default_block_type: BlockType,
    pub rounding_interval: u8,
    pub min_duration: u16,
    pub max_duration: u16,
    pub notifications_enabled: bool,
    pub notify_minutes_before: u16,
    pub notify_on_block_start: bool,
    pub notify_on_block_end: bool,
    pub server_version: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct ActivityWatchSummaryResponse {
    pub hostname: String,
    pub server_version: String,
    pub device_id: Option<String>,
    #[serde(default)]
    pub watchers: Vec<ActivityWatchWatcherStatus>,
    pub current_status: String,
    pub current_window: Option<ActivityWatchContextEvent>,
    pub current_web_tab: Option<ActivityWatchContextEvent>,
    pub today: ActivityWatchDailySummary,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct ActivityWatchWatcherStatus {
    pub kind: String,
    pub bucket_id: String,
    pub event_type: String,
    pub client: String,
    pub last_updated: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct ActivityWatchContextEvent {
    pub timestamp: String,
    pub duration_seconds: u64,
    pub app: Option<String>,
    pub title: Option<String>,
    pub url: Option<String>,
    pub domain: Option<String>,
    pub status: Option<String>,
}

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
pub struct ActivityWatchDailySummary {
    #[serde(default)]
    pub active_seconds: u64,
    #[serde(default)]
    pub top_apps: Vec<ActivityWatchRankedItem>,
    #[serde(default)]
    pub top_domains: Vec<ActivityWatchRankedItem>,
    #[serde(default)]
    pub recent_windows: Vec<ActivityWatchContextEvent>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct ActivityWatchRankedItem {
    pub label: String,
    pub detail: Option<String>,
    pub duration_seconds: u64,
    pub percent: u8,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct HealthResponse {
    #[serde(default)]
    pub service: String,
    pub status: String,
    pub version: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct NoteContentResponse {
    pub content: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct SaveNoteRequest {
    pub content: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct EnsureNoteResponse {
    pub path: String,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
pub enum BacklogStatus {
    #[default]
    #[serde(rename = "todo")]
    Todo,
    #[serde(rename = "inprogress")]
    InProgress,
    #[serde(rename = "done")]
    Done,
}

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
pub struct Backlog {
    pub id: String,
    pub label: String,
    #[serde(default)]
    pub status: BacklogStatus,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct UpdateBacklogTaskRequest {
    pub status: BacklogStatus,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct CreateBacklogTaskRequest {
    pub label: String,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum BlockDiffChangeType {
    Added,
    Removed,
    Modified,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct BlockDiff {
    pub block_id: String,
    pub label: String,
    pub change_type: BlockDiffChangeType,
    #[serde(default)]
    pub details: BTreeMap<String, Value>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct PlanComparisonResponse {
    pub base_revision: String,
    pub compare_revision: String,
    #[serde(default)]
    pub added: Vec<BlockDiff>,
    #[serde(default)]
    pub removed: Vec<BlockDiff>,
    #[serde(default)]
    pub modified: Vec<BlockDiff>,
    #[serde(default)]
    pub change_log: Vec<Value>,
    pub summary: String,
}

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
pub struct CompareQuery {
    pub date: Option<String>,
    pub base: Option<String>,
    pub compare: Option<String>,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum VarianceType {
    DurationMismatch,
    FocusMismatch,
    StartTimeDrift,
    Overrun,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum VarianceSeverity {
    Low,
    Medium,
    High,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct VarianceReport {
    pub block_id: String,
    pub block_label: String,
    pub variance_type: VarianceType,
    pub severity: VarianceSeverity,
    pub suggestion: String,
    #[serde(default)]
    pub data: BTreeMap<String, Value>,
}

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
pub struct PlanReviewSummary {
    pub reviewed_blocks: usize,
    #[serde(default)]
    pub observed_blocks: usize,
    pub total_reports: usize,
    pub high: usize,
    pub medium: usize,
    pub low: usize,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct PlanReviewResponse {
    pub date: String,
    pub revision_id: String,
    pub summary: PlanReviewSummary,
    #[serde(default)]
    pub reports: Vec<VarianceReport>,
}

impl Block {
    pub fn set_start(&mut self, start: String) {
        if self.start != start {
            self.reality = None;
            self.start = start;
        }
    }

    pub fn apply_update(&mut self, request: UpdateBlockRequest) {
        if request
            .start
            .as_ref()
            .is_some_and(|start| start != &self.start)
            || request
                .duration
                .is_some_and(|duration| duration != self.duration)
            || request
                .block_type
                .is_some_and(|block_type| block_type != self.block_type)
        {
            self.reality = None;
        }
        if let Some(label) = request.label {
            self.label = label;
        }
        if let Some(start) = request.start {
            self.start = start;
        }
        if let Some(duration) = request.duration {
            self.duration = duration;
        }
        if let Some(block_type) = request.block_type {
            self.block_type = block_type;
        }
        if let Some(metadata) = request.metadata {
            self.metadata = metadata;
        }
        for (key, value) in [
            ("project_id", request.project_id),
            ("goal_id", request.goal_id),
        ] {
            if let Some(value) = value {
                if let Some(id) = value {
                    self.metadata.insert(key.into(), Value::String(id));
                } else {
                    self.metadata.remove(key);
                }
            }
        }
        if let Some(focus_rating) = request.focus_rating {
            self.focus_rating = focus_rating;
        }
        if let Some(actual_duration) = request.actual_duration {
            self.actual_duration = actual_duration;
        }
        if let Some(next_action) = request.next_action {
            self.next_action = next_action;
        }
        if let Some(content_path) = request.content_path {
            self.content_path = content_path;
        }
        if let Some(status) = request.status {
            self.status = status;
        }
        if let Some(artifacts) = request.artifacts {
            self.artifacts = artifacts.unwrap_or_default();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn structural_updates_clear_reality_but_label_updates_keep_it() {
        let reality = RealityLog {
            total_active_seconds: 60,
            focus_score: 50,
            top_app: "Terminal".into(),
            category_breakdown: BTreeMap::new(),
        };
        let mut block = Block::from_request(
            serde_json::from_str("{\"label\":\"Work\", \"start\":\"09:00\", \"duration\":60}")
                .unwrap(),
            &[],
        );
        block.reality = Some(reality.clone());
        block.apply_update(serde_json::from_str("{\"duration\": 30}").unwrap());
        assert!(
            block.reality.is_none(),
            "changing the duration invalidates reality evidence"
        );
        block.reality = Some(reality.clone());
        block.apply_update(serde_json::from_str("{\"start\": \"10:00\"}").unwrap());
        assert!(
            block.reality.is_none(),
            "changing the start invalidates reality evidence"
        );
        block.reality = Some(reality.clone());
        block.apply_update(serde_json::from_str("{\"type\": \"urgent\"}").unwrap());
        assert!(
            block.reality.is_none(),
            "changing the block type invalidates reality evidence"
        );
        block.reality = Some(reality);
        block.apply_update(serde_json::from_str("{\"label\": \"Deep work\"}").unwrap());
        assert!(
            block.reality.is_some(),
            "renaming keeps the recorded reality evidence"
        );
    }

    #[test]
    fn serde_defaults_fill_missing_optional_fields() {
        let reality: RealityLog = serde_json::from_str("{\"focus_score\": 42}").unwrap();
        assert_eq!(reality.top_app, "Unknown");
        assert_eq!(reality.total_active_seconds, 0);
        assert!(reality.category_breakdown.is_empty());
        let revise: ReviseRequest = serde_json::from_str("{}").unwrap();
        assert!(revise.copy_future_blocks, "future blocks copy by default");
        assert_eq!(revise.reason, None);
    }

    #[test]
    fn date_validation() {
        assert!(validate_date_param("2026-04-17").is_ok());
        assert!(validate_date_param("../../etc/passwd").is_err());
        assert!(validate_date_param("").is_err());
        assert!(validate_date_param("2026-04").is_err());
        assert!(validate_date_param("2026-04-17extra").is_err());
    }
}

#[cfg(test)]
mod block_tests {
    use super::*;

    #[test]
    fn block_from_request_generates_unique_id() {
        let req = AddBlockRequest {
            label: "test".to_string(),
            start: "10:00".to_string(),
            duration: 60,
            block_type: BlockType::Focus,
            metadata: BTreeMap::new(),
            artifacts: None,
            ..Default::default()
        };
        let b1 = Block::from_request(req.clone(), &[]);
        let existing = vec![b1.clone()];
        let b2 = Block::from_request(req, &existing);
        assert_ne!(b1.id, b2.id);
        assert_eq!(b1.label, "test");
    }
}
