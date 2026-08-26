# Packaged Reply Smoke Test

Date: 2026-08-26
Version: 1.1.1

## Procedure

1. Launch the packaged arm64 app with an isolated Electron user-data directory.
2. Open the `Codex tasks` view and refresh the local task list.
3. Select the dedicated `xiaoman-reply-qa` task.
4. Send a harmless message that asks for `QA_OK` and forbids file changes.
5. Observe the UI immediately and after the task settles.

## Result

- The packaged app loaded both the overlay and control-center windows.
- The task list displayed 20 local sessions, including one active session.
- Selecting the QA task enabled its reply editor and action button.
- The reply was accepted and the UI reported that the task started in the background.
- The reply editor cleared after acceptance.
- The task returned to the ready state after the smoke run.
- The visual evidence is `work/qa-v1.1.1-packaged-reply-success.png`.

The app-server was unavailable in this environment, so the UI used the read-only
local log fallback. The reply itself used the packaged local Codex CLI path and
was not dependent on opening the Codex front-end first.
