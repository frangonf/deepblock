# LAN development, Debian packaging, and GitHub releases

## Status and scope

This records the original design and implementation plan. For current workflows and platform support, see [Linux development](../linux-development.md) and [QA builds](../releases.md).

KISS refinements after review:

- Tauri owns desktop packaging; GitHub Actions owns the matrix/sequencing; `gh release` owns draft creation/uploads. Custom TypeScript is limited to project-specific checks, version edits, staging, and Debian adapters.
- Share existing mise quality tasks rather than introduce a release manager or duplicate command recipes. Local reusable-workflow shorthand was avoided because the locked validators disagree on the newer self-repository syntax.
- Generate SHA-256 checksums without a bespoke machine-readable release manifest or custom provenance subsystem.
- Default macOS builds are ad-hoc candidates; production notarization is explicit. Draft retries cannot silently switch signing/prerelease metadata.
- Debian checks cover reinstall/removal and preserved fixtures, not upgrade compatibility or GUI correctness by mere process survival.
- Docker deployment redesign, build attestations/SBOMs, and broader platforms remain follow-ups.

Goals:

- Develop on a Linux box and use the shared browser UI from another machine without SSH port forwarding.
- Preserve the localhost-only default of standalone and embedded production backends.
- Set up Debian desktop and headless packages with clear ownership and dependencies.
- Ship versioned, complete, reviewable GitHub Releases instead of leaving bundles inside ephemeral runners.
- Keep one product version and the existing file-backed, single-writer data model.

## Initial findings from the renewed audit

- Vite explicitly binds to `127.0.0.1`; its existing `/api` proxy targets `127.0.0.1:8000`.
- Rust rejects foreign Origins and non-loopback Host headers. WebSockets separately enforce the origin policy. Binding Vite to the LAN is insufficient without coordinated origin configuration.
- The default development backend port is 8000. The production mise task overrides it to 8005; proxy configuration must not assume all workflows share one port.
- Playwright currently bypasses `/api` using explicit HTTP and WebSocket URLs. It does not cover the proposed LAN proxy path.
- Linux native E2E already invokes Xvfb. Its default native driver path is incorrect for Debian: the package installs `/usr/bin/WebKitWebDriver`.
- Native E2E also needs its startup path audited: building UI assets plus a plain debug Cargo build must not leave the test depending on an unstarted Vite server.
- Resource staging assumes `target/release`, without accounting for target triples or custom Cargo target directories.
- Tauri CLI installation uses `^2`, so the CLI itself is not reproducibly pinned.
- macOS CI builds bundles only on manual dispatch, without uploading artifacts or creating releases.
- The current stricter offline zizmor audit reports two informational Rust-toolchain-action findings; actionlint passes. New workflows should not require additional suppressions.

## Architecture decisions

### Development networking

Expose Vite, not the raw Rust backend. Browser HTTP and WebSocket traffic stays on the page's origin and reaches Rust through `/api`.

Make `mise run dev` start both services with coordinated settings. LAN access should work by default when a private interface is available:

- Discover/select a private interface and bind the frontend there, rather than indiscriminately exposing every interface on a public server.
- Print the actual browser URL. Allow explicit interface/hostname overrides and a localhost-only mode.
- Require an explicit selection when automatic discovery is ambiguous; fall back to loopback when there is no private interface.
- Derive an exact set of development origins from the selected address and configured hostnames. Share that set with Rust.
- Keep `dev:web` and `dev:server` usable separately with the same configuration rules.
- Preserve localhost-only Tauri development and test fixtures; changing the browser default must not break Tauri's `devUrl`.
- Use strict frontend ports and a configurable loopback proxy target. Do not silently select a new frontend port while retaining the old origin allowlist.

Origin configuration must be validated and scoped to development: reject wildcard/null origins and malformed values. Production launches without development configuration keep their existing boundary. All HTTP, preflight, and WebSocket checks must use the same policy.

Do not strip browser Origin headers, enable arbitrary CORS, set `allowedHosts: true`, or enable `rewriteWsOrigin` as a workaround. Keep upstream Host rewriting for the loopback proxy target.

This is trusted-network development, not a multi-user deployment. Bind selection and host/origin checks are not authentication. Document firewall/VPN requirements and that anyone able to reach the development service may access its data. ActivityWatch on the development box does not automatically observe the user's laptop.

### Packaging and supported targets

Initial release targets:

- Debian amd64, built on Debian 12 and installation-tested on Debian 12 and 13.
- macOS Apple Silicon and Intel, with architecture-specific resources and deployment settings.

Set up three Debian packages with distinct file ownership:

- `deepblock-desktop`: Tauri application, desktop entry, icons, and runtime GUI dependencies.
- `deepblock-cli`: `/usr/bin/deepb`, without GUI dependencies.
- `deepblock-server`: standalone backend, without GUI dependencies.

The desktop already embeds the backend; it must not require or auto-start a second system server. Installing packages must not change/delete user XDG data or silently enable a service. A documented opt-in user service is preferable to a machine-wide service sharing a different user's storage.

Keep ActivityWatch bring-your-own on Debian. For macOS release builds, use bring-your-own by default too; optional bundled binaries must come from explicit, verified, architecture-matched inputs with licensing information, not whichever application happens to be installed on the runner.

Debian desktop packaging should select `deb` explicitly rather than building every Linux bundle format. ARM64 Linux, RPM, AppImage, APT hosting, Windows, automatic updates, and public hosted deployment are follow-ups, not advertised support in this change.

### Versioning and release preparation

Keep `[workspace.package].version` as the canonical product version. All inherited crate versions, the three local Cargo.lock entries, UI package version, Tauri version, release tag, and package metadata must agree.

Add a tested release-preparation helper exposed through mise. It should:

- Validate stable and prerelease SemVer inputs and refuse accidental downgrades/reuse.
- Update product version fields and only the relevant local lockfile entries, without upgrading dependencies.
- Prepare the versioned changelog/release notes while retaining historical entries.
- Produce reviewable changes for a normal release PR; do not commit, push, or publish implicitly.
- Support dry-run/check mode and fail on unexpected manifest layouts.

Use Conventional Commits and categorized GitHub-generated release notes, with a small `.github/release.yml` configuration. Human review adds migration notes, supported systems, installation instructions, known limitations, and signing status.

Release Please was researched but is not the initial dependency: its current Rust updater expects a root package and writes explicit member versions, which does not fit this virtual workspace with inherited versions. The default GITHUB_TOKEN also does not trigger CI on bot-created PRs/tags. A future bot integration must prove workspace-preserving updates and use a deliberately configured GitHub App, rather than silently bypassing required checks or adding a broad PAT.

### Release pipeline

Separate routine CI from packaging and publishing. Share quality gates where practical, while retaining their existing named checks.

Lifecycle:

1. Prepare and review a version/changelog PR.
2. Merge after quality gates pass.
3. A maintainer pushes an annotated `vX.Y.Z` or prerelease tag pointing to the reviewed commit.
4. A dedicated release workflow validates tag/version agreement and source ancestry, then runs quality gates against that exact commit.
5. Build the supported platform matrix, smoke-test packages, and upload candidate workflow artifacts.
6. Verify the complete expected asset set and generate SHA256 checksums.
7. Create/update a GitHub draft release and attach every asset.
8. A maintainer reviews and publishes the complete draft. Immutable releases should then lock the assets and tag.

Manual dispatch supports candidate builds without publishing and retrying a release from an existing validated tag. Dispatch must not create an arbitrary production release from a moving branch.

Release retries may repair a draft, but must refuse to replace assets on an already published release. Failures must leave no partially published release. Serialize releases per version and do not cancel publishing midway because a new main commit arrived.

Use the built-in GITHUB_TOKEN only in the publishing job. Do not assume tags created by that token trigger another workflow. Pull requests and ordinary pushes must never receive signing/publishing credentials.

Security requirements:

- SHA-pinned Actions, commented job-level permissions, checkout without persisted credentials, timeouts, validated inputs passed through environment variables rather than shell interpolation.
- Separate build/test jobs from the minimal publisher; verify artifact names, checksums, version, architecture, and source SHA before release attachment.
- Avoid consuming untrusted PR caches in release builds.
- Keep local zizmor and actionlint validation, including the stricter no-ignore audit.
- Keep build attestations optional where platform support varies.
- Clearly distinguish checksum integrity, GitHub immutable-release attestations, and actual build provenance; they are not interchangeable.

### macOS signing

Set up a distinct ad-hoc candidate path and a production Developer ID signing/notarization path. Never silently label ad-hoc artifacts as notarized releases.

Validate credentials early when production signing is selected; verify final signatures/notarization and architecture-matched nested executables. Missing credentials should give actionable setup guidance, not silently produce a supposedly signed release.

Actual Developer ID certificates, Apple API credentials, protected GitHub environments, and repository rules are external configuration. Document them without creating secrets or changing account settings automatically.

### Docker boundary (deferred follow-up)

Do not make the unauthenticated API publicly reachable merely to make published Docker ports work. Keep the container's role explicit: a localhost backend, with a documented Linux host-network option and persistent user-owned data. Remove or explain misleading port exposure guidance; add non-root execution and persistence guidance where needed. A public reverse-proxy/authentication deployment requires a separate security design.

## Implementation sequence

1. **Tests and network policy** — configurable exact development origins, shared HTTP/CORS/WebSocket validation, unchanged production defaults.
2. **Development orchestration** — private-interface selection, backend/frontend startup and cleanup, shared ports/origins, proxy-path browser tests, localhost Tauri/test mode.
3. **Reproducible build tooling** — exact Tauri CLI pin, locked installs/builds, target-aware staging, explicit resource inputs, version checks.
4. **Debian setup** — bootstrap dependencies, packaging metadata/scripts, correct native driver discovery, reliable native test startup, install/smoke-test jobs on Debian 12/13.
5. **Release preparation and workflow** — version helper tests, release-note categories, platform builds, checksums, candidate artifact uploads, idempotent draft publication, signing configuration.
6. **Documentation and final review** — update AGENTS.md, README, configuration, shared-runtime, storage-safety, testing, distribution docs; add Linux development and release runbooks.

Keep these as reviewable change groups rather than a single undifferentiated rewrite.

## Test list and acceptance gates

Write and observe failing tests before new runtime/helper behavior is implemented.

Networking:

- Existing local browser, CLI, and Tauri requests continue to work without development settings.
- An explicitly configured LAN origin can read, mutate, pass preflight, and connect to the event socket through Vite.
- Foreign origins, suffix lookalikes, unexpected ports, null/wildcard origins, and non-loopback upstream Host headers remain rejected.
- Missing WebSocket Origin remains rejected.
- Default LAN selection, no private interface, multiple interfaces, hostname override, and localhost-only mode behave deterministically.
- Read, mutate, live refresh, and HMR use the proxy path without explicit VITE_API_BASE/VITE_WS_URL overrides.
- Child processes are cleaned up on interruption/startup failure and existing storage ownership is not bypassed.

Build/release helpers:

- Versions agree across product manifests and inherited crate metadata.
- Version updates preserve dependency versions, inheritance, and historical changelog entries.
- Target directory/triple/resource selection is correct; incompatible/missing optional resources cannot silently enter a release.
- Invalid or mismatched tags, missing assets, wrong architecture/source SHA, failed signatures, and attempts to overwrite published assets stop publication.
- Draft retries, stable/prerelease metadata, and candidate-only builds behave as documented.

Validate locally on macOS:

- Rust fmt, clippy, workspace tests, and supported builds.
- UI lint, typecheck, Vitest, Playwright, and web build.
- Script/helper tests, version/config checks, actionlint, and zizmor.
- macOS bundle validation when the pinned CLI/dependencies are available; no Debian cross-compilation requirement.

Set up, but do not claim locally validated:

- Debian package compilation and installation, dependency correctness, executable permissions, desktop startup under Xvfb, headless server/CLI operation, coexistence, reinstall/removal behavior, and user-data preservation. Upgrade coverage requires an older package fixture.
- Signed/notarized builds until the required Apple credentials are supplied.
- End-to-end GitHub release publication until a maintainer explicitly runs the candidate/release workflow.

## GitHub activation checklist

These settings require maintainer review after the code lands:

- Enable the main ruleset with required named checks and release-PR review.
- Protect release tags and set up a release environment/approval policy where supported by the account plan.
- Enable immutable releases before publishing the first complete draft.
- Configure Apple credentials if production notarized macOS releases are required.
- Enable build attestations only if supported.
- Run candidate builds, inspect Debian results, then prepare the first versioned release. Do not invent or publish an initial version as part of setup.

## Sources consulted

- [Vite server options](https://vite.dev/config/server-options): binding, strict ports, allowed hosts, proxy and WebSocket origin warnings.
- [Tauri Debian distribution](https://v2.tauri.app/distribute/debian/): oldest-supported-system builds, runtime dependencies, package files.
- [Tauri macOS signing](https://v2.tauri.app/distribute/sign/macos/): Developer ID, notarization, ad-hoc limitations.
- [GitHub release management](https://docs.github.com/en/repositories/releasing-projects-on-github/managing-releases-in-a-repository).
- [GitHub immutable releases](https://docs.github.com/en/code-security/concepts/supply-chain-security/immutable-releases): draft, attach all assets, publish.
- [GitHub build attestations](https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations/use-artifact-attestations): private-repository plan restrictions.
- [Release Please Action](https://github.com/googleapis/release-please-action): manifest configuration, permissions, GITHUB_TOKEN event restrictions.
- [Release Please customization](https://github.com/googleapis/release-please/blob/main/docs/customizing.md) and current Rust strategy/updater source: workspace/versioning fit.
