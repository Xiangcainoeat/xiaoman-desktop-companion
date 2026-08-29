# Codex Pet Package Format

## Runtime package

Codex loads one directory per custom pet:

```text
${CODEX_HOME:-$HOME/.codex}/pets/<pet-id>/
├── pet.json
└── spritesheet.webp
```

Xiaoman's manifest is:

```json
{
  "id": "xiaoman",
  "displayName": "小满",
  "description": "一只冰蓝眼睛、重点色面罩鲜明、聪明又有点审视感的暹罗猫。",
  "spriteVersionNumber": 2,
  "spritesheetPath": "spritesheet.webp"
}
```

The directory name, manifest `id`, and image path should agree. The current runtime ignores authoring files because no manifest fields point to them.

## V2 spritesheet

| Property | Value |
| --- | ---: |
| Image size | `1536x2288` |
| Grid | `8 columns x 11 rows` |
| Cell size | `192x208` |
| Format | WebP with alpha |
| Version | `spriteVersionNumber: 2` |

Rows are zero-indexed:

| Row | State | Used cells |
| ---: | --- | ---: |
| 0 | `idle` | 6 |
| 1 | `running-right` | 8 |
| 2 | `running-left` | 8 |
| 3 | `waving` | 4 |
| 4 | `jumping` | 5 |
| 5 | `failed` | 8 |
| 6 | `waiting` | 6 |
| 7 | `running` | 6 |
| 8 | `review` | 6 |
| 9 | look directions `000` through `157.5` | 8 |
| 10 | look directions `180` through `337.5` | 8 |

The sixteen look frames advance clockwise in `22.5` degree steps. `000` means up, `090` means screen-right, `180` means down, and `270` means screen-left.

Unused cells in short action rows remain transparent. The runtime supplies frame order and timing; those values do not appear in `pet.json`.

## Why authoring files are separate

The following files are useful for people but are not runtime dependencies:

- generation prompts and source descriptions
- source photographs and generated candidates
- extracted frame directories
- contact sheets and GIF previews
- JSON validation and review reports
- Python assembly and QA scripts
- model configuration or API credentials

Keeping these outside the installed pet directory gives the runtime a stable, minimal contract and avoids exposing source photos or secrets. This repository publishes the reusable and reviewable subset while excluding private or redundant material.
