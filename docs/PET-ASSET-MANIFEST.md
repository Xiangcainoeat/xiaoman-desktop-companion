# 小满素材替换清单

这份清单是桌面宿主和原生 Codex profile 共用的替换契约。机器可读版本位于
[`public/pet/asset-manifest.json`](../public/pet/asset-manifest.json)。每一行都给出
仓库中的原始位置和 `.xmpet` 包内的位置；替换一个宠物时，要保持这些 ID 不变，
或者在自定义包的 `manifest.json` 中提供同一组兼容路径。

## 文件对应关系

| ID | 仓库原始位置 | `.xmpet` 包内位置 | 用途 | 规格 |
| --- | --- | --- | --- | --- |
| `codex-pet` | `public/pet/native/pet.json` | `assets/codex/pet.json` | 原生 Codex 元数据 | JSON |
| `codex-spritesheet` | `public/pet/native/spritesheet.webp` | `assets/codex/spritesheet.webp` | 原生 Codex 标准动作 | 1536×2288，8×11，88 格 |
| `native-look-atlas` | `public/pet/native/look-16.webp` | `assets/native/look-16.webp` | 原生 16 方向注视 | 1536×416，8×2，16 格 |
| `native-look-metadata` | `public/pet/native/look-16.json` | `assets/native/look-16.json` | 原生注视规格 | JSON |
| `enhanced-pet` | `public/pet/pet.json` | `assets/desktop/pet.json` | 增强 profile 元数据 | JSON |
| `enhanced-spritesheet` | `public/pet/spritesheet.webp` | `assets/desktop/spritesheet.webp` | 增强标准动作 | 1536×2288，8×11，88 格 |
| `enhanced-look-atlas` | `public/pet/look-96.webp` | `assets/desktop/look-96.webp` | 增强 96 方向注视 | 2304×1664，12×8，96 格 |
| `enhanced-look-metadata` | `public/pet/look-96.json` | `assets/desktop/look-96.json` | 增强注视规格 | JSON |
| `idle-actions` | `public/pet/idle-actions-30.webp` | `assets/desktop/idle-actions-30.webp` | 舔嘴、眨眼、举前爪 | 1920×1872，10×9，90 格 |
| `idle-actions-metadata` | `public/pet/idle-actions-30.json` | `assets/desktop/idle-actions-30.json` | 待机动作行定义 | JSON |
| `sleeping-actions` | `public/pet/sleeping-30.webp` | `assets/desktop/sleeping-30.webp` | 蜷睡呼吸循环 | 1920×624，10×3，30 格 |
| `sleeping-actions-metadata` | `public/pet/sleeping-30.json` | `assets/desktop/sleeping-30.json` | 睡眠动作规格 | JSON |
| `care-actions` | `public/pet/care-actions-30.webp` | `assets/desktop/care-actions-30.webp` | 喂食、洗澡和礼包反馈 | 1920×1248，10×6，60 格 |
| `care-actions-metadata` | `public/pet/care-actions-30.json` | `assets/desktop/care-actions-30.json` | 照料动作行定义 | JSON |
| `avatar` | `public/pet/avatar.png` | `assets/desktop/avatar.png` | 控制中心/桌面头像 | 128×128 |
| `tray` | `public/pet/tray.png` | `assets/desktop/tray.png` | 菜单栏图标 | 32×32 |

## 动作行

- `idle-actions-30.webp`：行 0-2 是 `idle-lick`，行 3-5 是 `idle-blink`，行 6-8
  是 `idle-scratch`（界面显示为“举起前爪”）；每组 30 帧，10 列。
- `sleeping-30.webp`：唯一的睡眠循环占用行 0-2，共 30 帧。它是完整身体图，
  不和注视头部图层叠加。
- `care-actions-30.webp`：行 0-2 是洗澡，行 3-5 是喂食/礼包反馈；每组 30 帧。
- `enhanced-look-atlas` 的 96 格按 3.75° 递增；`native-look-atlas` 的 16 格按
  22.5° 递增。两个 profile 都是离散整帧，不做透明混合。

## 一键替换流程

1. 复制 `templates/pet-pack/`，用一张或多张参考图运行 `pet:init`；参考图只在
   本机用于计算 SHA-256 和发给用户配置的图片 API，不会被打进包。
2. 运行 `pet:prompts`，得到所有动作的提示词；用 `pet:generate` 默认 dry-run
   检查帧数量和输出路径。
3. 用户配置 `PET_IMAGE_API_KEY` 后，显式运行 `pet:generate --execute`，生成的
   帧写入 `frames/<asset-id>/`。默认并发为 3，允许范围 1-6；不使用超过 6 个
   图片请求。
4. 按图集契约将帧组装为上表中的 WebP，并把相应元数据放回 `assets/desktop/`
   或 `assets/codex/`；运行 `pet:pack` 生成 `.xmpet`。
5. 运行 `pet:validate`，它会检查根 manifest、声明文件、路径安全性和 SHA-256。
   应用导入时会先校验并原子安装；切换失败会保留内置小满作为回退。

原生 Codex 兼容只需要 `assets/codex/pet.json` 和
`assets/codex/spritesheet.webp`。应用的增强功能读取 `assets/desktop/`，所以
替换 Codex 的两文件不会删除宿主自己的注视、待机、睡眠和照料资源。
