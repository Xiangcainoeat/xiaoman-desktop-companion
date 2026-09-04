# RED: Smooth Action Atlas Expansion

Date: 2026-08-27
Worktree: `$HOME/.config/superpowers/worktrees/xiaoman-desktop-companion-release/xiaoman-care-and-games`

Command:

```text
$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3 -m unittest tests/test_smooth_action_atlas.py
```

Exit code: `1`

Exact output:

```text
.F.......
======================================================================
FAIL: test_expand_interpolates_ten_source_poses_into_thirty_distinct_rgba_frames (tests.test_smooth_action_atlas.SmoothActionAtlasContractTest.test_expand_interpolates_ten_source_poses_into_thirty_distinct_rgba_frames)
----------------------------------------------------------------------
Traceback (most recent call last):
  File "$HOME/.config/superpowers/worktrees/xiaoman-desktop-companion-release/xiaoman-care-and-games/tests/test_smooth_action_atlas.py", line 44, in test_expand_interpolates_ten_source_poses_into_thirty_distinct_rgba_frames
    self.assertLess(report["duplicateRatio"], 0.1)
AssertionError: 0.689655 not less than 0.1

----------------------------------------------------------------------
Ran 9 tests in 4.214s

FAILED (failures=1)
```

Cause: `expand_to_frame_count` currently selects source frames by nearest temporal index, so a 10-frame sequence expanded to 30 frames contains 20 duplicate adjacent pairs (`20 / 29 = 0.689655`).
