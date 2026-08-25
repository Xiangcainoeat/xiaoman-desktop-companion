# Privacy

## Runtime network use

The desktop host contains no analytics, telemetry, updater, account system, custom backend or remote storage. Ordinary pet animation, interaction, reminders, notifications and application-event features run locally.

When the user explicitly replies to a Codex task, the host invokes the installed Codex CLI. That child process uses the user's existing Codex authentication, network connection and service settings. The host does not intercept or duplicate the response to another service. If an existing local Codex app-server daemon is available, task metadata may be requested through it; otherwise the host uses local session logs and does not start a standalone app-server.

## Codex sessions

When status monitoring is enabled, the app watches local files under `~/.codex/sessions` and reads appended JSONL bytes to classify lifecycle state. Task controls also request supported metadata from the local Codex app-server. The UI may display:

- task title or a short first-message preview supplied by Codex
- workspace/project label
- task status and update time
- thread identifier internally for navigation and reply

Reasoning, tool arguments and tool outputs are not copied into the companion data store or displayed by this app. The bounded recent activity list stores only generic event titles and the selected task title.

An explicit reply is validated, then sent only to the installed Codex CLI. Active replies use the Codex queue; idle replies use the supported resume command. The installed CLI currently requires active queue text in the `--message` argument, so that text can be visible briefly to same-user process inspection tools while the short-lived queue command runs. Idle resume text is sent on stdin. The app never writes session JSONL directly.

## Foreground applications

The app asks macOS `NSWorkspace` for the localized name of the frontmost application every 2.2 seconds. It does not read window titles, document names, URLs, keystrokes, clipboard contents or screen pixels.

## Stored data

The local JSON store contains pet stats, reminder text, app-name rules, idle phrases, settings, overlay position and a bounded recent activity list. It is written with owner-only file permissions.

## Build-time image generation

The idle action sheet was produced during development through the user's private OpenAI-compatible ImageGen relay with `gpt-image-2`. The relay endpoint and credentials are not included in the app and are never called at runtime. The production 16-direction gaze atlas is extracted locally from the accepted native spritesheet.

## Codex independence

The app does not modify Codex configuration, hooks, session files or native pet files. Disabling Codex monitoring stops the lifecycle watcher. Disabling “Codex 任务与回复” removes task listing/reply controls while leaving other companion features available.
