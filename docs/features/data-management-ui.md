# Data management and recovery UI

Settings provides complete ZIP export, import preview, explicit replacement,
recovery download and recovery restore in the shared browser/Tauri UI. Project
and goal editing and dated, read-only intent history complete the preparation
features available through the backend.

## Bundle contents and file ownership

A bundle contains `manifest.json`, `planning.json`, managed daily Markdown files
under `notes/YYYY-MM-DD.md`, and existing TOML under
`configuration/config.toml`. The manifest lists entry sizes and SHA-256 hashes.
Archive schema version 1 is separate from portable planning format version 1
and planning database schema version 2.

Planning JSON preserves all days, revisions, change logs, feedback, arbitrary
metadata, retained undo/redo, backlog, context identities, durable mode and
ordered intent snapshots. Markdown is stored as independent archive entries,
including empty daily notes and notes without a saved plan. Live note contents
remain files; SQLite stores planning references. Export does not create a second
live data authority. Managed notes must be regular files.

Every persisted DeepBlock user resource is included or export fails explicitly.
External artifact/content references and links inside Markdown remain references;
external documents, repositories, images and linked attachments are not copied.
Runtime locks/PIDs/endpoints and unsaved browser drafts are excluded. Export
unsaved drafts separately in Settings for manual recovery, including legacy and
retired-dataset drafts. They are never automatically replayed after replacement.

Existing JSON exports remain importable. Offline `deepb storage export file.zip`
uses the same bundle; a `.json` destination retains the legacy format. Import
recognizes content rather than trusting the extension. Existing directory-based
SQLite backup/restore commands remain available as an offline recovery mechanism.

## Live replacement and recovery

Preview validates the upload and displays current/incoming counts and dates,
plus notes added, overwritten and removed. The native desktop importer sends
archives only to a loopback backend, without using proxies or following redirects.
ZIP validation rejects unexpected or missing entries, duplicates, unsafe paths,
symlinks, unsupported versions,
checksum mismatches and excessive expansion. Staging never extracts arbitrary
archive paths. Structured JSON is limited to 64 MiB; uploaded and expanded ZIP
contents are limited to 1 GiB. Export fails rather than silently truncating data.

Confirmation replaces the complete planning dataset and managed daily notes.
This installation's settings remain unchanged, even when configuration is in the
bundle. Offline restoration into a fresh installation includes that configuration.
Managed daily-note locators in plans, blocks, retained undo/redo and intent
snapshots are retargeted while snapshot identities and meanings stay unchanged;
external references and Markdown contents are preserved.

One opaque preview is staged per backend. It expires after ten minutes and is
bound to its input and the current dataset fingerprint. Changes after preview
require another preview. Save or explicitly discard current-session drafts and
Settings/context edits, and finish pending saves, before confirmation.

The backend coordinates complete operations with a maintenance gate; requests
and their blocking work retain their permits even if callers disconnect. Export
snapshots SQLite, notes and configuration under exclusive coordination.
Replacement creates and syncs a recovery bundle before modifying any notes. A
durable journal records the target dataset generation. Managed notes change
before the SQL transaction commits the structured replacement and generation.

Startup rolls notes back from the staged recovery bundle if SQL did not commit;
if it committed, startup promotes the recovery bundle and completes cleanup.
Failures leave the old dataset recoverable; failed recovery keeps storage
unavailable until restart/recovery succeeds. A failed replacement retains the
previous successful recovery copy. The latest successful pre-import recovery
bundle can be downloaded or restored through the same preview/confirmation flow.
External editors must not change managed notes during replacement.

## Client and API contract

| Endpoint                         | Behavior                                                           |
| -------------------------------- | ------------------------------------------------------------------ |
| `GET /storage/status`            | Dataset generation, recovery availability, recovery-required state |
| `GET /storage/export`            | Stream a complete ZIP download                                     |
| `POST /storage/import/preview`   | Upload ZIP or legacy JSON; receive validated preview               |
| `POST /storage/import/commit`    | Confirm with `{ "preview_id": "…" }`                               |
| `GET /storage/recovery`          | Download the last pre-import bundle                                |
| `POST /storage/recovery/preview` | Preview restoring that bundle                                      |

Normal planning mutations require `X-DeepBlock-Dataset-Generation`, obtained
from storage status and retained for the editing session. Missing generations
return 428; stale generations return 409 without writing. Existing per-revision
and context-catalog conflict checks still apply. API responses include generation
headers; the backend emits `dataset_replaced` on its event socket.

The shared UI refuses stale responses, fences further saves after replacement,
and requires reload. Reconnection checks identity even if an event was missed.
Draft namespaces retain their original generation. The CLI retains generation
for a command's client session; rerun a rejected command after reviewing new data.
Older mutation clients must update to send the header. Health discovery remains
independent of the generation handshake.

Tauri uses narrow Rust native-dialog commands to stream a selected file to the
backend or save a backend download. The frontend cannot supply arbitrary file
paths and receives no general filesystem permission. Browser mode uses upload
and download. Both use the same backend ownership and replacement rules.

## Remaining UI features

Settings can rename projects, change ownership, and rename goals while keeping
identities. Concurrent edits require explicit review against the latest catalog.
There is no deletion workflow. Review shows intent snapshots for its selected
date, with historical timestamps, schedules, project/goal labels and ownership.
History is read-only and describes declared intentions, not measured attention.

Production recording, AI providers, workspace assistance and module enable/pause
controls remain subsequent work. Existing outcome, range-review and truthful
module-status controls remain available.

## Validation

Rust fixtures cover actual ZIP and legacy JSON file round trips, rich planning
values, notes and retargeted references, HTTP export/replace/recovery, real CLI
subprocesses, stale clients, changed previews, archive rejection, SQL-failure
rollback and startup recovery on both sides of commit. Browser flows cover
Settings download/import/cancel/replace/recovery and context/history. Unit checks
cover generation fencing and draft isolation. Native dialog smoke checks on
macOS require that platform; Linux compilation and browser tests do not establish
macOS dialog or installer acceptance.

On Linux, 2026-10-09: 147 Rust/Tauri tests, 77 shared UI unit tests,
32 browser tests and 58 Node helper tests passed. Workspace build, UI build,
Rust lint, UI lint/typecheck, script lint, workflow audits and version agreement
passed. The Linux Tauri Debian bundle built successfully; installation was not
tested. macOS native dialog and installer checks remain pending.
