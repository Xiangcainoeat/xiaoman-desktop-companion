# Bundled Article Games

This directory records the upstream provenance for the 10 entries shown by
the public Xiaoman game catalog. The runtime copies live under
`public/article-games/<id>/`; they are static assets and are not imported into
the React bundle.

| ID | Upstream | Commit | License | Runtime | Distribution note |
| --- | --- | --- | --- | --- | --- |
| `pacman` | [mumuy/pacman](https://github.com/mumuy/pacman) | `8a96194f7cf0102db2d7f0e69450166beb1d7116` | MIT | local | Static page localized and made self-contained |
| `react-tetris` | [chvin/react-tetris](https://github.com/chvin/react-tetris) | `89435b72f127b67f95870c515a130cbff38fd7cf` | Apache-2.0 | local | Checked-in `docs` build used; page language localized |
| `battle-city` | [feichao93/battle-city](https://github.com/feichao93/battle-city) | `745c369af6d4a02c71560265fd9448518e99c18d` | MIT | local | Article's old `shinima/battle-city` link normalized to current repository |
| `international-chess` | [lichess-org/lila](https://github.com/lichess-org/lila) | `9b49f37fe9d953c85dae12bbc159a0bf721a9fca` | AGPL-3.0 | online | Full Lila service is not bundled; the app opens `https://lichess.org/` |
| `star-battle` | [gd4Ark/star-battle](https://github.com/gd4Ark/star-battle) | `b600e9e91012886f6273d6b3c91d6ab83b5eecad` | MIT | local | Static page localized; original local assets retained |
| `space-invaders` | [StrykerKKD/SpaceInvaders](https://github.com/StrykerKKD/SpaceInvaders) | `6de3f7cfe5ec0cc07e8a437bd80af7b6246c3c1d` | MIT | local | Checked-in optimized build used |
| `snake` | [RabiRoshan/snake_game](https://github.com/RabiRoshan/snake_game) | `a381235802ff2a606ee76ba440c5ed1b7e95b367` | MIT | local | `docs` page copied and visible labels localized |
| `super-mario-bros` | [martindrapeau/backbone-game-engine](https://github.com/martindrapeau/backbone-game-engine) | `2a41299a3895a4fd1fdcaf854579cc13bbe17614` | MIT | local | `super-mario-bros` page flattened so relative assets work in the host |
| `2048` | [gabrielecirulli/2048](https://github.com/gabrielecirulli/2048) | `478b6ec346e3787f589e4af751378d06ded4cbbc` | MIT | local | Static page localized; local fonts and assets retained |
| `xiangqi-h5` | [itlwei/Chess](https://github.com/itlwei/Chess) | `e8b4c0fea5220e08528286b157caa8f884f62505` | MIT | local | Retained at the user's request; local assets and three AI levels preserved |

Each subdirectory contains the relevant upstream source snapshot or license
files used to assemble the runtime. No project is presented as Xiaoman's
original work. The exact source and local-change notes are in the adjacent
`SOURCE.md` files.

The previously reviewed sliding-puzzle candidate is deliberately absent from
this public tree because the supplied snapshot did not include a declared
redistribution license. Its omission is a distribution decision, not a claim
that the upstream project is invalid.

## Runtime boundary

Electron serves only `public/article-games` from a random-port loopback HTTP
server. The catalog embeds one selected offline page in a sandboxed iframe.
The Lila entry is intentionally an external online handoff because its source
repository is a complete server application rather than a self-contained HTML
game.
