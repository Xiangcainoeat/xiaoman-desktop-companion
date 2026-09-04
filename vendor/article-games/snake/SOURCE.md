# Source: Snake

- Upstream repository: https://github.com/RabiRoshan/snake_game
- Fixed source commit: `a381235802ff2a606ee76ba440c5ed1b7e95b367`
- Prepared from: `tmp/article-games-20260829/unpacked/snake_game-master/docs`
- Source archive SHA-256: `17f752ce056cad31262f354ecc9ca24f704b686d7d1621660f35bf9d1b08f4ba`
- Static entry: `index.html`
- Upstream metadata copied: `LICENSE.md`, `README.md`

## Offline changes

- Used the supplied `docs` build and copied its local HTML, CSS, and JavaScript without adding game code.
- The runtime has no remote script, font, statistics, or iframe redirect dependency. Attribution text remains in the page; external attribution URLs were flattened to text.

## Known risks

- The MIT notice covers the upstream code; review any separately bundled browser/font or branding rights if the page is redistributed.
- The original restart behavior calls `window.location.reload()` after a collision, which reloads the local page and is intentional.
