---
id: xiaoman-online-undo-protocol-2026-09-04
title: 联机棋类使用服务端确认式悔棋
type: capture
status: inbox
skill_candidate: false
source_project: xiaoman-desktop-companion
evidence: [user-practice, project-source, ai-supplement]
domains: [multiplayer-games, websocket, state-consistency]
domain_path: [技术殿堂, 实时系统, 联机棋局状态一致性]
related: [xiaoman-mobile-game-shell-2026-09-04]
created: 2026-09-04
---

## 原始问题

“五子棋加一个悔棋，然后其他都同步。”

## 真正的需求

悔棋不能只在当前浏览器删除棋子；它必须经过对手确认、由服务器原子回滚，并让断线重连后的双方看到相同状态。这一能力应由所有联机棋类复用。

## 它具体对应什么

对应房间级 pending request、权限校验、事务回滚、走子锁定、REST 命令和 WebSocket 权威快照广播。

## 解决过程

最后落子方可以申请，对手接受或拒绝；请求处理期间双方暂停落子。接受后服务器删除最后一步、恢复上一局面、回合和序号，再广播 `room.updated`。请求写入数据库，因此刷新或重连仍可恢复。服务端端到端测试覆盖申请、拒绝、接受和回滚。

## 技术选择

选择服务端确认式回滚，没有采用客户端本地 pop 或双方各自计算。这样增加了一次命令往返，但避免双方棋盘分叉，并与已有房间恢复协议保持一致。

## AI 补充

AI 补充：若未来支持观战或棋谱签名，可把悔棋改为追加反向事件而不是删除记录；当前两人房间使用事务删除最后一步更简单。

## 下次怎么提问

“为全部联机棋类实现对手确认式悔棋：仅最后落子方可申请，pending 时锁棋，服务端原子回滚，并通过 WebSocket 与断线恢复同步。”

## 备注

作为实时状态一致性决策记录，暂不做独立 Skill。
