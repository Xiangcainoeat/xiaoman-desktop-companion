# 小满养成、睡眠与互动游戏实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **执行状态：已完成（2026-08-27）。** 养成、睡眠、小游戏、界面拆分、资源校验和 1.4.0 发布物均已落地并通过最终验证；下方步骤保留为实施记录。

**Goal:** 在保留 Codex 原生宠物和回复边界的前提下，为小满增加可持久化养成系统、自动蜷缩睡眠、可开关小游戏、生产动作预览，并重排“桌宠功能/偏好设置”界面。

**Architecture:** 将库存、食物、礼包、任务、打工、睡眠资格和游戏结算实现为共享纯函数；Electron 主进程负责持久化、系统空闲检测、工作结算、Codex 奖励幂等和 IPC 校验；React renderer 负责动作预览、养成表单和小游戏会话。增强 profile 使用新增完整身体护理/睡眠图集，native profile 资源不写回、不替换。

**Tech Stack:** TypeScript 6, React 19, Electron 44, Vite 8, Vitest 4, Python/Pillow 图集脚本, electron-builder。

**Spec:** `docs/superpowers/specs/2026-08-27-xiaoman-care-games-design.md`

## Global Constraints

- 数据版本从 2 迁移到 3，旧属性、提醒、应用规则、词条、活动和设置必须保留。
- 自动睡眠默认关闭；开启后 `autoSleepAfterMin` 范围为 5–180 分钟，步长 5，默认 15。
- 系统空闲使用 Electron `powerMonitor.getSystemIdleTime()`；禁止屏幕截图比较和读取键盘内容。
- Codex 完成奖励以 `threadId + turnId` 幂等；恢复历史事件不补发。
- 小鱼干和所有食物必须经过库存扣除；库存不足不得增加属性或互动次数。
- 游戏模式默认开启但可关闭；游戏输入不进入透明桌宠拖动区域。
- 原生 profile 的 `pet.json`、`spritesheet.webp`、`look-16.webp` 不修改、不写回 `~/.codex/pets/xiaoman`。
- 增强注视继续使用一个完整身体层、无透明混合；30/60 Hz、速度响应、死区和回正行为保持不变。
- 生图和扩帧使用本机已有图像流程；所有并发任务（生图和 Agent 合计）不超过 6。
- 每个任务完成后运行自身测试并提交一个小 commit；不得使用破坏性 git 命令。

## 文件地图

- `src/shared/types.ts`: 养成、库存、任务、工作、游戏和新增设置的公共类型。
- `src/shared/domain.ts`: v3 默认值、迁移、归一化、属性衰减和状态派生。
- `src/shared/care.ts`: 食物、礼包、工作、每日任务和 Codex 奖励的纯业务操作。
- `src/shared/sleep.ts`: 自动睡眠阈值和唤醒资格的纯函数。
- `src/shared/games.ts`: 游戏 ID、分数边界和结算规则。
- `electron/main.ts`: 主进程状态、系统空闲轮询、工作/礼包/Codex 奖励结算和 IPC。
- `electron/preload.ts`, `src/electron.d.ts`, `src/bridge.ts`: 明确的养成和游戏 API，以及浏览器 mock。
- `src/components/PetSprite.tsx`: 护理/睡眠图集选择和统一动画渲染。
- `src/components/ActionPreview.tsx`: 生产渲染器驱动的一次性动作预览。
- `src/components/CareView.tsx`: 库存、喂食、洗澡、打工、礼包和每日任务。
- `src/components/GamesView.tsx`, `src/components/games/*`: 游戏壳和三款小游戏。
- `src/components/FeaturesView.tsx`: 仅保留桌宠自身功能与预览入口。
- `src/components/SettingsView.tsx`: 仅保留宿主、Codex 和系统偏好。
- `src/components/ControlCenter.tsx`, `src/components/Overlay.tsx`: 导航、互斥状态和入口接线。
- `public/pet/sleeping-30.webp`, `public/pet/care-actions-30.webp`, `public/game/*`: 新的本地资源。

### Task 1: 共享类型、v3 迁移与养成纯业务层

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/shared/domain.ts`
- Create: `src/shared/care.ts`
- Create: `src/shared/sleep.ts`
- Create: `src/shared/games.ts`
- Test: `tests/domain.test.ts`
- Create: `tests/care.test.ts`
- Create: `tests/sleep.test.ts`
- Create: `tests/games.test.ts`

**Interfaces:**
- `normalizePersistedData(value: unknown): PersistedData` 接受版本 1、2、3 并返回版本 3。
- `applyFeed(data: PersistedData, foodId: FoodId, now: number): CareOperationResult`。
- `applyBath(data: PersistedData, now: number): CareOperationResult`。
- `startPetJob(data: PersistedData, jobId: JobId, now: number): CareOperationResult`。
- `completePetJob(data: PersistedData, now: number): CareOperationResult`。
- `openGiftBox(data: PersistedData, random: () => number): CareOperationResult`。
- `claimDailyQuest(data: PersistedData, questId: string, now: number): CareOperationResult`。
- `grantCodexCompletionReward(data: PersistedData, key: string, random: () => number, now: number): CareOperationResult`。
- `shouldAutoSleep(input: AutoSleepInput): boolean`。
- `shouldAutoWake(input: AutoWakeInput): boolean`。
- `settleGameResult(gameId: GameId, score: number): GameSettlement`。

- [ ] **Step 1: Write failing tests for v3 migration and defaults.** Assert that v2 data keeps existing stats/settings, receives `cleanliness: 78`, `level: 1`, eight fish snacks, one gift box, no active job, current daily quests and empty reward ledger; assert malformed nested inventory is normalized.
- [ ] **Step 2: Run the focused tests and verify they fail for missing fields/functions.**

Run: `npm test -- --run tests/domain.test.ts tests/care.test.ts tests/sleep.test.ts tests/games.test.ts`

Expected: FAIL because the v3 fields and pure business modules do not exist yet.

- [ ] **Step 3: Add public types and v3 normalization.** Add `FoodId`, `JobId`, `QuestKind`, `SleepReason`, `GameId`, `Inventory`, `RewardBundle`, `ActiveJob`, `DailyQuest`, `GameSettlement`, `CareOperationResult`; add `cleanliness`, `experience`, `level`; add `autoSleepEnabled`, `autoSleepAfterMin`, `gameModeEnabled`; normalize all numbers and cap food/gift quantities at 9999.
- [ ] **Step 4: Implement food, gift, job, quest and Codex reward functions.** Use the exact food effects and gift weights from the spec. `applyFeed` must return `{ ok: false, message: "小鱼干吃完啦" }` style failure without mutating stats when quantity is zero. `grantCodexCompletionReward` must return the same data when `key` already exists and append at most 120 keys.
- [ ] **Step 5: Implement sleep and game pure functions.** Auto sleep must reject active Codex, reminders, jobs, games and manual sleep; game settlements must clamp score and return fixed affection/experience ranges.
- [ ] **Step 6: Run focused tests and commit.**

Run: `npm test -- --run tests/domain.test.ts tests/care.test.ts tests/sleep.test.ts tests/games.test.ts`

Expected: all focused tests pass.

Commit: `git add src/shared tests && git commit -m "feat: add v3 Xiaoman care domain"`

### Task 2: Sleep and care animation assets

**Files:**
- Create: `work/xiaoman-care-assets/sleeping-prompt.md`
- Create: `work/xiaoman-care-assets/care-prompt.md`
- Create: `work/xiaoman-care-assets/generated-sleeping.png`
- Create: `work/xiaoman-care-assets/generated-care.png`
- Create: `scripts/build_care_atlas_30.py`
- Create: `scripts/verify_care_atlas_30.py`
- Create: `public/pet/sleeping-30.webp`
- Create: `public/pet/sleeping-30.json`
- Create: `public/pet/care-actions-30.webp`
- Create: `public/pet/care-actions-30.json`
- Create: `tests/test_care_atlas_30.py`

**Interfaces:**
- `build_care_atlas_30.py --sleep-source ... --care-source ... --output-dir ...` emits deterministic RGBA atlases with 192x208 cells.
- `verify_care_atlas_30.py <atlas> <metadata>` exits nonzero for missing/empty frames, wrong dimensions, mid-alpha contamination or magenta/green edge contamination.

- [ ] **Step 1: Write the asset contract test.** Require 30 non-empty sleep frames, 30 non-empty bath/feeding frames, fixed cell metadata, transparent corners and stable light-fur color relative to `work/xiaoman-pet-96/generation-inputs/native-color-reference.png`.
- [ ] **Step 2: Generate the curled sleeping and care source images through the local image-generation skill.** Keep Xiaoman’s native cream/brown/blue-eye palette, transparent background, complete body silhouette, no neck splice, and no third-party character assets. Keep total active generation/Agent concurrency below 6.
- [ ] **Step 3: Implement deterministic frame extraction, de-spill and atlas assembly.** Build `sleeping-30.webp` as 10x3 and `care-actions-30.webp` as 10x6; the first 30-frame animation starts at row 0 (bath), and the second starts at row 3 (feeding/gift feedback), matching `atlasFramePosition`.
- [ ] **Step 4: Verify the atlases and inspect contact sheets.**

Run: `sh scripts/run_image_python.sh scripts/verify_care_atlas_30.py public/pet/sleeping-30.webp public/pet/sleeping-30.json`

Expected: 30 valid complete-body frames and no edge contamination.

- [ ] **Step 5: Run the Python contract test and commit.**

Run: `python3 -m unittest tests/test_care_atlas_30.py`

Commit: `git add work/xiaoman-care-assets scripts public/pet tests/test_care_atlas_30.py && git commit -m "feat: add Xiaoman sleep and care atlases"`

### Task 3: Main-process persistence, IPC and offline settlement

**Files:**
- Modify: `electron/main.ts`
- Modify: `electron/preload.ts`
- Modify: `src/electron.d.ts`
- Modify: `src/bridge.ts`
- Test: `electron/care-ipc.test.ts`
- Test: `electron/codex-ipc.test.ts`
- Test: `electron/codex-sessions.test.ts`

**Interfaces:**
- `feedFood(foodId: FoodId): Promise<AppSnapshot>`
- `bathePet(): Promise<AppSnapshot>`
- `openGiftBox(): Promise<AppSnapshot>`
- `startPetJob(jobId: JobId): Promise<AppSnapshot>`
- `cancelPetJob(): Promise<AppSnapshot>`
- `claimDailyQuest(questId: string): Promise<AppSnapshot>`
- `setGameActive(active: boolean): void`
- `completeGame(gameId: GameId, score: number): Promise<AppSnapshot>`

- [ ] **Step 1: Write failing IPC tests.** Cover inventory-depleted feeding, bath update, job start/completion after a fake clock advance, quest claim, game score clamp, auto-sleep blocked while game/Codex is active, and one Codex completion reward despite duplicate monitor events.
- [ ] **Step 2: Run focused Electron tests and verify failures.**

Run: `npm test -- --run electron/care-ipc.test.ts electron/codex-ipc.test.ts`

- [ ] **Step 3: Add typed preload bridge methods and browser mock implementations.** The mock must mutate the same domain shape and return explicit failure messages so browser UI remains testable.
- [ ] **Step 4: Add main-process handlers and centralize mutation.** Every handler validates IDs and quantities, calls the pure domain function, logs one activity event, persists atomically and broadcasts one snapshot. Do not add parallel ad hoc inventory mutations in components.
- [ ] **Step 5: Add maintenance timers.** Poll system idle time once per second only when auto sleep is enabled; settle due jobs every 10 seconds; initialize/reset daily quests on launch; use `powerMonitor` lock/resume events without reading screen content. Auto sleep must never supersede Codex, reminder or active game state.
- [ ] **Step 6: Add idempotent Codex rewards.** On non-recovered successful completion call `grantCodexCompletionReward` with `threadId + ":" + turnId`; append an activity item describing the reward without recording task content.
- [ ] **Step 7: Run Electron/shared tests and commit.**

Run: `npm test -- --run electron/care-ipc.test.ts electron/codex-ipc.test.ts electron/codex-sessions.test.ts tests/care.test.ts tests/sleep.test.ts`

Commit: `git add electron src/bridge.ts src/electron.d.ts tests && git commit -m "feat: wire Xiaoman care and sleep IPC"`

### Task 4: PetSprite sleep/care rendering and action preview

**Files:**
- Modify: `src/components/PetSprite.tsx`
- Create: `src/components/ActionPreview.tsx`
- Modify: `src/components/OverviewView.tsx`
- Modify: `src/styles.css`
- Test: `tests/pet-sprite-contract.test.ts`
- Create: `src/components/ActionPreview.test.tsx`

**Interfaces:**
- `ActionPreview({ settings, actions, onClose }): JSX.Element` renders the same `PetSprite` implementation as the overlay.
- `PetSprite` recognizes the `sleeping` and `bathing` state plus `care-bath`/`care-feed` motion specs without changing the full-body gaze path.

- [ ] **Step 1: Add failing renderer contracts.** Assert one complete sleep/care atlas layer, no opacity transition, no head-look layer, and preview cleanup after one cycle.
- [ ] **Step 2: Run the focused tests to verify failure.**
- [ ] **Step 3: Add atlas metadata and animation specs.** Enhanced `sleeping` uses the 30-frame sleep atlas; `care-bath` uses care row 0 and `care-feed` uses care row 3, each with 30 frames; native profile falls back to its existing full-body standard row without mutating native assets.
- [ ] **Step 4: Implement `ActionPreview`.** Provide stable stage dimensions, play-once controls for idle, lick, blink, raised paw, run left/right, jump, bath, feed and sleep; preview is side-effect free and can play disabled actions for inspection.
- [ ] **Step 5: Run renderer tests and commit.**

Run: `npm test -- --run tests/pet-sprite-contract.test.ts src/components/ActionPreview.test.tsx`

Commit: `git add src/components/PetSprite.tsx src/components/ActionPreview.tsx src/components/OverviewView.tsx src/styles.css tests && git commit -m "feat: preview Xiaoman care and sleep actions"`

### Task 5: Separate feature and preference forms

**Files:**
- Modify: `src/components/FeaturesView.tsx`
- Modify: `src/components/SettingsView.tsx`
- Modify: `src/components/ControlCenter.tsx`
- Modify: `src/styles.css`
- Modify: `src/components/SettingsView.test.ts`
- Create: `src/components/FeaturesView.test.tsx`

**Interfaces:**
- Navigation labels become `桌宠功能` and `偏好设置`.
- `桌宠功能` owns gaze, movement, idle actions, auto sleep, game mode, action preview and pet-size controls.
- `偏好设置` owns profile, Codex transport/fallback, monitoring, window/startup and sound/notification controls.

- [ ] **Step 1: Write failing ownership tests.** Assert each setting label appears in exactly one view; assert Codex transport/fallback is absent from the feature view and gaze/idle controls are absent from settings.
- [ ] **Step 2: Run the UI contract tests and verify failure.**
- [ ] **Step 3: Rewrite the feature form into stable behavior sections.** Use a left control column and a right preview/quick-action column; keep one control per persisted field and include auto sleep/game mode switches.
- [ ] **Step 4: Rewrite settings into host/Codex/system sections.** Keep reminder and application-rule editors in their own pages; remove duplicate global toggles from the feature page.
- [ ] **Step 5: Add responsive layout rules and accessible labels.** Use fixed control rails, 16px primary labels, natural wrapping and one-column fallback under the existing narrow breakpoint; ensure no nested card layout or overlap.
- [ ] **Step 6: Run UI tests and commit.**

Run: `npm test -- --run src/components/SettingsView.test.ts src/components/FeaturesView.test.tsx`

Commit: `git add src/components/FeaturesView.tsx src/components/SettingsView.tsx src/components/ControlCenter.tsx src/styles.css src/components/*.test.tsx && git commit -m "refactor: separate pet features and preferences"`

### Task 6: Care center for food, bath, jobs, gifts and quests

**Files:**
- Create: `src/components/CareView.tsx`
- Create: `src/components/CareView.test.tsx`
- Modify: `src/components/ControlCenter.tsx`
- Modify: `src/components/OverviewView.tsx`
- Modify: `src/styles.css`

**Interfaces:**
- `CareView` consumes `AppSnapshot` and calls `bridge.feedFood`, `bridge.bathePet`, `bridge.openGiftBox`, `bridge.startPetJob`, `bridge.cancelPetJob`, and `bridge.claimDailyQuest`.
- The view displays `cleanliness`, `inventory.food`, `inventory.giftBoxes`, `activeJob`, `dailyQuests` and level/experience.

- [ ] **Step 1: Write failing component tests.** Cover food quantity labels, disabled feed button at zero, bath action, job start/cancel, gift opening and quest claim button states.
- [ ] **Step 2: Implement the care view.** Use a clear inventory strip, care actions, job list with remaining time, gift opener, and daily quest list. All reward/error responses appear in the view without fake optimistic inventory changes.
- [ ] **Step 3: Add a compact care summary to Overview.** Show cleanliness, current food counts, active job and next quest without duplicating editable controls.
- [ ] **Step 4: Add navigation and styling, then run tests.**

Run: `npm test -- --run src/components/CareView.test.tsx`

Commit: `git add src/components/CareView.tsx src/components/OverviewView.tsx src/components/ControlCenter.tsx src/styles.css src/components/CareView.test.tsx && git commit -m "feat: add Xiaoman care center"`

### Task 7: Game shell and three local mini-games

**Files:**
- Create: `src/components/GamesView.tsx`
- Create: `src/components/games/RockPaperScissors.tsx`
- Create: `src/components/games/FishingGame.tsx`
- Create: `src/components/games/BubbleGame.tsx`
- Create: `src/components/games/GameShell.tsx`
- Create: `src/components/games/GameShell.test.tsx`
- Modify: `src/components/ControlCenter.tsx`
- Modify: `src/styles.css`
- Create: `public/game/fish-target.png`
- Create: `public/game/bubble-target.png`

**Interfaces:**
- `GameDefinition` has `id`, `title`, `description`, `start`, `cancel`, and `render` boundaries.
- `GameShell` calls `bridge.setGameActive(true)` on mount and clears it in cleanup; completion calls `bridge.completeGame(gameId, score)` exactly once.

- [ ] **Step 1: Write failing game lifecycle tests.** Assert the global switch blocks entry, cleanup clears game activity on unmount, score is submitted once, and closing during a round does not grant a reward.
- [ ] **Step 2: Implement the shared shell and game registry.** Keep game state renderer-local, use a 20-second timer for fishing/bubbles and three rounds for rock-paper-scissors, and expose cancel/finish paths.
- [ ] **Step 3: Implement the three games with original Xiaoman-styled visuals.** Use the existing pet/avatar plus local target assets; do not copy QQ artwork or branding. Keep controls click-first and prevent pointer events from bubbling into the overlay drag target.
- [ ] **Step 4: Add the `游戏模式` master switch and launcher to `桌宠功能`.** When off, hide/disable game cards and never auto-launch a game.
- [ ] **Step 5: Run tests and commit.**

Run: `npm test -- --run src/components/games/GameShell.test.tsx tests/games.test.ts`

Commit: `git add src/components/GamesView.tsx src/components/games src/components/ControlCenter.tsx src/styles.css public/game && git commit -m "feat: add switchable Xiaoman mini-games"`

### Task 8: Overlay/state integration and documentation

**Files:**
- Modify: `src/components/Overlay.tsx`
- Modify: `src/components/PetSprite.tsx`
- Modify: `src/shared/domain.ts`
- Modify: `docs/STATES.md`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/DELIVERY.md`
- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `release/qa/care-sleep-game-smoke-test.md`

- [ ] **Step 1: Write integration regression tests.** Assert sleeping suppresses gaze/idle actions, auto sleep never overrides Codex working, game active blocks sleep, feed buttons use inventory, and existing full-body 96-direction gaze still selects one layer.
- [ ] **Step 2: Integrate overlay behavior.** Sleeping click wakes according to `sleepReason`; care/game controls do not arm drag; active game and care motions suppress idle scheduling only for their duration.
- [ ] **Step 3: Update state tables, README, delivery notes and changelog.** Document schema 3, local rewards, no-screen-capture idle detection, game switch, action preview and native profile boundary.
- [ ] **Step 4: Bump version to 1.4.0 and add verification scripts.** Preserve native resource hashes and add care/sleep atlas checks to the release checklist.
- [ ] **Step 5: Run the complete test suite and typecheck.**

Run: `npm run typecheck && npm test -- --run && python3 -m unittest discover -s tests -p 'test_*.py'`

Expected: all TypeScript/Python tests pass with no new native-profile mutations.

Commit: `git add src electron docs README.md CHANGELOG.md package.json package-lock.json release/qa && git commit -m "feat: ship Xiaoman care sleep and games"`

### Task 9: Packaged visual QA and release artifact

**Files:**
- Create: `work/qa-v1.4.0-sleep-care-game.png`
- Create: `work/qa-v1.4.0-settings-separation.png`
- Create: `work/qa-v1.4.0-action-previews.png`
- Create: `work/qa-v1.4.0-game-mode.png`
- Modify: `release/SHA256SUMS`
- Create: `release/Xiaoman-Desktop-Companion-1.4.0-arm64.dmg`
- Create: `release/Xiaoman-Desktop-Companion-1.4.0-arm64.zip`

- [ ] **Step 1: Build the macOS package.**

Run: `npm run dist:mac`

- [ ] **Step 2: Launch the packaged app and capture desktop QA.** Verify curled sleep, wake, bath/feed motion, inventory decrement, job countdown/completion, quest claim, game start/cancel, feature/settings separation, and no overlap at desktop and narrow widths.
- [ ] **Step 3: Run regression checks.** Verify 30/60 Hz full-body gaze, lower-half continuity, no opacity crossfade/ghosting, drag running, native profile hashes, Codex task list/reply behavior and explicit CLI fallback.
- [ ] **Step 4: Generate checksums and inspect the final git diff.**

Run: `(cd release && shasum -a 256 -c SHA256SUMS)`

Expected: every listed release artifact reports `OK`; `git diff --check` is clean and no unrelated files changed.

- [ ] **Step 5: Commit QA metadata and report installed app path.**

Commit: `git add work/qa-v1.4.0-* release && git commit -m "qa: publish Xiaoman 1.4.0 care release"`
