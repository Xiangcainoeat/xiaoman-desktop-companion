# Xiaoman 90-Direction Reproduction

This directory contains the reusable inputs and evidence for the enhanced host
profile. It is intentionally separate from the native Codex pet package.

## Pipeline

1. Use the local `relay-imagegen` CLI wrapper to repair the 32-anchor source or
   generate a selected transition frame. Prompts are stored beside their
   outputs. Never put relay credentials in a prompt, log or manifest.
2. Run `scripts/resample_look_directions.py` with the 8x4 source and the
   selected `DEGREES=PATH` transition overrides. The script removes the green
   matte, shares scale/baseline registration and interpolates premultiplied
   RGBA frames around the circular direction loop.
3. Run `scripts/build_look_atlas_90.py` to create the 10x9 RGBA/WebP atlas and
   metadata, then run `scripts/verify_look_atlas_90.py` for non-destructive
   structural and edge-color QA.

The checked-in runtime result is `../../public/pet/look-90.webp` with
`../../public/pet/look-90.json`. The final selected build uses 32 generated or
repaired anchors and seven generated transition overrides. The 260-degree
override was replaced with a v3 close intermediate based on the 256-degree
downward anchor; the 264/268-degree bridges remain the v2 pair. Intermediate
PNG frames are evidence and are not runtime dependencies.

## Concurrency

`concurrency.json` is the record for this run. The shared ceiling for image
generation and parallel development work was 6. The initial transition batch
used 6 image jobs; corrective generation used at most 2 jobs at once, and the
final 260-degree v3 replacement used one job. A missing 268-degree prompt was
fixed before its retry, so no failed image request was counted. No credential
or remote endpoint is persisted here.
