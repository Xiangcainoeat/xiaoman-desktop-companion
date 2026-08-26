# Native Reply Smoke Test

Date: 2026-08-27
Version: 1.2.0

## Contract covered

- The default reply channel is `native`, not CLI queue/resume.
- A fresh IPC connection initializes as a follower, declines router discovery,
  discovers the exact owner for the selected thread, and sends one
  `thread-follower-start-turn` or `thread-follower-steer-turn` request.
- Sequential sends use independent connections and unique
  `clientUserMessageId` values.
- After a native acknowledgement, the host keeps a short-lived optimistic
  active marker so an immediate second send uses `steer` even if the state DB
  has not recorded the first turn yet; monitor events replace the marker.
- Native success does not invoke the `codex://threads/<id>` deep link again.
- Native task discovery uses the filtered state DB and does not union local
  `exec` or subagent logs.

## Automated result

`electron/codex-ipc.test.ts`, `electron/codex-state.test.ts` and the native
sections of `electron/codex-sessions.test.ts` pass. The suite covers framing,
partial chunks, owner envelope extraction, discovery decline, start/steer
payloads, timeout/error handling, fresh-connection sequential sends, one
state-race retry, state-db filtering and the absence of a CLI process in native
mode.

## Local read-only probe

The local socket at `~/.codex/ipc/ipc.sock` was inspected without sending a
turn. The router returned an initialization response with a client ID and an
owner-discovery response whose `handledByClientId` identified the native Codex
owner. This confirms the production framing and envelope shape without adding
test content to a user conversation.

## Manual acceptance procedure

1. Open the packaged app with the native reply channel selected.
2. Select a visible user thread that is open in Codex.
3. Send two different harmless messages one after another.
4. Confirm both messages appear in that same native Codex window and thread.
5. Confirm no second Codex window opens and no `exec` or subagent thread is
   added to the task list.
6. Select `CLI 兼容` only when the native socket is intentionally unavailable,
   then separately verify the documented queue/resume behavior.

The manual procedure is deliberately not executed against the user's active
conversation by the build process.
