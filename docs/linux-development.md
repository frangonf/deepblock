# Linux development and Debian packages

## Browser development on a server

Use Debian 12 or 13, an unprivileged development account, and a trusted LAN or VPN. Install [mise](https://mise.jdx.dev/installing-mise.html), then run from the repository root:

```bash
bash scripts/bootstrap-debian.sh  # apt prerequisites; uses sudo outside a root container
mise install --locked
mise run install
mise run dev
```

The bootstrap script installs compiler, GTK/WebKit, packaging, Xvfb, D-Bus, and native WebDriver prerequisites. It does not install Node or Rust; mise installs the locked toolchains. Repository-owned Node scripts run directly as TypeScript on Node 26, with separate typechecking and tests.

`dev` starts Rust on `127.0.0.1:8000` and Vite on a selected private address, for example `http://192.168.1.20:5173`. Open the printed URL from another machine. HTTP and event WebSockets use the same-origin `/api` proxy; Rust remains loopback-only. Vite also serves its HMR connection on that address.

Default selection uses a single eligible private IPv4 interface, falls back to loopback when none exists, and asks for an explicit choice when several exist. Common Docker/VPN interface names are excluded from automatic selection. Explicit binds must be assigned RFC1918, VPN/CGNAT, IPv6 ULA, or loopback addresses; wildcard/public binds are rejected.

```bash
DEEPBLOCK_DEV_BIND=192.168.1.20 mise run dev
DEEPBLOCK_DEV_BIND=100.64.0.20 mise run dev  # assigned VPN address
DEEPBLOCK_DEV_LOCAL=1 mise run dev          # localhost only
DEEPBLOCK_DEV_HOSTNAMES=devbox.lan mise run dev
DEEPBLOCK_DEV_PORT=5174 DEEPBLOCK_SERVER_PORT=8001 mise run dev
```

A hostname must resolve to the selected interface; this command does not configure DNS. The helper configures exact origins for the selected IP and named hosts, and clears inherited `VITE_API_BASE`/`VITE_WS_URL`. Avoid overrides in local Vite `.env` files when using this workflow.

Separate `mise run dev:server` and `mise run dev:web` terminals share this configuration. Give both the same overrides. `dev:web` does not start Rust. Occupied ports and existing storage ownership fail instead of being bypassed. Ctrl-C terminates the supervised children; running the helper under another supervisor requires forwarding SIGTERM/SIGINT and allowing cleanup.

> **Security:** Vite has no authentication. Reachable clients can read and change planning data. Restrict the frontend port to trusted clients with a firewall/VPN. This workflow is unsuitable for public hosting or a shared multi-user service. The backend origin policy and loopback Host check remain enabled; development origins require both `DEEPBLOCK_DEV_MODE=1` and `DEEPBLOCK_DEV_ORIGINS`.

Tauri development remains local: `mise run dev:desktop` binds its Vite instance to loopback. On a headless server, use the browser workflow instead.

## Debian artifacts

The release workflow builds on Debian 12 amd64 and configures clean-install tests on Debian 12 and 13. Treat that compatibility as provisional until those GitHub jobs have passed; macOS validation does not prove Debian installation/runtime behavior.

| Package             | Installs                                                | Runtime                                            |
| ------------------- | ------------------------------------------------------- | -------------------------------------------------- |
| `deepblock-desktop` | `deepblock-desktop`, application entry, icons, frontend | GTK/WebKit; embeds its own Rust backend            |
| `deepblock-cli`     | `deepb`                                                 | Headless client; needs a running DeepBlock backend |
| `deepblock-server`  | `deepblock-server`                                      | Headless loopback server                           |

The headless packages derive library dependencies with `dpkg-shlibdeps` and include CA certificates, without adding GTK/WebKit. Packages coexist, contain documentation/license files, and install no auto-start service. The desktop package neither requires nor launches the separately installed server executable. It can reuse an existing reachable backend; one-writer-per-storage-root rules still apply.

After downloading the three `.deb` files and verifying `SHA256SUMS`, install the roles you need:

```bash
sudo apt install ./deepblock-desktop_*_amd64.deb
# Or, for headless use:
sudo apt install ./deepblock-cli_*_amd64.deb ./deepblock-server_*_amd64.deb
deepblock-server
# In another terminal:
deepb list
```

Use `apt`, so dependencies are resolved. Data stays in the user's XDG roots. Package removal/reinstallation does not intentionally remove it. Back up those roots before replacing a production installation; testing a reinstall is distinct from testing an upgrade from an older version.

## Build and native checks on Debian

On the Debian build machine only:

```bash
mise run build:debian
pnpm -C apps/desktop/ui run test:e2e:tauri
```

The packaging task invokes Tauri for the desktop `.deb`, normalizes its role name and prerelease version ordering (`0.2.0-rc.1` becomes `0.2.0~rc.1`), then uses Debian tools for the two headless packages. Target-specific paths come from Cargo metadata; `DEEPBLOCK_BUILD_TARGET` and `CARGO_TARGET_DIR` are respected. Initial Linux artifacts support `x86_64-unknown-linux-gnu` only.

Native tests use `/usr/bin/WebKitWebDriver`, `tauri-driver`, D-Bus, and Xvfb. `DEEPBLOCK_NATIVE_DRIVER` overrides the WebDriver path. Keep sandboxing enabled for normal development and installed apps. The disposable root build container explicitly disables WebKit sandboxing for its native test only; installed-package tests run as an unprivileged user without that override.

`scripts/debian-smoke.sh` is for disposable containers, not your workstation: it installs, reinstalls, and purges packages. It checks headless dependencies, CLI/server behavior, package coexistence, persistent fixtures, and desktop process survival. Process survival alone is not a GUI interaction test; native WebDriver coverage is a separate job step.

See [Releases](releases.md), [Testing](testing.md), and [Storage and request safety](storage-and-request-safety.md).
