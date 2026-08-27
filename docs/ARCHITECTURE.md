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
| Codex sessions service | Native state-db discovery, native IPC follower replies and explicit CLI compatibility operations |
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
7. Cursor samples carry timestamps. The renderer estimates instantaneous pointer velocity and lowers the gaze time constant while the pointer moves quickly, so a fast mouse move produces a fast response instead of a fixed-speed path.
8. The enhanced profile keeps the ordinary body/action sprite stable and places one 96-frame head-only atlas (`head-look-96.webp`) over its face. The native profile keeps the accepted 16-frame full-body look atlas. Both profiles select one direction at a time, with no opacity cross-fade.
9. After cursor inactivity, the direction eases to zero, the enhanced head layer is hidden, and the ordinary forward animation is restored.

The enhanced `look-96.webp` source is assembled deterministically from a repaired 32-anchor source, 64 generated in-betweens and four selected lower-hemisphere seam repairs. The runtime head atlas is derived from those approved frames with a spatial face mask, neutral eye cover and native-color grade; it never temporally blends adjacent frames. Its metadata, source hashes, prompts, concurrency record and contact sheets live under `work/xiaoman-pet-96/`. The native `public/pet/native/` profile is a byte-for-byte copy of the accepted v2 `pet.json`, `spritesheet.webp` and extracted `look-16.webp`; it is never written back to `~/.codex/pets/xiaoman`. The older `look-32.webp` and `look-90.webp` remain provenance only.

## Motion and idle behavior

- Horizontal drag crosses a 4px threshold before choosing left/right running rows.
- Hover starts one jump cycle when enabled and repeats it for the persisted 1–5 jump count.
- Idle lick, blink and raised-front-paw actions use `idle-actions-30.webp`, a 10x9 transparent atlas with 30 frames per action. Rows 0–2 are lick, 3–5 blink, and 6–8 are the visible `举前爪` action while retaining the `idle-scratch` compatibility key.
- Idle scheduling pauses during drag, gaze, hidden overlay or higher-priority state animation.
- Random speech is selected from a normalized list of at most 40 unique phrases, each at most 80 characters.
- Overlay dimensions derive from the 150–340px pet size and preserve the lower-right screen anchor.

## Codex task controls

In native mode, task identity comes from the newest local Codex `state_*.sqlite` database. The query is read-only, excludes archived rows, `exec`, subagent sources and subagent thread sources, and does not union arbitrary JSONL files. If the state database is unavailable, the service may ask the existing app-server for the same filtered authority; it never falls back to an unrelated log list in native mode. The renderer receives only title, project label, status, reply capability and update time.

The append-only monitor reads lifecycle markers only. It maps each JSONL file's `session_meta` ID to a thread and overlays `running`, `waiting`, `idle` or `error` on the matching state-db record. Files identified as `exec` or `subagent` are ignored. This supplies live “执行中” labels without using log contents as task discovery.

Replies never edit JSONL files. In the default native channel, the companion opens a fresh connection to `~/.codex/ipc/ipc.sock`, initializes as a follower, declines router ownership discovery, finds the exact owner with `thread-owner-discovery`, then sends `thread-follower-steer-turn` for an active turn or `thread-follower-start-turn` for an idle turn. The owner client ID is taken from the IPC response envelope, so a reply is delivered to the existing native Codex window rather than a newly opened window. Each send has a unique client message ID and a per-thread lock; sequential sends use independent connections.

The optional CLI compatibility channel retains the older operations: active or waiting tasks use `codex queue --thread <id> --message <text>`, while idle or failed tasks use `codex exec resume --skip-git-repo-check <id> - --json` with the message on stdin. Queue/resume is never a silent fallback for native IPC. Arguments are passed as an array without a shell, IDs and message size are validated, and idle resume requires a `turn.started` acknowledgement. Exact task navigation remains an explicit `codex://threads/<id>` action; native reply success does not invoke that deep link again.

## Persistence

`CompanionStore` writes JSON through a temporary file followed by an atomic rename. The file mode is `0600`. Schema version 2 migrates version-1 data while preserving stats, reminders, rules, activity, startup preference and overlay position. Every nested field is normalized at runtime. Malformed or unsupported future data is renamed to an `.invalid-*.bak` file before defaults are created, preventing silent overwrite of the only recoverable copy.

## Integration boundary

The host does not patch ChatGPT/Codex application bundles, `config.toml`, hooks, session JSONL or `~/.codex/pets/xiaoman`. State DB and lifecycle monitoring are read-only. Only an explicit reply invokes native IPC or, when explicitly selected, a supported Codex CLI write operation. Removing the desktop host leaves the native two-file pet intact.
