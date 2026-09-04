# International Chess Source

- Upstream: https://github.com/lichess-org/lila
- Article alias: `ornicar/lila`
- Pinned commit: `9b49f37fe9d953c85dae12bbc159a0bf721a9fca`
- License: AGPL-3.0
- Runtime: no local directory by design; the catalog opens
  `https://lichess.org/` in the system browser.
- Boundary: Lila is a full Scala/Play service with server, database, Redis,
  WebSocket and engine infrastructure. Copying its repository into a static
  iframe would not produce an honest offline game, so no server source is
  shipped as a fake local runtime.
