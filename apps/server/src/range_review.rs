//! Voluntary feedback aggregates with exactly one final plan baseline per day.
use crate::{
    error::{AppError, AppResult},
    models::{BlockStatus, DayPlan, validate_date_param},
};
use serde::Serialize;

#[derive(Clone, Debug, Default, Serialize)]
pub struct ReviewTotals {
    pub planned_minutes: u64,
    pub reported_minutes: Option<u64>,
    pub eligible_blocks: u64,
    pub minutes_reported_blocks: u64,
    pub focus_rated_blocks: u64,
    pub focus_mean: Option<f64>,
    pub completion_reported_blocks: u64,
    pub completed_blocks: u64,
}

#[derive(Debug, Serialize)]
pub struct ReviewDay {
    pub date: String,
    pub revision_id: Option<String>,
    pub totals: ReviewTotals,
    pub revision_reasons: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct RangeReview {
    pub start: String,
    pub end: String,
    pub baseline: &'static str,
    pub days: Vec<ReviewDay>,
    pub totals: ReviewTotals,
}

pub fn validate_range(start: &str, end: &str) -> AppResult<(chrono::NaiveDate, chrono::NaiveDate)> {
    validate_date_param(start)?;
    validate_date_param(end)?;
    let start = chrono::NaiveDate::parse_from_str(start, "%Y-%m-%d")
        .map_err(|_| AppError::BadRequest("Invalid review start".into()))?;
    let end = chrono::NaiveDate::parse_from_str(end, "%Y-%m-%d")
        .map_err(|_| AppError::BadRequest("Invalid review end".into()))?;
    if (end - start).num_days() < 0 || (end - start).num_days() >= 31 {
        return Err(AppError::BadRequest(
            "Review range must contain 1–31 days".into(),
        ));
    }
    Ok((start, end))
}

pub fn summarize(plans: &[DayPlan], start: &str, end: &str) -> AppResult<RangeReview> {
    let (first, last) = validate_range(start, end)?;
    let mut days = Vec::new();
    let mut totals = ReviewTotals::default();
    let mut all_focus_sum = 0_u64;
    for date in first.iter_days().take_while(|date| *date <= last) {
        let date = date.to_string();
        let plan = plans.iter().find(|p| p.date == date);
        let revision = plan.and_then(DayPlan::active_revision);
        let mut day = ReviewTotals::default();
        let mut focus_sum = 0_u64;
        for block in revision
            .into_iter()
            .flat_map(|r| &r.blocks)
            .filter(|b| b.status != BlockStatus::Cancelled)
        {
            day.eligible_blocks += 1;
            day.planned_minutes += u64::from(block.duration);
            if let Some(minutes) = block.actual_duration {
                day.minutes_reported_blocks += 1;
                *day.reported_minutes.get_or_insert(0) += u64::from(minutes);
            }
            if let Some(rating) = block.focus_rating {
                day.focus_rated_blocks += 1;
                focus_sum += u64::from(rating);
            }
            if let Some(completed) = block
                .metadata
                .get("outcome_completed")
                .and_then(|v| v.as_bool())
                .or_else(|| (block.status == BlockStatus::Done).then_some(true))
            {
                day.completion_reported_blocks += 1;
                day.completed_blocks += u64::from(completed);
            }
        }
        day.focus_mean =
            (day.focus_rated_blocks > 0).then(|| focus_sum as f64 / day.focus_rated_blocks as f64);
        totals.planned_minutes += day.planned_minutes;
        totals.eligible_blocks += day.eligible_blocks;
        totals.minutes_reported_blocks += day.minutes_reported_blocks;
        totals.focus_rated_blocks += day.focus_rated_blocks;
        totals.completion_reported_blocks += day.completion_reported_blocks;
        totals.completed_blocks += day.completed_blocks;
        all_focus_sum += focus_sum;
        if let Some(minutes) = day.reported_minutes {
            *totals.reported_minutes.get_or_insert(0) += minutes;
        }
        days.push(ReviewDay {
            date,
            revision_id: revision.map(|r| r.id.clone()),
            totals: day,
            revision_reasons: plan
                .map(|p| {
                    p.revisions
                        .iter()
                        .filter_map(|r| r.reason.clone())
                        .collect()
                })
                .unwrap_or_default(),
        });
    }
    totals.focus_mean = (totals.focus_rated_blocks > 0)
        .then(|| all_focus_sum as f64 / totals.focus_rated_blocks as f64);
    Ok(RangeReview {
        start: start.into(),
        end: end.into(),
        baseline: "final_active_revision",
        days,
        totals,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{Block, DayPlan};

    #[test]
    fn validate_range_accepts_single_days_and_enforces_the_31_day_ceiling() {
        validate_range("2026-02-10", "2026-02-10").expect("a single day is a valid review range");
        validate_range("2026-02-10", "2026-02-09").expect_err("reversed ranges are rejected");
        validate_range("2026-01-01", "2026-01-31").expect("30 days stays inside the ceiling");
        validate_range("2026-01-01", "2026-02-01").expect_err("31 days is outside the ceiling");
        validate_range("2026-01-01", "not-a-date").expect_err("dates must parse");
    }

    fn plan_with(date: &str, blocks: Vec<Block>) -> DayPlan {
        let mut plan = DayPlan::new(date);
        plan.active_revision_mut().unwrap().blocks = blocks;
        plan
    }

    fn block(label: &str, minutes: u64, actual: Option<u64>, rating: Option<u8>) -> Block {
        let mut request = crate::models::AddBlockRequest {
            label: label.into(),
            start: "09:00".into(),
            duration: minutes as u16,
            ..Default::default()
        };
        request.actual_duration = actual.map(|m| m as u16);
        request.focus_rating = rating;
        Block::from_request(request, &[])
    }

    #[test]
    fn summarize_accumulates_totals_and_averages_across_days() {
        let first = plan_with(
            "2026-02-10",
            vec![
                block("focus", 60, Some(45), Some(4)),
                {
                    let mut done = block("done", 30, Some(30), Some(2));
                    done.status = crate::models::BlockStatus::Done;
                    done
                },
                {
                    let mut cancelled = block("skipped", 90, None, None);
                    cancelled.status = crate::models::BlockStatus::Cancelled;
                    cancelled
                },
            ],
        );
        let second = plan_with("2026-02-11", vec![block("solo", 45, None, None)]);
        let review = summarize(&[first, second], "2026-02-10", "2026-02-11").unwrap();
        assert_eq!(review.days.len(), 2);

        let totals = &review.totals;
        assert_eq!(totals.eligible_blocks, 3, "cancelled blocks are excluded");
        assert_eq!(totals.planned_minutes, 60 + 30 + 45);
        assert_eq!(totals.minutes_reported_blocks, 2);
        assert_eq!(totals.reported_minutes, Some(45 + 30));
        assert_eq!(totals.focus_rated_blocks, 2);
        assert_eq!(totals.focus_mean, Some(3.0), "(4 + 2) / 2");
        assert_eq!(totals.completion_reported_blocks, 1);
        assert_eq!(totals.completed_blocks, 1);

        let first_day = &review.days[0].totals;
        assert_eq!(first_day.eligible_blocks, 2);
        assert_eq!(first_day.planned_minutes, 90);
        assert_eq!(first_day.focus_mean, Some(3.0));
        let second_day = &review.days[1].totals;
        assert_eq!(second_day.focus_mean, None, "no ratings yields no mean");
        assert_eq!(second_day.focus_rated_blocks, 0);

        // A day without a plan still appears with empty totals.
        let empty = summarize(&[], "2026-02-10", "2026-02-11").unwrap();
        assert_eq!(empty.days.len(), 2);
        assert_eq!(empty.totals.planned_minutes, 0);
        assert_eq!(
            empty.totals.focus_mean, None,
            "no rated blocks yields no aggregate mean"
        );
    }
}
