# QA builds from GitHub Actions

The **Release** workflow builds installable candidates for personal testing. It runs only on manual dispatch, uses the application and tooling from the selected commit, and uploads Actions artifacts. It does not create a tag, draft, or GitHub Release. macOS candidates are ad-hoc signed and require Gatekeeper approval; this workflow uses no Apple signing credentials.

## Build and download a candidate

1. Push the branch you want to test. In GitHub, open **Actions → Release → Run workflow**, and select that branch. Use `main` for a shared baseline. No tag or version bump is needed.
2. Wait for a successful run. Record its source commit and run ID. Package filenames can remain the same across QA builds.
3. Download **release-candidate** from the run's artifacts. GitHub Actions retains the complete candidate for 30 days, subject to the repository's retention limit. Access follows repository visibility: signed-in users with read access can download artifacts. Keep candidates in a private repository if they must remain private.

You can also use the authenticated GitHub CLI:

```bash
# From the repository, replace main with the branch you want to test.
gh workflow run release.yml --ref main

# Copy the run ID from the Release workflow's run page.
RUN=123456789
gh run view "$RUN" --json headSha,conclusion,url
gh run download "$RUN" --name release-candidate --dir "dist/qa/$RUN"
cd "dist/qa/$RUN"
case $(uname -s) in
  Darwin) shasum -a 256 --check SHA256SUMS ;;
  Linux) sha256sum --check SHA256SUMS ;;
esac
```

`SHA256SUMS` covers the seven files assembled from this run. It checks file integrity against the downloaded manifest; it is not an independent signature.

| Machine            | Candidate files                                                                                                                            |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Apple Silicon Mac  | `.dmg` or `.app.tar.gz` for the desktop app; `deepblock-tools_*_aarch64-apple-darwin.tar.gz` for standalone `deepb` and `deepblock-server` |
| Debian 12/13 amd64 | `deepblock-desktop_*.deb`, `deepblock-cli_*.deb`, and `deepblock-server_*.deb`; a standalone Linux tools archive is also available         |

See [Desktop distribution](desktop-distribution.md) and [Debian installation](linux-development.md) for platform details. For day-to-day testing across machines, see the [personal QA checklist](testing.md#personal-qa-across-machines). Only the combined candidate is gated on all checks. The individual `packages-*` artifacts are also available for diagnosis and do not establish that later checks passed.

## What the workflow checks

- Runs the Rust, UI, Node helper, version, and dependency license checks on the selected SHA.
- Builds ad-hoc macOS ARM64 bundles on a hosted macOS runner, then Debian 12 amd64 packages in a digest-pinned Debian container. Native WebKit tests reuse the compiled Linux desktop executable. Debian 12 and 13 clean installation smoke tests run before candidate assembly.
- Collects platform outputs, checks architectures and expected filenames, and writes the combined checksums. ActivityWatch is bring-your-own by default.

Routine CI and QA builds use `$/` to load the repository's `setup-apt` action from the workflow's commit. The action runs the APT scripts from the checkout. It caches downloaded archives, which APT verifies against signed package metadata. Only reviewed `main` jobs save the cache. Third-party actions remain SHA-pinned. QA builds do not restore compiler or tool caches. The lockfiles and pinned images constrain inputs; the package repository, hosted runner images, and build timestamps can still vary.

When a step fails, first run the relevant local quality check or [replay installation using retained packages](testing.md#replay-installation-without-another-release-build). A full candidate run is for end-to-end verification; avoid repeatedly dispatching it to diagnose one failing stage.

## Local packaging

On an Apple Silicon Mac:

```bash
mise run build:tools
mise run build:desktop:bundle
mise run release:collect
```

Local bundles also default to ad-hoc signing. The expected skipped-notarization warning does not establish notarization. Local notarized build configuration is documented in [Desktop distribution](desktop-distribution.md).
