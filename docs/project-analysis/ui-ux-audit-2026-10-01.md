# DeepBlock UI/UX audit — 2026-10-01

**Status: historical audit and resolution record.** The non-graphics implementation pass described below was completed. The later [Design System v1](../design-system.md) added shared visual foundations and application identity assets; the original graphics deferral is historical. Original observations and validation results are preserved for their recorded revisions. Use the [feature-gap analysis](feature-gap-analysis.md) for current gaps.

## Scope and method

I reviewed the live DeepBlock web UI in Chrome at `http://127.0.0.1:5189` using screenshots and the accessibility tree. The pass covered Planner calendar and list views, the add/edit block dialogs, Compare, Observed activity, ActivityWatch, Day review, Daily notes, Backlog, Settings, and Help. I opened dialogs and cancelled them without applying changes. I moved the selected date forward one day to inspect the read-only state and ActivityWatch context, then returned to Today. I did not save a plan or note, run an audit, change settings, or create/delete a task.

The app was showing a four-block plan, an empty backlog, and a day with no recorded review evidence. ActivityWatch contained live local activity; this document records interface behavior only and omits personal event details. The review used the current Chrome window at one viewport. I did not emulate mobile sizes, inspect the packaged Tauri shell, or perform a full screen-reader audit.

## Findings

### P1 — Planning ahead is unavailable without an explanation

**Area:** Planner, non-today dates

Selecting tomorrow shows an empty saved revision, “Saved plan · read-only,” and disabled Add block, Revise, and draft controls. The same restriction applies to every non-today date. There is no visible way to create the first plan for a future day or an explanation that planning is limited to today. This blocks the expected time-blocking flow of preparing a day in advance. If today-only editing is intentional, the product needs to make that rule explicit; otherwise, the planner needs a first-plan flow for future dates.

**Observed:** On the Planner, select Next day. The day shows zero blocks and the primary planning controls are disabled. The implementation also gates these actions on whether the selected date is today.

### P1 — ActivityWatch reports today while the selected date can be another day

**Area:** ActivityWatch explorer, date context

The navigation preserves the selected date in the ActivityWatch URL, but the page has no date control and labels its data “Active today” and “Top apps today.” After selecting tomorrow in Planner and opening ActivityWatch, the page still displayed today’s activity. This makes the selected-day context disagree with the data being shown and can lead users to interpret the wrong day’s information.

**Observed:** Planner URL was `date=2026-10-02`; ActivityWatch showed “Active today” and “Top apps today.” Returning to Planner and choosing Today restored the original date.

### P2 — Daily note guidance displays escape characters instead of line breaks

**Area:** Daily notes, empty editor

The empty editor placeholder visibly shows the template’s `\n\n` markers on one line instead of presenting the title and prompt as separate lines. That makes the example look like malformed Markdown and weakens the intended guidance.

**Observed:** Open Daily notes with an empty note. The placeholder reads as a single line containing the backslash-n markers.

### P2 — Disabled primary actions look ready to use

**Area:** Planner and Daily notes

With no unsaved changes, “Save revised plan” and “Save note” have the same filled cyan treatment as enabled primary actions, even though the accessibility tree reports them as disabled. A user can reasonably expect the prominent button to do something and may not understand why it has no effect.

**Observed:** Clean Planner and empty Daily notes states. The button fill remains visually prominent while both controls are disabled.

### P2 — Backlog capture button wraps at the current window size

**Area:** Backlog, task capture

The Add task button wraps its icon and label onto separate lines, making the control taller and visually unbalanced next to the single-line task field. It looks like a layout defect and adds uncertainty about the control’s intended shape.

**Observed:** Backlog capture row in the current Chrome window.

### P2 — Empty Backlog lanes consume a long vertical stack

**Area:** Backlog, empty state

To do, In progress, and Done render as three full-width cards stacked vertically, each repeating “No tasks here yet.” On an empty board this makes the page much longer while communicating the same state three times. The lane relationships are also harder to scan than a board layout.

**Observed:** Backlog with no tasks; all three status sections were visible as separate stacked cards.

### P2 — Review variance zeros can read as a good result when there is no evidence

**Area:** Day review, no-evidence state

The review shows zero high/medium/low variance alongside four planned blocks while also stating that zero blocks have recorded evidence. The caveat and “No recorded evidence yet” message are present, but zero variance still resembles a clean result. In this state, the metrics should communicate “not reviewed” or show evidence coverage as the primary outcome.

**Observed:** Day review for the selected day showed zero of four blocks with duration or focus evidence and all three variance counts at zero.

### P2 — Several pages repeat their title in the shell and the page body

**Area:** Compare, Observed activity, ActivityWatch, Day review

The shell header already names the current page, then the first card repeats the same title. This adds a redundant heading layer and pushes the page’s useful content lower. The duplication is visible on Compare revisions, Observed activity, ActivityWatch explorer, and Day review.

### P2 — Compare has no purpose-built state when only one revision exists

**Area:** Compare, single-revision day

Both revision selectors contain only revision A, yet the page renders a zero-change summary and three separate “No changes” sections. It never explains that there is no second revision to compare. The empty state should distinguish “nothing changed” from “there is nothing available to compare.”

**Observed:** Compare for a day with only revision A selected as both base and comparison revision.

### P2 — Help is a feature-parity and roadmap page, not user help

**Area:** Help

The page lists implementation status and unfinished areas such as desktop parity, a Rust/web rewrite, WebDriver coverage, and keyboard-navigation polish. It does not explain how to plan a day, revise a plan, record actual time, or understand review results. The “Help” destination therefore sets an expectation the page does not meet, and the internal development language is exposed to end users.

### P2 — “Mode: reflect” does not explain its effect

**Area:** Global header

The header presents “Mode: reflect” as a switchable control, but the visible label does not tell users what Reflect changes or when to use it. The accessibility help says only “Switch interaction mode,” which describes the action rather than its consequence.

### P2 — Block forms do not explain required fields or rating ranges

**Area:** Add/Edit block dialogs

Label, Start, and Duration are required, and Duration is constrained to 15–480 minutes. Focus rating accepts 1–5. The dialog presents these fields without visible required markers or range guidance, so users have to discover constraints by trial or native validation. Optional fields such as Artifact path and Next action are also not identified as optional.

**Observed:** The Add/Edit block form shows every field label in the same style. The source marks required fields and numeric bounds, but the dialog does not explain them beside the controls.

### P2 — Date and time formats vary between pages

**Area:** Shared date and activity displays

Planner navigation uses a numeric day/month/year date, Day review uses an ISO date, the planner timeline uses 24-hour time, and ActivityWatch uses 12-hour time with AM/PM. Users comparing a plan against observed activity must translate formats and may misread dates across locales.

### P3 — Settings is a long, wide form with unclear numeric units

**Area:** Settings

Most settings occupy a single full-width column, creating a long scroll on desktop. Several numeric values are bare numbers, including default duration, rounding interval, start hour, and end hour. The controls do not consistently show units or formatted time values, so users must infer what “60,” “15,” “0,” and “24” mean. The About panel also exposes implementation wording such as “Backend /api.”

### P3 — ActivityWatch is a long raw-event list with limited scanning tools

**Area:** ActivityWatch explorer

The page mixes summary cards, top-app bars, an empty browser-sites message, and a long list of recent active windows. The recent list repeats app names and window entries, but offers no visible grouping, filter, or collapse control. This makes it harder to find a useful pattern in the activity snapshot and gives the page a raw telemetry feel.

### P3 — Keyboard users must traverse the full shell before reaching page controls

**Area:** Shared navigation and accessibility

On Planner, the first Tab stops reached the brand link, then the interaction-mode control, then the Planner navigation link. The accessibility tree showed the remaining sidebar links before the page controls and no skip-to-content link. Reaching the planner controls therefore requires stepping through the complete navigation on each visit.

### P3 — Visual identity is generic and does not yet distinguish DeepBlock

**Area:** Brand and graphics

The shell uses a small generic four-square mark beside the wordmark. Across pages, the visual language relies on the same dark surfaces, thin borders, and repeated card treatment, with little distinctive illustration or brand motif. The system is consistent, but the product’s visual identity is not yet memorable or specific to DeepBlock.

## Review order

1. Resolve whether planning is meant to support future dates, then address the ActivityWatch date-context mismatch.
2. Fix the visible feedback and empty-state problems: note placeholder, disabled primary buttons, Backlog capture/layout, Review evidence metrics, and Compare’s single-revision state.
3. Replace the Help roadmap with task guidance and clarify product terms such as Reflect and Shallow.
4. Tighten cross-page date/time conventions, Settings density, ActivityWatch scanning, and keyboard access.
5. Continue into the planned graphics pass for a distinctive, coherent DeepBlock identity.

## Validation note — original audit

This is a manual interface audit, not a code or accessibility conformance test. No tests were run because the only requested change is this review document. Findings are based on the live browser state and should be confirmed against intended product behavior before implementation.

## Resolution record — first fix pass

| Finding                    | Resolution                                                                                                                                                                                           |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Planning ahead             | Enabled future-day draft editing and saving through the existing date-scoped replan API. Past plans remain read-only with guidance. Today-only Plan actions explain their scope.                     |
| ActivityWatch date context | Explicit “Today · live snapshot” heading and scope description. Plan date remains preserved in navigation.                                                                                           |
| Note placeholder           | Actual newline characters replace literal escape sequences.                                                                                                                                          |
| Disabled primaries         | Shared disabled buttons use muted raised surfaces and text.                                                                                                                                          |
| Capture button wrap        | Non-shrinking button and flexible input; submit disabled for blank/pending input.                                                                                                                    |
| Empty backlog              | One capture-oriented empty state replaces three repeated lanes. Populated lanes use a medium-breakpoint board.                                                                                       |
| No-evidence zeros          | Variance metrics say “Not assessed” when evidence is absent. Unknown coverage with no findings also avoids zero reassurance.                                                                         |
| Duplicate headings         | First cards describe their purpose: Choose revisions, Activity audit, Today/live snapshot, Evidence coverage.                                                                                        |
| Single revision comparison | Purpose-built empty state; no comparison request or redundant selectors.                                                                                                                             |
| Help content               | Task guidance, revision explanation, navigation and keyboard instructions.                                                                                                                           |
| Reflect mode               | Renamed “Intent”; explanatory accessible name, tooltip and Help section describe the shared marker and its limited effect.                                                                           |
| Form guidance              | Required fields stated, duration/rating bounds described, optional fields identified. Accessible names retained.                                                                                     |
| Date/time formats          | Review uses an unambiguous month name; date-input tooltip uses the same format. ActivityWatch honors the same 12/24-hour preference as the calendar. Native date inputs retain OS locale formatting. |
| Settings                   | Bounded width, two columns from medium breakpoint, explicit numeric units, product-oriented descriptions and version display.                                                                        |
| ActivityWatch scanning     | Recent windows collapsed by default, with an app/title filter and no-match feedback.                                                                                                                 |
| Keyboard access            | Skip-to-content link and focusable main landmark.                                                                                                                                                    |
| Visual identity            | Deferred to the separate graphics pass requested by the user.                                                                                                                                        |

### Validation for the fix pass

Ten new fast checks were written before the corresponding behavior fixes and
observed failing, then passing. The full suite passes **42 tests in 9 files**
(about **2.3 seconds**). ESLint, TypeScript project-reference checking, and the
Vite production build pass. No testing dependency or runner was added.
The component tests use React Testing Library and jsdom. The third-party calendar
renderer is mocked for draft-flow coverage; real calendar layout and drag behavior
are outside that test's claim.

Chrome inspection was attempted, but automation stopped on the tab switch.
This pass therefore has no fresh screenshot confirmation or mobile/native UI
verification. Playwright, Tauri bundles and the aggregate Rust/workspace gates
were not rerun for this UI-only follow-up, in line with the request for fast tests.
No new server change was needed for these fixes. Earlier worktree changes were retained alongside this pass.

## Full local gate follow-up — 2026-10-01

The heavy gates were subsequently run at the user's request using only repository
commands and automated tests. No manual Chrome/computer-use checks were used.

| Gate                                                       | Result                                                                                                  |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `mise run lint`                                            | Passed: Rust fmt/clippy, UI lint/types, helper lint/types, ShellCheck, actionlint and offline zizmor.   |
| `mise run test:rust`                                       | Passed: complete locked Rust workspace unit/integration/doc tests.                                      |
| `mise run test:scripts`                                    | Passed: 14 helper tests.                                                                                |
| UI `pnpm run test:unit`                                    | Passed: 42 tests in 9 files.                                                                            |
| UI `pnpm run test:web`                                     | Passed: all 12 Playwright tests in 22.3 seconds, including LAN proxy/HMR and planner interaction flows. |
| `mise run build`                                           | Passed: Rust workspace, shared Vite frontend and Tauri desktop shell.                                   |
| `mise run version:check`                                   | Passed: product manifests/locks agree at 0.2.0.                                                         |
| `mise run build:tools`                                     | Passed: release CLI/server.                                                                             |
| `mise run build:desktop:bundle`                            | Passed: macOS ARM64 app and DMG.                                                                        |
| `mise run release:collect`                                 | Passed: architecture, app signature, release asset collection and checksums.                            |
| `mise run lint:desktop` after the browser assertion update | Passed.                                                                                                 |
| `git diff --check`                                         | Passed.                                                                                                 |

The initial aggregate `mise run check` could not start Playwright services:
fixture XDG isolation caused nested mise command wrappers to reject the existing
global configuration. Process-scoped trust did not resolve the nested wrapper
issue. All constituent gates were then executed individually. The unchanged UI
test scripts ran with the repository-pinned Node 26.10.0, pnpm 12.8.1 and Rust
1.98.1 binaries placed directly on PATH, avoiding those wrappers without changing
machine configuration or product code.

The first browser run passed 11 tests and failed one stale single-revision
assertion. That test still expected zero-change comparison metrics. Its
expectation now requires the intended “Nothing to compare yet” state and no
selectors; it also verifies three “Not assessed” metrics without evidence. The
full browser suite then passed. This was the only test-code change in this gate
follow-up.

Packaging emitted a nonfatal Rust toolchain warning: `rust-objcopy` could not load
`libLLVM.dylib`, so debug-info stripping failed. Builds and collected-asset checks
still passed. Bundles use ad-hoc signing; notarization was skipped because Apple
credentials were absent. These results do not establish notarized distribution,
Debian compatibility, or the opt-in native Safari/WebDriver runtime. On this
macOS host, the default Tauri E2E command delegates to the same Playwright suite
already run, so it was not redundantly repeated.

Local outputs are under `target/release/bundle/` and `dist/release/` in this
worktree. No release was published.

## Rebase follow-up

PR #86 was rebased onto `0092b67`, preserving main's bounded native harness and
release safety changes. Local validation exposed a midnight-dependent viewport
assertion and a cached-day navigation defect: Schedule-X retained its previous
day when React Query supplied an already-cached plan without unmounting the view.

The calendar columns now remount when the selected date changes. A Playwright
regression covers past/future editability and returning to a cached day. The
viewport test scrolls its event into view before asserting a positive offset.
Help describes the two available views, and native smoke assertions use guidance
shared by the redesigned Help page and the immutable 0.2.0 source.

After these fixes, full repository lint, locked Rust workspace tests, all 53
helper tests, 42 UI unit tests, 13 Playwright tests, workspace/frontend build,
version agreement, Markdown formatting and whitespace checks passed locally.
The first cache-assisted runs emitted mbx prediction warnings; the final rerun
completed without those warnings. Native Safari/WebDriver and distribution
packaging were not rerun for this follow-up; the earlier packaging results above
remain evidence for the pre-rebase state only. No release workflow was dispatched.
