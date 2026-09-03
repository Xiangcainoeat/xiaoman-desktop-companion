---
id: xiaoman-mobile-game-shell-2026-09-04
title: 桌面与手机共用游戏状态但使用不同输入层
type: capture
status: inbox
skill_candidate: true
source_project: xiaoman-desktop-companion
evidence: [user-practice, project-source, ai-supplement]
domains: [responsive-web, h5-games, input-adapters]
domain_path: [技术殿堂, Web 应用架构, 响应式游戏宿主与输入适配]
related: [xiaoman-server-hosted-game-assets-2026-09-04]
created: 2026-09-04
---

## 原始问题

“同样的东西，手机端网页打开是另一套。尤其是单机游戏，需要每个做一个手机端的；也可以手动切换。比如俄罗斯方块，手机端应该加一些按钮在局外。”

## 真正的需求

桌面和手机共享游戏实现与存档生命周期，但页面外壳、尺寸和输入方式按设备变化；自动识别不能剥夺用户手动覆盖的能力。

## 它具体对应什么

对应响应式 shell、输入适配器、跨 iframe `postMessage` 键盘事件桥、粗指针检测和持久化显示模式。

## 解决过程

建立 `auto | desktop | mobile` 三种模式，并给全部 11 个单机入口登记手机策略。键盘游戏显示画布外触控按钮，棋盘/拼图类保留直接触摸，外部在线项目保持外部入口。390×844 远程页面验证无横向溢出；俄罗斯方块在手机模式显示左、右、下、旋转和硬降，切到桌面后隐藏。

## 技术选择

选择“一套游戏 + 两套宿主交互”，没有复制每个游戏的业务代码。替代方案是维护独立 mobile build，但会造成规则、修复和存档分叉。iframe 输入统一走版本化消息，宿主在释放触摸时补发 `keyup`，避免按键粘住。

## AI 补充

AI 补充：后续若游戏需要手势摇杆，可在相同 profile 中增加 pointer capture 和方向死区，不必修改游戏注册表或服务器协议。

## 下次怎么提问

“为所有 H5 游戏增加共享业务状态的 mobile shell：自动识别加手动覆盖，按游戏登记直接触摸或外置按键，并在真实手机尺寸验证无溢出和按键释放。”

## 备注

适合整理成脚本辅助 Skill，边界是宿主布局、输入 profile、跨 iframe 事件和桌面/手机视觉验收。
