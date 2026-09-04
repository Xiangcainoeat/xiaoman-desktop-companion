---
id: online-room-explicit-selection-2026-09-04
title: 新建联机房间被旧对局抢占
type: capture
status: inbox
skill_candidate: false
source_project: xiaoman-desktop-companion
evidence: [user-practice, project-source, ai-supplement]
domains: [web-ui, realtime-games, react-state]
domain_path: [技术殿堂, Web 应用开发, React 状态与联机房间]
related: [online-room-rematch-state-machine-2026-09-04]
created: 2026-09-04
---

## 原始问题

“我创建新房间的时候，如果有游戏已经开着的话，好像会直接跳转到这个游戏，必须返回房间才可以再点进入这个新开的游戏。”

## 真正的需求

创建或加入房间成功后，界面必须立即打开本次操作返回的房间。账户中仍在运行的旧房间只能留在“我的房间”列表，不能抢占新房间视图。

## 它具体对应什么

这是 React 局部导航状态与异步全局快照之间的竞态。`activeRoomId` 适合记录客户端最近活动房间，但不足以同时表达用户当前明确选择展示的房间。

## 解决过程

复现路径是先打开一个五子棋房间，再切回联机大厅创建中国象棋房间。修复后，创建和加入回调显式传递服务器返回的 `room.id`，父级工作区以 `selectedRoomId` 控制房间详情；房间列表的创建、加入、进入、返回和离开也走同一选择状态。浏览器验证中旧房间 `XM187344` 仍存在，新房间创建后直接显示中国象棋房间 `XM676287`。

## 技术选择

选择由父级持有 `selectedRoomId`，而不是增加延时等待快照或继续读取全局 `activeRoomId`。显式 ID 没有时序依赖，也能避免 WebSocket 对旧房间的更新意外改变当前视图。替代方案是在创建后等待一次 React 重渲染，但仍会留下竞态，因此未采用。

## AI 补充

AI 补充：实时应用通常应区分“数据层当前对象”和“界面层选中对象”。前者可由服务端事件更新，后者应由用户动作或明确导航结果更新。

## 下次怎么提问

“修复联机房间选择竞态：已有旧房间处于 playing 时，从大厅创建或加入新房间，必须使用接口返回的 roomId 直接打开新房间，不能由旧 activeRoomId 决定视图；请补行为回归测试。”

## 备注

这是联机房间状态管理的维护记录，暂不单独制作 Skill。
