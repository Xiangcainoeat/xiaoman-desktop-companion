# 小满桌面伴侣

小满桌面伴侣 1.4.0 是一个独立的 macOS 应用，为小满增加透明桌面悬浮窗、平滑注视、完整养成、小游戏、提醒、声音、Codex 任务控制和外部应用事件。

它不会修改或替换 Codex 原生宠物包。应用未启动时，`~/.codex/pets/xiaoman/pet.json` 与 `spritesheet.webp` 仍按原方式工作。

![小满桌面伴侣快捷回复](work/qa-v1.1-final-packaged-quick-reply.png)

## 功能

- 透明、可拖动、始终置顶的桌面小满
- 可关闭注视，或选择上半区 180° / 全向 360° 跟随
- 可选 30Hz / 60Hz，支持跟随速度、中心死区和鼠标静止回正时间
- 可在“小满增强”和“原生 Codex”之间切换：增强配置使用 96 个 3.75° 注视方向，原生配置保留 16 个标准方向
- 增强模式使用完整的 96 方向身体注视图，每个方向独立渲染，不做时间透明混合；鼠标移动越快，响应越快
- 拖动时按方向奔跑，悬停时跳跃；悬停跳跃次数可设置为 1–5 次
- 可分别启用舔嘴、眨眼、举前爪和随机待机说话
- 可添加、删除、恢复待机词条，最多 40 条、每条最多 80 字符
- 小满体型可在 150–340px 调整，窗口按右下锚点同步缩放
- “养成照料”独立管理食物库存、喂食、洗澡、打工、礼包、每日任务和等级经验
- 小鱼干来自真实 Codex 完成奖励、打工和任务；Codex 每个 `threadId + turnId` 只奖励一次，完成时有 18% 概率获得礼包，代码小助手打工另有 12% 礼包机会
- 四种食物有不同的饱食度、精力和好感度效果；库存为零时不会伪造属性或互动结果
- 清洁度会随清醒时间缓慢下降，低于 18 会提示洗澡；自动睡眠会让小满蜷成一团并在系统活动后醒来
- 三种本地小游戏：猜拳、抓鱼干、射泡泡；游戏只结算少量好感度和经验，不直接无限产出食物
- 喂养、摸摸、玩耍、睡觉、叫醒和庆祝互动
- 饱食度、清洁度、好感度、精力、等级、经验、用餐次数与互动次数
- 本地合成的互动声音、提醒计划、系统通知和主动状态通知
- 根据前台应用名称触发小满状态、声音和可选通知
- 显示本机 Codex 最近任务、当前状态、工作区和更新时间
- 在悬浮窗或控制中心直接回复任务，也可打开对应 Codex 任务
- 菜单栏入口、登录时启动和本地持久化

## 安装

打开发布目录中的 DMG，将“小满桌面伴侣”拖到“应用程序”。本地构建未使用 Apple Developer 证书签名；第一次打开时可在 Finder 中右键应用并选择“打开”。

应用不要求额外配置 Codex。首次启动后会自动建立自己的数据文件，并在控制中心显示可用能力。

## 使用

- 单击小满：摸摸
- 双击小满：打开控制中心
- 拖动小满：移动悬浮窗，并播放左右奔跑动作
- 右键小满：打开互动菜单
- 悬停小满：显示快捷回复、喂养和控制中心按钮，并播放跳跃动作
- 点击 `</>`：在悬浮窗中选择任务并直接回复
- 菜单栏图标：显示/隐藏、互动或退出

控制中心包含“桌宠功能”“养成照料”“互动游戏”“Codex 任务”“概览”“提醒计划”“应用事件”“偏好设置”八个视图。桌宠自身行为只在“桌宠功能”调整，库存和养成操作只在“养成照料”进行，Codex/宿主/系统集成只在“偏好设置”管理。

### Codex 回复语义

- 默认“原生窗口”通道：先通过 `~/.codex/ipc/ipc.sock` 找到拥有该线程的原生 Codex 客户端，再由该客户端执行 follower start/steer；不会为了发送消息再打开一个 Codex 窗口。
- 如果原生 Codex 没有持有所选任务，应用只针对明确的 `owner-not-found` 结果回退到 `codex exec resume`；连接失败、协议失败和超时会原样提示，不会误启动另一条任务。
- 原生回复每条消息使用新的请求连接和唯一消息 ID，连续发送不会复用已经关闭的 socket；原生确认后会在状态库落盘前短暂记住该线程正在运行，让紧接着的下一条消息走 `steer`，状态竞争只做一次 start/steer 互换重试，不静默改走 CLI。
- “CLI 兼容”通道是显式选项：正在执行或等待输入的任务走 `codex queue`，已结束任务走 `codex exec resume`。
- “在 Codex 中打开”：使用 `codex://threads/<thread-id>` 打开对应任务。
- 原生任务列表从 Codex state DB 读取交互线程身份，排除 `exec`、子 Agent 和未登记的本地日志；只读日志监视器仅给同一线程叠加实时运行状态。

浏览器 `dev:web` 只提供内存 UI mock，任务列表和回复按钮会明确提示“模拟”，不会打开 Codex 或调用 CLI；真实发送必须在 Electron 宿主中验证。

## 兼容边界

| 场景 | 结果 |
| --- | --- |
| 宿主没有安装或没有启动 | Codex 原生小满照常工作 |
| 宿主正在运行 | 桌面出现独立小满，并启用扩展功能 |
| Codex 没有运行 | 互动、养成、提醒和应用事件仍可用 |
| 原生 Codex IPC 不可用 | 原生回复显示明确错误；可手动切换到“CLI 兼容”，其他功能不受影响 |
| Codex state DB 不可用 | 原生任务列表显示不可用且不会改读无关日志；其他功能不受影响 |
| 宿主退出或卸载 | 不写入或删除 Codex 原生宠物文件 |

## 本地数据与隐私

macOS 数据文件位于：

```text
~/Library/Application Support/小满桌面伴侣/xiaoman-data.json
```

该文件保存数值、库存、打工进度、每日任务、奖励账本、提醒、应用规则、待机词条、设置、悬浮窗位置和最近动态。应用不包含遥测、分析、更新器或自建云服务。原生回复只通过本机 Codex IPC 交给拥有目标线程的 Codex 窗口；只有用户明确选择“CLI 兼容”并主动发送时，应用才调用已安装的 Codex CLI。详细边界见 [docs/PRIVACY.md](docs/PRIVACY.md)。

## 开发

要求 Node.js 20 或更高版本。

```bash
npm install
npm run dev
```

验证与构建：

```bash
npm run typecheck
npm test
npm run verify:idle-atlas
npm run verify:look-96
npm run verify:care-atlas
npm run build
npm run pack:mac
npm run dist:mac
```

`verify:idle-atlas` only needs the optional image-tool dependencies listed in
`requirements-image.txt`. The launcher first checks `PYTHON`, `CODEX_PYTHON`,
the system `python3`, and the Codex bundled runtime; the desktop app itself
does not require Python, numpy, or Pillow.

生成的应用和安装包位于 `release/`。详细资料见：

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- [docs/STATES.md](docs/STATES.md)
- [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)
- [docs/DELIVERY.md](docs/DELIVERY.md)
- [docs/PRIVACY.md](docs/PRIVACY.md)
- [SECURITY.md](SECURITY.md)

干净发布仓库还包含 `codex-pet/`：其中既有可直接安装的原生 Codex 两文件宠物，也有可由 Codex 复用的 `hatch-pet` 技能、确定性脚本、测试、QA 证据和小满完整制作案例。`public/pet/native/` 是宿主内置的原生 profile 副本，`work/xiaoman-pet-96/` 保留本机 CLI 生图提示、选中结果、扩帧 provenance、图集验证和 QA 材料，`work/xiaoman-care-assets/` 保留睡眠、护理和小游戏素材的来源与验证记录。宿主不会写回 `~/.codex/pets/xiaoman`。

## 许可证

应用代码使用 MIT License。小满图像资产的授权边界见 [ASSETS_LICENSE.md](ASSETS_LICENSE.md)，第三方依赖见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
