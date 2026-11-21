//! Version-one manual context and immutable intent contracts.
use serde::{Deserialize, Serialize};

use crate::{
    error::{AppError, AppResult},
    models::{BlockStatus, BlockType, DayPlan},
};

pub const CONTRACT_VERSION: u32 = 1;

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Ownership {
    Personal,
    Employer,
    Client,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Project {
    pub id: String,
    pub name: String,
    pub ownership: Ownership,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Goal {
    pub id: String,
    pub label: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ContextCatalog {
    pub schema_version: u32,
    pub projects: Vec<Project>,
    pub goals: Vec<Goal>,
}

impl Default for ContextCatalog {
    fn default() -> Self {
        Self {
            schema_version: CONTRACT_VERSION,
            projects: Vec::new(),
            goals: Vec::new(),
        }
    }
}

impl ContextCatalog {
    pub fn validate(&self) -> AppResult<()> {
        if self.schema_version != CONTRACT_VERSION {
            return Err(AppError::BadRequest(
                "Unsupported context schema version".into(),
            ));
        }
        for entries in [
            self.projects
                .iter()
                .map(|p| (&p.id, &p.name))
                .collect::<Vec<_>>(),
            self.goals.iter().map(|g| (&g.id, &g.label)).collect(),
        ] {
            let mut ids = std::collections::BTreeSet::new();
            for (id, label) in entries {
                if uuid::Uuid::parse_str(id).is_err() || label.trim().is_empty() || !ids.insert(id)
                {
                    return Err(AppError::BadRequest(
                        "Context requires unique UUIDs and nonempty labels".into(),
                    ));
                }
            }
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct IntentBlock {
    pub block_id: String,
    pub label: String,
    pub start: String,
    pub duration: u16,
    pub block_type: BlockType,
    pub status: BlockStatus,
    pub next_action: Option<String>,
    pub artifacts: Vec<String>,
    pub content_path: Option<String>,
    pub project: Option<Project>,
    pub goal: Option<Goal>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct IntentSnapshot {
    pub schema_version: u32,
    pub version: String,
    pub recorded_at: String,
    pub date: String,
    pub revision_id: String,
    pub blocks: Vec<IntentBlock>,
}

impl IntentSnapshot {
    pub fn capture(plan: &DayPlan, catalog: &ContextCatalog) -> Self {
        let revision = plan.active_revision();
        let blocks = revision
            .into_iter()
            .flat_map(|r| &r.blocks)
            .map(|b| IntentBlock {
                block_id: b.id.clone(),
                label: b.label.clone(),
                start: b.start.clone(),
                duration: b.duration,
                block_type: b.block_type,
                status: b.status,
                next_action: b.next_action.clone(),
                artifacts: b.artifacts.clone(),
                content_path: b.content_path.clone(),
                project: b
                    .metadata
                    .get("project_id")
                    .and_then(|v| v.as_str())
                    .and_then(|id| catalog.projects.iter().find(|p| p.id == id))
                    .cloned(),
                goal: b
                    .metadata
                    .get("goal_id")
                    .and_then(|v| v.as_str())
                    .and_then(|id| catalog.goals.iter().find(|g| g.id == id))
                    .cloned(),
            })
            .collect();
        Self {
            schema_version: CONTRACT_VERSION,
            version: uuid::Uuid::new_v4().to_string(),
            recorded_at: chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Nanos, true),
            date: plan.date.clone(),
            revision_id: revision.map(|r| r.id.clone()).unwrap_or_default(),
            blocks,
        }
    }

    /// Annotation and notes writes do not redefine scheduling intent.
    pub fn same_intent(&self, other: &Self) -> bool {
        self.date == other.date
            && self.revision_id == other.revision_id
            && self.blocks == other.blocks
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::Block;
    use serde_json::json;

    #[test]
    fn catalog_validation_rejects_each_defect_alone() {
        let catalog = |projects| ContextCatalog {
            schema_version: 1,
            projects,
            goals: Vec::new(),
        };
        let uuid = "0b6bb69c-4c74-4d63-bd50-a4b626a35a75";
        catalog(vec![Project {
            id: "not-a-uuid".into(),
            name: "Named".into(),
            ownership: Ownership::Personal,
        }])
        .validate()
        .expect_err("invalid UUIDs are rejected even with a nonempty label");
        catalog(vec![Project {
            id: uuid.into(),
            name: "  ".into(),
            ownership: Ownership::Personal,
        }])
        .validate()
        .expect_err("blank labels are rejected even with a valid unique UUID");
        let project = Project {
            id: uuid.into(),
            name: "Named".into(),
            ownership: Ownership::Personal,
        };
        catalog(vec![project.clone(), project.clone()])
            .validate()
            .expect_err("duplicate IDs are rejected even when otherwise valid");
        catalog(vec![project])
            .validate()
            .expect("valid catalogs pass");
    }

    #[test]
    fn snapshot_resolves_the_matching_project_and_goal() {
        let first = Project {
            id: "0b6bb69c-4c74-4d63-bd50-a4b626a35a75".into(),
            name: "First".into(),
            ownership: Ownership::Personal,
        };
        let second = Project {
            id: "16466e35-4c22-4c8f-8e2a-6db3924dd8f6".into(),
            name: "Second".into(),
            ownership: Ownership::Personal,
        };
        let first_goal = Goal {
            id: "24e25bf5-915c-4a2c-873e-6cbf10062028".into(),
            label: "First goal".into(),
        };
        let second_goal = Goal {
            id: "324dcba8-b0a8-4b6f-b24a-023127c5c934".into(),
            label: "Second goal".into(),
        };
        let catalog = ContextCatalog {
            schema_version: 1,
            projects: vec![first, second.clone()],
            goals: vec![first_goal, second_goal.clone()],
        };
        let mut plan = DayPlan::new("2026-01-05");
        let mut request: crate::models::AddBlockRequest =
            serde_json::from_value(json!({"label":"Work", "start":"09:00", "duration":60}))
                .unwrap();
        request.metadata.insert(
            "project_id".into(),
            json!("16466e35-4c22-4c8f-8e2a-6db3924dd8f6"),
        );
        request.metadata.insert(
            "goal_id".into(),
            json!("324dcba8-b0a8-4b6f-b24a-023127c5c934"),
        );
        plan.active_revision_mut()
            .unwrap()
            .blocks
            .push(Block::from_request(request, &[]));
        let snapshot = IntentSnapshot::capture(&plan, &catalog);
        assert_eq!(snapshot.blocks[0].project.as_ref().unwrap().id, second.id);
        assert_eq!(snapshot.blocks[0].goal.as_ref().unwrap().id, second_goal.id);
    }

    #[test]
    fn feedback_is_independent_and_mutable_heads_have_distinct_intentions() {
        let mut plan = DayPlan::new("2026-01-05");
        let block = Block::from_request(
            serde_json::from_value(json!({"label":"Work", "start":"09:00", "duration":60}))
                .unwrap(),
            &[],
        );
        plan.active_revision_mut().unwrap().blocks.push(block);
        let catalog = ContextCatalog::default();
        let committed = IntentSnapshot::capture(&plan, &catalog);
        plan.active_revision_mut().unwrap().blocks[0].actual_duration = Some(0);
        plan.active_revision_mut().unwrap().blocks[0]
            .metadata
            .insert("outcome_completed".into(), json!(true));
        assert!(committed.same_intent(&IntentSnapshot::capture(&plan, &catalog)));
        plan.active_revision_mut().unwrap().blocks[0].start = "10:00".into();
        assert!(!committed.same_intent(&IntentSnapshot::capture(&plan, &catalog)));
        plan.active_revision_mut().unwrap().blocks[0].start = "09:00".into();
        plan.active_revision_mut().unwrap().blocks[0].content_path =
            Some("expected-artifact.md".into());
        assert!(!committed.same_intent(&IntentSnapshot::capture(&plan, &catalog)));
        assert!(chrono::DateTime::parse_from_rfc3339(&committed.recorded_at).is_ok());
    }
}
