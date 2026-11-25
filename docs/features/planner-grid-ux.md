# Planner grid UX

The browser and Tauri desktop share the same React/Schedule-X planner. This document describes the shipped workspace and save behavior. The [earlier design proposal](../archived/planner-grid-ux-proposal.md) is retained as historical context; ideas in that proposal are not a list of supported features.

## Planner workspace and saving

Calendar and list views edit the same per-day draft. Adding, editing, deleting,
reordering, dragging, and resizing blocks never save the plan implicitly.
**Apply to draft** closes the block editor; **Save revised plan** commits the
first plan into an untouched bootstrap A, then appends one revision per later
save. An optional reason stays with the retained, date-scoped draft.
**Undo edit** reverses the last draft action, including all blocks displaced by
one move or resize. **Discard changes** restores the saved plan. Existing history
is not renumbered. Compare defaults to the first nonempty revision while leaving
empty bootstrap revisions explicitly selectable.
Switching views, dates, or routes preserves each draft in per-tab session storage.
A conflicting saved plan requires explicitly applying retained edits to the latest
plan, or discarding them. Editing freezes while a save is in flight. Completion
clears only the submitted day's draft, even if browser history switches to another
day before the save finishes.

The compact header keeps date navigation and Add block visible. The active grid
scrolls within the workspace and opens around the current time for today. Secondary
revision, undo/redo, and activity refresh actions live under Plan actions.
The calendar keeps the visible time when saving, zooming, or returning to a day
within the Planner. The draft status and Save action stay in reach while editing.
The zoom buttons change the calendar scale for the current Planner session.
**Show history** sits beside the Calendar and List tabs and stays open when
switching views. Calendar shows read-only revisions from oldest to newest,
with the current plan on the right. The view opens on the current plan, and
you can scroll left to see earlier revisions. The columns share the same hours,
vertical scroll, and zoom. With the revision area focused, Escape closes
history and returns focus to the toggle.
If the day has no earlier saved revisions, the planner says so. Artifact links
remain saved-block metadata: save or discard draft changes before managing them.
Today and future days support draft editing and saving. Past days remain read-only.

The grid follows loaded or changed display hours, pixel scale, snapping interval,
and 12/24-hour format. Structural changes recreate the calendar runtime and close
its inline editor without discarding staged blocks. Block creation also works on
plain HTTP LAN origins, using cryptographic random identifiers when the browser's
secure-context-only UUID API is unavailable.

Dragging or resizing a block previews where it and affected blocks will land.
Scrolling during a drag keeps the selection aligned with the time under the
pointer. On touch screens, swipe the empty grid to scroll or hold briefly before
dragging out a new block. Existing blocks can be moved by dragging them and
resized using their lower edge. Releasing a move or resize stages the change
without opening the editor. A newly selected interval becomes a draft block
when the editor is applied. Moves and resizes ripple overlapping live blocks.
Preview and server both order
equal starts by label (Unicode code-point order); identical labels keep their
input order. Cancelled blocks neither consume ripple time nor displace other
blocks. Invalid times and cascades extending past 24:00 are rejected without
changing the retained draft. A block may end exactly at midnight.

The inline editor renders through a portal outside calendar panels. It receives
keyboard focus, grows to 42rem when space permits, and uses the available width
with a 16px viewport margin on narrower windows. Scheduling fields appear first,
and **Block details** expands the remaining fields. Field pairs follow the actual
form width rather than a window breakpoint; controls shrink and action buttons
wrap without horizontal scrolling. Placement uses the rendered editor dimensions,
and vertical scrolling is retained only when needed to fit the viewport. The
editor repositions on viewport resize. Invalid edits remain open with their field
values and a message. Escape closes the editor and a click outside dismisses a
clean editor.
Tauri windows can shrink to 480 × 480 logical pixels and use the shared compact
navigation and horizontally scrollable revision columns.

Theme values live in `apps/desktop/ui/src/themes.css`; foundations and component
rules live in `apps/desktop/ui/src/index.css`. The shared
[Design System v1](../design-system.md#react-theme-implementation) starts with
rust/dark and separates paired action fills/text from keyboard focus and status
roles. Core controls and calendar library colours consume these roles. Calendar
blocks use a type-coloured edge alongside explicit type/status labels; changed
blocks add a dashed warning edge and an accessible unsaved label. Revision save
errors remain visible beside the save controls, retaining the draft and reason
for retry. The version is available in Settings.

## Workspace consistency

The planner, Compare, Review, Observed activity, and Notes share URL-backed day
navigation (`?date=YYYY-MM-DD`). Sidebar navigation keeps that day, and malformed
or impossible URL dates fall back to today. Today and future days support draft editing and revision saves. Historical plans stay read-only;
activity audits remain available for today only. Comparisons load the selected
day rather than silently comparing today's revisions.

Calendar blocks adapt their content to their actual rendered height: small blocks
show a label and compact time, medium blocks add the time range, and larger blocks
add type, status, and next action. Full details remain available in the accessible
label and editor. Tab to an editable block and press Enter or Space to edit;
Escape closes the editor and restores focus. Whole-hour time labels take priority
over half hours; quarter-hour labels are hidden without changing grid snapping.
Outside text fields and dialogs, use **C** to add a block, **T** for today, and
**J** or **K** to move to the next or previous day. Use **Ctrl/Cmd+S** to commit
the draft or **Ctrl/Cmd+Z** to undo its last edit.
The day summary reflects the current draft, excludes cancelled blocks from planned
and focus time, and counts completed blocks separately.

Draft status counts affected blocks rather than individual editing gestures.
Returning every block to its saved value, or cancelling a newly created block,
clears the unsaved state without creating an unnecessary revision.

## Capture and completion loop

Open **Schedule today** on a non-completed backlog item to open a prefilled
planner block dialog. Applying it stages the block in the selected plan draft;
no plan revision is written until the user selects **Save revised plan**. The
planner list can mark an active block done or reopen it with one action; both
changes use the same explicit draft and revision save flow. A done status by
itself does not count as observed duration or focus evidence in Day review.

Day review also offers **Record outcome** for today and historical days: optional
actual minutes (0–1440), self-rated focus (1–5), and completion. This is an explicit
feedback save, not a schedule revision. It annotates the active head without
changing start, duration, type, planned status, or earlier revision snapshots.
Unchanged form fields are omitted so unrelated concurrent feedback survives;
clearing a populated field removes its recorded value. Completion is stored
separately from planned status in `metadata.outcome_completed`; it does not supply
duration/focus coverage. When no explicit completion annotation exists, legacy
`done` status still displays as completed; clearing the annotation restores that
fallback without changing planned status.
Future dates and cancelled blocks cannot receive outcomes.

Notes autosave after a short pause (750 ms) and flush queued edits when changing
dates or leaving the editor. **Saving**, **Saved**, and **Save failed** describe
the selected day; failed text stays recoverable with **Retry save**. The per-tab
recovery buffer survives route changes and reloads until the submitted text is
acknowledged. A late acknowledgement cannot discard newer edits, and older
in-flight reads cannot replace acknowledged text in the query cache. Notes do not
create plan revisions. Closing the tab may discard recovery storage; browsers
warn while unacknowledged note text remains, including outside the Notes page.

The rationale, implementation summary, compatibility choices, and deferred work
are recorded in [Core planning trust](core-planning-trust.md).

## Audit follow-up (October 2026)

Future days use the same explicit draft-save flow as today. Saved-history undo,
redo, standalone revision creation, and activity audits still target today;
the Plan actions menu explains this scope when viewing another date.
ActivityWatch always shows a live snapshot for today, explicitly independent
of the selected plan date. Sidebar navigation preserves the plan date through
that page. Activity timestamps follow the configured 12/24-hour preference;
textual dates use an unambiguous month name, while native date inputs retain
platform formatting.

Review displays “Not assessed” instead of variance zeros when there is no
recorded evidence. Compare explains why a day with fewer than two revisions
cannot be compared. The empty backlog uses one capture prompt; populated lanes
use three columns from the medium breakpoint. Help describes the actual task
flows and the shared focus/reflect intent marker, which has no automatic editing
or notification effect. A skip link focuses the main content for keyboard users.

Fast coverage lives in `src/pages/audit-regressions.test.tsx` and
`src/lib/display-date.test.ts`. These run under the existing Vitest/jsdom setup;
the planner regression mocks only the third-party calendar renderer, while
exercising the real draft, dialog, and save flow. This is component coverage,
not proof of calendar drag behavior or native desktop rendering.
