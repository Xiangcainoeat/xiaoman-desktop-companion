# Source: Backbone Game Engine / Super Mario Bros

- Upstream repository: https://github.com/martindrapeau/backbone-game-engine
- Fixed source commit: `2a41299a3895a4fd1fdcaf854579cc13bbe17614`
- Prepared from: `tmp/article-games-20260829/unpacked/backbone-game-engine-gh-pages/super-mario-bros` plus its local `3rd`, `src`, and font dependencies
- Source archive SHA-256: `580f61e3fc0d9c054d4c08b9802e35d189572a061a97806ff06ff99c57fd7051`
- Static entry: `index.html`
- Upstream metadata copied: `LICENSE`, `README.md`

## Offline changes

- Used the `super-mario-bros` subdirectory as the prepared root and copied the exact local Backbone/Underscore/qtree and engine files it loads.
- Rebased the HTML paths from `../` to the prepared root and included the local arcade font files.
- Removed the obsolete AppCache manifest declaration and update/download hook; `offline.appcache` was not copied.
- Fixed the supplied `saveWorld` variable declaration's missing comma so the copied entry parses as JavaScript. Persistence remains the supplied localStorage implementation.
- No new game mechanics or replacement engine code was added.

## Known risks

- The visible Mario characters, sprites, and related imagery are recognizable third-party Nintendo assets; licensing/trademark review is required independently of the included MIT notice.
- This is legacy Backbone/Canvas/touch code. The bundled Backbone history compatibility code still contains an old hidden-iframe fallback, but the game entry does not use it for a top-level external redirect.
