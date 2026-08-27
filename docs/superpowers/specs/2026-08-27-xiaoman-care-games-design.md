# 小满养成、睡眠与互动游戏设计

## 目标

在不改变 Codex 原生宠物包和现有原生回复能力的前提下，为小满桌面伴侣增加完整的本地养成循环：自动睡眠、库存与食物、洗澡、打工、每日任务、礼包、小游戏和动作预览；同时重新划分“桌宠功能”和“偏好设置”，让每个设置只有一个归属。

## 范围与非目标

本版本包含：

- 可配置的系统无操作自动睡眠，以及完整的蜷缩睡眠动画；
- 小鱼干和其他食物的库存、消耗、效果和获得记录；
- 洗澡/清洁度；
- 本地打工任务、完成时间和离线结算；
- 每日小满任务和奖励领取；
- 礼包的获得、拆开和随机食物奖励；
- 可开关的小游戏模式，以及猜拳、抓鱼、射泡泡三个首批小游戏；
- “桌宠功能”与“偏好设置”的单一归属表单；
- 使用生产图集的动作预览，包括睡眠和护理动作。

本版本不包含：

- 网络账号、社交好友、排行榜、付费货币或远程服务；
- 修改 `~/.codex/pets/xiaoman`、Codex app bundle 或 Codex state DB；
- 真实的外部打工进程或 shell 命令；
- 通过屏幕截图比较像素来判断用户是否在使用电脑；
- 把小游戏输入直接混入透明桌宠拖动区域。

## 交互原则

养成动作、桌面反应和 Codex 事件是三类不同的事件：

1. 养成动作改变库存、属性或任务进度；
2. 桌面反应只改变渲染动作，不伪造养成结果；
3. Codex 监视器只读，任务完成奖励通过幂等的本地账本发放。

任何游戏或养成流程都不能改变 Codex 任务内容、任务 ID、回复通道或原生宠物资源。

## 状态模型

### 属性

`PetStats` 新增：

- `cleanliness: number`，范围 0–100，随清醒时间缓慢下降；
- `experience: number`，累计成长经验；
- `level: number`，从 1 开始，由经验阈值计算。

现有 `fullness`、`affection`、`energy`、`meals` 和 `interactions` 保持兼容。

清洁度低于 18 时，环境状态显示 `dirty`（“该洗澡啦”）。`bathing` 是洗澡动作的短暂业务状态。低清洁度不会覆盖正在运行的 Codex 状态、提醒或显式互动。

`PetState` 增加 `dirty` 和 `bathing`；`PetMotion` 增加 `care-bath` 和 `care-feed`。`eating` 继续是喂食的业务状态，护理图集的喂食行由该状态使用。

### 持久化对象

数据版本由 2 升到 3。旧数据迁移规则：

- 现有属性、提醒、应用规则、词条、活动和设置全部保留；
- `cleanliness` 默认 78，`experience` 默认 0，`level` 默认 1；
- `inventory.food.fish-snack` 默认 8；其他食物为 0；
- `inventory.giftBoxes` 默认 1；
- `activeJob` 默认 `null`；
- 生成当天的每日任务；
- `sleepReason` 默认 `null`；
- `codexRewardLedger` 默认空数组。

核心类型：

```ts
type FoodId = "fish-snack" | "milk" | "tuna-bites" | "salmon";
type JobId = "desk-organizer" | "code-helper" | "delivery-run";
type QuestKind = "feed" | "bathe" | "play" | "work" | "codex-complete" | "open-gift";
type SleepReason = "manual" | "inactivity" | null;

interface Inventory {
  food: Record<FoodId, number>;
  giftBoxes: number;
}

interface RewardBundle {
  food: Partial<Record<FoodId, number>>;
  giftBoxes: number;
  experience: number;
}

interface ActiveJob {
  id: JobId;
  startedAt: number;
  completesAt: number;
  reward: RewardBundle;
}

interface DailyQuest {
  id: string;
  kind: QuestKind;
  title: string;
  target: number;
  progress: number;
  reward: RewardBundle;
  claimed: boolean;
}
```

`PersistedData` 新增 `inventory`、`activeJob`、`dailyQuestDate`、`dailyQuests`、`sleepReason` 和 `codexRewardLedger`。奖励账本最多保留 120 个稳定键，超出时从最旧项开始删除。

### 食物目录

| ID | 名称 | 饱食度 | 精力 | 好感度 |
| --- | --- | ---: | ---: | ---: |
| `fish-snack` | 小鱼干 | +18 | +1 | +1 |
| `milk` | 牛奶 | +12 | +5 | +2 |
| `tuna-bites` | 金枪鱼小方 | +26 | +2 | +3 |
| `salmon` | 三文鱼片 | +38 | +6 | +4 |

喂食必须先扣除库存，数量为 0 时返回明确的“吃完了”结果，不改变属性、不增加用餐次数。现有 `interact("feed")` 保留兼容语义，默认尝试喂一份小鱼干；新的 UI 使用 `feed(foodId)`。

### 奖励规则

- 每次实际完成的 Codex 任务奖励 1 份小鱼干；同一 `threadId + turnId` 只奖励一次；恢复历史状态不补发奖励；
- 每次 Codex 任务完成有 18% 概率额外获得 1 个礼包；
- 打工完成时按工作目录发放固定食物和经验，最长工作不超过 45 分钟；
- 每日任务奖励食物、礼包或经验；
- 小游戏只奖励少量好感度和经验，不直接无限产出食物；
- 打开礼包消耗 1 个礼包，按照固定权重产生食物：小鱼干 45%、牛奶 30%、金枪鱼小方 20%、三文鱼片 5%。

Codex 奖励使用可注入随机函数的纯函数计算，便于测试概率边界和幂等行为。

## 自动睡眠

### 触发

新增设置：

- `autoSleepEnabled: boolean`，迁移后的默认值为 `false`；
- `autoSleepAfterMin: number`，范围 5–180，步长 5，默认 15。

主进程通过 Electron `powerMonitor.getSystemIdleTime()` 获取系统键鼠输入空闲秒数。它不读取屏幕内容，不申请 Screen Recording 权限。内部的拖动、点击、小游戏、提醒、Codex 状态和窗口活动作为额外阻断条件。

只有当小满处于普通环境状态、没有 Codex 工作/等待、没有活动打工、没有活动小游戏且没有高优先级提醒时，系统空闲时间达到阈值才进入 `sleeping`。

### 唤醒

- `sleepReason: "inactivity"`：检测到新的系统用户活动，或用户点击/喂食/洗澡/玩耍时自动唤醒；
- `sleepReason: "manual"`：只由“叫醒”或等价显式动作唤醒；
- Codex 新任务、提醒和打工完成不会静默改写手动睡眠；它们可以显示更高优先级状态，结束后恢复原睡眠原因。

### 睡眠渲染

增强 profile 使用新增的完整身体 `sleeping-30.webp`，30 帧、10 列、3 行，包含蜷缩成团、轻微呼吸和尾巴细动。渲染只使用一个完整身体层，不做透明混合，不拼接头部或脖子。

原生 profile 的原生 `pet.json`、`spritesheet.webp`、`look-16.webp` 保持字节不变；宿主可以使用兼容的低动作睡眠回退，但不能写回原生目录。

## 打工

提供三个本地工作：

| ID | 名称 | 时长 | 完成奖励 |
| --- | --- | ---: | --- |
| `desk-organizer` | 整理桌面 | 10 分钟 | 小鱼干 1，经验 8 |
| `code-helper` | 整理代码线索 | 25 分钟 | 小鱼干 2，经验 18，12% 礼包 |
| `delivery-run` | 给邻居送鱼干 | 45 分钟 | 牛奶 1、金枪鱼小方 1，经验 30 |

同一时间只能有一个工作。开始工作会消耗 4 点精力，设置 `activeJob`，并显示“打工中”；工作完成由主进程维护，应用关闭后重新打开会按 `completesAt` 结算。取消工作不返还已消耗精力，也不发放奖励。

Codex 的 `working` 状态和小满打工共享渲染行但使用不同的 `stateSource` 和文案：Codex 优先，打工不能覆盖真实 Codex 工作状态。

## 洗澡与喂食

洗澡是独立养成动作：

- 清洁度增加 45，最高 100；
- 好感度增加 2；
- 精力减少 1；
- 增加一次互动和每日洗澡任务进度；
- 播放独立护理动作，不占用待机动作调度。

洗澡期间使用新的 `bathing` 临时状态，结束后回到环境状态。喂食使用 `eating` 状态和食物对应的气泡文案。两类动作都不能在活动 Codex 任务上强行切换任务状态。

## 每日任务

每天本地日期变化时生成固定的 5 个任务：

- 喂食 1 次；
- 洗澡 1 次；
- 完成 1 次互动游戏；
- 完成 1 次打工；
- 完成 1 个 Codex 任务。

任务进度只在成功完成对应动作后增加，达到目标后可领取一次奖励。日期切换不删除活动日志或库存，只替换未领取的上一日任务列表。

## 小游戏

### 总开关和生命周期

新增 `gameModeEnabled: boolean`，默认 `true`。关闭时：

- 小游戏入口、右键小游戏菜单和快捷启动均不可用；
- 当前游戏安全结束并释放 `gameActive`；
- 不影响注视、待机动作、喂食、洗澡、打工或 Codex 回复。

游戏在控制中心内运行，使用独立的 `GameSession`，不把游戏输入交给透明桌宠拖动区。游戏开始时通过 IPC 设置临时 `gameActive`，阻止自动睡眠和随机待机动作；结束或关闭时必须在 `finally` 路径清除。

### 首批玩法

1. **猜拳**：三局制，用户选石头/剪刀/布，小满即时反馈，结算好感度和经验。
2. **抓鱼**：20 秒内点击随机出现的鱼干目标，命中计分，复用小满举爪和进食反馈。
3. **射泡泡**：20 秒内点击不同位置的泡泡，特殊泡泡有额外分值，使用原创 CSS/位图素材。

每款游戏拥有 `start`、`tick`、`input`、`finish` 和 `cancel` 边界。分数在主进程只接受经过范围校验的结算值，防止渲染器传入无限奖励。

## UI 信息架构

### 桌宠功能

只包含小满自身的能力：

- 注视开关、180°/360°、30/60 Hz、跟随速度、死区、静止回正时间；
- 体型、拖动奔跑、悬停跳跃和跳跃次数；
- 待机动作、动作子开关、动作间隔和随机说话；
- 自动睡眠及睡眠时间；
- 游戏模式总开关；
- 动作预览；
- 待机词条；
- 养成快捷操作和库存入口。

### 偏好设置

只包含宿主、Codex 和系统集成：

- 小满增强/原生 Codex profile；
- 原生窗口回复、CLI 兼容通道和原生任务不存在时的 CLI 回退；
- Codex 任务控制和 Codex 状态监视；
- 前台应用监视；
- 悬浮窗显示、始终置顶和登录时启动；
- 互动声音、音量、系统通知、主动状态通知和 Codex 完成通知。

提醒计划和应用事件继续使用独立页面管理具体条目；它们的全局开关只在偏好设置出现一次。

### 动作预览

“桌宠功能”右栏提供稳定比例的预览舞台和动作列表。预览使用生产 `PetSprite` 和同一份图集，点击播放一次完整循环，不修改持久化状态、库存、属性或 Codex 状态。可预览正常待机、舔嘴、眨眼、举前爪、左右奔跑、悬停跳跃、洗澡、喂食和蜷缩睡觉。

## 文件边界

### 共享业务层

- `src/shared/types.ts`：新增养成、库存、任务、打工、游戏和设置类型；
- `src/shared/domain.ts`：目录、迁移、归一化、属性衰减、奖励和任务纯函数；
- `src/shared/care.ts`：食物/礼包/工作/任务的纯业务操作；
- `src/shared/games.ts`：游戏 ID、分数边界和结算规则；
- `src/shared/sleep.ts`：自动睡眠资格、唤醒原因和阈值判断。

### Electron 主进程

- `electron/main.ts`：库存和养成 IPC、自动睡眠轮询、工作结算、Codex 奖励和状态广播；
- `electron/preload.ts`、`src/electron.d.ts`：明确暴露养成/游戏 API；
- `electron/store.ts`：继续使用原子保存，由共享层负责 v3 迁移。

### Renderer

- `src/components/FeaturesView.tsx`：改为桌宠功能单一归属布局；
- `src/components/SettingsView.tsx`：移除重复桌宠开关，保留宿主/Codex/系统偏好；
- `src/components/ActionPreview.tsx`：生产渲染器驱动的动作预览；
- `src/components/CareView.tsx`：库存、喂食、洗澡、打工、礼包和每日任务；
- `src/components/GamesView.tsx` 及 `src/components/games/*`：游戏壳和三款小游戏；
- `src/components/ControlCenter.tsx`：导航和页面接线；
- `src/components/Overlay.tsx`、`src/components/PetSprite.tsx`：睡眠/护理/游戏活动互斥。

### 资源

- `public/pet/sleeping-30.webp` 及 metadata：增强 profile 蜷缩睡眠图集；
- `public/pet/care-actions-30.webp` 及 metadata：10 列、6 行，行 0 起的 30 帧为洗澡，行 3 起的 30 帧为喂食/礼包反馈；
- `public/game/*`：原创小游戏辅助素材，不能引用 QQ 资产。

## 测试和验收

共享层测试覆盖：

- v2 到 v3 迁移和坏数据归一化；
- 食物扣库存、属性效果和库存不足；
- 礼包权重边界；
- Codex 奖励幂等和随机礼包；
- 清洁度衰减、等级经验和每日任务重置/领取；
- 工作开始、完成、取消和离线结算；
- 自动睡眠阻断条件、手动/自动唤醒；
- 游戏分数边界和游戏模式开关。

Renderer/Electron QA 覆盖：

- 桌宠功能和偏好设置没有重复控制；
- 动作预览播放和清理定时器；
- 睡眠图集完整身体、透明边缘和 30 Hz 播放；
- 洗澡/喂食/打工/礼包/任务完整链路；
- 游戏开始、取消、结算和关闭总开关；
- Codex 工作时自动睡眠不抢状态，Codex 完成只奖励一次；
- 原生 profile 文件 hash 不变；
- 30/60 Hz 注视、拖动奔跑、右键 round-trip 和任务回复回归。

## 兼容与隐私

新功能全部本地运行。自动睡眠只读取系统空闲时长，不读取屏幕图像、键盘内容、文件内容或网络数据。删除宿主后，原生 Codex 宠物的两个标准文件和宿主之前的 Codex 集成边界保持不变。
