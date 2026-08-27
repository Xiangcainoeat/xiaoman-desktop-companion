#!/usr/bin/env python3
"""Build Xiaoman's 30-frame sleeping and care atlases from contact sheets."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

from build_idle_atlas_30 import (
    CELL_HEIGHT,
    CELL_WIDTH,
    chroma_to_alpha,
    despill_edges,
    normalize_action_frames,
    validate_action_sequence,
)


COLUMNS = 10
ROWS = 3
FRAMES = 30
ATLAS_WIDTH = CELL_WIDTH * COLUMNS
ALPHA_VISIBLE = 10
GREEN_THRESHOLD = 120
GREEN_DOMINANCE = 35


def _runs(values: np.ndarray, merge_gap: int = 10) -> list[tuple[int, int]]:
    found: list[tuple[int, int]] = []
    start = None
    for index, active in enumerate([*values.tolist(), False]):
        if active and start is None:
            start = index
        elif not active and start is not None:
            if found and index - found[-1][1] <= merge_gap:
                found[-1] = (found[-1][0], index)
            else:
                found.append((start, index))
            start = None
    return found


def extract_source_frames(source: Image.Image) -> list[Image.Image]:
    """Extract all visible cells from a three-row matte sheet.

    Column count is inferred per row, allowing generators to return 8, 9, or
    10 columns without relying on nominal prompt dimensions.
    """
    rgb = np.asarray(source.convert("RGB"), dtype=np.int16)
    red, green, blue = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    foreground = (green < GREEN_THRESHOLD) | (green - np.maximum(red, blue) < GREEN_DOMINANCE)
    return [frame for row in _extract_source_rows(source) for frame in row]


def _extract_source_rows(source: Image.Image) -> list[list[Image.Image]]:
    """Return independently cropped subject images for each source row."""
    rgb = np.asarray(source.convert("RGB"), dtype=np.int16)
    red, green, blue = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    foreground = (green < GREEN_THRESHOLD) | (green - np.maximum(red, blue) < GREEN_DOMINANCE)
    source_rows: list[list[Image.Image]] = []
    for row in range(ROWS):
        top = round(source.height * row / ROWS)
        bottom = round(source.height * (row + 1) / ROWS)
        # A stricter activity threshold suppresses tiny matte artifacts and
        # leaves each complete cat/prop silhouette as its own interval.
        activity = foreground[top:bottom].sum(axis=0) > max(10, round((bottom - top) * 0.27))
        runs = _runs(activity, merge_gap=18)
        if len(runs) < 1:
            raise ValueError(f"source row {row} contains no detectable subjects")
        row_frames: list[Image.Image] = []
        for left, right in runs:
            margin_x = max(5, round((right - left) * 0.08))
            crop_left = max(0, left - margin_x)
            crop_right = min(source.width, right + margin_x)
            row_frames.append(source.crop((crop_left, top, crop_right, bottom)).convert("RGB"))
        source_rows.append(row_frames)
    return source_rows


def expand_to_frame_count(frames: list[Image.Image], count: int = FRAMES) -> list[Image.Image]:
    """Resample a source sequence by nearest temporal index, preserving poses."""
    if not frames:
        raise ValueError("cannot expand an empty source sequence")
    return [frames[min(len(frames) - 1, round(index * (len(frames) - 1) / max(1, count - 1)))] for index in range(count)]


def _atlas_frame(atlas: Image.Image, row: int, index: int) -> Image.Image:
    column = index % COLUMNS
    atlas_row = row + index // COLUMNS
    return atlas.crop((column * CELL_WIDTH, atlas_row * CELL_HEIGHT,
                       (column + 1) * CELL_WIDTH, (atlas_row + 1) * CELL_HEIGHT))


def _frame_report(frame: Image.Image, action: str, index: int) -> dict[str, int | str]:
    rgba = np.asarray(frame.convert("RGBA"), dtype=np.uint8)
    alpha = rgba[..., 3]
    hidden = (alpha == 0) & np.any(rgba[..., :3] != 0, axis=2)
    visible = int(np.count_nonzero(alpha >= ALPHA_VISIBLE))
    return {
        "action": action,
        "frame": index,
        "visiblePixels": visible,
        "hiddenRgbPixels": int(np.count_nonzero(hidden)),
        "edgeContaminationPixels": _edge_contamination(frame),
    }


def _edge_contamination(frame: Image.Image) -> int:
    rgba = np.asarray(frame.convert("RGBA"), dtype=np.int16)
    alpha = rgba[..., 3]
    visible = alpha >= ALPHA_VISIBLE
    boundary = visible & (
        ~np.roll(visible, 1, axis=0) | ~np.roll(visible, -1, axis=0)
        | ~np.roll(visible, 1, axis=1) | ~np.roll(visible, -1, axis=1)
    )
    boundary[[0, -1], :] = False
    boundary[:, [0, -1]] = False
    red, green, blue = rgba[..., 0], rgba[..., 1], rgba[..., 2]
    return int(np.count_nonzero(boundary & (green - np.maximum(red, blue) > 10)))


def _prepare_frames(source: Image.Image) -> list[Image.Image]:
    frames = expand_to_frame_count(extract_source_frames(source))
    normalized, _ = normalize_action_frames(frames)
    return [_trim_edge_fragments(_clean_green_boundary(frame)) for frame in normalized]


def _sequence_contract(frames: list[Image.Image]) -> dict[str, object]:
    pixels = np.concatenate([
        np.asarray(frame.convert("RGBA"))[..., :3][np.asarray(frame.getchannel("A")) >= 245]
        for frame in frames
    ], axis=0)
    reference = np.median(pixels, axis=0) if len(pixels) else (0, 0, 0)
    return validate_action_sequence(frames, reference, 8)


def _trim_edge_fragments(frame: Image.Image) -> Image.Image:
    """Drop narrow neighboring-cell fragments introduced by contact-sheet seams."""
    rgba = np.asarray(frame.convert("RGBA"), dtype=np.uint8).copy()
    visible = rgba[..., 3] >= ALPHA_VISIBLE
    height, width = visible.shape
    seen = np.zeros_like(visible)
    components: list[tuple[list[tuple[int, int]], int, int, int, int]] = []
    for y, x in zip(*np.where(visible & ~seen)):
        if seen[y, x]:
            continue
        stack = [(int(y), int(x))]
        seen[y, x] = True
        pixels: list[tuple[int, int]] = []
        min_x = max_x = int(x)
        min_y = max_y = int(y)
        while stack:
            cy, cx = stack.pop()
            pixels.append((cy, cx))
            min_x, max_x = min(min_x, cx), max(max_x, cx)
            min_y, max_y = min(min_y, cy), max(max_y, cy)
            for dy in (-1, 0, 1):
                for dx in (-1, 0, 1):
                    if not dx and not dy:
                        continue
                    ny, nx = cy + dy, cx + dx
                    if 0 <= ny < height and 0 <= nx < width and visible[ny, nx] and not seen[ny, nx]:
                        seen[ny, nx] = True
                        stack.append((ny, nx))
        components.append((pixels, min_x, max_x, min_y, max_y))
    largest = max((len(item[0]) for item in components), default=0)
    for pixels, min_x, max_x, _, _ in components:
        edge_touching = min_x <= 1 or max_x >= width - 2
        narrow = (max_x - min_x + 1) < 35 or len(pixels) < largest * 0.16
        if edge_touching and narrow:
            for y, x in pixels:
                rgba[y, x] = 0
    return Image.fromarray(rgba, "RGBA")


def _clean_green_boundary(frame: Image.Image) -> Image.Image:
    """Remove residual matte green from both translucent and opaque edges."""
    rgba = np.asarray(frame.convert("RGBA"), dtype=np.int16).copy()
    red, green, blue, alpha = [rgba[..., index] for index in range(4)]
    visible = alpha >= ALPHA_VISIBLE
    boundary = visible & (
        ~np.roll(visible, 1, axis=0) | ~np.roll(visible, -1, axis=0)
        | ~np.roll(visible, 1, axis=1) | ~np.roll(visible, -1, axis=1)
    )
    boundary[[0, -1], :] = False
    boundary[:, [0, -1]] = False
    dominance = green - np.maximum(red, blue)
    opaque_matte = visible & (green >= 45) & (dominance >= 18)
    alpha[opaque_matte] = 0
    edge_spill = boundary & (dominance > 5)
    green[edge_spill] = np.minimum(green[edge_spill], np.maximum(red[edge_spill], blue[edge_spill]) + 2)
    # The generated matte can remain as an opaque green cast inside a soft
    # shadow, so constrain every visible green-dominant pixel as a final pass.
    residual = visible & (green > np.maximum(red, blue))
    green[residual] = np.maximum(red[residual], blue[residual])
    rgba[..., 3] = alpha
    rgba[alpha < ALPHA_VISIBLE, :3] = 0
    rgba[alpha < ALPHA_VISIBLE, 3] = 0
    return Image.fromarray(np.clip(rgba, 0, 255).astype(np.uint8), "RGBA")


def _metadata_document(actions: dict[str, dict[str, object]], atlas: Image.Image, reports: list[dict[str, object]]) -> dict[str, object]:
    return {
        "algorithm": "xiaoman-care-atlas-30-v1-stable-registration",
        "format": "RGBA/WebP",
        "dimensions": [atlas.width, atlas.height],
        "columns": COLUMNS,
        "rows": atlas.height // CELL_HEIGHT,
        "frameCount": FRAMES,
        "frameWidth": CELL_WIDTH,
        "frameHeight": CELL_HEIGHT,
        "cell": [CELL_WIDTH, CELL_HEIGHT],
        "actions": actions,
        "frames": reports,
    }


def _write_metadata(path: Path, actions: dict[str, dict[str, object]], atlas: Image.Image, reports: list[dict[str, object]]) -> dict[str, object]:
    metadata = _metadata_document(actions, atlas, reports)
    path.write_text(json.dumps(metadata, ensure_ascii=True, indent=2) + "\n", encoding="utf-8")
    return metadata


def _contact_sheet(atlas: Image.Image, path: Path) -> None:
    background = Image.new("RGBA", atlas.size, (235, 238, 234, 255))
    draw = ImageDraw.Draw(background)
    tile = 24
    for y in range(0, atlas.height, tile):
        for x in range(0, atlas.width, tile):
            if (x // tile + y // tile) % 2:
                draw.rectangle((x, y, x + tile - 1, y + tile - 1), fill=(207, 213, 208, 255))
    background.alpha_composite(atlas)
    path.parent.mkdir(parents=True, exist_ok=True)
    background.save(path, "PNG")


def _assemble(frames: list[Image.Image], rows: int) -> tuple[Image.Image, list[dict[str, object]]]:
    atlas = Image.new("RGBA", (ATLAS_WIDTH, CELL_HEIGHT * rows), (0, 0, 0, 0))
    reports: list[dict[str, object]] = []
    for index, frame in enumerate(frames):
        atlas.alpha_composite(frame, ((index % COLUMNS) * CELL_WIDTH, (index // COLUMNS) * CELL_HEIGHT))
        reports.append(_frame_report(frame, "sleep" if rows == 3 else "bath", index))
    return atlas, reports


def build_assets(sleep_source: Path, care_source: Path, output_dir: Path) -> dict[str, object]:
    output_dir.mkdir(parents=True, exist_ok=True)
    with Image.open(sleep_source) as image:
        sleeping_frames = _prepare_frames(image)
    with Image.open(care_source) as image:
        care_rows = _extract_source_rows(image)
        if any(len(row) < 8 for row in care_rows):
            raise ValueError(f"care source rows need complete subjects, found {[len(row) for row in care_rows]}")
        bath_frames = expand_to_frame_count(care_rows[0])
        feed_frames = expand_to_frame_count(care_rows[1])
        gift_frames = expand_to_frame_count(care_rows[2])
        bath_frames, _ = normalize_action_frames(bath_frames)
        # The shared row is intentionally a stable care-feedback loop: feeding
        # leads into the gift reveal, then returns to feeding.
        care_frames, _ = normalize_action_frames(feed_frames[:15] + gift_frames[:15])
        bath_frames = [_trim_edge_fragments(_clean_green_boundary(frame)) for frame in bath_frames]
        care_frames = [_trim_edge_fragments(_clean_green_boundary(frame)) for frame in care_frames]

    sleep_atlas, sleep_reports = _assemble(sleeping_frames, 3)
    care_atlas, care_reports = _assemble(bath_frames + [Image.new("RGBA", (CELL_WIDTH, CELL_HEIGHT), (0, 0, 0, 0))] * 30, 6)
    # Put the actual shared care loop at row 3 while rows 1, 2, 4, and 5 remain
    # transparent atlas padding reserved by the contract.
    for index, frame in enumerate(care_frames):
        care_atlas.alpha_composite(frame, ((index % COLUMNS) * CELL_WIDTH, (3 + index // COLUMNS) * CELL_HEIGHT))
    care_reports = [_frame_report(frame, "bath", index) for index, frame in enumerate(bath_frames)] + [_frame_report(frame, "feed-gift", index) for index, frame in enumerate(care_frames)]
    bath_contract = _sequence_contract(bath_frames)
    care_contract = _sequence_contract(care_frames)
    sleep_contract = _sequence_contract(sleeping_frames)
    for entry in sleep_reports:
        entry["sequence"] = sleep_contract
    for entry in care_reports[:FRAMES]:
        entry["sequence"] = bath_contract
    for entry in care_reports[FRAMES:]:
        entry["sequence"] = care_contract

    sleep_path = output_dir / "sleeping-30.webp"
    care_path = output_dir / "care-actions-30.webp"
    sleep_atlas.save(sleep_path, "WEBP", lossless=True, quality=100, method=6, exact=True)
    care_atlas.save(care_path, "WEBP", lossless=True, quality=100, method=6, exact=True)
    qa_dir = output_dir.parent.parent / "work/xiaoman-care-assets"
    _contact_sheet(sleep_atlas, qa_dir / "sleeping-30-contact-sheet.png")
    _contact_sheet(care_atlas, qa_dir / "care-actions-30-contact-sheet.png")
    sleep_metadata = _write_metadata(output_dir / "sleeping-30.json", {"sleep": {"atlasFramePosition": {"row": 0, "frames": 30, "columns": 10}}}, sleep_atlas, sleep_reports)
    care_metadata = _write_metadata(output_dir / "care-actions-30.json", {
        "bath": {"atlasFramePosition": {"row": 0, "frames": 30, "columns": 10}},
        "feed": {"atlasFramePosition": {"row": 3, "frames": 30, "columns": 10}},
        "gift": {"atlasFramePosition": {"row": 3, "frames": 30, "columns": 10}},
    }, care_atlas, care_reports)
    # Validate the encoded outputs and emitted metadata through the same gate
    # used by the standalone verifier before reporting a successful build.
    from verify_care_atlas_30 import verify

    built_reports = (
        verify(Image.open(sleep_path).convert("RGBA"), sleep_metadata, "sleep"),
        verify(Image.open(care_path).convert("RGBA"), care_metadata, "care"),
    )
    failures = [report for report in built_reports if not report["ok"]]
    if failures:
        raise ValueError(f"built care atlas failed verification: {failures[0]['errors']}")
    return {"reports": {"sleeping-30": sleep_reports, "care-actions-30": care_reports}}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--sleep-source", type=Path, required=True)
    parser.add_argument("--care-source", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args()
    build_assets(args.sleep_source, args.care_source, args.output_dir)


if __name__ == "__main__":
    main()
