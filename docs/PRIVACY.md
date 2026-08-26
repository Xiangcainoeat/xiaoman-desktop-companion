# Privacy

## Runtime network use

The desktop host contains no analytics, telemetry, updater, account system, custom backend or remote storage. Ordinary pet animation, interaction, reminders, notifications and application-event features run locally.

When the user explicitly replies to a Codex task, the default native channel sends the text over the local Codex IPC socket to the client that owns the selected thread. The host does not open a second Codex window or duplicate the response to another service. If the user explicitly selects `CLI 兼容`, the installed Codex CLI is used instead and inherits the user's existing authentication, network connection and service settings. Task metadata may be read from the local state DB; an existing app-server daemon is used only as a filtered fallback.

## Codex sessions

When status monitoring is enabled, the app watches local files under `~/.codex/sessions` and reads only lifecycle markers from appended JSONL bytes. In native mode, task identity comes from the local `state_*.sqlite` database; the monitor only overlays a status when the file's `session_meta` ID matches that state-db thread. `exec` and subagent files are ignored. Task controls may use an existing local Codex app-server only as a filtered state-db fallback. The UI may display:

- task title or a short first-message preview supplied by Codex
- workspace/project label
- task status and update time
- thread identifier internally for navigation and reply

Reasoning, tool arguments and tool outputs are not copied into the companion data store or displayed by this app. The bounded recent activity list stores only generic event titles and the selected task title.

An explicit native reply is validated, assigned a unique client message ID, owner-routed through the local IPC socket and sent to the existing Codex client. The app never writes session JSONL or the state DB directly. In the explicit CLI compatibility mode, active replies use the Codex queue and idle replies use the supported resume command; queue text can be visible briefly to same-user process inspection tools while that short-lived command runs, while resume text is sent on stdin.

## Foreground applications

The app asks macOS `NSWorkspace` for the localized name of the frontmost application every 2.2 seconds. It does not read window titles, document names, URLs, keystrokes, clipboard contents or screen pixels.

## Stored data

The local JSON store contains pet stats, reminder text, app-name rules, idle phrases, settings, overlay position and a bounded recent activity list. It is written with owner-only file permissions.

## Build-time image generation

The idle action sheet and enhanced gaze transition references were produced during development through the user's private OpenAI-compatible ImageGen relay with `gpt-image-2`, using the local `relay-imagegen` CLI wrapper. The relay endpoint and credentials are not included in the app and are never called at runtime. The native 16-direction gaze atlas is extracted locally from the accepted native spritesheet; the enhanced 90-direction atlas is assembled locally from generated anchors and selected transition images.

## Codex independence

The app does not modify Codex configuration, hooks, session files or native pet files. Disabling Codex monitoring stops the lifecycle watcher. Disabling “Codex 任务与回复” removes task listing/reply controls while leaving other companion features available.
