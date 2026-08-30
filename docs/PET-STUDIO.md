# Xiaoman Pet Studio

Xiaoman Pet Studio is the reusable Codex Skill and desktop entry point for
turning a user's pet photos into an importable `.xmpet` pack. Image generation
happens in the Codex task, not silently inside the desktop companion. The app
creates a native Codex conversation, sends the Skill invocation and setup
command, then opens that same task in the official Codex window.

## Install the Skill

Install the public Skill with the standard Codex installer:

```bash
python3 "${CODEX_HOME:-$HOME/.codex}/skills/.system/skill-installer/scripts/install-skill-from-github.py" \
  --repo Xiangcainoeat/xiaoman-desktop-companion \
  --path skills/xiaoman-pet-studio \
  --method auto
```

The Skill invokes the existing `codex-pet` core workflow for the Codex v2
spritesheet contract. If that core Skill is missing, install it separately:

```bash
python3 "${CODEX_HOME:-$HOME/.codex}/skills/.system/skill-installer/scripts/install-skill-from-github.py" \
  --repo Xiangcainoeat/xiaoman-desktop-companion \
  --path codex-pet \
  --method auto
```

## In-app one-click flow

1. Open **桌宠功能** and click **一键生成自己的宠物**.
2. The app creates a new native Codex task and sends `$xiaoman-pet-studio`
   together with the Skill install command and output contract.
3. Drag the ten reference images into that Codex task. Codex checks image
   generation and deterministic processing capabilities before it generates
   anything.
4. Codex creates a new author directory containing generated frames, a contact
   sheet, `asset-manifest`, a QA report, and an `.xmpet` archive.
5. Import the validated archive from **偏好设置 → 宠物素材包**. The app keeps
   the bundled Xiaoman pack as a fallback and does not overwrite it.

If the desktop app cannot open the deep link, the task is still created and
the returned task ID can be opened from the Codex task list. A missing image
capability is reported explicitly; no placeholder image is accepted.

## Ten recommended images

The Skill treats these as a coverage contract:

1. 正脸站立，作为身份和比例基准。
2. 左侧面站立，确认背线、腿和尾巴根部。
3. 右侧面站立，确认不对称花纹，不用镜像代替。
4. 背面站立，确认背部花色和尾巴轮廓。
5. 俯视或高机位，确认头顶、耳朵内侧和背部体积。
6. 仰视或低机位，确认下巴、胸口和腹部边界。
7. 行走或奔跑，确认步幅、重心和尾巴摆动。
8. 坐姿或卧姿，确认自然待机和折叠后的爪子。
9. 互动表情，例如眨眼、伸舌、抬爪或好奇注视。
10. 近距离毛发或材质，确认毛色渐变、胡须和眼睛颜色。

照片应尽量清晰、均匀光照、完整露出耳朵和尾巴，避免滤镜、强红光、截图、
水印和把宠物裁到边缘。更多检查项见
[`skills/xiaoman-pet-studio/references/photo-checklist.md`](../skills/xiaoman-pet-studio/references/photo-checklist.md)。

## Output contract

Every successful pack must include:

- `spriteVersionNumber: 2`;
- 9 standard animation rows and 16 look directions;
- transparent-background edge cleanup with no black or colored halo;
- deterministic frame metadata and a machine-readable asset manifest;
- a visual QA report and a single importable `.xmpet` archive.

The workflow keeps private photos, API keys, relay configuration, session logs,
and machine-specific paths out of GitHub and out of the archive. Generation
jobs are limited to four concurrent workers so the Codex session stays within
the desktop companion's resource budget.
