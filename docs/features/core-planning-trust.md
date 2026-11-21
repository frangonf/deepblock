# Core planning trust

**Status: implemented.** This records the core reliability/reflection phase and its decisions. Behavior references: [Planner UX](planner-grid-ux.md), [Automatic revisions](automatic-revisions.md), [Storage safety](../storage-and-request-safety.md), and [Configuration](../configuration.md).

## Goal and boundaries

Make planning, revision comparisons, and reflection trustworthy before adding integrations. Keep Rust/Axum, local files, the shared REST API, CLI/Tauri clients, and one React UI. Use focused helpers and regression tests rather than a scheduling or backend-lifecycle framework.

Three independent save contracts are intentional:

- **Notes:** autosave text, without plan revisions.
- **UI plans:** stage a draft and explicitly commit scheduling intent.
- **Outcomes:** explicitly annotate feedback, without rescheduling or creating a revision.

Individual CLI/API block mutations still follow configured active-head revision strategies. Unifying those contracts is a future product decision, not an implicit migration in this work.

## Work completed and decisions

### Recoverable note autosave

Replaced the manual note-save button with a 750 ms debounce and serialized submissions. Navigation/date changes flush queued text; query-cache and per-tab session-storage buffers retain it until acknowledgement. A late acknowledgement cannot clear newer edits or another date's draft. Stale in-flight reads cannot overwrite acknowledged query data. Save status and retry apply to the selected day; unload protection lives in the app shell so it survives leaving Notes.

**Tradeoff:** this is recovery, not cross-client synchronization or durable backup. Note writes remain last-writer-wins across clients. Closing a tab may discard session storage; denied storage leaves only in-memory recovery. Unacknowledged edits trigger a browser unload warning, not a guaranteed final network save.

### Shared backend discovery and ownership

CLI and desktop share DeepBlock-specific health discovery, with a one-second request deadline. Explicit endpoints take precedence. Otherwise a held storage lock requires a healthy recorded owner, including alternate ports; an unavailable/incompatible owner blocks automatic replacement. For unowned storage, discovery probes configured/default endpoints before desktop embedding on an available port from 5605–5609.

Embedded readiness requires health plus matching current-process ownership and endpoint; exhausted ports fail rather than selecting an occupied one. Cleanup removes only this process's runtime records, never `server.lock`. Local CLI commands bypass HTTP discovery. `deepb stop` uses matching PID/runtime records under a held storage lock and requests shutdown without waiting for acknowledgement.

**Tradeoff:** older backends lacking `service: "deepblock"` must restart after upgrade. Startup fails closed instead of silently replacing an unavailable writer. The health marker identifies the service; it is not authentication or a new multi-user security boundary.

### Consistent, atomic scheduling

Preview and server use start time then Unicode code-point label order; identical ties keep input order. Ripple remains the existing scheduling policy. Cancelled blocks neither displace live blocks nor consume ripple time. Canonical starts and durations are validated; a cascade ending at exactly midnight is allowed, while overflow rejects the entire gesture/batch without changing the retained draft. Compound moves stage atomically and rejected editors remain open with an explanation.

**Tradeoff:** this does not add overlap warnings, a new scheduling engine, or timezone/calendar semantics. Replacing ripple is a separate decision. Equal-start cascade regressions were fixed in both implementations rather than introducing two scheduling policies.

### Meaningful initial plan and revision reasons

A first batch fills A only when it is the sole revision, has no blocks or change log, and still has reason `Initial plan`. Otherwise the batch appends one revision. Previous snapshots and identifiers are preserved. Default comparison uses the first nonempty saved revision, falling back to the first if all are empty. Legacy empty revisions remain explicitly selectable; reads never renumber or rewrite them.

Optional reasons stay with date-scoped drafts through navigation, reload, and rebase. Blank reasons use `Replanned from <base id>`; save/discard clears the retained reason.

**Tradeoff:** no history migration and no silent change to direct CLI/API mutation policy. A single mutable head under `manual`/`never` does not magically provide an immutable initial snapshot; its change log remains available.

### Voluntary dated outcomes and honest evidence

Added `PATCH /blocks/{id}/outcome?date=YYYY-MM-DD` and shared Day review capture for optional actual minutes (0–1440), self-rated focus (1–5), and completion. Omitted fields preserve values; explicit null clears them. The form submits only changed fields, retaining failed forms and preserving unrelated concurrent feedback. Same-field concurrent edits remain last-writer-wins.

Outcomes update only active-head annotations/change log under the existing dated lock and atomic plan/history commit, even under `every_change`. Planned start, duration, type, status, and earlier revision snapshots remain unchanged. Future dates and cancelled blocks are rejected. Completion uses `metadata.outcome_completed`; without that annotation, legacy `done` status still displays as completed. Clearing an annotation restores that fallback without changing planned status. Completion alone supplies no duration/focus evidence.

Empty ActivityWatch queries and legacy zero-activity logs remain unassessed and retryable. Positive logs describe computer activity and category mix, not task duration or measured attention quality. Duration mismatch/overrun use self-reported minutes only; overrun explicitly assumes the planned start because actual start times are not collected. An explicit self-reported zero minutes is evidence, unlike missing sensor coverage.

**Tradeoff:** reflection is optional, not an enforced checkout or coaching flow. The existing ActivityWatch JSON fields/variance types remain compatible; wording explains their limited meaning. Feedback is not a measured account of every aspect of the day.

## Verification and limits

Regression coverage spans Rust API/ownership tests, real CLI subprocesses, shared UI tests, and Playwright flows. Final-review regressions also cover stale note reads after acknowledgement, omission of unchanged outcome fields, and matching embedded ownership/endpoint. See [Testing](../testing.md) for commands and coverage.

Local validation covers formatting, lint, typechecks, workspace/frontend builds, unit/integration/browser tests, helper tests, workflow audits, and version agreement. It does **not** establish native GUI interaction, packaging/install compatibility, production signing, or notarization. No release workflow was dispatched or publication performed for this phase.

## Deliberately deferred

- MCP, calendar ingestion, and full Kanban lifecycle.
- Enforced checkout/coaching, idle nudges, and background interventions.
- Rich-text notes, database migration, broad UI restructuring, and release-pipeline expansion.
- Cross-client note conflict resolution and automatic backend lifecycle reconciliation.
- Multi-day reflection until real usage demonstrates a useful workflow.

Next priorities remain validating the voluntary planning/reflection loop with real use and deliberately considering cross-client save semantics. See [Feature gaps](../project-analysis/feature-gap-analysis.md).
