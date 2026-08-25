# Visual Workflow

## Inputs and generation

The desktop host reuses the accepted Xiaoman Codex atlas as its identity reference. The smoother host-only look sequence was generated as one coherent 32-pose sheet and then assembled deterministically.

- generation skill: `relay-imagegen`
- route: private OpenAI-compatible HTTPS relay
- operation: image edit
- model: `gpt-image-2`
- use case: `stylized-concept`
- requested canvas: `2048x1152`
- identity reference: `public/pet/spritesheet.webp`
- final prompt: `work/gaze-32-prompt.md`
- selected model result: `work/gaze-32-generated.png`

No relay endpoint, API key, user photo path or private configuration is included in this repository.

## Deterministic assembly

`scripts/build_gaze_atlas.py` detects the four pose rows and eight foreground groups per row, removes the chroma background, suppresses green spill, normalizes registration and writes the final transparent WebP atlas.

```bash
python3 scripts/build_gaze_atlas.py \
  --source work/gaze-32-generated.png \
  --output public/pet/look-32.webp \
  --contact-sheet work/gaze-32-contact-sheet.png \
  --report work/gaze-32-validation.json
```

Accepted output:

- `1536x832`, arranged as `8x4` cells of `192x208`
- 32 clockwise look directions at 11.25-degree intervals
- every cell populated
- zero detected green-residue pixels
- validation result `ok: true`

## Product QA

- `qa-production-overlay.png` verifies the transparent packaged overlay.
- `qa-production-final.png` verifies the packaged control center.
- `qa-production-settings.png` verifies the packaged 30/60Hz selector and local settings surface.
- `qa-animation-01.png` through `qa-animation-10.png` sample a full production working loop.
- `qa-animation-sampling.json` records the foreground-pixel gate used to catch transparent tail frames.

Browser QA also exercised reminder CRUD, application-rule CRUD, feeding, settings, the 30/60Hz selector, deadzone stability and a non-neutral 32-direction look frame. Native QA verified both window sizes, real alpha transparency, Apple Silicon architecture, owner-only persistence and packaged-resource presence.
