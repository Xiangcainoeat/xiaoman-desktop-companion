#!/usr/bin/env python3
"""Prepare endpoint reference sheets for 96-direction image generation."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from PIL import Image

from resample_look_directions import normalize_anchor_frames, split_source_sheet


ANCHOR_COUNT = 32
BATCH_COUNT = 8
SEGMENTS_PER_BATCH = 4
SHEET_SIZE = (2048, 1152)
SHEET_COLUMNS = 4
SHEET_ROWS = 2
GREEN = (0, 255, 0, 255)


def _fit_subject(frame: Image.Image, size: tuple[int, int]) -> Image.Image:
    scale = min(size[0] / frame.width, size[1] / frame.height)
    return frame.resize(
        (max(1, round(frame.width * scale)), max(1, round(frame.height * scale))),
        Image.Resampling.LANCZOS,
    )


def _place_subject(canvas: Image.Image, frame: Image.Image, box: tuple[int, int, int, int]) -> None:
    left, top, right, bottom = box
    cell_width = right - left
    cell_height = bottom - top
    subject = _fit_subject(frame, (round(cell_width * 0.72), round(cell_height * 0.78)))
    x = left + (cell_width - subject.width) // 2
    baseline = top + round(cell_height * 0.89)
    canvas.alpha_composite(subject, (x, baseline - subject.height))


def _cell_box(index: int) -> tuple[int, int, int, int]:
    cell_width = SHEET_SIZE[0] // SHEET_COLUMNS
    cell_height = SHEET_SIZE[1] // SHEET_ROWS
    column = index % SHEET_COLUMNS
    row = index // SHEET_COLUMNS
    return (
        column * cell_width,
        row * cell_height,
        (column + 1) * cell_width,
        (row + 1) * cell_height,
    )


def prepare(anchor_sheet: Path, native_sheet: Path, output_dir: Path) -> dict[str, object]:
    with Image.open(anchor_sheet) as opened:
        source = opened.convert("RGBA")
    anchors, registration = normalize_anchor_frames(split_source_sheet(source))
    if len(anchors) != ANCHOR_COUNT:
        raise ValueError(f"expected {ANCHOR_COUNT} anchors, got {len(anchors)}")

    anchors_dir = output_dir / "anchors"
    references_dir = output_dir / "generation-inputs"
    prompts_dir = output_dir / "prompts"
    for directory in (anchors_dir, references_dir, prompts_dir):
        directory.mkdir(parents=True, exist_ok=True)

    for index, anchor in enumerate(anchors):
        anchor.save(anchors_dir / f"anchor-{index:02d}.png", "PNG", optimize=True)

    batches: list[dict[str, object]] = []
    for batch_index in range(BATCH_COUNT):
        first_segment = batch_index * SEGMENTS_PER_BATCH
        canvas = Image.new("RGBA", SHEET_SIZE, GREEN)
        mappings: list[dict[str, object]] = []
        for local_segment in range(SEGMENTS_PER_BATCH):
            lower = (first_segment + local_segment) % ANCHOR_COUNT
            upper = (lower + 1) % ANCHOR_COUNT
            first_cell = local_segment * 2
            second_cell = first_cell + 1
            _place_subject(canvas, anchors[lower], _cell_box(first_cell))
            _place_subject(canvas, anchors[upper], _cell_box(second_cell))
            mappings.append({
                "segment": lower,
                "lowerAnchor": lower,
                "upperAnchor": upper,
                "outputCells": [first_cell, second_cell],
                "targetFrameIndices": [lower * 3 + 1, lower * 3 + 2],
                "targetDegrees": [lower * 11.25 + 3.75, lower * 11.25 + 7.5],
            })

        reference_path = references_dir / f"endpoints-{batch_index:02d}.png"
        canvas.save(reference_path, "PNG", optimize=True)
        prompt_path = prompts_dir / f"batch-{batch_index:02d}.md"
        prompt_path.write_text(
            (
                "Use case: stylized-concept\n"
                "Asset type: production animation direction frames for a desktop pet\n"
                "Primary request: Transform the supplied 4x2 endpoint reference grid into a 4x2 "
                "grid of true in-between poses. Treat cells as four adjacent horizontal pairs in "
                "row-major order. In every pair, output cell one is exactly one-third of the head, "
                "eyes, ears and neck rotation from the supplied left endpoint toward the supplied "
                "right endpoint; output cell two is exactly two-thirds. These must be newly rendered "
                "single poses, never alpha blends or double exposures.\n"
                "Input images: Image 1 is the endpoint grid and fixes pose progression, character, "
                "camera and cell layout. Image 2 is the native Codex color reference and fixes cream "
                "body fur, dark seal-point face/ears/paws/tail and clear blue eyes.\n"
                "Scene/backdrop: perfectly flat chroma green #00FF00 in every cell.\n"
                "Subject: exactly one full-body seated Siamese cat per cell, matching Xiaoman's "
                "proportions and 3D-rendered style.\n"
                "Composition/framing: exact 4 columns by 2 rows, eight equal cells, one centered cat "
                "per cell, same scale and paw baseline as Image 1, complete ears/paws/tail visible.\n"
                "Color palette: match Image 2; neutral ivory/cream body with dark brown seal points; "
                "no peach, red, pink or magenta cast.\n"
                "Constraints: preserve clockwise continuity; only pose direction changes; sharp "
                "single silhouette; clean fur edge against green; no shadows, labels, borders or text.\n"
                "Avoid: duplicate cats, ghost heads, overlapping poses, translucent subjects, motion "
                "blur, red/pink fringe, green spill, changed anatomy, changed expression, changed "
                "camera, cropped body, watermark.\n"
            ),
            encoding="utf-8",
        )
        batches.append({
            "batch": batch_index,
            "reference": str(reference_path),
            "prompt": str(prompt_path),
            "segments": mappings,
        })

    with Image.open(native_sheet) as opened:
        native = opened.convert("RGBA").crop((0, 0, 192, 208))
    native_reference = Image.new("RGBA", (512, 512), GREEN)
    _place_subject(native_reference, native, (0, 0, 512, 512))
    native_reference_path = references_dir / "native-color-reference.png"
    native_reference.save(native_reference_path, "PNG", optimize=True)

    manifest: dict[str, object] = {
        "anchorSheet": str(anchor_sheet),
        "nativeSheet": str(native_sheet),
        "anchorCount": len(anchors),
        "batchCount": BATCH_COUNT,
        "sheet": {"dimensions": list(SHEET_SIZE), "columns": SHEET_COLUMNS, "rows": SHEET_ROWS},
        "registration": registration,
        "nativeColorReference": str(native_reference_path),
        "batches": batches,
    }
    (output_dir / "generation-manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=True, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    return manifest


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--anchor-sheet", type=Path, required=True)
    parser.add_argument("--native-sheet", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args()

    try:
        manifest = prepare(args.anchor_sheet, args.native_sheet, args.output_dir)
    except (OSError, ValueError) as error:
        raise SystemExit(f"look-96 generation preparation failed: {error}") from error
    print(json.dumps({
        "ok": True,
        "anchorCount": manifest["anchorCount"],
        "batchCount": manifest["batchCount"],
        "outputDir": str(args.output_dir),
    }, ensure_ascii=True))


if __name__ == "__main__":
    main()
