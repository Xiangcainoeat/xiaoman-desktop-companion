#!/usr/bin/env python3
"""Verify Xiaoman's 30-frame care/sleep atlas contract."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image

from build_care_atlas_30 import CELL_HEIGHT, CELL_WIDTH, COLUMNS, FRAMES, _edge_contamination


def verify(atlas: Image.Image, kind: str = "sleep") -> dict[str, object]:
    rows = 3 if kind == "sleep" else 6
    expected = (CELL_WIDTH * COLUMNS, CELL_HEIGHT * rows)
    errors: list[str] = []
    if atlas.size != expected:
        errors.append(f"atlas dimensions are {atlas.size}, expected {expected}")
    pixels = np.asarray(atlas.convert("RGBA"), dtype=np.uint8)
    hidden = (pixels[..., 3] == 0) & np.any(pixels[..., :3] != 0, axis=2)
    if np.any(hidden):
        errors.append(f"{int(np.count_nonzero(hidden))} transparent pixels retain RGB")
    rows_to_check = [0] if kind == "sleep" else [0, 3]
    frames: list[dict[str, int]] = []
    for atlas_row in rows_to_check:
        for index in range(FRAMES):
            row = atlas_row + index // COLUMNS
            column = index % COLUMNS
            frame = atlas.crop((column * CELL_WIDTH, row * CELL_HEIGHT, (column + 1) * CELL_WIDTH, (row + 1) * CELL_HEIGHT))
            alpha = np.asarray(frame.getchannel("A"), dtype=np.uint8)
            visible = int(np.count_nonzero(alpha >= 10))
            contamination = _edge_contamination(frame)
            item = {"index": index, "row": atlas_row, "visiblePixels": visible, "edgeContaminationPixels": contamination}
            frames.append(item)
            if visible < 5000:
                errors.append(f"row {atlas_row} frame {index} is empty")
            if contamination > 4:
                errors.append(f"row {atlas_row} frame {index} has edge contamination")
    return {"ok": not errors, "kind": kind, "dimensions": list(atlas.size), "frameCount": FRAMES, "checkedRows": rows_to_check, "errors": errors, "frames": frames}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("atlas", type=Path)
    parser.add_argument("metadata", type=Path)
    parser.add_argument("--report", type=Path)
    args = parser.parse_args()
    metadata = json.loads(args.metadata.read_text(encoding="utf-8"))
    kind = "sleep" if "sleep" in args.atlas.name else "care"
    report = verify(Image.open(args.atlas).convert("RGBA"), kind)
    if args.report:
        args.report.write_text(json.dumps(report, ensure_ascii=True, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, ensure_ascii=True))
    if not report["ok"]:
        raise SystemExit("care atlas verification failed")


if __name__ == "__main__":
    main()
