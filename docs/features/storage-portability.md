# Storage migration and recovery

Structured storage is `data_root/planning.sqlite3`. First startup validates and
imports existing planning/history, backlog and mode files into a temporary
database, verifies preservation, then activates it. Original files are retained.
After activation, editing old JSON does not change the app. A failed migration
does not publish SQLite; correct the reported legacy input and restart.
Do not remove the database to revert: that would expose stale pre-migration data.

Use **Settings → Data** for live ZIP export, previewed replacement and recovery.
See [Data management UI](data-management-ui.md) for contents, confirmation,
client generation checks and failure recovery.

Stop the server/desktop storage owner before these offline CLI operations:

```sh
deepb storage export /absolute/path/plan-export.zip
deepb storage backup /absolute/path/new-backup-directory
deepb storage import /absolute/path/plan-export.zip /absolute/path/new-installation
deepb storage restore /absolute/path/new-backup-directory /absolute/path/new-installation
```

ZIP export stores Markdown and TOML as separate entries with a checksummed
manifest; `.json` exports retain legacy embedded-note compatibility. Export
includes versioned structured data, retained undo/redo and intent history,
managed daily Markdown notes and existing TOML settings. Backup additionally
uses SQLite's backup API to produce a consistent database and verifies it against
the manifest during restoration. External artifacts/content remain references;
their contents are not included. Runtime PID/endpoint/lock records and browser
session drafts are excluded. Existing destinations are refused.

Import/restore validate everything and stage a fresh installation containing
`data/deepblock`, `config/deepblock` and `state/deepblock`. Managed note references
are retargeted; external references retain their meaning. Start it explicitly:

```sh
XDG_DATA_HOME=/absolute/path/new-installation/data \
XDG_CONFIG_HOME=/absolute/path/new-installation/config \
XDG_STATE_HOME=/absolute/path/new-installation/state \
DEEPBLOCK_SERVER_PORT=8011 deepblock-server
```

Target clients explicitly at `http://127.0.0.1:8011`; separate XDG roots alone do
not prevent discovery of an existing backend. Offline restoration never automatically
replaces your existing installation. The GUI offers explicit current-dataset
replacement after preview and confirmation, retaining local settings.

## Validation scope

`storage_portability.rs` verifies legacy separate history, arbitrary nested
metadata, original retention, canonical authority, reported zero, managed notes,
restart, backup/restore, invalid input, future versions and offline ownership.
`review_regressions.rs` injects a SQLite transaction failure and checks plan,
history and redo preservation. Post-migration save measurements are recorded in the
[module evidence](advanced-module-contracts.md#measured-budgets-and-evidence).
Native installation/older-version upgrade checks require matching platform
artifacts and remain distinct from these portable storage tests.
