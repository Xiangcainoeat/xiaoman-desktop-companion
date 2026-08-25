# Delivery

The clean release directory is both a GitHub-ready source repository and a complete local delivery. It separates versioned source from installable artifacts.

## Repository contents

```text
electron/                 Electron main process and local integrations
src/                      React UI, overlay, shared domain and interaction logic
public/pet/               Runtime artwork, canonical look atlas and idle atlas
scripts/                  Deterministic atlas assembly and packaging hooks
tests/                    Unit tests
work/                     Prompts, generated sources, validation and QA evidence
codex-pet/                Native Codex package plus reusable hatch-pet workflow
release/                  DMG, app ZIP, source archive and SHA-256 checksums
```

`codex-pet/` is copied from the independently validated Xiaoman Codex release. Its `pet/xiaoman/` directory is the exact two-file runtime package. Its `SKILL.md`, scripts, tests, references and worked example are the reusable Codex authoring delivery.

## Dependencies and GitHub

Commit `package.json` and `package-lock.json`; they pin the dependency graph and are required for reproducible installation. Do not commit `node_modules/`, `dist/` or `dist-electron/`; `npm ci` recreates them.

Large DMG/ZIP files should be attached as GitHub Release assets with `release/SHA256SUMS`, not kept in normal Git history. The source archive can be attached to the same release.

## Installable outputs

- `release/Xiaoman-Desktop-Companion-1.1.0-arm64.dmg`
- `release/Xiaoman-Desktop-Companion-1.1.0-arm64.zip`
- `release/xiaoman-desktop-companion-source-v1.1.0.zip`
- `codex-pet/release/xiaoman-codex-install.zip`

The desktop host targets Apple Silicon and macOS 13 or later. It is ad-hoc/unsigned for local distribution and is not notarized. The native Codex package does not require the host and continues to work when the host is absent or closed.

## Rebuild

```bash
npm ci
npm run typecheck
npm test
npm run dist:mac
```

See `work/README.md` for image-generation provenance and deterministic atlas reproduction.
