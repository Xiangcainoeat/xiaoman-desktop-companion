# Xiaoman Desktop Companion v1.1 Design

## Scope

Extend the optional macOS host while preserving the existing Codex v2 pet as an independently usable two-file package. The native `pet.json` and `spritesheet.webp` remain byte-for-byte unchanged.

The host adds:

- gaze off, upper-180, and full-360 modes
- 30 Hz and 60 Hz rendering
- smooth lower-half tracking and return-to-neutral after cursor inactivity
- adjustable pet size without clipping
- native-style drag running and hover jumping
- configurable idle lick, blink, scratch, and random speech
- a compact feature-management view with real enable/disable controls
- Codex task listing, opening, and local reply/continue controls through supported interfaces

## Architecture

### Native compatibility

The installed Codex pet remains canonical and contains only `pet.json` and `spritesheet.webp`. The Electron host ships private copies of the character assets and host-only atlases. Disabling or uninstalling the host cannot affect native Codex behavior.

### Gaze

Use the canonical 16 direction cells from rows 9 and 10 of the accepted v2 atlas. The prior generated 32 direction sheet is not used for production gaze because its lower quadrants contain discontinuities. Render the nearest canonical direction as one full-body layer; cross-fading adjacent full-body poses is prohibited because it creates a visible double image.

The gaze engine uses monotonic time, shortest circular angular distance, and a pet-relative face center. Upper-180 mode clamps lower targets to the left or right horizon. Full-360 mode permits downward targets. If the configured smoothing is too slow to reach the lower quadrant before the inactivity timeout, the lower phase is capped relative to that timeout. Return-to-neutral has its own bounded smoothing phase. After configured cursor inactivity, the angle eases to zero and the directional layer disappears, restoring the ordinary forward animation.

### Motion priority

Transient motion is separate from persisted pet state. Priority is:

1. high-priority business state such as waiting, failed, reminder, or completion
2. drag running left/right
3. one-shot hover jumping
4. idle lick/blink/scratch
5. gaze on eligible states
6. ordinary state animation

Horizontal drag must cross 4 px before running. Release, cancellation, or loss of capture restores the resolved business state without firing a click.

### Idle behavior

The host owns a 3x8 transparent atlas for lick, blink, and scratch. A renderer-local scheduler runs only while the pet is idle, visible, not being dragged, not in gaze motion, and the corresponding feature is enabled. Random speech uses a sanitized persisted phrase list of at most 40 entries, each at most 80 characters.

### Codex tasks

Use the installed Codex app-server or supported CLI operations. `thread/list` supplies task metadata and runtime status. Active-thread replies use `codex queue --thread ... --message ...`; inactive tasks are resumed through the app-server (`thread/resume`, then `turn/start`) or the supported resume command. Never write Codex session JSONL files.

Task opening uses a verified desktop route if the installed ChatGPT/Codex app exposes one. If no stable task-specific route is discoverable, open the desktop app and clearly report that exact task navigation is unavailable instead of automating private UI coordinates.

### Settings and migration

Persisted data moves from schema version 1 to version 2. Version 1 files migrate in place with defaults for new settings and retain stats, reminders, rules, activity, overlay position, and startup preferences.

## Acceptance

- Native pet hashes remain unchanged.
- Gaze settings persist and disabled gaze stops cursor-driven rendering.
- Upper-180 never selects a downward direction.
- Full-360 passes smooth sweeps through down, both horizontal boundaries, and the 0/360 seam.
- An unmoved cursor returns the pet to forward idle.
- 30 Hz and 60 Hz modes do not resize or shift the pet.
- Drag right/left visibly runs; hover visibly jumps; release restores state.
- Minimum/default/maximum sizes fit the transparent window.
- Each idle action and random speech can be independently disabled.
- Phrase add/delete/reset persists across restart.
- Current Codex tasks display title, status, workspace, and update time without showing full private content.
- Replying never edits session files and returns a visible success or error result.
- Unit tests, typecheck, production build, browser QA, native packaged QA, and atlas validation all pass before release.
