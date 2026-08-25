# Architecture

## Process model

The app uses one Electron main process and two sandboxed renderer windows.

| Component | Responsibility |
| --- | --- |
| Overlay window | Transparent pet renderer, 30/60Hz gaze, drag and click interactions |
| Control center | Stats, reminders, app rules, activity and settings |
| Main process | State priority, timers, persistence, notifications, tray and cursor sampling |
| Preload bridge | Explicit typed IPC methods; no general Node or filesystem access |
| Codex monitor | Append-only, read-only classification of local JSONL lifecycle records |
| App monitor | Reads only the localized name of the frontmost macOS application |

Both windows run with `contextIsolation: true`, `nodeIntegration: false`, and `sandbox: true`.

## State priority

Transient reminders and direct interactions can temporarily override background states. When a transient state expires, the main process recomputes the base state in this order:

1. Active Codex task
2. Explicit sleep
3. Hunger or low energy
4. Matching foreground application rule
5. Idle

This prevents an ordinary app switch from replacing an active task or reminder reaction.

## Gaze pipeline

1. The main process samples `screen.getCursorScreenPoint()` at the selected 30Hz or 60Hz.
2. The overlay converts the pointer to a target angle around the pet center.
3. A 54px default deadzone and 12px enter hysteresis suppress nearby-pointer noise.
4. Exponential time smoothing follows the target without frame-rate-dependent motion.
5. An 8.25-degree bucket hysteresis selects one of 32 frames.
6. `look-32.webp` supplies four rows of eight clockwise directions.

The original Codex atlas remains untouched and is still used for the nine standard status animations.
Several source rows contain transparent tail cells; the host records each row's populated frame count and stops its loop before those cells, so a status animation cannot briefly disappear.

## Persistence

`CompanionStore` writes JSON through a temporary file followed by an atomic rename. The file mode is `0600`. The schema is versioned and normalized with defaults when fields are added.

## Integration boundary

The host does not patch Codex, ChatGPT, application bundles, `config.toml`, `hooks.json`, or `~/.codex/pets/xiaoman`. Codex integration is optional and read-only. Removing the desktop app leaves the native pet package intact.
