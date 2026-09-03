---
id: xiaoman-release-install-sync-2026-09-04
title: 每次更新同步服务器、发布包与启动台应用
type: capture
status: inbox
skill_candidate: true
source_project: xiaoman-desktop-companion
evidence: [user-practice, project-source]
domains: [release-engineering, macos, deployment]
domain_path: [技术殿堂, 发布工程, 服务端与 macOS 安装一致性]
related: [xiaoman-server-hosted-game-assets-2026-09-04]
created: 2026-09-04
---

## 原始问题

“我是从启动台打开的，打开的是老的。每次更新完之后，所有地方都更新。”

## 真正的需求

源码构建完成不等于交付完成；远程服务、DMG/ZIP、`/Applications` 正式应用和 LaunchServices 注册必须指向同一版本，并保留服务器数据和回滚点。

## 它具体对应什么

对应版本号、可重复构建、应用 bundle 哈希、LaunchServices 去重、远程代码备份、单容器重建和发布校验清单。

## 解决过程

发布 1.10.0，先备份服务器代码并只重建 `xiaoman-social`，保留 SQLite bind mount；生成 arm64 应用、DMG 和 ZIP，覆盖安装 `/Applications/小满桌面伴侣.app` 并刷新 LaunchServices。最终安装包与构建包 `app.asar` SHA-256 一致。

## 技术选择

服务器不执行整机 `docker compose down`，避免影响同机其它业务；macOS 旧 bundle 移到非应用搜索目录，并注销重复 bundle ID。替代方案是只运行 `open` 指向构建目录，但无法保证启动台使用新版本。

## AI 补充

AI 补充：后续可把“构建、扫描、部署、健康检查、安装哈希比对”收敛为带失败回滚的 release 脚本，并接入签名与公证。

## 下次怎么提问

“完成发布闭环：更新版本、部署单一服务且保留数据、生成 DMG/ZIP、覆盖 `/Applications`、刷新 LaunchServices，并比较构建包和安装包哈希。”

## 备注

适合整理为脚本辅助 Skill，但必须继续把服务器数据目录和同机其它容器列为硬边界。
