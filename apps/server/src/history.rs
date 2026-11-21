use serde::{Deserialize, Serialize};
use std::collections::VecDeque;

use crate::models::DayPlan;

const HISTORY_DEPTH: usize = 50;

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
pub struct PlanHistory {
    #[serde(default)]
    pub undo: VecDeque<DayPlan>,
    #[serde(default)]
    pub redo: VecDeque<DayPlan>,
}

impl PlanHistory {
    pub fn snapshot(&mut self, plan: &DayPlan) {
        self.undo.push_back(plan.clone());
        if self.undo.len() > HISTORY_DEPTH {
            let _ = self.undo.pop_front();
        }
        self.redo.clear();
    }

    pub fn undo(&mut self, current: &DayPlan) -> Option<DayPlan> {
        let previous = self.undo.pop_back()?;
        self.redo.push_back(current.clone());
        Some(previous)
    }

    pub fn redo(&mut self, current: &DayPlan) -> Option<DayPlan> {
        let next = self.redo.pop_back()?;
        self.undo.push_back(current.clone());
        Some(next)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn snapshot_evicts_oldest_when_exceeding_depth() {
        let mut history = PlanHistory::default();
        let plan = DayPlan::new("2026-04-17".to_string());
        for _ in 0..(HISTORY_DEPTH + 1) {
            history.snapshot(&plan);
        }
        assert_eq!(history.undo.len(), HISTORY_DEPTH);
    }
}
