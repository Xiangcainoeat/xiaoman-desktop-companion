# Xiaoman 96-Direction Asset Case

This directory is the reproducible production record for the enhanced host
profile. It is intentionally separate from `public/pet/native/`, which remains
the byte-preserved Codex profile.

## Runtime contract

- `public/pet/look-96.webp`: 12 columns x 8 rows, 96 independent RGBA frames.
- `public/pet/look-96.json`: frame dimensions, 3.75 degree step and QA summary.
- `public/pet/head-look-96.webp`: a retained head-only experiment derived from
  the approved look frames; it is provenance only and is not loaded at runtime.
- `public/pet/head-look-96.json`: historical head mask, registration,
  native-color grade and no-temporal-blend QA contract.
- `public/pet/idle-actions-30.webp`: the accepted lick/blink rows plus a
  30-frame raised-front-paw row block.
- No renderer opacity cross-fade or frame blending is used.

## Look production

`anchors/` contains the 32 repaired source directions. The eight 4x2 endpoint
references and prompts describe the 64 generated in-betweens. The selected
`seam-pairs-15-23.png` sheet replaces four difficult lower-hemisphere cells.
`ordered-frames/` is the exact input sequence used by the deterministic
assembler; `assembly-provenance.json` records every source cell.

Rebuild the atlas with:

```bash
sh scripts/run_image_python.sh scripts/assemble_look_96.py \
  --generation-manifest work/xiaoman-pet-96/generation-manifest.json \
  --anchors-dir work/xiaoman-pet-96/anchors \
  --generated-dir work/xiaoman-pet-96/relay-output \
  --seam-repairs work/xiaoman-pet-96/relay-output/seam-pairs-15-23.png \
  --reference work/xiaoman-pet-96/generation-inputs/native-color-reference.png \
  --frames-dir work/xiaoman-pet-96/ordered-frames \
  --output public/pet/look-96.webp \
  --metadata public/pet/look-96.json \
  --provenance work/xiaoman-pet-96/assembly-provenance.json
npm run verify:look-96
```

## Paw production

`relay-output/paw-lift.png`, `paw-hold.png` and `paw-lower.png` are the three
5x2 source sheets. The assembly script maps them to 10 lift, 10 hold and 10
lower frames, replacing only rows 6–8 of the idle atlas. The stored motion key
is still `idle-scratch` for migration compatibility; the visible action is
`举前爪`.

## Image generation and concurrency

The private relay is used only during asset production through the local
`relay-imagegen` wrapper. The desktop app never calls it. `imagegen-jobs.json`
lists prompts and selected outputs without credentials or private photo paths.
`concurrency.json` records the shared ceiling of six across agents and image
requests; generation batches were kept at four or fewer while development
agents were inactive.

## QA

`qa/look-96-contact-sheet.png` and `qa/look-96-verify-report.json` are generated
from the checked-in source atlas. The head contact sheet and verify report are
generated from the historical `head-look-96.webp` experiment. The active
enhanced runtime uses the complete body atlas and the look verifier checks
dimensions, frame count, empty cells, hidden RGB, color consistency and
distinct direction cells. The historical head atlas and its verifier remain
available for comparison only.
