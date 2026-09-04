# Care Atlas Convergence Report

> Historical pre-expansion candidate report. Its 10-pose source and stale
> public-output handoff were superseded by the accepted 6x6/36-source assets
> documented in `work/xiaoman-care-assets/smooth-action-qa-report.json` and
> `work/xiaoman-care-assets/expanded-source-provenance.json`.

Date: 2026-08-28
Worktree: `$HOME/.config/superpowers/worktrees/xiaoman-desktop-companion-release/xiaoman-care-and-games`
Branch: `feature/xiaoman-care-and-games`
Implementation commit: `a1a1ca991262cf2b324a7386de13fe19e30f526b`

## Scope and decision

No new image material was generated in this pass. The final candidate was
rebuilt deterministically from the existing sources
`work/xiaoman-care-assets/generated-care-v4.png` and
`work/xiaoman-care-assets/generated-sleeping-v4.png`.

The frame expander now performs only alpha-aware registration and discrete
frame scheduling. It no longer performs cross-frame RGB or alpha tweening, and
`_blend_premultiplied` is gone. Ten real care poses are scheduled across the
thirty runtime slots; repeated poses are non-adjacent and are not blended into
afterimages. Source extraction uses tight ownership crops for care poses and a
targeted cleanup for the known row 2 / column 9 foreign edge prop.

The validator keeps the existing contamination and sequence gates. It also
checks every atlas cell on white, charcoal, and checkerboard backgrounds,
including transparent RGB and black-rectangle detection. Native dark fur and
paws are counted as opaque black pixels for diagnostics, but are not treated as
rectangular-block failures.

## Candidate output retained

The deterministic candidate is retained at:

- `check-output-care-v4-discrete-final/care-actions-30.webp`
- `check-output-care-v4-discrete-final/care-actions-30.json`
- `check-output-care-v4-discrete-final/sleeping-30.webp`
- `check-output-care-v4-discrete-final/sleeping-30.json`

QA sheets are retained at:

- `work/xiaoman-care-assets/care-actions-30-background-check.png`
- `work/xiaoman-care-assets/sleeping-30-background-check.png`
- `work/xiaoman-care-assets/care-actions-30-contact-sheet.png`

`public/pet` was intentionally not changed by this task; the parent task owns
that write-back.

## Independent verifier results

Command:

```text
$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3 scripts/verify_care_atlas_30.py check-output-care-v4-discrete-final/sleeping-30.webp check-output-care-v4-discrete-final/sleeping-30.json --report /tmp/xiaoman-sleep-final-verify.json
$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3 scripts/verify_care_atlas_30.py check-output-care-v4-discrete-final/care-actions-30.webp check-output-care-v4-discrete-final/care-actions-30.json --report /tmp/xiaoman-care-final-verify.json
```

Result: both commands exited `0` and returned `ok: true`.

| Atlas / sequence | Frames | Visible pixels | duplicateRatio | edgePixels | mattePixels | bboxViolations | red/pink edge | colorDrift |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| sleep | 30 | 4364-5380 | 0.0 | 0 | 0 | 0 | 0 | 2.144531 |
| bath | 30 | 7957-11467 | 0.0 | 0 | 0 | 0 | 0 | 9.716934 |
| feed-gift | 30 | 8633-12005 | 0.0 | 0 | 0 | 0 | 0 | 16.082954 |

For both atlases and all three backgrounds, the background checks reported:

- `transparentRgbPixels=0`
- `blackRectangles=0`
- `blackRectanglePixels=0`
- all checked cells `ok=true`

The nonzero `opaqueBlackPixels` diagnostic is native dark subject detail, not
a black background block. The reported `colorDrift` values are normalized fur
palette drift and are inside the existing gate; they are not literal zero
pixel-difference values. Red/pink contamination is zero. If the product
requires mathematically identical fur RGB in every pose, the remaining fix
requires new or recolored source poses, not a validator-threshold change.

## Tests

Passed:

```text
$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3 -m unittest tests.test_smooth_action_atlas -v
Ran 18 tests in 4.279s
OK
```

```text
$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3 -m py_compile scripts/build_care_atlas_30.py scripts/build_idle_atlas_30.py scripts/verify_care_atlas_30.py
```

The care contract suite ran 18 tests: 16 passed and 2 failed only because the
parent-owned `public/pet/care-actions-30.*` files are still the stale atlas.
Those failures are:

- one public frame has 3887 visible pixels instead of the 5000 floor;
- public bath frames 21-29 are empty, and public bath/feed-gift have
  `duplicateRatio=0.689655`.

`npm run verify:care-atlas` was also run against the current public assets and
exited `1` for the same stale-public failures. It must be rerun after the
parent copies the four retained candidate files into `public/pet`.

## Remaining risk and handoff

The generated candidate passes the no-mix, no-afterimage, transparency, black
rectangle, edge contamination, and sequence gates. The visual contact sheet
still reflects the intentional discrete 10-pose-to-30-slot schedule, so it is
not a claim of newly synthesized 30-pose motion. A few dark/cyan-looking edge
specks remain a source-level visual risk in the known row 2 / column 9 crop;
they did not survive the candidate's strict output/background gates, but this
should be rechecked if source-level pixel perfection is required.

Handoff action:

```text
cp check-output-care-v4-discrete-final/care-actions-30.webp public/pet/care-actions-30.webp
cp check-output-care-v4-discrete-final/care-actions-30.json public/pet/care-actions-30.json
cp check-output-care-v4-discrete-final/sleeping-30.webp public/pet/sleeping-30.webp
cp check-output-care-v4-discrete-final/sleeping-30.json public/pet/sleeping-30.json
npm run verify:care-atlas
```
