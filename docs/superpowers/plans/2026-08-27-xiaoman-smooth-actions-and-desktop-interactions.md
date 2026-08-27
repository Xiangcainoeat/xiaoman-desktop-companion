# 小满流畅动作与桌面互动实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复小满动作素材和播放管线，增加帧无关的桌面泡泡互动，以及不含设置的养成/互动快捷窗口。

**Architecture:** 增强版继续消费本地 WebP 图集，但使用统一的 delta-time 播放器；原生 Codex profile 保持现有 CSS fallback。主进程负责桌面互动 session、click-through、窗口生命周期和奖励结算，renderer 负责泡泡运动与快捷窗口展示。侧边栏的两个入口复用一个带模式参数的紧凑窗口。

**Tech Stack:** TypeScript 6, React 19, Electron 44, Vite 8, Vitest 4, Canvas/DOM 2D rendering, Python/Pillow, 本机 relay-imagegen CLI, electron-builder。

**Spec:** `docs/superpowers/specs/2026-08-27-xiaoman-smooth-actions-and-desktop-interactions-design.md`

## Global Constraints

- 原生 Codex profile 和 `~/.codex/pets/xiaoman` 不得修改；增强版与原生版必须可以切换。
- 运行时不得使用透明混合、双图淡入淡出、blur、afterimage 或半透明残影。
- 30Hz 与 60Hz 必须基于 `deltaMs`，同一动作持续时间误差不超过 3%。
- 喂食、洗澡、睡觉不得通过复制源帧填充 30 帧；相邻完全相同帧比例低于 10%。
- 生图请求和 Agent 请求共用并发预算；实际同时运行最多 4 个 worker，严格低于 5。
- 桌面互动只允许一个 active session；命中由主进程验证并幂等结算。
- 空白透明区域必须支持 click-through；泡泡点击不得进入宠物拖动路径。
- 每个实现任务先写一个会失败的测试，再写最小生产代码；每个任务完成后运行自身测试并提交小 commit。
- 不使用破坏性 git 命令，不覆盖用户未创建的修改。

## 文件地图与任务接口

- `src/shared/animation.ts`, `src/components/SpritePlayer.tsx`: 帧无关的图集播放器和可测试时钟。
- `scripts/build_idle_atlas_30.py`, `scripts/build_care_atlas_30.py`, `scripts/verify_*`: 资产抽取、共同注册、安全边界和边缘验证。
- `src/shared/types.ts`, `src/shared/desktop-interaction.ts`: 快捷窗口模式、桌面 session、泡泡命中规则的公共类型和纯函数。
- `electron/main.ts`, `electron/preload.ts`, `src/bridge.ts`, `src/electron.d.ts`: 快捷窗口、click-through 和桌面 session IPC。
- `src/components/DesktopBubbleLayer.tsx`: Overlay 内独立的泡泡运动和命中层。
- `src/components/QuickActionsView.tsx`: 养成/互动快捷框，不引入设置控件。
- `src/App.tsx`, `src/components/Overlay.tsx`, `src/styles.css`: 路由、入口和视觉接线。

### Task 1: 动作播放器与动画状态

**Files:**
- Modify: `src/shared/animation.ts`
- Create: `src/components/SpritePlayer.tsx`
- Modify: `src/components/PetSprite.tsx`
- Test: `src/shared/animation.test.ts`
- Create: `src/components/SpritePlayer.test.tsx`

**Interfaces:**
- `advanceAnimationClock(clock, elapsedMs, fps, frameCount): AnimationClock` 保留现有纯函数契约。
- `advanceFrameByDelta(clock, elapsedMs, spec): { clock: AnimationClock; frameChanged: boolean; looped: boolean }` 使用有限 delta 并返回循环信息。
- `SpritePlayerProps` 为 `{ spec: AnimationSpec; frameRate: 30 | 60; paused?: boolean; onLoop?: () => void; onComplete?: () => void }`，播放器只输出单个当前帧。

- [ ] **Step 1: 写失败测试。** 测试 30Hz 与 60Hz 在同样 1000ms 里推进相同帧数；测试 250ms 以上的长帧被限制；测试 one-shot 回调只执行一次；测试切换动作时不会同时保留两个可见层。
- [ ] **Step 2: 运行 `npm test -- --run src/shared/animation.test.ts src/components/SpritePlayer.test.tsx`，确认因新接口缺失而失败。**
- [ ] **Step 3: 实现 delta-time 播放器。** 将 rAF 作为时钟，把帧索引写入单一 DOM sprite 的背景位置；取消每次动作状态变更时的重复时钟；保留 native profile 的原有图集选择。
- [ ] **Step 4: 删除 `eating-bob` 和 `sleeping` 的额外动态 transform/filter。** 只保留静态可见性和无障碍标签；动作由图集帧独占。
- [ ] **Step 5: 运行焦点测试、类型检查并提交。**

Run: `npm test -- --run src/shared/animation.test.ts src/components/SpritePlayer.test.tsx && npm run typecheck`

Commit: `git add src/shared/animation.ts src/components/SpritePlayer.tsx src/components/PetSprite.tsx src/shared/animation.test.ts src/components/SpritePlayer.test.tsx src/styles.css && git commit -m "feat: add frame-independent Xiaoman sprite player"`

### Task 2: 动作图集管线和补充素材

**Files:**
- Modify: `scripts/build_idle_atlas_30.py`
- Modify: `scripts/build_care_atlas_30.py`
- Modify: `scripts/verify_care_atlas_30.py`
- Create: `tests/test_smooth_action_atlas.py`
- Replace: `work/xiaoman-care-assets/generated-care.png`
- Replace: `work/xiaoman-care-assets/generated-sleeping.png`
- Replace: `public/pet/care-actions-30.webp`
- Replace: `public/pet/care-actions-30.json`
- Replace: `public/pet/sleeping-30.webp`
- Replace: `public/pet/sleeping-30.json`

**Interfaces:**
- `normalize_action_frames(frames, ...)` 返回共同注册后的 RGBA 帧和注册报告；不得裁切越过安全边界的前景。
- `validate_action_sequence(frames, reference_rgb, safe_inset)` 返回包含 `duplicateRatio`, `edgePixels`, `mattePixels`, `bboxViolations`, `colorDrift` 的报告，并在任一硬约束失败时退出非零。

- [ ] **Step 1: 写失败的图像契约测试。** 用当前图集验证重复率、bbox 安全内边距和黑/暖色边缘检查，确认当前实现至少在重复率或边界规则上失败。
- [ ] **Step 2: 运行 `PYTHON=/Users/zk/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3 sh scripts/run_image_python.sh -m unittest tests/test_smooth_action_atlas.py`，记录正确的失败原因。**
- [ ] **Step 3: 修改确定性管线。** 使用 union bbox 和固定脚底线；将 `_composite_clipped` 改成越界报错或先按安全框等比缩小；清理黑色/深灰色 matte、绿边和暖色边缘；清理透明像素下残留 RGB；加入连续帧和内部透明孔洞检查。
- [ ] **Step 4: 用本机 relay-imagegen CLI 生成新的动作源图。** 每个动作使用小满参考和原生颜色参考，生成 6x6 的真实时序接触表；只保留完整身体和道具，禁止文字、边框、背景、动作线和阴影。生成请求与其他 Agent 合计不超过 4 个并发。
- [ ] **Step 5: 构建并检查新图集。** 生成 contact sheet，确认白色、深色和棋盘格背景无黑边/泛红/裁切；不接受只靠复制帧达到数量的结果。
- [ ] **Step 6: 运行图像测试、验证器并提交。**

Run: `PYTHON=/Users/zk/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3 sh scripts/run_image_python.sh -m unittest tests/test_smooth_action_atlas.py && npm run verify:care-atlas`

Commit: `git add scripts tests/test_smooth_action_atlas.py work/xiaoman-care-assets public/pet/care-actions-30.webp public/pet/care-actions-30.json public/pet/sleeping-30.webp public/pet/sleeping-30.json && git commit -m "fix: rebuild Xiaoman care action atlases"`

### Task 3: 桌面互动纯函数和公共状态

**Files:**
- Modify: `src/shared/types.ts`
- Create: `src/shared/desktop-interaction.ts`
- Test: `src/shared/desktop-interaction.test.ts`

**Interfaces:**
- `QuickViewMode = "care" | "interaction"`。
- `DesktopInteractionStatus = { active: boolean; sessionId: string | null; startedAt: number | null; score: number }`。
- `DesktopBubble = { id: string; x: number; y: number; vx: number; vy: number; radius: number; bornAt: number; expiresAt: number }`。
- `createDesktopBubble(id, bounds, random, now): DesktopBubble` 保证泡泡完整落在安全区域。
- `advanceDesktopBubble(bubble, elapsedMs, bounds): DesktopBubble` 使用秒制速度和边界反弹/回收，不依赖刷新率。
- `canHitDesktopBubble(status, sessionId, bubbleId, now, hitIds): boolean` 验证 session、时限和去重。

- [ ] **Step 1: 写失败测试。** 覆盖随机种子下的安全出生位置、30/60Hz 相同运动距离、过期泡泡回收、错误 session 拒绝和重复命中拒绝。
- [ ] **Step 2: 运行 `npm test -- --run src/shared/desktop-interaction.test.ts`，确认失败。**
- [ ] **Step 3: 实现纯函数和公共类型。** 20 秒 session、最多 60 个有效命中、泡泡半径 24–42px、初速度范围固定；不在这些纯函数里写 Electron 或 React 依赖。
- [ ] **Step 4: 运行测试、类型检查并提交。**

Run: `npm test -- --run src/shared/desktop-interaction.test.ts && npm run typecheck`

Commit: `git add src/shared/types.ts src/shared/desktop-interaction.ts src/shared/desktop-interaction.test.ts && git commit -m "feat: add desktop interaction session domain"`

### Task 4: Electron 快捷窗口、click-through 和 session IPC

**Files:**
- Modify: `electron/main.ts`
- Modify: `electron/preload.ts`
- Modify: `src/bridge.ts`
- Modify: `src/electron.d.ts`
- Create: `electron/desktop-interaction-ipc.test.ts`

**Interfaces:**
- `showQuickWindow(mode: QuickViewMode): void` 复用一个 `quickWindow`，模式变化只更新 query/窗口内容，不创建重复窗口。
- `startDesktopBubbleSession(): Promise<AppSnapshot>`。
- `hitDesktopBubble(sessionId: string, bubbleId: string): Promise<AppSnapshot>`。
- `stopDesktopBubbleSession(sessionId: string, completed: boolean): Promise<AppSnapshot>`。
- `setOverlayMouseMode(mode: "passthrough" | "interactive"): void`。

- [ ] **Step 1: 写失败 IPC/窗口测试。** 覆盖快捷窗口模式切换只保留一个 BrowserWindow、快照广播包含快捷窗口、无效 session/重复 bubble 命中被拒绝、取消不发奖励、完成只结算一次，以及 passthrough/interactive 消息经过可信 sender 校验。
- [ ] **Step 2: 运行 `npm test -- --run electron/desktop-interaction-ipc.test.ts`，确认失败。**
- [ ] **Step 3: 增加 `quickWindow` 生命周期和 `loadView` 路由。** 扩展 `App` 查询值为 `overlay | center | quick`，quick 通过 `mode=care|interaction` 选择页面；`broadcast()` 和可信 renderer 列表包含 quick window，并处理 closed/render-process-gone。
- [ ] **Step 4: 实现 click-through 状态机。** 空闲设为 `setIgnoreMouseEvents(true, { forward: true })`；交互命中设为 false；拖动期间锁定 false；所有取消/失焦路径恢复正确状态；不让快捷框或 Codex 面板改变游戏 session。
- [ ] **Step 5: 实现桌面 session IPC。** 主进程保存 sessionId、开始时间、命中集合和分数，限制 20 秒/60 命中；完成调用既有 `settleGameResult("bubble-pop", score)`，取消不结算，过期自动清除。
- [ ] **Step 6: 运行 Electron/shared 测试并提交。**

Run: `npm test -- --run electron/desktop-interaction-ipc.test.ts src/shared/desktop-interaction.test.ts electron/codex-sessions.test.ts && npm run typecheck`

Commit: `git add electron/main.ts electron/preload.ts src/bridge.ts src/electron.d.ts electron/desktop-interaction-ipc.test.ts && git commit -m "feat: add Xiaoman quick windows and desktop interaction IPC"`

### Task 5: 快捷框和桌面泡泡 renderer

**Files:**
- Create: `src/components/QuickActionsView.tsx`
- Create: `src/components/DesktopBubbleLayer.tsx`
- Modify: `src/App.tsx`
- Modify: `src/components/Overlay.tsx`
- Modify: `src/styles.css`
- Create: `src/components/QuickActionsView.test.tsx`
- Create: `src/components/DesktopBubbleLayer.test.tsx`

**Interfaces:**
- `QuickActionsView({ mode }: { mode: QuickViewMode }): JSX.Element` 只调用已有 care bridge 和新的 desktop interaction bridge。
- `DesktopBubbleLayer({ snapshot, onInteractiveChange }): JSX.Element` 将泡泡运动和命中层与宠物拖动 hitbox 分离。
- `advanceDesktopBubble` 从 `src/shared/desktop-interaction.ts` 导入，不在组件中复制物理规则。

- [ ] **Step 1: 写失败组件契约。** 断言 care 模式没有 Codex/CLI/注视/通知字段，interaction 模式有桌面泡泡入口；断言泡泡点击阻止 pointer/mouse/click 冒泡并调用 bubble IPC，而不是 `moveOverlayBy`。
- [ ] **Step 2: 运行 `npm test -- --run src/components/QuickActionsView.test.tsx src/components/DesktopBubbleLayer.test.tsx`，确认失败。**
- [ ] **Step 3: 实现 QuickActionsView。** 复用 `useCompanion` 快照；养成模式显示四项状态、食物/洗澡/礼包/打工快捷操作；互动模式显示桌面吐泡泡、摸摸和“更多游戏”入口；窗口尺寸稳定、字体不缩小、按钮图标有 tooltip。
- [ ] **Step 4: 实现 DesktopBubbleLayer。** 使用单一 DOM/Canvas 绘制层和 rAF delta-time；泡泡位置直接更新，不使用透明混合；出生和破裂用离散 class/frame；点击停止事件传播并提交 sessionId/bubbleId；无泡泡区域恢复 passthrough。
- [ ] **Step 5: 增加侧边栏两个入口。** 在现有 Codex/鱼干/控制中心按钮之间加入养成与互动图标，分别调用 `showQuick("care")` 和 `showQuick("interaction")`；右键菜单、长按拖动和任务面板行为保持不变。
- [ ] **Step 6: 运行 renderer 测试和类型检查并提交。**

Run: `npm test -- --run src/components/QuickActionsView.test.tsx src/components/DesktopBubbleLayer.test.tsx src/components/OverlayCodexPanel.test.ts && npm run typecheck`

Commit: `git add src/App.tsx src/components/QuickActionsView.tsx src/components/DesktopBubbleLayer.tsx src/components/Overlay.tsx src/styles.css src/components/QuickActionsView.test.tsx src/components/DesktopBubbleLayer.test.tsx && git commit -m "feat: add Xiaoman care and interaction quick panels"`

### Task 6: 集成、视觉 QA、打包和发布

**Files:**
- Modify: `docs/superpowers/sdd/2026-08-27-xiaoman-smooth-actions-and-desktop-interactions/progress.md`
- Create: `work/xiaoman-care-assets/smooth-action-qa-report.json`
- Create: `work/xiaoman-care-assets/desktop-interaction-qa.md`
- Modify: `package.json` only if a new verification script is required.

- [ ] **Step 1: 复读规格和所有任务验收项，检查 native 文件哈希未变化。**
- [ ] **Step 2: 运行完整 TypeScript/Vitest 套件。**

Run: `npm run typecheck && npm test`

- [ ] **Step 3: 运行完整图像验证。**

Run: `PYTHON=/Users/zk/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3 npm run verify:care-atlas && PYTHON=/Users/zk/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3 npm run verify:idle-atlas`

- [ ] **Step 4: 启动 Electron 开发版，在白色、深色和 Codex 窗口上检查 30/60Hz、动作切换、泡泡命中、拖动/点击分离、快捷框关闭恢复和原生 profile 切换。** 保存截图和实际结果，不以源码检查代替。
- [ ] **Step 5: 构建并打包 arm64，检查 asar 内的新图集、快捷窗口代码和游戏资源；运行 ZIP/DMG 校验。**
- [ ] **Step 6: 只在所有验证证据新鲜且通过后更新进度账本、提交发布文档，并按 `finishing-a-development-branch` 决定合并/安装。**

Run: `npm run build && npm run dist:mac && shasum -a 256 -c release/SHA256SUMS`

## 最终执行状态

- Task 1: completed. The shared delta-time clock and single-sprite player are
  covered by runtime tests; native profile selection remains unchanged.
- Task 2: completed. The public care and sleeping atlases pass the strict
  transparency, background, edge, crop and sequence gates. The final output
  starts from 36 generated source poses per expanded sheet, samples 30
  registered runtime slots, and does not use cross-frame RGB/alpha blending.
- Task 3: completed. Desktop bubble physics and hit validation are shared pure
  functions with 30/60 Hz and expiry coverage.
- Task 4: completed. Quick-window lifecycle, sender validation, session IPC and
  region-scoped click-through are implemented. A sandbox preload dependency
  regression was fixed by keeping the protocol limit local to the preload.
- Task 5: completed. Care and interaction have separate compact windows;
  interaction can request the center's games tab without opening a generic
  center view.
- Task 6: completed for the current release candidate. Development and
  packaged Electron smoke tests passed, as did typecheck, Vitest, image gates
  and the arm64 directory package. The QA evidence is in
  `work/xiaoman-care-assets/`.

## 任务冲突扫描

| 任务 | 共享文件/接口 | 检查结果与裁决 |
| --- | --- | --- |
| Task 1 / Task 2 | `PetSprite` 消费图集元数据；Task 2 只产出图集和验证报告，Task 1 只消费已有规格。先完成 Task 2 或保持兼容元数据字段，接口无冲突。 | 裁决：Task 1 使用当前字段名，Task 2 不改动作行语义。 |
| Task 1 / Task 5 | `PetSprite` 与 `Overlay` 都涉及动作显示；没有共享写集。 | 裁决：Task 1 不修改 Overlay 事件逻辑，Task 5 不改播放器内部。 |
| Task 3 / Task 4 | `types.ts` 和 AppSnapshot；Task 4 消费 Task 3 的 `DesktopInteractionStatus`。 | 裁决：Task 3 先提交，Task 4 只使用已导出的类型，不重复定义。 |
| Task 4 / Task 5 | bridge/preload 接口由 Task 4 产出，renderer 由 Task 5 消费。 | 裁决：Task 4 先于 Task 5；缺失接口不得在组件里临时 mock。 |
| Task 2 / Task 6 | 图像报告和完整验证；Task 6 只读取最终资产。 | 裁决：Task 2 完成后锁定资产，QA 不再自动重生图。 |

每个任务内部的测试、实现、验证和提交路径与任务文件一致；没有使用未定义的函数名或占位步骤。
