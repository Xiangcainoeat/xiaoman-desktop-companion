# Privacy

## Runtime network use

The packaged app makes no network requests and contains no analytics, telemetry, updater, account system or remote storage.

## Codex sessions

When enabled, the app watches local files under `~/.codex/sessions` and reads appended JSONL bytes. It classifies only lifecycle metadata needed for pet states:

- top-level record type
- payload event type
- turn id
- timestamp
- duration
- whether an error field is present
- tool name only when checking for `request_user_input`

Message, prompt, reasoning, tool argument and tool output fields are not retained, displayed, copied into app data or sent elsewhere. Startup recovery examines recent local records only to determine whether a task is currently active.

## Foreground applications

The app asks macOS `NSWorkspace` for the localized name of the frontmost application every 2.2 seconds. It does not read window titles, document names, URLs, keystrokes, clipboard contents or screen pixels.

## Stored data

The local JSON store contains pet stats, reminder text, app-name rules, settings, overlay position and a bounded recent activity list. It is written with owner-only file permissions.

## Build-time image generation

The 32-direction host gaze sheet was produced during development through the user's private ImageGen relay. The relay is not included in the app and is never called at runtime.

## Codex independence

The app does not write to Codex configuration, hooks, session files or pet files. Disabling Codex monitoring stops the file watcher immediately.
