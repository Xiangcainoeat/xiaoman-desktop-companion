# Delivery

The clean release directory is both a GitHub-ready source repository and a complete local delivery. It separates versioned source from installable artifacts.

## Repository contents

```text
electron/                 Electron main process and local integrations
src/                      React UI, overlay, shared domain and interaction logic
public/pet/                Runtime artwork, enhanced 96-direction body atlas and idle atlas
public/pet/native/         Byte-preserved native Codex profile resources
public/game/               Original fish and bubble targets for local games
scripts/                  Deterministic atlas assembly and packaging hooks
tests/                    Unit tests
work/                     Prompts, generated sources, validation and QA evidence
codex-pet/                Native Codex package plus reusable hatch-pet workflow
release/                  DMG, app ZIP, source archive and SHA-256 checksums
```

`codex-pet/` is copied from the independently validated Xiaoman Codex release. Its `pet/xiaoman/` directory is the exact two-file runtime package. Its `SKILL.md`, scripts, tests, references and worked example are the reusable Codex authoring delivery.

## Dependencies and GitHub

Commit `package.json` and `package-lock.json`; they pin the dependency graph and are required for reproducible installation. Do not commit `node_modules/`, `dist/` or `dist-electron/`; `npm ci` recreates them.

`requirements-image.txt` is optional and applies only to deterministic artwork
rebuild/verification. The final desktop application does not depend on Python,
numpy, or Pillow.

Large DMG/ZIP files should be attached as GitHub Release assets with `release/SHA256SUMS`, not kept in normal Git history. The source archive can be attached to the same release.

## Installable outputs

- `release/Xiaoman-Desktop-Companion-1.4.0-arm64.dmg`
- `release/Xiaoman-Desktop-Companion-1.4.0-arm64.zip`
- `release/xiaoman-desktop-companion-source-v1.4.0.zip`
- `codex-pet/release/xiaoman-codex-install.zip`

The desktop host targets Apple Silicon and macOS 13 or later. It is ad-hoc/unsigned for local distribution and is not notarized. The native Codex package does not require the host and continues to work when the host is absent or closed.

The host has two independent pet profiles. `enhanced` loads the complete `public/pet/look-96.webp` body atlas plus the host idle-action atlas; each gaze direction is one coherent full-body frame. `native` loads `public/pet/native/pet.json`, `spritesheet.webp` and `look-16.webp`; the hashes are recorded in `release/qa/native-profile-hashes.json`. Switching profiles changes only host rendering. It does not install, replace or mutate the two files under `~/.codex/pets/xiaoman`.

Version 1.4.0 adds the local care economy: four inventory-backed foods, cleanliness and bathing, one active job with offline settlement, five daily quests, weighted gift boxes, idempotent Codex completion rewards and three bounded mini-games. The control center keeps these in separate `养成照料` and `互动游戏` views; `概览` shows only a read-only summary and handoff.

The care and sleep atlases are deterministic 30-frame RGBA resources. Run `npm run verify:care-atlas` to validate dimensions, transparency, frame occupancy and edge contamination. Game target sources and the extraction script are retained under `work/xiaoman-care-assets/` and `scripts/extract_game_targets.py`; the application itself does not require Python or Pillow.

The default Codex reply channel is native IPC. It discovers the exact owner of the selected thread through `~/.codex/ipc/ipc.sock` and sends the text to that existing window. CLI queue/resume remains available only after selecting `CLI 兼容` in settings. Native reply smoke-test scope and the known platform boundary are recorded in `release/qa/native-reply-smoke-test.md`.

## Rebuild

```bash
npm ci
npm run typecheck
npm test
npm run dist:mac
npm run verify:look-96
npm run verify:care-atlas
```

See `work/README.md` for image-generation provenance and deterministic atlas reproduction.
