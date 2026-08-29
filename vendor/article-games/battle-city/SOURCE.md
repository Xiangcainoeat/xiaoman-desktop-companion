# Source: Battle City

- Upstream repository: https://github.com/feichao93/battle-city
- Historical repository/author link: `shinima/battle-city` (redirects to the canonical repository above)
- Fixed source commit: `745c369af6d4a02c71560265fd9448518e99c18d`
- Prepared from: `tmp/article-games-20260829/unpacked/battle-city-master/build/0.3.0`
- Source archive SHA-256: `85491847d143f03a483e8a032ba83bb816d70525035309c83c5a43ae2b672c25`
- Static entry: `index.html`
- Upstream metadata copied: `LICENSE`, `readme.md`

## Offline changes

- Used only the `build/0.3.0` browser build and copied all of its local `sound/*.ogg` dependencies; stage data is embedded in the compiled JavaScript.
- Removed the external GitHub corner link from the HTML.
- Replaced the two compiled source-viewer `window.open` callbacks with no-ops so gameplay cannot open the upstream site from those controls.
- Did not add a replacement implementation.

## Known risks

- The JavaScript is a large minified production bundle, so its dependency inventory is less transparent than source code.
- Browser audio policies may require a user gesture before sounds play. The MIT notice and bundled sound/resource provenance should be reviewed separately.
- The supplied build has no root favicon, so a browser may make a harmless `/favicon.ico` request when served over HTTP; this is not a game dependency.
