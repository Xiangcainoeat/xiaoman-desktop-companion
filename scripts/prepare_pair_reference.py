#!/usr/bin/env python3
"""Prepare a compact 2x2 reference grid for two difficult look seams."""

from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image


GREEN = (0, 255, 0, 255)
CANVAS_SIZE = (2048, 1152)


def _fit(frame: Image.Image, box: tuple[int, int, int, int]) -> Image.Image:
    width = box[2] - box[0]
    height = box[3] - box[1]
    scale = min(width * 0.68 / frame.width, height * 0.76 / frame.height)
    return frame.resize(
        (max(1, round(frame.width * scale)), max(1, round(frame.height * scale))),
        Image.Resampling.LANCZOS,
    )


def _box(index: int) -> tuple[int, int, int, int]:
    width = CANVAS_SIZE[0] // 2
    height = CANVAS_SIZE[1] // 2
    return (
        (index % 2) * width,
        (index // 2) * height,
        (index % 2 + 1) * width,
        (index // 2 + 1) * height,
    )


def prepare(anchors_dir: Path, first_pair: tuple[int, int], second_pair: tuple[int, int], output: Path) -> None:
    canvas = Image.new("RGBA", CANVAS_SIZE, GREEN)
    for cell, anchor_index in enumerate((*first_pair, *second_pair)):
        path = anchors_dir / f"anchor-{anchor_index:02d}.png"
        with Image.open(path) as opened:
            frame = opened.convert("RGBA")
        box = _box(cell)
        subject = _fit(frame, box)
        x = box[0] + (box[2] - box[0] - subject.width) // 2
        baseline = box[1] + round((box[3] - box[1]) * 0.9)
        canvas.alpha_composite(subject, (x, baseline - subject.height))
    output.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(output, "PNG", optimize=True)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--anchors-dir", type=Path, required=True)
    parser.add_argument("--first-lower", type=int, required=True)
    parser.add_argument("--second-lower", type=int, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    try:
        prepare(
            args.anchors_dir,
            (args.first_lower, (args.first_lower + 1) % 32),
            (args.second_lower, (args.second_lower + 1) % 32),
            args.output,
        )
    except (OSError, ValueError) as error:
        raise SystemExit(f"pair reference preparation failed: {error}") from error


if __name__ == "__main__":
    main()
