# Development

## Source layout

```text
electron/                 Electron main process, monitors, store and preload
src/components/           Overlay and control-center React views
src/shared/               Shared types and pure domain functions
public/pet/                Runtime pet atlases and tray icon
scripts/                   Deterministic gaze-atlas assembly
tests/                     Vitest domain and Codex-event tests
work/                      Gaze generation prompt and QA intermediates
```

## Commands

```bash
npm run dev          # Compile Electron and launch Vite + native windows
npm run dev:web      # Browser-only UI with an in-memory mock bridge
npm run typecheck    # Renderer and Electron TypeScript checks
npm test             # Unit tests
npm run build        # Production renderer and Electron build
npm run pack:mac     # Unpacked arm64 .app
npm run dist:mac     # Unsigned arm64 DMG and ZIP
```

## Rebuilding the 32-direction atlas

The selected relay result is `work/gaze-32-generated.png`. The deterministic step detects foreground rows and pose columns, removes chroma, suppresses spill, normalizes scale and registration, and validates all 32 cells.

```bash
python3 scripts/build_gaze_atlas.py \
  --source work/gaze-32-generated.png \
  --output public/pet/look-32.webp \
  --contact-sheet work/gaze-32-contact-sheet.png \
  --report work/gaze-32-validation.json
```

Expected output contract:

- dimensions: `1536x832`
- grid: `8x4`
- cell: `192x208`
- directions: 32 clockwise frames at 11.25-degree increments
- transparent background
- zero detected green-spill pixels

## Testing a local build

The browser-only mock supports all forms and interaction states. Native QA must additionally verify transparent-window alpha, menu-bar creation, persisted data permissions, system notifications and session/app monitors.

## Distribution

The local release is unsigned. Public distribution should add an Apple Developer ID Application certificate, hardened runtime and notarization. No updater is configured.
