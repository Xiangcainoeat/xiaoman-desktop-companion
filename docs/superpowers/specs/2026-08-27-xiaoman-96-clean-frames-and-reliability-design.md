# Xiaoman 96 Clean Frames And Reliability Design

## Goal

Ship a Xiaoman desktop companion update that removes gaze ghosting without opacity blending, adds a safe native-to-CLI reply fallback for missing tasks, reorganizes the settings screen, prevents context-menu interactions from arming drag, and replaces the scratch-style idle pose with a clearly raised front paw.

## Scope

This update changes only the standalone Xiaoman desktop companion and its release artifacts. The original Codex pet files under `~/.codex/pets/xiaoman` remain untouched. Existing user data under Electron's `userData` directory must migrate without deletion.

## 96-Direction Gaze Atlas

- Replace the enhanced 90-direction atlas with a 96-direction atlas at 3.75-degree increments.
- Reuse the 32 clean generated anchor poses at every third frame.
- Generate two real, single-subject intermediate poses between each neighboring anchor pair. Generated poses must not be alpha blends or composites of endpoints.
- Every frame contains exactly one opaque Xiaoman subject; transparency is limited to normal anti-aliased edge pixels.
- Match the cream body, dark seal points, blue eyes, saturation, and white balance of the original Codex Xiaoman spritesheet. Reject red, pink, magenta, or green spill.
- Keep a shared baseline, scale envelope, frame size, and body center. Changes should read as gaze/head direction, not a changing character identity.
- Runtime gaze rendering uses one sprite layer only. It selects one direction frame from the smoothed angle and never crossfades adjacent full-body frames.
- Add directional hysteresis so cursor jitter near a frame boundary does not flip repeatedly between frames.
- Preserve 30 Hz and 60 Hz gaze calculation modes, shortest-path return to front, 180-degree upper-only mode, and 360-degree mode.

## Codex Reply Fallback

- Preserve the existing native Codex continuation behavior; it remains the preferred route.
- Treat task identity and reply capability separately. A listed historical task can be readable even when the current native Codex process no longer owns it.
- Before sending, validate thread identity, archived/subagent status, native owner availability, and whether an active turn should use steer versus start-turn.
- If and only if native discovery confirms that the current Codex process does not contain or own the task, automatically use the existing CLI-compatible resume route with the same thread ID and task working directory.
- Do not fall back for authentication, malformed request, timeout, or unknown protocol errors; surface those errors so duplicate execution is not started accidentally.
- Return and display `CLI 回退` as the effective transport with an explanation that the original native task was unavailable.
- Normalize native IPC failures into actionable categories instead of displaying raw protocol errors.
- Record companion-side reply attempts in a rotating JSONL log under Electron `userData`, including timestamp, thread ID, selected transport, operation, result category, and sanitized error. Do not log message bodies.
- When the task is absent from native Codex and is CLI-compatible, start the CLI fallback explicitly rather than opening or stealing another native task owner.
- Repeated sends must use a fresh IPC connection and must not deep-link away from the original Codex task after sending.

## Settings Layout

- Replace the current row-balanced CSS grid with two explicit vertical settings columns.
- Left column: work profile/reply channel, display and gaze, movement.
- Right column: idle behavior, sound and notifications, event sources, startup.
- Each column stacks sections independently so a tall gaze section cannot create a large blank region below the short work-profile section.
- Preserve all current controls, labels, keyboard behavior, and responsive collapse to one column.
- Controls must have stable widths and labels must not collide with segmented controls or sliders.

## Pointer And Context Menu State

- Only a primary-button pointer down may arm desktop-pet dragging.
- Secondary click, control-click, context-menu open, window blur, visibility loss, pointer cancellation, and lost pointer capture must synchronously clear drag state.
- Returning from the context menu or control center must not move the overlay until a new primary-button pointer down occurs.
- Existing click, double-click, drag-run animation, and position persistence remain intact.

## Raised-Paw Idle Action

- Replace the current scratch/head-touch action with a front-paw raise.
- The action starts from idle, lifts one front paw visibly in front of the body, holds briefly, and returns to the same idle baseline.
- The paw must remain anatomically attached and must not touch or pass behind the head.
- Use discrete generated key poses assembled into a 30-frame sequence without opacity blending.
- Rename user-facing text from `挠头` to `举前爪`; preserve the stored compatibility key during migration if practical.

## Verification

- Unit tests cover single-layer frame selection, 96-frame metadata, hysteresis, right-click drag rejection, drag reset events, reply eligibility, native operation selection, and sanitized reply logging.
- Atlas verification checks dimensions, 96 unique direction slots, alpha occupancy, duplicate silhouettes, baseline/scale drift, edge spill, and reference-color distance.
- Visual QA includes a labeled 12x8 contact sheet, seam frames around 0/360 degrees, lower-quadrant frames, and raised-paw sequence.
- Browser and packaged Electron QA cover settings layout at desktop and narrow widths, context-menu round trip, 30/60 Hz gaze, and task reply success/error messages.
