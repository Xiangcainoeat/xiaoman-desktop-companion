#!/usr/bin/env python3
"""Extract the accepted native v2 look rows into a host-only 16-direction atlas."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont


CELL_WIDTH = 192
CELL_HEIGHT = 208
COLUMNS = 8
ROWS = 2
DIRECTIONS = 16
SOURCE_LOOK_ROW = 9


def make_contact_sheet(atlas: Image.Image) -> Image.Image:
    sheet = Image.new("RGBA", atlas.size, (236, 239, 236, 255))
    draw = ImageDraw.Draw(sheet)
    tile = 12
    for y in range(0, sheet.height, tile):
        for x in range(0, sheet.width, tile):
            if (x // tile + y // tile) % 2:
                draw.rectangle((x, y, x + tile - 1, y + tile - 1), fill=(217, 222, 218, 255))
    sheet.alpha_composite(atlas)
    font = ImageFont.load_default()
    for index in range(DIRECTIONS):
        x = (index % COLUMNS) * CELL_WIDTH
        y = (index // COLUMNS) * CELL_HEIGHT
        draw.rectangle((x + 3, y + 3, x + 91, y + 16), fill=(255, 255, 255, 224))
        draw.text((x + 6, y + 5), f"{index:02d} {index * 22.5:05.1f} deg", fill=(31, 37, 33, 255), font=font)
    return sheet


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--contact-sheet", type=Path, required=True)
    parser.add_argument("--report", type=Path, required=True)
    args = parser.parse_args()

    source = Image.open(args.source).convert("RGBA")
    expected_size = (CELL_WIDTH * COLUMNS, CELL_HEIGHT * 11)
    if source.size != expected_size:
        raise ValueError(f"expected native atlas {expected_size}, found {source.size}")

    top = SOURCE_LOOK_ROW * CELL_HEIGHT
    atlas = source.crop((0, top, CELL_WIDTH * COLUMNS, top + CELL_HEIGHT * ROWS))
    frames = []
    for index in range(DIRECTIONS):
        left = (index % COLUMNS) * CELL_WIDTH
        frame_top = (index // COLUMNS) * CELL_HEIGHT
        frame = atlas.crop((left, frame_top, left + CELL_WIDTH, frame_top + CELL_HEIGHT))
        alpha = np.asarray(frame.getchannel("A"))
        frames.append({
            "index": index,
            "degrees": index * 22.5,
            "visible_pixels": int(np.count_nonzero(alpha > 0)),
            "opaque_pixels": int(np.count_nonzero(alpha >= 250)),
        })

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.contact_sheet.parent.mkdir(parents=True, exist_ok=True)
    args.report.parent.mkdir(parents=True, exist_ok=True)
    atlas.save(args.output, "WEBP", lossless=True, quality=100, method=6)
    make_contact_sheet(atlas).save(args.contact_sheet, "PNG")
    report = {
        "ok": all(frame["visible_pixels"] > 5000 for frame in frames),
        "source": str(args.source),
        "output": str(args.output),
        "source_rows": [SOURCE_LOOK_ROW, SOURCE_LOOK_ROW + 1],
        "dimensions": list(atlas.size),
        "grid": [COLUMNS, ROWS],
        "cell": [CELL_WIDTH, CELL_HEIGHT],
        "frame_count": DIRECTIONS,
        "frames": frames,
    }
    args.report.write_text(json.dumps(report, ensure_ascii=True, indent=2) + "\n", encoding="utf-8")
    if not report["ok"]:
        raise SystemExit("native look atlas validation failed")
    print(json.dumps({key: report[key] for key in ("ok", "dimensions", "frame_count")}))


if __name__ == "__main__":
    main()
