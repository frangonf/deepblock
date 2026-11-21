use anyhow::Result;
use deepblock_server::models::{Backlog, DayPlan, PlanReviewResponse};
use serde::Serialize;

pub fn print_json<T: Serialize>(value: &T) -> Result<()> {
    println!("{}", serde_json::to_string_pretty(value)?);
    Ok(())
}

pub fn print_plan(plan: &DayPlan) {
    println!("DeepBlock {}", plan.date);
    for revision in &plan.revisions {
        println!("Revision {}", revision.id);
        if revision.blocks.is_empty() {
            println!("  (no blocks)");
            continue;
        }
        for block in &revision.blocks {
            println!(
                "  [{}] {} {} ({} min, {:?})",
                block.id, block.start, block.label, block.duration, block.block_type
            );
        }
    }
}

pub fn print_status(status: &str, version: &str, pid: Option<u32>) {
    if let Some(pid) = pid {
        println!("status: {status} (v{version}, pid {pid})");
    } else {
        println!("status: {status} (v{version})");
    }
}

pub fn print_backlog(backlog: &[Backlog]) {
    if backlog.is_empty() {
        println!("Backlog is empty");
        return;
    }

    for task in backlog {
        println!("[{}] {} ({:?})", task.id, task.label, task.status);
    }
}

pub fn print_review(review: &PlanReviewResponse) {
    println!(
        "Plan review {} revision {} · {} report(s)",
        review.date, review.revision_id, review.summary.total_reports
    );

    if review.reports.is_empty() {
        println!("No variance reports.");
        return;
    }

    for report in &review.reports {
        println!(
            "- [{:?}] {:?} · {} · {}",
            report.severity, report.variance_type, report.block_label, report.suggestion
        );
    }
}
