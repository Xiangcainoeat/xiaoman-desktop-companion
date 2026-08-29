# Changelog

## 1.4.1 - 2026-08-29

- Fixed the final embedded-game fit pass: Star Battle now has a strict 960 x 480 document boundary with no inner scroll or footer, and Battle City/Pacman stay on their native play surfaces.
- Kept the games workspace on persistent top tabs, restored the normal center-window size outside a game, and paused/muted inactive or hidden game frames.

## 1.4.0 - 2026-08-27

- Follow-up polish: care, interaction and Codex task controls now share one expanded overlay host with identical geometry; only pressing and holding Xiaoman moves that host, while panel headers remain stationary. Sleep locks auxiliary panels and reports “小满睡着了” until wake.
- Reworked enhanced care playback to use the native-colored lick loop for feeding and the native idle loop for bathing, with discrete frame selection and only tiny compositor motion; the curled sleep loop now traverses all 30 source frames.
- Added a persistent local care loop with fullness, cleanliness, energy, affection, experience and levels.
- Added inventory-backed feeding for fish snacks, milk, tuna bites and salmon; zero inventory never changes stats.
- Added Codex completion rewards with one fish snack per real `threadId + turnId`, an 18% gift-box roll, and no rewards for recovered history.
- Added three local jobs, daily quests, gift-box opening with documented food weights, offline job settlement and explicit reward collection; the code-helper job exposes its separate 12% bonus gift chance.
- Added a separate care center and a read-only overview handoff so care operations do not duplicate ordinary interaction actions.
- Added configurable inactivity sleep with a complete curled-body atlas, a dirty state when cleanliness falls below 18, and a bathing animation.
- Retired the former self-authored H5 and independent-game launchers from the visible catalog.
- Replaced them with a catalog of distributable static H5 projects plus the retained `itlwei/Chess` Chinese-chess repository; the Lila international-chess entry remains an explicit online handoff because it is a full server application. A source snapshot without a redistributable license is withheld from the public catalog.
- Added a loopback static host and one sandboxed iframe surface for local article games, with source/commit/license records and tests that reject the retired catalog IDs and directories.
- Added persistent game tabs, per-game frame sizing, shared keyboard forwarding and inactive-game audio pausing; cleaned the Tetris side rails/QR, repaired Snake wall loss and Sliding Puzzle startup, and added compact Chinese 2048 controls.
- Added original fish and bubble target bitmap assets, deterministic extraction, care/sleep atlas verification and the `verify:care-atlas` command.
- Preserved the native Codex profile, native task routing and explicit CLI compatibility boundary.
- Added a visible `退出小满` command in the control center, preferences and overlay actions, backed by trusted Electron IPC; the tray and context-menu exits remain available.
- Standardized control-center typography across navigation, overview, care, games, Codex tasks, reminders, events and preferences with shared page, section, card, body, meta and metric levels.

## 1.3.1 - 2026-08-27

- Reverted enhanced gaze rendering to the complete 96-direction body atlas so the head, neck, torso, paws and tail remain one coherent pose.
- Kept velocity-responsive cursor tracking, 30/60Hz selection, deadzone handling, inactivity reset and native Codex title synchronization unchanged.
- Retained the generated head-only atlas as provenance only; the runtime no longer loads it.

## 1.3.0 - 2026-08-27

- Replaced the enhanced gaze sheet with 96 independent 3.75° frames and removed renderer-side opacity cross-fading, eliminating the turn-time ghosting path.
- Added a head-only enhanced gaze layer with a fixed body/action frame, spatial-mask-only compositing and velocity-responsive tracking; fast pointer motion now produces a faster response and inactivity restores the forward idle face.
- Synchronized native task labels from Codex's generated `name` field and shortened task refresh intervals so automatic renames appear without showing the first prompt.
- Added explicit lower-hemisphere seam repairs, native-color QA and a reproducible local ImageGen/assembly record under `work/xiaoman-pet-96/`.
- Added configurable hover jump count (1–5) and configurable mouse-inactivity timeout before gaze returns to the forward idle pose.
- Replaced the visible scratch/head-touch idle action with a clearly raised-front-paw sequence while retaining the persisted compatibility key.
- Limited native-to-CLI fallback to the precise “no native owner” result; connection, protocol and timeout failures remain visible instead of launching an unrelated task.
- Increased control-center and overlay task typography while preserving fixed window dimensions and stable status columns.

## 1.2.0 - 2026-08-27

- Added switchable `小满增强` and `原生 Codex` pet profiles. The enhanced host profile uses a validated 90-direction, 4° gaze atlas; the native profile keeps the accepted 16-direction Codex assets byte-for-byte.
- Repaired the lower-half gaze transition with generated intermediate frames, shared registration, premultiplied interpolation, transparent edge cleanup and deterministic atlas verification.
- Routed default replies through the owning native Codex client over local IPC. Repeated sends use fresh connections and unique message IDs, and native success no longer opens a second `codex://` window.
- Made native task discovery state-db authoritative, filtered to interactive user threads, and overlaid live lifecycle state only for matching thread IDs; `exec` and subagent sessions are excluded.
- Kept `codex queue` / `codex exec resume` as an explicit CLI compatibility channel rather than an implicit native fallback.
- Added profile manifests, native hash records, image-generation concurrency provenance and 1.2.0 release QA documentation.

## 1.1.1 - 2026-08-26

- Expanded lick, blink, and scratch idle actions to 30-frame generated sequences with a 30/60Hz animation clock and transparent color QA.
- Fixed Codex task discovery/reply fallback races and made browser preview replies explicitly non-live.
- Rebuilt the Apple Silicon application and source archive from the corrected tree.

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
