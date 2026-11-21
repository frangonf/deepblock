# Explicit intentions and dated feedback

Settings now provides optional project identities with personal/employer/client
ownership and cross-project goal identities. Open **Project and goal associations**
in Planner, select a draft block and its context, then **Save revised plan**.
Unassigned blocks remain supported. Association changes survive the same draft
navigation, recovery and explicit rebase flows as scheduling; narrow project/goal
updates preserve unrelated metadata and feedback.

API contracts:

- `GET /context` reads the catalog; `PUT /context` takes `{base, catalog}` and
  rejects a stale base with 409. Existing identities cannot be deleted. Renames
  and ownership changes publish new affected context versions atomically.
- `PATCH /blocks/{id}?date=YYYY-MM-DD` accepts nullable `project_id` and `goal_id`.
  Omit preserves, null clears. IDs must resolve in the catalog; failed resolution
  commits nothing. These edits follow the existing revision strategy.
- `GET /intent/{date}` returns the latest effective snapshot, or null if there
  is none. `?at=RFC3339` selects intent effective at that instant, with timezone
  normalization. `GET /intent/{date}/history` supports replay/resynchronization.
- Earlier snapshots embed names and ownership and remain immutable. Notes,
  feedback and tracker annotations do not publish new intent versions.

Voluntary CLI feedback uses the outcome API directly:

```sh
deepb outcome BLOCK --date 2026-10-07 --actual-duration 0 --completed false
deepb outcome BLOCK --date 2026-10-07 --focus-rating 4
deepb outcome BLOCK --date 2026-10-07 --clear-actual-duration --clear-completed
```

Omit `--date` for today. Set/clear flags for the same field conflict. Empty
updates, future dates and cancelled blocks are rejected. Feedback does not
reschedule work or create a revision, including under `every_change`.

`context_intent.rs`, the real CLI `dated_outcome.rs` subprocess test and
`planning-context.spec.ts` exercise these workflows, including missing/cleared
feedback, catalogue conflicts, immutable renames and unrelated metadata.
