# Shared UI runtime

## Goal

DeepBlock should develop **one React/Vite app** and run that same UI in two places:

1. directly in the browser for fast iteration and testing
2. inside the Tauri desktop shell for packaged desktop behavior

The shared app lives at `apps/desktop/ui`.

## Architecture

The React app is the source of truth for both browser and desktop rendering:

- **Browser runtime:** Vite serves `apps/desktop/ui` directly and talks to the Rust server over HTTP/WebSocket.
- **Tauri runtime:** the Tauri shell points at the same Vite dev server in development and the same built `dist/` output in packaged builds.

That means there is no second frontend package and no duplicated route tree, component tree, or styling layer.

## Shared visual theme

Both runtimes use [Design System v1](design-system.md#react-theme-implementation).
`apps/desktop/ui/src/themes.css` supplies semantic colour roles, with rust/dark
as the default. Root palette/appearance attributes demonstrate future theme
changes without duplicating components or changing persistence behavior.
`index.css` maps those roles into shared controls, the calendar library, and
portalled overlays. Inter is bundled locally with its license for offline use.

## Runtime-specific seams

Most of the app is runtime-agnostic. The only places that need runtime awareness are:

1. **Tauri command invocation** for desktop metadata and bundled-tool controls
2. **Notifications** because Tauri and browsers expose different notification APIs

These seams are isolated in `apps/desktop/ui/src/lib/runtime.ts`.

Rules:

- prefer shared browser-safe code by default
- keep Tauri-specific behavior behind small runtime adapters
- let the browser gracefully fall back when a desktop-only feature is unavailable

## Developer workflow

From the repo root:

```bash
# Browser + loopback backend; prints the selected trusted-network URL
mise run dev

# Optional separate terminals (use identical development overrides)
mise run dev:server
mise run dev:web

# Tauri desktop shell
mise run dev:desktop
```

Other useful commands:

```bash
mise run build:web
mise run preview:web
mise run test:desktop
```

Browser development uses same-origin `/api` HTTP/WebSocket proxying. The helper configures exact development origins and Vite hosts; it leaves Rust bound to loopback. `DEEPBLOCK_DEV_LOCAL=1` forces local browser development, and Tauri's task always uses loopback. See [Linux/LAN development](linux-development.md) for private-interface, DNS, VPN, port, and security guidance. `preview:web` defaults to localhost:4173 and requires a separately running backend.

## Confidence that web and Tauri stay aligned

DeepBlock keeps web and desktop aligned by design:

- both runtimes load `apps/desktop/ui`
- browser tests exercise the shared app directly
- Tauri dev points at the same Vite server
- Tauri bundle builds now explicitly build the shared web app before packaging

Desktop-only capabilities still remain desktop-only:

- bundled `deepb` install controls
- bundled ActivityWatch fallback controls
- Tauri-native command bridges

Everything else should be implemented in the shared app first. Browser ActivityWatch availability is fetched from the Rust backend; it does not require the native distribution bridge.

Routes load lazily behind a shared Suspense boundary, keeping calendar dependencies out of the initial shell bundle. Planner drafts survive refreshes and navigation through per-tab session storage, with explicit conflict/rebase handling and server-side optimistic preconditions. See [Storage and request safety](storage-and-request-safety.md).

The planner shell uses a compact header and shared visual tokens. Calendar and
list views stage edits into the same draft. **Save revised plan** fills untouched
bootstrap A on the first commitment; later commitments append one revision.
Optional reasons remain with the date-scoped draft. The runtime version is available in
Settings, while the daily workspace prioritizes the current plan.

### Shared visual foundations

The UI uses semantic canvas, surface, raised, ink, muted, accent, line, danger,
warning, and success tokens. Controls share an 8px radius, panels use a 12px
radius, and typography follows the native system sans-serif stack. Times use
aligned tabular numerals. Native selects share one `Select` primitive with
visible keyboard focus and disabled states. Reduced-motion preferences disable
UI transitions and animations. Application graphics are unchanged in this pass.

Day review reports evidence coverage independently from the number of planned
blocks: `summary.observed_blocks` counts non-cancelled blocks with a recorded
self-reported duration/focus value or positive ActivityWatch category evidence.
Empty queries and legacy zero-activity logs are unassessed; computer-active time
is not task duration or measured attention quality. Completion alone does not
count toward coverage. Missing, partial,
and unavailable coverage are presented explicitly. An empty discrepancy report
means the available evidence did not cross the review thresholds; it does not
establish that the whole day followed the plan exactly. Compare presents
before/after field values in readable text rather than raw JSON.

### Date scope and supporting pages

Planner, Compare, Reality, Review and Notes share URL-backed day navigation.
Today and future days support planner drafts; past scheduling is read-only.
Review can explicitly save optional outcomes for today and past days without
changing scheduling intent or creating a revision. Saved
undo/redo, standalone revision creation and ActivityWatch audits target today,
with visible scope guidance. ActivityWatch itself always shows today's live
snapshot independently of the selected plan date. Its timestamps follow the
same configured 12/24-hour preference as the calendar.

Compare accepts an optional `date` query parameter and shows a purpose-built
empty state for fewer than two revisions. Its default baseline is the first
nonempty revision, while legacy empty revisions stay selectable. Review shows
“Not assessed” instead of reassuring zero counts when evidence is absent. Notes
autosaves with date-scoped status, serialized writes, retry/recovery buffers,
and unload protection that remains active after leaving the editor;
Backlog offers capture, scheduling and completion actions. Help describes these
flows and the shared focus/reflect intent marker. The marker records intent
across clients but does not alter editing or notifications.

See [Planner grid UX](features/planner-grid-ux.md) for current behavior and the
[October UI/UX audit](project-analysis/ui-ux-audit-2026-10-01.md) for resolutions,
remaining graphics work and local validation results.
