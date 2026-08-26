# 小满原生回复、90 方向宿主与配置切换设计

## 背景

当前桌面伴侣通过独立 CLI 进程发送 Codex 回复。这个进程并不拥有原生 Codex 桌面窗口，因此会出现深链打开到另一处、首次发送不可见、重试后才出现，以及任务列表混入不相关会话的问题。同时，宿主目前只有 16 方向注视资源，原生 Codex 宠物包和宿主增强资源之间也没有明确的可切换配置。

## 目标

1. 从桌面伴侣发送的文本，进入拥有该会话的原生 Codex 窗口，并由原生窗口继续执行。
2. 任务列表以 Codex app-server 的状态库结果为权威来源，排除 `exec`、子 Agent 和本地日志扫描产生的未知会话。
3. 增加宿主专用的 90 方向注视资源和平滑方向选择；原生 Codex 宠物包继续保持 16 方向、字节不变、独立可用。
4. 在设置中可以在“原生 Codex 配置”和“小满增强配置”之间切换。
5. 保留 CLI 兼容路径，但它必须是显式选择的兼容模式，不能在原生路径失败时静默接管。
6. 图像生成和并行开发任务共享一个总并发预算，运行时不超过 6；本次实现默认最多同时运行 4 个工作单元。

## 非目标

- 不修改 `~/.codex/pets/xiaoman/pet.json` 或 `spritesheet.webp`。
- 不把 90 方向资源写入原生 Codex v2 宠物包，也不改变其 `spriteVersionNumber: 2`、8x11 标准图集约束。
- 不读取或展示不属于所选 Codex 线程的消息正文。
- 不把独立 CLI 进程伪装成原生窗口回复。

## 方案选择

### 方案 A：原生 IPC 路由（采用）

桌面伴侣连接 `${CODEX_HOME}/ipc/ipc.sock`，完成 IPC 初始化后，通过 `thread-owner-discovery` 找到拥有目标会话的原生 Codex 客户端。活动会话使用 `thread-follower-steer-turn`，空闲会话使用 `thread-follower-start-turn`。文本输入使用原生 `UserInput` 结构，并为每次发送生成唯一 `clientUserMessageId`。发送成功后再用 `open -a <Codex.app> codex://threads/<id>` 激活并定位窗口。

这个方案的关键是把“发送”交给原生窗口所属客户端，而不是启动新的 app-server 或 `codex exec resume` 进程。IPC 不可用时返回明确错误，提示用户打开原生 Codex；只有设置明确选择“CLI 兼容”时才走旧路径。

### 方案 B：继续使用 app-server proxy

可以复用现有 JSON-RPC 代码，但 proxy 是新的连接上下文，不能保证消息出现在原生窗口的当前会话里，无法解决本次核心问题。仅保留为读取任务的后备实现，不作为回复传输。

### 方案 C：只写原生深链并模拟发送

只能激活窗口，不能把输入可靠地注入原生会话，仍会留下“打开窗口后再重试”的问题，不采用。

## 架构与数据流

### 原生回复

`replyToCodexThread` -> `CodexSessionsService.sendReply` -> `NativeCodexIpcClient.discoverOwner` -> `thread-follower-start-turn` 或 `thread-follower-steer-turn` -> 原生 Codex owner -> 原生 app-server -> 目标线程。

每个线程有一个发送锁，防止用户连续点击造成重复请求。IPC 请求使用 4 字节 little-endian 长度前缀和 UTF-8 JSON 帧，设置最大帧长度和超时。响应解析同时兼容路由包装层和直接结果层，并记录具体 transport，便于 UI 和诊断区分 `native-start`、`native-steer`、`cli-queue`、`cli-resume`。

若 steer 因活动状态在发送期间变化而失败，服务只重新读取一次线程状态并尝试 start；不会启动 CLI 进程作为隐式兜底。重复发送在锁释放前返回“上一条正在发送”。

### 任务发现

默认 `thread/list` 使用 `useStateDbOnly: true`、`archived: false` 和交互来源 `sourceKinds: ["vscode", "appServer"]`，不包含 `exec`，不包含任何子 Agent 来源。app-server 请求成功时不再与 JSONL 日志做 union；本地日志只在明确的 CLI 兼容读取模式下使用。结果中的 `source` 变为 `app-server`，警告只报告真实的 app-server 不可用状态。

`thread/read` 同样优先使用 app-server 结果，不用日志覆盖其状态；日志状态只作为显式兼容模式的后备。线程 ID、工作目录和 deep link 仍做严格校验。

### 宠物配置

设置增加 `petProfile: "enhanced" | "native"`，默认是 `enhanced`。

- `native`：使用发布目录内经过校验的原生 `pet.json`、`spritesheet.webp` 和 `look-16.webp`，方向数固定为 16，动画行使用原生约定。
- `enhanced`：使用宿主专用 90 方向注视图集、现有 30 帧舔舐/眨眼/挠头动作和宿主平滑插值逻辑。

发布目录中的 native 副本只用于宿主的“原生配置”渲染，不会写回用户的 Codex 宠物目录。启动时做资源存在性和元数据校验；增强资源缺失时回退到同一宿主配置的 16 方向资源，native 资源缺失时显示错误而不修改外部安装。

### 90 方向素材

90 方向只属于 enhanced profile。使用本机安装的 ImageGen CLI 生成少量受控方向条带/锚点，再由仓库内确定性脚本裁切、对齐、去色差、拼接为带元数据的 90 帧图集。每帧角度间隔 4 度，图集布局和 CSS 取帧参数写入 JSON，不在组件中硬编码 16。

生成提示固定小满的暹罗猫外观、透明/干净背景、无粉红边缘和无色偏；生成后检查尺寸、alpha、边缘色差、帧数和中心锚点，并生成 contact sheet。若模型输出无法可靠保持身份，允许使用已验证的 16 方向作为锚点做确定性中间帧，但必须在 QA 报告中标记该事实。

## 设置与交互

设置页增加：

- 宠物配置：`小满增强` / `原生 Codex` segmented control。
- Codex 回复通道：`原生窗口` / `CLI 兼容`，默认原生窗口。
- 当前通道状态和不可用原因，避免用户误以为已发送。

现有眼部跟随、上半区 180 度/全 360 度、30/60 Hz、待机动作、体型大小和词条功能保持不变。切换 profile 只影响宿主渲染，不影响 Codex 原生应用或持久化统计。

任务回复成功文案明确显示“已交给原生 Codex 窗口”；失败文案显示是 owner 发现、IPC 超时、线程状态冲突还是显式 CLI 兼容模式失败。刷新列表不会把一次发送拆成多个本地日志记录。

## 测试与验收

### 单元测试

- IPC little-endian 帧编解码、最大帧和超时。
- owner discovery 请求版本、参数和 target client 路由。
- idle 使用 follower start，active/waiting 使用 follower steer；状态竞争只重试一次。
- 原生回复不可用时不启动 CLI；显式 CLI 模式仍覆盖旧 queue/resume 行为。
- `thread/list` 的来源过滤、`useStateDbOnly` 和“不与日志 union”。
- profile 默认值、旧持久化数据归一化、90/16 图集元数据取帧。

### 集成与视觉验收

- TypeScript、Vitest、Vite/Electron 构建和 macOS 打包。
- 真实本机 Codex 窗口：从列表选中当前任务，连续发送两条文本，确认两条都显示在同一原生窗口和同一线程。
- 无关 `exec`/子 Agent 会话不出现在默认列表。
- enhanced profile 在 30 Hz 与 60 Hz 下方向切换连续，鼠标停下后回到静态待机；native profile 的资源 hash 与基线一致。
- 90 帧图集通过 atlas/alpha/边缘色差检查，截图确认无红边和窗口布局跳动。

## 交付

版本提升到 `1.2.0`。发布目录包含应用安装包、源码包、90 方向图集及元数据、生成提示和 QA 报告；源码同步回外层项目目录。native 基线 hash 写入交付报告，便于后续证明原生资源未被改动。
