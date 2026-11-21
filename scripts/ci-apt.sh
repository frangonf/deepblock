#!/usr/bin/env bash
# Disposable CI runners/images only; local development uses bootstrap-debian.sh.
set -euo pipefail
case "${1:-}" in
  configure)
    # An optional filesystem root also supports configuring a staged image.
    root="${2:-/}"
    run_privileged() {
      if [[ "$root" == / && "$EUID" -ne 0 ]]; then sudo "$@"; else "$@"; fi
    }
    run_privileged mkdir -p "$root/etc/apt/apt.conf.d"
    run_privileged tee "$root/etc/apt/apt.conf.d/99deepblock-ci" >/dev/null <<'EOF'
Acquire::Retries "3";
Acquire::http::Timeout "30";
Acquire::https::Timeout "30";
APT::Update::Error-Mode "any";
APT::Keep-Downloaded-Packages "true";
Binary::apt::APT::Keep-Downloaded-Packages "true";
EOF
    # Debian's container cleanup hook otherwise deletes archives before caching.
    run_privileged rm -f "$root/etc/apt/apt.conf.d/docker-clean"
    # GitHub's Ubuntu runner uses mirror+file with Azure first. Avoid that
    # repeatedly stalling mirror; Debian's normal sources are not rewritten.
    if [[ -f "$root/etc/apt/apt-mirrors.txt" ]]; then
      printf 'https://archive.ubuntu.com/ubuntu/\tpriority:1\nhttps://security.ubuntu.com/ubuntu/\tpriority:2\n' |
        run_privileged tee "$root/etc/apt/apt-mirrors.txt" >/dev/null
    fi
    ;;
  install)
    profile="${2:-}"
    cache="${3:?Missing package cache directory}"
    export DEBIAN_FRONTEND=noninteractive
    case "$profile" in
      desktop|debian|chromium) ;;
      *) echo "Unknown APT profile: $profile" >&2; exit 1 ;;
    esac
    run_privileged() {
      if [[ "$EUID" -ne 0 ]]; then sudo "$@"; else "$@"; fi
    }
    shopt -s nullglob
    archives=("$cache"/*.deb)
    run_privileged mkdir -p /var/cache/apt/archives
    if [[ "${#archives[@]}" -gt 0 ]]; then
      run_privileged cp -- "${archives[@]}" /var/cache/apt/archives/
    fi
    case "$profile" in
      desktop)
        run_privileged apt-get update
        # Names, not local .deb paths: APT checks cached archives against signed
        # repository metadata. Do not cache installed files or compiler outputs.
        run_privileged apt-get install -y --no-install-recommends \
          libglib2.0-dev libgtk-3-dev libwebkit2gtk-4.1-dev libxdo-dev libssl-dev \
          libayatana-appindicator3-dev librsvg2-dev patchelf
        ;;
      debian) bash "$(dirname "$0")/bootstrap-debian.sh" ;;
      chromium) pnpm -C apps/desktop/ui exec playwright install-deps chromium ;;
    esac
    mkdir -p "$cache"
    archives=(/var/cache/apt/archives/*.deb)
    if [[ "${#archives[@]}" -gt 0 ]]; then
      run_privileged cp -- "${archives[@]}" "$cache/"
      run_privileged chown -R "$(id -u):$(id -g)" "$cache"
    fi
    ;;
  *) echo 'Usage: ci-apt.sh configure [filesystem-root] | install desktop|debian|chromium CACHE' >&2; exit 1 ;;
esac
