use std::collections::BTreeMap;

use chrono::{DateTime, Duration, FixedOffset, Local, LocalResult, NaiveDateTime, TimeZone};
use reqwest::Client;
use serde::{Deserialize, de::DeserializeOwned};
use serde_json::{Value, json};
use tracing::warn;

use crate::{
    config::{ActivityWatchCategoryRule, ActivityWatchConfig},
    error::AppResult,
    models::{
        ActivityWatchContextEvent, ActivityWatchDailySummary, ActivityWatchRankedItem,
        ActivityWatchSummaryResponse, ActivityWatchWatcherStatus, Block, BlockStatus, BlockType,
        DayPlan, RealityLog,
    },
};

const CATEGORY_QUERY: &str = r#"
events = flood(query_bucket(find_bucket("aw-watcher-window_")));
not_afk = flood(query_bucket(find_bucket("aw-watcher-afk_")));
not_afk = filter_keyvals(not_afk, "status", ["not-afk"]);
events = filter_period_intersect(events, not_afk);
events = categorize(events, __CATEGORIES__);
RETURN = merge_events_by_keys(events, ["$category"]);
"#;

const TOP_APP_QUERY: &str = r#"
events = flood(query_bucket(find_bucket("aw-watcher-window_")));
events = merge_events_by_keys(events, ["app"]);
RETURN = sort_by_duration(events);
"#;

const REQUEST_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(5);
const AUDIT_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(30);
const EXPLORER_EVENT_LIMIT: usize = 5_000;
const EXPLORER_RECENT_LIMIT: usize = 8;
const EXPLORER_TOP_LIMIT: usize = 6;

#[derive(Clone, Debug)]
pub struct ActivityWatchClient {
    base_url: String,
    category_mapping: BTreeMap<String, Vec<String>>,
    category_rules: Vec<ActivityWatchCategoryRule>,
    client: Client,
}

#[derive(Debug, Deserialize)]
struct QueryEvent {
    #[serde(default)]
    duration: f64,
    #[serde(default)]
    data: BTreeMap<String, Value>,
}

#[derive(Clone, Debug, Default, Deserialize)]
struct ActivityWatchInfo {
    #[serde(default)]
    hostname: String,
    #[serde(default)]
    version: String,
    #[serde(default)]
    device_id: Option<String>,
}

#[derive(Clone, Debug, Default, Deserialize)]
struct BucketMetadata {
    id: String,
    #[serde(rename = "type", default)]
    bucket_type: String,
    #[serde(default)]
    client: String,
    #[serde(default)]
    hostname: String,
    #[serde(default)]
    last_updated: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
struct TimedEvent<T> {
    timestamp: DateTime<FixedOffset>,
    #[serde(default)]
    duration: f64,
    data: T,
}

#[derive(Clone, Debug, Default, Deserialize)]
struct WindowEventData {
    #[serde(default)]
    app: String,
    #[serde(default)]
    title: String,
}

#[derive(Clone, Debug, Default, Deserialize)]
struct WebEventData {
    #[serde(default)]
    url: String,
    #[serde(default)]
    title: String,
}

#[derive(Clone, Debug, Default, Deserialize)]
struct AfkEventData {
    #[serde(default)]
    status: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct TimeRange {
    start: DateTime<Local>,
    end: DateTime<Local>,
}

/// Builds the category query with the configured rules formatted into the
/// `categorize(events, ...)` call; the `__CATEGORIES__` placeholder must
/// never reach ActivityWatch verbatim or the query fails to parse.
fn category_query(rules: &[ActivityWatchCategoryRule]) -> String {
    let categories = rules
        .iter()
        .map(|rule| {
            json!([
                rule.path,
                {"type":"regex", "regex":rule.regex, "ignore_case":rule.ignore_case}
            ])
        })
        .collect::<Vec<_>>();
    CATEGORY_QUERY.replace("__CATEGORIES__", &json!(categories).to_string())
}

impl ActivityWatchClient {
    pub fn new(config: &ActivityWatchConfig) -> Self {
        Self {
            base_url: config.url.trim_end_matches('/').to_string(),
            category_mapping: config.category_mapping.clone(),
            category_rules: config.category_rules.clone(),
            client: Client::new(),
        }
    }

    pub async fn audit_day_plan(&self, plan: &DayPlan) -> AppResult<DayPlan> {
        match tokio::time::timeout(AUDIT_TIMEOUT, self.audit_day_plan_inner(plan)).await {
            Ok(result) => result,
            Err(_) => {
                warn!("ActivityWatch audit deadline exceeded; preserving the plan");
                Ok(plan.clone())
            }
        }
    }

    async fn audit_day_plan_inner(&self, plan: &DayPlan) -> AppResult<DayPlan> {
        if !self.is_available().await {
            warn!("ActivityWatch audit skipped because the server was unreachable");
            return Ok(plan.clone());
        }

        let date = plan.date.clone();
        let now = Local::now();
        let mut updated_plan = plan.clone();

        if let Some(active_revision) = updated_plan.active_revision_mut() {
            for block in &mut active_revision.blocks {
                if block.status == BlockStatus::Cancelled
                    || block
                        .reality
                        .as_ref()
                        .is_some_and(|reality| reality.total_active_seconds > 0)
                {
                    continue;
                }

                let Some((start, end)) = block_time_range(&date, block) else {
                    continue;
                };

                if end >= now {
                    continue;
                }

                if let Some(reality) = self
                    .fetch_reality_log(&start, &end, block.block_type)
                    .await?
                {
                    block.reality = Some(reality);
                }
            }
        }

        Ok(updated_plan)
    }

    pub async fn is_available(&self) -> bool {
        match self
            .client
            .get(format!("{}/api/0/info", self.base_url))
            .timeout(REQUEST_TIMEOUT)
            .send()
            .await
        {
            Ok(response) => response.status().is_success(),
            Err(_) => false,
        }
    }

    pub async fn explorer_summary(&self) -> AppResult<ActivityWatchSummaryResponse> {
        let info = self.fetch_json::<ActivityWatchInfo>("/api/0/info").await?;
        let buckets = self
            .fetch_json::<BTreeMap<String, BucketMetadata>>("/api/0/buckets/")
            .await?;

        let window_bucket = select_bucket("aw-watcher-window_", &info.hostname, &buckets);
        let afk_bucket = select_bucket("aw-watcher-afk_", &info.hostname, &buckets);
        let web_bucket = select_bucket("aw-watcher-web_", &info.hostname, &buckets);

        let watchers = [window_bucket, afk_bucket, web_bucket]
            .into_iter()
            .flatten()
            .map(watcher_summary)
            .collect::<Vec<_>>();

        let current_window = if let Some(bucket) = window_bucket {
            self.fetch_bucket_events::<WindowEventData>(&bucket.id, None, None, Some(1))
                .await?
                .into_iter()
                .next()
                .map(window_context_event)
        } else {
            None
        };

        let current_afk = if let Some(bucket) = afk_bucket {
            self.fetch_bucket_events::<AfkEventData>(&bucket.id, None, None, Some(1))
                .await?
                .into_iter()
                .next()
                .map(afk_context_event)
        } else {
            None
        };

        let current_web_tab = if let Some(bucket) = web_bucket {
            self.fetch_bucket_events::<WebEventData>(&bucket.id, None, None, Some(1))
                .await?
                .into_iter()
                .next()
                .map(web_context_event)
        } else {
            None
        };

        let (start, end) = today_bounds();

        let window_events = if let Some(bucket) = window_bucket {
            self.fetch_bucket_events::<WindowEventData>(
                &bucket.id,
                Some(&start),
                Some(&end),
                Some(EXPLORER_EVENT_LIMIT),
            )
            .await?
        } else {
            Vec::new()
        };

        let web_events = if let Some(bucket) = web_bucket {
            self.fetch_bucket_events::<WebEventData>(
                &bucket.id,
                Some(&start),
                Some(&end),
                Some(EXPLORER_EVENT_LIMIT),
            )
            .await?
        } else {
            Vec::new()
        };

        let active_ranges = if let Some(bucket) = afk_bucket {
            let afk_events = self
                .fetch_bucket_events::<AfkEventData>(
                    &bucket.id,
                    Some(&start),
                    Some(&end),
                    Some(EXPLORER_EVENT_LIMIT),
                )
                .await?;
            let not_afk = afk_events
                .iter()
                .filter(|event| event.data.status == "not-afk")
                .filter_map(time_range_from_event)
                .collect::<Vec<_>>();
            merge_time_ranges(not_afk)
        } else {
            Vec::new()
        };

        let activity_filter = (!active_ranges.is_empty()).then_some(active_ranges.as_slice());
        let active_seconds = if let Some(ranges) = activity_filter {
            ranges.iter().map(TimeRange::duration_seconds).sum()
        } else {
            window_events
                .iter()
                .map(|event| effective_event_seconds(event, None))
                .sum()
        };

        Ok(ActivityWatchSummaryResponse {
            hostname: info.hostname,
            server_version: info.version,
            device_id: info.device_id,
            watchers,
            current_status: current_afk
                .as_ref()
                .and_then(|event| event.status.clone())
                .unwrap_or_else(|| "unknown".to_string()),
            current_window,
            current_web_tab,
            today: ActivityWatchDailySummary {
                active_seconds,
                top_apps: top_app_rankings(&window_events, activity_filter, active_seconds),
                top_domains: top_domain_rankings(&web_events, activity_filter, active_seconds),
                recent_windows: recent_windows(&window_events, activity_filter),
            },
        })
    }

    async fn fetch_reality_log(
        &self,
        start: &DateTime<Local>,
        end: &DateTime<Local>,
        block_type: BlockType,
    ) -> AppResult<Option<RealityLog>> {
        let category_results = match self
            .query(&category_query(&self.category_rules), start, end)
            .await
        {
            Ok(results) => results,
            Err(error) => {
                warn!("ActivityWatch category query failed: {error}");
                return Ok(None);
            }
        };

        let mut category_breakdown = BTreeMap::new();
        let mut total_active_seconds = 0_u64;

        for event in category_results.into_iter().flatten() {
            let duration = rounded_seconds(event.duration);
            let category = primary_category(&event.data);
            *category_breakdown.entry(category).or_default() += duration;
            total_active_seconds += duration;
        }

        // Empty queries cannot distinguish a missing watcher from offline work.
        if total_active_seconds == 0 {
            return Ok(None);
        }

        let top_app = match self.query(TOP_APP_QUERY, start, end).await {
            Ok(results) => top_app(results),
            Err(error) => {
                warn!("ActivityWatch top-app query failed: {error}");
                "Unknown".to_string()
            }
        };

        Ok(Some(RealityLog {
            total_active_seconds,
            focus_score: self.calculate_score(
                &category_breakdown,
                total_active_seconds,
                block_type,
            ),
            top_app,
            category_breakdown,
        }))
    }

    async fn query(
        &self,
        query: &str,
        start: &DateTime<Local>,
        end: &DateTime<Local>,
    ) -> AppResult<Vec<Vec<QueryEvent>>> {
        let payload = json!({
            "timeperiods": [format!("{}/{}", start.to_rfc3339(), end.to_rfc3339())],
            "query": query
                .lines()
                .map(str::trim)
                .filter(|line| !line.is_empty())
                .collect::<Vec<_>>(),
        });

        Ok(self
            .client
            .post(format!("{}/api/0/query/", self.base_url))
            .timeout(REQUEST_TIMEOUT)
            .json(&payload)
            .send()
            .await?
            .error_for_status()?
            .json::<Vec<Vec<QueryEvent>>>()
            .await?)
    }

    async fn fetch_json<T>(&self, path: &str) -> AppResult<T>
    where
        T: DeserializeOwned,
    {
        Ok(self
            .client
            .get(format!("{}{}", self.base_url, path))
            .timeout(REQUEST_TIMEOUT)
            .send()
            .await?
            .error_for_status()?
            .json::<T>()
            .await?)
    }

    async fn fetch_bucket_events<T>(
        &self,
        bucket_id: &str,
        start: Option<&DateTime<Local>>,
        end: Option<&DateTime<Local>>,
        limit: Option<usize>,
    ) -> AppResult<Vec<TimedEvent<T>>>
    where
        T: DeserializeOwned,
    {
        let mut request = self
            .client
            .get(format!(
                "{}/api/0/buckets/{bucket_id}/events",
                self.base_url
            ))
            .timeout(REQUEST_TIMEOUT);
        if let Some(start) = start {
            request = request.query(&[("start", start.to_rfc3339())]);
        }
        if let Some(end) = end {
            request = request.query(&[("end", end.to_rfc3339())]);
        }
        if let Some(limit) = limit {
            request = request.query(&[("limit", limit.to_string())]);
        }

        Ok(request
            .send()
            .await?
            .error_for_status()?
            .json::<Vec<TimedEvent<T>>>()
            .await?)
    }

    fn calculate_score(
        &self,
        breakdown: &BTreeMap<String, u64>,
        total_seconds: u64,
        block_type: BlockType,
    ) -> u8 {
        if total_seconds == 0 {
            return 0;
        }

        let key = block_type_key(block_type);
        let Some(target_categories) = self.category_mapping.get(key) else {
            return if matches!(block_type, BlockType::Break) {
                0
            } else {
                100
            };
        };

        let good_time = breakdown
            .iter()
            .filter(|(category, _)| target_categories.iter().any(|target| target == *category))
            .map(|(_, duration)| *duration)
            .sum::<u64>();

        ((good_time * 100) / total_seconds) as u8
    }
}

fn block_time_range(date: &str, block: &Block) -> Option<(DateTime<Local>, DateTime<Local>)> {
    let naive =
        NaiveDateTime::parse_from_str(&format!("{date} {}", block.start), "%Y-%m-%d %H:%M").ok()?;
    let start = Local
        .from_local_datetime(&naive)
        .single()
        .or_else(|| Local.from_local_datetime(&naive).earliest())
        .or_else(|| Local.from_local_datetime(&naive).latest())?;
    let end = start + Duration::minutes(i64::from(block.duration));
    Some((start, end))
}

fn watcher_summary(bucket: &BucketMetadata) -> ActivityWatchWatcherStatus {
    ActivityWatchWatcherStatus {
        kind: watcher_kind(&bucket.id).to_string(),
        bucket_id: bucket.id.clone(),
        event_type: bucket.bucket_type.clone(),
        client: bucket.client.clone(),
        last_updated: bucket.last_updated.clone(),
    }
}

fn watcher_kind(bucket_id: &str) -> &'static str {
    if bucket_id.starts_with("aw-watcher-window_") {
        "window"
    } else if bucket_id.starts_with("aw-watcher-afk_") {
        "afk"
    } else if bucket_id.starts_with("aw-watcher-web_") {
        "web"
    } else {
        "other"
    }
}

fn select_bucket<'a>(
    prefix: &str,
    hostname: &str,
    buckets: &'a BTreeMap<String, BucketMetadata>,
) -> Option<&'a BucketMetadata> {
    buckets
        .values()
        .find(|bucket| bucket.id.starts_with(prefix) && bucket.hostname == hostname)
        .or_else(|| {
            buckets
                .values()
                .find(|bucket| bucket.id.starts_with(prefix))
        })
}

fn today_bounds() -> (DateTime<Local>, DateTime<Local>) {
    let now = Local::now();
    let naive_start = now
        .date_naive()
        .and_hms_opt(0, 0, 0)
        .expect("midnight should always be valid");
    let start = match Local.from_local_datetime(&naive_start) {
        LocalResult::Single(value) => value,
        LocalResult::Ambiguous(earliest, _) => earliest,
        LocalResult::None => Local::now(),
    };
    (start, now)
}

fn rounded_seconds(duration: f64) -> u64 {
    if duration < 0.0 {
        0
    } else {
        duration.round() as u64
    }
}

fn string_option(value: &str) -> Option<String> {
    let trimmed = value.trim();
    (!trimmed.is_empty()).then(|| trimmed.to_string())
}

fn time_range_from_event<T>(event: &TimedEvent<T>) -> Option<TimeRange> {
    let start = event.timestamp.with_timezone(&Local);
    let seconds = rounded_seconds(event.duration);
    let seconds_i64 = i64::try_from(seconds).ok()?;
    Some(TimeRange {
        start,
        end: start + Duration::seconds(seconds_i64),
    })
}

impl TimeRange {
    fn duration_seconds(&self) -> u64 {
        let seconds = (self.end - self.start).num_seconds();
        seconds.max(0) as u64
    }
}

fn merge_time_ranges(mut ranges: Vec<TimeRange>) -> Vec<TimeRange> {
    if ranges.is_empty() {
        return ranges;
    }

    ranges.sort_by_key(|range| range.start);
    let mut merged: Vec<TimeRange> = Vec::with_capacity(ranges.len());
    for range in ranges {
        if let Some(last) = merged.last_mut()
            && range.start <= last.end
        {
            if range.end > last.end {
                last.end = range.end;
            }
            continue;
        }
        merged.push(range);
    }
    merged
}

fn overlap_seconds(range: &TimeRange, filters: &[TimeRange]) -> u64 {
    filters
        .iter()
        .map(|filter| {
            let start = range.start.max(filter.start);
            let end = range.end.min(filter.end);
            (end - start).num_seconds().max(0) as u64
        })
        .sum()
}

fn effective_event_seconds<T>(event: &TimedEvent<T>, filters: Option<&[TimeRange]>) -> u64 {
    let Some(range) = time_range_from_event(event) else {
        return 0;
    };

    match filters {
        Some(filters) => overlap_seconds(&range, filters),
        None => range.duration_seconds(),
    }
}

fn window_context_event(event: TimedEvent<WindowEventData>) -> ActivityWatchContextEvent {
    ActivityWatchContextEvent {
        timestamp: event.timestamp.with_timezone(&Local).to_rfc3339(),
        duration_seconds: rounded_seconds(event.duration),
        app: string_option(&event.data.app),
        title: string_option(&event.data.title),
        url: None,
        domain: None,
        status: None,
    }
}

fn web_context_event(event: TimedEvent<WebEventData>) -> ActivityWatchContextEvent {
    ActivityWatchContextEvent {
        timestamp: event.timestamp.with_timezone(&Local).to_rfc3339(),
        duration_seconds: rounded_seconds(event.duration),
        app: None,
        title: string_option(&event.data.title),
        domain: domain_from_url(&event.data.url),
        url: string_option(&event.data.url),
        status: None,
    }
}

fn afk_context_event(event: TimedEvent<AfkEventData>) -> ActivityWatchContextEvent {
    ActivityWatchContextEvent {
        timestamp: event.timestamp.with_timezone(&Local).to_rfc3339(),
        duration_seconds: rounded_seconds(event.duration),
        app: None,
        title: None,
        url: None,
        domain: None,
        status: string_option(&event.data.status),
    }
}

fn top_app_rankings(
    events: &[TimedEvent<WindowEventData>],
    filters: Option<&[TimeRange]>,
    denominator: u64,
) -> Vec<ActivityWatchRankedItem> {
    let mut durations = BTreeMap::<String, u64>::new();
    for event in events {
        let seconds = effective_event_seconds(event, filters);
        if seconds == 0 {
            continue;
        }

        let Some(app) = string_option(&event.data.app) else {
            continue;
        };
        *durations.entry(app).or_default() += seconds;
    }

    rank_items(durations, denominator)
}

fn top_domain_rankings(
    events: &[TimedEvent<WebEventData>],
    filters: Option<&[TimeRange]>,
    denominator: u64,
) -> Vec<ActivityWatchRankedItem> {
    let mut durations = BTreeMap::<String, u64>::new();
    for event in events {
        let seconds = effective_event_seconds(event, filters);
        if seconds == 0 {
            continue;
        }

        let Some(domain) = domain_from_url(&event.data.url) else {
            continue;
        };
        *durations.entry(domain).or_default() += seconds;
    }

    rank_items(durations, denominator)
}

fn recent_windows(
    events: &[TimedEvent<WindowEventData>],
    filters: Option<&[TimeRange]>,
) -> Vec<ActivityWatchContextEvent> {
    let mut sorted = events.to_vec();
    sorted.sort_by_key(|e| std::cmp::Reverse(e.timestamp));
    sorted
        .into_iter()
        .filter_map(|event| {
            let seconds = effective_event_seconds(&event, filters);
            if seconds == 0 {
                return None;
            }

            Some(ActivityWatchContextEvent {
                timestamp: event.timestamp.with_timezone(&Local).to_rfc3339(),
                duration_seconds: seconds,
                app: string_option(&event.data.app),
                title: string_option(&event.data.title),
                url: None,
                domain: None,
                status: None,
            })
        })
        .take(EXPLORER_RECENT_LIMIT)
        .collect()
}

fn rank_items(entries: BTreeMap<String, u64>, denominator: u64) -> Vec<ActivityWatchRankedItem> {
    let mut rows = entries.into_iter().collect::<Vec<_>>();
    rows.sort_by(|left, right| right.1.cmp(&left.1).then_with(|| left.0.cmp(&right.0)));
    rows.into_iter()
        .take(EXPLORER_TOP_LIMIT)
        .map(|(label, duration_seconds)| ActivityWatchRankedItem {
            label,
            detail: None,
            duration_seconds,
            percent: percentage(duration_seconds, denominator),
        })
        .collect()
}

fn percentage(value: u64, total: u64) -> u8 {
    (value.saturating_mul(100))
        .checked_div(total)
        .map_or(0, |v| v.min(100) as u8)
}

fn domain_from_url(value: &str) -> Option<String> {
    let url = reqwest::Url::parse(value).ok()?;
    let host = url.host_str()?.trim();
    if host.is_empty() {
        None
    } else {
        Some(host.trim_start_matches("www.").to_string())
    }
}

fn primary_category(data: &BTreeMap<String, Value>) -> String {
    data.get("$category")
        .and_then(Value::as_array)
        .and_then(|categories| categories.first())
        .and_then(Value::as_str)
        .unwrap_or("Uncategorized")
        .to_string()
}

fn top_app(results: Vec<Vec<QueryEvent>>) -> String {
    results
        .into_iter()
        .flatten()
        .max_by_key(|event| rounded_seconds(event.duration))
        .and_then(|event| {
            event
                .data
                .get("app")
                .and_then(Value::as_str)
                .map(ToOwned::to_owned)
        })
        .unwrap_or_else(|| "Unknown".to_string())
}

fn block_type_key(block_type: BlockType) -> &'static str {
    match block_type {
        BlockType::Focus => "focus",
        BlockType::Shallow => "shallow",
        BlockType::Urgent => "urgent",
        BlockType::Break => "break",
    }
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;
    use std::sync::Arc;

    use axum::{
        Json, Router,
        extract::State,
        routing::{get, post},
    };
    use chrono::DateTime;
    use serde_json::{Value, json};
    use tokio::{net::TcpListener, sync::Mutex};

    use super::{
        ActivityWatchClient, AfkEventData, BucketMetadata, TimeRange, TimedEvent, WebEventData,
        WindowEventData, block_time_range, domain_from_url, merge_time_ranges, recent_windows,
        select_bucket, time_range_from_event, top_app_rankings, top_domain_rankings, watcher_kind,
    };
    use crate::{
        config::ActivityWatchConfig,
        models::{
            Block, BlockStatus, BlockType, DayPlan, RealityLog, Revision, now_timestamp,
            today_string,
        },
    };

    #[derive(Clone, Default)]
    struct QueryCapture {
        payloads: Arc<Mutex<Vec<Value>>>,
    }

    async fn aw_info() -> Json<Value> {
        Json(json!({ "hostname": "localhost", "testing": false }))
    }

    async fn aw_query(
        State(capture): State<QueryCapture>,
        Json(payload): Json<Value>,
    ) -> Result<Json<Value>, (axum::http::StatusCode, String)> {
        capture.payloads.lock().await.push(payload.clone());
        let query_lines = payload["query"].as_array().cloned().unwrap_or_default();
        let joined = query_lines
            .iter()
            .filter_map(Value::as_str)
            .collect::<Vec<_>>()
            .join("\n");

        if let Some(line) = joined.lines().find(|line| line.contains("categorize")) {
            let rules = line
                .strip_prefix("events = categorize(events, ")
                .and_then(|line| line.strip_suffix(");"))
                .and_then(|rules| serde_json::from_str::<Value>(rules).ok());
            let valid = rules
                .as_ref()
                .and_then(Value::as_array)
                .is_some_and(|rules| {
                    rules.iter().all(|pair| {
                        pair.as_array().is_some_and(|pair| {
                            pair.len() == 2
                                && pair[0].as_array().is_some_and(|path| {
                                    !path.is_empty() && path.iter().all(Value::is_string)
                                })
                                && pair[1]["type"] == "regex"
                                && pair[1]["regex"].is_string()
                        })
                    })
                });
            if !valid {
                return Err((
                    axum::http::StatusCode::BAD_REQUEST,
                    "Invalid category rules".into(),
                ));
            }
        }
        if joined.contains("sort_by_duration") {
            Ok(Json(
                json!([[{ "duration": 1800.0, "data": { "app": "Code" } }]]),
            ))
        } else {
            Ok(Json(json!([[
                { "duration": 1800.0, "data": { "$category": ["Work", "Coding"] } },
                { "duration": 600.0, "data": { "$category": ["Social", "Chat"] } }
            ]])))
        }
    }

    async fn spawn_aw_server() -> (String, QueryCapture) {
        let capture = QueryCapture::default();
        let app = Router::new()
            .route("/api/0/info", get(aw_info))
            .route("/api/0/query/", post(aw_query))
            .with_state(capture.clone());
        let listener = TcpListener::bind("127.0.0.1:0").await.expect("listener");
        let address = listener.local_addr().expect("address");
        tokio::spawn(async move {
            axum::serve(listener, app).await.expect("test server");
        });
        (format!("http://{address}"), capture)
    }

    fn sample_plan() -> DayPlan {
        let today = today_string();
        let past_start = "00:00".to_string();
        let future_start = "23:59".to_string();

        DayPlan {
            schema_version: 1,
            date: today,
            revisions: vec![Revision {
                id: "A".to_string(),
                created_at: now_timestamp(),
                reason: Some("Initial plan".to_string()),
                blocks: vec![
                    Block {
                        id: "past0001".to_string(),
                        label: "Past focus".to_string(),
                        start: past_start.clone(),
                        duration: 1,
                        block_type: BlockType::Focus,
                        status: BlockStatus::Proposed,
                        created_at: now_timestamp(),
                        metadata: BTreeMap::new(),
                        content_path: None,
                        focus_rating: None,
                        actual_duration: None,
                        next_action: None,
                        artifacts: Vec::new(),
                        reality: None,
                    },
                    Block {
                        id: "cancel01".to_string(),
                        label: "Cancelled".to_string(),
                        start: past_start,
                        duration: 1,
                        block_type: BlockType::Focus,
                        status: BlockStatus::Cancelled,
                        created_at: now_timestamp(),
                        metadata: BTreeMap::new(),
                        content_path: None,
                        focus_rating: None,
                        actual_duration: None,
                        next_action: None,
                        artifacts: Vec::new(),
                        reality: None,
                    },
                    Block {
                        id: "future01".to_string(),
                        label: "Future".to_string(),
                        start: future_start,
                        duration: 30,
                        block_type: BlockType::Focus,
                        status: BlockStatus::Proposed,
                        created_at: now_timestamp(),
                        metadata: BTreeMap::new(),
                        content_path: None,
                        focus_rating: None,
                        actual_duration: None,
                        next_action: None,
                        artifacts: Vec::new(),
                        reality: None,
                    },
                ],
            }],
            note_path: None,
            change_log: Vec::new(),
        }
    }

    fn fixed_time(value: &str) -> DateTime<chrono::FixedOffset> {
        DateTime::parse_from_rfc3339(value).expect("timestamp should parse")
    }

    fn local_range(start: &str, duration_seconds: f64) -> TimeRange {
        time_range_from_event(&TimedEvent {
            timestamp: fixed_time(start),
            duration: duration_seconds,
            data: AfkEventData {
                status: "not-afk".to_string(),
            },
        })
        .expect("range should be built")
    }

    #[test]
    fn merges_ranges_and_filters_explorer_rankings() {
        let filters = merge_time_ranges(vec![
            local_range("2026-04-19T10:00:00+02:00", 180.0),
            local_range("2026-04-19T10:02:00+02:00", 180.0),
        ]);
        assert_eq!(filters.len(), 1);
        assert_eq!(filters[0].duration_seconds(), 300);

        let window_events = vec![
            TimedEvent {
                timestamp: fixed_time("2026-04-19T10:00:00+02:00"),
                duration: 300.0,
                data: WindowEventData {
                    app: "Code".to_string(),
                    title: "src/lib.rs".to_string(),
                },
            },
            TimedEvent {
                timestamp: fixed_time("2026-04-19T10:05:00+02:00"),
                duration: 300.0,
                data: WindowEventData {
                    app: "Chat".to_string(),
                    title: "Inbox".to_string(),
                },
            },
        ];
        let web_events = vec![
            TimedEvent {
                timestamp: fixed_time("2026-04-19T10:00:00+02:00"),
                duration: 300.0,
                data: WebEventData {
                    url: "https://www.docs.rs/serde".to_string(),
                    title: "serde - docs.rs".to_string(),
                },
            },
            TimedEvent {
                timestamp: fixed_time("2026-04-19T10:06:00+02:00"),
                duration: 120.0,
                data: WebEventData {
                    url: "https://news.ycombinator.com/".to_string(),
                    title: "Hacker News".to_string(),
                },
            },
        ];

        let top_apps = top_app_rankings(&window_events, Some(filters.as_slice()), 300);
        assert_eq!(top_apps.len(), 1);
        assert_eq!(top_apps[0].label, "Code");
        assert_eq!(top_apps[0].duration_seconds, 300);
        assert_eq!(top_apps[0].percent, 100);

        let top_domains = top_domain_rankings(&web_events, Some(filters.as_slice()), 300);
        assert_eq!(top_domains.len(), 1);
        assert_eq!(top_domains[0].label, "docs.rs");
        assert_eq!(top_domains[0].duration_seconds, 300);

        let recent = recent_windows(&window_events, Some(filters.as_slice()));
        assert_eq!(recent.len(), 1);
        assert_eq!(recent[0].app.as_deref(), Some("Code"));
    }

    #[test]
    fn extracts_domains_for_browser_rows() {
        assert_eq!(
            domain_from_url("https://www.activitywatch.net/docs"),
            Some("activitywatch.net".to_string())
        );
        assert_eq!(domain_from_url("notaurl"), None);
    }

    #[tokio::test]
    async fn audits_completed_blocks_and_preserves_other_rows() {
        let (base_url, capture) = spawn_aw_server().await;
        let client = ActivityWatchClient::new(&ActivityWatchConfig {
            enabled: true,
            url: base_url,
            category_mapping: ActivityWatchConfig::default().category_mapping,
            launch_bundled_components: true,
            ..Default::default()
        });

        let audited = client
            .audit_day_plan(&sample_plan())
            .await
            .expect("audit succeeds");
        let blocks = &audited.revisions[0].blocks;

        assert_eq!(
            blocks[0]
                .reality
                .as_ref()
                .map(|reality| reality.focus_score),
            Some(75)
        );
        assert_eq!(
            blocks[0]
                .reality
                .as_ref()
                .map(|reality| reality.top_app.as_str()),
            Some("Code")
        );
        assert!(blocks[1].reality.is_none());
        assert!(blocks[2].reality.is_none());

        let payloads = capture.payloads.lock().await;
        assert_eq!(payloads.len(), 2);
        assert!(
            payloads
                .iter()
                .all(|payload| payload["timeperiods"].is_array())
        );
    }

    #[tokio::test]
    async fn empty_activity_queries_do_not_create_evidence() {
        let listener = TcpListener::bind("127.0.0.1:0").await.expect("listener");
        let address = listener.local_addr().expect("address");
        let server = tokio::spawn(async move {
            axum::serve(
                listener,
                Router::new()
                    .route("/api/0/info", get(aw_info))
                    .route("/api/0/query/", post(|| async { Json(json!([[]])) })),
            )
            .await
            .expect("server");
        });
        let client = ActivityWatchClient::new(&ActivityWatchConfig {
            url: format!("http://{address}"),
            ..Default::default()
        });
        let audited = client.audit_day_plan(&sample_plan()).await.expect("audit");
        assert!(
            audited.revisions[0].blocks[0].reality.is_none(),
            "missing coverage is not verified inactivity"
        );
        server.abort();
    }

    #[tokio::test]
    async fn category_query_substitutes_configured_categories() {
        let (base_url, capture) = spawn_aw_server().await;
        let client = ActivityWatchClient::new(&ActivityWatchConfig {
            enabled: true,
            url: base_url,
            category_mapping: BTreeMap::from([("focus".to_string(), vec!["Work".to_string()])]),
            category_rules: vec![crate::config::ActivityWatchCategoryRule {
                path: vec!["Work".into(), "Development".into()],
                regex: "Xcode|iTerm".into(),
                ignore_case: true,
            }],
            launch_bundled_components: true,
        });

        client
            .audit_day_plan(&sample_plan())
            .await
            .expect("audit succeeds");

        let payloads = capture.payloads.lock().await;
        let categorize_lines = payloads
            .iter()
            .flat_map(|payload| {
                payload["query"]
                    .as_array()
                    .cloned()
                    .unwrap_or_default()
                    .into_iter()
                    .filter_map(|line| line.as_str().map(ToOwned::to_owned))
            })
            .filter(|line| line.contains("categorize"))
            .collect::<Vec<_>>();

        assert!(!categorize_lines.is_empty());
        for line in &categorize_lines {
            assert!(
                !line.contains("__CATEGORIES__"),
                "placeholder must be substituted, got: {line}"
            );
            assert!(
                line.contains("[\"Work\",\"Development\"]")
                    && line.contains("\"regex\":\"Xcode|iTerm\"")
                    && line.contains("\"type\":\"regex\""),
                "configured categories must be formatted into the query, got: {line}"
            );
        }
    }

    #[tokio::test]
    async fn availability_check_has_a_bounded_request_deadline() {
        let app = Router::new().route(
            "/api/0/info",
            get(|| async { std::future::pending::<Json<Value>>().await }),
        );
        let listener = TcpListener::bind("127.0.0.1:0").await.expect("listener");
        let address = listener.local_addr().expect("address");
        let server = tokio::spawn(async move { axum::serve(listener, app).await.expect("server") });
        let client = ActivityWatchClient::new(&ActivityWatchConfig {
            url: format!("http://{address}"),
            ..Default::default()
        });
        let available =
            tokio::time::timeout(std::time::Duration::from_secs(6), client.is_available()).await;
        server.abort();
        assert!(!available.expect("ActivityWatch request must time out within its deadline"));
    }

    #[tokio::test]
    async fn returns_original_plan_when_activitywatch_is_unavailable() {
        let client = ActivityWatchClient::new(&ActivityWatchConfig {
            enabled: true,
            url: "http://127.0.0.1:9".to_string(),
            category_mapping: ActivityWatchConfig::default().category_mapping,
            launch_bundled_components: true,
            ..Default::default()
        });
        let plan = sample_plan();

        let audited = client
            .audit_day_plan(&plan)
            .await
            .expect("unavailable audit should degrade");

        assert_eq!(audited, plan);
    }

    fn plan_block(id: &str, start: &str, duration: u16, reality: Option<RealityLog>) -> Block {
        Block {
            id: id.to_string(),
            label: format!("Label {id}"),
            start: start.to_string(),
            duration,
            block_type: BlockType::Focus,
            status: BlockStatus::Proposed,
            created_at: now_timestamp(),
            metadata: BTreeMap::new(),
            content_path: None,
            focus_rating: None,
            actual_duration: None,
            next_action: None,
            artifacts: Vec::new(),
            reality,
        }
    }

    #[test]
    fn block_time_range_ends_at_start_plus_duration() {
        let block = plan_block("range", "09:00", 30, None);
        let (start, end) =
            block_time_range("2026-10-09", &block).expect("valid range should parse");
        assert_eq!(
            start.format("%Y-%m-%d %H:%M").to_string(),
            "2026-10-09 09:00"
        );
        assert_eq!(end - start, chrono::Duration::minutes(30));

        let invalid = plan_block("invalid", "24:61", 30, None);
        assert!(block_time_range("2026-10-09", &invalid).is_none());
    }

    #[test]
    fn watcher_kind_maps_bucket_id_prefixes() {
        assert_eq!(watcher_kind("aw-watcher-window_host"), "window");
        assert_eq!(watcher_kind("aw-watcher-afk_host"), "afk");
        assert_eq!(watcher_kind("aw-watcher-web_host"), "web");
        assert_eq!(watcher_kind("something-else"), "other");
    }

    #[test]
    fn select_bucket_prefers_exact_hostname_and_falls_back_to_prefix() {
        let mut buckets = BTreeMap::from([
            (
                "aw-watcher-window_alpha".to_string(),
                BucketMetadata {
                    id: "aw-watcher-window_alpha".to_string(),
                    hostname: "other-host".to_string(),
                    ..BucketMetadata::default()
                },
            ),
            (
                "aw-watcher-window_beta".to_string(),
                BucketMetadata {
                    id: "aw-watcher-window_beta".to_string(),
                    hostname: "my-host".to_string(),
                    ..BucketMetadata::default()
                },
            ),
        ]);
        let selected = select_bucket("aw-watcher-window_", "my-host", &buckets)
            .expect("exact hostname match wins");
        assert_eq!(selected.id, "aw-watcher-window_beta");

        buckets.remove("aw-watcher-window_beta");
        let fallback =
            select_bucket("aw-watcher-window_", "my-host", &buckets).expect("prefix-only fallback");
        assert_eq!(fallback.id, "aw-watcher-window_alpha");

        assert!(select_bucket("aw-watcher-afk_", "my-host", &buckets).is_none());
    }

    #[tokio::test]
    async fn audit_skips_blocks_with_existing_reality_evidence() {
        let (base_url, _capture) = spawn_aw_server().await;
        let client = ActivityWatchClient::new(&ActivityWatchConfig {
            enabled: true,
            url: base_url,
            category_mapping: ActivityWatchConfig::default().category_mapping,
            launch_bundled_components: true,
            ..Default::default()
        });
        let mut plan = DayPlan::new(today_string());
        let evidenced = plan_block(
            "evidenced",
            "00:00",
            1,
            Some(RealityLog {
                total_active_seconds: 100,
                focus_score: 10,
                top_app: "Kept".to_string(),
                category_breakdown: BTreeMap::new(),
            }),
        );
        let zero_evidence = plan_block(
            "zero-evidence",
            "00:00",
            1,
            Some(RealityLog {
                total_active_seconds: 0,
                focus_score: 10,
                top_app: "Zero".to_string(),
                category_breakdown: BTreeMap::new(),
            }),
        );
        let revision = plan.active_revision_mut().expect("initial revision");
        revision.blocks.push(evidenced);
        revision.blocks.push(zero_evidence);

        let audited = client.audit_day_plan(&plan).await.expect("audit succeeds");
        let blocks = &audited.revisions[0].blocks;

        // Positive evidence is preserved instead of being re-fetched.
        assert_eq!(
            blocks[0]
                .reality
                .as_ref()
                .map(|reality| reality.total_active_seconds),
            Some(100)
        );
        assert_eq!(
            blocks[0]
                .reality
                .as_ref()
                .map(|reality| reality.top_app.as_str()),
            Some("Kept")
        );
        // Zero-second evidence is re-audited and replaced with fetched reality.
        assert_eq!(
            blocks[1]
                .reality
                .as_ref()
                .map(|reality| reality.focus_score),
            Some(75)
        );
        assert_eq!(
            blocks[1]
                .reality
                .as_ref()
                .map(|reality| reality.top_app.as_str()),
            Some("Code")
        );
    }

    async fn spawn_explorer_server(afk_statuses: &[&str]) -> String {
        let statuses: Vec<String> = afk_statuses
            .iter()
            .map(|status| (*status).to_string())
            .collect();
        let app = Router::new()
            .route("/api/0/info", get(aw_info))
            .route(
                "/api/0/buckets/",
                get(|| async {
                    Json(json!({
                        "aw-watcher-window_testhost": {
                            "id": "aw-watcher-window_testhost",
                            "type": "currentwindow",
                            "client": "aw-test",
                            "hostname": "testhost",
                            "last_updated": "2026-10-09T10:00:00+02:00"
                        },
                        "aw-watcher-afk_testhost": {
                            "id": "aw-watcher-afk_testhost",
                            "type": "afkdata",
                            "client": "aw-test",
                            "hostname": "testhost",
                            "last_updated": "2026-10-09T10:00:00+02:00"
                        }
                    }))
                }),
            )
            .route(
                "/api/0/buckets/{id}/events",
                get(
                    |axum::extract::Path(bucket_id): axum::extract::Path<String>,
                     State(statuses): State<Vec<String>>| async move {
                        if bucket_id.starts_with("aw-watcher-afk") {
                            Json(Value::Array(
                                statuses
                                    .iter()
                                    .map(|status| {
                                        json!({
                                            "timestamp": "2026-10-09T10:00:00+02:00",
                                            "duration": if status == "not-afk" { 600.0 } else { 1200.0 },
                                            "data": { "status": status }
                                        })
                                    })
                                    .collect(),
                            ))
                        } else if bucket_id.starts_with("aw-watcher-window") {
                            Json(json!([
                                {
                                    "timestamp": "2026-10-09T10:00:00+02:00",
                                    "duration": 1800.0,
                                    "data": { "app": "Code", "title": "aw.rs" }
                                }
                            ]))
                        } else {
                            Json(json!([]))
                        }
                    },
                ),
            )
            .with_state(statuses);
        let listener = TcpListener::bind("127.0.0.1:0").await.expect("listener");
        let address = listener.local_addr().expect("address");
        tokio::spawn(async move { axum::serve(listener, app).await.expect("server") });
        format!("http://{address}")
    }

    #[tokio::test]
    async fn explorer_summary_counts_only_not_afk_activity() {
        let client = ActivityWatchClient::new(&ActivityWatchConfig {
            url: spawn_explorer_server(&["not-afk", "afk"]).await,
            ..Default::default()
        });
        let summary = client.explorer_summary().await.expect("summary");
        assert_eq!(summary.current_status, "not-afk");
        assert_eq!(summary.today.active_seconds, 600);
    }

    #[tokio::test]
    async fn explorer_summary_falls_back_to_window_time_without_not_afk_events() {
        let client = ActivityWatchClient::new(&ActivityWatchConfig {
            url: spawn_explorer_server(&["afk"]).await,
            ..Default::default()
        });
        let summary = client.explorer_summary().await.expect("summary");
        assert_eq!(summary.today.active_seconds, 1800);
    }
}
