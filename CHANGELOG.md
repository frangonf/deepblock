# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Optional project/goal catalogs, manual planner associations, immutable intent history, and dated CLI outcomes.
- Multi-day review with final-plan baselines, voluntary self-report, and explicit missing-feedback coverage.
- Portable ZIP bundles, previewed data replacement, automatic recovery, and Settings workflows for data and context management.
- Versioned optional-module contracts, capability discovery, and mock-worker fault fixtures. Production recording, inference, and workspace control remain unconnected.
- Generated Rust/TypeScript property tests and opt-in local mutation-testing tasks, with coverage and replay limits documented in `docs/testing.md`.

### Changed

- Made SQLite canonical for structured planning data, with validated legacy JSON migration and portable export/import and backup/restore. Notes remain Markdown and settings remain TOML.
- Applied Design System v1, application identity assets, shared planner controls, and responsive editors/history.
- Defined mindful self-direction principles and separated merged implementation from remaining ordinary-use and platform acceptance gates.

### Fixed

- Hardened planner draft preservation, atomic scheduling, backend ownership/discovery, and voluntary outcome handling.
- Bounded release validation and verified draft uploads; scoped platform and signing claims to their recorded evidence.

## 0.2.0 - 2026-10-01

Private prerelease with trusted-LAN development and an automated release pipeline. Its downloads are not part of the public source repository.

Highlights: `mise run dev` now orchestrates LAN-facing UI development against the loopback-only backend with exact development origins for HTTP and WebSocket traffic; tagged pushes build verified macOS ARM64 and Debian amd64 draft releases through GitHub Actions with Debian 12/13 installation smoke tests and SHA-256 checksums; Cargo builds are cached with mr-boxington.

### Added

- Trusted-LAN development mode (`scripts/dev.ts`): private-interface discovery, coordinated frontend/backend startup, and a Vite `/api` proxy to the loopback-only backend, with exact development origins shared by the HTTP and WebSocket policies.
- Release tooling and workflow (`scripts/release.ts`, `.github/workflows/release.yml`) building verified macOS ARM64 and Debian 12 amd64 draft releases with Debian 12/13 installation tests and SHA-256 checksums.
- Cargo build caching with mr-boxington through per-platform mise configuration.

### Fixed

- Constructed valid same-origin WebSocket URLs in the UI API layer.

### Changed

- Moved the legacy Python inventory and the completed LAN/release planning doc to `docs/archived/` with an explicit unmaintained index, recording the Dockerfile removal in an inventory addendum and trimming the `AGENTS.md` source-of-truth list.
- Dropped the redundant ActivityWatch scope note from `docs/configuration.md`; the supported bring-your-own flow stays documented in the ActivityWatch section.

### Removed

- Root `Dockerfile`, an unused Python-era packaging leftover that CI never built or published and whose `EXPOSE 8000` guidance conflicted with the loopback-only security model.
- Legacy Python ignore rules (`.pytest_cache/`, `.ruff_cache/`, `.venv/`, `htmlcov/`) from `.gitignore`, plus the stale `Dockerfile` mentions in `renovate.json` pin-group descriptions.

## 0.1.0 - 2026-04-17

Initial pre-release baseline: the Python MVP with its ActivityWatch workflows, the Rust/Tauri rewrite, and the removal of the legacy Python workspace. Nothing has been tagged or published yet; the date marks the Rust-only repository milestone. Entries keep their original milestone dates.

### Added

- Rust workspace (`Cargo.toml`) with three crates: `apps/server`, `apps/cli`, `apps/desktop`. (2026-04-02)
- **Rust server** (`apps/server`, Axum 0.8): full API surface matching the Python FastAPI server — plan CRUD, block add/delete/patch/move/reposition, artifact add/remove, notes ensure/get/save, backlog get/update, compare revisions, config get/patch, mode get/set, health, audit, WebSocket broadcast, undo/redo with disk-persisted history. (2026-04-02)
- **Rust CLI** (`apps/cli`, Clap 4): `list`, `add`, `delete`, `revise`, `compare`, `mode`, `serve`, `status`, `stop`, `check`, `open` commands with JSON and pretty output. (2026-04-02)
- **Tauri desktop shell** (`apps/desktop`, Tauri v2): embeds the Rust server, waits for TCP readiness before loading the shared web UI, builds macOS `.app` and `.dmg` bundles. (2026-04-02)
- `mise.toml` tasks for the full Rust/Tauri lifecycle: `dev:server`, `dev:cli`, `dev:desktop`, `build:rust`, `build:desktop`, `build:desktop:bundle`, `build:web:desktop`, `lint:rust`, `test:rust`, `fmt:rust`, `install:tauri`, plus the pinned Rust toolchain in mise `[tools]`. (2026-04-02)
- Server smoke tests covering plan bootstrapping, block CRUD, compare, notes ensure, and backlog round-trip. (2026-04-02)
- PlannerView guard: quick-note open only works on today's plan. (2026-04-02)
- `deepb open` command to start the server, optionally start ActivityWatch, and open the web UI. (2026-02-06)
- `deepb aw doctor` command with OS-specific ActivityWatch guidance, plus ActivityWatch install/setup documentation. (2026-02-06)
- Web bundle build-and-sync task `build:web:bundle`, wired into `mise install` and `mise run build`. (2026-02-06)
- Feature-gap analysis and legacy Python inventory docs under `docs/project-analysis/`. (2026-04-17)

### Changed

- Standardized repository guidance in `AGENTS.md` and simplified the root `mise` task surface to the live Rust/Tauri runtime. (2026-04-17)
- Updated CI, testing docs, and Docker packaging to match the Rust-only repository. (2026-04-17)
- `mise run build`, `lint`, `test`, and `fmt` all include Rust steps. (2026-04-02)
- Server default bind host to `127.0.0.1`. (2026-02-06)
- Web client default API/WS base to `window.location` when no `VITE_API_*` is set. (2026-02-06)
- `deepb open` defaults to not starting ActivityWatch; use `--aw` for local binaries. (2026-02-06)
- ActivityWatch service error messaging now points to `deepb aw doctor`. (2026-02-06)

### Removed

- Legacy Python runtime packages under `packages/`. (2026-04-17)
- Python tests, Python toolchain files, and Python helper scripts. (2026-04-17)
- `CLAUDE.md` and stale Python-era spec docs. (2026-04-17)

### Fixed

- ActivityWatch client now respects `[activitywatch].url` host/port. (2026-02-06)
- ActivityWatch installer resolves the correct release asset before download and links binaries into `$XDG_BIN_HOME` or `~/.local/bin`. (2026-02-06)
- Web build TypeScript error from unused resize handle refs. (2026-02-06)

[Unreleased]: https://github.com/frangonf/deepblock/commits/main/
