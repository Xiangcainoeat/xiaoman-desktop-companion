---
id: xiaoman-server-hosted-game-assets-2026-09-04
title: 桌面应用与手机网页统一从服务器加载 H5 游戏
type: capture
status: inbox
skill_candidate: false
source_project: xiaoman-desktop-companion
evidence: [user-practice, project-source]
domains: [electron-packaging, static-hosting, deployment]
domain_path: [技术殿堂, 桌面应用工程, Electron 远程资源与发布边界]
related: [xiaoman-mobile-game-shell-2026-09-04, xiaoman-release-install-sync-2026-09-04]
created: 2026-09-04
---

## 原始问题

“后续本机那里也是读的服务器，不再需要本机把游戏下载到本地。”

## 真正的需求

服务器网页和已安装 Electron 应用必须命中同一份游戏资源；桌面包不能继续携带一份可能过期的副本，同时本机专属 Codex、宠物和提醒能力不能暴露到网页端。

## 它具体对应什么

对应静态资源 origin 解析、iframe CSP、Electron 打包排除规则、服务器生成目录和本地/网页能力边界。

## 解决过程

抽出统一服务器 origin，服务器页面使用同源，localhost 开发与 Electron 使用配置的服务器地址。Electron Builder 排除 `dist/article-games`，实际 asar 检查为 0 个游戏资源；服务端继续打包 10 个托管 H5 目录。远程首页、俄罗斯方块资源和健康检查均返回 200。

## 技术选择

选择远程静态托管，而不是 Electron 内置静态服务器。代价是单机游戏需要网络，收益是手机和桌面只维护一个版本。CSP 只允许自身、开发 loopback 和当前服务器作为 frame 来源，没有放开任意站点。

## AI 补充

AI 补充：正式账号环境应把当前 HTTP 地址迁移到 HTTPS/WSS，并给带 hash 的静态资源设置长期缓存；入口 HTML 保持短缓存以便及时切版。

## 下次怎么提问

“将 Electron 内置 H5 资源迁移到统一服务器 origin，排除安装包资源副本，限制 iframe CSP，并分别验证网页同源、开发环境和已安装应用。”

## 备注

这是项目架构决策，暂作为文章/决策记录，不单独提升为 Skill。
