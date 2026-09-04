# 开发说明

## 目录

```text
electron/                 Electron 主进程、preload 和桌面窗口生命周期
src/components/           悬浮窗、控制中心和游戏视图
src/article-games/        游戏目录、来源边界和输入适配
src/shared/                桌宠状态、养成、Codex 和桌面交互逻辑
public/article-games/     部署到服务器的静态游戏运行文件
public/pet/               内置宠物图集和机器可读素材清单
vendor/article-games/     上游来源与许可证记录
templates/pet-pack/       可复制的新宠物作者模板
scripts/                  Pet Pack、构建、扫描和安装工具
tests/                    Vitest 测试
```

## 常用命令

```bash
npm run dev          # 编译 Electron，并启动 Vite 与桌面窗口
npm run dev:web      # 启动公开网页面，只提供互动游戏和联机房间
npm run typecheck    # Renderer、Electron、脚本和测试的 TypeScript 检查
npm test             # 单元测试
npm run build        # 生产 renderer、静态资源和 Electron 构建
npm run dist:mac     # 未签名 Apple Silicon DMG/ZIP
npm run install:mac  # 安装构建结果并刷新 macOS 启动注册
npm run scan:public  # 发布前扫描私人路径和内联密钥
```

Pet Pack 命令见 [PET-PACK.md](PET-PACK.md)：

```bash
npm run pet:init
npm run pet:prompts
npm run pet:generate
npm run pet:validate
npm run pet:pack
npm run pet:install
```

## 并行开发与写入原则

可以让多个 agent 同时做只读检索、源码审计、测试设计和结果复核，但工作树的实际写入
始终由一个主写入线程负责。并行 agent 不得修改主线程正在处理的文件，也不得直接执行
覆盖安装、发布或推送；它们只返回文件位置、复现证据和最小修复建议。主线程逐项合并
建议后统一运行测试、类型检查和构建，再进行安装与发布。生图请求同样计入总并发预算，
整个任务的活动请求数不得超过 6。

## 运行边界

项目有两个互不等价的运行表面，开发时不得用浏览器 mock 代替桌面能力：

- Electron 桌面应用可以显示全部页面，并通过 preload/IPC 读取本机 Codex 状态、宠物包、
  养成、提醒、应用事件和偏好设置。
- 服务器网页只能显示“互动游戏”和“联机房间”。它不得显示本机页面，也不得为
  Codex 上下文、当前任务、宠物配置或用户目录增加服务端接口。

新增导航或路由时必须同时更新 `src/shared/runtime.ts` 的白名单和对应测试。桌面回归还要
直接验证 `CodexSessionsService` 能从本机状态库返回当前任务；仅看网页截图不能证明桌面
任务读取正常。

## 字体标准

控制中心使用统一的五级层次，新增页面应优先复用现有 token，不要为单个卡片引入
新的字号：

| 层级 | 字号 / 行高 | 用途 |
| --- | --- | --- |
| 页面标题 | 26 / 32px | 顶栏和页面引导 |
| 分区标题 | 20 / 26px | 设置组、面板和目录标题 |
| 卡片标题 | 16 / 22px | 任务、游戏和列表项目 |
| 正文/控件 | 14 / 20-21px | 说明、标签、字段和按钮 |
| 元数据/眉题 | 12 / 16-18px | 来源、状态和辅助信息 |

数字进度和时间读数可以使用 18 / 22px。悬浮窗是更密集的独立交互表面，可以保留
自己的尺寸，但不应让控制中心字体随意缩小。

## 增加游戏

1. 在 `src/article-games/registry.ts` 增加稳定 ID、中文名称、来源 URL、固定提交、
   许可证和运行边界。
2. 页面放在 `public/article-games/<id>/index.html`，并把脚本、样式、字体、图像和音频
   一起部署到小满服务器；不要加入未经说明的第三方运行时依赖。
3. 在 `vendor/article-games/<id>/SOURCE.md` 记录来源快照和每一处本地修改，单独标记
   尚未解决的媒体权利。
4. 在 `src/article-games/mobile-controls.ts` 明确手机端是直接触摸还是外置控制按钮；
   先写注册表、服务器 URL 和输入测试，再修改目录数量。
5. 运行完整的 typecheck、test、build 和公共扫描。

Electron 包不包含 `dist/article-games`。renderer 和主进程都会校验游戏 ID，并只生成
已登记服务器来源的 URL。完整在线服务必须明确标记为 online handoff，不能写成已托管
的静态资源。

## 修改宠物素材

不要直接改 renderer 中的文件名判断。先更新
[`public/pet/asset-manifest.json`](../public/pet/asset-manifest.json) 和对应的测试，
再让 `src/pet-pack/runtime.ts` 保持稳定 ID。自定义包可以只提供必要 profile，但缺少
可选动作时必须让内置 profile 回退；缺少 Codex 两个必需文件时，导入必须失败。

图集处理要保持离散整帧、透明像素 RGB 清零、固定注册点和明确的帧规格。图片 API
只在作者显式传入 `--execute` 时调用，且并发范围不能超过 6。

## 测试重点

- 宠物包：manifest schema、路径安全、校验和、可选文件、原子导入和 Codex 导出。
- 生成器：多参考图请求、dry-run 默认行为、并发上限、跳过已有文件、失败报告。
- 游戏：目录顺序、服务器 URL、桌面/手机输入、标签页生命周期、暂停/静音和在线边界。
- 联机：WebSocket 落子、断线恢复、房间过期、悔棋确认和服务端权威回滚。
- UI：统一字体层次、窗口适配、面板互斥、睡眠状态和无障碍标签。

完成改动后必须用新命令输出证据，再在 README 中描述结果；不要只依据旧的构建目录或
旧应用窗口判断更新是否生效。
