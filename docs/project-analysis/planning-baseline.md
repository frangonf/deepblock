# Planning compatibility baseline

Recorded 2026-10-08 as the pre-migration planning baseline. This is isolated
workflow and regression evidence; it does not claim sustained personal usage,
native macOS interaction, or production notarization.

## Reusable checks

| Workflow                                                                | Evidence                                                   |
| ----------------------------------------------------------------------- | ---------------------------------------------------------- |
| Multi-day feedback, reported zero, Markdown notes, history, restart     | `apps/server/tests/planning_baseline.rs`                   |
| Initial commitment, revision reasons, historical outcomes, failed notes | `apps/desktop/ui/e2e/core-trust.spec.ts`                   |
| Concurrent writes, stale drafts, failed persistence, clear versus omit  | `apps/server/tests/review_regressions.rs`                  |
| Navigation, retained drafts, rebase, undo/redo                          | Planner unit and browser suites                            |
| Unavailable tracker                                                     | ActivityWatch Rust tests and evidence-free review tests    |
| Writer ownership and crash recovery                                     | `runtime_ownership.rs`, discovery and CLI subprocess tests |

Run `mise run check`; repeat the dedicated baseline with
`mise exec -- cargo test --locked -p deepblock-server --test planning_baseline -- --nocapture`.
Measurements are diagnostic, not flaky wall-clock assertions.

## Pre-migration data inventory and preservation requirements

This inventory records the JSON storage used for the original planning baseline. The current
runtime uses canonical SQLite for structured planning data; legacy JSON is migration
input. Markdown notes and TOML settings remain files. See [Storage portability](../features/storage-portability.md)
for current export, migration, and recovery behavior.

- Daily JSON: dates, revisions, IDs, timestamps, change logs, annotations,
  generic metadata, artifact references, and embedded `_history`.
- Legacy separate `history-YYYY-MM-DD.json`: read when embedded history is absent.
- Backlog JSON and durable `state.json`: labels, identities, workflow state and mode.
- Managed Markdown notes and TOML settings: remain files; preserve text and settings.
- External artifact paths: references only; do not imply their contents are backed up.
- Lock/PID/endpoint files: operational ownership, excluded from portable restoration.
- Per-tab drafts: recovery buffers, not durable user-data backup.

## Measured pre-migration storage baseline

Linux x86_64, AMD Ryzen 5 3600 virtualized host, Rust 1.98.1; 100 saves of an
empty daily plan and a 2.1 kB note to isolated temporary roots. Microseconds:

| Resource                   | p50 | p95 |
| -------------------------- | --: | --: |
| Plan plus retained history | 137 | 182 |
| Markdown note              |  38 |  49 |

These measure the synchronous storage operation, not end-to-end network or GUI
latency. [Post-SQLite storage and optional-worker load results](../features/advanced-module-contracts.md#measured-budgets-and-evidence)
are recorded separately. Hardware/workload changes require a fresh baseline.

## Distribution evidence

In the private development repository, the 2026-10-08 checks passed Rust
lint/tests, shared UI checks, and workflow lint. The private v0.2.0 prerelease
passed macOS ARM64 and Debian builds, Debian 12/13 installation, and asset
verification. The macOS packages were signed ad hoc. Those runs document the
pre-migration baseline, not the current public snapshot.

## Remaining validation

Record actual personal-use friction and native platform results separately.
These are ongoing validation activities for completed planning functionality.
Synthetic workflows alone do not establish native behavior or sustained usability.
