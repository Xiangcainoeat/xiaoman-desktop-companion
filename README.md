# 小满桌面伴侣

小满桌面伴侣是一个 macOS 桌面宠物应用：小满会作为透明悬浮窗陪伴工作，
也可以作为 Codex v2 兼容的宠物素材使用。项目把桌宠行为、养成、互动游戏、
Codex 会话控制、系统提醒和可替换素材包放在同一个本地应用中。

## 支持的功能

- 透明、可拖动、始终置顶的桌面宠物悬浮窗。
- 30/60 Hz 眼部注视、上半区 180° 或全向 360° 跟随、静止回正和速度响应。
- 在“桌宠功能”页顶部直接切换原生 Codex profile 与小满增强 profile；增强 profile 使用 96 个完整身体方向帧。
- 拖动奔跑、悬停跳跃、舔嘴、眨眼、举前爪、蜷睡、喂食和洗澡动作。
- 饥饿、清洁度、精力、好感度、等级、经验、食物、礼包、任务和打工养成系统。
- Codex 任务列表、状态查看、原生窗口回复和明确的 CLI 兼容回退通道。
- 本地提醒、声音/静音、系统通知和前台应用事件。
- 统一的互动游戏页、独立标签页、键盘输入和暂停/恢复生命周期。
- `.xmpet` 素材包导入、校验、切换、回退、导出到 Codex，以及多参考图生成工具。

## 快速开始

需要 Node.js 20 或更高版本。开发模式只监听本机地址：

```bash
npm ci
npm run dev
```

浏览器预览（不连接真实 Codex）使用：

```bash
npm run dev:web
```

验证和构建：

```bash
npm run typecheck
npm test
npm run build
npm run dist:mac
```

`dist:mac` 生成未签名的 Apple Silicon DMG/ZIP。首次打开未签名应用时，
请在 Finder 中右键选择“打开”。项目不要求额外的 Codex 配置；Codex 未启动时，
桌宠、养成、提醒和游戏仍可独立运行。

## 可替换宠物素材

仓库中的 [素材清单](docs/PET-ASSET-MANIFEST.md) 是唯一的替换契约，
机器可读版本在 [`public/pet/asset-manifest.json`](public/pet/asset-manifest.json)。
它列出每个 ID 的原始文件、`.xmpet` 包内位置、尺寸、帧数和动作行，避免只替换
主图而漏掉注视、睡眠、照料或菜单栏图标。

一个完整的素材作者工作流如下：

```bash
# 1. 用一张或多张参考图建立本机作者目录
npm run pet:init -- --workspace ./my-pet --name "我的宠物" \
  --refs ./references/front.jpg ./references/body.jpg

# 2. 输出所有动作的提示词和帧任务清单（不联网）
npm run pet:prompts -- --project ./my-pet
npm run pet:generate -- --project ./my-pet --dry-run

# 3. 显式执行图片 API 请求；密钥只从环境变量读取
PET_IMAGE_API_KEY="..." npm run pet:generate -- --project ./my-pet --execute \
  --concurrency 3

# 4. 将生成帧按 manifest 中的图集契约组装，再打包和校验
npm run pet:pack -- --project ./my-pet --output ./my-pet.xmpet
npm run pet:validate -- --package ./my-pet.xmpet
```

生成器支持 OpenAI-compatible 图片接口，默认并发为 3，允许范围为 1-6，
不会超过 6 个同时请求。可用 `PET_IMAGE_API_URL`、`PET_IMAGE_MODEL` 或命令行
参数覆盖接口地址和模型。参考图只在本机读取并以 base64 发送给用户配置的接口；
它们、API key 和生成任务中的私有路径不会被写入 `.xmpet`。

生成器负责稳定地创建帧任务和输出文件；图集的裁剪、去色边、拼接、验证仍由
仓库中确定性的脚本完成。这样换模型或换宠物时，生成部分可以重跑，已经验收的
图集不会被半成品覆盖。应用导入前会验证路径、SHA-256、图集规格和 Codex 两文件
契约，并在切换失败时回退到内置小满。

## 一键生成自己的宠物

在应用的“桌宠功能”页点击“一键生成自己的宠物”，会在原生 Codex 中创建一个
新任务，并自动发送 `$xiaoman-pet-studio`、Skill 获取命令和十张素材建议。把照片
拖进这个任务后，Codex 会检查当前生图能力，按统一契约生成并验证 `.xmpet`，再由
应用的“偏好设置 → 宠物素材包”导入。整个流程不要求桌宠运行时配置图片 API，
也不会把照片或密钥上传到本仓库。

完整的十张图片建议、环境检查和输出契约见
[`docs/PET-STUDIO.md`](docs/PET-STUDIO.md)；可复用 Skill 位于
[`skills/xiaoman-pet-studio/`](skills/xiaoman-pet-studio/)。

## Codex 兼容包

原生 Codex 运行时故意只有两个文件：

```text
pet.json
spritesheet.webp
```

这是 Codex v2 的运行时契约，不是项目缺文件。完整的作者提示词、扩帧脚本、
测试、预览和 QA 证据位于 [`codex-pet/`](codex-pet/)，桌面宿主使用的扩展素材
位于 [`public/pet/`](public/pet/)。桌面宿主不会写回或覆盖用户的原生 Codex 宠物。

## 游戏和第三方来源

互动游戏页把上游 H5 项目放在隔离的本地 iframe 中，中文目录、窗口适配、键盘
转发、标签页和音频生命周期由宿主统一处理，游戏规则和关卡仍由各自上游项目提供。
国际象棋入口明确打开官方 Lichess 在线棋盘，不把完整服务伪装成本地离线资源。

公共导出只包含有来源记录且适合继续审查的运行文件；没有许可证声明的滑块拼图
快照不会进入公共导出。完整来源、固定提交、局部修改和媒体权利风险见
[`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) 与 [`docs/GAMES.md`](docs/GAMES.md)。

## 隐私和安全

- 应用没有遥测、自建后端、账号系统或自动更新器。
- 普通动画、养成、提醒、游戏和系统通知都在本机运行。
- Codex 原生回复通过本机 IPC 交给拥有目标任务的 Codex 客户端；CLI 回退只有在
  用户明确选择并发送时才调用已安装的 Codex CLI。
- 图片生成 API 是作者主动执行的构建时流程，不在桌宠运行时自动调用。
- 原始宠物照片、API key、私有 relay 配置、日志和临时构建目录不属于公共发布内容。

## 许可证

应用源代码使用 MIT License。小满图像资产是独立的用户素材，授权边界见
[`ASSETS_LICENSE.md`](ASSETS_LICENSE.md)；第三方游戏和字体/音频/角色素材的来源
与限制见 [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md)。

更多开发信息：

- [公开发布边界与复现](docs/PUBLIC-RELEASE.md)
- [素材清单与替换契约](docs/PET-ASSET-MANIFEST.md)
- [Pet Pack 生成与打包](docs/PET-PACK.md)
- [游戏目录与来源](docs/GAMES.md)
- [架构](docs/ARCHITECTURE.md)
- [隐私边界](docs/PRIVACY.md)
- [安全报告](SECURITY.md)
