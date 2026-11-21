use std::collections::BTreeMap;

use serde_json::json;

use crate::models::{
    Block, BlockStatus, BlockType, DayPlan, PlanReviewResponse, PlanReviewSummary, VarianceReport,
    VarianceSeverity, VarianceType,
};

// A variance bigger than one standard DeepBlock time slice should be called out.
const DURATION_VARIANCE_WARNING_MINUTES: i128 = 15;
// Below 60% means the block likely failed to match its intended focus quality.
const FOCUS_SCORE_WARNING_PERCENT: u8 = 60;

pub fn review_plan(plan: &DayPlan) -> PlanReviewResponse {
    let revision = plan
        .active_revision()
        .cloned()
        .unwrap_or_else(|| crate::models::Revision {
            id: "A".to_string(),
            created_at: crate::models::now_timestamp(),
            reason: Some("Initial plan".to_string()),
            blocks: Vec::new(),
        });

    let reports = analyze_blocks(&revision.blocks);
    let mut summary = PlanReviewSummary {
        reviewed_blocks: revision
            .blocks
            .iter()
            .filter(|block| block.status != BlockStatus::Cancelled)
            .count(),
        observed_blocks: revision
            .blocks
            .iter()
            .filter(|block| {
                block.status != BlockStatus::Cancelled
                    && (observed_duration(block).is_some() || observed_focus_score(block).is_some())
            })
            .count(),
        total_reports: reports.len(),
        ..PlanReviewSummary::default()
    };

    for report in &reports {
        match report.severity {
            VarianceSeverity::High => summary.high += 1,
            VarianceSeverity::Medium => summary.medium += 1,
            VarianceSeverity::Low => summary.low += 1,
        }
    }

    PlanReviewResponse {
        date: plan.date.clone(),
        revision_id: revision.id,
        summary,
        reports,
    }
}

fn analyze_blocks(blocks: &[Block]) -> Vec<VarianceReport> {
    let mut reports = Vec::new();

    for (index, block) in blocks.iter().enumerate() {
        if block.status == BlockStatus::Cancelled {
            continue;
        }

        if let Some(report) = build_duration_mismatch_report(block) {
            reports.push(report);
        }

        if let Some(report) = build_focus_mismatch_report(block) {
            reports.push(report);
        }

        let Some(next_block) = blocks
            .iter()
            .skip(index + 1)
            .find(|next| next.status != BlockStatus::Cancelled)
        else {
            continue;
        };

        if let Some(report) = build_overrun_report(block, next_block) {
            reports.push(report);
        }
    }

    reports
}

fn build_duration_mismatch_report(block: &Block) -> Option<VarianceReport> {
    let (observed_duration, source) = observed_duration(block)?;
    let variance = i128::from(block.duration) - i128::from(observed_duration);
    if variance.abs() <= DURATION_VARIANCE_WARNING_MINUTES {
        return None;
    }

    let severity = if variance.abs() >= 45 {
        VarianceSeverity::High
    } else {
        VarianceSeverity::Medium
    };

    let mut data = BTreeMap::new();
    data.insert("planned_duration".to_string(), json!(block.duration));
    data.insert("observed_duration".to_string(), json!(observed_duration));
    data.insert("variance_minutes".to_string(), json!(variance.abs()));
    data.insert("duration_source".to_string(), json!(source));

    Some(VarianceReport {
        block_id: block.id.clone(),
        block_label: block.label.clone(),
        variance_type: VarianceType::DurationMismatch,
        severity,
        suggestion: "Adjust the next revision or update your estimates for this kind of work."
            .to_string(),
        data,
    })
}

fn build_focus_mismatch_report(block: &Block) -> Option<VarianceReport> {
    if block.block_type != BlockType::Focus {
        return None;
    }

    let (score, source) = observed_focus_score(block)?;
    if score >= FOCUS_SCORE_WARNING_PERCENT {
        return None;
    }

    let severity = if score < 40 {
        VarianceSeverity::High
    } else {
        VarianceSeverity::Medium
    };

    let mut data = BTreeMap::new();
    data.insert("focus_score".to_string(), json!(score));
    data.insert(
        "focus_threshold".to_string(),
        json!(FOCUS_SCORE_WARNING_PERCENT),
    );
    data.insert("focus_source".to_string(), json!(source));

    Some(VarianceReport {
        block_id: block.id.clone(),
        block_label: block.label.clone(),
        variance_type: VarianceType::FocusMismatch,
        severity,
        suggestion: if source == "activitywatch" {
            "Computer activity included fewer focus-category minutes than expected. This does not establish task duration or attention quality."
        } else {
            "Shrink the block, remove likely distractions, or define a sharper next action before retrying."
        }.to_string(),
        data,
    })
}

fn build_overrun_report(block: &Block, next_block: &Block) -> Option<VarianceReport> {
    let (observed_duration, source) = observed_duration(block)?;
    let actual_end = i128::from(minutes_from_start(&block.start)?) + i128::from(observed_duration);
    let next_start = i128::from(minutes_from_start(&next_block.start)?);
    if actual_end <= next_start {
        return None;
    }

    let overrun_minutes = actual_end - next_start;
    let severity = if overrun_minutes >= 30 {
        VarianceSeverity::High
    } else if overrun_minutes >= 10 {
        VarianceSeverity::Medium
    } else {
        VarianceSeverity::Low
    };

    let mut data = BTreeMap::new();
    data.insert("next_block_id".to_string(), json!(next_block.id));
    data.insert("next_block_label".to_string(), json!(next_block.label));
    data.insert("overrun_minutes".to_string(), json!(overrun_minutes));
    data.insert("assumed_start".to_string(), json!(block.start));
    data.insert("duration_source".to_string(), json!(source));

    Some(VarianceReport {
        block_id: block.id.clone(),
        block_label: block.label.clone(),
        variance_type: VarianceType::Overrun,
        severity,
        suggestion:
            "If this task started at its planned time, the recorded duration would reach into the next block. Consider that when planning a similar day."
                .to_string(),
        data,
    })
}

fn observed_duration(block: &Block) -> Option<(u64, &'static str)> {
    // Computer-active minutes are not the task's elapsed duration.
    block
        .actual_duration
        .map(|minutes| (u64::from(minutes), "actual_duration"))
}

fn observed_focus_score(block: &Block) -> Option<(u8, &'static str)> {
    if let Some(focus_rating) = block.focus_rating {
        if focus_rating > 5 {
            return None;
        }
        return Some((focus_rating.saturating_mul(20), "focus_rating"));
    }

    block
        .reality
        .as_ref()
        .filter(|reality| reality.total_active_seconds > 0)
        .map(|reality| (reality.focus_score, "activitywatch"))
}

fn minutes_from_start(start: &str) -> Option<i64> {
    let (hour, minute) = start.split_once(':')?;
    let hour = hour.parse::<i64>().ok()?;
    let minute = minute.parse::<i64>().ok()?;
    Some((hour * 60) + minute)
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use serde_json::{Value, json};

    use super::review_plan;
    use crate::models::{
        Block, BlockStatus, BlockType, DayPlan, RealityLog, Revision, VarianceSeverity,
        VarianceType, now_timestamp,
    };

    fn focus_block(label: &str, start: &str, duration: u16) -> Block {
        Block::from_request(
            crate::models::AddBlockRequest {
                label: label.into(),
                start: start.into(),
                duration,
                block_type: BlockType::Focus,
                ..Default::default()
            },
            &[],
        )
    }

    #[test]
    fn reports_use_recorded_sources_with_exact_math_and_severity() {
        let mut plan = DayPlan::new("2026-07-26");
        let mut focus = focus_block("Focus", "09:15", 60);
        focus.focus_rating = Some(1);
        focus.actual_duration = Some(90);
        let next = focus_block("Next", "10:30", 30);
        plan.revisions[0].blocks = vec![focus, next];

        let review = review_plan(&plan);
        let overrun = review
            .reports
            .iter()
            .find(|report| report.variance_type == VarianceType::Overrun)
            .expect("the recorded duration reaches into the next block");
        assert_eq!(overrun.data["overrun_minutes"], json!(15));
        assert_eq!(overrun.severity, VarianceSeverity::Medium);
        assert_eq!(overrun.data["duration_source"], json!("actual_duration"));

        let focus_mismatch = review
            .reports
            .iter()
            .find(|report| report.variance_type == VarianceType::FocusMismatch)
            .expect("a rating of 1 is below the warning threshold");
        assert_eq!(focus_mismatch.severity, VarianceSeverity::High);
        assert_eq!(focus_mismatch.data["focus_source"], json!("focus_rating"));
        assert!(
            focus_mismatch.suggestion.contains("Shrink the block"),
            "rating-sourced advice: {}",
            focus_mismatch.suggestion
        );

        let mut aw = focus_block("Computer work", "09:00", 60);
        aw.reality = Some(RealityLog {
            total_active_seconds: 60,
            focus_score: 20,
            top_app: "Editor".into(),
            category_breakdown: BTreeMap::new(),
        });
        plan.revisions[0].blocks = vec![aw];
        let review = review_plan(&plan);
        let focus_mismatch = review
            .reports
            .iter()
            .find(|report| report.variance_type == VarianceType::FocusMismatch)
            .expect("an activity focus score below the threshold reports");
        assert_eq!(focus_mismatch.data["focus_source"], json!("activitywatch"));
        assert!(
            focus_mismatch.suggestion.contains("Computer activity"),
            "activity-sourced advice: {}",
            focus_mismatch.suggestion
        );
    }

    #[test]
    fn invalid_focus_ratings_are_not_evidence() {
        let mut plan = DayPlan::new("2026-07-26");
        let mut block = focus_block("Too high", "09:00", 60);
        block.focus_rating = Some(6);
        plan.revisions[0].blocks.push(block);
        let review = review_plan(&plan);
        assert_eq!(
            review.summary.observed_blocks, 0,
            "ratings above the 1-5 scale are not observations"
        );
        assert!(review.reports.is_empty());
    }

    #[test]
    fn review_counts_only_blocks_with_recorded_evidence() {
        let mut plan = DayPlan::new("2026-07-26".to_string());
        let base = Block {
            id: "unobserved".to_string(),
            label: "No evidence".to_string(),
            start: "09:00".to_string(),
            duration: 60,
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
        };
        let mut observed = base.clone();
        observed.id = "observed".to_string();
        observed.actual_duration = Some(60);
        let mut cancelled = observed.clone();
        cancelled.id = "cancelled".to_string();
        cancelled.status = BlockStatus::Cancelled;
        plan.revisions[0].blocks = vec![base, observed, cancelled];
        let review = review_plan(&plan);
        assert_eq!(review.summary.reviewed_blocks, 2);
        assert_eq!(review.summary.observed_blocks, 1);
        assert!(review.reports.is_empty());
    }

    #[test]
    fn legacy_empty_activity_is_unassessed_not_failure() {
        let mut plan = DayPlan::new("2026-07-26");
        let mut block = Block::from_request(
            crate::models::AddBlockRequest {
                label: "Offline work".into(),
                start: "09:00".into(),
                duration: 60,
                block_type: BlockType::Focus,
                ..Default::default()
            },
            &[],
        );
        block.reality = Some(RealityLog::default());
        plan.revisions[0].blocks.push(block);
        let review = review_plan(&plan);
        assert_eq!(review.summary.observed_blocks, 0);
        assert!(review.reports.is_empty());
    }

    #[test]
    fn computer_activity_does_not_establish_task_duration_or_overrun() {
        let mut plan = DayPlan::new("2026-07-26");
        let mut block = Block::from_request(
            crate::models::AddBlockRequest {
                label: "Thinking".into(),
                start: "09:00".into(),
                duration: 60,
                block_type: BlockType::Focus,
                ..Default::default()
            },
            &[],
        );
        block.reality = Some(RealityLog {
            total_active_seconds: 600,
            focus_score: 100,
            ..Default::default()
        });
        plan.revisions[0].blocks.push(block);
        let review = review_plan(&plan);
        assert_eq!(review.summary.observed_blocks, 1);
        assert!(review.reports.is_empty());
    }

    #[test]
    fn review_uses_self_report_and_activitywatch_without_requiring_both() {
        let plan = DayPlan {
            schema_version: 1,
            date: "2026-04-17".to_string(),
            revisions: vec![Revision {
                id: "B".to_string(),
                created_at: now_timestamp(),
                reason: Some("Test".to_string()),
                blocks: vec![
                    Block {
                        id: "focus-1".to_string(),
                        label: "Deep work".to_string(),
                        start: "09:00".to_string(),
                        duration: 60,
                        block_type: BlockType::Focus,
                        status: BlockStatus::Done,
                        created_at: now_timestamp(),
                        metadata: BTreeMap::new(),
                        content_path: None,
                        focus_rating: Some(2),
                        actual_duration: Some(95),
                        next_action: None,
                        artifacts: Vec::new(),
                        reality: None,
                    },
                    Block {
                        id: "focus-2".to_string(),
                        label: "Code review".to_string(),
                        start: "10:00".to_string(),
                        duration: 45,
                        block_type: BlockType::Focus,
                        status: BlockStatus::Done,
                        created_at: now_timestamp(),
                        metadata: BTreeMap::new(),
                        content_path: None,
                        focus_rating: None,
                        actual_duration: None,
                        next_action: None,
                        artifacts: Vec::new(),
                        reality: Some(RealityLog {
                            total_active_seconds: 1200,
                            focus_score: 35,
                            top_app: "Browser".to_string(),
                            category_breakdown: BTreeMap::new(),
                        }),
                    },
                ],
            }],
            note_path: None,
            change_log: Vec::new(),
        };

        let review = review_plan(&plan);
        assert_eq!(review.revision_id, "B");
        assert_eq!(review.summary.reviewed_blocks, 2);
        assert_eq!(review.summary.total_reports, 4);
        assert_eq!(review.summary.high, 2);
        assert_eq!(review.summary.medium, 2);
        assert_eq!(review.summary.low, 0);

        assert!(review.reports.iter().any(|report| {
            report.variance_type == VarianceType::DurationMismatch
                && report.severity == VarianceSeverity::Medium
                && report.data.get("duration_source")
                    == Some(&Value::String("actual_duration".to_string()))
        }));
        assert!(review.reports.iter().any(|report| {
            report.variance_type == VarianceType::FocusMismatch
                && report.data.get("focus_source")
                    == Some(&Value::String("focus_rating".to_string()))
        }));
        assert!(review.reports.iter().any(|report| {
            report.variance_type == VarianceType::FocusMismatch
                && report.data.get("focus_source")
                    == Some(&Value::String("activitywatch".to_string()))
        }));
        assert!(review.reports.iter().any(|report| {
            report.variance_type == VarianceType::Overrun
                && report.data.get("next_block_id") == Some(&Value::String("focus-2".to_string()))
        }));
    }
}
