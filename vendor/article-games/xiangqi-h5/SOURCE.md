# Source: Xiangqi H5

- Upstream repository: https://github.com/itlwei/Chess
- Fixed source commit: `e8b4c0fea5220e08528286b157caa8f884f62505`
- Prepared from: `tmp/vendor/itlwei-chess-unpacked-20260829/Chess-master`
- Source archive SHA-256: `6c69f436f990750f06b86d0800c5284eede35574b2ba4eb10e73a4467bc1ca53`
- Static entry: `index.html`
- Upstream metadata copied: `LICENSE`, `README.md`

## Offline changes

- Copied the local HTML5 board, scripts, opening-book data, CSS, audio, and all three local piece/board skins.
- Removed the `cordova-2.2.0.js` script tag because that file is absent from the supplied source tree.
- Kept the original local XHR load of `js/gambit.all.js`; this is a local dependency and not a remote request.
- No new chess engine or game implementation was introduced.

## Known risks

- The opening book is loaded with XMLHttpRequest, so this entry should be served from a static HTTP(S) origin; browsers commonly block that request when the page is opened directly as `file://`.
- The supplied legacy stylesheet contains an apparently mis-encoded font-family declaration and may fall back to a system font.
- The MIT notice covers the supplied project; the Chinese-chess artwork, backgrounds, audio, and opening data should be reviewed for separate rights.
