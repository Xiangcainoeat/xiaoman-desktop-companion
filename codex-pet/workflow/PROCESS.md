# Xiaoman Production Process

## Goal

Create a recognizable, non-pixel Codex v2 pet from several private photographs of the real Siamese cat Xiaoman, while keeping the public result installable, reviewable, and free of source-photo or credential leakage.

## 1. Identity brief

The photographs were reduced to stable traits rather than published:

- compact, slightly rounded adult Siamese body
- short cream-ivory coat
- seal-brown mask, triangular ears, paws, and long tail
- vivid icy-blue eyes
- intelligent, mildly skeptical expression
- no collar, clothing, text, or props

The selected style was a premium soft-vinyl and short plush-fur hybrid with a crisp, small-scale silhouette.

## 2. Canonical base

A single approved base image established face proportions, mask boundaries, eye color, body scale, material, and palette. Every action row used this base as the identity anchor. This prevented the source photographs' different lenses, poses, and lighting from becoming different characters.

## 3. Standard action rows

Rows `0-8` were generated as separate strips for `idle`, `running-right`, `running-left`, `waving`, `jumping`, `failed`, `waiting`, `running`, and `review`.

Each strip was extracted and checked before final assembly for:

- required frame count
- no slot overlap or clipping
- stable identity, scale, baseline, and palette
- state-readable motion
- connected silhouettes and valid alpha

Directional locomotion received extra anchoring because generated left/right gait can drift in body scale or facing direction.

## 4. Pointer-look rows

Four cardinal anchors established `000` up, `090` screen-right, `180` down, and `270` screen-left. Row 9 interpolated `000` through `157.5`; row 10 continued `180` through `337.5`.

The two rows were registered deterministically to a shared scale and baseline, then evaluated with:

- labeled direction semantics
- randomized blind opposite-direction pairs
- adjacent-frame continuity metrics
- alpha-hole review
- final normal-size visual review

Subtle intermediate-axis warnings were manually reviewed. The evidence and acceptance decision are preserved in `qa/blind-review-resolution.json`.

## 5. Deterministic assembly

The approved standard and look rows were assembled into one `8x11` RGBA atlas using the scripts in `scripts/`. Chroma despill was applied once, after final v2 assembly, so alpha and edge color were not repeatedly degraded.

Final validation required:

- exact `1536x2288` v2 dimensions
- required used cells in every row
- transparent unused cells
- no clipping, chroma fringe, or hidden transparent RGB residue
- valid manifest path and `spriteVersionNumber: 2`

## 6. Packaging

Only `pet.json` and `spritesheet.webp` are installed into Codex. This release adds previews, prompts, scripts, tests, and QA beside the runtime package for people who want to inspect or adapt the work.

The original photos, raw candidates, relay transport, per-frame workspace, and absolute local paths remain outside the publication directory.

## Reusing the process

1. Install this repository's dependencies.
2. Read `SKILL.md` and `references/`.
3. Run `scripts/prepare_pet_run.py` with a new pet description and optional private references.
4. Generate only the visual jobs listed by the resulting manifest.
5. Use the deterministic scripts for extraction, assembly, cleanup, and QA.
6. Keep source references and credentials outside the public repository.
7. Publish only an accepted runtime package plus sanitized evidence.

## Publication checks

Run these from the repository root before pushing:

```bash
python scripts/validate_atlas.py \
  pet/xiaoman/spritesheet.webp \
  --chroma-key '#FF00FF' \
  --require-v2
python -m unittest discover -s tests -p 'test_*.py'
rg -n '/Users/|Containers|temporary|relay-output|decoded/' . \
  --glob '!workflow/PROCESS.md'
rg -n '(sk-[A-Za-z0-9_-]{16,}|api[_-]?key|access[_-]?token|BEGIN [A-Z ]+PRIVATE KEY)' .
git diff --check
```

The first path scan deliberately names prohibited path fragments in its command, so its documentation line is excluded from itself. Review every remaining match rather than treating a simple regex as proof of safety.
