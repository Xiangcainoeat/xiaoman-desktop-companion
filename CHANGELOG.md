# Changelog

## 1.10.6 - 2026-09-04

- Reflowed mobile game controls into two compact rows: action buttons now share the upper row with the up direction while left, down and right remain together below.
- Kept long action labels on one line and centered direction-only controls without wasting an empty action row.

## 1.10.5 - 2026-09-04

- Audited every bundled single-player game's real keyboard contract and restored the missing mobile `Enter`/`Space` actions for Pac-Man, Tetris, Star Battle and Space Invaders without inventing controls for direct-touch games.
- Disabled long-press selection, copy, context menus and image dragging only inside local and online game surfaces while preserving taps, swipes, keyboard input and room-code copying.
- Expanded active online matches into a board-first full-viewport layout with a narrower control rail so boards use more of the available desktop and mobile width.

## 1.10.4 - 2026-09-04

- Added a board-first focus layout for active online matches while keeping the complete room, invite and ready flow before play starts.
- Enlarged square and non-square boards against the actual desktop and mobile content area without clipping or nested scrolling.
- On phones, active matches now hide the site header, room summary, seats and rules while retaining turn state, undo, resign, audio and leave controls.
- Removed the duplicated Gomoku surface inset that could make a full-width mobile board overflow its stage.

## 1.10.3 - 2026-09-04

- Made the displayed online room an explicit workspace selection instead of deriving it from a possibly stale global active-room snapshot.
- Creating or joining a room from the online lobby now opens that exact room immediately, even when another game remains active in the account.
- Added a regression test for creating a new room while an older room is already open and playing.

## 1.10.2 - 2026-09-04

- Replaced the online-room mode/room tabs with one compact vertical control column and made the ready action the first, most prominent control after both players enter.
- Removed the unfinished replay and record-export actions from online games, while retaining room sharing, rules, game-only audio and leave controls.
- Added opponent-approved rematch invitations: the first player invites, the second accepts, and the server atomically clears the board, readies both players and starts the next game.
- Added a shared result dialog for normal wins, resignations and rematch invitations, with realtime recovery after refresh or reconnect.
- Kept undo opponent-approved and made its accept/reject controls explicit in every online board game.

## 1.10.1 - 2026-09-04

- Restored one outer vertical scroller for active mobile game pages so tall boards and settings remain reachable without nested iframe/page scrolling conflicts.
- Removed redundant mobile control panels from direct-touch games, including Chinese Xiangqi and 2048; their original board gestures remain the only input surface.
- Centered mobile direction and action controls, centered the Battle City stage, and made the native Gomoku workspace participate in the same outer-page scrolling model.
- Stopped mobile iframe focus changes from resetting ancestor scroll positions while retaining the fitted, non-scrolling desktop workspace.

## 1.10.0 - 2026-09-04

- Added responsive mobile game workspaces with automatic detection, an explicit automatic/desktop/mobile switch, and outside-the-frame touch controls for every keyboard-driven single-player game.
- Moved third-party single-player game assets to the shared server origin; packaged desktop builds no longer contain `dist/article-games`, while the hosted web build remains the source of truth.
- Added opponent-confirmed undo requests to every online board room, including authoritative server rollback, move locking while a request is pending, reconnect persistence and realtime room updates.
- Routed online Xiangqi board art and its compatibility iframe through the same server asset origin so the downloaded app has no hidden local-game dependency.
- Restricted the renderer frame policy to the configured Xiaoman server plus explicit loopback development origins.

## 1.9.0 - 2026-09-02

- Replaced the visible friend workspace with a room-only flow: 单机游戏, 联机房间 and 我的房间.
- Added invite links, invite codes and room-number joining, plus a one-hour idle room expiry/countdown.
- Kept legacy friend/chat transport routes only as a compatibility layer; the current client no longer
  loads those collections during login or reconnect.
- Added a dedicated 联机游戏 workspace split into 单机游戏 and 联机房间 navigation groups.
- Added the complete 16-game online catalog from the reference room directory, with room creation,
  join/share codes, ready-to-start flow, reconnect snapshots and WebSocket move updates.
- Added reusable board engines and renderers for Gomoku, Connect6, chess, Xiangqi, Go, Shogi,
  Reversi, Checkers, Chinese Checkers, Ludo, Animal Chess, Army Chess, Backgammon, Dots and Boxes,
  Mancala and Tic-Tac-Toe.
- Expanded the standalone social server protocol and regression coverage without exposing desktop-only
  Codex tasks, context, pet packs or preferences in the public web boundary.

## 1.8.1 - 2026-09-01

- Enforced the runtime boundary: the public server UI only exposes interactive games and
  server-backed social/online features, while Codex tasks, context, pet packs, care, reminders,
  app events and settings remain available only in the installed Electron app.
- Restored and verified native Codex task discovery from the local Codex state database in the
  packaged application, and removed the stale 1.2.0 LaunchAgent preview that could mask updates.
- Replaced the expired-domain default with `http://47.97.219.242:18080`, added bounded connection
  timeouts and a settled error state, and widened the social authentication layout.

## 1.8.0 - 2026-08-31

- Switched the production desktop and web social workspace to the server transport only.
  The UI no longer exposes a local guest/demo mode; local transport fixtures remain test-only.
- Added the standalone Node/SQLite social service with registration, login, friend requests,
  direct and group chat, game invitations, realtime events and online Xiangqi rooms.
- Added an authentication gate so private social data is not loaded before login, and added
  a dedicated deployment at `http://47.97.219.242:18080` without touching existing services.
- Split runtime capabilities explicitly: the public web build exposes games and server social
  only, while Codex sessions, pet packs, care, reminders and settings remain desktop-only.
- Added server persistence, hashed passwords and session tokens, CORS allow-listing, malformed
  input handling and REST/WebSocket protocol regression tests.

## 1.7.0 - 2026-08-31

- Added a standalone 好友与联机 workspace with guest-first use, login/register, friends,
  group chat, game invites and room tabs.
- Added a local two-seat Chinese-chess room demo that works without a server, plus a
  server transport boundary ready for REST and WebSocket integration later.
- Added authenticated-only realtime connection setup, cookie-session support, in-memory
  bearer tokens, reconnect handling and runtime validation for untrusted realtime events.
- Fixed initialization/login races, stale private data after logout, server response
  envelopes, room snapshot updates and online Gomoku/Xiangqi resource initialization.

## 1.6.1 - 2026-08-30

- Moved the one-click Pet Studio launcher to the bottom of 偏好设置.
- Replaced the external app-server Pet Studio flow with the native Codex new-conversation deep link; the prompt is prefilled and the user sends it in Codex.
- Flattened preference sections into an intrinsic two-column grid so short and long sections no longer create an imbalanced nested layout.

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
- Replaced them with an exact 11-entry open-source catalog: ten bundled static H5 projects plus the retained `itlwei/Chess` Chinese-chess repository; the Lila international-chess entry remains an explicit online handoff because it is a full server application.
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
