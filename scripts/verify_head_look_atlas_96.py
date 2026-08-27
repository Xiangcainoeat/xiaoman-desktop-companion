#!/usr/bin/env python3
"""Verify the supplemental 96-frame spatial head-look atlas."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image

from build_idle_atlas_30 import red_pink_edge_contamination_count
from build_head_look_atlas_96 import (
    ALGORITHM_ID,
    COLUMNS,
    FRAME_COUNT,
    FRAME_HEIGHT,
    FRAME_WIDTH,
    MASK_BBOX,
    NEUTRAL_EYE_COVER_BOXES,
    ROWS,
    STEP_DEGREES,
    make_contact_sheet,
)


def _frames(atlas: Image.Image) -> list[Image.Image]:
    return [
        atlas.crop(
            (
                (index % COLUMNS) * FRAME_WIDTH,
                (index // COLUMNS) * FRAME_HEIGHT,
                (index % COLUMNS + 1) * FRAME_WIDTH,
                (index // COLUMNS + 1) * FRAME_HEIGHT,
            )
        )
        for index in range(FRAME_COUNT)
    ]


def _ellipse_mask(box: tuple[int, int, int, int], padding: int = 6) -> np.ndarray:
    mask = np.zeros((FRAME_HEIGHT, FRAME_WIDTH), dtype=bool)
    left, top, right, bottom = box
    yy, xx = np.ogrid[:FRAME_HEIGHT, :FRAME_WIDTH]
    # Account for the feather, local cover blur, and WEBP edge sampling.
    left -= padding
    top -= padding
    right += padding
    bottom += padding
    center_x = (left + right) / 2
    center_y = (top + bottom) / 2
    radius_x = max(1.0, (right - left) / 2)
    radius_y = max(1.0, (bottom - top) / 2)
    mask[:, :] = ((xx - center_x) / radius_x) ** 2 + ((yy - center_y) / radius_y) ** 2 <= 1.0
    return mask


def _expanded_mask() -> np.ndarray:
    allowed = _ellipse_mask(MASK_BBOX)
    for box in NEUTRAL_EYE_COVER_BOXES:
        allowed |= _ellipse_mask(box)
    return allowed


def verify(atlas: Image.Image, metadata: object, source_format: str | None = None) -> dict[str, object]:
    errors: list[str] = []
    rgba = atlas.convert("RGBA")
    detected_format = source_format or atlas.format
    if detected_format != "WEBP":
        errors.append(f"atlas format is {detected_format!r}, expected 'WEBP'")

    if not isinstance(metadata, dict):
        errors.append("metadata root must be an object")
        metadata = {}
    expected: dict[str, object] = {
        "algorithm": ALGORITHM_ID,
        "frameCount": FRAME_COUNT,
        "columns": COLUMNS,
        "rows": ROWS,
        "stepDegrees": STEP_DEGREES,
        "frameWidth": FRAME_WIDTH,
        "frameHeight": FRAME_HEIGHT,
        "dimensions": [FRAME_WIDTH * COLUMNS, FRAME_HEIGHT * ROWS],
        "compositing": "spatial-mask-only",
        "temporalBlend": False,
    }
    for key, value in expected.items():
        if metadata.get(key) != value:
            errors.append(f"metadata {key} is {metadata.get(key)!r}, expected {value!r}")

    expected_dimensions = (FRAME_WIDTH * COLUMNS, FRAME_HEIGHT * ROWS)
    frames = _frames(rgba) if rgba.size == expected_dimensions else []
    if rgba.size != expected_dimensions:
        errors.append(f"atlas dimensions are {rgba.size}, expected {expected_dimensions}")

    allowed = _expanded_mask()
    empty_frames = 0
    hidden_rgb_pixels = 0
    outside_mask_pixels = 0
    red_pink_edge_pixels = 0
    distinct_hashes: set[bytes] = set()
    for frame in frames:
        pixels = np.asarray(frame, dtype=np.uint8)
        alpha = pixels[..., 3]
        if not np.any(alpha >= 10):
            empty_frames += 1
        hidden_rgb_pixels += int(
            np.count_nonzero((alpha == 0) & np.any(pixels[..., :3] != 0, axis=2))
        )
        outside_mask_pixels += int(np.count_nonzero((alpha >= 10) & ~allowed))
        red_pink_edge_pixels = max(red_pink_edge_pixels, red_pink_edge_contamination_count(frame))
        distinct_hashes.add(frame.tobytes())

    if empty_frames:
        errors.append(f"atlas contains {empty_frames} empty frames")
    if hidden_rgb_pixels:
        errors.append(f"atlas contains {hidden_rgb_pixels} hidden RGB pixels")
    if outside_mask_pixels:
        errors.append(f"atlas contains {outside_mask_pixels} visible pixels outside the face mask")
    if red_pink_edge_pixels:
        errors.append(f"atlas contains {red_pink_edge_pixels} red/pink edge pixels in one frame")
    if len(distinct_hashes) < FRAME_COUNT:
        errors.append(f"atlas has only {len(distinct_hashes)} distinct frames")

    return {
        "ok": not errors,
        "algorithm": ALGORITHM_ID,
        "format": detected_format,
        "mode": rgba.mode,
        "dimensions": [rgba.width, rgba.height],
        "frameCount": len(frames),
        "columns": COLUMNS,
        "rows": ROWS,
        "stepDegrees": STEP_DEGREES,
        "compositing": "spatial-mask-only",
        "temporalBlend": False,
        "emptyFrames": empty_frames,
        "hiddenRgbPixels": hidden_rgb_pixels,
        "outsideMaskPixels": outside_mask_pixels,
        "maxRedPinkEdgePixelsPerFrame": red_pink_edge_pixels,
        "distinctFrames": len(distinct_hashes),
        "errors": errors,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("atlas", type=Path)
    parser.add_argument("metadata", type=Path)
    parser.add_argument("--contact-sheet", type=Path)
    parser.add_argument("--report", type=Path)
    args = parser.parse_args()

    try:
        with Image.open(args.atlas) as opened:
            source_format = opened.format
            atlas = opened.copy()
        metadata = json.loads(args.metadata.read_text(encoding="utf-8"))
        report = verify(atlas, metadata, source_format=source_format)
        if args.contact_sheet:
            args.contact_sheet.parent.mkdir(parents=True, exist_ok=True)
            make_contact_sheet(atlas.convert("RGBA")).save(args.contact_sheet, "PNG")
        if args.report:
            args.report.parent.mkdir(parents=True, exist_ok=True)
            args.report.write_text(json.dumps(report, ensure_ascii=True, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    except (OSError, ValueError, json.JSONDecodeError) as error:
        raise SystemExit(f"head look atlas verification failed: {error}") from error

    print(json.dumps(report, ensure_ascii=True))
    if not report["ok"]:
        raise SystemExit("head look atlas verification failed")


if __name__ == "__main__":
    main()
