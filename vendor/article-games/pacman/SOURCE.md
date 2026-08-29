# Source: Pac-Man

- Upstream repository: https://github.com/mumuy/pacman
- Fixed source commit: `8a96194f7cf0102db2d7f0e69450166beb1d7116`
- Prepared from: `tmp/article-games-20260829/unpacked/pacman-master`
- Source archive SHA-256: `b7eafffd3deaf8053b7c63b20e0367f73eea33af71943312551c85075a75f539`
- Static entry: `index.html`
- Upstream metadata copied: `LICENSE`, `README.md`

## Offline changes

- Retained the local canvas game, scripts, stylesheet, favicon, and `PressStart2P.ttf` font.
- Removed the remote public stylesheet, canonical/branding assets, social-button and project scripts, statistics script, and remote image references from the HTML.
- Removed the delayed host redirect and the top-level iframe escape code from the HTML.
- Removed the canvas copyright click handler that opened the upstream website.
- Replaced the removed site chrome with local text and a local fragment link; no game logic was added.

## Known risks

- The original page depended on the removed remote common stylesheet for some surrounding layout and CSS variables, so the shell styling is intentionally reduced.
- The README and source attribution mention the upstream site and may not match every bundled asset; review the MIT notice, font terms, and branding separately.
