# Storage and request safety

## One writer per storage root

The server acquires an exclusive OS lock on `data_root/server.lock` before loading settings or publishing runtime metadata. A second server using that data root exits with an error, even if it requests a different port. Never delete the lock file to bypass ownership: its stable inode coordinates writers. The OS releases the lock when the owner exits, including after a crash.

CLI and desktop share discovery: an explicit endpoint takes precedence, then a healthy recorded storage owner, configured backend, and default loopback backend. Discovery checks `/health` for `service: deepblock` and `status: ok`, not just an open TCP socket. A held storage lock with an unavailable or incompatible owner prevents automatic replacement on another port. Stop that owner first, or start an isolated backend with separate XDG data/config/state roots on a distinct port and explicitly target its endpoint. Changing XDG roots alone does not prevent an unowned client from discovering the configured/default backend. Restart older backends whose health response lacks the service identifier after upgrading. Desktop embedded startup requires the current process's recorded PID and expected endpoint under a held storage lock, in addition to health; another service winning the port-bind race is not adopted. No free candidate port means startup fails. Runtime cleanup only removes metadata recorded for the current process. `deepb stop` is a local XDG-storage operation and does not require HTTP health. It signals only when storage is locked and the PID/runtime records agree; unlocked or inconsistent records are refused. It reports signal submission, not a shutdown acknowledgement.

Within the server:

- per-date mutexes serialize plan mutations, notes-path updates, and undo/redo;
- a backlog mutex protects its full read–modify–write cycle;
- the settings write lock protects configuration updates through persistence and publication.

Direct file edits while the server is running are not coordinated with these locks. Use the API, or stop the server first.

## Atomic plan, history and intent commits

Structured planning data is canonical in `data_root/planning.sqlite3`. A single
SQLite transaction replaces the daily plan and bounded undo/redo history and
appends an immutable intent snapshot only when scheduling/context changes.
Failed validation or persistence leaves the plan, history and intent unchanged.
HTTP storage operations run outside the async executor.

On first startup under the storage lock, legacy daily JSON, separate history,
backlog and durable state are validated in a staging database. Originals remain
unchanged; activation follows verification and file synchronization. Once SQLite
exists, legacy JSON is never a fallback or a second writable backend. Unknown
future schemas and corrupt databases fail closed. Notes remain Markdown and
configuration remains TOML; they do not share a transaction with the database.
Retained undo/redo remains bounded to 50 entries. See
[SQLite design](features/sqlite-storage-design.md) and
[portability commands](features/storage-portability.md).

## Whole-dataset replacement

The owning backend uses a maintenance gate to coordinate live export and import
with complete requests, including blocking work whose caller disconnected.
Replacement retains the open SQLite connection, journals managed Markdown
changes, and creates a recoverable ZIP before committing the new dataset.
Startup completes or rolls back interrupted replacement. Configuration stays
local. An unrecovered journal prevents further planning access until recovery.

Planning mutations require the dataset generation header in addition to existing
revision checks. Missing generations return 428; stale generations return 409.
The UI reloads after replacement and isolates retained drafts by generation,
preventing queued or recovered edits from overwriting imported data. See
[data management](features/data-management-ui.md) for endpoints and limits.

## Optimistic drafts

`POST /plan/replan` accepts an optional `base_revision`: the complete active revision object read by the client, including block metadata and accountability fields. Under the date lock, the server compares it with the current active revision **before** taking an undo snapshot. A stale base returns HTTP 409 without writing anything. Existing clients may omit the precondition, but draft editors should always supply it.

The shared planner retains separate drafts by date in per-tab session storage. It detects remote changes without hiding staged edits. The user must explicitly rebase or discard a conflicting draft; rebasing replays only intentionally changed form fields. A deleted target prevents rebase and leaves the draft intact. Commits freeze editing, including after navigating away and returning; successful commits clear the retained draft even if the originating page unmounted.

Notes have a separate autosave buffer in the query cache and per-tab session storage. Client submissions are serialized; acknowledgement clears only matching text with no later queued submission for that date. Older in-flight note reads are cancelled before updating acknowledged query data, so they cannot replace saved text with a stale response. Failed saves retain the buffer and offer retry. Browser unload warnings remain active outside the editor. This is not cross-client conflict detection: simultaneous note writers still use last-writer-wins semantics.

Session storage is a recovery convenience, not a durable backup: closing the tab may discard it, and runtimes that deny storage only retain drafts in memory. The UI warns before unloading with unsaved drafts.

## Outcome annotations

`PATCH /blocks/{id}/outcome?date=YYYY-MM-DD` accepts only `actual_duration`, `focus_rating`, and `completed`. Omitted fields preserve previous values; explicit `null` clears them. Actual minutes allow 0–1440, focus ratings 1–5, and completion is a boolean stored in `metadata.outcome_completed`. Future dates, cancelled targets, scheduling fields, and revision-control flags are rejected.

The dated lock and atomic plan/history/intent transaction also protect outcome writes. They update only the active head's annotations and change log, bypass automatic revision creation, and preserve earlier snapshots and scheduling intent. Historical scheduling remains read-only in the shared UI; its Review page allows voluntary feedback. The form sends only fields changed from its opening snapshot, preserving unrelated concurrent feedback. Concurrent edits to the same outcome field remain last-writer-wins. Completion display falls back to legacy `done` status when no explicit annotation exists; clearing the annotation restores that fallback.

## Local HTTP boundary

All HTTP routes reject foreign `Origin` headers and non-loopback `Host` authorities with HTTP 403. This validation runs before CORS handling, so bodyless cross-origin POSTs cannot mutate data just because their responses are unreadable. The browser development/preview origins and Tauri origins remain allowed. Headerless local CLI requests remain supported.

Additional exact origins are enabled only when `DEEPBLOCK_DEV_MODE=1` and `DEEPBLOCK_DEV_ORIGINS` are both configured. HTTP, CORS, and WebSocket upgrades share the same policy; WebSockets still require an Origin, and Host validation remains loopback-only. Malformed or unsafe origin configuration fails startup.

The [LAN development helper](linux-development.md) exposes Vite on an assigned private interface, not Rust. Its `/api` proxy rewrites Host for the loopback backend but preserves the browser's Origin. Vite has no authentication: reachable trusted-network clients can read and mutate your data. Restrict it with a firewall/VPN, and keep ordinary packaged/backend behavior on the default policy.

This boundary is not authentication against another local process. Public hosting and shared multi-user deployments remain unsupported.

## ActivityWatch isolation

ActivityWatch requests have a five-second deadline; an entire audit has a thirty-second budget. Upstream enrichment runs outside the date lock. Afterward, only unchanged blocks in the same revision receive fetched reality data, so an audit cannot replace newer user edits. Schedule or block-type changes invalidate reality in the edited head, including displaced blocks, while preserving historical evidence.

Successful empty queries do not establish inactivity or failure. They leave evidence absent; legacy zero-activity logs are also treated as unassessed and can be retried. Category match describes classified computer activity, not task duration or attention quality. Duration mismatch and overrun findings use self-reported minutes only; overrun estimates explicitly assume the planned start time.
