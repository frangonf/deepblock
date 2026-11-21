# Calendar Ingestion (`.ics` / WebCal)

**Status: proposal.** Calendar feeds are optional context for the integrated planner. Apply the [product principles](../project-analysis/mindful-self-direction.md); connecting an external calendar is not required to plan or reflect.

## Why this document exists

Meetings may already live in Google/Outlook/iCloud calendars. Showing them in DeepBlock helps users judge available capacity and revise a plan with its constraints visible. This spec defines how external calendar events enter DeepBlock **read-only**, without OAuth, webhooks, or cloud infrastructure.

## The core guardrail

External events are a **read-only overlay — never blocks inside revisions**.

- revisions record _your_ deliberation; the overlay records _the world's constraints_
- ingested events must never mutate revision history or pollute plan-vs-reality variance
- refreshing, staling, or removing a feed changes nothing in any revision
- review compares chosen DeepBlock commitments with voluntary feedback and available activity evidence; overlay events remain context
- unused calendar space remains neutral; feed import does not automatically fill it or schedule backlog tasks

This is the single most important decision in the document. Every future contribution must preserve it.

## Source model

- the user pastes a private `.ics`/WebCal URL into Settings (Google "secret address in iCal format", iCloud subscription URL, any `webcal://`/`https://…​.ics` endpoint)
- the Rust server fetches and caches each feed on a configurable interval (default 15 minutes), plus a manual "refresh now"
- failures degrade gracefully: serve the last good cache, show a stale indicator in the UI, never block the planner

## Parsing requirements (RFC 5545)

- use a proven Rust crate (`icalendar-rs` or the `ics` family) — do not hand-roll the parser
- must support: `VEVENT`, recurring events (`RRULE`/`EXDATE` expanded to concrete occurrences for the visible window), timezone and DST shifts, all-day events
- occurrence expansion is bounded to a fetch window of today ± `lookahead_days` (default 7)

## Rendering

- overlay events render on the Schedule-X grid via its events-service as a **separate, read-only event source**
- visual treatment: hatched/locked styling, clearly distinct from DeepBlock blocks; not draggable, not resizable, not editable
- creating a block on top of an overlay event shows a soft overlap warning — the user decides, DeepBlock does not hard-block

## Configuration

`config.toml` gains a `[calendar]` section:

```toml
[calendar]
poll_interval_minutes = 15
lookahead_days = 7

[[calendar.feeds]]
name = "Work"
url = "https://calendar.google.com/calendar/ical/…/basic.ics"
enabled = true
```

Optional CLI surface: `deepb calendar status` / `deepb calendar refresh`.

## Deliberately rejected

- **Google OAuth + push webhooks** — per the [Google Calendar push notifications documentation](https://developers.google.com/workspace/calendar/api/guides/push), webhook receiver URLs must be publicly reachable HTTPS endpoints; `localhost` is not eligible. A localhost-first app always falls back to polling anyway. Polling a secret `.ics` URL is 10× simpler and works offline.
- **Writing external events into revisions** — violates revision-over-mutation (see guardrail above).
- **EventKit (native macOS store)** — zero-OAuth and attractive, but macOS-only; it deepens the platform asymmetry that already blocks adoption. Optional later spike on top of this overlay layer; never the only ingestion path.

## Non-goals

- two-way sync or writing back to external calendars
- free/busy negotiation or scheduling links
- OAuth token pipelines of any kind
