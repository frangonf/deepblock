# DeepBlock Design System v1

Status: approved design direction, 4 October 2026. Starting theme: rust accent and dark mode.

This document defines Design System v1 for the shared DeepBlock UI. The React application implements its semantic theme foundations, shared controls, editorial shell, planner draft indicators, responsive history, and muted scrollbars. The interaction contracts below also include target behavior; the standalone reference does not establish feature availability. The [interactive reference](design/reference/design-system-v1.html) is a standalone, in-memory prototype; its sample saves are not backend persistence. Open the HTML file in a browser to explore the planner, focus view, component specimens, and theme previews. It requests Inter from Google Fonts and falls back to Arial when unavailable.

## Implementation status

| Surface                                                                            | Current status                                                                                                                                                                       |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Semantic themes, shared controls, editorial shell and identity assets              | Implemented in the shared React UI and desktop assets; see [React theme implementation](#react-theme-implementation) and [Application identity assets](#application-identity-assets) |
| Planner calendar/list, draft indicators, responsive history and editors            | Implemented; runtime behavior follows [Planner grid UX](features/planner-grid-ux.md)                                                                                                 |
| Dedicated current/next-block focus view, focus timer and extra prototype shortcuts | Proposed interactions in the standalone reference; separate implementation and validation are required                                                                               |
| Ordinary-use burden, neutral evidence presentation and optional assistance         | Product acceptance criteria; implementation and technical checks alone do not establish these outcomes                                                                               |

## Design direction

Use a calm editorial foundation: graphite surfaces, restrained rust accents, Georgia headings, Inter interface text, generous spacing, and a calendar that carries the main work. Pair that foundation with readable controls, explicit revision states, editing interactions, recovery from failed saves, responsive history access, and a muted schedule scrollbar.

The planner, daily notes, and day review form the implemented daily experience. The proposed focus view concentrates on the current block and the next block; it remains a prototype interaction with no dedicated production route. The planner provides the full day's context. History supports the work without dominating it.

This specification is authoritative for the target visual system; the interactive reference illustrates it. Existing feature, storage, security, and runtime documentation still defines application behavior until explicitly revised.

## Product experience principles

Apply the [mindful self-direction principles](project-analysis/mindful-self-direction.md) to future interaction and presentation decisions. The schedule and Markdown notes form the notebook foundation. Keep the day's chosen work readable, ordinary revision brief, and optional history, task detail, and evidence available without dominating the main surface. Goals and classifications remain optional context.

Present open time and missing evidence neutrally. Feedback should describe observations, uncertainty, and available choices. Review the current colored category-match badges and variance severities against this direction; percentages must not imply a grade for a person's attention or life. App engagement, streaks, or completed forms are insufficient acceptance criteria. Ordinary use must establish low interaction burden and useful reflection alongside accessibility and reliability checks. These are target criteria, not a claim that every existing surface already satisfies them.

## Identity and voice

The mark consists of a vertical spine and three stacked blocks; the middle block extends farther outward. Preserve its proportions and single-colour silhouette.

Reference SVG geometry:

```svg
<svg viewBox="0 0 32 36" fill="none" aria-hidden="true">
  <path d="M3 3h8v30H3zM15 3h10v8H15zM15 14h14v8H15zM15 25h10v8H15z"
        fill="currentColor" />
</svg>
```

Use a 24–32px mark in navigation and a 48px mark in identity specimens. The wordmark uses Inter 600 at 18px. Reserve clear space of at least half the mark's width. Hide decorative marks from assistive technology when adjacent text supplies the name.

Use plain labels and quiet encouragement. Explain the state and the next action: “Unsaved revision”, “Your draft is intact”, “Retry save”. Avoid unexplained symbols and decorative metadata.

### Application identity assets

The approved Editorial spine mark is applied to the shared app header, browser favicon, desktop application icons, and macOS tray. The CLI retains plain `deepb` text.

- Master silhouette: [mark.svg](../apps/desktop/ui/public/brand/mark.svg). The application navigation uses it as a mask coloured by `--db-brand`, which defaults to the current accent. A theme can override the brand role independently. Native app icons retain the approved rust/graphite artwork.
- Desktop source: [app-icon.svg](../apps/desktop/brand/app-icon.svg), rust on a graphite tile.
- Tray source: [tray.svg](../apps/desktop/brand/tray.svg), a transparent monochrome mark used as a macOS template image.
- Browser asset: [favicon.svg](../apps/desktop/ui/public/favicon.svg), rust on graphite.
- Desktop exports live in `apps/desktop/src-tauri/icons/`; the Tauri bundle configuration explicitly selects PNG, ICNS, and ICO assets.

Generate exports with the repository's installed Tauri CLI from the repository root:

```sh
apps/desktop/ui/node_modules/.bin/tauri icon apps/desktop/brand/app-icon.svg --output /tmp/deepblock-brand-icons
apps/desktop/ui/node_modules/.bin/tauri icon apps/desktop/brand/tray.svg --output /tmp/deepblock-tray-icons --png 32
```

Copy the desktop PNG, ICNS, and ICO exports to the configured icon directory and the 32px tray export to `icons/tray.png`. Mobile and Windows Store exports are not required by the currently supported desktop distribution. When changing the silhouette, update all three SVG sources and the favicon together. Changing a UI theme does not regenerate installed desktop icons.

## Theme architecture

Components consume semantic tokens. Themes supply values for those roles. A new accent must not implicitly recolour errors, unsaved revisions, success, or keyboard focus.

Rust/dark is the initial product theme. Cobalt, sage, and light mode in the prototype demonstrate the architecture; they are reference previews, not additional launch requirements. Theme configuration must supply all roles and validate every interaction state.

The names below are the prototype's reference vocabulary. Production aliases may follow repository conventions, provided their roles remain explicit.

### Rust/dark colour tokens

| Role                    | Token               | Value     |
| ----------------------- | ------------------- | --------- |
| Canvas                  | `--bg`              | `#141414` |
| Surface                 | `--surface`         | `#1c1c1c` |
| Secondary hover surface | `--hover`           | `#282725` |
| Primary text            | `--text`            | `#eeeae5` |
| Secondary text          | `--muted`           | `#b6b0a9` |
| Decorative divider      | `--line`            | `#3b3834` |
| Primary action          | `--accent`          | `#c99075` |
| Primary action hover    | `--action-hover`    | `#d8a18a` |
| Primary action pressed  | `--action-active`   | `#bb8167` |
| Text on primary actions | `--on-accent`       | `#211713` |
| Keyboard focus ring     | `--focus`           | `#a9c7f6` |
| Unsaved revision        | `--unsaved`         | `#e0bb79` |
| Unsaved message surface | `--unsaved-surface` | `#2e271c` |
| Error                   | `--error`           | `#ec9792` |
| Error message surface   | `--error-surface`   | `#342220` |
| Success                 | `--success`         | `#aec8ab` |
| Focus-work surface      | `--soft`            | `#30251f` |
| Scrollbar thumb         | `--scroll-thumb`    | `#59534d` |
| Scrollbar thumb hover   | `--scroll-hover`    | `#787068` |

Focus-work markers may share the accent value, but keyboard focus, work type, and self-rated concentration are separate concepts. Keep their names and presentation distinct.

Primary buttons explicitly pair each action fill with its text colour. Generic secondary hover rules must not replace the primary fill while leaving dark action text behind. Disabled primary buttons retain their base fill/text pairing on hover and cannot activate. Use explicit hover and pressed tokens rather than a brightness filter.

The divider token is intentionally quiet. It is not sufficient evidence that an essential input or control boundary meets contrast requirements; supply and validate a stronger boundary token where necessary.

### Reference palette values

These overrides leave status colours independent.

| Theme        | Action    | Hover     | Pressed   | Action text | Focus-work surface |
| ------------ | --------- | --------- | --------- | ----------- | ------------------ |
| Dark cobalt  | `#a2bfff` | `#b9ceff` | `#8aaaf0` | `#16213b`   | `#222a3a`          |
| Dark sage    | `#b7c5a0` | `#cad7b5` | `#a4b68d` | `#1b2416`   | `#283023`          |
| Light rust   | `#955039` | `#7f422e` | `#6c3726` | `#fffaf5`   | `#f0e3d9`          |
| Light cobalt | `#345da6` | `#284d90` | `#20417d` | `#ffffff`   | `#e8eef9`          |
| Light sage   | `#526c3f` | `#435b33` | `#364a28` | `#ffffff`   | `#e8efdf`          |

The light reference foundation uses canvas `#f6f3ee`, surface `#fffdf9`, secondary hover `#ece7df`, text `#28231f`, secondary text `#655d55`, divider `#d5ccc0`, focus `#315ea7`, unsaved `#805c15` on `#f7edd4`, error `#ac3632` on `#fbe7e4`, success `#406541`, and scrollbar `#b8afa4` / hover `#8b8175`.

## React theme implementation

The production theme boundary is [themes.css](../apps/desktop/ui/src/themes.css). It contains all palette literals. [index.css](../apps/desktop/ui/src/index.css) defines typography, spacing, geometry, motion, and component rules, and exposes the semantic roles as Tailwind colours. Components must consume these roles instead of literal colours, palette names, or brightness filters.

Rust/dark is the default when the root element has no theme attributes. `data-palette="cobalt"` or `data-palette="sage"` on `<html>` exercises alternative accent bundles; `data-mode="light"` supplies light neutrals and status colours. These are implementation reference themes, without a new user-facing preference or persistence setting. Applying a theme at the root also covers portalled dialogs, tooltips, and notifications. `useThemeMode` adapts root appearance changes for the calendar and notification libraries; calendar remounts retain the React draft.

| Role                                            | Production tokens                                                                                       |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Surfaces and text                               | `--db-canvas`, `--db-surface`, `--db-raised`, `--db-ink`, `--db-muted`                                  |
| Structure and essential control boundaries      | `--db-line`, `--db-control-border`                                                                      |
| Primary action, hover, pressed, and paired text | `--db-accent`, `--db-action-hover`, `--db-action-active`, `--db-on-action`                              |
| Keyboard focus                                  | `--db-focus`                                                                                            |
| Draft warnings                                  | `--db-warning`, `--db-warning-surface`                                                                  |
| Errors and destructive actions                  | `--db-danger`, `--db-danger-surface`, `--db-danger-hover`, `--db-on-danger`                             |
| Success and information                         | `--db-success`, `--db-success-surface`, `--db-info`, `--db-info-surface`                                |
| Focus work and other block types                | `--db-focus-surface`, `--db-focus-block`, `--db-shallow-block`, `--db-urgent-block`, `--db-break-block` |
| Brand, scrolling, overlays                      | `--db-brand`, `--db-scroll-thumb`, `--db-scroll-hover`, `--db-overlay`, `--db-shadow`                   |

Add an accent bundle by supplying its resting, hovered, and pressed action fills, paired action text, and focus-work surface together. Status and keyboard-focus colours remain independent of the accent. Add a new appearance by supplying the neutral and state roles as well. Verify all action states, readable status text, keyboard focus, disabled controls, short blocks, dialogs, and narrow layouts before adopting it. The browser suite measures rendered action and calendar-title contrast across the six supplied palette/appearance combinations and verifies that accent changes preserve status colours.

Inter 4.1 is bundled locally under [public/fonts](../apps/desktop/ui/public/fonts/) with its SIL Open Font License. It does not require a Google Fonts connection. Georgia uses the installed system font with a serif fallback. Desktop application icons and the browser favicon remain fixed identity assets; changing an application theme does not regenerate those assets.

The React planner continues to use its configured day range, snapping, and revision API. Its history previews remain read-only, move to the right on wide screens, and open in a focus-contained drawer at or below 820px. Unsaved calendar blocks carry dashed warning edges and accessible state labels. Failed revision saves show a persistent error while retaining the draft and optional reason. Existing notes autosave, review, backlog, settings, and audit behavior remain governed by their feature documentation. The prototype focus timer and extra keyboard shortcuts are not added by this visual implementation.

## Typography

| Use                               | Family / weight | Size / line height |
| --------------------------------- | --------------- | ------------------ |
| Page heading, desktop             | Georgia 400     | 34 / 41px          |
| Page heading, mobile              | Georgia 400     | 29 / 35px          |
| Section heading                   | Georgia 400     | 26 / 34px          |
| Daily-note quotation              | Georgia 400     | 19 / 30px          |
| Body                              | Inter 400       | 14 / 21px          |
| Controls and form labels          | Inter 400–500   | 13 / 20px          |
| Supporting copy and time metadata | Inter 400       | 12 / 18px minimum  |
| Block title                       | Inter 500       | 14 / 20px          |

Use interface fonts for form labels and time values. Use tabular numerals for times, durations, and totals. Avoid letter-spaced uppercase for recurring labels.

Block titles wrap to two lines when height permits. Compact blocks show one line. The list view, editor, and accessible name retain the full title; a tooltip is supplemental. Do not enlarge a timed block merely to fit its title, because block geometry encodes duration.

## Layout, spacing, and surfaces

Use a 4px base spacing scale: 4, 8, 12, 16, 24, 32, and 48px. Typical spacing is 8px within controls, 16px within groups, and 24–32px between sections.

| Foundation                | Reference rule                                                 |
| ------------------------- | -------------------------------------------------------------- |
| Desktop shell             | 190px navigation sidebar, flexible planner, 245px history rail |
| Wide screens, from 1450px | 210px sidebar and 265px rail                                   |
| At or below 820px         | History moves to a drawer; retain visible History access       |
| At or below 580px         | Navigation becomes horizontal; controls use 44px targets       |
| Calendar scale            | 80px per hour; reference editing snap is 15 minutes            |
| Schedule viewport         | Reference 520px desktop / 490px mobile, with normal scrolling  |
| Corners                   | 4px controls and blocks, 6px specimen cards, 10px modal        |
| Borders                   | 1px ordinarily; dashed edges identify unsaved blocks           |
| Depth                     | Flat planner surfaces; shadow reserved for overlays            |
| Motion                    | 140ms state transitions; respect reduced-motion preferences    |

The prototype's 09:00–18:00 range and 240-minute editor maximum are sample constraints. Production day range, snapping, duration limits, and validation must follow the application's supported configuration and feature rules.

Keep the schedule scrollbar thin and muted: approximately 6px, transparent track, rounded thumb, and a modest hover change. Preserve visible scroll affordance and keyboard scrolling. Reserve gutter space to avoid content shifting.

Keep revision history optional on desktop. Hiding the rail gives the calendar more room; history remains accessible through a button. On narrow screens use a modal drawer and a visible save/status bar. Layout and typography must work at 200% zoom without hiding essential actions.

## Component contracts

### Actions and navigation

Use one primary action per decision group. Secondary actions use a visible boundary; low-emphasis actions use plain text. Define rest, hover, pressed, disabled, loading, and keyboard-focus states.

Active navigation uses text plus a visible marker. Calendar and list are alternate representations of the same plan, not independent data stores. Design-system specimens and failure exercises are prototype/development controls, not ordinary planner navigation.

### Fields and validation

Provide persistent labels, readable input boundaries, and errors beside the relevant field. Associate error text with the input and expose invalid state accessibly. Preserve entered values after validation failure.

### Calendar blocks

Neutral blocks use a normal surface and muted edge. Focus-work blocks use a soft accent surface and accent edge. Unsaved changes add a dashed edge and explicit label where height permits; full accessible names include the state even for compact blocks.

Completion uses explicit text or another non-colour cue. Keep work type, completion, and revision state independent.

Click or Enter opens precise editing. The left edge supports moving and the lower edge supports resizing. Essential functionality must also be available through fields.

### History and overlays

Show saved revisions as a timeline beside the desktop schedule or in a modal drawer. Each revision represents a complete snapshot. Loading an earlier revision creates a draft; it does not overwrite history or silently save.

Dialogs have a title, close action, contained focus, and focus restoration when closed. Modal background content is inert. Escape closes the top overlay when no blocking operation is in progress.

### Feedback and empty states

Saving follows Ready → Saving → Saved or Failed. Prevent duplicate submissions. A failed save keeps the draft, earlier revisions, and revision note intact and offers Retry. Persistent errors stay near the action; toasts confirm minor changes.

An empty day shows “No blocks planned” and Add block. Empty history shows “No saved revisions yet.” Loading and unavailable-data states must be distinguishable from a genuinely empty day.

## Interaction and data contracts

The visual system preserves revision over mutation. It must not weaken the repository's existing storage, request-safety, or automatic-revision semantics.

| Interaction  | Target presentation and recovery                                                                                                                 |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Move         | Preview the destination at the configured snap interval; commit the draft edit on release. Escape or pointer cancellation restores the original. |
| Resize       | Preview duration and end time. Invalid release preserves the previous duration. The editor offers a precise alternative.                         |
| Invalid edit | Explain overlap or range errors and preserve the previous valid plan. Use the application's existing validation rules.                           |
| Save         | Append a complete revision through the supported application workflow; show progress and prevent duplicates.                                     |
| Save failure | Retain the same draft and revision note; retry must not create duplicate revisions.                                                              |
| Discard      | Return to the latest saved snapshot without deleting earlier revisions.                                                                          |
| Restore      | Copy an earlier snapshot into a new draft.                                                                                                       |
| Daily notes  | Belong to the day independently of plan revisions; persistence has its own Saving / Saved / Failed feedback.                                     |
| Day review   | Show planned time separately from recorded actual time and self-rated concentration.                                                             |

The reference prototype's explicit save dialog demonstrates revision and recovery states. Implementation must reconcile those states with [automatic revisions](features/automatic-revisions.md); this document does not decide to replace the existing automatic workflow with mandatory manual saving.

Reference keyboard shortcuts are N for Add block, H for history, ? for help, and Ctrl/Command+S for save. Single-key shortcuts pause in editable fields and overlays. Provide a production option to disable them, and reconcile bindings with existing shortcuts before adoption.

Touch users can scroll normally and edit exact times through fields. No essential action depends on hovering, dragging, or a permanently visible rail.

## Accessibility and theme acceptance

Before adopting a component or palette:

- Verify normal text contrast of at least 4.5:1 and large text and meaningful control boundaries of at least 3:1.
- Verify action text against rest, hover, and pressed fills, and status text against its associated surface.
- Use a distinct 2px keyboard-focus outline with 3px offset; ensure visibility against adjacent surfaces.
- Pair state colours with labels, borders, or shapes.
- Test full keyboard flows, modal focus containment and restoration, and accessible full block names.
- Test long titles, short blocks, unsaved changes, failed saves, retries, disabled controls, and loading states.
- Test narrow screens, 200% zoom, reduced motion, and forced-colour mode.
- Validate the shared browser UI and supported Tauri runtime using the repository's testing guidance.

Calculated rust/dark action-text contrast is approximately 6.46:1 at rest, 7.84:1 on hover, and 5.39:1 pressed. These token calculations are not a rendered accessibility audit.

The standalone prototype received JavaScript parsing and simulated interaction checks for valid edits, rejected overlaps, failed-save preservation, and a single successful retry. These checks do not establish production integration, complete browser coverage, or certification of every theme and state.

## Related documentation and migration

Use this document for visual identity, theme roles, typography, layout, and component presentation. Keep these existing documents authoritative for their respective concerns:

- [Shared UI runtime](shared-ui-runtime.md): browser/Tauri runtime and shared implementation.
- [Planner grid UX](features/planner-grid-ux.md): supported planner interactions and geometry.
- [Automatic revisions](features/automatic-revisions.md): revision creation and persistence workflow.
- [Storage and request safety](storage-and-request-safety.md): data and request guarantees.
- [Testing](testing.md): supported verification commands and runtime coverage.
- [Feature gap analysis](project-analysis/feature-gap-analysis.md): implemented capabilities and remaining gaps.

During documentation reconciliation, add links to this specification, mark superseded visual proposals as historical, and remove contradictory palette or typography prescriptions. Preserve useful interaction and implementation history. Do not describe Design System v1 target states as shipped capabilities until implementation and validation establish them.
