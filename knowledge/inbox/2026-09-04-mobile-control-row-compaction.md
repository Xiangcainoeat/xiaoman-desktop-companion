---
id: xiaoman-mobile-control-row-compaction-2026-09-04
title: 移动端游戏方向键与功能键紧凑同行
type: capture
status: inbox
skill_candidate: false
source_project: xiaoman-desktop-companion
evidence: [user-practice, project-source, ai-supplement]
domains: [web-ui, responsive-layout, game-controls]
domain_path: [技术殿堂, Web UI 设计, 响应式游戏控制布局]
related: [xiaoman-mobile-game-shell-2026-09-04, game-board-layout-and-mobile-gesture-guard-2026-09-04]
created: 2026-09-04
---

## 原始问题

“这样依然不够紧凑，尽量和上下左右的上键在一行。”

## 真正的需求

移动端游戏控制区不能因为新增 Enter、空格等功能键而纵向增加一整行。成功标准是：上键与功能键在第一行，左、下、右在第二行；长功能名称保持单行，且没有功能键的游戏仍居中显示方向键。

## 它具体对应什么

这是响应式复合控制器布局问题：方向键十字布局与动作键组需要共享 CSS Grid，而不是作为两个纵向堆叠的独立区块。

## 解决过程

将移动端 `.mobile-game-control-groups` 改为四列两行网格。方向键组占前三列和两行，动作键组占第三至第四列的第一行，因此功能键与上键同高；方向键自身仍保持第二行的左、下、右。通过 390x844 视口打开吃豆人实际截图验证，控件两行完整显示且功能文字不换行。随后通过前端 511 项测试、服务端 17 项测试和生产构建。

## 技术选择

选择只调整移动端 CSS 网格，不修改键盘事件或游戏协议，避免影响已经验证过的控制映射。替代方案是缩小按钮或继续上下堆叠，但前者降低可触达性，后者仍浪费垂直空间。

## AI 补充

AI 补充：触屏控件应优先减少容器层级与空行，而不是无限缩小点击目标。组合网格可同时维持约 43px 的按钮高度和更紧凑的整体高度。

## 下次怎么提问

“将移动端方向键和动作键重排为两行复合网格：第一行是上键和动作键，第二行是左、下、右；动作名称不换行，无动作键时方向盘居中。”

## 备注

作为本项目移动端游戏壳层的维护笔记保留，目前不需要独立 Skill。
