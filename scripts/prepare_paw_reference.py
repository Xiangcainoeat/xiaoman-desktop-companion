#!/usr/bin/env python3
"""Prepare a 5x2 front-paw action reference from the native sprite sheet."""

from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image


FRAME_WIDTH = 192
FRAME_HEIGHT = 208
CANVAS_SIZE = (2048, 1152)
GREEN = (0, 255, 0, 255)


def _place(canvas: Image.Image, frame: Image.Image, cell: int) -> None:
    cell_width = CANVAS_SIZE[0] // 5
    cell_height = CANVAS_SIZE[1] // 2
    left = (cell % 5) * cell_width
    top = (cell // 5) * cell_height
    scale = min(cell_width * 0.66 / frame.width, cell_height * 0.76 / frame.height)
    resized = frame.resize(
        (max(1, round(frame.width * scale)), max(1, round(frame.height * scale))),
        Image.Resampling.LANCZOS,
    )
    x = left + (cell_width - resized.width) // 2
    baseline = top + round(cell_height * 0.9)
    canvas.alpha_composite(resized, (x, baseline - resized.height))


def prepare(native_sheet: Path, output: Path) -> None:
    with Image.open(native_sheet) as opened:
        sheet = opened.convert("RGBA")
    # Native standard row 3 is the four-frame front-paw raise/wave action.
    frames = [
        sheet.crop((column * FRAME_WIDTH, 3 * FRAME_HEIGHT, (column + 1) * FRAME_WIDTH, 4 * FRAME_HEIGHT))
        for column in range(4)
    ]
    canvas = Image.new("RGBA", CANVAS_SIZE, GREEN)
    sequence = [0, 1, 2, 3, 3, 3, 2, 2, 1, 0]
    for cell, frame_index in enumerate(sequence):
        _place(canvas, frames[frame_index], cell)
    output.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(output, "PNG", optimize=True)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--native-sheet", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    try:
        prepare(args.native_sheet, args.output)
    except OSError as error:
        raise SystemExit(f"paw reference preparation failed: {error}") from error


if __name__ == "__main__":
    main()
