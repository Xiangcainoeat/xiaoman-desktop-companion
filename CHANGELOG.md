# Changelog

## 1.1.0 - 2026-08-26

- Added gaze enable/disable, upper-180/full-360 modes, 30/60Hz rendering, configurable smoothing/deadzone/idle reset, and adjustable pet size.
- Switched production gaze to the canonical native 16-direction frames, removed composited ghosting, improved lower-half convergence, and restored the forward frame after cursor inactivity.
- Restored native-style drag running and hover jumping.
- Added generated lick, blink, and scratch idle animations plus configurable random idle phrases.
- Added a feature-management view with real toggles for desktop, idle, notification, application, and Codex capabilities.
- Added recent Codex task listing, exact-task deep links, overlay quick reply, active-task queueing, and headless resume for idle tasks.
- Fixed idle-task replies failing outside trusted repositories and fixed false success when the resume process exits immediately.
- Required an explicit `turn.started` acknowledgement, preserved authoritative reply capability, scanned backward through large rollout logs, and prevented recent subagents or stale `notLoaded` markers from hiding active user tasks.
- Hardened local persistence with runtime normalization, future-schema rejection, invalid-file backups, atomic writes, and owner-only permissions.
- Added schema-v2 migration, task/reply tests, gaze/motion/layout tests, visual QA evidence, and a clean v1.1 release workflow.

## 1.0.0 - 2026-08-26

- Added an independent transparent macOS desktop host for Xiaoman.
- Added selectable 30Hz and 60Hz cursor tracking with deadzone, angular hysteresis and time smoothing.
- Added a host-only 32-direction gaze atlas with deterministic extraction and validation artifacts.
- Added feeding, petting, play, sleep, celebration, affection, fullness and energy systems.
- Added local procedural sounds, reminders, proactive notifications and foreground-application rules.
- Added read-only Codex task-state monitoring without modifying Codex configuration or pet files.
- Added owner-only atomic persistence, sandboxed renderers and an allow-listed IPC bridge.
- Added installable Apple Silicon DMG and ZIP builds plus production-window visual QA.
