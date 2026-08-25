# Architecture

## Process model

The app uses one Electron main process and two sandboxed renderer windows.

| Component | Responsibility |
| --- | --- |
| Overlay window | Transparent pet, gaze, drag/hover interactions and compact Codex reply panel |
| Control center | Feature switches, task controls, stats, reminders, app rules, activity and settings |
| Main process | State priority, timers, persistence, notifications, tray, cursor sampling and IPC validation |
| Preload bridge | Explicit typed IPC methods; no general Node or filesystem access |
| Codex monitor | Append-only, read-only lifecycle classification of local JSONL records |
| Codex sessions service | Supported app-server metadata plus CLI queue/resume operations |
| App monitor | Reads only the localized name of the frontmost macOS application |

Both windows run with `contextIsolation: true`, `nodeIntegration: false`, and `sandbox: true`.

## State priority

Transient reminders and direct interactions can temporarily override background states. When a transient state expires, the main process recomputes the base state in this order:

1. Active Codex task
2. Explicit sleep
3. Hunger or low energy
4. Matching foreground application rule
5. Idle

Renderer-only motion does not mutate this business state. Drag running, hover jumping and idle actions temporarily select another atlas row, then return to the resolved state.

## Gaze pipeline

1. The main process samples `screen.getCursorScreenPoint()` at the selected 30Hz or 60Hz.
2. The overlay converts the pointer to a clockwise target angle around the pet face center.
3. A configurable deadzone with enter hysteresis suppresses nearby-pointer noise.
4. Shortest-path exponential smoothing follows the target without frame-rate dependence.
5. Upper-180 mode clamps lower targets to the horizon; full-360 mode permits low-head frames.
6. Lower tracking is capped relative to the inactivity timeout so it reaches the lower quadrant before reset; return-to-neutral uses a separate prompt-but-smooth cap.
7. The nearest of 16 canonical native direction frames is displayed as one layer, avoiding whole-body double images.
8. After cursor inactivity, the direction eases to zero, the look layer is removed, and the ordinary forward animation is restored.

`look-16.webp` is extracted deterministically from rows 9–10 of the accepted native v2 atlas. `look-32.webp` remains only as a documented v1.0 experiment and is not used by the v1.1 runtime.

## Motion and idle behavior

- Horizontal drag crosses a 4px threshold before choosing left/right running rows.
- Hover starts one jump cycle when enabled.
- Idle lick, blink and scratch use `idle-actions.webp`, an 8x3 transparent atlas.
- Idle scheduling pauses during drag, gaze, hidden overlay or higher-priority state animation.
- Random speech is selected from a normalized list of at most 40 unique phrases, each at most 80 characters.
- Overlay dimensions derive from the 150–340px pet size and preserve the lower-right screen anchor.

## Codex task controls

Task metadata is requested from an existing installed Codex app-server daemon (`thread/list`) when available and merged with read-only local lifecycle status. Without a daemon, the service falls back to local logs instead of starting a standalone app-server. A bounded cache and one shared in-flight request prevent repeated process launches. The renderer receives only title, project label, status, reply capability and update time.

Replies never edit JSONL files:

- active or waiting task: `codex queue --thread <id> --message <text>`; queue failure is surfaced and never auto-resumed
- idle or failed task: `codex exec resume --skip-git-repo-check <id> - --json`, with the message on stdin and the task's absolute `cwd`

Arguments are passed as an array without a shell. Thread IDs and message size are validated. Idle resume waits for the CLI's `turn.started` JSONL acknowledgement; a missing acknowledgement, immediate non-zero exit or process timeout is returned as an error. Later failures are written as durable companion activity. Exact task navigation uses `codex://threads/<id>`.

## Persistence

`CompanionStore` writes JSON through a temporary file followed by an atomic rename. The file mode is `0600`. Schema version 2 migrates version-1 data while preserving stats, reminders, rules, activity, startup preference and overlay position. Every nested field is normalized at runtime. Malformed or unsupported future data is renamed to an `.invalid-*.bak` file before defaults are created, preventing silent overwrite of the only recoverable copy.

## Integration boundary

The host does not patch ChatGPT/Codex application bundles, `config.toml`, hooks, session JSONL or `~/.codex/pets/xiaoman`. Status monitoring is read-only. Only an explicit user reply invokes a supported Codex CLI write operation. Removing the desktop host leaves the native two-file pet intact.
