# Source: React Tetris

- Upstream repository: https://github.com/chvin/react-tetris
- Fixed source commit: `89435b72f127b67f95870c515a130cbff38fd7cf`
- Prepared from: `tmp/article-games-20260829/unpacked/react-tetris-master/docs`
- Source archive SHA-256: `ad9a52d7250a60c71ff0e58648047569390b1f8255af10a1f1c58de4c61d95f5`
- Static entry: `index.html`
- Upstream metadata copied: `README.md`, `README-EN.md`

## Offline changes

- Used the repository's published `docs` build exactly as the runtime source, including its local JavaScript, CSS, maps, loader stylesheet, and music file.
- Replaced the generated CSS background that pointed at `img.alicdn.com` with `background: none`.
- Removed the two generated GitHub social iframes (`ghbtns.com`) and their external link from the compiled guide panel.
- No new React or game implementation was introduced.

## Known risks

- There is no standalone upstream `LICENSE` file in the supplied tree; the source `package.json` declares Apache-2.0, and bundled dependency notices should be reviewed before redistribution.
- The docs build is a prebuilt artifact and may contain third-party code, documentation URLs, and media licensing obligations even though its runtime assets are local.
