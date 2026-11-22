# AGENTS.md

Agent playbook for the active DeepBlock repository.

DeepBlock is now a Rust/Tauri localhost time-blocking system built around **revision over mutation**: daily plans are appended as revisions instead of being overwritten.

## Repo layout

- `apps/server/` — Rust Axum server
- `apps/cli/` — Rust CLI (`deepb`)
- `apps/desktop/` — Tauri desktop shell and React UI
- `docs/` — current documentation and analysis

## Current source-of-truth docs

- `README.md`
- `docs/configuration.md`
- `docs/testing.md`
- `docs/desktop-distribution.md`
- `docs/linux-development.md`
- `docs/releases.md`
- `docs/shared-ui-runtime.md`
- `docs/storage-and-request-safety.md`
- `docs/features/automatic-revisions.md`
- `docs/features/planner-grid-ux.md`
- `docs/project-analysis/mindful-self-direction.md`
- `docs/project-analysis/feature-gap-analysis.md`

## Tooling

- Rust toolchain: `cargo`
- Rust build cache: `mr-boxington` (`mbx`) — Cargo invoked through mise tasks/shims is cached automatically via the `rust` tool option in `mise.toml`. Root `.mbx.toml` disables cached build-script execution so tauri-build keeps its ACL `links` metadata (`tauri::generate_context!` panics otherwise). Supported platforms: macOS ARM64 and Linux x64; Linux ARM64 and Windows x64 are expected to work (mbx ships binaries) once adopted
- Desktop UI: `pnpm` (workspace root + `apps/desktop/ui`; npm lockfile removed)
- Task runner: `mise` (locked toolchain in `mise.lock`; install with `mise install`)
- Git hooks: `hk` (install via `mise run hooks:install`)
- GitHub Actions security: `zizmor` + `actionlint` + locked ShellCheck (`mise run actions:audit` / `mise run actionlint`)

## Common commands

### Setup

```bash
mise install
```

### Development

```bash
mise run dev                 # trusted-network browser + loopback backend
DEEPBLOCK_DEV_LOCAL=1 mise run dev
mise run dev:server
mise run dev:cli
mise run dev:web
mise run dev:desktop
mise run clean:rust          # remove this project's Rust build output and mbx workspace state
mise run clean:web           # remove frontend dependencies, build output and test reports
mise run cache:trim          # trim shared mbx cache objects to MBX_MAX_SIZE (default 50MiB); mbx target pruning follows separate policies
mise run clean               # clean Rust/web output, release artifacts in dist/, and dependencies, then trim the shared mbx cache
```

### Quality gates

```bash
mise run lint
mise run test
mise run build
mise run build:desktop:bundle
mise run licenses:check       # dependency license gate (included in mise run lint)
mise run licenses:notices     # regenerate THIRD-PARTY-NOTICES.md after dependency changes
mise run test:property         # generated Rust/TypeScript invariants
mise run test:mutation         # opt-in local mutation suites; potentially slow
```

### Direct desktop UI commands

```bash
cd apps/desktop/ui
pnpm run lint
pnpm run typecheck
pnpm run build
pnpm run test:e2e
pnpm run test:e2e:tauri
```

### CI

`.github/workflows/test.yml` runs on push to `main`, pull requests, and on manual dispatch (`workflow_dispatch`). Changes limited to `docs/**` or root `README.md`, `AGENTS.md`, and `.gitignore` run only Workflow lint on PRs and skip the workflow on pushes to `main`. Other changes and manual dispatch run all jobs. Keep PR filtering at the job level so skipped jobs satisfy required checks. Jobs:

- **Workflow lint** — `actionlint` over `.github/workflows/` (catches workflow syntax errors; the `zizmor` security audit runs **local-only** via `mise run actions:audit` / the pre-commit hook)
- **Rust lint** — Cargo formatting and clippy (`-D warnings`)
- **Rust tests** — locked workspace tests via nextest and Cargo doc tests
- **Desktop UI** — eslint, project-reference typecheck, Vitest, Playwright, Vite build, Node helper lint/tests, and license and version checks

`.github/workflows/release.yml` runs on manual dispatch only. It tests the selected SHA, builds ad-hoc macOS ARM64 and Debian 12 amd64 packages, tests installation on Debian 12/13, and uploads a checksum-verified `release-candidate` Actions artifact. It does not use signing secrets or publish GitHub Releases. See `docs/releases.md` for build and download instructions. macOS-only checks do not establish Debian support.

Mutation suites are local-only mise tasks and are excluded from normal quality gates, hooks and CI. See `docs/testing.md` for source scopes, per-suite commands, reports and replay instructions.

## Code style

### Rust

- Keep types explicit and avoid `unwrap()` in user-facing runtime paths unless failure is truly unrecoverable
- Prefer small focused modules over broad utility dumping grounds
- Use `tracing` for logs
- Preserve the local SQLite, revision-based data model and portable exports; notes stay Markdown

### Desktop UI

- TypeScript strict mode stays on; repository-owned Node scripts use native `.ts`, erasable syntax, and separate typechecking
- Prefer React Query invalidation over ad hoc global state
- Use Playwright-backed flows for desktop E2E validation on macOS by default
- Keep native Safari/WebDriver Tauri runtime checks opt-in, not required

## Working agreements

- Keep changes focused; avoid drive-by refactors
- Update docs when behavior or supported workflows change
- LAN development exposes Vite only; preserve exact Origin checks and loopback backend Host validation
- Keep Tauri packaging and GitHub Actions QA builds standard; do not publish or change remote settings implicitly
- QA build minutes are limited: diagnose and replay failing stages locally with retained artifacts before requesting another full candidate run
- Validate with the surviving Rust/Tauri tasks before concluding
- Standardize guidance here; do not add a second agent-instructions file
