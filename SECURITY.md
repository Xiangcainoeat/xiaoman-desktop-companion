# Security

## Runtime security

- Renderer sandbox enabled
- Context isolation enabled
- Node integration disabled
- Typed, allow-listed preload IPC surface
- Content Security Policy in `index.html`
- Atomic owner-only JSON persistence
- The social workspace makes only allow-listed REST/WebSocket requests to the configured social server; other runtime features remain local.
- No Codex configuration or hook writes

## Social server

- The desktop and web clients do not expose a local guest mode. Private social data is served only after authentication.
- Passwords are hashed with scrypt on the server; session tokens are opaque and stored hashed server-side. The desktop client keeps its bearer token in memory.
- The current integration endpoint is HTTP on a dedicated port for development only. Configure HTTPS/WSS and `SOCIAL_COOKIE_SECURE=true` before using real credentials in production.
- Keep `SOCIAL_CORS_ORIGINS` restricted to the deployed desktop/web origins. Do not use `*` with credentialed requests in production.

## Reporting

Do not include private Codex session content, reminder text or local application names in a public issue. Reproduce problems with synthetic data where possible.

## Signing

The included local build is unsigned and not notarized. A public release should use Apple Developer ID signing and Apple notarization before distribution.
