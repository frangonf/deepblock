# DeepBlock testing guide

## Quality gates

From the repository root:

```bash
mise run lint
mise run test
mise run build
mise run version:check
```

- Rust: formatting, clippy with warnings denied, workspace tests/build.
- Shared UI: ESLint, TypeScript project-reference checking, Vitest, Playwright, Vite build.
- Node helpers: strict/erasable TypeScript checking, ESLint, Node's native test runner.
- Shell/workflows: locked ShellCheck/actionlint; strict local offline zizmor audit (no ignored findings).

`hk.pkl` checks Node helpers, workflow changes, and product-version agreement in addition to Rust/UI checks. Install hooks with `mise run hooks:install`. Signing warnings for explicitly ad-hoc bundles reflect missing production credentials, not a notarization result.

The PR Rust test job runs pinned `cargo-nextest` across the workspace, followed by
doc tests. It sets `CARGO_PROFILE_TEST_DEBUG=0` to limit debug-symbol and linker
size on hosted runners; debug assertions and the full test set remain enabled.
Disk usage is logged before the test build and after success or failure. This
mitigates the repeated optional-module CI linker `SIGBUS` before test execution; the original
logs alone did not establish whether storage pressure or a linker defect caused it.
Replay that job locally with the installed CI-pinned nextest version:

```bash
CARGO_INCREMENTAL=0 CARGO_PROFILE_TEST_DEBUG=0 mise exec -- cargo nextest run --locked --workspace
CARGO_PROFILE_TEST_DEBUG=0 mise exec -- cargo test --doc --locked --workspace
```

## Dependency updates

[Dependabot](../.github/dependabot.yml) opens weekly version-update PRs for the
Cargo and pnpm workspaces and GitHub Actions. Review and merge them manually.
For dependency updates, run `mise run licenses:notices` and commit the regenerated
inventory if it changed; `mise run licenses:check` rejects stale notices. Review
Tauri Rust and JavaScript updates together when they need to land in sync.

For the GitHub cutover, remove this repository from the old updater's app
installation and enable the dependency graph and Dependabot alerts and security
updates. Keep issues open and align who can open PRs with the README. Require
approval for workflow runs from all external contributors and leave auto-merge
off. Once the config lands on `main`, verify that a Dependabot PR opens and runs
on hosted CI without extra secrets or write permissions. Alerts are not a
substitute for auditing the lockfile.

Update toolchain pins in `mise.toml` and `mise.lock` manually with
`mise upgrade --bump --pin --no-global --no-prune`. Also review the workflow's
mise and nextest pins and update the Debian image digests in `release.yml`
manually; they aren't Dockerfiles or Dependabot-managed Action refs. Keep
Debian 12 as the build baseline. Keep third-party Actions SHA-pinned.
Review changes to the local `.github/actions/setup-apt/action.yml` and its
scripts with the workflows that use them. See [QA builds](releases.md#what-the-workflow-checks).

For manual JavaScript updates, use `pnpm outdated -r` and
`pnpm update -r --latest --save-exact '!typescript' '!temporal-polyfill'`.
The workspace enforces a one-day release age, supply-chain trust checks, and
strict peers. TypeScript stays on 6.0 while typescript-eslint requires `<6.1`;
Temporal stays on 0.3.2 while Schedule-X requires that exact peer. Revisit those
holds together with their peer dependencies, especially if an alert affects a
held package.

Run `pnpm audit --fix=update` before adding overrides. The remaining audited
`glob`, `minimatch`, and `qs` overrides in `pnpm-workspace.yaml` cover development
tooling; remove each once upstream resolves patched versions without it. Verify
with `pnpm audit`, `pnpm install --frozen-lockfile`, and the quality gates above.
Vitest setup imports `@testing-library/jest-dom/vitest` so runtime matchers and
their types are registered for Vitest 5.

## Property testing

Rust uses pinned [proptest](https://proptest-rs.github.io/proptest/) and TypeScript
uses pinned [fast-check](https://fast-check.dev/). Properties run in the existing
Rust, Vitest and native Node suites, including their ordinary CI runs. Run only
properties locally with:

```bash
mise run test:property
mise run test:property:rust
mise run test:property:ui
mise run test:property:scripts
```

The initial properties cover canonical scheduling inputs, exact-midnight limits,
ripple/reorder atomicity and cancelled blocks, revision identifiers and snapshot
preservation across copy modes, Unicode label ordering, immutable draft operations,
strict release versions/tags and complete release asset inventories. They use the
real implementation and requirement-based oracles, with bounded generated cases.

Rust runs 128 cases per property and persists shrunk failures in
`proptest-regressions/`. Commit those regression seeds when they capture a real
bug. Replay a run with `PROPTEST_RNG_SEED=<reported seed>`; proptest also prints
minimal failing inputs. TypeScript runs 100 cases with seed `20261009` for stable
mutation results; fast-check reports the seed and shrink path. To replay, set the
reported `seed` and `path` in that property's `fc.assert` options. Change seeds
intentionally when exploring more cases. The Rust mutation task fixes its seed
without changing the ordinary property-test seed selection.

## Local mutation testing

Mutation testing changes production code in temporary copies and reruns tests.
A caught/killed mutant causes a test to fail; a missed/surviving mutant warrants
inspection for an assertion gap or an equivalent behavior. Test files, type-only
`.d.ts` files and test setup are excluded from mutation, but remain available to
the runners. Rust additionally excludes the desktop Tauri GUI layer (native
windows, tray, dialogs and bundled process management need a real app handle)
and a reviewed list of provably equivalent mutants; see `.cargo/mutants.toml`
for the exact patterns and their rationale.

```bash
mise run test:mutation          # all four suites, serially; potentially very slow
mise run test:mutation:rust     # server, CLI and desktop Rust targets
mise run test:mutation:ui       # all shared UI source against Vitest
mise run test:mutation:scripts  # Node dev/build/release/native-harness helpers
mise run test:mutation:web      # all shared UI source against Playwright
```

By default every suite uses one worker to stay polite on shared machines. Forward
`max` as the first argument to use more of the local machine; any further arguments
still pass through to the underlying tool unchanged:

```bash
mise run test:mutation -- max   # all suites, accelerated
mise run test:mutation:rust -- max --file apps/server/src/revision.rs
mise run test:mutation:ui -- max --mutate src/components/planner/calendarDraft.ts
```

The aggregate task accepts only `max`; tool flags are suite-specific and belong
on the per-suite tasks (the aggregate rejects them instead of dropping them).

Max mode runs five parallel cargo-mutants jobs (each mutant's cargo test run
gets `CARGO_BUILD_JOBS=6`; the shared jobserver still caps total cargo
processes at the CPU count), Stryker concurrency 6 for the scripts
suite and 4 for the UI suite. The web suite accepts `max` but keeps a single
worker because its browser fixtures bind fixed ports.

These tasks are opt-in and local only. They are absent from `test`, `lint`, `build`,
`check`, git hooks and GitHub Actions. `cargo-mutants` is pinned as a **task-specific**
mise Cargo tool, installed on first use, so ordinary setup/CI does not install it.
StrykerJS and its Vitest runner are pinned pnpm development dependencies.

| Suite   | Mutated source                                                   | Tests used                                                                                  | Reports                                                              |
| ------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Rust    | Server and CLI workspace Rust targets (Tauri GUI layer excluded) | Entire workspace Cargo unit/integration tests and doctests for each mutant                  | Root `mutants.out/`, including `outcomes.json` and per-scenario logs |
| UI      | `apps/desktop/ui/src/**/*.{ts,tsx}`                              | Existing Vitest suite, including generated properties                                       | `apps/desktop/ui/reports/mutation/ui.html` and `ui.json`             |
| Scripts | `scripts/**/*.ts`, `apps/desktop/ui/scripts/**/*.ts`             | Existing native Node suite, including copied-source subprocess tests and release properties | Root `reports/mutation/scripts.html` and `scripts.json`              |
| Web     | `apps/desktop/ui/src/**/*.{ts,tsx}`                              | Existing Playwright browser/LAN suite                                                       | Root `reports/mutation/web.html` and `web.json`                      |

Rust uses all workspace tests against each mutant, so tests in CLI/desktop crates
can detect server faults. It keeps baseline checks, passes `--locked` to Cargo,
uses one mutation worker and four Cargo build jobs, and disables test debug
symbols to bound artifact sizes. Normal Rust tests still use the existing settings.
Stryker's Vitest runner uses per-test coverage to select tests; Node and Playwright
use its command runner and rerun their full suite per mutant. Workers are limited
to one to avoid concurrent fixed-port browser servers and unnecessary build load.

The Playwright fixture reads Stryker's `__STRYKER_ACTIVE_MUTANT__` and injects it
into each browser context before application scripts run, only when
`DEEPBLOCK_MUTATION_E2E=1`. The task
preserves mise tool/config/state directories before application fixtures replace
their XDG roots, so the Rust build uses the installed toolchain/cache. It trusts
only copied mise configs under this checkout's `.stryker-tmp/` for that process.
Playwright stops at the first failure during mutation runs. Normal
browser runs are unchanged. The backend and all storage fixtures remain isolated
as in ordinary Playwright tests. Node subprocesses inherit the active-mutant
environment and execute copied instrumented source from the Stryker sandbox.

Start with a narrow scope when iterating; mise forwards arguments after `--`:

```bash
mise run test:mutation:rust -- --list-files
mise run test:mutation:rust -- --file apps/server/src/revision.rs
mise run test:mutation:ui -- --mutate src/components/planner/calendarDraft.ts
mise run test:mutation:scripts -- --mutate scripts/release-core.ts
mise run test:mutation:web -- --mutate apps/desktop/ui/src/lib/comparison.ts
```

Rust supports `--in-diff <diff-file>`, but **test-only edits select no mutants**;
rerun the affected production modules when changing assertions. Stryker runs are
full by default, without an incremental cache or a required score threshold.
`--incremental` is available for UI iteration, but force a fresh run after changing
support files, dependencies, snapshots or configuration. All reports and temporary
sandboxes are ignored by git. Rust exits nonzero for missed mutants/timeouts;
Stryker emits survivor reports without enforcing a score (`thresholds.break=0`).
The aggregate task continues through every suite and exits nonzero if any suite
command fails. Inspect timeouts, compilation errors and survivors separately;
do not treat infrastructure failures as proof of useful assertions.

These scopes assess supported **Rust and TypeScript production code**, rather
than mutating tests themselves. Rust mutations are evaluated by Cargo tests,
while the browser suite evaluates UI mutations with an unchanged Rust backend.
SQL, shell/YAML workflows, macro expansions and installed native GUI behavior
are outside automatic mutation coverage. Existing shell/workflow regression tests
still execute in the Node suite; native Tauri runtime and packaging checks remain
separate. A mutation score does not establish that every requirement is tested.

## Browser and LAN tests

```bash
mise run test:desktop
# Or from apps/desktop/ui:
pnpm run test:unit
pnpm run test:web
```

Playwright uses Linux-only `--use-gl=disabled` to bypass Chromium's stalled SwiftShader/GL startup without extending timeouts or forcing clicks. Other platforms and native Tauri/WebKit tests are unchanged. `e2e/browser-rendering.spec.ts` guards real button clicks with a five-second deadline.

`e2e/planner-calendar.spec.ts` checks block-editor width, overflow, field reflow,
viewport placement and reachable actions from 1440 × 900 down to 390 × 844,
including short 640 × 480 and 480 × 480 windows. It also checks every primary
page for horizontal overflow at the desktop minimum of 480 × 480. Run the same
layout regressions in WebKit to cover the engine family used by macOS/Linux
Tauri (not the native shell itself):

```bash
cd apps/desktop/ui
pnpm exec playwright install webkit
pnpm exec playwright test e2e/planner-calendar.spec.ts --browser=webkit --grep "block editors use available width|shared pages fit"
```

Playwright starts isolated Rust/Vite services on `8010`/`5173` and runs serially. Existing listeners are refused rather than silently reused. Test fixtures live under ignored `.playwright-data`; each run resets them. The frontend server gets SIGTERM and cleanup time so its supervisor can terminate detached children.

`e2e/lan-proxy.spec.ts` additionally runs the real development helper with independent temporary XDG roots on `8031`/`5193`. It uses an available private interface (loopback fallback on hosts without one), checks the shared app's event socket, same-origin JSON reads/writes, proxied events, Vite HMR connectivity, hostile-origin rejection, planner block creation/saving, and both services stopping. Private-IP HTTP runs assert an insecure browser context with no `crypto.randomUUID`; a unit regression exercises the real `getRandomValues` fallback even on secure loopback test hosts. On multi-interface machines, select `DEEPBLOCK_DEV_BIND` or set `DEEPBLOCK_DEV_LOCAL=1` for a local-only test run. A local browser on a private-IP URL validates proxy behavior, not remote firewall/DNS reachability; separately open the printed URL from your LAN client.

`e2e/core-trust.spec.ts` covers autosave/navigation and failed-note recovery, first-plan A and optional revision reasons, equal-start ripple preview/persistence, and historical outcome entry without schedule changes. Vitest additionally covers in-flight note ordering, date isolation, stale reads after acknowledgement, unload warnings after navigation, outcome-field omission, cancelled/overflow scheduling, and legacy empty evidence. Rust discovery/ownership tests use real HTTP listeners and OS file locks; they verify alternate-port reuse, incompatible/unreachable owners, deadlines, and owner-checked cleanup. Desktop unit tests additionally require matching embedded ownership/endpoint and reject exhausted candidate ports. CLI subprocess tests additionally pause a real owner to verify stop works without health, and reject stale PID files pointing at disposable test processes. These do not establish native GUI or signed-package behavior.

`src/lib/api-proxy.test.ts` guards valid same-origin WebSocket URL construction. Helper tests cover development networking, version/lockfile agreement, dependency notices, package naming and inventory, architecture checks, and Cargo lockfile forwarding. APT tests exercise bounded acquisition and cache behavior; native harness tests cover prebuilt binaries and bounded cleanup. QA workflow guards check manual dispatch, read-only permissions, SHA-pinned builds, Debian failure handling, and the checksummed candidate download.

```bash
mise run lint:scripts
mise run test:scripts
```

## Native desktop compatibility

```bash
pnpm -C apps/desktop/ui run test:e2e:tauri
```

- macOS defaults to the stable Playwright-backed shared UI path.
- Linux uses native Tauri/WebKit WebDriver checks under D-Bus and Xvfb.
- macOS native Safari automation remains opt-in with `DEEPBLOCK_NATIVE_TAURI_E2E=1` and host automation prerequisites.

By default, the native runner builds the real bundled-frontend runtime with the pinned Tauri CLI (`--debug --no-bundle`), rather than expecting an unstarted Vite server. Set `DEEPBLOCK_TAURI_E2E_APP` to an existing executable's absolute path to skip both frontend and Rust builds; release CI tests its already-built release binary this way. Invalid paths fail before building. Linux's default driver is `/usr/bin/WebKitWebDriver`; override with `DEEPBLOCK_NATIVE_DRIVER` if needed.

Body assertions tolerate CSS text casing. WebDriver requests have ten-second deadlines and no automatic retries; session deletion is best effort for three seconds, followed by process-group termination and forced cleanup. The runtime subprocess has a four-minute ceiling; release CI additionally bounds the entire native step to five minutes. These limits do not skip assertions or turn test failures into success. Polling logs are quiet, with the last body text included on assertion timeout.

## Personal QA across machines

Use the same candidate SHA on the machines where you use DeepBlock daily. Keep development checkouts separate from that baseline; use [a separate data root and a distinct backend port](features/storage-portability.md) for development and destructive tests. A package version alone does not identify a candidate.

- Before switching builds, finish or export any unsaved drafts and save a [portable ZIP](features/storage-portability.md) outside the app's data directory. Practice recovery with a disposable copy first. Move data between machines with explicit export/import; avoid syncing the live SQLite directory or editing diverged copies as if they merge automatically.
- For two to four weeks, plan a normal day, revise after an interruption, and see what Compare or Review tells you. Include days with ActivityWatch off. Note planning time, interrupted saves, missing drafts, and whether the review changed a decision the next day.
- Record the build SHA or run ID, OS, and steps for each issue. Keep the log local if it contains real plans or notes; report only sanitized examples. Use a fresh candidate for a specific fix or when ready to move the baseline, rather than packaging every commit.

## Packaging validation

Local macOS:

```bash
mise run build:tools
mise run build:desktop:bundle
mise run release:collect
```

This checks architecture and bundle signatures, not Apple notarization unless production credentials/mode are configured. Native packaged-app interaction is separate from browser coverage.

Debian builds/tests run on Debian or GitHub, not as part of macOS quality gates. The release pipeline builds Debian 12 amd64 packages and installs them in clean Debian 12/13 containers. The disposable `scripts/debian-smoke.sh` tests:

- CLI/server installation without WebKit and working API/CLI mutations;
- desktop/headless package coexistence and desktop process survival under Xvfb;
- same-version reinstall and purge;
- hashes of persistent plan/config/note/state fixtures surviving those operations (operational runtime metadata excluded).

The smoke fixture explicitly owns every XDG directory level as its unprivileged user. The desktop survival check requires fifteen seconds of runtime, then sends TERM with a two-second forced-KILL deadline. A kill before the survival interval fails the check. This establishes library loading/process startup, not GUI correctness. The separate native WebKit test exercises the compiled release desktop without rebuilding. Reinstall is not older-version upgrade coverage. Use a retained older package and disposable storage to test an actual upgrade.

### Replay installation without another release build

Download the retained `packages-x86_64-unknown-linux-gnu` artifact from the selected run, then test the reviewed smoke script against those exact packages. Do not rebuild macOS/Linux just to diagnose an installation-fixture change:

```bash
RUN=36928943174 # Replace with the intended candidate run ID.
gh run download "$RUN" -n packages-x86_64-unknown-linux-gnu -D dist/install-replay

docker run --rm --platform linux/amd64 \
  --mount "type=bind,source=$PWD/dist/install-replay,target=/assets,readonly" \
  --mount "type=bind,source=$PWD/scripts/debian-smoke.sh,target=/smoke.sh,readonly" \
  --mount "type=bind,source=$PWD/scripts/ci-apt.sh,target=/ci-apt.sh,readonly" \
  --env DEBIAN_FRONTEND=noninteractive \
  debian:12-slim@sha256:3783cc01769c7b2b1b83a5c5ad96c815348e28ed7da68e2e3687004faa906251 \
  bash -e -c 'bash /ci-apt.sh configure && exec bash /smoke.sh'
```

Repeat with the Debian 13 image pinned in `release.yml`. Check the artifact's source SHA in GitHub before using it; diagnostic replay does not make old packages evidence for a newer commit. On Apple Silicon this requires Docker AMD64 emulation and may expose emulator-specific failures.

[`act`](https://nektosact.com/) can run a small local replay workflow containing only these Linux installation steps. Use a pinned mise-managed CLI (`mise exec act@0.2.89 -- act ...`), `--container-architecture linux/amd64`, read-only package/script mounts in `container.options`, and an independent local deadline. In act 0.2.89, a job's `container` object takes precedence over CLI `--container-options`, so put mounts in that object's options. Download retained artifacts with `gh` first: act's documented artifact emulation does not support cross-run downloads, and our artifact action versions are beyond the documented v3/v4 support. Act ignores job permissions, deployment environments, concurrency and job timeouts; it cannot certify the GitHub workflow or macOS signing. Direct Docker replay is the simpler equivalent for this smoke script. See [act limitations](https://nektosact.com/not_supported.html) and [artifact support](https://nektosact.com/usage/#action-artifacts).

## CI and release gates

All test jobs run on GitHub-hosted `ubuntu-26.04` runners so public pull requests do not execute untrusted code on a self-hosted machine.

`.github/workflows/test.yml` runs on main pushes, PRs, and manual dispatch. Pushes and PRs changing only `docs/**`, root `README.md`, or root `AGENTS.md` skip the workflow; mixed documentation/code changes and manual dispatch still run all jobs.

Path-filtered workflows leave required checks pending. Before enabling required status checks for this workflow, switch to job-level skipping so docs-only PRs can still merge.

Jobs:

- **Workflow lint:** actionlint + locked ShellCheck; zizmor remains local/hook-only.
- **Rust lint:** fmt and clippy.
- **Rust tests:** locked workspace and doc tests.
- **Desktop UI:** lint, typecheck, unit and browser tests, frontend build, helper lint/tests, and license and version checks.

`.github/workflows/release.yml` runs only on manual dispatch. It tests the selected commit, builds macOS ARM64 and Debian amd64 packages, runs native Linux and Debian 12/13 installation checks, and uploads a checksummed `release-candidate` Actions artifact. It does not publish a release. See [QA builds](releases.md).

## Existing regression coverage

- `apps/server/tests/review_regressions.rs`: foreign origins/hosts, failed-save history recovery, concurrent writes, stale batches, nullable fields, canonical inputs, change logs, audit isolation. It shares the JSON request helper in `tests/common/mod.rs` with `api_smoke.rs`; header/CORS/WebSocket checks retain explicit requests.
- Rust unit regressions also preserve config defaults for omitted/partial TOML sections and CLI JSON decoding/HTTP errors.
- `apps/server/tests/development_origins.rs`: configured development origins across HTTP/CORS/WebSocket, production defaults, hostile origins/Hosts.
- `apps/server/tests/runtime_ownership.rs`: duplicate writers, crash lock release, runtime-metadata ownership.
- `apps/server/tests/ws_keepalive.rs`: responsive peers survive; silent peers time out.
- Planner unit/browser regression suites: conflicts, retained drafts, explicit rebase, commit freezes, cross-date completion during browser-history navigation, late/live calendar settings, HTTP-compatible draft identifiers, nested JSON draft isolation, shared block-field persistence/payloads, and native 12/24-hour clock labels at midnight/noon.
- macOS distribution unit tests: preserve regular files and unrelated/dangling symlinks.

Prefer focused Rust tests for server/CLI rules, Node tests for helper decisions, and Playwright for shared UI behavior. Use native runtime checks when behavior depends on Tauri rather than the browser app.

## Data portability validation

See [Data management UI](features/data-management-ui.md) for the bundle and live
replacement contract. `bundle_portability.rs`, replacement unit tests and the
real CLI `storage_bundle.rs` fixture cover preservation and failure recovery.
`data-portability.spec.ts` exercises the shared Settings workflow with a fresh
backend rooted under `apps/desktop/ui/.playwright-data`, port 8010 and server
reuse disabled. Restore tests must never target a personal data root.

Playwright request fixtures acquire the current dataset generation; generation
changes during restore tests are deliberately checked against stale clients.
Native open/save dialogs require a separate supported-platform smoke check:
cancel import/save, export ZIP, select it for preview, confirm replacement,
reload, download recovery and restore it. Perform this only with disposable XDG
roots and the matching backend. Native WebDriver remains opt-in.
