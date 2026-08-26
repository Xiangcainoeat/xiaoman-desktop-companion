# Visual Workflow

## Identity and gaze profiles

The desktop host reuses the accepted Xiaoman Codex atlas as the identity source. Version 1.2 has two selectable profiles:

- `native`: deterministic extraction of the accepted rows 9–10 into `public/pet/native/look-16.webp`; the native `pet.json` and `spritesheet.webp` are byte-preserved copies.
- `enhanced`: a 90-direction host atlas at 4-degree increments, with generated transition frames for the lower quadrant and deterministic registration/interpolation.

- output: `1536x416`
- grid: `8x2`, cells `192x208`
- directions: 16 clockwise frames at 22.5-degree increments
- report: `work/look-16-validation.json`
- contact sheet: `work/look-16-contact-sheet.png`

The earlier generated 32-direction experiment remains as `look-32.webp`, `gaze-32-*` and `build_gaze_atlas.py` for provenance. It is not loaded directly by either runtime profile.

## Enhanced 90-direction generation

The selected enhanced source and all reusable generation instructions are under
`work/xiaoman-pet-90/`:

- local CLI: `relay-imagegen/scripts/relay_imagegen.sh`, model `gpt-image-2`
- source repair: `relay-output/look-32-source-repaired.png`
- final transition overrides: 172, 176, 260, 264, 268, 352 and 356 degrees
- deterministic resampler: `scripts/resample_look_directions.py`
- deterministic atlas builder: `scripts/build_look_atlas_90.py`
- verifier/contact sheets: `scripts/verify_look_atlas_90.py` and `qa/`
- job and concurrency records: `imagegen-jobs.json` and `concurrency.json`

The final sheet is mixed by design: 32 generated/repaired anchors plus seven
selected generated transition frames are expanded to 90 display directions.
The atlas QA report records the exact hashes and source mapping. No endpoint,
credential or private photo path is included.

## Idle action generation

The lick, blink and scratch source sheet was created through the user's private OpenAI-compatible relay.

- generation skill: `relay-imagegen`
- route: private OpenAI-compatible HTTPS relay
- operation: three image edits from the accepted Xiaoman spritesheet
- model: `gpt-image-2`
- selected results: `work/idle-actions-30-generated-lick.png`,
  `work/idle-actions-30-generated-blink.png`, and
  `work/idle-actions-30-generated-scratch.png`
- prompts: `work/idle-actions-30-prompt-lick.md`,
  `work/idle-actions-30-prompt-blink.md`, and
  `work/idle-actions-30-prompt-scratch.md`
- deterministic builder: `scripts/build_idle_atlas_30.py`
- runtime atlas: `public/pet/idle-actions-30.webp`
- report: `work/idle-actions-30-report.json` (`ok: true`)
- contact sheets: `work/idle-actions-30-contact-sheet.png` and
  `work/idle-actions-30-background-check.png`

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
- `qa-v1.1.1-packaged-reply-success.png` records the final packaged reply acknowledgement.
- `qa-v1.1.1-packaged-overlay-idle.png` records the packaged overlay idle state using the 30-frame atlas.
- `qa-v1.1.1-packaged-idle-action.png` records a packaged idle-action frame during runtime playback.

Automated checks cover schema migration, phrase sanitization, gaze geometry and phase smoothing, drag threshold/direction, idle action selection, overlay sizing/anchoring, task status mapping, native IPC framing/owner routing, state-db source filtering, command validation, active queueing, idle resume startup failures, profile asset selection and 90-atlas structure/color QA.
