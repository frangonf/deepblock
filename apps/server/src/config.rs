use std::{collections::BTreeMap, env, path::PathBuf};

use serde::{Deserialize, Serialize};

use crate::{
    error::AppResult,
    models::{
        BlockType, ClientConfigResponse, ClientConfigUpdate, RevisionCopyMode, RevisionStrategy,
        TimeFormat,
    },
    persist,
};

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(default)]
pub struct ServerConfig {
    pub host: String,
    pub port: u16,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct ServerRuntime {
    pub pid: u32,
    pub host: String,
    pub port: u16,
}

impl ServerRuntime {
    pub fn base_url(&self) -> String {
        server_base_url(&self.host, self.port)
    }
}

fn server_base_url(host: &str, port: u16) -> String {
    if host.parse::<std::net::Ipv6Addr>().is_ok() {
        format!("http://[{host}]:{port}")
    } else {
        format!("http://{host}:{port}")
    }
}

impl ServerConfig {
    /// Process-only endpoint overrides; keep them out of persisted settings.
    pub fn with_env_overrides(mut self) -> Self {
        if let Ok(host) = env::var("DEEPBLOCK_SERVER_HOST") {
            self.host = host;
        }
        if let Ok(port) = env::var("DEEPBLOCK_SERVER_PORT")
            && let Ok(port) = port.parse::<u16>()
        {
            self.port = port;
        }
        self
    }

    pub fn base_url(&self) -> String {
        server_base_url(&self.host, self.port)
    }
}

impl Default for ServerConfig {
    fn default() -> Self {
        Self {
            host: "127.0.0.1".to_string(),
            port: 8000,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(default)]
pub struct RevisionConfig {
    pub strategy: RevisionStrategy,
    pub grace_minutes: u16,
}

impl Default for RevisionConfig {
    fn default() -> Self {
        Self {
            strategy: RevisionStrategy::Manual,
            grace_minutes: 5,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(default)]
pub struct DisplayConfig {
    pub start_hour: u8,
    pub end_hour: u8,
    pub pixels_per_minute: u16,
    pub show_current_time_line: bool,
    pub toast_duration_ms: u32,
    pub time_format: TimeFormat,
}

impl Default for DisplayConfig {
    fn default() -> Self {
        Self {
            start_hour: 0,
            end_hour: 24,
            pixels_per_minute: 2,
            show_current_time_line: true,
            toast_duration_ms: 4000,
            time_format: TimeFormat::TwentyFourHour,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(default)]
pub struct BlockConfig {
    pub default_duration: u16,
    #[serde(rename = "default_type")]
    pub default_block_type: BlockType,
    pub rounding_interval: u8,
    pub min_duration: u16,
    pub max_duration: u16,
}

impl Default for BlockConfig {
    fn default() -> Self {
        Self {
            default_duration: 60,
            default_block_type: BlockType::Shallow,
            rounding_interval: 15,
            min_duration: 15,
            max_duration: 480,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(default)]
pub struct ClientConfig {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub editor: Option<String>,
    pub default_revision_copy_mode: RevisionCopyMode,
    pub revision: RevisionConfig,
    pub display: DisplayConfig,
    pub blocks: BlockConfig,
}

impl Default for ClientConfig {
    fn default() -> Self {
        Self {
            editor: None,
            default_revision_copy_mode: RevisionCopyMode::All,
            revision: RevisionConfig::default(),
            display: DisplayConfig::default(),
            blocks: BlockConfig::default(),
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct ActivityWatchCategoryRule {
    pub path: Vec<String>,
    pub regex: String,
    #[serde(default = "default_enabled_true")]
    pub ignore_case: bool,
}

fn default_category_rules() -> Vec<ActivityWatchCategoryRule> {
    [
        (
            "Work",
            "Code|Xcode|IntelliJ|PyCharm|Vim|Emacs|Terminal|iTerm",
        ),
        ("Communication", "Mail|Outlook|Slack|Teams|Zoom"),
        ("Media", "Spotify|YouTube|Netflix"),
    ]
    .into_iter()
    .map(|(name, regex)| ActivityWatchCategoryRule {
        path: vec![name.to_string()],
        regex: regex.to_string(),
        ignore_case: true,
    })
    .collect()
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(default)]
pub struct ActivityWatchConfig {
    pub enabled: bool,
    pub url: String,
    pub category_mapping: BTreeMap<String, Vec<String>>,
    pub category_rules: Vec<ActivityWatchCategoryRule>,
    pub launch_bundled_components: bool,
}

fn default_enabled_true() -> bool {
    true
}

fn default_category_mapping() -> BTreeMap<String, Vec<String>> {
    BTreeMap::from([
        (
            "focus".to_string(),
            vec![
                "Work".to_string(),
                "Dev".to_string(),
                "Programming".to_string(),
                "Writing".to_string(),
            ],
        ),
        (
            "shallow".to_string(),
            vec![
                "Email".to_string(),
                "Admin".to_string(),
                "Communication".to_string(),
                "Meeting".to_string(),
            ],
        ),
        (
            "break".to_string(),
            vec!["Media".to_string(), "Social".to_string()],
        ),
        (
            "urgent".to_string(),
            vec!["Work".to_string(), "Bugfix".to_string()],
        ),
    ])
}

impl Default for ActivityWatchConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            url: "http://localhost:5600".to_string(),
            category_mapping: default_category_mapping(),
            category_rules: default_category_rules(),
            launch_bundled_components: true,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(default)]
pub struct NotificationConfig {
    pub enabled: bool,
    pub sound_enabled: bool,
    pub notify_minutes_before: u16,
    pub notify_on_block_start: bool,
    pub notify_on_block_end: bool,
    pub urgency: String,
}

impl Default for NotificationConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            sound_enabled: false,
            notify_minutes_before: 5,
            notify_on_block_start: true,
            notify_on_block_end: true,
            urgency: "normal".to_string(),
        }
    }
}

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(default)]
pub struct Settings {
    pub server: ServerConfig,
    pub client: ClientConfig,
    pub activitywatch: ActivityWatchConfig,
    pub notifications: NotificationConfig,
}

impl Settings {
    pub fn as_client_config(&self) -> ClientConfigResponse {
        ClientConfigResponse {
            default_revision_copy_mode: self.client.default_revision_copy_mode,
            revision_strategy: self.client.revision.strategy,
            revision_grace_minutes: self.client.revision.grace_minutes,
            start_hour: self.client.display.start_hour,
            end_hour: self.client.display.end_hour,
            pixels_per_minute: self.client.display.pixels_per_minute,
            show_current_time_line: self.client.display.show_current_time_line,
            toast_duration_ms: self.client.display.toast_duration_ms,
            time_format: self.client.display.time_format,
            default_duration: self.client.blocks.default_duration,
            default_block_type: self.client.blocks.default_block_type,
            rounding_interval: self.client.blocks.rounding_interval,
            min_duration: self.client.blocks.min_duration,
            max_duration: self.client.blocks.max_duration,
            notifications_enabled: self.notifications.enabled,
            notify_minutes_before: self.notifications.notify_minutes_before,
            notify_on_block_start: self.notifications.notify_on_block_start,
            notify_on_block_end: self.notifications.notify_on_block_end,
            server_version: env!("CARGO_PKG_VERSION").to_string(),
        }
    }

    pub fn apply_client_update(&mut self, update: &ClientConfigUpdate) -> AppResult<()> {
        let start_hour = update.start_hour.unwrap_or(self.client.display.start_hour);
        let end_hour = update.end_hour.unwrap_or(self.client.display.end_hour);
        if start_hour >= 24 {
            return Err(crate::error::AppError::BadRequest(
                "start_hour must be between 0 and 23".to_string(),
            ));
        }
        if !(1..=24).contains(&end_hour) {
            return Err(crate::error::AppError::BadRequest(
                "end_hour must be between 1 and 24".to_string(),
            ));
        }
        if start_hour >= end_hour {
            return Err(crate::error::AppError::BadRequest(
                "start_hour must be before end_hour".to_string(),
            ));
        }

        if let Some(copy_mode) = update.default_revision_copy_mode {
            self.client.default_revision_copy_mode = copy_mode;
        }
        if let Some(strategy) = update.revision_strategy {
            self.client.revision.strategy = strategy;
        }
        if let Some(grace_minutes) = update.revision_grace_minutes {
            self.client.revision.grace_minutes = grace_minutes;
        }
        if let Some(start_hour) = update.start_hour {
            self.client.display.start_hour = start_hour;
        }
        if let Some(end_hour) = update.end_hour {
            self.client.display.end_hour = end_hour;
        }
        if let Some(pixels_per_minute) = update.pixels_per_minute {
            self.client.display.pixels_per_minute = pixels_per_minute;
        }
        if let Some(show_current_time_line) = update.show_current_time_line {
            self.client.display.show_current_time_line = show_current_time_line;
        }
        if let Some(toast_duration_ms) = update.toast_duration_ms {
            self.client.display.toast_duration_ms = toast_duration_ms;
        }
        if let Some(time_format) = update.time_format {
            self.client.display.time_format = time_format;
        }
        if let Some(default_duration) = update.default_duration {
            self.client.blocks.default_duration = default_duration;
        }
        if let Some(default_block_type) = update.default_block_type {
            self.client.blocks.default_block_type = default_block_type;
        }
        if let Some(rounding_interval) = update.rounding_interval {
            self.client.blocks.rounding_interval = rounding_interval;
        }
        if let Some(min_duration) = update.min_duration {
            self.client.blocks.min_duration = min_duration;
        }
        if let Some(max_duration) = update.max_duration {
            self.client.blocks.max_duration = max_duration;
        }
        if let Some(notifications_enabled) = update.notifications_enabled {
            self.notifications.enabled = notifications_enabled;
        }
        if let Some(notify_minutes_before) = update.notify_minutes_before {
            self.notifications.notify_minutes_before = notify_minutes_before;
        }
        if let Some(notify_on_block_start) = update.notify_on_block_start {
            self.notifications.notify_on_block_start = notify_on_block_start;
        }
        if let Some(notify_on_block_end) = update.notify_on_block_end {
            self.notifications.notify_on_block_end = notify_on_block_end;
        }

        Ok(())
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DeepBlockPaths {
    pub data_root: PathBuf,
    pub config_root: PathBuf,
    pub state_root: PathBuf,
}

impl DeepBlockPaths {
    pub fn resolve() -> AppResult<Self> {
        let home_dir = dirs::home_dir().ok_or_else(|| {
            crate::error::AppError::BadRequest("Unable to resolve home directory".to_string())
        })?;
        let data_root = env::var_os("XDG_DATA_HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|| home_dir.join(".local").join("share"))
            .join("deepblock");
        let config_root = env::var_os("XDG_CONFIG_HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|| home_dir.join(".config"))
            .join("deepblock");
        let state_root = env::var_os("XDG_STATE_HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|| home_dir.join(".local").join("state"))
            .join("deepblock");

        Ok(Self {
            data_root,
            config_root,
            state_root,
        })
    }

    pub fn from_roots(data_root: PathBuf, config_root: PathBuf, state_root: PathBuf) -> Self {
        Self {
            data_root,
            config_root,
            state_root,
        }
    }

    pub fn ensure_dirs(&self) -> AppResult<()> {
        std::fs::create_dir_all(self.plan_dir())?;
        std::fs::create_dir_all(self.notes_dir())?;
        std::fs::create_dir_all(&self.config_root)?;
        std::fs::create_dir_all(&self.state_root)?;
        Ok(())
    }

    pub fn plan_dir(&self) -> PathBuf {
        self.data_root.join("data")
    }

    pub fn notes_dir(&self) -> PathBuf {
        self.data_root.join("notes")
    }

    pub fn config_file(&self) -> PathBuf {
        self.config_root.join("config.toml")
    }

    pub fn day_plan_file(&self, date: &str) -> PathBuf {
        self.plan_dir().join(format!("{date}.json"))
    }

    pub fn state_file(&self) -> PathBuf {
        self.state_root.join("state.json")
    }

    pub fn history_file(&self, date: &str) -> PathBuf {
        self.state_root.join(format!("history-{date}.json"))
    }

    pub fn backlog_file(&self) -> PathBuf {
        self.data_root.join("backlog.json")
    }

    pub fn note_file(&self, date: &str) -> PathBuf {
        self.notes_dir().join(format!("{date}.md"))
    }

    pub fn pid_file(&self) -> PathBuf {
        self.state_root.join("server.pid")
    }

    pub fn server_runtime_file(&self) -> PathBuf {
        self.state_root.join("server-runtime.json")
    }
}

pub fn load_settings(paths: &DeepBlockPaths) -> AppResult<Settings> {
    let path = paths.config_file();
    if path.exists() {
        persist::read_toml_file(&path)
    } else {
        Ok(Settings::default())
    }
}

pub fn save_settings(paths: &DeepBlockPaths, settings: &Settings) -> AppResult<()> {
    persist::write_toml_file(&paths.config_file(), settings)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn path_helpers_stay_under_their_roots() {
        let paths = DeepBlockPaths::from_roots(
            std::path::PathBuf::from("/data"),
            std::path::PathBuf::from("/config"),
            std::path::PathBuf::from("/state"),
        );
        assert_eq!(
            paths.state_file(),
            std::path::PathBuf::from("/state/state.json")
        );
        assert_eq!(
            paths.history_file("2026-01-05"),
            std::path::PathBuf::from("/state/history-2026-01-05.json")
        );
        assert_eq!(
            paths.day_plan_file("2026-01-05"),
            std::path::PathBuf::from("/data/data/2026-01-05.json")
        );
    }

    #[test]
    fn missing_settings_use_the_same_defaults_as_default() {
        assert_eq!(
            toml::from_str::<Settings>("").expect("empty settings"),
            Settings::default()
        );
        assert_eq!(toml::from_str::<Settings>(
            "[server]\n[client]\n[client.revision]\n[client.display]\n[client.blocks]\n[activitywatch]\n[notifications]\n"
        ).expect("empty sections"), Settings::default());
        let mut expected = Settings::default();
        expected.client.blocks.default_block_type = BlockType::Focus;
        expected.notifications.enabled = false;
        expected.activitywatch.category_rules.clear();
        assert_eq!(toml::from_str::<Settings>(
            "[client.blocks]\ndefault_type = 'focus'\n[notifications]\nenabled = false\n[activitywatch]\ncategory_rules = []\n"
        ).expect("explicit overrides"), expected);
        assert_eq!(
            toml::from_str::<Settings>(&toml::to_string(&expected).expect("serialize"))
                .expect("round trip"),
            expected
        );
    }
}
