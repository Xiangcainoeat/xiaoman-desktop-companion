# 发布与交付

本项目的交付物是一个 macOS 桌面宠物应用和一套可复用的 Pet Pack 素材工具。
源码仓库、构建产物和用户本机数据彼此分离；仓库不依赖某一台开发机的绝对路径。

## 仓库内容

```text
electron/                 Electron 主进程、IPC 和本地游戏宿主
src/                      React 控制中心、共享状态和素材运行时
public/pet/               内置小满 profile 与素材清单
public/article-games/     已审核可公开的静态游戏运行文件
vendor/article-games/     上游来源、固定提交和许可证记录
codex-pet/                可复用的 Codex 宠物制作工作流
templates/pet-pack/       新宠物作者模板
scripts/                  生成、校验、打包和安装脚本
docs/                     架构、隐私、游戏和交付说明
```

原始照片、模型候选图、私有 API 配置、日志、临时目录、DMG/ZIP 中间产物不属于
公共源码导出。每次发布前运行 `npm run scan:public`。

## 可复现构建

```bash
npm ci
npm run typecheck
npm test
npm run build
npm run dist:mac
```

`package-lock.json` 是依赖输入；构建目标是 Apple Silicon 的未签名应用。
应用不要求 Python、Pillow、Express 或 Socket.IO 作为运行时依赖。静态游戏由
Electron 的 loopback 宿主提供，国际象棋是明确的系统浏览器在线入口。

## 安装与更新

将生成的 DMG 中的应用拖到 macOS“应用程序”目录。未签名应用首次打开时，
在 Finder 中右键选择“打开”。如果使用项目提供的安装脚本，它会关闭旧进程、
替换应用目录中的 bundle 并刷新 LaunchServices；不要把 worktree 或临时解压目录
当作长期启动源。

更新后至少重新执行：

```bash
npm run build
npm run dist:mac
npm run install:mac
```

这样启动台、Dock 和实际运行的应用都会指向同一份新 bundle。应用退出后，Codex
原生宠物仍按自己的两文件契约工作；桌面宿主不会回写原生 Codex 目录。

## 素材包交付

用户可以直接导入 `.xmpet`。应用会检查 schema、相对路径、SHA-256、图集几何规格
和 Codex 必需文件，然后以临时目录 + 原子改名方式安装。导入失败不会破坏当前活动
profile；删除或切换自定义包后，内置小满始终可用。

素材包的作者流程和确切替换位置见 [PET-PACK.md](PET-PACK.md) 与
[PET-ASSET-MANIFEST.md](PET-ASSET-MANIFEST.md)。

## 分发边界

公共导出不会包含没有许可证声明的滑块拼图运行快照。第三方游戏的源代码、字体、
音频、角色和商标可能有独立权利，不能因为上游仓库声明 MIT/Apache 就一概视为已获授权。
详见根目录的 `THIRD_PARTY_NOTICES.md`。
