---
id: xiaoman-centered-direction-pad-side-actions-2026-09-04
title: 移动端方向盘固定居中并将动作键放到两侧
type: capture
status: inbox
skill_candidate: false
source_project: xiaoman-desktop-companion
evidence: [user-practice, project-source, ai-supplement]
domains: [web-ui, responsive-layout, game-controls]
domain_path: [技术殿堂, Web UI 设计, 响应式游戏控制布局]
related: [xiaoman-mobile-control-row-compaction-2026-09-04]
created: 2026-09-04
---

## 原始问题

“不行不行，就是要保证上下左右这四个键仍然在中间，两侧其他位置可以放键，但是不要再在它下边放新的键了。”

## 真正的需求

四向键组成的十字方向盘必须以整个移动端控制区的中心线为基准，新增动作键不能参与整体居中计算，也不能生成第三行。动作键只能使用方向盘左右两侧的空余位置。

## 它具体对应什么

这是视觉锚点与辅助控件布局的区别。方向盘是主要控制器，需要独立绝对居中；动作键是侧翼控件，应围绕主控制器定位，而不是与它共同参与网格宽度分配。

## 解决过程

将移动端控制组改为固定高度的相对定位容器。方向盘使用 `left: 50%` 与水平位移固定在中线；动作键覆盖同一个两行区域，通过左右侧栏布置。手机端侧翼按钮只显示图标，完整含义保留在操作提示、`aria-label` 与 `title` 中。

## 技术选择

选择“中心锚点 + 左右侧栏”，而不是将方向盘和动作键放入同一个普通网格后整体居中。后者虽然紧凑，但会让方向盘随动作键宽度偏移。控制区仍保持两行和约 94px 高度。

## AI 补充

AI 补充：游戏控制器的主要运动输入应维持稳定的肌肉记忆位置。即使不同游戏的动作键数量不同，方向盘中心也不应变化。

## 下次怎么提问

“移动端将十字方向盘固定在容器正中央，动作键仅放在左右侧栏并与上排同高；禁止任何按钮出现在方向盘下方。”

## 备注

这是上一条布局记录的修正版约束，保留为项目维护笔记，不单独制作 Skill。
