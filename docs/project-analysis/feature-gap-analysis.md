# Feature gap analysis

**Assessment date: 2026-10-08; implementation status reconciled 2026-10-17.** This describes the remaining gaps in the current Rust/Tauri runtime and relates them to the agreed preparation phase before advanced assessment and assistance:

- `apps/server` — Axum server
- `apps/cli` — Rust CLI
- `apps/desktop` — Tauri shell with React desktop UI

DeepBlock implements the planning and reflection foundation, including canonical SQLite,
manual projects/goals, intent history, portable recovery, multi-day review, and
optional-module contracts. See [Completed planning foundations](pre-advanced-roadmap.md#completed-work)
for delivered work and linked evidence. This assessment separates future product
capabilities from ongoing validation of existing functionality.

## Product direction refinement

**Product refinement: 2026-10-09.**

The [mindful self-direction principles](mindful-self-direction.md) define the purpose of this work: a notebook-like planning and reflection experience that supports the user's judgment. Ordinary planning should stay brief, revisions deliberate, and notes and possible work connected. Open time, offline life, and missing feedback remain neutral. Evidence and assistance are optional support rather than a productivity grade or required enforcement system.

## Current strengths

The current source implements the core planning loop. These capabilities extend beyond the v0.2.0 release; platform and release evidence remains scoped below:

- revision-based day plans, retained historical snapshots, and conflict-aware calendar/list drafts
- future-day planning, with historical scheduling kept read-only
- block move and reposition flows
- meaningful first-plan comparisons, backlog, autosaved recoverable notes, and mode switching
- optional dated outcome capture and revision reasons without enforced checkout
- atomic plan/undo/redo persistence with single-writer ownership
- first-class Review page backed by the same variance API as the CLI
- ActivityWatch audit as an optional local data source
- CLI coverage for the main server workflows
- packaged macOS desktop distribution with the Rust server and CLI
- implemented shared design foundations, application identity assets, and responsive planner editing

The original [October UI audit](ui-ux-audit-2026-10-01.md) preserves findings that were subsequently resolved. Future-day planning, no-evidence states, Help guidance, and most interface issues from that audit should not re-enter the backlog as absent features. Its deferred graphics note is historical: [Design System v1](../design-system.md) now records implemented foundations and identity assets. Target interactions shown only in its standalone prototype still need separate implementation decisions.

## Current gaps in perspective

| Area                                 | Current state and remaining gap                                                                                                                                  | Recommended timing                                                  | Relationship to advanced work                                                          |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Everyday planning and review         | Reliability and recovery contracts are implemented; brief planning, low-burden revision and sustained voluntary review usefulness still need real-use validation | First, through ordinary use and targeted fixes                      | Establishes whether the intention/reflection loop is worth extending                   |
| Cross-client intention and feedback  | Explicit UI drafts and configured CLI/API edits remain; dated CLI outcomes and immutable intent APIs are now implemented                                         | Implemented; extend through demonstrated cross-client needs         | Prevents later sensors and agents from conflating intention changes with outcomes      |
| Structured storage                   | Canonical SQLite, validated legacy import and portable export/backup/restore are implemented; native upgrade evidence remains scoped                             | Implemented; repeat native upgrade checks for supported releases    | Establishes transactional structured storage with isolated future evidence ownership   |
| Reflection over time                 | Daily and multi-day review exist; range summaries declare final-plan baselines and feedback coverage                                                             | Implemented; evaluate usefulness through ordinary use               | Delivers useful feedback without sensors and establishes honest summary semantics      |
| Project and goal identity            | Optional project/goal identities and manual draft associations are implemented; automatic project discovery remains future work                                  | Manual associations implemented; automatic discovery is future work | Gives project adapters and classifiers an explicit target vocabulary                   |
| Execution presentation               | Shared Focus/Reflect intent is a marker; the design reference illustrates a focused current/next-block view beyond the shipped routes                            | Optional small feature if real use supports it                      | Helps users follow intentions without making an attention-measurement claim            |
| Distribution and recovery confidence | v0.2.0 passed Debian/release checks; notarization and current-source native upgrades remain scoped. Durable portability now complements session recovery         | Ongoing platform, release, and recovery verification                | Native recording later adds helper signing, permissions, startup, and storage concerns |
| Independent recording                | ActivityWatch is optional on-demand enrichment; there is no first-party production event source                                                                  | Next advanced capability; research and prototypes can proceed       | Creates the authoritative observation boundary                                         |
| Semantic assessment and control      | No calibrated project/goal assessment or workspace controller exists                                                                                             | After recording, context, and intent contracts                      | Depends on evidence quality, freshness, user policy, and reversible actions            |

The current audit labels its metric category match and explains its limits, but colored percentage badges and fixed variance severities still need an experience review. Favor understandable observations over a perceived performance grade. The recorder's future open-time timeline must describe context neutrally when no intention applies; current audits cover planned windows.

The different save contracts are deliberate compatibility choices. Complete unification of every CLI/API/UI mutation is outside preparation scope. Trustworthy assessment needs a clear definition of committed intent and a timestamped snapshot/version contract that works even when the active head is mutable.

## Completed foundation

[Completed planning foundations](pre-advanced-roadmap.md#completed-work) summarizes
the delivered planning, context, SQLite, portability, feedback, review, optional-module,
and data-management work. Feature documents hold the current contracts and fixtures.
Ongoing ordinary-use and platform checks are summarized in
[Ongoing validation](pre-advanced-roadmap.md#ongoing-validation).

An optional current/next-block view can reduce navigation cost without measuring engagement. The current intent marker does not change editing or reminders, and the shipped routes have no dedicated focus page. See [Shared UI behavior](../shared-ui-runtime.md), [Application routes](../../apps/desktop/ui/src/App.tsx), and [Design direction](../design-system.md). This optional view is a separate product decision.

Distribution evidence remains scoped to the audience/platform actually supported. Preserve isolated local replay with retained artifacts before another release candidate run. Session draft recovery and bounded undo do not replace durable backup/restore; native helper signing and permissions add further advanced work. See [Releases](../releases.md), [Desktop distribution](../desktop-distribution.md), [Linux development](../linux-development.md), and [Storage safety](../storage-and-request-safety.md).

## Sequencing and dependencies

The foundation is complete. Future production capabilities build on its existing
intent, storage, and module contracts. Native capture and processing adapters need
source identities, separate evidence ownership, permission controls, lifecycle,
bounded resource use, and responsiveness checks on representative hardware.

Observation-envelope research, macOS 27 capability investigation, and disposable
native/helper prototypes can proceed. Local and external processors must preserve
user transmission policy; model availability or a network request cannot become a
planning dependency.

| Advanced capability   | Required foundation                                                                                                             | Work that can remain independent                                        |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Independent recording | Existing module contracts plus source identities, timing, health/freshness, separate evidence ownership, and native permissions | Optional focus view, full save-strategy convergence, and mobile support |
| Project context       | Reliable recording, session relationships, and explicit project identities/mappings                                             | Full Kanban lifecycle and calendar feeds                                |
| Intent assessment     | Context evidence, effective intent snapshots, corrections, and calibrated evaluation                                            | Voice commands and automated workspace changes                          |
| Workspace assistance  | Fresh assessment, explicit assistance policy, scoped actions, and reversal                                                      | Universal application coverage and cross-device monitoring              |

The next advanced production investment is independent recording. Validate each new
capability against its technical requirements and the
[experience criteria](mindful-self-direction.md#acceptance-through-real-use).
Later improvements remain driven by demonstrated value and reporting/interaction burden.

## Intentionally deferred areas

These areas remain deferred, with prerequisites recorded in the advanced vision:

1. **Real-time classification and interventions** require an independent event source and validated assessment/action contracts.
2. **ActivityWatch lifecycle expansion or a hard dependency** conflicts with the self-sufficient-core direction; preserve optional interoperability.
3. **Full Kanban displacement/lifecycle automation, calendar ingestion, and broad MCP integration** need a concrete workflow before implementation. Their existing proposal documents are not mandatory prerequisites. The Kanban proposal now separates explicit completion from optional activity evidence. Its full lifecycle, source references, and draft interactions still require implementation and validation against the current contracts.
4. **Mandatory checkout, AI coaching, rich-text notes, and generalized synchronization** add product scope without establishing the initial observation boundary.
5. **Safari/WebDriver-native desktop E2E on macOS** remains opt-in. Add focused native validation where the recorder/helper needs it, while preserving stable default Playwright coverage.
6. **Voice/research agents, phone monitoring, broad process tracing, and continuous media archives** remain later extensions of the independent contracts.

## Ongoing validation

Use the [validation summary](pre-advanced-roadmap.md#ongoing-validation) for ordinary-use,
native-platform, recovery-fault, and future adapter checks. Keep results scoped to
the tested revision and workload; these checks extend completed functionality.

## Non goals

- Recreating the removed Python clients
- Reintroducing a standalone TUI
- Rewriting the shared UI or coupling planning storage/transactions to observation processing
- Coupling future evidence storage to the canonical planning database or bypassing migration and recovery validation for later schema changes
- Closing every conventional feature gap before recorder research, or enabling a prototype in production without capability-specific validation
- Automating workspace control before evidence and policy contracts exist
