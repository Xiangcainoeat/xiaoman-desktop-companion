# 小满流畅动作与桌面互动设计

**状态：已获用户批准，进入实现。**

## 目标

修复小满喂食、洗澡、睡觉动作的卡顿、重复帧、裁切、黑边和暖色偏差；统一 30/60Hz 帧无关播放；增加真正位于桌面层的可点击泡泡互动；并从侧边栏提供不包含设置的养成与互动快捷框。

## 已确认的根因

- `public/pet/care-actions-30.webp` 的有效动作帧由少量源姿势最近邻复制得到，视觉上不是 30 个真实姿态。
- `public/pet/sleeping-30.webp` 也有重复姿态。
- `scripts/build_idle_atlas_30.py` 使用固定基线和 `_composite_clipped`，前景越过安全框时会静默丢失耳朵、尾巴或道具。
- 边缘清理目前主要针对绿色、洋红色和红粉色污染，没有黑色/深灰色 matte 检查，也没有强制前景远离单元边界。
- `PetSprite` 的动画时钟用 `requestAnimationFrame`，但再按设置帧率量化 React 更新；喂食和睡觉还叠加 CSS transform，造成帧切换与身体变换不同步。
- `BubbleGame` 是控制中心内的 React 页面，用 100ms 定时器和点击后随机换坐标，不能形成桌面层连续互动。
- Electron 主进程目前只有 `overlayWindow` 与 `centerWindow`，没有快捷窗口，也没有 OS 级 click-through 管理。

## 设计边界

### 资产与动画

- 增强版继续使用本地 WebP spritesheet；原生 Codex profile 的 `pet.json`、`spritesheet.webp` 和原生目录不修改。
- 通过本机 `relay-imagegen` CLI 生成补充动作图，生成请求与 Agent 请求共用并发预算。
- 喂食、洗澡、睡觉各自目标为 30 个有意义的时序帧；禁止以最近邻复制填充，允许在动作保持阶段有少量刻意停顿，但相邻完全相同帧比例必须低于 10%。
- 构建器采用共同 union bbox、统一脚底基线、固定安全内边距；任何前景触碰安全边界、透明孔洞或异常边缘颜色都必须失败。
- 运行时不使用透明混合、双图淡入淡出、blur、afterimage 或半透明残影。动作切换显示一个确定帧，必要的过渡由真实离散帧承担。
- 播放器使用 `requestAnimationFrame` 的 `deltaMs`，渲染帧与 React 状态解耦；30Hz/60Hz 只改变采样频率，不改变动作时长。
- 去掉喂食和睡觉的额外 CSS transform/filter 动画；静态阴影允许保留，不能随帧叠加变化。

### 桌面互动

- 同一时刻只允许一个桌面互动 session；控制中心小游戏正在运行时，桌面泡泡不能同时启动。
- 主进程拥有 session 生命周期、命中去重、时限和奖励结算；renderer 只拥有泡泡位置、速度和绘制状态。
- 泡泡拥有连续速度、生命周期、出生/破裂状态和独立命中区域；点击泡泡不得触发宠物拖动、摸摸或跳跃。
- Overlay 空白区域使用 Electron `setIgnoreMouseEvents(true, { forward: true })` 穿透；宠物、侧边按钮、快捷框入口和泡泡区域短暂恢复命中。
- pointerup、pointercancel、lostpointercapture、blur 和 visibilitychange 都必须清理拖动/命中状态。

### 快捷框

- 侧边栏保留 Codex 任务、喂鱼干和完整控制中心，并新增“养成”和“互动”两个图标入口。
- 两个入口打开同一个可复用的紧凑窗口，以 `quick-care` 或 `quick-interaction` 模式显示，避免多个小窗口重叠。
- 养成模式只放状态、食物、洗澡、礼包、打工和任务领取。
- 互动模式只放桌面吐泡泡、摸摸和小游戏入口/结果。
- 注视、帧率、体型、Codex transport、CLI 回退、通知、启动项等设置继续留在完整控制中心。
- 快捷框关闭、崩溃或重新加载不得影响 Overlay、Codex 监听或主进程养成数据。

## 验收标准

1. 30Hz 与 60Hz 播放同一动作的持续时间误差不超过 3%，且不会因为刷新率翻倍而加速。
2. 喂食、洗澡、睡觉的连续重复帧比例低于 10%，相邻帧可见 bbox 位移和基线变化没有突变。
3. 动作帧在白色、深色和棋盘格背景上没有黑边、红棕色泛边、绿边或裁切；验证器报告 `ok: true`。
4. 运行时任意时刻只有一个宠物帧层可见，不产生 opacity crossfade 或残影。
5. 桌面泡泡以连续运动出现、上浮和消失；点击一个泡泡只增加当前 session 分数，不移动桌宠。
6. 空白桌面点击穿透到下层应用；点击宠物、泡泡、侧边按钮仍可用；拖动结束后立即恢复正确模式。
7. 侧边栏的养成/互动入口打开快捷框并显示对应模式；快捷框没有设置类控件。
8. 原生 profile 仍可切换、可启动，且 `~/.codex/pets/xiaoman` 的文件哈希不变。
9. TypeScript、Vitest、图像 Python 测试、打包和实际 Electron 窗口视觉检查全部通过。

## 外部参考

- Electron 透明窗口命中与 `forward`：<https://github.com/electron/electron/blob/main/docs/tutorial/custom-window-interactions.md>
- PixiJS 帧无关 ticker 与 spritesheet 播放模型：<https://pixijs.download/dev/docs/ticker.Ticker.html>、<https://pixijs.download/v8.1.1/docs/scene.AnimatedSprite.html>
- 桌宠窗口和拖拽阈值参考：<https://github.com/kokoronoka/desktopPet>、<https://github.com/coglabss/deskcat>
- QQ 宠物只作为“点击部位触发互动、桌面出现气泡”的体验语义参考，不复制其代码、资源或专有实现。
