# Visual Workflow

## Identity and gaze profiles

The desktop host reuses the accepted Xiaoman Codex atlas as the identity source. Version 1.3 has two selectable profiles:

- `native`: deterministic extraction of the accepted rows 9–10 into `public/pet/native/look-16.webp`; the native `pet.json` and `spritesheet.webp` are byte-preserved copies.
- `enhanced`: approved 96-direction source frames at 3.75-degree increments, plus a runtime head-only atlas derived with a spatial face mask. The body is held on one action frame during gaze; runtime rendering selects one direction and never opacity-blends two poses.

- output: `1536x416`
- grid: `8x2`, cells `192x208`
- directions: 16 clockwise frames at 22.5-degree increments
- report: `work/look-16-validation.json`
- contact sheet: `work/look-16-contact-sheet.png`

The earlier generated 32-direction experiment remains as `look-32.webp`, `gaze-32-*` and `build_gaze_atlas.py` for provenance. It is not loaded directly by either runtime profile.

## Enhanced 96-direction generation

The selected enhanced source and all reusable generation instructions are under
`work/xiaoman-pet-96/`:

- local CLI: `relay-imagegen/scripts/relay_imagegen.sh`, model `gpt-image-2`
- source repair: `../xiaoman-pet-90/relay-output/look-32-source-repaired.png`
- 32 anchor frames plus eight 4x2 generated in-between sheets
- lower-hemisphere seam repair: `relay-output/seam-pairs-15-23.png`
- deterministic assembler: `scripts/assemble_look_96.py`
- deterministic atlas builder/verifier: `scripts/build_look_atlas_96.py` and `scripts/verify_look_atlas_96.py`
- verifier/contact sheets: `qa/look-96-verify-report.json` and `qa/look-96-contact-sheet.png`
- head-only runtime builder/verifier: `scripts/build_head_look_atlas_96.py` and `scripts/verify_head_look_atlas_96.py`
- head contact sheets/report: `qa/head-look-96-contact-sheet.png`, `qa/head-look-96-verify-contact-sheet.png` and `qa/head-look-96-verify-report.json`
- job and concurrency records: `imagegen-jobs.json` and `concurrency.json`

The final sheet is mixed by design: 32 repaired anchors plus 64 generated
in-between poses are assembled into 96 independent display directions. Four
selected lower-hemisphere cells replace the weakest transitions without
altering unrelated frames.
The atlas QA report records the exact hashes and source mapping. No endpoint,
credential or private photo path is included.

The head atlas is intentionally a separate runtime artifact. Each cell contains
only the registered face region with a neutral cover for the base eyes; the
remaining body pixels are transparent. This makes the enhanced renderer able to
change gaze without moving the torso, tail or paws. `head-look-96.json` records
the mask, registration, native-color grade and `temporalBlend: false` contract.

## Idle action generation

The lick, blink and raised-front-paw source sheets were created through the user's private OpenAI-compatible relay. The persisted action key remains `idle-scratch` only for backward compatibility.

- generation skill: `relay-imagegen`
- route: private OpenAI-compatible HTTPS relay
- operation: three image edits from the accepted Xiaoman spritesheet
- model: `gpt-image-2`
- selected results: the existing lick/blink sources plus
  `work/xiaoman-pet-96/relay-output/paw-lift.png`, `paw-hold.png` and
  `paw-lower.png`
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
- `qa-v1.1-final-packaged-settings.png` verifies 180/360 gaze, 30/60Hz, smoothing, configurable neutral reset, size, native movement and idle settings.
- `qa-v1.1-final-packaged-codex-tasks.png` verifies recent task selection, exact-task navigation and inline reply controls.
- `qa-v1.1-gaze-down-cold.png` verifies the canonical low-head frame in a cold-started Electron window.
- `qa-v1.1-gaze-restored-cold.png` verifies removal of the direction layer after pointer inactivity.
- `qa-v1.1-actual-window.png` verifies a single pet layer with transparent-window alpha.
- `qa-production-final.png` and `qa-production-settings.png` retain v1.0 packaged control-center evidence.
- `qa-v1.1.1-packaged-reply-success.png` records the final packaged reply acknowledgement.
- `qa-v1.1.1-packaged-overlay-idle.png` records the packaged overlay idle state using the 30-frame atlas.
- `qa-v1.1.1-packaged-idle-action.png` records a packaged idle-action frame during runtime playback.
- `qa-v1.3-head-lock-runtime.png` records the development-window head-only gaze smoke test; the body region is pixel-identical across upper-right and lower-left targets, and the neutral frame returns after inactivity.

Automated checks cover schema migration, phrase sanitization, gaze geometry and phase smoothing, configurable hover count and inactivity timeout, drag threshold/direction, idle action selection, overlay sizing/anchoring, task status mapping, native IPC framing/owner routing, state-db source filtering, command validation, active queueing, owner-not-found CLI resume fallback, idle resume startup failures, profile asset selection and 96-atlas structure/color QA.
