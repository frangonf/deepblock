# SQLite storage and portability design v1

Implemented storage: `rusqlite` 0.40.2 with bundled SQLite and the backup feature.
The [connection API](https://docs.rs/rusqlite/0.40.2/rusqlite/struct.Connection.html)
and [backup API](https://docs.rs/rusqlite/0.40.2/rusqlite/backup/index.html)
provide the required transactions and consistent database backups. The dependency
and lockfile are pinned in the repository.

## Ownership and execution

The existing OS storage lock remains authoritative. Startup acquires it before
opening or importing `data_root/planning.sqlite3`. Only server storage methods
write structured data; clients use HTTP, and local portability commands acquire
the same lock while the server is stopped. SQLite connections are mutex-protected
inside storage and all HTTP storage calls run through `spawn_blocking`, outside
Tokio's async executor. Per-date/backlog locks still enclose complete mutation
cycles and optimistic draft comparison. Future recording uses a different file
and writer; no evidence worker receives this connection.

## Schema and transactions

`apps/server/src/planning-schema.sql` is the executable schema. A day row retains
the existing serialized plan and bounded `_history` together, preserving revision
and undo/redo semantics without a relational rewrite. Named resources hold backlog,
global mode and the validated context catalog. Intent rows append immutable intent
snapshots, indexed by date/time/insertion order. Changing a plan and appending its
intent version is one transaction. Notes and outcome-only changes preserve intent.
Catalog replacement and affected context snapshots must also commit together.

Use foreign keys, a bounded busy timeout and FULL synchronous durability.
Versioned migrations run inside a transaction. Unknown future database or export
versions fail closed. Initial migration uses the rollback journal so closing the
staging connection produces a self-contained database suitable for activation.
WAL is unnecessary for the initial single-writer/small-workload design; if adopted
later, backup must remain [WAL-aware](https://www.sqlite.org/wal.html).

Database schema version 2 adds an operational dataset generation row.
The transactional upgrade preserves existing planning values. Generation changes
only on whole-dataset replacement; it is not exported as user planning data.
Archive and portable planning versions remain independent of database versions.

## Legacy import and activation

Enumerate dated JSON documents and separate legacy histories, backlog and durable
state. Validate names, dates, schema, identities and decoding before activation.
Embedded history wins; separate history is included only when absent. Orphan
legacy histories obtain a virtual empty plan rather than being discarded.
Preserve unknown generic block metadata, timestamps, references and all retained
undo/redo. Do not invent overwritten historical intent; the first new snapshot
records migration-time availability rather than a historical timestamp.

Create a temporary database beside the target, import inside a transaction,
verify integrity and logical equality, close it, sync the file, then activate
without replacing an existing canonical database. Original files remain unchanged.
An interrupted import cannot publish a partial database; retry starts from the
original files. Once SQLite exists, never silently read stale legacy JSON again.
Corrupt/future-version databases fail startup. Removing SQLite is not rollback
after new writes; restore a verified export/backup instead.

## Portable export, import and backup

The original version-one portable JSON document contains dated plan/history documents,
named resources, ordered intent snapshots, managed note text, and optional TOML
configuration. Runtime locks/PIDs/endpoints and external artifact contents are
excluded. Configuration exports redact provider credentials if such settings
are introduced; current TOML contains no provider credentials.

Portable commands operate offline under the OS lock. Import requires fresh roots
and validates the entire manifest before creating canonical storage. Duplicate
dates/versions, unsupported schemas, unresolved references and unsafe note names
are rejected. Retarget managed note paths, including retained history; leave
external artifact/content references unchanged. Logical round-trip equality is
defined modulo destination-specific managed note paths.

Backup uses SQLite's [online backup API](https://www.sqlite.org/backup.html), plus
the manifest for managed notes/configuration and integrity-checked restoration.
This first implementation takes the existing ownership lock, so source notes and
configuration cannot change halfway through the package. Restore stages a complete
new data/config/state root; never overwrite a live installation. Database and
filesystem changes do not share a transaction: failed restore staging is discarded,
and final activation occurs only after all files validate and are written.

The implemented bundle format adds a versioned ZIP containing this planning document, independent Markdown
entries and optional configuration. The owning backend supports coordinated live
replacement with preview, a durable recovery journal and stale-client fencing.
Settings stays local during live import; offline import into fresh roots restores
configuration. See [data management](data-management-ui.md) for the current UI
and API contract. Offline directory backup/restore retains the rules above.

## Regression validation

The storage tests exercise the planning baseline. Coverage includes legacy/embedded history, arbitrary metadata, corrupt input,
interrupted staging, future schema, original-file retention, restart, omitted/null
feedback, atomic failed writes, export/import equality, isolated backup/restore,
and save responsiveness. Record platform-specific packaging/upgrade evidence
separately; no release candidate needs dispatching merely to develop the importer.
