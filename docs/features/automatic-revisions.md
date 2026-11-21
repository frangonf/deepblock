# Automatic Revisions

## User Story

> **As a time blocker**, I want my schedule changes to be automatically tracked after an initial planning period, **so that** at the end of the day I can compare my intended plan with reality and learn from the gap between intention and execution.

## Intent

Cal Newport's time blocking methodology emphasizes that **the plan itself is less important than the act of planning**. What matters most is:

1. **Starting with intention** - Creating a deliberate plan for your day
2. **Adapting mindfully** - Making conscious decisions when reality forces changes
3. **Learning from variance** - Reviewing how your day actually unfolded versus the plan

Revision history supports this reflection by **creating a paper trail of your changes**. When you move "Lunch" from 12:00 to 12:30 because a meeting ran over, that change is recorded. At day's end, you can see exactly how your day diverged from the plan—and more importantly, **why**.

This is not about guilt or perfectionism. It's about **data-driven self-awareness**. Over time, patterns emerge:

- "I always underestimate how long code reviews take"
- "Mornings get interrupted more than afternoons"
- "I consistently skip my afternoon break"

These insights support later choices, including better estimates, protected breaks, or reconsidering a commitment. The [product principles](../project-analysis/mindful-self-direction.md) keep this notebook-like practice voluntary and centered on the user's judgment.

---

## The Problem

When time blocking, the gap between your intended plan and what actually happens is valuable data. Without tracking changes, you lose insight into:

- How often you reschedule tasks
- Which blocks tend to get moved or deleted
- The difference between your morning plan and end-of-day reality
- Patterns in how your days actually unfold

## The Solution

The Rust server enforces four revision strategies for individual block edits, deletes, moves, and repositions, plus a configurable grace period for `timed`. The shared Settings page exposes these settings; manual revisions still work through the CLI, API, and planner UI.

### Scope: explicit drafts versus individual mutations

The strategies and CLI/API examples below apply to individual active-head mutations, not to shared-UI draft gestures. Calendar/list edits stay local until **Save revised plan**. That explicit batch commitment fills an untouched bootstrap A on the first plan; otherwise it appends one revision for the complete batch, regardless of the automatic strategy. An optional reason is retained with the draft; blank reasons use `Replanned from <base id>`.

Notes autosave independently and never create plan revisions. `PATCH /blocks/{id}/outcome` explicitly saves voluntary feedback for today or past days without applying revision policy, including under `every_change`; it cannot change planned scheduling fields. These deliberately different contracts preserve existing CLI/API behavior rather than silently converging it. See [Core planning trust](core-planning-trust.md) for the decisions and limits.

---

## Configuration Reference

### All Related Settings

```toml
# ~/.config/deepblock/config.toml

[client.revision]
# Revision strategy: how/when automatic revisions are created
# Options: "manual" | "timed" | "every_change" | "never"
# Default: "manual"
strategy = "timed"

# Grace period in minutes (only used with "timed" strategy)
# Blocks younger than this won't trigger auto-revision when modified
# Default: 5
grace_minutes = 5

[client]
# Default copy mode when creating manual revisions
# Options: "all" | "from_now" | "empty"
# Default: "all"
default_revision_copy_mode = "all"
```

### Configuration via API

```bash
# Get current settings
curl http://localhost:8000/config

# Response includes:
# {
#   "revision_strategy": "manual",
#   "revision_grace_minutes": 5,
#   "default_revision_copy_mode": "all",
#   ...
# }

# Update revision settings
curl -X PATCH http://localhost:8000/config \
  -H "Content-Type: application/json" \
  -d '{
    "revision_strategy": "timed",
    "revision_grace_minutes": 10
  }'
```

### Configuration via Desktop UI

Open **Settings** in the desktop app to change:

- default revision copy mode
- automatic revision strategy
- timed-mode grace minutes

### Environment Variables

No environment variables for revision settings. Use the config file, API, or desktop settings UI.

---

## Strategies Explained

### `manual` (Default)

**Intent:** Full control. You decide when to create revisions.

**Behavior:**

- Changes to blocks are applied directly to the active revision
- No automatic revisions created
- Use `deepb revise` or `POST /plan/revise` to create revisions manually

**Best for:** Users who want explicit control, or who are new to time blocking.

```
09:00  Create plan with blocks A, B, C (Revision A)
10:30  Move block B → No new revision
11:00  Delete block C → No new revision
14:00  Manual: deepb revise "afternoon adjustments" → Creates Revision B
```

---

### `timed`

**Intent:** Balance between tracking and noise. Capture meaningful changes while ignoring quick adjustments.

**Behavior:**

- Each block has a `created_at` timestamp
- Changes within the grace period (default: 5 minutes) don't create revisions
- Changes after the grace period automatically create a new revision

**Best for:** Daily work. Catches significant schedule changes while allowing quick fixes.

```
09:00  Create block "Deep Work" (created_at: 09:00)
09:02  Change duration 60m → 90m → No revision (within 5 min grace)
09:04  Move to 09:30 → No revision (within 5 min grace)
09:08  Change label → NEW REVISION (past 5 min grace)
       Reason: "Auto: updated 'Deep Work' (label 'Deep Work' -> 'Code Review')"
```

**Grace Period Logic:**

```
Block age = now - block.created_at
If block age <= grace_minutes: No auto-revision
If block age > grace_minutes: Create auto-revision
```

---

### `every_change`

**Intent:** Maximum visibility. Every modification is recorded.

**Behavior:**

- Any change to an existing block creates a new revision
- Useful for debugging schedule patterns or detailed tracking

**Best for:** Temporary use when analyzing schedule problems, or for users who want complete history.

```
09:00  Create block "Meeting" (Revision A)
09:05  Change start time → NEW REVISION B
09:10  Change duration → NEW REVISION C
09:15  Delete block → NEW REVISION D
```

**Warning:** Can create many revisions. Consider using `timed` for regular work.

---

### `never`

**Intent:** Minimal UI clutter, but still track changes for analysis.

**Behavior:**

- No automatic revisions created
- All changes are logged to `change_log` field in the day plan
- The comparison response includes the change log, but snapshot diffs require distinct saved revisions; it does not reconstruct the initial intent from log entries

**Best for:** Users who find multiple revisions distracting but still want end-of-day insights.

```
09:00  Create plan (Revision A only)
10:00  Move block → No revision, logged to change_log
11:00  Delete block → No revision, logged to change_log
17:00  Compare: Snapshot diff is empty; change_log remains available
```

---

## Flows

### Flow 1: Morning Planning with Timed Strategy

```
┌─────────────────────────────────────────────────────────────┐
│  08:30 - Start of Day Planning                              │
├─────────────────────────────────────────────────────────────┤
│  1. Open DeepBlock (creates Revision A automatically)       │
│  2. Add blocks for the day:                                 │
│     - 09:00 Deep Work (2h)                                  │
│     - 11:00 Team Standup (30m)                              │
│     - 11:30 Code Review (1h)                                │
│     - 12:30 Lunch (1h)                                      │
│     - 13:30 Meetings (2h)                                   │
│     - 15:30 Deep Work (2h)                                  │
│                                                             │
│  3. Quick adjustments (within 5 min grace):                 │
│     - Move Lunch to 12:00 → No revision                     │
│     - Change Deep Work to 90m → No revision                 │
│                                                             │
│  Result: Single clean Revision A with your plan             │
└─────────────────────────────────────────────────────────────┘
```

### Flow 2: Mid-Day Adaptation

```
┌─────────────────────────────────────────────────────────────┐
│  11:15 - Unexpected Meeting Request                         │
├─────────────────────────────────────────────────────────────┤
│  Current: Code Review @ 11:30                               │
│  Need: Urgent meeting @ 11:30                               │
│                                                             │
│  1. Delete "Code Review" block (created > 5 min ago)        │
│     → AUTO-REVISION B created                               │
│     → Reason: "Auto: deleted 'Code Review'"                 │
│                                                             │
│  2. Add "Urgent Meeting" @ 11:30                            │
│     → Added to Revision B (no new revision for adds)        │
│                                                             │
│  Result: Revision B shows the schedule adaptation           │
└─────────────────────────────────────────────────────────────┘
```

### Flow 3: End-of-Day Review

```
┌─────────────────────────────────────────────────────────────┐
│  17:30 - End of Day Reflection                              │
├─────────────────────────────────────────────────────────────┤
│  $ deepb compare                                            │
│                                                             │
│  ╭─────────────────────────────────────────╮                │
│  │ Comparing revision A → D                │                │
│  ╰─────────────────────────────────────────╯                │
│                                                             │
│  2 added, 1 removed, 2 modified                             │
│                                                             │
│  Added:                                                     │
│    + Urgent Meeting @ 11:30 (60m)                           │
│    + Bug Fix @ 16:00 (30m)                                  │
│                                                             │
│  Removed:                                                   │
│    - Code Review @ 11:30 (60m)                              │
│                                                             │
│  Modified:                                                  │
│    ~ Lunch: time 12:30 → 13:00                              │
│    ~ Deep Work: duration 120m → 90m                         │
│                                                             │
│  INSIGHT: Meeting interruptions pushed lunch late and       │
│           reduced deep work time. Consider blocking         │
│           11:00-12:00 as "no meetings" in calendar.         │
└─────────────────────────────────────────────────────────────┘
```

### Flow 4: Never Mode with Change Log

```
┌─────────────────────────────────────────────────────────────┐
│  Using "never" strategy                                     │
├─────────────────────────────────────────────────────────────┤
│  $ deepb compare --json                                     │
│                                                             │
│  {                                                          │
│    "base_revision": "A",                                    │
│    "compare_revision": "A",  // Same! No revisions created  │
│    "added": [],                                             │
│    "removed": [],                                           │
│    "modified": [],                                          │
│    "change_log": [           // But changes are tracked!    │
│      {                                                      │
│        "timestamp": "2024-01-15T10:30:00",                  │
│        "change_type": "update",                             │
│        "block_id": "abc123",                                │
│        "block_label": "Team Meeting",                       │
│        "details": {                                         │
│          "start": {                                          │
│            "before": "10:00",                                │
│            "after": "10:30"                                  │
│          }                                                   │
│        }                                                    │
│      },                                                     │
│      {                                                      │
│        "timestamp": "2024-01-15T14:15:00",                  │
│        "change_type": "delete",                             │
│        "block_id": "def456",                                │
│        "block_label": "Documentation",                      │
│        "details": {"removed": "def456"}                     │
│      }                                                      │
│    ],                                                       │
│    "summary": "0 added, 0 removed, 0 modified"              │
│  }                                                          │
└─────────────────────────────────────────────────────────────┘
```

---

## Operations That Trigger Revisions

| Operation            | Endpoint                             | Creates Revision?                         | Logged in Never Mode?         |
| -------------------- | ------------------------------------ | ----------------------------------------- | ----------------------------- |
| Add block            | `POST /blocks`                       | No                                        | Yes                           |
| Update block         | `PATCH /blocks/{id}`                 | Yes\*                                     | Yes                           |
| Delete block         | `DELETE /blocks/{id}`                | Yes\*                                     | Yes                           |
| Move block (reorder) | `PATCH /blocks/{id}/move`            | Yes\*                                     | Yes                           |
| Reposition block     | `PATCH /blocks/{id}/reposition`      | Yes\*                                     | Yes                           |
| Add/remove artifact  | `POST/DELETE /blocks/{id}/artifacts` | No                                        | Yes                           |
| Create revision      | `POST /plan/revise`                  | Always (manual)                           | N/A                           |
| Batch replan         | `POST /plan/replan`                  | Fills untouched A; otherwise one revision | Yes (one entry per operation) |
| Record outcome       | `PATCH /blocks/{id}/outcome`         | No (feedback only, including past days)   | Yes                           |

\*Depends on strategy and grace period

### Batch Replan

`POST /plan/replan` applies a list of draft operations against one revision.
If the day has only empty A, reason `Initial plan`, and no change log, the
first commitment fills A. Otherwise the batch appends one revision. Each
batch takes one history snapshot instead of one per operation, and previous
revision snapshots remain unchanged. Legacy histories are not renumbered.
The batch is atomic: if any operation fails, nothing is persisted. Plan and
undo/redo history share one atomic daily-file replacement, so failed writes
also preserve redo availability.

Draft clients should include `base_revision`, containing the full active
revision object read from the plan (not just its letter). A stale snapshot
returns HTTP 409 before any history or plan write. The shared UI retains the
draft and asks for an explicit rebase or discard; it freezes editing during
commit and recovers drafts from per-tab session storage after navigation or
reload. See [Storage and request safety](../storage-and-request-safety.md).

```json
{
  "reason": "Replanned from calendar draft",
  "copy_mode": "all",
  "operations": [
    {
      "op": "create",
      "block_id": "draft-1",
      "label": "Deep Work",
      "start": "09:00",
      "duration": 90,
      "type": "focus"
    },
    { "op": "update", "block_id": "draft-1", "status": "confirmed" },
    { "op": "delete", "block_id": "abc12345" }
  ]
}
```

The optional `block_id` on a `create` operation is a client-side (draft)
identifier; later operations in the same batch may reference the created
block through it, and the server resolves it to the generated id.

### Date-Scoped Mutations

All `/blocks` mutation endpoints and `POST /plan/replan` accept an optional
`?date=YYYY-MM-DD` query parameter that targets that day's plan (default:
today). Outcome annotations reject future dates and cancelled blocks.
`GET /plan/review` accepts the same parameter to review a specific day. Dates are strictly validated as `YYYY-MM-DD` before any filesystem
access. Impossible calendar dates are rejected, and block times must use
canonical zero-padded `HH:MM`. Updates distinguish an omitted nullable field
(leave unchanged) from explicit `null` (clear it), in both PATCH and batch
requests. Create requests retain the same accountability fields shown in the
planner form. Only actual scheduling changes trigger displacement.
Schedule or block-type changes invalidate cached reality in the edited head.

---

## Auto-Generated Revision Reasons

When revisions are created automatically, DeepBlock generates descriptive reasons:

| Change Type               | Example Reason                                                         |
| ------------------------- | ---------------------------------------------------------------------- |
| Delete                    | `Auto: deleted 'Lunch Break'`                                          |
| Move up                   | `Auto: moved 'Code Review' up`                                         |
| Move down                 | `Auto: moved 'Code Review' down`                                       |
| Reposition                | `Auto: repositioned 'Standup' 09:00 -> 09:30`                          |
| Update time               | `Auto: updated 'Deep Work' (time 10:00 -> 11:00)`                      |
| Update duration           | `Auto: updated 'Deep Work' (duration 60m -> 90m)`                      |
| Update label              | `Auto: updated 'Meeting' (label 'Meeting' -> 'Team Sync')`             |
| Multiple changes          | `Auto: updated 'Deep Work' (time 10:00 -> 11:00, duration 60m -> 90m)` |
| Non-schedule block fields | `Auto: updated 'Deep Work' (status proposed -> done)`                  |

---

## Comparing Revisions

### CLI

```bash
# Compare first nonempty saved plan with latest (normally A for new days)
deepb compare

# Compare specific revisions
deepb compare --base A --compare D

# JSON output for scripting/analysis
deepb compare --json
```

### API

```bash
# Default comparison (first nonempty saved plan vs latest)
curl http://localhost:8000/plan/compare

# Specific revisions
curl "http://localhost:8000/plan/compare?base=A&compare=C"
```

Legacy empty revisions remain explicitly selectable. If every revision is
empty, the default baseline is the first revision. The shared UI asks for two
different revisions instead of comparing a revision to itself. Comparisons also
show changes to actual minutes, self-rated focus, and recorded completion.

### Response Structure

```json
{
  "base_revision": "A",
  "compare_revision": "D",
  "added": [
    {
      "block_id": "xyz789",
      "label": "Emergency Bug Fix",
      "change_type": "added",
      "details": {"start": "14:00", "duration": 60}
    }
  ],
  "removed": [
    {
      "block_id": "abc123",
      "label": "Documentation",
      "change_type": "removed",
      "details": {"start": "14:00", "duration": 120}
    }
  ],
  "modified": [
    {
      "block_id": "def456",
      "label": "Lunch",
      "change_type": "modified",
      "details": {
        "start": {"before": "12:00", "after": "12:30"},
        "duration": {"before": 60, "after": 45}
      }
    }
  ],
  "change_log": [...],
  "summary": "1 added, 1 removed, 1 modified"
}
```

---

## Best Practices

1. **Start with `manual`** to understand the revision system before enabling automation

2. **Use `timed` for daily work** - catches significant changes while ignoring quick fixes during initial planning

3. **Set grace period based on your planning style:**
   - 5 minutes (default): Quick planners who finalize fast
   - 10-15 minutes: Deliberate planners who iterate on morning schedule
   - 2-3 minutes: Want to capture most changes

4. **Review comparisons at end of day** - the gap between plan and reality is where learning happens

5. **Use `every_change` temporarily** when debugging schedule issues or onboarding new users

6. **Use `never` if revisions feel noisy** - you still get the change log for analysis

7. **Look for patterns over time:**
   - Which blocks get moved most often?
   - What time of day has most changes?
   - Are certain block types (focus vs shallow) more stable?

---

## Related

- [Configuration Reference](../configuration.md)
- [CLI Commands](../../apps/cli/src/cli.rs)
- [API Routes](../../apps/server/src/routes/mod.rs)
