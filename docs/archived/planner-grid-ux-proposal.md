# Archived planner grid UX proposal

This historical design proposal is superseded by [the current planner behavior reference](../features/planner-grid-ux.md). It records the earlier direction and unshipped ideas, not the current product contract.

# Planner Grid UX and Calendar Direction

## Why this document exists

DeepBlock already has the core **revision-over-mutation** model, but it does **not** yet have a strong, explicit product specification for the new planner calendar UX.

The current gap is not the existence of revisions. The gap is that the planner must feel:

- like a modern, dense, day-planning calendar
- familiar to users coming from Google Calendar or similar tools
- non-destructive and mindful, so replanning produces insight instead of stress

This document defines the required planner UX, the revision flow we want, and the recommended frontend calendar direction.

## Existing documentation review

| Source                                                           | What it covers today                                                                              | Gap                                                                   |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `README.md`                                                      | High-level product description and desktop capabilities                                           | No planner UX contract                                                |
| `docs/configuration.md`                                          | Planner display and block defaults (`start_hour`, `end_hour`, `rounding_interval`, `time_format`) | No explanation of how the planner should behave for revisions/history |
| `docs/features/automatic-revisions.md`                           | Why revisions matter, revision strategies, compare/review philosophy                              | Strong on revision philosophy, weak on actual calendar UX             |
| `apps/desktop/ui/src/pages/PlannerPage.tsx`                      | Current planner page wiring                                                                       | Implementation detail, not product guidance                           |
| `apps/desktop/ui/src/components/planner/PlannerCalendarView.tsx` | Schedule-X planner grid, inline editor, and history rail                                          | Still implementation detail rather than product guidance              |
| `apps/desktop/ui/e2e/*.spec.ts`                                  | Planner add/edit/revise/drag flows, including shared calendar/list drafts                         | Verifies behavior, but does not define the desired planner experience |

## Current product truth we must preserve

The planner must continue to respect these DeepBlock invariants:

1. **The day is immutable once saved.** Replanning appends a new revision instead of overwriting the previous one.
2. **The original intent matters.** We should be able to see what we meant to do before reality changed.
3. **Replanning should feel seamless, not punitive.** The UI should help users adapt quickly and mindfully.
4. **Review matters after action.** Planner UX must support later comparison, accountability, and reflection.

This is aligned with DeepBlock's philosophy of being:

- destruction-free
- resilient to distraction and dukkha
- supportive of flow
- supportive of later intent/reality accountability

## Recommended frontend calendar direction

**Recommendation: move the planner calendar to Schedule-X and keep the entire planner stack fully open source.**

The new planner should use:

- `@schedule-x/calendar`
- `@schedule-x/react`
- `@schedule-x/drag-and-drop`
- `@schedule-x/resize`
- `@schedule-x/current-time`

Supporting interaction libraries (all open source):

- `@dnd-kit/core` for backlog/sidebar drag sources — never for the day grid itself
- `@radix-ui/react-context-menu` for block-level actions
- `canvas-confetti` for completion feedback
- `@tanstack/react-virtual` for long lists (backlog, review history, ActivityWatch tables)
- `@tiptap/react` (starter-kit) for rich-text day notes; markdown stays the storage format

### Why Schedule-X is the best fit

Schedule-X is the strongest open-source match for the planner we want because it gives us:

- a modern React adapter
- a cleaner, more modern visual baseline than the current `react-big-calendar` experience
- custom event rendering
- click-based scheduling in the day grid
- open-source drag-and-drop and resize packages
- strong theming and component override points

The key architectural choice is:

> DeepBlock owns the **revision-column layout**, and each revision column renders a Schedule-X **day grid** inside it.

That means we do **not** depend on a premium or undocumented scheduler/resource surface to represent revision history. Instead, we preserve the DeepBlock UX directly:

- Revision A on the left
- Revision B next to it
- Revision C next to it
- the active, editable revision on the far right

### Library comparison

| Library                              | Strengths                                                                                                           | DeepBlock-specific problem                                                                                                                                                         | Verdict            |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| **Schedule-X**                       | Modern React adapter, strong customization story, open-source drag/drop + resize packages, modern time-grid styling | Day-grid granularity is still coarser than a true paper-planner implementation and revision columns need to be composed by DeepBlock rather than handed to us as a turnkey feature | **Target library** |
| `react-big-calendar`                 | Already integrated, MIT, workable current implementation                                                            | Theming is fragile, the UX feels older, and the current planner does not feel modern enough                                                                                        | **Replace**        |
| DayPilot Lite / other OSS schedulers | Capable in some scheduling scenarios                                                                                | Less aligned with the exact DeepBlock planner feel we want, and still not the chosen migration path                                                                                | **Not the target** |

### Decision note

DeepBlock does **not** want a premium planner dependency.

That means:

1. `react-big-calendar` is the outgoing implementation
2. Schedule-X is the incoming implementation
3. revision history stays a DeepBlock concern, not a licensed scheduler concern

## Required planner UX

### 1. Core layout

The planner is a **full-day vertical time grid**.

- time runs vertically
- the current editable revision owns the main stage and should never require horizontal scrolling to inspect
- previous revisions live in a left-side history rail when history is visible
- only the active revision is editable
- past revisions are read-only historical intent

The default mental model should be:

> "This is my paper time-block grid, but every mindful rewrite is preserved."

### 2. Familiarity for calendar users

The planner should feel immediately understandable for users who already use Google Calendar or similar products.

Required interactions:

- click or drag on empty time to create a block
- drag a block to move it
- drag block edges to resize it
- click a block to edit details
- right-click a block for a context menu with the fastest revision actions (revise, move, complete)
- fast keyboard-safe editing through a dialog or side panel
- current-time indicator
- automatic scroll to current time for today

### 3. Day boundaries and granularity

The planner must expose the user's working day clearly.

Required:

- configurable **start of day**
- configurable **finish of day**
- configurable visible hours
- display of block **start** and **finish**
- display of day start/day finish markers

Granularity requirements:

- support **5-minute** snapping
- support **10-minute**, **15-minute**, and **30-minute** snapping
- default to **15 minutes**
- allow fine-grained movement when users want tighter control

The current `rounding_interval`, `start_hour`, `end_hour`, and `time_format` configuration already moves in this direction and should remain part of the long-term model.

### Current Schedule-X implementation note

The current Schedule-X planner implementation now supports:

- drag/resize edits against a local draft instead of immediate revision creation
- click-and-drag block creation on the active day grid
- an anchored inline editor instead of a fullscreen dialog for calendar edits
- a left-side history rail, hidden initially and available through Show history, so the current plan stays centered

The visible time-grid itself is still coarser than a true 5-minute paper-style planner grid. If exact 5-minute visual subdivision remains a hard requirement, we should either:

1. contribute upstream
2. extend Schedule-X locally
3. replace the visible time axis/grid renderer while keeping the same event model

### 4. Revision history visibility

Past intent must stay visible **without forcing stress**.

Required behavior:

- show the current plan by default; reveal read-only history cards on the left through Show history
- render those history cards as compact previews of the relevant block window, not full-day editable-height grids
- highlight the active editable revision clearly
- include a toggle to **hide past intent**
- when history is hidden, keep only the active revision visible
- keep older revisions accessible without deleting or flattening them

Recommended visibility modes:

1. **All revisions** — show full intent history
2. **Initial + current** — show the original plan and the active revision only
3. **Current only** — reduce stress and keep the user focused

This is important because some users want mindful visibility of previous intent, while others need a lower-pressure working surface.

### 5. Revision creation flow

The planner should not force a revision on every calendar drag, resize, or edit. That is useful for auditability, but it is too rigid for the planner UX we actually want.

The preferred planner flow is:

1. User opens the latest saved revision for today.
2. User makes one or more drag/resize/edit changes in a **draft working state**.
3. The UI shows that the planner is dirty and a new revision is pending.
4. User clicks **Save revised plan**.
5. DeepBlock appends the next revision and keeps the previous one visible.

This batching matters because it lets the user rearrange several blocks in one mindful replanning pass instead of creating noisy micro-revisions for every tiny movement.

#### Optional fast mode

We should still support an optional mode where:

- dragging or resizing a block commits a new revision immediately

That fast mode should remain available for users who want maximum historical detail, but it should **not** be the preferred default calendar UX.

### 6. Planner state model

The planner should distinguish between:

- **saved revision history**
- **current editable draft**

The draft is not a replacement for revisions. It is a UX layer that makes revision creation humane.

Required rules:

- editing the planner never mutates an older saved revision
- committing the draft creates a new revision
- discarding the draft returns to the last saved revision
- the compare/review flow always operates on saved revisions, not transient draft state

### 7. Block information density

Each rendered block should be able to show, at minimum:

- label
- type
- status
- start
- finish
- duration

Secondary details can appear in the inline editor, side panel, or expanded state:

- next action
- focus rating
- artifact indicators
- actual duration / review metadata

The default visual treatment should privilege scan speed over decoration.

### 8. Revision-minded visual cues

The planner should make change visible without becoming visually noisy.

Desired cues:

- active revision column visually emphasized
- read-only history columns visibly calmer
- optional highlighting for added / moved / resized / cancelled blocks in the newest revision
- stable color semantics per block type
- external calendar overlay events render hatched/locked, visually distinct from DeepBlock blocks (`docs/features/calendar-ingestion.md`)
- accessible contrast in light/dark themes

The current implementation's color problems are a sign that we need a stronger design system around block rendering, not just a different CSS patch.

### 9. Planner flows we want

#### Morning planning

- user opens today
- planner shows a single editable current revision
- user lays out the day in a time-block grid
- quick edits during the initial planning burst stay frictionless
- once satisfied, the plan becomes the first clear intent for the day

#### Midday replanning

- reality changes
- user drags and resizes multiple blocks
- user commits a new revision with a short reason
- the previous intent stays visible to the left
- the new active intent becomes the working plan

#### Low-stress focus mode

- user hides past intent columns
- only the active revision remains visible
- history is preserved, but temporarily out of sight

#### End-of-day reflection

- user compares the original plan and latest revision
- user sees how intent evolved
- review and accountability remain grounded in actual saved revisions

### 10. Backlog-to-grid drag ingestion

The planner should let users schedule directly from the backlog without leaving the calendar.

Required behavior:

- render the backlog as a collapsible sidebar next to the active revision grid
- dragging a backlog item into the day grid creates a block in the active revision, going through the same draft/commit flow as other calendar edits
- the sidebar remains a normal interactive list so keyboard users are not blocked

Architecture decision:

- `@dnd-kit/core` owns the sidebar drag source and the drag overlay
- Schedule-X remains the sole owner of the day grid; drops land through its event/service API
- we do not rebuild or fork the calendar grid to support this flow

(External drag sources feeding a separate drop target are a documented [`@dnd-kit` pattern](https://dndkit.com); the grid stays Schedule-X.)

### 11. Block-level interactions and completion feedback

- right-clicking a block opens a context menu (`@radix-ui/react-context-menu`) with the fastest revision actions: revise from here, move, mark complete, open in the inline editor
- completing a block should feel like closing a loop: the completion/checkout moment includes a small celebratory confirmation (`canvas-confetti`)
- celebrations respect `prefers-reduced-motion` and can be disabled in planner settings

### 12. Rich-text notes (TipTap)

The day-notes surface (`NotesPage`) upgrades from a plain `Textarea` to a TipTap editor.

Decisions:

- `@tiptap/react` with the starter-kit (headings, lists, links) replaces the `Textarea`
- **storage stays markdown**: the on-disk note and the `SaveNoteRequest.content` string remain markdown; TipTap serializes to/from markdown on save and load
- the server contract does not change — this is a UI-layer swap only
- the existing daily template (morning intentions, key observations, end-of-day reflection) remains the default content for a new note
- block-level rich text is a non-goal for now; this section covers day notes only

Why markdown persistence matters: notes stay plain-text, diffable, and greppable on disk, and the revision/audit flows never depend on editor internals.

### 13. List virtualization scope

`@tanstack/react-virtual` is wanted for surfaces that can grow long:

- the backlog sidebar
- revision history lists (compare, review)
- ActivityWatch explorer event tables

The day grid itself is not a virtualization target: a day plan holds a small number of blocks and Schedule-X already owns that rendering.

### 14. Suggested product settings

We should support planner-facing settings for:

- default history visibility mode
- default snap interval
- visible start/end of day
- 12h vs 24h time format
- show/hide current-time indicator
- whether calendar edits auto-commit revisions or stage a draft first

### 15. Migration direction

#### Near term

- keep the current revision model
- keep the current planner list view as a fallback
- stop treating the current calendar implementation as the final UX
- design the new planner around revision columns and a draft-to-commit flow

#### Target state

- Schedule-X powers the rich planner grid
- the planner renders one Schedule-X day calendar per revision column
- the current revision is editable and centered
- prior revisions remain visible and read-only in a compact left history rail
- users can toggle history visibility
- calendar edits open an anchored inline editor
- drag/resize changes stay in draft until the user commits the replan
- saving planner edits produces a new DeepBlock revision

## Non-goals

This planner should **not**:

- overwrite existing revisions
- hide the original intent permanently
- force users into micro-revisions for every tiny movement by default
- become a generic team scheduling product instead of a personal planning-and-accountability tool

## Final product statement

DeepBlock's planner should feel like **Cal Newport's paper time-block planner translated into a modern desktop calendar**, with the added power of immutable revision history.

The key UX promise is:

> plan deliberately, replan fluidly, preserve intent, and review without self-deception.
