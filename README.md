# DeepBlock

Local time blocking with daily plan revisions, reviews, and shared browser and desktop clients.

DeepBlock is a personal, source-first project. It is being tested through everyday use. Maintenance is best-effort, and packaged builds are for QA.

## Overview

DeepBlock is a local notebook for planning and reflecting on how you spend your day. Create time blocks, revise the schedule as circumstances change, keep notes and a backlog, and review planned versus reported work. Optional [ActivityWatch](https://activitywatch.net/) data adds computer-activity context.

In the shared UI, notes autosave after a brief pause; plan changes still require an explicit revision save. Day review accepts optional actual minutes, self-rated focus, and completion, including for past days without rewriting their schedules. ActivityWatch describes computer activity, not actual task duration or measured attention quality.

DeepBlock follows the time-block planning method [Cal Newport](https://calnewport.com/writing/) popularized: plan the day in advance, then revise it as the day unfolds. Revisions are kept for later reflection. The [product principles](docs/project-analysis/mindful-self-direction.md) put mindful self-direction at the center: choose commitments, adapt deliberately, and learn from the day. Goals and completion provide context; leaving time open is a valid choice.

The [Rust](https://www.rust-lang.org/) backend stores structured planning data in local SQLite, with Markdown notes and TOML settings. Settings provides complete ZIP bundles, previewed data replacement and automatic recovery; notes stay Markdown files in each bundle. Its `deepb` CLI, browser client, and [Tauri](https://tauri.app/) desktop app use the same API. The browser and desktop share one [React](https://react.dev/) UI.

> [!NOTE]
> Browser flows and ad-hoc desktop bundles were tested locally on macOS ARM64 with Rust 1.98.1, [Node.js](https://nodejs.org/) 26.10.0, and [pnpm](https://pnpm.io/) 12.8.1. The v0.2.0 release passed Debian 12/13 installation and end-to-end release checks; this evidence applies to that release source. Production notarization remains pending. See [planning baseline](docs/project-analysis/planning-baseline.md).

## Contents

- [Prerequisites](#prerequisites)
- [Install](#install)
- [Quickstart](#quickstart)
- [Configuration](#configuration)
- [Repository layout](#repository-layout)
- [Development and testing](#development-and-testing)
- [Notes and distribution](#notes-and-distribution)
- [Documentation](#documentation)
- [Contributing](#contributing)
- [Maintainer and support](#maintainer-and-support)
- [License](#license)

## Prerequisites

- [Git](https://git-scm.com/).
- [mise](https://mise.jdx.dev/installing-mise.html) 2026.9.15 or newer. It installs the toolchains pinned in [mise.toml](mise.toml) and [mise.lock](mise.lock).
- macOS: Xcode command-line tools, as described in [Tauri's platform prerequisites](https://v2.tauri.app/start/prerequisites/).
- Debian 12/13: the bootstrap step below installs native dependencies. See [Linux development](docs/linux-development.md) for the packaging and validation limits.

## Install

```bash
git clone https://github.com/frangonf/deepblock.git
cd deepblock

# On the Debian development host, install native prerequisites.
if [ "$(uname -s)" = "Linux" ]; then
  bash scripts/bootstrap-debian.sh
fi

mise install --locked
mise run install
```

On Debian, bootstrap installs system packages using sudo when needed. mise installs development tools; the install task downloads Rust and UI dependencies. These steps do not start the application or install `deepb` on your PATH.

## Quickstart

From the repository root:

```bash
DEEPBLOCK_DEV_LOCAL=1 mise run dev
```

Open the printed browser URL, normally [localhost:5173](http://localhost:5173). You should see the **Planner** page with an **Add block** action. Rust listens on loopback port 8000; Vite proxies `/api` HTTP and WebSocket traffic to it. Stop both services with Ctrl-C.

Starting the application creates its local storage directories. Use the [configuration guide](docs/configuration.md) to isolate development data if you already have an installation.

## Configuration

| Files                     | Default location                  |
| ------------------------- | --------------------------------- |
| Shared settings           | `~/.config/deepblock/config.toml` |
| Plans, notes, and backlog | `~/.local/share/deepblock/`       |
| Runtime ownership records | `~/.local/state/deepblock/`       |

`XDG_CONFIG_HOME`, `XDG_DATA_HOME`, and `XDG_STATE_HOME` override the corresponding roots. See [Configuration](docs/configuration.md) for server ports, revision strategies, and planner preferences.

- **ActivityWatch:** optional local activity data for audits and reviews. Install and run ActivityWatch separately; follow the [configuration guide](docs/configuration.md#activitywatch).
- **Desktop reminders:** time-based notifications before blocks start or end, configured in desktop Settings. See [notification settings](docs/configuration.md#notifications).

## Repository layout

```text
apps/
  server/    Rust Axum backend
  cli/       Rust CLI (deepb)
  desktop/   Tauri shell and shared React UI
docs/        Setup, runtime, feature, and release documentation
scripts/     Development and packaging helpers
```

## Development and testing

> [!WARNING]
> LAN development exposes an unauthenticated Vite frontend. Reachable clients can read and change planning data. Restrict access with a firewall or VPN; public hosting and shared multi-user deployments are outside the supported security model.

For browser development on a trusted LAN or VPN:

```bash
mise run dev
```

Open the printed private-interface URL from your browser client. Rust remains loopback-only. [Linux/LAN development](docs/linux-development.md) covers interface selection, hostnames, ports, and separate server/frontend terminals.

For local Tauri development, stop browser development first: both tasks use frontend port 5173.

```bash
mise run dev:desktop
```

Run CLI help from the source checkout without installing `deepb` globally:

```bash
mise exec -- cargo run --locked -p deepblock-cli -- --help
```

Install [Playwright](https://playwright.dev/)'s Chromium browser before the first browser test run. On Linux, `--with-deps` also installs browser system dependencies.

```bash
mise exec -- pnpm -C apps/desktop/ui exec playwright install --with-deps chromium
mise run lint
mise run test
mise run build
```

`build` compiles the Rust workspace and shared frontend. `mise run licenses:check` checks the dependency license policy and verifies that [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md) is current. Regenerate it with `mise run licenses:notices`. See [Testing](docs/testing.md) for focused suites and opt-in native desktop checks.

### Cleanup

Stop builds and development servers before cleaning:

```bash
mise run clean:rust  # this project's Rust build output and mbx workspace state
mise run clean:web   # frontend dependencies and build output
mise run cache:trim  # machine-wide mbx cache objects; default budget: 50MiB
mise run clean      # all of the above; includes frontend test reports
```

`cache:trim` replaces `clean:mbx`. Override its budget with
`MBX_MAX_SIZE=1GiB mise run cache:trim`. Cache-object trimming is machine-wide;
mbx garbage collection can also prune targets under its separate size and age policies. `clean:rust` explicitly
removes this project's target without cleaning other projects' targets.

`clean` also trims the shared mbx object cache. These tasks retain source files,
lockfiles and application data. After `clean:web` or `clean`, run
`mise run install` before building again.

## Notes and distribution

- One backend owns each storage root. Stop an existing owner before replacing it; see [Storage and request safety](docs/storage-and-request-safety.md).
- macOS packaging targets ARM64 `.app`, `.dmg`, and CLI/server archives. The app bundles `deepb`; ActivityWatch is bring-your-own unless explicitly staged.
- Debian packaging targets separate desktop, CLI, and server packages. Headless packages avoid GTK/WebKit; installation does not start a service. Compatibility remains provisional until the Debian jobs pass.
- Use the [manual Release workflow](docs/releases.md) to build temporary QA artifacts for another machine. It does not publish GitHub Releases. See the [personal QA checklist](docs/testing.md#personal-qa-across-machines).

To build a local macOS app and DMG:

```bash
mise run build:desktop:bundle
```

> [!NOTE]
> Local bundles default to ad-hoc signing. Tauri's skipped-notarization warning is expected without Apple credentials; it does not establish notarization. Downloaded ad-hoc builds require Gatekeeper approval. See [Desktop distribution](docs/desktop-distribution.md).

## Documentation

- [Product principles](docs/project-analysis/mindful-self-direction.md): notebook simplicity, voluntary reflection, and user-controlled assistance
- [Shared UI runtime](docs/shared-ui-runtime.md): browser and Tauri boundaries
- [Automatic revisions](docs/features/automatic-revisions.md): revision behavior
- [Planner grid UX](docs/features/planner-grid-ux.md): calendar and draft workflows
- [Storage portability](docs/features/storage-portability.md): migration, export and backup/restore
- [Explicit intentions](docs/features/explicit-intentions.md): project/goal context and dated CLI feedback
- [Multi-day review](docs/features/multi-day-review.md): range baselines and feedback coverage
- [Module boundaries](docs/features/advanced-module-contracts.md): optional-worker contracts and validation limits
- [Data management UI](docs/features/data-management-ui.md): bundle contents, recovery, project editing, and intent history
- [Core planning trust](docs/features/core-planning-trust.md): implemented work, decisions, and tradeoffs

Completed foundations and future direction:

- [Feature gaps](docs/project-analysis/feature-gap-analysis.md): remaining work
- [Completed planning foundations](docs/project-analysis/pre-advanced-roadmap.md): delivered planning, storage, review, and module-boundary work, with ongoing validation notes
- [Advanced DeepBlock vision](docs/project-analysis/advanced-deepblock-vision.md): one product with orthogonal recording, project context, intent assessment, and workspace assistance

## Contributing

Open a [pull request](https://github.com/frangonf/deepblock/pulls) for focused changes. Run the quality gates above before submitting; [AGENTS.md](AGENTS.md) describes repository conventions.

## Maintainer and support

Maintained by Fran González. Use the [issue tracker](https://github.com/frangonf/deepblock/issues) for questions and bug reports. Include the commit or build run and sanitized reproduction steps. Keep personal plans, notes, activity data, and full data bundles out of issues.

## License

[MIT](LICENSE). See the [third-party dependency license inventory](THIRD-PARTY-NOTICES.md) for the Rust workspace and production UI.
