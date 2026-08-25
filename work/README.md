# Visual Workflow

## Identity and production gaze

The desktop host reuses the accepted Xiaoman Codex atlas as the identity source. Production v1.1 gaze is deterministic and does not require generation: `scripts/build_native_look_atlas.py` extracts rows 9–10 into `public/pet/look-16.webp`.

- output: `1536x416`
- grid: `8x2`, cells `192x208`
- directions: 16 clockwise frames at 22.5-degree increments
- report: `work/look-16-validation.json`
- contact sheet: `work/look-16-contact-sheet.png`

The earlier generated 32-direction experiment remains as `look-32.webp`, `gaze-32-*` and `build_gaze_atlas.py` for provenance. It is not loaded by the v1.1 runtime because lower-quadrant continuity was weaker than the canonical native frames.

## Idle action generation

The lick, blink and scratch source sheet was created through the user's private OpenAI-compatible relay.

- generation skill: `relay-imagegen`
- route: private OpenAI-compatible HTTPS relay
- operation: image edit from the accepted Xiaoman spritesheet
- model: `gpt-image-2`
- selected result: `work/idle-actions-generated-v2.png`
- final prompt: `work/idle-actions-prompt.md`
- deterministic builder: `scripts/build_idle_atlas.py`
- runtime atlas: `public/pet/idle-actions.webp`
- report: `work/idle-actions-validation.json` (`ok: true`)
- contact sheet: `work/idle-actions-contact-sheet.png`

No relay endpoint, API key, original user-photo path or private configuration is included in this repository.

## Product QA

- `qa-v1.1-final-packaged-quick-reply.png` verifies task selection and inline composition in the final packaged app.
- `qa-v1.1-final-packaged-reply-success.png` verifies the final packaged app receives a real Codex startup acknowledgement.
- `qa-v1.1-final-packaged-features.png` verifies the feature-management controls.
- `qa-v1.1-final-packaged-settings.png` verifies 180/360 gaze, 30/60Hz, smoothing, neutral reset, size, native movement and idle settings.
- `qa-v1.1-final-packaged-codex-tasks.png` verifies recent task selection, exact-task navigation and inline reply controls.
- `qa-v1.1-gaze-down-cold.png` verifies the canonical low-head frame in a cold-started Electron window.
- `qa-v1.1-gaze-restored-cold.png` verifies removal of the direction layer after pointer inactivity.
- `qa-v1.1-actual-window.png` verifies a single pet layer with transparent-window alpha.
- `qa-production-final.png` and `qa-production-settings.png` retain v1.0 packaged control-center evidence.

Automated checks cover schema migration, phrase sanitization, gaze geometry and phase smoothing, drag threshold/direction, idle action selection, overlay sizing/anchoring, task status mapping, command validation, active queueing, idle resume startup failures and renderer selection behavior.
