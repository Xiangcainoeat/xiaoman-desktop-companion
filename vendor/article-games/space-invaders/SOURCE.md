# Source: Space Invaders

- Upstream repository: https://github.com/StrykerKKD/SpaceInvaders
- Fixed source commit: `6de3f7cfe5ec0cc07e8a437bd80af7b6246c3c1d`
- Prepared from: `tmp/article-games-20260829/unpacked/SpaceInvaders-master/indexOpt.html` and its local assets
- Source archive SHA-256: `ba55369e061053ef63b9fac85d1115b2e724b816872bcd2318a9088361894b46`
- Static entry: `index.html`
- Upstream metadata copied: `LICENSE`, `README.md`

## Offline changes

- Renamed the supplied optimized `indexOpt.html` to the prepared root `index.html`.
- Copied the optimized RequireJS entry, built bundle, local loader CSS, and all referenced image assets.
- Did not copy the unused development source modules or introduce a replacement implementation.

## Known risks

- The optimized bundle includes an old Phaser runtime and third-party bundled code; its license/notice obligations should be reviewed independently.
- The MIT notice covers the upstream project, but the image assets and any bundled library content may have separate provenance.
