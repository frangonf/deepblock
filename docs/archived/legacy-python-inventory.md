# Legacy Python inventory

The Python MVP has been removed from the repository. This document records what existed, what role it played, and why it was removed.

## Removed runtime packages

| Removed path      | Historical role                                                                                  | Rust/Tauri successor                                                                           | Removal rationale                                                           |
| ----------------- | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `packages/core`   | Shared Pydantic models, config helpers, XDG path logic, migrations, integrations                 | Rust domain/config logic inside the live workspace (`apps/server`, `apps/cli`, `apps/desktop`) | Keeping a second shared model layer created documentation and tooling drift |
| `packages/server` | FastAPI server, JSON persistence, WebSocket layer, ActivityWatch access, experimental automation | `apps/server`                                                                                  | The Rust server is the only supported backend now                           |
| `packages/cli`    | Typer CLI and Python API client helpers                                                          | `apps/cli`                                                                                     | The Rust CLI already covers the supported workflows                         |
| `packages/tui`    | Textual terminal UI                                                                              | No current replacement; desktop UI + CLI are the supported clients                             | The TUI was no longer the active product surface                            |
| `packages/web`    | Vue web client                                                                                   | `apps/desktop/ui`                                                                              | The desktop UI is the maintained frontend                                   |

## Removed tests and tooling

| Removed path                        | Historical role                                                               | Removal rationale                                                           |
| ----------------------------------- | ----------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `tests/`                            | pytest-based unit, integration, snapshot, and E2E coverage for the Python MVP | The live validation path is now Rust tests plus desktop Playwright coverage |
| `pyproject.toml`                    | Python workspace definition and pytest/ruff configuration                     | No Python workspace remains                                                 |
| `uv.lock`                           | Python dependency lockfile                                                    | No Python dependency graph remains                                          |
| `scripts/seed_dev_data.py`          | Python helper for seeding sample data into a running server                   | It depended on the removed Python toolchain                                 |
| `examples/agent/deepblock_agent.py` | Python example agent integration                                              | It no longer matched the supported runtime surface                          |

## Removed documentation and planning artifacts

| Removed path                            | Reason                                                                                       |
| --------------------------------------- | -------------------------------------------------------------------------------------------- |
| `CLAUDE.md`                             | Guidance is now standardized in `AGENTS.md` only                                             |
| `docs/rust-parity-status.md`            | Replaced by the current analysis docs in `docs/project-analysis/`                            |
| `docs/rust-implementation-reference.md` | Replaced by the current analysis docs in `docs/project-analysis/`                            |
| `specs/`                                | Product/spec artifacts were heavily Python-era and no longer reflected the supported runtime |

## What remains

The supported repository surface is now:

- `apps/server`
- `apps/cli`
- `apps/desktop`
- `docs/`

That leaves one active backend, one active CLI, and one active desktop client with a single docs surface.

## Addendum

- The root `Dockerfile`, originally added with the Python-era "production packaging" work and minimally adapted to build only the Rust server, was removed. It was never built or published by CI, was not a documented distribution path, and its `EXPOSE 8000` guidance conflicted with the loopback-only, unauthenticated security model. Container deployment remains a deferred follow-up requiring a separate security design.
- The Python-era docs described DeepBlock-managed ActivityWatch binary installation and service management. The supported flow is now bring-your-own ActivityWatch, documented in [Configuration](../configuration.md#activitywatch).
