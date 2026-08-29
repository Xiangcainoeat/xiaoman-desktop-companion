# Action Triggers

This document records behavior observed in ChatGPT desktop `26.818.61809` (build `7019`) on 2026-08-26. It describes the current implementation, not a promised public API.

## Codex status mapping

Codex chooses the pet state. Xiaoman only supplies artwork for each known state.

| Runtime condition | Pet state | Xiaoman's visual meaning |
| --- | --- | --- |
| No active status, informational status, or ordinary rest | `idle` | Calm breathing and blinking |
| Notification status has `isLoading=true` | `running` | Focused task processing |
| Notification level is `warning` | `waiting` | Waiting for approval, help, or user input |
| Notification level is `danger` | `failed` | Blocked or failed reaction |
| Notification level is `success` | `review` | Completed output ready to inspect |
| Status kind is `first-awake` | `waving` | Greeting or first-attention gesture |

Approval, permission, question, and other user-input requests are converted by the app into notification/status objects. Their displayed pet state follows the status mapping above. A custom pet cannot override that mapping through `pet.json`.

## Direct pointer interactions

| Interaction | Trigger | Result |
| --- | --- | --- |
| Hover | Pointer enters the mascot and no higher-priority transient state overrides it | `jumping` |
| Drag right | Horizontal drag delta reaches at least `4px` | `running-right` |
| Drag left | Horizontal drag delta reaches at most `-4px` | `running-left` |
| Look | Pointer is more than `1px` from the mascot center while state is `idle`, `running`, or `waving` | One of 16 look frames |

Look direction is calculated from the mascot center, starts at up, proceeds clockwise, and snaps to the nearest `22.5` degree bin. Inside the `1px` center dead zone, normal action animation is used. Look frames do not replace `jumping`, `waiting`, `failed`, `review`, or drag locomotion.

## Playback behavior

- `idle` loops continuously.
- A non-idle action sequence is repeated three times, then playback falls back to the idle loop while that state remains mounted.
- A look direction selects one static cell rather than playing an action row.
- Reduced-motion or runtime accessibility settings can collapse animation to a single frame.
- The runtime owns frame timing. Adding timing fields to `pet.json` does not change the current renderer.

## Local notification scope

Xiaoman does not run a daemon and does not schedule macOS or Windows notifications. It visually reflects notification and task state already produced by Codex's local desktop UI. Installing the two files therefore needs no API credentials or service configuration, but it also cannot create new notification sources by itself.

For reminders, sounds, custom schedules, click actions, or reactions to external apps, use a host with a behavior/plugin API or build a separate integration. See [Extending Xiaoman](EXTENDING.md).
