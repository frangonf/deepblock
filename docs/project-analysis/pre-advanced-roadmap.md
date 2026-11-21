# Completed planning foundations

**Status: completed and merged.** The planning, context, storage, review, and
module-boundary work described here is part of the current Rust/Tauri source.
This document summarizes delivered work. Future recording, automatic assessment,
and workspace assistance are described in the [advanced vision](advanced-deepblock-vision.md).

## Completed work

| Area                             | Delivered behavior                                                                                                                                                | Details and evidence                                                                                 |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Planning reliability             | Revision-preserving scheduling, draft recovery, retained history, restart and failure fixtures                                                                    | [Core planning trust](../features/core-planning-trust.md), [planning baseline](planning-baseline.md) |
| Context and intent contracts     | Stable project/goal identities, versioned intent snapshots, date/reference rules, and explicit UI/CLI/API operation semantics                                     | [Planning/context contracts](../features/planning-context-contracts.md)                              |
| Storage architecture             | Canonical SQLite for structured planning with one writer, versioned migrations, Markdown notes, TOML settings, and separate ownership for future evidence storage | [SQLite design](../features/sqlite-storage-design.md)                                                |
| Migration and portability        | Validated legacy JSON migration, retained originals, portable export/import, backup/restore, and transaction/recovery fixtures                                    | [Storage portability](../features/storage-portability.md)                                            |
| Explicit intentions and feedback | Optional manual project/goal associations, immutable intent history, and dated CLI outcomes independent of schedule changes                                       | [Explicit intentions](../features/explicit-intentions.md)                                            |
| Multi-day review                 | Range summaries using one final plan per day, voluntary reported outcomes, and explicit missing-feedback coverage                                                 | [Multi-day review](../features/multi-day-review.md)                                                  |
| Optional module boundaries       | Versioned processing contracts, capability discovery, bounded mock-worker supervision, transmission policy, and failure/load fixtures                             | [Module boundaries](../features/advanced-module-contracts.md)                                        |
| Data management UI               | ZIP bundles, previewed live replacement, durable recovery, generation-aware clients/drafts, context editing, and read-only intent history                         | [Data management UI](../features/data-management-ui.md)                                              |

The [mindful self-direction principles](mindful-self-direction.md) guide the daily
experience: deliberate planning, ordinary revision, connected notes/backlog,
voluntary reflection, and neutral open/offline time. Technical tests establish
specific behavior; they do not establish sustained behavioral benefit.

## Preserved design decisions

- Planning owns its SQLite writer and transaction boundaries. Future recording
  and evidence storage use independent writers and retention policies.
- Migration preserves existing revisions, IDs, metadata, outcomes, and retained
  history. Legacy JSON becomes interchange/migration input, while notes remain
  Markdown and settings remain TOML.
- UI draft commits and individual CLI/API edits retain their documented save
  strategies. Intent snapshots preserve the effective commitment even when an
  active revision is mutable. Outcomes and notes do not redefine scheduling intent.
- Portable bundles contain managed data; external artifacts remain references.
  Runtime ownership files and unsaved session drafts have separate recovery rules.
- Optional workers have no planning writer or desktop executor. Planning remains
  usable when those workers are disabled, unavailable, or failing.

## Recorded verification

The linked feature documents identify automated workflow, compatibility,
portability, and fault fixtures. Historical stack validation on 2026-10-08 recorded
Rust/UI/script lint, workflow audits, 137 Rust/Tauri tests, 73 UI unit tests,
58 Node helper tests, 30 browser flows, and Rust/Tauri plus web builds on Linux
x86_64. These counts describe that tested source, rather than the current suite.

[Post-SQLite storage and mock-load measurements](../features/advanced-module-contracts.md#measured-budgets-and-evidence)
record save latency and endpoint responsiveness on the baseline host. The
[planning baseline](planning-baseline.md#distribution-evidence) separates historical
CI and v0.2.0 distribution results from newer source changes. Browser and synthetic
checks do not establish native GUI, installer, signing, or sustained-use results.

## Ongoing validation

These checks extend confidence in completed functionality; they do not reopen the
completed work above:

- Use planning, revisions, notes, context, dated feedback, and multi-day review
  over ordinary days, including without tracking. Record friction, useful review
  observations, and planning effort against the roughly five-minute usability target.
- Repeat current-source installation/upgrade, native file-dialog, export/import,
  backup/restore, and recovery checks on supported platforms using disposable data.
  Extend disk-failure and interruption scenarios as needed for storage changes.
- When adding native collectors or model/helper adapters, measure CPU/GPU/memory
  costs and GUI/save responsiveness, and validate signing, permissions, lifecycle,
  cancellation, and hard resource limits before enabling those capabilities.

Record the tested revision, platform/hardware, workload, results, and limits.
Use [Testing](../testing.md), [Desktop distribution](../desktop-distribution.md),
and [Releases](../releases.md) for the supported verification workflows.

## Future advanced work

Build on the completed foundations in this order: independent native recording,
automatic application/remote project context, calibrated intent assessment, then
reversible workspace assistance. Each new capability needs its own technical and
ordinary-use evidence before production use. Research prototypes can proceed
independently. A dedicated current/next-block view, full Kanban, calendar ingestion,
broad MCP integration, and mobile support remain separate product decisions.

See [Advanced implementation phases](advanced-deepblock-vision.md#implementation-phases-and-acceptance-criteria)
and [Feature gaps](feature-gap-analysis.md) for the future work.
