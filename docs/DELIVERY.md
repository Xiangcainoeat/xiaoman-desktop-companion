# Delivery

The clean release directory is both a GitHub-ready source repository and a complete local delivery. It intentionally separates versioned source from large installable artifacts.

## Repository contents

```text
electron/                 Electron main process and local integrations
src/                      React UI, overlay, state and interaction logic
public/pet/               Runtime pet artwork, including the 32-direction atlas
scripts/                  Deterministic atlas assembly and packaging hooks
tests/                    Unit tests
work/                     Generation prompt, selected result and QA evidence
codex-pet/                Native Codex package plus reusable hatch-pet workflow
release/                  DMG, ZIP, source archive and SHA-256 checksums
```

`codex-pet/` is copied from the independently validated Xiaoman Codex release. Its `pet/xiaoman/` directory is the exact two-file runtime package. Its `SKILL.md`, scripts, tests, references and worked example are the reusable Codex authoring delivery.

## Dependencies and GitHub

Commit `package.json` and `package-lock.json`. They are small, reviewable and pin the dependency graph. Do not commit `node_modules/`, `dist/` or `dist-electron/`; `npm ci` recreates them.

The unsigned DMG and application ZIP are larger than GitHub's normal per-file repository limit. Keep them out of Git history and upload them as GitHub Release assets together with `release/SHA256SUMS`. The source archive can be attached to the same release.

## Installable outputs

- `release/Xiaoman-Desktop-Companion-1.0.0-arm64.dmg`
- `release/Xiaoman-Desktop-Companion-1.0.0-arm64.zip`
- `release/xiaoman-desktop-companion-source-v1.0.0.zip`
- `codex-pet/release/xiaoman-codex-install.zip`

The desktop host targets Apple Silicon and macOS 13 or later. It is unsigned and not notarized. The native Codex package does not require the host and continues to work when the host is absent or closed.

## Rebuild

```bash
npm ci
npm run typecheck
npm test
npm run dist:mac
```

See `work/README.md` for visual-generation provenance and deterministic atlas reproduction.
