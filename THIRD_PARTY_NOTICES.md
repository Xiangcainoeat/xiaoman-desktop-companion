# Third-Party Notices

小满桌面伴侣是桌宠应用。应用代码使用 MIT License；以下项目是独立的上游来源，
不属于小满原创。每个已分发快照都保留对应的来源说明、固定提交和许可证文件。

## Application dependencies

| Package | License |
| --- | --- |
| Electron | MIT |
| React / React DOM | MIT |
| Lucide React | ISC |
| Chokidar | MIT |
| Vite | MIT |
| Tailwind CSS / `@tailwindcss/vite` | MIT |
| TypeScript | Apache-2.0 |
| Vitest | MIT |
| electron-builder | MIT |
| tsx | MIT |

The complete npm dependency graph is pinned in `package-lock.json`. Static
game pages are not installed as npm dependencies.

## Game sources

| Catalog source | Upstream | License evidence | Public runtime |
| --- | --- | --- | --- |
| 吃豆人 | [mumuy/pacman](https://github.com/mumuy/pacman) | MIT | `public/article-games/pacman/` |
| 俄罗斯方块 | [chvin/react-tetris](https://github.com/chvin/react-tetris) | Apache-2.0 in upstream package metadata | `public/article-games/react-tetris/` |
| 坦克大战 | [shinima/battle-city](https://github.com/shinima/battle-city) | MIT | `public/article-games/battle-city/` |
| 星际大战 | [gd4Ark/star-battle](https://github.com/gd4Ark/star-battle) | MIT | `public/article-games/star-battle/` |
| 太空侵略者 | [StrykerKKD/SpaceInvaders](https://github.com/StrykerKKD/SpaceInvaders) | MIT | `public/article-games/space-invaders/` |
| 贪吃蛇 | [RabiRoshan/snake_game](https://github.com/RabiRoshan/snake_game) | MIT | `public/article-games/snake/` |
| 超级马里奥 | [martindrapeau/backbone-game-engine](https://github.com/martindrapeau/backbone-game-engine) | MIT for upstream code; media rights require independent review | `public/article-games/super-mario-bros/` |
| 2048 | [gabrielecirulli/2048](https://github.com/gabrielecirulli/2048) | MIT | `public/article-games/2048/` |
| 中国象棋（H5） | [itlwei/Chess](https://github.com/itlwei/Chess) | MIT | `public/article-games/xiangqi-h5/` |
| 国际象棋 | [lichess-org/lila](https://github.com/lichess-org/lila) | AGPL-3.0 | Online handoff only |

The upstream files and local modifications are recorded in
[`vendor/article-games/`](vendor/article-games/). Attribution and license
notices must remain with any redistributed upstream code. MIT or Apache-2.0
code licenses do not automatically settle the rights to recognizable
characters, trademarks, fonts, music, or other inherited media.

## Deliberately excluded snapshot

The pinned `gamedolphin/sliding_puzzle` snapshot has no declared upstream
license in the supplied source. Its provenance remains in the source review
notes, but its runtime files are excluded from the public export until the
copyright holder provides a redistributable license. The public release does
not silently relicense or present that code as original work.

Lichess is a complete online service with server-side dependencies. The app
opens the official site in the system browser and does not copy its server code
into a local iframe.
