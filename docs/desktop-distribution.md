# Desktop distribution

Tauri owns desktop packaging. Project helpers stage target-matched resources and collect downloads. GitHub Actions builds and packages QA artifacts without publishing a release. See [QA builds](releases.md) for downloads and [Linux development](linux-development.md) for Debian installation.

## Build commands

From the repository root:

```bash
mise run build:desktop:bundle  # local macOS .app + .dmg, ad-hoc by default
# On the Debian build machine:
mise run build:debian
```

The pinned pnpm Tauri CLI runs the shared frontend build and `prepare:bundle` hook. `scripts/build.ts` resolves Cargo's target directory and explicit `DEEPBLOCK_BUILD_TARGET`/`CARGO_BUILD_TARGET`, including target triples. Staging preserves the tracked placeholder and clears previous generated resources, preventing stale macOS tools from leaking into Linux bundles. GUI builds embed the Rust backend and built frontend; they do not need a Vite server when installed.

Routine push and PR CI tests the source without packaging. Manually run the **Release** workflow to build macOS ARM64 and Debian amd64 QA artifacts for a selected commit.

## macOS bundle resources

The app stages the release `deepb` CLI under `resources/bin/`. ActivityWatch is bring-your-own by default; build machines do not silently harvest `/Applications/ActivityWatch.app`.

Optional macOS bundling requires:

- `DEEPBLOCK_BUNDLE_AW=1`
- `DEEPBLOCK_AW_SERVER_BIN` and `DEEPBLOCK_AW_SERVER_SHA256`
- `DEEPBLOCK_AW_WATCHER_WINDOW_BIN` and `DEEPBLOCK_AW_WATCHER_WINDOW_SHA256`
- `DEEPBLOCK_AW_WATCHER_AFK_BIN` and `DEEPBLOCK_AW_WATCHER_AFK_SHA256`
- `DEEPBLOCK_AW_LICENSES`, a file containing the relevant third-party license material

Supply self-contained executables and lowercase SHA-256 values from your reviewed inputs. Staging checks checksums and the target Mach-O architecture with `lipo`; universal binaries may include that architecture. Copying a launcher without its dependent resources is insufficient. Independently test optional custom bundles and their licensing/signing requirements. Standard release jobs do not include ActivityWatch inputs, and non-macOS staging rejects bundled ActivityWatch management.

For signing, `APPLE_SIGNING_IDENTITY` selects the identity passed to Tauri; absent an identity, the bundle helper uses `-` for ad-hoc signing. GitHub QA builds use ad-hoc signing and no production credentials. For a local Developer ID build, configure the signing and notarization credentials required by [Tauri](https://v2.tauri.app/distribute/sign/macos/); `DEEPBLOCK_SIGNING=notarized` enables additional Gatekeeper and stapled-ticket checks during collection. Ad-hoc builds have Tauri's expected skipped-notarization warning. Standalone CLI/server archives are signed but are not separately notarized installers.

## Runtime behavior on macOS

On launch, the app attempts to create a user-level CLI shim at `~/.local/bin/deepb` when a bundled CLI exists. Dragging an app into `/Applications` only copies files; launching it or using **Settings → Bundled desktop tools → Install bundled deepb** creates the shim.

Existing entries, including unrelated/dangling symlinks, are preserved. A matching shim is left unchanged. Review/remove an old shim yourself if its target moved; DeepBlock does not infer ownership. Add `~/.local/bin` to PATH when the Settings hint requests it.

ActivityWatch behavior, when enabled for the default local `localhost:5600` URL:

1. Keep an already reachable server.
2. Prefer an installed `ActivityWatch.app`.
3. Fall back to explicitly bundled server/watchers if present.

**Launch bundled fallback** in Settings can request the bundled fallback when no local server is reachable. Automatic bundled management is macOS-only and limited to the default local endpoint; custom/remote setups retain their own lifecycle.

Closing the main macOS window hides it while the menu-bar app remains running. The tray menu provides **Show DeepBlock**, **Hide DeepBlock**, and **Quit DeepBlock**; clicking the icon reopens the window.

## Desktop backend selection

The shell resolves its API target in this order:

1. Explicit `DEEPBLOCK_SERVER_URL`.
2. Healthy recorded storage owner, including alternate ports.
3. Configured host/port if DeepBlock health succeeds.
4. Standard `127.0.0.1:8000` if DeepBlock health succeeds.
5. An embedded loopback backend on a free port from `5605` through `5609`, only for unowned storage.

CLI and desktop use the same discovery helper. `/health` must identify `service: "deepblock"` with `status: "ok"`; older backends without that identifier need restarting after upgrade. A held lock with unavailable/incompatible metadata blocks automatic replacement. Exhausted embedded ports fail startup rather than falling back to an occupied port. The frontend loads only after health succeeds; embedded mode additionally requires the current process's matching runtime record and storage ownership. Cleanup preserves another owner's records.

`deepb stop` can signal a recorded local owner even when its health endpoint is unresponsive; it refuses unlocked storage and mismatched PID/runtime records. It requests shutdown, not acknowledgement. See [Storage and request safety](storage-and-request-safety.md).

## Debian roles

`deepblock-desktop` contains the desktop executable, frontend, desktop entry, icons, documentation/license, and GTK/WebKit dependencies. It embeds the backend; it does not require a separate server package or install bundled macOS CLI/ActivityWatch tools.

`deepblock-cli` and `deepblock-server` are independent headless packages. They derive shared-library requirements with `dpkg-shlibdeps`, include CA certificates, and can coexist with the desktop. Installation does not start a system service or alter user planning data.

Tauri builds the desktop `.deb`; a narrow adapter changes its control identity to `deepblock-desktop` and normalizes Debian prerelease ordering. Builds use a Debian 12 baseline, with clean Debian 12/13 installation checks configured in Actions. Execution on those platforms remains required before claiming support; a macOS build cannot validate it.
