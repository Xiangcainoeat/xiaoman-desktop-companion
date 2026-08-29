# 游戏目录

公开仓库的“互动游戏”页包含 10 个可用入口：9 个可离线运行的静态 H5 页面，
以及一个明确跳转到官方服务的在线国际象棋入口。没有许可证声明的候选快照不进入
公开运行时，也不会被重新标记成应用原创代码。

## 10 个入口

| 顺序 | ID | 中文名 | 运行方式 | 上游项目 |
| ---: | --- | --- | --- | --- |
| 1 | `pacman` | 吃豆人 | 本机静态页 | [mumuy/pacman](https://github.com/mumuy/pacman) |
| 2 | `react-tetris` | 俄罗斯方块 | 本机静态页 | [chvin/react-tetris](https://github.com/chvin/react-tetris) |
| 3 | `battle-city` | 坦克大战 | 本机静态页 | [feichao93/battle-city](https://github.com/feichao93/battle-city) |
| 4 | `international-chess` | 国际象棋 | 官方在线页 | [lichess-org/lila](https://github.com/lichess-org/lila) |
| 5 | `star-battle` | 星际大战 | 本机静态页 | [gd4Ark/star-battle](https://github.com/gd4Ark/star-battle) |
| 6 | `space-invaders` | 太空侵略者 | 本机静态页 | [StrykerKKD/SpaceInvaders](https://github.com/StrykerKKD/SpaceInvaders) |
| 7 | `snake` | 贪吃蛇 | 本机静态页 | [RabiRoshan/snake_game](https://github.com/RabiRoshan/snake_game) |
| 8 | `super-mario-bros` | 超级马里奥 | 本机静态页 | [martindrapeau/backbone-game-engine](https://github.com/martindrapeau/backbone-game-engine) |
| 9 | `2048` | 2048 | 本机静态页 | [gabrielecirulli/2048](https://github.com/gabrielecirulli/2048) |
| 10 | `xiangqi-h5` | 中国象棋（H5） | 本机静态页 | [itlwei/Chess](https://github.com/itlwei/Chess) |

文章原始链接是 [CSDN 的 HTML5 游戏整理](https://blog.csdn.net/ZackSock/article/details/103450186)。
文章中的历史仓库链接如果发生转移，目录使用当前可解析的规范仓库，
固定 commit 和原始链接记录在 `vendor/article-games/*/SOURCE.md`。

## 运行边界

React 控制中心负责目录、中文元数据、打开/关闭和状态提示；Electron 主进程
启动一个只监听 `127.0.0.1` 的静态宿主，把 `public/article-games/` 提供给
iframe。已打开的游戏会保留为顶部标签页，切换时只隐藏非活动页面并释放它的
输入焦点；这样切回去时仍保留棋盘、分数和进行中的局面。共享适配器会暂停
后台页面的 HTML 音频、视频和 Phaser 音效，恢复标签页时再还原原本的静音状态。

本机入口使用 `sandbox` iframe，允许脚本、表单、音频、指针锁和本地存储，
但不允许页面接管主窗口或打开应用内第二个游戏窗口。游戏自己的规则、AI、
关卡和输入方式保持上游行为，不虚构统一的分数或难度协议。

国际象棋对应的 Lila 是完整的在线服务端，不是一个可以复制成单 HTML 的
离线游戏。该卡片明确标记“需要网络”，按钮通过系统浏览器打开
`https://lichess.org/`；应用不会把远程页面伪装成本机已内置资源。

## 本地修改

- 所有本机入口补充 `zh-CN` 或中文标题，并保留各自的原始游戏逻辑。
- Pacman、俄罗斯方块和坦克大战移除运行时外链/社交组件，避免静态页在
  loopback 宿主中自动跳出应用。
- 所有本机入口接入统一键盘转发和生命周期适配器；方向键、空格及常用 WASD
  键由宿主转发，非活动标签不会继续播放游戏音频。
- Space Invaders 使用上游提交的优化构建；坦克大战使用 `build/0.3.0`。
- 超级马里奥保留 `3rd/`、`src/` 和关卡资源，重写扁平化后的相对路径，
  不依赖已经废弃的 AppCache 更新按钮。
- H5 象棋保留棋盘皮肤、音效、开局库和三档 AI，移除不存在的 Cordova 脚本，
  由 loopback 宿主满足其本地 XHR 初始化条件。

完整来源、固定提交、许可证和已知风险见
[`vendor/article-games/README.md`](../vendor/article-games/README.md)。

## 验证

```bash
npm ci
npm run typecheck
npm test
npm run build
```

构建后的 `dist/article-games/` 应包含 9 个本地游戏目录；
`international-chess` 不应有假冒的本地 Lila 代码目录。注册表测试会验证
总数为 10、离线入口为 9，并拒绝旧游戏 ID。
