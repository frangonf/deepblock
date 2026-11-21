use chrono::{Duration, Local, NaiveDateTime};

use crate::{
    error::{AppError, AppResult},
    models::{Block, DayPlan, Revision, RevisionCopyMode, now_timestamp},
};

pub fn next_revision_id(existing_revision_count: usize) -> String {
    let mut index = existing_revision_count;
    let mut out = String::new();

    loop {
        let remainder = index % 26;
        out.insert(0, (b'A' + remainder as u8) as char);
        index /= 26;
        if index == 0 {
            break;
        }
        index -= 1;
    }

    out
}

pub fn copy_blocks_for_mode(blocks: &[Block], copy_mode: RevisionCopyMode) -> Vec<Block> {
    match copy_mode {
        RevisionCopyMode::All => blocks.to_vec(),
        RevisionCopyMode::Empty => Vec::new(),
        RevisionCopyMode::FromNow => {
            let current_time = chrono::Local::now().format("%H:%M").to_string();
            blocks
                .iter()
                .filter(|block| block.start >= current_time)
                .cloned()
                .collect()
        }
    }
}

pub fn append_revision(
    plan: &mut DayPlan,
    reason: Option<String>,
    copy_mode: RevisionCopyMode,
) -> AppResult<()> {
    let active_revision = plan
        .active_revision()
        .cloned()
        .ok_or_else(|| AppError::BadRequest("No active revision found".to_string()))?;

    plan.revisions.push(Revision {
        id: next_revision_id(plan.revisions.len()),
        created_at: now_timestamp(),
        reason,
        blocks: copy_blocks_for_mode(&active_revision.blocks, copy_mode),
    });

    Ok(())
}

pub fn block_is_past_grace_period(block: &Block, grace_minutes: u16) -> bool {
    NaiveDateTime::parse_from_str(&block.created_at, "%Y-%m-%dT%H:%M:%S%.6f")
        .map(|created_at| {
            Local::now().naive_local() - created_at > Duration::minutes(i64::from(grace_minutes))
        })
        // If legacy or hand-edited data has an invalid timestamp, prefer preserving the revision
        // trail rather than silently skipping an automatic revision.
        .unwrap_or(true)
}

pub fn normalize_blocks(blocks: &mut [Block]) {
    blocks.sort_by(|left, right| {
        left.start
            .cmp(&right.start)
            .then(left.label.cmp(&right.label))
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{AddBlockRequest, BlockStatus, ChangeLogEntry, ChangeType};
    use proptest::prelude::*;
    use std::collections::{BTreeMap, BTreeSet};

    #[test]
    fn revision_ids_follow_excel_style_sequence() {
        assert_eq!(next_revision_id(0), "A");
        assert_eq!(next_revision_id(25), "Z");
        assert_eq!(next_revision_id(26), "AA");
        assert_eq!(next_revision_id(27), "AB");
        assert_eq!(next_revision_id(51), "AZ");
        assert_eq!(next_revision_id(52), "BA");
    }

    proptest! {
        #![proptest_config(ProptestConfig {
            cases: 128,
            max_shrink_iters: 4096,
            ..ProptestConfig::default()
        })]

        #[test]
        fn property_revision_ids_roundtrip_and_are_unique(
            offset in 0_usize..1_000_000,
            count in 1_usize..100,
        ) {
            let mut seen = BTreeSet::new();
            for index in offset..offset + count {
                let id = next_revision_id(index);
                prop_assert!(!id.is_empty());
                prop_assert!(id.bytes().all(|letter| letter.is_ascii_uppercase()));
                // Read the public Excel-style identifier as a bijective base-26 number.
                let ordinal = id.bytes().fold(0_usize, |value, letter| {
                    value * 26 + usize::from(letter - b'A' + 1)
                });
                prop_assert_eq!(ordinal, index + 1);
                prop_assert!(seen.insert(id));
            }
        }

        #[test]
        fn property_from_now_copies_only_current_or_future_rows_without_changing_them(
            starts in proptest::collection::vec(0_u16..1440, 0..30),
        ) {
            let blocks: Vec<_> = starts.iter().enumerate().map(|(index, start)| {
                let mut row = Block::from_request(AddBlockRequest {
                    label: format!("Row {index}"),
                    start: format!("{:02}:{:02}", start / 60, start % 60),
                    duration: 1,
                    artifacts: Some(vec![format!("artifact-{index}")]),
                    ..AddBlockRequest::default()
                }, &[]);
                row.id = format!("row-{index}");
                row
            }).collect();
            let before_minute = Local::now().format("%H:%M").to_string();
            let copied = copy_blocks_for_mode(&blocks, RevisionCopyMode::FromNow);
            let after_minute = Local::now().format("%H:%M").to_string();

            // Bracket the clock read: a minute transition may make one boundary ambiguous.
            // Even at midnight, copied rows must remain an unchanged ordered subsequence.
            let mut remaining = blocks.iter();
            for row in &copied {
                let original = remaining.find(|original| original.id == row.id);
                prop_assert_eq!(original, Some(row));
            }
            if before_minute <= after_minute {
                for row in &blocks {
                    let included = copied.iter().any(|candidate| candidate.id == row.id);
                    if row.start < before_minute {
                        prop_assert!(!included);
                    } else if row.start >= after_minute {
                        prop_assert!(included);
                    }
                }
            }
        }

        #[test]
        fn property_revision_sequences_preserve_snapshots_and_copy_mode(
            initial in proptest::collection::vec((".{0,24}", 0_u16..1440, 1_u16..481, any::<bool>()), 1..8),
            operations in proptest::collection::vec((any::<bool>(), ".{0,40}"), 1..40),
        ) {
            let mut plan = DayPlan::new("2026-10-09");
            plan.note_path = Some("notes/2026-10-09.md".into());
            plan.change_log.push(ChangeLogEntry {
                timestamp: "2026-10-09T09:00:00.000000".into(),
                change_type: ChangeType::Update,
                block_id: "initial-0".into(),
                block_label: "Recorded change".into(),
                details: BTreeMap::from([("label".into(), serde_json::json!({"before": "a", "after": "b"}))]),
            });
            for (index, (label, start, duration, cancelled)) in initial.into_iter().enumerate() {
                let mut row = Block::from_request(AddBlockRequest {
                    label,
                    start: format!("{:02}:{:02}", start / 60, start % 60),
                    duration,
                    status: if cancelled { BlockStatus::Cancelled } else { BlockStatus::Confirmed },
                    next_action: Some("Keep accountability fields".into()),
                    content_path: Some(format!("notes/block-{index}.md")),
                    artifacts: Some(vec![format!("artifact-{index}")]),
                    metadata: BTreeMap::from([("project_id".into(), serde_json::json!(format!("project-{index}")))]),
                    ..AddBlockRequest::default()
                }, &[]);
                row.id = format!("initial-{index}");
                plan.active_revision_mut().expect("initial revision").blocks.push(row);
            }

            let template = plan.active_revision().expect("initial revision").blocks[0].clone();
            for (copy_all, reason) in operations {
                // Refill an empty head so later All/Empty transitions still exercise data copying.
                let head = plan.active_revision_mut().expect("head");
                if head.blocks.is_empty() {
                    head.blocks.push(template.clone());
                }
                let before = plan.clone();
                let expected_blocks = if copy_all {
                    before.active_revision().expect("head").blocks.clone()
                } else {
                    Vec::new()
                };
                let mode = if copy_all { RevisionCopyMode::All } else { RevisionCopyMode::Empty };
                append_revision(&mut plan, Some(reason.clone()), mode).expect("valid plan appends");

                prop_assert_eq!(plan.revisions.len(), before.revisions.len() + 1);
                prop_assert_eq!(&plan.revisions[..before.revisions.len()], before.revisions.as_slice());
                prop_assert_eq!(&plan.change_log, &before.change_log);
                prop_assert_eq!(&plan.note_path, &before.note_path);
                prop_assert_eq!(&plan.date, &before.date);
                prop_assert_eq!(plan.schema_version, before.schema_version);
                let head = plan.active_revision().expect("appended head");
                prop_assert_eq!(&head.blocks, &expected_blocks);
                prop_assert_eq!(&head.reason, &Some(reason));
                prop_assert_eq!(plan.revisions.iter().map(|revision| &revision.id).collect::<BTreeSet<_>>().len(), plan.revisions.len());

                // Mutate the new head to ensure cloning did not alias an earlier snapshot.
                if let Some(row) = plan.active_revision_mut().expect("head").blocks.first_mut() {
                    row.label.push_str(" edited");
                    row.artifacts.push("new-head-only".into());
                }
                prop_assert_eq!(&plan.revisions[..before.revisions.len()], before.revisions.as_slice());
            }
        }
    }
}
