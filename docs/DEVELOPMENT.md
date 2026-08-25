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

## Rebuilding the production gaze atlas

The runtime uses the exact accepted native direction cells from rows 9–10:

```bash
python3 scripts/build_native_look_atlas.py \
  --source public/pet/spritesheet.webp \
  --output public/pet/look-16.webp \
  --contact-sheet work/look-16-contact-sheet.png \
  --report work/look-16-validation.json
```

Expected contract: `1536x416`, `8x2`, 16 populated transparent cells of `192x208`.

## Rebuilding idle actions

The selected ImageGen output is `work/idle-actions-generated-v2.png`. The deterministic build extracts and validates 24 cells:

```bash
python3 scripts/build_idle_atlas.py \
  --source work/idle-actions-generated-v2.png \
  --output public/pet/idle-actions.webp \
  --contact-sheet work/idle-actions-contact-sheet.png \
  --report work/idle-actions-validation.json
```

Expected contract: `1536x624`, `8x3`, 24 populated transparent cells, no detected green residue.

The prior `look-32.webp` pipeline and its prompt remain in `work/` for provenance only; v1.1 does not load that atlas.

## Testing a local build

Browser mock QA covers forms, feature toggles, task composition and responsive control-center layouts. Native QA additionally verifies transparent-window alpha, 320x360 and expanded overlay bounds, menu bar creation, persisted data permissions, real cursor tracking, inactivity reset, CLI queue/resume behavior, system notifications and packaged resources.

## Distribution

The local release is unsigned/not notarized. Public distribution should add a Developer ID Application certificate, hardened runtime and notarization. No updater is configured.
