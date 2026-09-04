# Source: 2048

- Upstream repository: https://github.com/gabrielecirulli/2048
- Fixed source commit: `478b6ec346e3787f589e4af751378d06ded4cbbc`
- Prepared from: `tmp/article-games-20260829/unpacked/2048-master`
- Source archive SHA-256: `44ecf1c5a87256b46239db5c9c9c825cf90bcdda906b67948f4b6943356f5cf1`
- Static entry: `index.html`
- Upstream metadata copied: `LICENSE.txt`, `README.md`

## Offline changes

- Copied the browser runtime only: local JavaScript, CSS, Clear Sans font files, favicon, and mobile metadata images.
- Kept the upstream game implementation unchanged. The local font files are available under `style/fonts/`, which is the path used by `style/main.css`.
- No analytics or remote runtime script was present in the selected entry.
- Flattened the external attribution/body links to local text so they are not runtime navigation targets.

## Known risks

- Attribution text from the upstream HTML remains, but the external URLs were flattened to text and are not loaded as runtime dependencies.
- The MIT notice covers the upstream project, while the bundled Clear Sans font files and inherited game assets should be reviewed separately for redistribution terms.
