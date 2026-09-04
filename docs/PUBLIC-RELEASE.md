# Public Release

This repository contains the source and reproducible build inputs for Xiaoman Desktop
Companion. The public tree is intentionally separated from private authoring material,
credentials, reference photos and runtime databases.

## Desktop room mode

The production desktop application uses the server-backed room transport only. It does
not offer a local guest/demo mode. Users must log in or register before server-backed room
data is loaded. The room workspace provides single-player games, online rooms, room
invitations and a personal room list; it does not expose a friend list, groups or chat. The
local transport implementation is retained solely as an injected test fixture for client state
and protocol tests; it is not part of the default factory or a user-facing option.

The current integration service is deployed at:

```text
http://47.97.219.242:18080
```

This endpoint is HTTP-only integration infrastructure. Do not use a real password there.
Before production credentials are accepted, put the service behind HTTPS/WSS, enable
`SOCIAL_COOKIE_SECURE=true`, and replace the default CORS allow-list with the actual origins.

The hosted web surface contains interactive games and server-backed room play only.
Codex sessions, local context, pet-pack management, care, reminders, application events and
desktop preferences are available only in the downloaded Electron application.

## Reproduce

```bash
npm ci
npm run typecheck
npm test
npm run server:test
npm run build
```

The server can be run independently:

```bash
cd server
npm ci
npm start
```

For a container deployment, build only the `xiaoman-social` service from
`server/docker-compose.yml`. Do not run a host-wide Compose shutdown: the target host may
contain unrelated applications and databases.

## Publish boundary

- `server/src/` and `server/tests/` are source and regression tests.
- `public/` is the desktop renderer's source asset tree; the server's `public/` directory is
  generated from `dist/` during deployment and is ignored by Git.
- `server/data/` is runtime state and is never committed.
- Pet reference images, image API keys, private relay configuration, local Codex state,
  generated packages and temporary QA material stay outside the public release.
- Third-party game sources and license boundaries are documented in
  [`THIRD_PARTY_NOTICES.md`](../THIRD_PARTY_NOTICES.md) and [`GAMES.md`](GAMES.md).

## Verification

The release gate is the combination of client type checks, serialized Vitest runs, server
Node tests, a production Vite/Electron build, and a remote health/auth/room smoke test.
The installed macOS bundle is verified separately because packaging and LaunchServices are
host-specific.
