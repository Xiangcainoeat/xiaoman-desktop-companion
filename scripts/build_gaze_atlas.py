#!/usr/bin/env python3
"""Build the host-only 32-direction transparent gaze atlas."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont


CELL_WIDTH = 192
CELL_HEIGHT = 208
COLUMNS = 8
ROWS = 4
FRAME_COUNT = COLUMNS * ROWS


def chroma_to_alpha(image: Image.Image) -> Image.Image:
    rgba = np.asarray(image.convert("RGBA"), dtype=np.float32).copy()
    red, green, blue = rgba[..., 0], rgba[..., 1], rgba[..., 2]
    green_advantage = green - np.maximum(red, blue)
    key_candidate = (green > 90) & (green > red * 1.08) & (green > blue * 1.08)
    alpha = np.full(red.shape, 255.0, dtype=np.float32)
    alpha[key_candidate] = np.clip((42.0 - green_advantage[key_candidate]) * 6.1, 0.0, 255.0)
    alpha[green_advantage >= 42.0] = 0.0

    edge = (alpha > 0) & key_candidate
    clean_green = np.maximum(red, blue) * 0.94
    rgba[..., 1][edge] = np.minimum(green[edge], clean_green[edge])
    rgba[..., 3] = alpha
    rgba[alpha == 0, :3] = 0
    return Image.fromarray(np.clip(rgba, 0, 255).astype(np.uint8), "RGBA")


def contiguous_runs(values: np.ndarray, merge_gap: int = 0) -> list[tuple[int, int]]:
    runs: list[tuple[int, int]] = []
    start = None
    for index, active in enumerate([*values.tolist(), False]):
        if active and start is None:
            start = index
        elif not active and start is not None:
            if runs and start - runs[-1][1] <= merge_gap:
                runs[-1] = (runs[-1][0], index)
            else:
                runs.append((start, index))
            start = None
    return runs


def detect_regions(source: Image.Image) -> list[tuple[int, int, int, int]]:
    rgb = np.asarray(source.convert("RGB"), dtype=np.int16)
    red, green, blue = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    foreground = (green < 100) | (green - np.maximum(red, blue) < 60)
    row_runs = contiguous_runs(foreground.sum(axis=1) > 20)
    if len(row_runs) != ROWS:
        raise ValueError(f"expected {ROWS} foreground rows, found {len(row_runs)}: {row_runs}")

    regions: list[tuple[int, int, int, int]] = []
    for top, bottom in row_runs:
        column_runs = contiguous_runs(foreground[top:bottom].sum(axis=0) > 3, merge_gap=4)
        if len(column_runs) != COLUMNS:
            raise ValueError(f"expected {COLUMNS} frames in row {top}:{bottom}, found {len(column_runs)}: {column_runs}")
        for left, right in column_runs:
            regions.append((max(0, left - 7), max(0, top - 7), min(source.width, right + 7), min(source.height, bottom + 7)))
    return regions


def extract_frame(source: Image.Image, region: tuple[int, int, int, int]) -> Image.Image:
    left, top, right, bottom = region
    keyed = chroma_to_alpha(source.crop((left, top, right, bottom)))
    alpha = keyed.getchannel("A")
    bbox = alpha.point(lambda value: 255 if value >= 10 else 0).getbbox()
    if bbox is None:
        raise ValueError(f"frame {index} contains no foreground")
    foreground = keyed.crop(bbox)

    scale = min(174 / foreground.width, 190 / foreground.height)
    target_size = (
        max(1, round(foreground.width * scale)),
        max(1, round(foreground.height * scale)),
    )
    foreground = foreground.resize(target_size, Image.Resampling.LANCZOS)
    frame = Image.new("RGBA", (CELL_WIDTH, CELL_HEIGHT), (0, 0, 0, 0))
    x = (CELL_WIDTH - foreground.width) // 2
    y = 202 - foreground.height
    frame.alpha_composite(foreground, (x, y))
    pixels = np.asarray(frame, dtype=np.uint8).copy()
    red, green, blue, alpha = [pixels[..., index] for index in range(4)]
    weak_alpha = alpha < 8
    green_advantage = green.astype(np.int16) - np.maximum(red, blue).astype(np.int16)
    hard_spill = (alpha > 0) & (green_advantage > 38)
    soft_spill = (alpha > 0) & (green > red * 1.16) & (green > blue * 1.16)
    pixels[..., 3][hard_spill | weak_alpha] = 0
    clean_green = (np.maximum(red, blue).astype(np.float32) * 0.96).astype(np.uint8)
    pixels[..., 1][soft_spill & ~hard_spill] = clean_green[soft_spill & ~hard_spill]
    pixels[pixels[..., 3] == 0, :3] = 0
    return Image.fromarray(pixels, "RGBA")


def make_contact_sheet(atlas: Image.Image) -> Image.Image:
    sheet = Image.new("RGBA", atlas.size, (236, 239, 236, 255))
    tile = 12
    draw = ImageDraw.Draw(sheet)
    for y in range(0, sheet.height, tile):
        for x in range(0, sheet.width, tile):
            if (x // tile + y // tile) % 2:
                draw.rectangle((x, y, x + tile - 1, y + tile - 1), fill=(217, 222, 218, 255))
    sheet.alpha_composite(atlas)
    draw = ImageDraw.Draw(sheet)
    font = ImageFont.load_default()
    for index in range(FRAME_COUNT):
        x = (index % COLUMNS) * CELL_WIDTH
        y = (index // COLUMNS) * CELL_HEIGHT
        label = f"{index:02d}  {index * 11.25:06.2f} deg"
        draw.rectangle((x + 3, y + 3, x + 94, y + 16), fill=(255, 255, 255, 224))
        draw.text((x + 6, y + 5), label, fill=(31, 37, 33, 255), font=font)
    return sheet


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--contact-sheet", type=Path, required=True)
    parser.add_argument("--report", type=Path, required=True)
    args = parser.parse_args()

    source = Image.open(args.source).convert("RGB")
    regions = detect_regions(source)
    atlas = Image.new("RGBA", (CELL_WIDTH * COLUMNS, CELL_HEIGHT * ROWS), (0, 0, 0, 0))
    frames = []
    for index in range(FRAME_COUNT):
        frame = extract_frame(source, regions[index])
        atlas.alpha_composite(frame, ((index % COLUMNS) * CELL_WIDTH, (index // COLUMNS) * CELL_HEIGHT))
        alpha = np.asarray(frame.getchannel("A"))
        frames.append({
            "index": index,
            "degrees": index * 11.25,
            "opaque_pixels": int(np.count_nonzero(alpha >= 250)),
            "visible_pixels": int(np.count_nonzero(alpha > 0)),
        })

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.contact_sheet.parent.mkdir(parents=True, exist_ok=True)
    args.report.parent.mkdir(parents=True, exist_ok=True)
    atlas.save(args.output, "WEBP", lossless=True, quality=100, method=6)
    make_contact_sheet(atlas).save(args.contact_sheet, "PNG")

    rgba = np.asarray(atlas)
    alpha = rgba[..., 3]
    visible = alpha > 0
    green_residue = visible & (rgba[..., 1] > rgba[..., 0] * 1.16) & (rgba[..., 1] > rgba[..., 2] * 1.16)
    report = {
        "ok": bool(all(frame["visible_pixels"] > 5000 for frame in frames) and not np.any(green_residue)),
        "source": str(args.source),
        "output": str(args.output),
        "dimensions": [atlas.width, atlas.height],
        "grid": [COLUMNS, ROWS],
        "cell": [CELL_WIDTH, CELL_HEIGHT],
        "frame_count": FRAME_COUNT,
        "source_regions": regions,
        "green_residue_pixels": int(np.count_nonzero(green_residue)),
        "frames": frames,
    }
    args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    if not report["ok"]:
        raise SystemExit("gaze atlas validation failed")
    print(json.dumps({key: report[key] for key in ("ok", "dimensions", "frame_count", "green_residue_pixels")}))


if __name__ == "__main__":
    main()
