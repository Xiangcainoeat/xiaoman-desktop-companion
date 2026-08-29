# Security

## Runtime security

- Renderer sandbox enabled
- Context isolation enabled
- Node integration disabled
- Typed, allow-listed preload IPC surface
- Content Security Policy in `index.html`
- Atomic owner-only JSON persistence
- No runtime network requests or remote content
- No Codex configuration or hook writes

## Reporting

Do not include private Codex session content, reminder text or local application names in a public issue. Reproduce problems with synthetic data where possible.

## Signing

The included local build is unsigned and not notarized. A public release should use Apple Developer ID signing and Apple notarization before distribution.
