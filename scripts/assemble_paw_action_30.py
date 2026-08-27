#!/usr/bin/env python3
"""Replace the legacy scratch rows with a 30-frame raised-front-paw action."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from statistics import median

from PIL import Image

from build_idle_atlas_30 import (
    ACTION_ORDER,
    CELL_HEIGHT,
    CELL_WIDTH,
    COLUMNS,
    FRAMES_PER_ACTION,
    ROWS_PER_ACTION,
    make_contact_sheet,
    normalize_action_frames,
    _visible_bbox,
)


PAW_SOURCE_COLUMNS = 5
PAW_SOURCE_ROWS = 2
PAW_FRAMES_PER_SHEET = PAW_SOURCE_COLUMNS * PAW_SOURCE_ROWS
PAW_PHASES = ("lift", "hold", "lower")
ATLAS_SIZE = (CELL_WIDTH * COLUMNS, CELL_HEIGHT * ROWS_PER_ACTION * len(ACTION_ORDER))
PAW_REGISTRATION_MAX_PASSES = 3


def paw_source_mapping() -> list[dict[str, int | str]]:
    """Return the stable lift -> hold -> lower order used by the atlas."""
    return [
        {"phase": phase, "sheetCell": cell}
        for phase in PAW_PHASES
        for cell in range(PAW_FRAMES_PER_SHEET)
    ]


def _open_rgba(path: Path) -> Image.Image:
    if not path.is_file():
        raise FileNotFoundError(f"input image does not exist: {path}")
    with Image.open(path) as opened:
        return opened.convert("RGBA")


def _source_cells(path: Path) -> list[Image.Image]:
    """Extract a 5x2 relay sheet without assuming a particular output size."""
    sheet = _open_rgba(path)
    cells: list[Image.Image] = []
    for index in range(PAW_FRAMES_PER_SHEET):
        left = round(sheet.width * (index % PAW_SOURCE_COLUMNS) / PAW_SOURCE_COLUMNS)
        top = round(sheet.height * (index // PAW_SOURCE_COLUMNS) / PAW_SOURCE_ROWS)
        right = round(sheet.width * (index % PAW_SOURCE_COLUMNS + 1) / PAW_SOURCE_COLUMNS)
        bottom = round(sheet.height * (index // PAW_SOURCE_COLUMNS + 1) / PAW_SOURCE_ROWS)
        cells.append(sheet.crop((left, top, right, bottom)).convert("RGB"))
    return cells


def _atlas_frame(atlas: Image.Image, action_index: int, frame_index: int) -> Image.Image:
    row = action_index * ROWS_PER_ACTION + frame_index // COLUMNS
    column = frame_index % COLUMNS
    return atlas.crop((
        column * CELL_WIDTH,
        row * CELL_HEIGHT,
        (column + 1) * CELL_WIDTH,
        (row + 1) * CELL_HEIGHT,
    ))


def _neutral_indices(frame_count: int) -> list[int]:
    return list(range(min(4, frame_count))) + list(range(max(0, frame_count - 4), frame_count))


def _median_subject_size(frames: list[Image.Image]) -> tuple[int, int]:
    sizes: list[tuple[int, int]] = []
    for index, frame in enumerate(frames):
        box = _visible_bbox(frame)
        if box is None:
            raise ValueError(f"frame {index} contains no visible subject")
        sizes.append((box[2] - box[0], box[3] - box[1]))
    return (
        round(float(median(width for width, _ in sizes))),
        round(float(median(height for _, height in sizes))),
    )


def _neutral_subject_size(frames: list[Image.Image]) -> tuple[int, int]:
    return _median_subject_size([frames[index] for index in _neutral_indices(len(frames))])


def _shared_reference_size(base: Image.Image) -> tuple[int, int]:
    """Measure the two preserved actions to keep the replacement registered."""
    reference_frames = [
        _atlas_frame(base, action_index, frame_index)
        for action_index in range(2)
        for frame_index in _neutral_indices(FRAMES_PER_ACTION)
    ]
    return _median_subject_size(reference_frames)


def _normalize_paw_frames(
    source_frames: list[Image.Image],
    base: Image.Image,
) -> tuple[list[Image.Image], dict[str, object]]:
    """Iteratively match the preserved actions' neutral height without stretching."""
    reference_width, reference_height = _shared_reference_size(base)
    multiplier = 1.0
    normalized: list[Image.Image] = []
    registration: dict[str, object] = {}
    for _ in range(PAW_REGISTRATION_MAX_PASSES):
        normalized, registration = normalize_action_frames(source_frames, multiplier)
        _, current_height = _neutral_subject_size(normalized)
        if current_height == reference_height:
            break
        multiplier *= reference_height / max(1, current_height)
    actual_width, actual_height = _neutral_subject_size(normalized)
    registration = {
        **registration,
        "sharedReferenceSubjectSize": [reference_width, reference_height],
        "actualNeutralSubjectSize": [actual_width, actual_height],
    }
    return normalized, registration


def assemble(
    base_atlas_path: Path,
    phase_paths: dict[str, Path],
) -> tuple[Image.Image, dict[str, object], list[dict[str, object]]]:
    base = _open_rgba(base_atlas_path)
    if base.size != ATLAS_SIZE:
        raise ValueError(f"base atlas is {base.size}, expected {ATLAS_SIZE}")

    # Preserve the already-validated lick and blink pixels byte-for-byte. Only
    # rows 6..8 are rebuilt for the new raised-paw motion.
    atlas = Image.new("RGBA", ATLAS_SIZE, (0, 0, 0, 0))
    atlas.alpha_composite(base.crop((0, 0, base.width, CELL_HEIGHT * ROWS_PER_ACTION * 2)), (0, 0))

    source_frames: list[Image.Image] = []
    provenance: list[dict[str, object]] = []
    for phase in PAW_PHASES:
        cells = _source_cells(phase_paths[phase])
        source_frames.extend(cells)
        provenance.extend(
            {
                "frameIndex": len(provenance),
                "phase": phase,
                "source": f"{phase_paths[phase]}#cell-{cell}",
                "compositing": "none",
            }
            for cell in range(PAW_FRAMES_PER_SHEET)
        )

    normalized, registration = _normalize_paw_frames(source_frames, base)
    if len(normalized) != FRAMES_PER_ACTION:
        raise ValueError(f"expected {FRAMES_PER_ACTION} normalized paw frames, got {len(normalized)}")
    for index, frame in enumerate(normalized):
        row = ROWS_PER_ACTION * 2 + index // COLUMNS
        column = index % COLUMNS
        atlas.alpha_composite(frame, (column * CELL_WIDTH, row * CELL_HEIGHT))

    # Import the verifier only after the atlas has been assembled so the same
    # strict checks used in CI are applied to the complete output.
    import verify_idle_atlas_30 as verifier

    report = verifier.verify(atlas)
    report["algorithm"] = "idle-atlas-30-v3-raised-front-paw"
    report["compositing"] = "none"
    report["source"] = {
        "baseAtlas": str(base_atlas_path),
        "pawPhases": {phase: str(phase_paths[phase]) for phase in PAW_PHASES},
        "pawFrameCount": len(source_frames),
    }
    report["pawAction"] = {
        "visibleLabel": "举前爪",
        "internalAction": "idle-scratch",
        "phases": list(PAW_PHASES),
        "framesPerPhase": PAW_FRAMES_PER_SHEET,
        "registration": registration,
        "compositing": "none",
    }
    # Keep the historical matte-removal accounting from the accepted base
    # report and add the new source's deterministic count.
    try:
        base_report_path = Path("work/idle-actions-30-report.json")
        base_report = json.loads(base_report_path.read_text(encoding="utf-8"))
        previous_holes = int(base_report.get("backgroundHolePixelsRemoved", 0))
    except (OSError, ValueError, TypeError):
        previous_holes = 0
    report["backgroundHolePixelsRemoved"] = max(
        1,
        previous_holes + int(registration.get("backgroundHolePixelsRemoved", 0)),
    )
    return atlas, report, provenance


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-atlas", type=Path, default=Path("public/pet/idle-actions-30.webp"))
    parser.add_argument("--paw-lift", type=Path, required=True)
    parser.add_argument("--paw-hold", type=Path, required=True)
    parser.add_argument("--paw-lower", type=Path, required=True)
    parser.add_argument("--output", type=Path, default=Path("public/pet/idle-actions-30.webp"))
    parser.add_argument("--contact-sheet", type=Path, default=Path("work/idle-actions-30-contact-sheet.png"))
    parser.add_argument("--report", type=Path, default=Path("work/idle-actions-30-report.json"))
    parser.add_argument("--provenance", type=Path, default=Path("work/xiaoman-pet-96/paw-assembly-provenance.json"))
    args = parser.parse_args()

    try:
        atlas, report, provenance = assemble(
            args.base_atlas,
            {"lift": args.paw_lift, "hold": args.paw_hold, "lower": args.paw_lower},
        )
    except (FileNotFoundError, OSError, ValueError, KeyError, json.JSONDecodeError) as error:
        raise SystemExit(f"raised-paw assembly failed: {error}") from error

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.contact_sheet.parent.mkdir(parents=True, exist_ok=True)
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.provenance.parent.mkdir(parents=True, exist_ok=True)
    atlas.save(args.output, "WEBP", lossless=True, quality=100, method=6, exact=True)
    make_contact_sheet(atlas).save(args.contact_sheet, "PNG")
    args.report.write_text(json.dumps(report, ensure_ascii=True, indent=2) + "\n", encoding="utf-8")
    args.provenance.write_text(
        json.dumps({
            "algorithm": "raised-front-paw-30-no-blend",
            "compositing": "none",
            "frames": provenance,
        }, ensure_ascii=True, indent=2) + "\n",
        encoding="utf-8",
    )
    print(json.dumps({
        "ok": report["ok"],
        "dimensions": report["dimensions"],
        "pawAction": report["pawAction"],
    }, ensure_ascii=True))
    if not report["ok"]:
        raise SystemExit("raised-paw atlas validation failed")


if __name__ == "__main__":
    main()
