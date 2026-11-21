#!/usr/bin/env bash
# Run in a disposable Debian 12/13 container with release packages at /assets.
set -euo pipefail
apt-get update
apt-get install -y --no-install-recommends ca-certificates curl file
shopt -s nullglob
cli=(/assets/deepblock-cli_*.deb)
server=(/assets/deepblock-server_*.deb)
desktop=(/assets/deepblock-desktop_*.deb)
[[ "${#cli[@]}" -eq 1 && "${#server[@]}" -eq 1 && "${#desktop[@]}" -eq 1 ]]
apt-get install -y --no-install-recommends "${cli[0]}" "${server[0]}"
# Prove the headless packages don't drag in the desktop's libraries.
if dpkg-query -W -f='${Status}' libwebkit2gtk-4.1-0 2>/dev/null | grep -q 'install ok installed'; then
  echo 'Headless packages unexpectedly require WebKit' >&2
  exit 1
fi
useradd --create-home smoke
export XDG_DATA_HOME=/home/smoke/data XDG_CONFIG_HOME=/home/smoke/config XDG_STATE_HOME=/home/smoke/state
# `install -d` only applies -o/-g to the final listed directories, so every
# parent level is listed explicitly: the unprivileged server creates its data
# subdirectories beneath XDG_DATA_HOME/deepblock during startup.
install -d -o smoke -g smoke \
  "$XDG_DATA_HOME" "$XDG_DATA_HOME/deepblock" "$XDG_DATA_HOME/deepblock/notes" \
  "$XDG_CONFIG_HOME" "$XDG_CONFIG_HOME/deepblock" \
  "$XDG_STATE_HOME" "$XDG_STATE_HOME/deepblock"
printf '[activitywatch]\nenabled = false\n' | runuser -u smoke -- tee "$XDG_CONFIG_HOME/deepblock/config.toml" >/dev/null
# Managed notes are keyed by calendar date. Use a fixed date so this
# preservation fixture is independent of the day the smoke test runs.
printf 'Keep this note\n' | runuser -u smoke -- tee "$XDG_DATA_HOME/deepblock/notes/2000-01-01.md" >/dev/null
printf 'Keep this state\n' | runuser -u smoke -- tee "$XDG_STATE_HOME/deepblock/keep.txt" >/dev/null
runuser -u smoke -- deepblock-server &
server_pid=$!
trap 'kill "$server_pid" 2>/dev/null || true; wait "$server_pid" 2>/dev/null || true' EXIT
ready=false
for _ in {1..100}; do
  if curl --fail --silent http://127.0.0.1:8000/health >/dev/null; then ready=true; break; fi
  sleep 0.1
done
[[ "$ready" == true ]]
runuser -u smoke -- deepb --version
runuser -u smoke -- deepb add 'Preserve me' --start 09:00 --duration 30
runuser -u smoke -- deepb list
kill "$server_pid"
wait "$server_pid" || true
trap - EXIT
# Planning data is persisted in SQLite, not in per-day JSON files.
[[ -s "$XDG_DATA_HOME/deepblock/planning.sqlite3" ]]
find "$XDG_DATA_HOME" "$XDG_CONFIG_HOME" "$XDG_STATE_HOME" -type f ! -name server-runtime.json ! -name server.lock -exec sha256sum {} \; | sort > /tmp/user-data-before
apt-get install -y --no-install-recommends "${desktop[0]}" xvfb xauth dbus-x11 fonts-dejavu-core libgl1-mesa-dri
# A packaged desktop must remain alive, not immediately fail to load libraries.
desktop_started=$SECONDS
set +e
runuser -u smoke -- dbus-run-session -- xvfb-run -a timeout --signal=TERM --kill-after=2s 15s deepblock-desktop
status=$?
set -e
# 137 is expected when the application handles TERM without closing its GUI.
# An early crash/kill must still fail; prove survival through the full interval.
[[ ( "$status" -eq 124 || "$status" -eq 137 ) && "$((SECONDS - desktop_started))" -ge 15 ]] || { echo "Desktop exited unexpectedly: $status" >&2; exit 1; }
apt-get install -y --reinstall "${cli[0]}" "${server[0]}" "${desktop[0]}"
apt-get purge -y deepblock-cli deepblock-server deepblock-desktop
sha256sum --check /tmp/user-data-before
printf 'Debian package coexistence, reinstall/removal, and user-data preservation passed.\n'
