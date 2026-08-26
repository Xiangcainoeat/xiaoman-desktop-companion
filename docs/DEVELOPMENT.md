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

The enhanced profile is the 90-direction atlas. The source repair and the
generated transition overrides are recorded under `work/xiaoman-pet-90/`.
The resampler uses shared scale/baseline registration and premultiplied alpha
interpolation, then the atlas builder writes a `10x9` sheet:

```bash
sh scripts/run_image_python.sh scripts/resample_look_directions.py \
  --input work/xiaoman-pet-90/relay-output/look-32-source-repaired.png \
  --output-dir work/xiaoman-pet-90/frames-90-v2 \
  --provenance work/xiaoman-pet-90/resampling-provenance.json \
  --transition 172=work/xiaoman-pet-90/transition-output/look-172.png \
  --transition 176=work/xiaoman-pet-90/transition-output/look-176.png \
  --transition 260=work/xiaoman-pet-90/transition-output-v2/look-260.png \
  --transition 264=work/xiaoman-pet-90/transition-output-v2/look-264.png \
  --transition 268=work/xiaoman-pet-90/transition-output-v2/look-268.png \
  --transition 352=work/xiaoman-pet-90/transition-output/look-352.png \
  --transition 356=work/xiaoman-pet-90/transition-output/look-356.png
npm run verify:look-90
```

Expected enhanced contract: `1920x1872`, `10x9`, 90 populated transparent
cells, `4°` steps, no empty frames and edge contamination within the report
limits. The final runtime atlas and metadata are already checked in; the
command above is a reproducibility path, not a runtime dependency.

## Rebuilding idle actions

The selected ImageGen sources are `work/idle-actions-30-generated-lick.png`,
`work/idle-actions-30-generated-blink.png`, and
`work/idle-actions-30-generated-scratch.png`. The deterministic build extracts
30 frames per action and assembles a `10x9` atlas:

```bash
sh scripts/run_image_python.sh scripts/build_idle_atlas_30.py \
  --lick work/idle-actions-30-generated-lick.png \
  --blink work/idle-actions-30-generated-blink.png \
  --scratch work/idle-actions-30-generated-scratch.png
npm run verify:idle-atlas
```

Expected contract: `1920x1872`, `10x9`, 90 populated transparent cells, no
hidden RGB, and detected green/magenta edge contamination within the configured
limits. Install the optional tools
with `python3 -m pip install -r requirements-image.txt` when the bundled Codex
runtime is not available.

The prior `look-32.webp` pipeline remains in `work/` for provenance only; no
runtime profile loads it directly.

## Testing a local build

Browser mock QA covers forms, profile toggles, feature controls, task composition and responsive control-center layouts. Native QA additionally verifies transparent-window alpha, 30/60Hz cursor tracking, 90/native profile asset selection, inactivity reset, lower-quadrant continuity, owner-routed native IPC replies, repeated sends, filtered task identity, explicit CLI queue/resume compatibility, system notifications and packaged resources.

## Distribution

The local release is unsigned/not notarized. Public distribution should add a Developer ID Application certificate, hardened runtime and notarization. No updater is configured.
