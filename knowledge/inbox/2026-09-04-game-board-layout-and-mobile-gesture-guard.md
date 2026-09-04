---
id: game-board-layout-and-mobile-gesture-guard-2026-09-04
title: 联机棋盘扩展与移动端长按防干扰
type: capture
status: inbox
skill_candidate: false
source_project: xiaoman-desktop-companion
evidence: [user-practice, project-source]
domains: [responsive-design, web-games, touch-input]
domain_path: [技术殿堂, Web 游戏集成, 响应式棋盘与触控手势]
related: [online-board-focus-layout-2026-09-04]
created: 2026-09-04
---

## 原始问题

“那些联机的尽量就是棋盘，左右尽量能占满一个屏幕。禁用手机端的右键复制，避免长按时弹出选中复制干扰游戏。”

## 真正的需求

对局中优先把可用视口交给棋盘，同时保留紧凑的房间操作区；手机长按棋盘或单机游戏画面时不能弹出复制、选择、拖图或上下文菜单，但房间码等正常复制入口仍须可用。

## 它具体对应什么

这对应 board-first 响应式布局、视口高度约束，以及只在游戏交互表面生效的浏览器默认手势抑制。

## 解决过程

扩大联机工作区最大宽度、收窄控制侧栏并按 `dvh` 约束棋盘边长；公共网页进入对局后隐藏重复顶栏，把空间留给棋盘。单机游戏表面与联机棋盘分别拦截 `contextmenu`、`copy`、`cut`、`dragstart`、`selectstart`，并添加 `user-select`、`touch-callout` 和拖图禁用样式。联机房间码区域不在拦截范围内。

## 技术选择

选择作用域化事件保护，而不是在 `document` 全局禁用复制。全局禁用会破坏邀请码和房间号复制，也会降低页面可访问性。

## AI 补充

AI 补充：`touch-action: manipulation` 适合棋盘点按，但需要拖拽或双指缩放的游戏应改用更精细的 Pointer Events 手势状态机。

## 下次怎么提问

“请把联机对局改成 board-first 响应式布局，并只在棋盘和游戏画面禁用移动端长按选择、复制和拖图，保留邀请码区域的复制能力。”

## 备注

本次作为项目维护笔记保留，不单独提炼为 Skill。
