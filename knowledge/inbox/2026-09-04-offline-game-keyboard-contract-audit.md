---
id: offline-game-keyboard-contract-audit-2026-09-04
title: 单机游戏键盘契约审计与移动端映射
type: capture
status: inbox
skill_candidate: false
source_project: xiaoman-desktop-companion
evidence: [user-practice, project-source]
domains: [web-games, input-handling, mobile-ui]
domain_path: [技术殿堂, Web 游戏集成, 输入事件与移动端控制]
related: [xiaoman-mobile-game-shell-2026-09-04]
created: 2026-09-04
---

## 原始问题

“单机游戏一些空格 Enter 没有去设计，你遗忘了有些游戏。”

## 真正的需求

逐个确认内置游戏实际监听的键，而不是给所有游戏套用同一组方向键和空格键；桌面键盘说明、移动端按钮和发给 iframe 的键盘事件必须保持一致。

## 它具体对应什么

这对应第三方 H5 游戏的输入契约审计、跨 iframe 键盘事件桥接和移动端等价控制设计。

## 解决过程

对照每个内置项目源码确认按键：吃豆人使用方向键与 Enter/Space 开始、暂停或重开；俄罗斯方块使用 Space 硬降；星际大战使用 WASD 与 Space 发射；太空侵略者使用 Space 开始或重开；坦克大战沿用 WASD/J；其余游戏保留各自真实映射。随后统一更新按键帮助、移动端按钮和事件派发，并增加契约测试。

## 技术选择

选择显式的逐游戏控制配置，而不是通过游戏名称猜测通用按键。这样增加新游戏时必须声明控制契约，也能避免 UI 文案与实际游戏行为漂移。

## AI 补充

AI 补充：第三方游戏升级后，应把输入契约测试作为升级检查项；仅验证按钮存在不足以证明 iframe 收到了正确的 `keyCode` 和 `code`。

## 下次怎么提问

“请逐个审计所有内置单机游戏的源码按键，并让桌面说明、移动端按钮和 iframe 键盘事件三者一致；为 Enter、Space 和非标准按键补测试。”

## 备注

本次作为项目维护笔记保留，不单独提炼为 Skill。
