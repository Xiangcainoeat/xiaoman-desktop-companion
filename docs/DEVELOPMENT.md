# Development

## Source layout

```text
electron/                 Main process, monitors, Codex service, store and preload
src/components/           Overlay and control-center React views
src/shared/               Shared types and pure domain/gaze/motion/layout functions
public/pet/               Runtime atlases and tray icon
scripts/                  Deterministic atlas assembly and packaging hooks
tests/                    Renderer/shared Vitest suites
work/                     Generation prompts, selected images and QA evidence
```

## Commands

```bash
npm run dev          # Compile Electron and launch Vite + native windows
npm run dev:web      # Browser-only UI with an in-memory mock bridge
npm run typecheck    # Renderer and Electron TypeScript checks
npm test             # Unit tests; build/release output is excluded
npm run build        # Production renderer and clean Electron build
npm run pack:mac     # Unpacked arm64 .app
npm run dist:mac     # Unsigned arm64 DMG and ZIP
```

`build:electron` deletes stale `dist-electron/` output before compilation and excludes Electron test files from the packaged main process.

## Rebuilding the gaze atlases

The host has two selectable gaze profiles. The native profile is a deterministic
extraction of the accepted v2 rows 9–10:

```bash
python3 scripts/build_native_look_atlas.py \
  --source public/pet/spritesheet.webp \
  --output public/pet/look-16.webp \
  --contact-sheet work/look-16-contact-sheet.png \
  --report work/look-16-validation.json
```

Expected contract: `1536x416`, `8x2`, 16 populated transparent cells of `192x208`.

The enhanced profile is the 96-direction atlas. The source repair, generated
in-betweens and lower-hemisphere seam repair are recorded under
`work/xiaoman-pet-96/`. Every runtime cell is an independent RGBA frame; the
renderer never cross-fades two look frames. The assembler uses shared
scale/baseline registration and the atlas builder writes a `12x8` sheet:

```bash
sh scripts/run_image_python.sh scripts/assemble_look_96.py \
  --generation-manifest work/xiaoman-pet-96/generation-manifest.json \
  --anchors-dir work/xiaoman-pet-96/anchors \
  --generated-dir work/xiaoman-pet-96/relay-output \
  --seam-repairs work/xiaoman-pet-96/relay-output/seam-pairs-15-23.png \
  --reference work/xiaoman-pet-96/generation-inputs/native-color-reference.png \
  --frames-dir work/xiaoman-pet-96/ordered-frames \
  --output public/pet/look-96.webp \
  --metadata public/pet/look-96.json \
  --provenance work/xiaoman-pet-96/assembly-provenance.json
npm run verify:look-96
```

Expected enhanced contract: `2304x1664`, `12x8`, 96 populated transparent
cells, `3.75°` steps, no empty frames, no hidden RGB and no double-exposure
alpha ratios. The final runtime atlas and metadata are already checked in; the
command above is a reproducibility path, not a runtime dependency.

## Rebuilding idle actions

The selected ImageGen sources are `work/idle-actions-30-generated-lick.png`,
`work/idle-actions-30-generated-blink.png`, and the three raised-front-paw
phase sheets under `work/xiaoman-pet-96/relay-output/`. The deterministic build
keeps the accepted lick and blink rows and replaces the legacy scratch rows with
30 independent lift/hold/lower paw frames:

```bash
sh scripts/run_image_python.sh scripts/assemble_paw_action_30.py \
  --base-atlas public/pet/idle-actions-30.webp \
  --paw-lift work/xiaoman-pet-96/relay-output/paw-lift.png \
  --paw-hold work/xiaoman-pet-96/relay-output/paw-hold.png \
  --paw-lower work/xiaoman-pet-96/relay-output/paw-lower.png
npm run verify:idle-atlas
```

Expected contract: `1920x1872`, `10x9`, 90 populated transparent cells, no
hidden RGB, and detected green/magenta edge contamination within the configured
limits. Install the optional tools
with `python3 -m pip install -r requirements-image.txt` when the bundled Codex
runtime is not available.

The prior `look-32.webp` and `look-90.webp` pipelines remain in `work/` and
`public/pet/` for historical provenance only; no runtime profile loads them
directly.

## Testing a local build

Browser mock QA covers forms, profile toggles, feature controls, task composition and responsive control-center layouts. Native QA additionally verifies transparent-window alpha, 30/60Hz cursor tracking, 96/native profile asset selection, configurable hover count, configurable inactivity reset, lower-quadrant continuity, owner-routed native IPC replies, owner-not-found CLI fallback, repeated sends, filtered task identity, explicit CLI queue/resume compatibility, system notifications and packaged resources.

## Distribution

The local release is unsigned/not notarized. Public distribution should add a Developer ID Application certificate, hardened runtime and notarization. No updater is configured.
