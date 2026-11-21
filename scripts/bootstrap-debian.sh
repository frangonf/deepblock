#!/usr/bin/env bash
# Development/build dependencies, not package runtime dependencies.
set -euo pipefail
if [[ "${EUID}" -ne 0 ]]; then
  exec sudo bash "$0" "$@"
fi
apt-get update
apt-get install -y --no-install-recommends \
  build-essential git curl wget file ca-certificates xz-utils pkg-config libatomic1 \
  libglib2.0-dev libgtk-3-dev libwebkit2gtk-4.1-dev libxdo-dev libssl-dev \
  libayatana-appindicator3-dev librsvg2-dev patchelf dpkg-dev \
  webkit2gtk-driver xvfb xauth dbus-x11 fonts-dejavu-core libgl1-mesa-dri
