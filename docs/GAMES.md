# 文章游戏目录

小满的“互动游戏”页保留文章列出的十个项目，并加上用户指定保留的 H5
象棋仓库，共 11 个上游入口；另外提供一个应用内原生五子棋棋盘。因此单机页
当前显示 12 个入口。左侧“联机游戏”页另提供参考站点目录中的 16 个 WebSocket
双人棋类房间。旧版自研 H5、旧独立窗口游戏和旧回退入口已经删除，不再参与构建。

## 11 个上游入口

| 顺序 | ID | 中文名 | 运行方式 | 上游项目 |
| ---: | --- | --- | --- | --- |
| 1 | `pacman` | 吃豆人 | 服务器托管 | [mumuy/pacman](https://github.com/mumuy/pacman) |
| 2 | `react-tetris` | 俄罗斯方块 | 服务器托管 | [chvin/react-tetris](https://github.com/chvin/react-tetris) |
| 3 | `battle-city` | 坦克大战 | 服务器托管 | [feichao93/battle-city](https://github.com/feichao93/battle-city) |
| 4 | `international-chess` | 国际象棋 | 官方在线页 | [lichess-org/lila](https://github.com/lichess-org/lila) |
| 5 | `star-battle` | 星际大战 | 服务器托管 | [gd4Ark/star-battle](https://github.com/gd4Ark/star-battle) |
| 6 | `space-invaders` | 太空侵略者 | 服务器托管 | [StrykerKKD/SpaceInvaders](https://github.com/StrykerKKD/SpaceInvaders) |
| 7 | `snake` | 贪吃蛇 | 服务器托管 | [RabiRoshan/snake_game](https://github.com/RabiRoshan/snake_game) |
| 8 | `super-mario-bros` | 超级马里奥 | 服务器托管 | [martindrapeau/backbone-game-engine](https://github.com/martindrapeau/backbone-game-engine) |
| 9 | `2048` | 2048 | 服务器托管 | [gabrielecirulli/2048](https://github.com/gabrielecirulli/2048) |
| 10 | `sliding-puzzle` | 滑块拼图 | 服务器托管 | [gamedolphin/sliding_puzzle](https://github.com/gamedolphin/sliding_puzzle) |
| 11 | `xiangqi-h5` | 中国象棋（H5） | 服务器托管 | [itlwei/Chess](https://github.com/itlwei/Chess) |

文章原始链接是 [CSDN 的 HTML5 游戏整理](https://blog.csdn.net/ZackSock/article/details/103450186)。
文章中的历史仓库链接如果发生转移，目录使用当前可解析的规范仓库，
固定 commit 和原始链接记录在 `vendor/article-games/*/SOURCE.md`。

## 原生五子棋

`gomoku-native` 不依赖第三方 iframe，使用应用内 React 棋盘和
[`src/gomoku/logic.ts`](../src/gomoku/logic.ts) 的规则/AI 模块。棋盘为 15×15，
支持人机对战、本机双人、简单/普通/困难/大师四档难度、选择执棋方、提示、悔棋、
暂停、重开和游戏静音；打开“联机房间”会进入房间工作区。服务器房间协议
覆盖下表所列的 16 个联机棋类，使用统一的创建房间、加入、准备、WebSocket 走子、恢复
和再来一局流程。

## 16 个联机棋类

联机目录与参考站点 [FreePlayIsOK 联机房间页](https://freeplayisok.com/zh/rooms)
保持同序，客户端定义在 [`src/online-games/catalog.ts`](../src/online-games/catalog.ts)，
服务端定义在 [`server/src/online-game-rules.js`](../server/src/online-game-rules.js)。

| ID | 中文名 | 棋盘/玩法入口 |
| --- | --- | --- |
| `gomoku` | 五子棋 | 15×15，五子连线 |
| `tic-tac-toe` | 井字棋 | 3×3，三子连线 |
| `chess` | 国际象棋 | 8×8，基础棋子走法 |
| `reversi` | 黑白棋 | 8×8，夹子翻转 |
| `checkers` | 跳棋 | 8×8，斜线跳吃 |
| `xiangqi` | 中国象棋 | 9×10，红黑轮流 |
| `go` | 围棋 | 9×9，落子与提子 |
| `shogi` | 日本将棋 | 9×9，基础走法 |
| `connect6` | 六子棋 | 19×19，每回合一至两子 |
| `ludo` | 飞行棋 | 轨道与四枚棋子 |
| `animal-chess` | 斗兽棋 | 8×4，动物棋子 |
| `army-chess` | 军棋 | 5×12，回合制移动 |
| `backgammon` | 双陆棋 | 24 点位与收棋区 |
| `dots-and-boxes` | 点格棋 | 4×4 点阵连线 |
| `mancala` | 播棋 | 六坑一仓播撒 |
| `chinese-checkers` | 中国跳棋 | 星形孔位跳跃 |

## 运行边界

React 控制中心负责目录、中文元数据、打开/关闭和状态提示；构建后的服务器网页把
`public/article-games/` 提供给 iframe，Electron 桌面端使用同一个服务器地址，不再启动
本地静态游戏宿主。已打开的游戏会保留为顶部标签页，切换时只隐藏非活动页面并释放它的
输入焦点；这样切回去时仍保留棋盘、分数和进行中的局面。共享适配器会暂停
后台页面的 HTML 音频、视频和 Phaser 音效，恢复标签页时再还原原本的静音状态。

服务器入口使用 `sandbox` iframe，允许脚本、表单、音频、指针锁和本地存储，
但不允许页面接管主窗口或打开应用内第二个游戏窗口。游戏自己的规则、AI、
关卡和输入方式保持上游行为，不虚构统一的分数或难度协议。

国际象棋对应的 Lila 是完整的在线服务端，不是一个可以复制成单 HTML 的
离线游戏。该卡片明确标记“需要网络”，按钮通过系统浏览器打开
`https://lichess.org/`；应用不会把远程页面伪装成本机已内置资源。

## 本地修改

- 所有服务器入口补充 `zh-CN` 或中文标题，并保留各自的原始游戏逻辑。
- Pacman、俄罗斯方块和坦克大战移除运行时外链/社交组件，避免静态页在
  托管页面中自动跳出应用。
- 所有服务器入口接入统一键盘转发和生命周期适配器；方向键、空格及常用 WASD
  键由宿主转发，非活动标签不会继续播放游戏音频。
- Space Invaders 使用上游提交的优化构建；坦克大战使用 `build/0.3.0`。
- 超级马里奥保留 `3rd/`、`src/` 和关卡资源，重写扁平化后的相对路径，
  不依赖已经废弃的 AppCache 更新按钮。
- H5 象棋保留棋盘皮肤、音效、开局库和三档 AI，移除不存在的 Cordova 脚本，
  由同源服务器满足其 XHR 初始化条件。
- 手机端按 760px/粗指针自动选择移动模式，也可手动切换；键盘型游戏的触控按钮位于
  iframe 外，点击型游戏直接使用原棋盘触摸事件。

完整来源、固定提交、许可证和已知风险见
[`vendor/article-games/README.md`](../vendor/article-games/README.md)。

## 验证

```bash
npm ci
npm run typecheck
npm test
npm run build
```

用于服务器部署的 `dist/article-games/` 应包含 10 个托管游戏目录；原生五子棋不生成
`dist/article-games/gomoku-native` 目录，而是随主 renderer 构建。Electron 打包结果
必须排除整个 `dist/article-games/`，确保启动台应用只从服务器读取这些资源。
`international-chess` 不应有假冒的本地 Lila 代码目录。注册表测试会验证
上游注册表总数为 11、服务器托管入口为 10，并拒绝旧游戏 ID；界面目录另外包含
`gomoku-native`。
