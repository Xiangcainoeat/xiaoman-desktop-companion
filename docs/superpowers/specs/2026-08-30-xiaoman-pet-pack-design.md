# 小满可替换宠物包与公开发布设计

**日期：** 2026-08-30  
**状态：** 已批准实施  
**范围：** 宠物素材清单、提示词生成工具、图像生成任务编排、运行时宠物包、桌面端导入切换、Codex 同步和 GitHub public 发布

## 目标

把当前固定引用 `public/pet/` 的小满素材改造成一个可验证、可打包、可导入的 Pet Pack 体系。用户可以用一张或多张宠物参考图生成一套动作素材，得到一个单文件 `.xmpet` 包；桌面宿主可以在不重装应用的情况下导入和切换，Codex 原生模式仍保持现有两文件兼容。

## 非目标

- 不修改 Codex 原生渲染器的内部协议，也不把桌面宿主功能伪装成 Codex 原生能力。
- 不把 API 密钥、私有中转地址、原始用户照片或未选中的模型输出放进运行时包或公开仓库。
- 第一版不做在线宠物市场、账号体系、云端同步或自动下载模型。
- 不要求用户重新生成已经通过验证的标准图集；缺少增强素材时允许回退到内置 profile，并在界面显示缺失能力。

## 设计原则

1. **清单优先。** 应用只加载 `pet-pack.json` 登记的文件，不依赖散落的硬编码文件名。
2. **运行时与作者工程分离。** 运行时包只含完成的图集、元数据、预览和许可证；作者工程保留逐帧原图、提示词、任务图和验证报告。
3. **原生兼容。** `codex/pet.json` 和 `codex/spritesheet.webp` 始终可以独立安装到 `${CODEX_HOME:-$HOME/.codex}/pets/<id>/`。
4. **确定性校验。** 尺寸、帧数、透明度、隐藏 RGB、边缘污染、路径安全和 SHA-256 在导入和打包时都校验。
5. **安全回退。** 自定义包加载失败时继续使用内置小满；切换采用临时目录、校验、原子替换和旧版本保留。

## 包格式

扩展名为 `.xmpet`，文件内容为 ZIP。根清单 `pet-pack.json` 使用 `schemaVersion: 1`：

```json
{
  "schemaVersion": 1,
  "id": "xiaoman",
  "displayName": "小满",
  "description": "一只冰蓝眼睛、重点色面罩鲜明的暹罗猫。",
  "spriteVersionNumber": 2,
  "defaultProfile": "enhanced",
  "profiles": {
    "native": { "manifest": "codex/pet.json", "spritesheet": "codex/spritesheet.webp" },
    "enhanced": { "spritesheet": "desktop/spritesheet.webp", "look": "desktop/look-96.webp", "lookMetadata": "desktop/look-96.json" }
  },
  "assets": {
    "standard": { "path": "desktop/spritesheet.webp", "kind": "atlas", "width": 1536, "height": 2288, "columns": 8, "rows": 11, "cell": [192, 208], "required": true },
    "gaze96": { "path": "desktop/look-96.webp", "metadata": "desktop/look-96.json", "kind": "atlas", "frameCount": 96, "stepDegrees": 3.75, "required": false },
    "idleActions30": { "path": "desktop/idle-actions-30.webp", "metadata": "desktop/idle-actions-30.json", "kind": "atlas", "frameCount": 90, "required": false },
    "sleep30": { "path": "desktop/sleeping-30.webp", "metadata": "desktop/sleeping-30.json", "kind": "atlas", "frameCount": 30, "required": false },
    "care30": { "path": "desktop/care-actions-30.webp", "metadata": "desktop/care-actions-30.json", "kind": "atlas", "frameCount": 60, "required": false },
    "avatar": { "path": "desktop/avatar.png", "kind": "ui", "width": 128, "height": 128, "required": true },
    "tray": { "path": "desktop/tray.png", "kind": "ui", "width": 32, "height": 32, "required": true }
  },
  "checksums": { "algorithm": "sha256", "files": {} }
}
```

实际实现可以扩展字段，但不能改变现有字段的含义。每个资源条目都包含稳定 ID、相对路径、媒体类型、尺寸/帧数、用途和必需性；每个图集的动作行映射放在对应元数据中。

## 素材契约

| ID | 目标文件 | 几何 | 内容 |
| --- | --- | --- | --- |
| `standard` | `desktop/spritesheet.webp` | 8×11，`192×208` cell | Codex 九种标准动作和 16 个 look cell |
| `gaze96` | `desktop/look-96.webp` | 12×8，96 帧，3.75° | 桌面增强注视，不做透明混合 |
| `idleActions30` | `desktop/idle-actions-30.webp` | 10×9，三组各 30 帧 | 舔嘴、眨眼、举前爪 |
| `sleep30` | `desktop/sleeping-30.webp` | 10×3，30 帧 | 蜷睡呼吸循环 |
| `care30` | `desktop/care-actions-30.webp` | 10×6，两组各 30 帧 | 洗澡、喂食 |
| `avatar` | `desktop/avatar.png` | 128×128 RGBA | 控制中心和列表头像 |
| `tray` | `desktop/tray.png` | 32×32 RGBA | 菜单栏图标 |

作者工程额外保存以下一一对应的原图：

```text
frames/<asset-id>/<frame-number>.png
prompts/<asset-id>.md
qa/<asset-id>.json
```

`avatar` 和 `tray` 从通过验证的标准帧确定性裁切/缩放，不要求单独调用图像 API。旧的 `look-90`、`look-32`、`head-look-96` 和单行旧 idle 文件只作为迁移输入，不是新包必需资源。

## 作者工程与命令

作者工作区使用 `pet-project.json`、`imagegen-jobs.json` 和 `prompts/`。生成器支持多张参考图，先选择 canonical identity，再为每个动作生成带身份锁和布局约束的提示词。第一版采用 OpenAI-compatible image API 适配器，配置只来自环境变量或未跟踪的 `.env.local`；生成命令支持 `--dry-run`，因此只生成提示词和任务图时完全不需要 API。

```bash
npm run pet:init -- --name "我的猫" --refs ./refs/front.jpg ./refs/body.jpg
npm run pet:prompts -- --project ./work/my-cat
npm run pet:generate -- --project ./work/my-cat --provider openai-compatible --concurrency 3
npm run pet:validate -- --project ./work/my-cat
npm run pet:pack -- --project ./work/my-cat --output ./dist/my-cat.xmpet
npm run pet:install -- --package ./dist/my-cat.xmpet
```

`--concurrency` 的硬上限为 6，默认值为 3；所有生成请求和未来的并行 Agent 共享一个计数器，不能超过 6。生成图像的实际帧数、扩帧、透明清理、图集组装和 QA 复用现有 `codex-pet/scripts/` 中的确定性工具，不以 CSS 或透明叠加伪造动作。

## 桌面端加载与导入

内置资源继续位于应用包中，作为默认 profile。自定义包安装到：

```text
~/Library/Application Support/小满桌面伴侣/pets/<pet-id>/
```

桌面端启动时按“当前选择的用户包 -> 内置小满”顺序解析。导入流程为：拒绝绝对路径和 `..`；解压到临时目录；限制文件数量和总大小；验证 JSON schema、图片解码、尺寸、alpha、帧数和 SHA-256；写入备份；原子替换；刷新 PetSprite 和头像/托盘资源。任何步骤失败都保留当前包并显示具体错误。

“同步到 Codex”只复制 `codex/` 下的两文件目录，不改写桌面应用资源。同步完成后提示用户重启 Codex 宠物选择器；没有同步权限时只报告错误，不影响桌面端。

## 公开仓库边界

仓库名默认使用 `Xiangcainoeat/xiaoman-desktop-companion`。由于当前目录包含脏工作树、过程素材、构建包和可能的历史隐私，发布时从经过筛选的内容建立干净的首个 public 提交，不直接暴露现有私有历史。

公开内容包括源码、最终小满图集、动画预览、脱敏的提示词模板、确定性工具、测试、Pet Pack 示例、README、许可证和 CI。排除原始猫照片、未选中的模型输出、API 配置、私有日志、DMG/ZIP 构建产物和本地路径记录。DMG 只作为 GitHub Release 附件。

所有第三方游戏必须逐项确认源仓库许可证和继承媒体权利。未声明许可证的 `sliding_puzzle` 快照不能直接随 public 源码分发，必须在发布前移除、替换为明确许可版本，或改成用户自行取得的可选组件。README 要明确说明这是 macOS 桌宠、Codex 任务伴侣和可换肤 Pet Pack 工具，并单独列出小满素材的非商业授权边界。

## 测试与验收

- schema、路径和 checksum 校验覆盖缺失资源、错误尺寸、恶意 ZIP 路径和损坏图片。
- 生成器覆盖多参考图、`--dry-run`、并发上限、重试和无密钥错误。
- 打包后重新解包并逐项比对 manifest、文件和校验和。
- 桌面端覆盖默认内置包、自定义包切换、重启持久化、导入失败回退和 Codex 同步。
- 干净克隆能通过 `npm ci`、类型检查、测试和生产构建；CI 不需要 API key。
- 发布前检查 Git 历史和当前树没有原始照片、秘密或未授权第三方素材。
