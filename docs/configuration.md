# Configuration

DeepBlock stores shared settings in `~/.config/deepblock/config.toml`.

The Rust server is the source of truth for these settings, and the Rust CLI plus Tauri desktop read the same file/API.

## Example

```toml
[server]
host = "127.0.0.1"
port = 8000

[client]
editor = "code"
default_revision_copy_mode = "all"

[client.revision]
strategy = "manual"
grace_minutes = 5

[client.display]
start_hour = 0
end_hour = 24
pixels_per_minute = 2
show_current_time_line = true
toast_duration_ms = 4000
time_format = "24h"

[client.blocks]
default_duration = 60
default_type = "shallow"
rounding_interval = 15
min_duration = 15
max_duration = 480

[activitywatch]
enabled = true
url = "http://localhost:5600"
launch_bundled_components = true

[notifications]
enabled = true
sound_enabled = false
notify_minutes_before = 5
notify_on_block_start = true
notify_on_block_end = true
urgency = "normal"

```

## Key sections

### `[server]`

| Key    | Default     | Notes                                            |
| ------ | ----------- | ------------------------------------------------ |
| `host` | `127.0.0.1` | Loopback IP address, such as `127.0.0.1` or `::1` |
| `port` | `8000`      | Rust server port                                 |

Non-loopback and wildcard bind addresses are rejected. To reach a backend running on another machine, keep it on loopback there and use an SSH tunnel.

### `[client]`

| Key                          | Default | Notes                         |
| ---------------------------- | ------- | ----------------------------- |
| `editor`                     | `null`  | Used by note workflows        |
| `default_revision_copy_mode` | `all`   | `all`, `from_now`, or `empty` |

### `[client.revision]`

| Key             | Default  |
| --------------- | -------- |
| `strategy`      | `manual` |
| `grace_minutes` | `5`      |

### `[client.display]`

Controls planner rendering in the desktop UI and other clients.

### `[client.blocks]`

Defaults for new blocks.

### `[activitywatch]`

| Key                         | Default                                             | Notes                                                                                                       |
| --------------------------- | --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `enabled`                   | `true`                                              | Turns the reality layer on/off                                                                              |
| `url`                       | `http://localhost:5600`                             | Local ActivityWatch server URL                                                                              |
| `launch_bundled_components` | `true`                                              | Lets the packaged macOS desktop app start bundled ActivityWatch binaries when it owns the default local URL |
| `category_mapping`          | Built-in block-type/category mapping                | Scoring categories for `focus`, `shallow`, `break`, and `urgent`; not categorization rules                  |
| `category_rules`            | Built-in Work, Communication, and Media regex rules | ActivityWatch category paths paired with regex rules                                                        |

Categorization and scoring are separate. For example, to classify development apps into a hierarchical category while scoring them as focus time:

```toml
[activitywatch.category_mapping]
focus = ["Work"]

[[activitywatch.category_rules]]
path = ["Work", "Development"]
regex = "Code|Xcode|iTerm"
ignore_case = true
```

Paths must be nonempty lists of category names. Rules use ActivityWatch's regex rule contract; DeepBlock does not import the ActivityWatch web UI's category settings. Omitting `category_rules` uses the built-in defaults; an explicit empty list disables categorization rules.

Each upstream request times out after five seconds, and audits have a thirty-second budget. Audits do not hold the plan writer lock while waiting for ActivityWatch.

DeepBlock now assumes a **bring-your-own ActivityWatch** setup:

1. Install and run the standard ActivityWatch desktop app (`aw-qt`) for your OS.
2. Let it auto-start `aw-server` and the default watchers.
3. Keep `url` pointed at that local server.

Helpful commands:

```bash
deepb aw status
deepb aw doctor
deepb check
deepb review
deepb config set --notifications-enabled true --notify-minutes-before 5 --notify-on-block-start true --notify-on-block-end true
```

- `deepb aw status` shows whether the configured ActivityWatch endpoint is reachable
- `deepb aw doctor` prints OS-specific setup guidance
- `deepb check` runs the audit and writes `reality` data onto completed blocks
- `deepb review` generates variance reports from the active revision: self-reported minutes supply duration/overrun findings; self-rated focus takes precedence over ActivityWatch category mix
- without `--server`, HTTP commands prefer a healthy recorded storage owner before probing the configured port or `127.0.0.1:8000`; an unavailable owner blocks fallback
- `deepb stop`, `deepb serve`, and `deepb aw` do not depend on DeepBlock HTTP discovery. Stop uses matching local PID/runtime records and storage ownership, not `--server`.

Both the browser UI and desktop app show an **ActivityWatch** explorer when the configured server is reachable. Browser availability comes from `GET /activitywatch/status` on the Rust backend, not a Tauri command. The explorer skips summary reads when unavailable (availability checks still run), and when shown it surfaces the most useful local signals from the current machine:

- current AFK status and current app/window
- current browser tab/domain when a browser watcher is present
- total active time today
- top apps and sites for today
- recent active windows and watcher health

### Bundled macOS behavior

For packaged macOS builds, the Tauri app can also act as the single installer for the local ActivityWatch toolchain:

- the bundle stages `deepb`; ActivityWatch components are optional explicit, checksum-verified build inputs
- on launch, the app attempts to install `~/.local/bin/deepb`
- if `launch_bundled_components = true`, the ActivityWatch URL is local, and nothing is already listening on `localhost:5600`, the app starts the bundled server + watchers automatically

### Desktop embedded server behavior

The packaged Tauri desktop shell now uses this precedence order for its API target:

1. `DEEPBLOCK_SERVER_URL`, if explicitly provided
2. the healthy recorded owner of the selected data root, including alternate ports
3. the configured `[server]` host/port, if a healthy DeepBlock backend is there
4. the normal local default `127.0.0.1:8000`, if a healthy DeepBlock backend is there
5. an embedded loopback backend on an available port from `5605` through `5609`, only when storage is unowned

Health requires `/health` to return `service: "deepblock"` and `status: "ok"`; an open socket is insufficient. Restart older backends lacking that service identifier after upgrading. An owned root with an unavailable/incompatible backend fails instead of starting a second writer. An exhausted embedded port set also fails. Embedded startup verifies the current process's recorded ownership and endpoint before accepting readiness, so another service winning a port-bind race is not adopted. See [Storage and request safety](storage-and-request-safety.md).

ActivityWatch staging requires `DEEPBLOCK_BUNDLE_AW=1`, explicit binary paths, matching SHA-256 values, and license material. Standard releases use bring-your-own ActivityWatch. See [Desktop distribution](desktop-distribution.md).

### `[notifications]`

Shared notification preferences for the current Rust runtime.

| Key                     | Default  | Notes                                                                            |
| ----------------------- | -------- | -------------------------------------------------------------------------------- |
| `enabled`               | `true`   | Master switch for desktop block reminders                                        |
| `sound_enabled`         | `false`  | Reserved for richer future notification behavior                                 |
| `notify_minutes_before` | `5`      | How many minutes before the reminder should fire; `0` means exactly at start/end |
| `notify_on_block_start` | `true`   | Send a reminder before a block begins                                            |
| `notify_on_block_end`   | `true`   | Send a reminder before a block ends                                              |
| `urgency`               | `normal` | Reserved for future platform-specific notification tuning                        |

These notifications are intentionally **time-based only** for now:

- they are launched by the Tauri desktop app as local system notifications
- they reference the block title directly
- they are independent from ActivityWatch and from nudge/intervention experiments

### `[interventions]`

Not implemented or persisted by the current Rust settings model. Idle-prompt and intervention configuration remains a future feature.

## Reality review contract

- ActivityWatch remains optional; if it is unavailable, DeepBlock still supports planning, revisions, notes, backlog, compare, and `deepb review`
- The Rust server only uses ActivityWatch as a local HTTP data source for on-demand audits
- Variance analysis is intentionally decoupled from ActivityWatch and can use `focus_rating` / `actual_duration` even when no audit has been run
- Empty ActivityWatch queries and legacy zero-activity logs remain unassessed. Positive logs describe computer activity, not task duration or measured attention quality.
- Optional outcomes can be recorded for today or past days without changing scheduling intent or creating a revision; completion alone does not establish evidence coverage. See [Core planning trust](features/core-planning-trust.md).
- Real-time nudging is intentionally deferred until DeepBlock has a production-ready event source that does not make ActivityWatch a hard dependency

## Settings API

```bash
curl http://127.0.0.1:8000/config
curl -X PATCH http://127.0.0.1:8000/config -H "Content-Type: application/json" -d '{"default_duration":45}'
```

## Environment overrides

| Variable                | Purpose                             |
| ----------------------- | ----------------------------------- |
| `XDG_CONFIG_HOME`       | Config root override                |
| `XDG_DATA_HOME`         | Data root override                  |
| `XDG_STATE_HOME`        | State root override                 |
| `DEEPBLOCK_SERVER_HOST` | Process-only loopback host override |
| `DEEPBLOCK_SERVER_PORT` | Process-only server port override   |
| `DEEPBLOCK_SERVER_URL`  | Client-side server URL override     |

`deepb serve` flags take precedence over the environment, which takes precedence over `[server]`. Saving Settings does not persist the process overrides.

### Development-only network configuration

`mise run dev` selects a private Vite interface and keeps Rust on loopback. `DEEPBLOCK_DEV_BIND`, `DEEPBLOCK_DEV_LOCAL=1`, `DEEPBLOCK_DEV_HOSTNAMES`, and `DEEPBLOCK_DEV_PORT` control frontend access; `DEEPBLOCK_SERVER_PORT` sets the proxy/backend port. Additional backend origins require `DEEPBLOCK_DEV_MODE=1` plus the exact comma-separated `DEEPBLOCK_DEV_ORIGINS`; the helper sets these consistently. These are process overrides, not persisted settings. See [Linux/LAN development](linux-development.md) for commands and security limits.

## Storage ownership and request safety

Only one server may write a given data root. Daily plans and undo/redo are saved together, and browser requests are checked against the supported local origins and loopback hosts. See [Storage and request safety](storage-and-request-safety.md) for migration, draft-conflict, and deployment limits.
