# Pet Pack 生成、替换与打包

Pet Pack 是小满桌面伴侣使用的可校验 `.xmpet` 文件。它把桌面 profile、可选的
Codex 两文件 profile、动作图集、元数据、提示词和生成任务清单放在一个 ZIP 容器中。
应用导入时先验证根 manifest、相对路径、声明文件和 SHA-256，再原子安装到本机数据目录。

## 从参考图开始

参考图可以是一张或多张。第一张默认角色为 `identity`，后续图片默认是
`supporting`；可以用 `--ref-role` 为对应顺序指定 `body` 等角色：

```bash
npm run pet:init -- --workspace ./my-pet --name "我的宠物" \
  --refs ./references/front.jpg ./references/body.jpg \
  --ref-role identity --ref-role body
npm run pet:prompts -- --project ./my-pet
npm run pet:generate -- --project ./my-pet --dry-run
```

`pet:init` 只把路径和 SHA-256 写入 `pet-project.json`，不会复制照片。
`pet:prompts` 会生成 `prompts/pet-pack.md` 和 `prompts/pet-pack.json`，涵盖：

- Codex 标准 8×11 图集；
- 16/96 方向注视图集；
- 舔嘴、眨眼、举前爪；
- 蜷睡、喂食、洗澡；
- 左右跑和跳跃；
- 头像与菜单栏图标。

每个动作的模板都要求固定画布、完整主体、透明背景、稳定注册点、无文字/水印/额外
角色，并带有负面提示词。完整动作 ID 和画布规格见
[`scripts/pet-pack-prompts.ts`](../scripts/pet-pack-prompts.ts)。

## 图片 API 执行模式

默认的 `pet:generate` 是 dry-run，只写 `jobs.json`，不会联网。需要真正生成时必须
显式加 `--execute`，并从环境变量提供密钥：

```bash
export PET_IMAGE_API_KEY="your-key"
export PET_IMAGE_API_URL="https://example.invalid/v1"
export PET_IMAGE_MODEL="gpt-image-1"
npm run pet:generate -- --project ./my-pet --execute --concurrency 3
```

当前适配器名称为 `openai-compatible`。地址可以是 base URL，也可以直接是
`/images/generations` endpoint。请求包括 `model`、`prompt`、`negative_prompt`、
`size`、`n: 1` 和 `response_format: b64_json`；多参考图通过明确的
`reference_images` 扩展字段传递给兼容 relay。若服务返回 base64、data URL、HTTP 图片
URL 或原始图片响应，适配器都能处理。

并发规则是硬约束：默认 3，允许 1-6，所有 worker 共用同一上限；无论是批量帧请求还是
未来把该工具接入 Agent，都不应突破 6。已有目标文件默认跳过，`--overwrite` 才会重做。
每一帧先写临时文件再原子改名，单个请求失败不会留下半张图片；失败会进入
`generation-report.json`，可修复后重复执行。

## 组装、打包和验证

生成器输出单帧 PNG。作者应使用仓库内的确定性图像脚本完成去色边、透明像素 RGB 清理、
裁剪和图集拼接，然后按 [素材清单](PET-ASSET-MANIFEST.md) 放进作者目录：

```text
my-pet/
├── assets/
│   ├── codex/pet.json
│   ├── codex/spritesheet.webp
│   └── desktop/...
├── prompts/
├── frames/
├── jobs.json
└── pet-project.json
```

之后运行：

```bash
npm run pet:pack -- --project ./my-pet --output ./my-pet.xmpet
npm run pet:validate -- --package ./my-pet.xmpet
npm run pet:install -- --package ./my-pet.xmpet --activate
```

`pet:pack` 会重新计算 manifest 和所有文件的 SHA-256，只复制允许的 `assets/` 和
提示词/任务元数据；`references/`、`.env*`、`jobs.json` 原始私密字段和 API 配置不会
被原样带入包。`pet:validate` 会拒绝绝对路径、目录穿越、重复条目、缺失必需文件和
不匹配的校验和。

## Codex 导出

manifest 声明 `compatibility.codex` 时，包必须提供：

```text
assets/codex/pet.json
assets/codex/spritesheet.webp
```

这两个文件是原生 Codex v2 的完整运行契约。桌面增强 profile 可以额外提供 96 方向、
待机、睡眠、照料、头像和 tray 素材；它们不会被写进原生 Codex 目录。控制中心“桌宠功能”页顶部的
profile 切换只改变宿主读取的资源，
“导出到 Codex”会备份目标目录后再原子替换这两个文件。

## 隐私边界

作者的照片、生成 API key、relay 地址中的私有标识、日志和废弃候选图都是本机作者数据，
不应提交到 Git。公共模板和 `.gitignore` 已覆盖常见目录；发布前仍应运行：

```bash
npm run scan:public
```
