# Kanban Workflow Integration

**Status: proposal.** The current backlog is implemented; the fuller board, task lifecycle, and displacement automation below remain proposed. Apply the [mindful self-direction principles](../project-analysis/mindful-self-direction.md) and current [intent/outcome contracts](planning-context-contracts.md).

## Why this document exists

Time-blocking makes **when** and **capacity** visible. Existing meetings, breaks, and other commitments leave finite room for chosen work. A compact task reservoir can help a person choose a few commitments without reconstructing them from an empty grid.

Conversely, a pure Kanban board solves **what** (asynchronous task capture), but creates the **infinite to-do list illusion**: placing 15 cards in "To Do" ignores that you only have 3 hours of open calendar space between meetings.

This document specifies how a compact, personal Kanban board acts as the **upstream reservoir** for DeepBlock's Schedule-X time-grid, bridging asynchronous task triage with synchronous time allocation while preserving DeepBlock's defining **revision-over-mutation** philosophy.

---

## The core guardrails

1. **Kanban is the reservoir; the time-grid is the commitment.**  
   Tasks in Kanban have no fixed time attached. Scheduling adds them to the draft; saving the plan revision makes the time allocation a commitment.
2. **Revisions preserve causal traceability.**  
   If a task scheduled in `Plan A` is bumped or removed in `Plan B` (e.g., due to an outage), the task is not silently erased—it returns to the reservoir with an audit note documenting _why_ it was displaced.
3. **Execution mode hides the reservoir.**  
   Offer a collapsed backlog during a focus block so the current commitment can stay visible without the entire reservoir competing for attention.
4. **Strictly solo, strictly low-overhead.**  
   No epics, no sprint points, no multi-user burndown charts. This is a personal operating cockpit, not Jira.

---

## The Two-Speed Engine: Macro Triage to Micro Execution

```text
┌───────────────────────────────────────────────┐   ┌─────────────────────────────────────────┐
│              KANBAN RESERVOIR                 │   │         DEEPBLOCK TIME-GRID             │
│                (Asynchronous)                 │   │         (Synchronous Reality)           │
│                                               │   │                                         │
│   [ Backlog ]   [ Next Up ]    [ Today ]      │   │   08:00  [ Deep Work: API Refactor  ]   │
│   ┌─────────┐   ┌─────────┐   ┌─────────┐     │   │   09:30  [ Break                    ]   │
│   │ Card 1  │   │ Card 3  │   │ Card 5  ├─────┼───►   10:00  [ Shallow: Email Triage    ]   │
│   │ Card 2  │   │ Card 4  │   └─────────┘     │   │   11:00  [ Meeting (Locked Overlay) ]   │
│   └─────────┘   └─────────┘                   │   │   12:00  [ Lunch                    ]   │
└───────────────────────────────────────────────┘   └─────────────────────────────────────────┘
           STEP 1: TRIAGE & SELECT                              STEP 2: ALLOCATE TIME
```

### 1. Continuous Capture (Anytime)

When an errand, bug, or idea arises during the day, it is immediately dumped into the **Backlog** column via shortcut (or CLI `deepb backlog add "..."`). It does not disrupt the active day plan.

### 2. Daily Planning Ritual (Morning Startup)

1. Review _Backlog_ briefly and select a few cards for **Today**, according to the time available. Leave unallocated time; a long backlog does not require a full calendar.
2. Drag cards from _Today_ directly onto the Schedule-X grid slots.
3. Dragging prompts for duration (e.g., 90m) and block type (`focus` or `shallow`).
4. These edits remain a draft until **Save revised plan** commits the morning baseline, normally **`Plan A`**. Dragging alone does not save.
5. Keep notes reachable from the day's work and make outcome review optional. Target a brief ordinary planning pass rather than a mandatory triage ritual.

---

## Revision Causal Traceability (The DeepBlock Differentiator)

DeepBlock's revisions preserve task displacement as context for later reflection. A changed priority or interruption is an ordinary reason to replan:

1. **Scheduled in Plan A:** Task _"Refactor Auth"_ is scheduled for 14:00–16:00 in `Plan A`.
2. **Displaced in Plan B:** A production fire strikes at 14:00. The user branches into `Plan B` (Reason: _"Production DB Outage"_), allocating 14:00–16:30 to the incident.
3. **Automated Displacement Handling:**
   - DeepBlock detects that _"Refactor Auth"_ was present in `Plan A` but omitted in `Plan B`.
   - The UI surfaces a non-blocking prompt:  
     `"Refactor Auth was displaced in Plan B. Return to Next Up or roll over to tomorrow?"`
   - The card's internal history records:  
     `Scheduled in Plan A → Displaced in Plan B (Reason: Production DB Outage).`

---

## Optional activity evidence and explicit outcomes

Activity evidence may be linked to a scheduled card for voluntary review:

1. An optional audit supplies computer-active time, category mix, applications/domains, provenance, and coverage. Category match is not objective attention or task completion.
2. The user may explicitly mark the card **Done** independently of elapsed time, audit results, or checkout. A finished block never automatically completes a task.
3. Keep that completion annotation separate from evidence references and optional notes. Unreported outcomes remain unknown rather than failed.
4. Describe activity outside scheduled blocks neutrally when no applicable intention exists. That timeline belongs to future recording work; the current ActivityWatch audit covers planned windows.

Reconcile this proposal with [multi-day review](multi-day-review.md) and the [advanced assessment contract](../project-analysis/advanced-deepblock-vision.md#intent-and-assessment) before implementing it.

---

## UX Layout: Split-Pane vs. Focus Mode

### Planning Mode (Morning Startup / Replanning)

- **Split Layout:**
  - **Left Pane (30% width):** Compact Kanban drawer displaying three lanes:
    - _Backlog_ (unsorted pool)
    - _Next Up_ (current week priority)
    - _Today_ (staged for scheduling)
  - **Right Pane (70% width):** Full Schedule-X vertical time-grid with revision history columns (`Plan A`, `Plan B`).
- Drag-and-drop handles smoothly transition cards from _Today_ into time slots on the grid.

### Focus Mode (Execution)

- Shortcut (`Cmd+B`) or mode toggle collapses the Kanban drawer completely.
- Only the vertical time-grid, current block countdown timer, and notes view remain visible.

---

## Rust Backend Schema Extensions

DeepBlock already provides baseline backlog storage (`apps/server/src/routes/backlog.rs`). To support full Kanban lifecycle and displacement tracking, `apps/server/src/models.rs` extends as follows:

```rust
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum KanbanColumn {
    Backlog,
    NextUp,
    Today,
    Done,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct TaskCard {
    pub id: String,                         // UUID
    pub title: String,
    pub description: Option<String>,
    pub column: KanbanColumn,
    pub estimated_minutes: Option<u16>,
    pub origin_block_id: Option<String>,    // If scheduled in active revision
    pub created_at: String,
    pub completed_at: Option<String>,
    pub evidence_refs: Vec<String>,         // Optional source references, not a completion score
}

// Block model gains optional traceability reference:
pub struct Block {
    // ... existing fields ...
    pub origin_task_id: Option<String>,     // Reference back to TaskCard
}
```

---

## Non-goals

- No multi-user boards, permissions, or assignments.
- No recursive subtask trees or nested epics (use simple Markdown checklists inside notes if needed).
- No automated algorithmic task shifting (users decide their commitments; the tool does not auto-scramble schedules).
- No mandatory checkout, productivity grade, or automatic completion based on tracker data.
- No requirement to schedule every task or account for every hour.
