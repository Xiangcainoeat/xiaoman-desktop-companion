# 小满原生回复与 90 方向宿主 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让小满把回复交给拥有目标线程的原生 Codex 窗口，同时在不修改原生宠物包的前提下增加可切换的宿主 90 方向配置。

**Architecture:** 新增可注入的原生 IPC 客户端，使用 `~/.codex/ipc/ipc.sock` 的长度前缀 JSON 协议完成 owner discovery 和 follower start/steer；`CodexSessionsService` 默认只信任 app-server state DB 的交互线程，不再 union 本地日志。渲染层通过 `petProfile` 选择原生 16 方向资源或宿主 90 方向资源，图集用独立元数据描述，生成和验证脚本不触碰原生目录。

**Tech Stack:** Electron 44, React 19, TypeScript 6, Vitest, Vite, Python/Pillow atlas tooling, local ImageGen CLI.

---

## 文件边界

- Create: `electron/codex-ipc.ts` - 原生 Codex IPC 帧协议、初始化、owner discovery、follower start/steer。
- Create: `electron/codex-ipc.test.ts` - IPC 协议和请求路由的单元测试。
- Modify: `electron/codex-sessions.ts` - 原生 transport、任务来源过滤、显式 CLI 兼容模式、按线程发送锁。
- Modify: `electron/codex-sessions.test.ts` - 更新旧 union/CLI 默认行为并覆盖 native dispatch。
- Modify: `electron/main.ts` - 注入 native IPC、原生窗口激活、回复 transport 和清晰错误。
- Modify: `src/shared/types.ts`, `src/shared/domain.ts` - profile/transport 类型、默认值、旧数据归一化。
- Modify: `src/shared/gaze.ts`, `src/shared/animation.ts` - 可变方向数的纯函数和图集元数据契约。
- Modify: `src/components/PetSprite.tsx`, `src/components/SettingsView.tsx`, `src/components/CodexTasksView.tsx` - profile 选择、90 方向取帧、通道状态和回复文案。
- Create: `public/pet/look-90.webp`, `public/pet/look-90.json`, `public/pet/native/*` - 宿主增强图集和原生渲染副本。
- Create: `scripts/build_look_atlas_90.py`, `scripts/verify_look_atlas_90.py` - 确定性拼接和 QA。
- Create: `work/xiaoman-pet-90/*` - 生成提示、原始输出、contact sheet、QA 报告。
- Modify: `package.json`, `docs/DELIVERY.md`, `docs/ARCHITECTURE.md` - 版本、命令和交付说明。

### Task 1: 先建立 reply/profile 的失败测试

**Files:**
- Modify: `electron/codex-sessions.test.ts`
- Create: `electron/codex-ipc.test.ts`
- Modify: `src/shared/domain.test.ts` (若不存在则创建)
- Modify: `src/shared/gaze.test.ts` (若不存在则创建)

- [ ] **Step 1: 写 IPC 帧和 native payload 的失败测试**

测试必须验证：4 字节 little-endian 长度前缀；初始化请求带 `clientType`；owner discovery 使用 `{hostId: "local", conversationId}`；活动线程走 `thread-follower-steer-turn`，空闲线程走 `thread-follower-start-turn`；start 的文本输入是 `{type: "text", text}`，每次有唯一 `clientUserMessageId`。

- [ ] **Step 2: 写“默认不启动 CLI”的失败测试**

构造 `CodexSessionsService` 时注入假的 native client 和 recording spawner。默认 `sendReply` 必须调用 native client，`recordingSpawner.invocations` 必须为 0；显式 `replyTransport: "cli"` 才允许旧 queue/resume。

- [ ] **Step 3: 写列表不 union 日志的失败测试**

注入 app-server 返回一个用户线程和一个 `exec`/子 Agent 线程，再注入额外 local record。断言请求包含 `useStateDbOnly: true`、交互来源过滤，结果只包含 app-server 用户线程，local scanner 不被调用。

- [ ] **Step 4: 写 profile 与方向元数据的失败测试**

断言旧设置默认 `petProfile: "enhanced"`、`codexReplyTransport: "native"`；`directionCount: 90` 映射到 4 度步进，native profile 映射到 16；非法值归一化到默认值。

- [ ] **Step 5: 运行目标测试确认是正确的 RED**

Run: `npm test -- electron/codex-ipc.test.ts electron/codex-sessions.test.ts src/shared/domain.test.ts src/shared/gaze.test.ts`

Expected: 新增断言因导出、类型或实现缺失而失败；不能接受“测试文件语法错误”作为 RED 原因。

### Task 2: 实现可注入的原生 IPC 客户端

**Files:**
- Create: `electron/codex-ipc.ts`
- Create: `electron/codex-ipc.test.ts`

- [ ] **Step 1: 定义接口和安全常量**

实现 `NativeCodexIpcClient` 及注入接口：socket path 默认为 `path.join(codexHome, "ipc", "ipc.sock")`；最大 frame 8 MiB；请求超时 8 秒；方法版本表至少包含 `thread-owner-discovery: 1`、`thread-follower-start-turn: 2`、`thread-follower-steer-turn: 1`。线程 ID由调用方校验，IPC payload 不接受 shell 字符串。

- [ ] **Step 2: 实现 frame encoder/decoder**

编码规则：

```ts
const body = Buffer.from(JSON.stringify(message), "utf8");
const frame = Buffer.allocUnsafe(4 + body.length);
frame.writeUInt32LE(body.length, 0);
body.copy(frame, 4);
```

decoder 必须保留半包，循环消费完整 frame，长度超过上限立即销毁连接并抛错。

- [ ] **Step 3: 实现初始化、请求关联和 owner discovery**

请求格式包含 `type: "request"`、随机 `requestId`、`sourceClientId`、协议 `version`、`method`、`params`。初始化发送 `initialize`，保存返回的 client id。`discoverOwner(threadId)` 发送 `thread-owner-discovery`，参数固定为 `{hostId: "local", conversationId: threadId}`，从直接结果或路由包装结果读取 `handledByClientId`。

- [ ] **Step 4: 实现 follower start/steer**

start payload 使用：

```ts
{
  conversationId: threadId,
  turnStart: {
    request: {
      threadId,
      clientUserMessageId,
      input: [{ type: "text", text: message }],
    },
    context: { attachments: [], commentAttachments: [] },
  },
}
```

steer payload 使用 `conversationId`、`clientUserMessageId`、`input`、空 `attachments`，其余可选字段明确为 `null` 或省略，不伪造 active turn id。

- [ ] **Step 5: 运行 IPC 测试确认 GREEN 并提交**

Run: `npm test -- electron/codex-ipc.test.ts`

Commit: `git add electron/codex-ipc.ts electron/codex-ipc.test.ts && git commit -m "feat: route replies through native Codex IPC"`

### Task 3: 接入 session service 并修复任务来源

**Files:**
- Modify: `electron/codex-sessions.ts`
- Modify: `electron/codex-sessions.test.ts`

- [ ] **Step 1: 增加可注入 native client 和显式 transport 类型**

给 `CodexSessionsServiceOptions` 增加 `nativeIpcClient`、`replyTransport` 和 `openDesktopApp` 注入点；`CodexReplyDispatch.transport` 增加 `native-start`、`native-steer`，保留 `queue`、`exec-resume`。默认 transport 为 `native`，平台非 macOS 或 socket 不存在时抛出带原因的 `CodexNativeReplyError`。

- [ ] **Step 2: 让 list/read 只使用 app-server 权威结果**

`thread/list` 参数固定带 `useStateDbOnly: true`、`archived: false`、`sourceKinds: ["vscode", "appServer"]`；过滤 `isSubagent` 和非用户 thread source。app-server 成功后直接返回规范化结果，不调用 local scanner。app-server 失败时默认返回 `unavailable` 和警告；只有显式 CLI 兼容读取模式才调用 scanner。

- [ ] **Step 3: 实现 native start/steer 与单线程锁**

`sendReply` 先校验 message/thread id，再按 thread id 获取 promise lock。通过 `readSession` 或调用方 activity 判断 active/waiting 使用 steer，其余使用 start；owner discovery 失败不得调用 processSpawner。锁在成功或失败后 finally 释放。

- [ ] **Step 4: 处理一次状态竞争重试**

只在 steer 返回明确的 inactive/no-active 错误时重新读取一次并调用 start；第二次失败直接返回错误，不能递归重试或切换 CLI。

- [ ] **Step 5: 保留并隔离 CLI 兼容路径**

当 `replyTransport === "cli"` 时复用现有 queue/resume 流程和测试；UI/错误信息标记为兼容模式。更新旧测试期望，新增测试确认默认 native 不产生进程。

- [ ] **Step 6: 运行 session 测试并提交**

Run: `npm test -- electron/codex-sessions.test.ts`

Commit: `git add electron/codex-sessions.ts electron/codex-sessions.test.ts && git commit -m "fix: isolate Codex task discovery and reply transports"`

### Task 4: 修复 Electron 窗口激活和 IPC 映射

**Files:**
- Modify: `electron/main.ts`
- Modify: `src/shared/types.ts`
- Modify: `src/electron.d.ts`
- Modify: `src/bridge.ts`

- [ ] **Step 1: 注入 native service 并替换深链打开方式**

`openCodexThread` 使用 `/usr/bin/open -a <resolved appPath> <deepLink>` 激活应用，不再使用可能打开到错误 handler 的 `shell.openExternal`。原生 IPC 发送成功后不再额外激活深链，避免把同一线程交给另一个窗口 handler；只有用户主动执行“打开任务”时才打开深链。打开失败必须返回明确错误。

- [ ] **Step 2: 映射 reply transport 和错误**

`replyToCodexThread` 将 `native-start/native-steer` 映射为 `mode: "started"`，消息明确为“已交给原生 Codex 窗口”；CLI 结果显示兼容模式。IPC 错误原样归类为 owner discovery、timeout 或 thread state conflict，不吞掉异常。

- [ ] **Step 3: 增加 IPC 集成 mock**

在 main 测试可注入的边界上验证连续两次 reply 使用不同 message id、同一 thread id，且没有启动第二个 Electron/CLI 窗口。

- [ ] **Step 4: 运行类型和 Electron 相关测试并提交**

Run: `npm run typecheck && npm test -- electron`

Commit: `git add electron/main.ts src/shared/types.ts src/electron.d.ts src/bridge.ts && git commit -m "fix: keep Codex replies in the native window"`

### Task 5: 增加 native/enhanced profile 与 90 方向取帧

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/shared/domain.ts`
- Modify: `src/shared/gaze.ts`
- Modify: `src/shared/animation.ts`
- Modify: `src/components/PetSprite.tsx`
- Modify: `src/components/SettingsView.tsx`
- Modify: `src/components/CodexTasksView.tsx`
- Create: `public/pet/look-90.json`
- Create: `public/pet/native/*`

- [ ] **Step 1: 增加并归一化设置字段**

增加：

```ts
petProfile: "enhanced" | "native";
codexReplyTransport: "native" | "cli";
```

默认值分别为 `enhanced`、`native`；旧数据缺字段时不改变现有设置。

- [ ] **Step 2: 参数化 gaze 方向数**

`interpolateLookDirection(angle, directionCount)` 保持纯函数；PetSprite 根据 profile 选择 90 或 16，并从 metadata 计算列/行/单帧尺寸。native profile 始终加载 native 副本和 `look-16`，enhanced profile 优先加载 `look-90`，资源不存在时回退 `look-16`。

- [ ] **Step 3: 保持连续角度与静止回正**

继续使用现有 `smoothAngle` 和 `shouldTrackCursor`，在 90 方向下仍按 30/60 Hz 取帧；鼠标超过 `gazeIdleResetMs` 不再更新目标，当前角度平滑回到 0。下半区使用 shortest-angle 路径，避免 359/0 度跳变。

- [ ] **Step 4: 增加设置 UI 和通道状态**

在设置页增加 profile segmented control 和回复通道 segmented control；Codex 任务页根据结果显示原生窗口/CLI 兼容状态。不要把说明文字堆进按钮，使用现有 SettingsRow/Toggle/segmented 样式。

- [ ] **Step 5: 复制并校验 native 资源**

只读复制当前 `~/.codex/pets/xiaoman/pet.json`、`spritesheet.webp`、`look-16.webp` 到 `public/pet/native/`，记录 SHA256；不得写回源目录。为 native 副本增加启动校验。

- [ ] **Step 6: 运行 renderer/domain 测试并提交**

Run: `npm test -- src/shared && npm run typecheck`

Commit: `git add src public/pet/native public/pet/look-90.json && git commit -m "feat: add switchable native and enhanced pet profiles"`

### Task 6: 生成、拼接和验证 90 方向素材

**Files:**
- Create: `scripts/build_look_atlas_90.py`
- Create: `scripts/verify_look_atlas_90.py`
- Create: `work/xiaoman-pet-90/prompts/*`
- Create: `work/xiaoman-pet-90/qa/*`
- Create: `public/pet/look-90.webp`

- [ ] **Step 1: 保存生成规格和并发预算**

在 `work/xiaoman-pet-90/imagegen-jobs.json` 写入 9 个 10 帧方向条带任务或等量受控锚点，注明每帧 4 度、同一参考猫、无文字/水印/粉色边缘。通过本机 CLI skill 执行，CLI 并发设置为 1；与 Agent 总并发登记在 `work/xiaoman-pet-90/concurrency.json`，总上限 6。

- [ ] **Step 2: 使用本机 CLI 生成原始图**

使用 `${CODEX_HOME:-$HOME/.codex}/skills/relay-imagegen/scripts/relay_imagegen.sh`（本机 CLI wrapper）或用户明确配置的同一 ImageGen CLI。不要修改系统脚本，不把 key 写入文件。所有输出保存到 `work/xiaoman-pet-90/relay-output/`，生成后用 `view_image` 检查主体、边缘和色彩。

- [ ] **Step 3: 确定性裁切、注册和拼接**

脚本将输出裁切为统一 RGBA 单帧，按 10 列 x 9 行拼为 `look-90.webp`，并生成 `look-90.json`：`frameCount: 90`、`columns: 10`、`rows: 9`、`stepDegrees: 4`、单帧尺寸和 alpha/chroma QA 摘要。使用统一白平衡/去色差规则，不用随机后处理。

- [ ] **Step 4: 运行 atlas QA**

Run: `sh scripts/run_image_python.sh scripts/verify_look_atlas_90.py public/pet/look-90.webp public/pet/look-90.json`

Expected: 90 帧、RGBA/alpha 有效、边缘粉红像素为 0 或低于阈值、帧尺寸一致、contact sheet 已生成。若模型身份漂移，报告标记锚点插值，不把它隐藏成纯生成素材。

- [ ] **Step 5: 提交素材和生成记录**

Commit: `git add scripts work/xiaoman-pet-90 public/pet/look-90.webp public/pet/look-90.json && git commit -m "feat: add Xiaoman 90-direction host atlas"`

### Task 7: 集成回归、打包和交付

**Files:**
- Modify: `package.json`
- Modify: `docs/DELIVERY.md`, `docs/ARCHITECTURE.md`
- Create: `release/qa/native-profile-hashes.json`, `release/qa/native-reply-smoke-test.md`, `release/qa/look-90-report.json`

- [ ] **Step 1: 提升版本并补命令**

将版本从 `1.1.1` 提升到 `1.2.0`，增加 `verify:look-90` 和必要的 atlas 构建命令；不改原生安装包版本或外部目录。

- [ ] **Step 2: 运行完整自动化验证**

Run: `npm test && npm run typecheck && npm run verify:idle-atlas && npm run verify:look-90 && npm run build`

Expected: 所有测试通过，90 atlas QA 通过，构建生成 `dist/` 和 `dist-electron/`。

- [ ] **Step 3: 做真实原生窗口 smoke test**

在本机 Codex 已打开且有当前线程时，从桌伴任务页发送两条不同文本；检查两条都进入同一个原生窗口/线程，任务列表不出现额外 CLI 会话。记录 transport、thread id（可截断）和结果到 QA 文档，不记录消息正文或密钥。

- [ ] **Step 4: 做 profile/视觉 smoke test**

分别选择 enhanced/native，在 30 Hz 和 60 Hz 下移动鼠标经过上、下、左右边界；确认 enhanced 使用 90 metadata，native 使用 16 资源，停止移动后回正，拖动时跑步动作仍存在。用浏览器/Electron 截图检查无红边、无布局跳变。

- [ ] **Step 5: 打包并核对 native hash**

Run: `npm run dist:mac`，生成 arm64 DMG/ZIP、源码包和 `SHA256SUMS`。重新计算 `~/.codex/pets/xiaoman/pet.json` 与 `spritesheet.webp` hash，必须等于基线 `ee3297a...` 与 `36168f...`；安装 `/Applications/小满桌面伴侣.app` 后检查 Info.plist 为 `1.2.0`。

- [ ] **Step 6: 同步外层源码并完成最终审查**

只同步应用源码和发布交付物到 `/Users/zk/Documents/Codex/2026-08-21/hatch-pet-users-zk-codex-skills/xiaoman-desktop-companion` 的对应文件，不覆盖用户无关改动。运行 `git diff --check`、查看 `git status`、检查 release 清单，然后提交最终文档。
