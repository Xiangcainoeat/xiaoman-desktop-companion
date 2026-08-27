# Task 2 Report: Xiaoman Sleep and Care Atlases

## Status

Implemented and committed as `feat: add Xiaoman sleep and care atlases`.

## Inputs and extraction

- Reused the supplied `sleep-source.png` and `care-source.png`; no network image generation was requested.
- Sleep source detection found 8 independent subjects per row, producing 24 complete source poses. The builder expands these to 30 frames only after independent extraction and normalization.
- Care source detection found 9 bath subjects and 10 subjects in each of the feed and gift rows. The builder crops each detected foreground interval independently rather than mapping a nominal contact-sheet grid into the 10-column atlas.
- Bath is expanded to 30 normalized frames in atlas row 0. Feed and gift source poses are combined into one 30-frame care-feedback loop in atlas row 3, as required by the shared `feed`/`gift` `atlasFramePosition` contract.

## Processing and QA

- Reused the existing Xiaoman normalization scale and 192x208 cell registration helpers.
- Added deterministic connected-component cleanup for narrow edge fragments introduced by contact-sheet seams.
- Added a final green-spill cleanup that removes matte-colored visible pixels, clears hidden RGB, and preserves the native cream/brown palette.
- Generated temporary high-resolution contact sheets under `work/xiaoman-care-assets/` and inspected both atlases visually.
- Final focused audit found zero visible pixels on cell side edges and zero pixels with green dominance above the spill threshold in sleep row 0 or care rows 0 and 3.

## Outputs

- `public/pet/sleeping-30.webp`: 1920x624, 10x3, 30 frames.
- `public/pet/sleeping-30.json`: row 0 metadata and 192x208 cell contract.
- `public/pet/care-actions-30.webp`: 1920x1248, 10x6, 30 bath frames at row 0 and 30 feed/gift frames at row 3.
- `public/pet/care-actions-30.json`: bath/feed/gift metadata with the required rows.

## Tests and verification

- `sh scripts/run_image_python.sh -m unittest tests/test_care_atlas_30.py`: 5 tests passed.
- `sh scripts/run_image_python.sh scripts/verify_care_atlas_30.py public/pet/sleeping-30.webp public/pet/sleeping-30.json`: passed, 30/30 frames valid, zero errors.
- `sh scripts/run_image_python.sh scripts/verify_care_atlas_30.py public/pet/care-actions-30.webp public/pet/care-actions-30.json`: passed, 60 checked bath/feed-gift cells valid, zero errors.

The worktree already contained unrelated shared TypeScript/domain changes from the surrounding feature work; they were not modified or included in this Task 2 commit.
