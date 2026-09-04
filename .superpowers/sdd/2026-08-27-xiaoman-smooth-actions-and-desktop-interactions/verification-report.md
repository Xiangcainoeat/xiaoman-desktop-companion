# Smooth Action Atlas Verification

> Historical pre-expansion report. The failures below describe the earlier
> 10-pose candidate and are retained as red/diagnostic evidence; they are
> superseded by the accepted 6x6/36-source build documented in
> `work/xiaoman-care-assets/smooth-action-qa-report.json` and
> `work/xiaoman-care-assets/expanded-source-provenance.json`.

Date: 2026-08-27
Worktree: `$HOME/.config/superpowers/worktrees/xiaoman-desktop-companion-release/xiaoman-care-and-games`

## Focused Python Tests

Command:

```text
$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3 -m unittest tests/test_smooth_action_atlas.py
```

Result: exit code `0`

```text
.........
----------------------------------------------------------------------
Ran 9 tests in 4.262s

OK
```

## Full Python Tests

Command:

```text
PYTHONPATH=scripts $HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3 -m unittest discover -s tests -p 'test_*.py'
```

Result: exit code `1`; `Ran 35 tests in 32.365s`; `FAILED (failures=2, errors=2)`.

The two errors are the existing care-source build contract rejecting `colorDrift` after interpolation (`bath=39.0`, `feed-gift=25.0`). The two failures are the existing public-asset non-empty/verification assertions. The full failure output is retained in the command transcript; the focused suite above is the task-specific result.

## Generated Source Build

Inputs:

```text
sleep: work/xiaoman-care-assets/generated-sleeping-v3.png
care:  work/xiaoman-care-assets/generated-care-v3.png
```

The build exits nonzero at its existing verification gate. The observed sequence metrics include:

```text
bath:      duplicateRatio=0.0, edgePixels=65, colorDrift=33.0
feed-gift: duplicateRatio=0.0, edgePixels=375, colorDrift=43.0
```

The 10-source-pose duplicate problem is resolved; the current generated care source still fails independent existing edge/color/visible-area checks. The original `expand -> normalize -> clean` call order remains unchanged. No gate or threshold was loosened.

`generated-sleeping-v4.png` was also checked. With the old expansion function it already failed with `edgePixels=34` and 21/30 frames below the existing visible-area threshold, so it was not used as the passing sleep baseline.

The standalone verifier on the final temporary outputs reported `sleeping-30 ok=True` with all sequence metrics at zero, and `care-actions-30 ok=False` with the same bath/feed-gift failures listed above.

## Baseline Comparison

Executing the `HEAD` version of `scripts/build_care_atlas_30.py` against the existing `sleep-source.png` and `care-source.png` raises at the original duplicate gate (`sleep duplicateRatio=0.206897`). Its emitted care atlas still reports duplicate ratios of `0.724138` for bath and `0.689655` for feed-gift.

## Scope Check

Only `scripts/build_care_atlas_30.py`, `tests/test_smooth_action_atlas.py`, and this ignored report directory are intended for this task. Existing worktree changes to generated/public assets and unrelated desktop-interaction files were left untouched.
