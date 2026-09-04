---
id: xiaoman-mobile-game-scroll-direct-input-2026-09-04
title: 手机游戏页只保留一个滚动容器与一种输入方式
type: capture
status: inbox
skill_candidate: true
source_project: xiaoman-desktop-companion
evidence: [user-practice, project-source, ai-supplement]
domains: [responsive-web, h5-games, touch-input]
domain_path: [技术殿堂, Web 应用架构, 移动游戏滚动与输入边界]
related: [xiaoman-mobile-game-shell-2026-09-04]
created: 2026-09-04
---

## 原始问题

“没法上下滑动，窗口会造成遮挡；上下左右应该放到最中间。象棋和 2048 不需要下面的框；坦克大战没有放在最中间；五子棋不能滑动。”

## 真正的需求

手机页面必须能从工具栏滚到游戏末尾，并且不能同时出现页面滚动、游戏内部滚动和重复触控面板。直接触摸棋盘的游戏只保留原生手势，键盘游戏才显示居中的外置按钮。

## 技术映射

这对应单一滚动所有权、响应式 overflow 覆盖、iframe 焦点与滚动位置隔离、按游戏登记的输入 profile，以及触控按钮的稳定网格布局。

## 采用方案

在 760px 以下把 `.content-scroll.is-games` 设为唯一纵向滚动容器，解除活动游戏及五子棋后代节点的固定高度和嵌套 overflow。2048 与象棋走 direct profile 且不渲染底部控制框；键盘游戏的方向区固定在网格中列。手机模式下 iframe 获得焦点时不再重置祖先滚动位置。

## 备选方案

可以让每个 iframe 自己滚动，但会要求用户先点进游戏再滑动，也容易和浏览器返回手势冲突；也可以为每个游戏复制一套手机页面，但会产生规则与存档分叉，因此均未采用。

## 验证

390×844 视口逐项打开俄罗斯方块、象棋、2048、坦克大战和五子棋。象棋与 2048 无额外底框；坦克舞台中心偏差小于 0.01px；五子棋外层滚动从 0 到 151px，并能露出完整设置区。前端 495 项测试、服务器 16 项测试和 TypeScript 类型检查通过。

## AI 补充

AI 补充：以后新增游戏时，应先判断输入归属是 direct、buttons 还是 external，再决定是否渲染宿主控制层；不要根据屏幕尺寸统一添加方向键。

## 下次怎么提问

“检查移动游戏页的单一滚动所有权：直接触摸游戏不加重复控制框，键盘游戏把方向键居中，并在真实手机视口验证能滚到内容末尾。”

## 备注

这是既有移动游戏宿主记录的修订项，适合并入响应式游戏宿主 Skill 的验收清单。
