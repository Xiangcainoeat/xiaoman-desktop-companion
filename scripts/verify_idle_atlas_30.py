#!/usr/bin/env python3
"""Verify the final atlas on light, dark, and checkerboard backgrounds."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

from build_idle_atlas_30 import (
    ALPHA_VISIBLE,
    CELL_HEIGHT,
    CELL_WIDTH,
    COLUMNS,
    EDGE_CONTAMINATION_LIMIT,
    FRAMES_PER_ACTION,
    ROWS_PER_ACTION,
    ACTION_ORDER,
    ADJACENT_AREA_JUMP_LIMIT,
    COLOR_DRIFT_LIMIT,
    RED_PINK_EDGE_CONTAMINATION_LIMIT,
    edge_contamination_count,
    _color_signature,
    _continuity_metrics,
    _frame_report,
    red_pink_edge_contamination_count,
)


EXPECTED_SIZE = (CELL_WIDTH * COLUMNS, CELL_HEIGHT * ROWS_PER_ACTION * len(ACTION_ORDER))


def make_background(size: tuple[int, int], kind: str) -> Image.Image:
    if kind == "white":
        return Image.new("RGBA", size, (250, 250, 248, 255))
    if kind == "charcoal":
        return Image.new("RGBA", size, (29, 32, 34, 255))
    background = Image.new("RGBA", size, (226, 230, 226, 255))
    draw = ImageDraw.Draw(background)
    tile = 24
    for y in range(0, size[1], tile):
        for x in range(0, size[0], tile):
            if (x // tile + y // tile) % 2:
                draw.rectangle((x, y, x + tile - 1, y + tile - 1), fill=(196, 202, 197, 255))
    return background


def compact_background_sheet(atlas: Image.Image, output: Path) -> None:
    scale = 0.5
    thumbnail_size = (round(atlas.width * scale), round(atlas.height * scale))
    rows = []
    for kind in ("white", "charcoal", "checkerboard"):
        composed = Image.alpha_composite(make_background(atlas.size, kind), atlas)
        rows.append(composed.resize(thumbnail_size, Image.Resampling.LANCZOS))
    sheet = Image.new("RGB", (thumbnail_size[0], thumbnail_size[1] * len(rows)), (30, 33, 35))
    for index, row in enumerate(rows):
        sheet.paste(row.convert("RGB"), (0, index * thumbnail_size[1]))
    output.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(output, "PNG")


def verify(atlas: Image.Image) -> dict[str, object]:
    errors: list[str] = []
    if atlas.size != EXPECTED_SIZE:
        errors.append(f"atlas dimensions are {atlas.size}, expected {EXPECTED_SIZE}")

    pixels = np.asarray(atlas.convert("RGBA"), dtype=np.uint8)
    hidden_rgb = (pixels[..., 3] == 0) & np.any(pixels[..., :3] != 0, axis=2)
    if np.any(hidden_rgb):
        errors.append(f"{int(np.count_nonzero(hidden_rgb))} transparent pixels retain RGB")

    frame_results: list[dict[str, int | str]] = []
    action_results: dict[str, dict[str, object]] = {}
    for action_index, action in enumerate(ACTION_ORDER):
        action_frames: list[Image.Image] = []
        for index in range(FRAMES_PER_ACTION):
            row = action_index * ROWS_PER_ACTION + index // COLUMNS
            column = index % COLUMNS
            frame = atlas.crop((
                column * CELL_WIDTH,
                row * CELL_HEIGHT,
                (column + 1) * CELL_WIDTH,
                (row + 1) * CELL_HEIGHT,
            ))
            action_frames.append(frame)
            frame_pixels = np.asarray(frame.convert("RGBA"), dtype=np.uint8)
            alpha = frame_pixels[..., 3]
            visible = int(np.count_nonzero(alpha >= ALPHA_VISIBLE))
            contaminated = edge_contamination_count(frame)
            result = _frame_report(frame, action, index)
            result["visiblePixels"] = visible
            frame_results.append(result)
            if visible < 5000:
                errors.append(f"{action} frame {index + 1} is empty")
            if contaminated > EDGE_CONTAMINATION_LIMIT:
                errors.append(f"{action} frame {index + 1} has {contaminated} edge contamination pixels")

        signatures = [_color_signature(frame) for frame in action_frames]
        continuity = _continuity_metrics(action_frames, signatures)
        action_frame_results = [item for item in frame_results if item["action"] == action]
        red_pink_edge_pixels = max(
            (red_pink_edge_contamination_count(frame) for frame in action_frames),
            default=0,
        )
        action_results[action] = {
            "frames": FRAMES_PER_ACTION,
            "emptyFrames": sum(int(item["visiblePixels"]) < 5000 for item in action_frame_results),
            "hiddenRgbPixels": sum(int(item["hiddenRgbPixels"]) for item in action_frame_results),
            "contaminatedEdgePixels": max(
                (int(item["contaminatedEdgePixels"]) for item in action_frame_results),
                default=0,
            ),
            "redPinkEdgePixels": red_pink_edge_pixels,
            "maxColorDrift": continuity["maxColorDrift"],
            # The final atlas no longer has source coordinates, so scale 1 is
            # the normalized output space. The continuity values remain real.
            "registration": {
                "scale": 1.0,
                "sharedScale": True,
                **{key: continuity[key] for key in (
                    "maxAdjacentAreaDeltaRatio", "maxAdjacentCenterDelta", "maxAdjacentBottomDelta",
                )},
            },
        }
        if action_results[action]["emptyFrames"]:
            errors.append(f"{action} contains empty frames")
        if action_results[action]["hiddenRgbPixels"]:
            errors.append(f"{action} contains hidden RGB pixels")
        if action_results[action]["contaminatedEdgePixels"] > EDGE_CONTAMINATION_LIMIT:
            errors.append(f"{action} exceeds the edge contamination limit")
        if red_pink_edge_pixels > RED_PINK_EDGE_CONTAMINATION_LIMIT:
            errors.append(f"{action} exceeds the red/pink edge limit")
        if continuity["maxColorDrift"] > COLOR_DRIFT_LIMIT:
            errors.append(f"{action} exceeds the color drift limit")
        if continuity["maxAdjacentAreaDeltaRatio"] > ADJACENT_AREA_JUMP_LIMIT:
            errors.append(f"{action} exceeds the registration continuity limit")

    return {
        "ok": not errors,
        "algorithm": "idle-atlas-30-v2-stable-registration",
        "dimensions": [atlas.width, atlas.height],
        "columns": COLUMNS,
        "rows": ROWS_PER_ACTION * len(ACTION_ORDER),
        "cell": [CELL_WIDTH, CELL_HEIGHT],
        "backgrounds": ["white", "charcoal", "checkerboard"],
        "frameCount": len(frame_results),
        "maxContaminatedEdgePixels": max((item["contaminatedEdgePixels"] for item in frame_results), default=0),
        "errors": errors,
        "actions": action_results,
        "frames": frame_results,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--atlas", type=Path, default=Path("public/pet/idle-actions-30.webp"))
    parser.add_argument("--contact-sheet", type=Path, default=Path("work/idle-actions-30-background-check.png"))
    parser.add_argument("--report", type=Path, default=Path("work/idle-actions-30-verify-report.json"))
    args = parser.parse_args()

    atlas = Image.open(args.atlas).convert("RGBA")
    report = verify(atlas)
    compact_background_sheet(atlas, args.contact_sheet)
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, ensure_ascii=True, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, ensure_ascii=True))
    if not report["ok"]:
        raise SystemExit("idle action atlas visual verification failed")


if __name__ == "__main__":
    main()
