#!/usr/bin/env python3
"""Build and validate the host-only 30-frame Xiaoman idle-action atlas."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Iterable

import numpy as np
from PIL import Image, ImageDraw, ImageFont


CELL_WIDTH = 192
CELL_HEIGHT = 208
COLUMNS = 10
ROWS_PER_ACTION = 3
FRAMES_PER_ACTION = COLUMNS * ROWS_PER_ACTION
ACTION_ORDER = ("idle-lick", "idle-blink", "idle-scratch")
EDGE_CONTAMINATION_LIMIT = 4
RED_PINK_EDGE_CONTAMINATION_LIMIT = 4
COLOR_DRIFT_LIMIT = 22
ADJACENT_AREA_JUMP_LIMIT = 0.45
ALPHA_VISIBLE = 10
ALPHA_OPAQUE = 245
ALGORITHM_ID = "idle-atlas-30-v2-stable-registration"


def _shift(array: np.ndarray, dx: int, dy: int, fill: int | float = 0) -> np.ndarray:
    """Shift a 2D array without wrapping pixels around the opposite edge."""
    height, width = array.shape
    result = np.full_like(array, fill)
    source_x = max(0, -dx)
    source_y = max(0, -dy)
    target_x = max(0, dx)
    target_y = max(0, dy)
    copy_width = width - abs(dx)
    copy_height = height - abs(dy)
    if copy_width > 0 and copy_height > 0:
        result[target_y:target_y + copy_height, target_x:target_x + copy_width] = array[
            source_y:source_y + copy_height,
            source_x:source_x + copy_width,
        ]
    return result


def chroma_to_alpha(image: Image.Image) -> Image.Image:
    """Remove only the connected green matte and retain natural subject colors."""
    rgba = np.asarray(image.convert("RGBA"), dtype=np.float32).copy()
    red, green, blue = rgba[..., 0], rgba[..., 1], rgba[..., 2]
    green_dominance = green - np.maximum(red, blue)

    # The generated sheets use a bright green matte. A soft key preserves
    # antialiased fur while the later edge pass removes the matte hue.
    key_strength = np.clip((green_dominance - 10.0) / 42.0, 0.0, 1.0)
    key_strength *= np.clip((green - 70.0) / 130.0, 0.0, 1.0)
    # Start opaque. The key strength is applied only after flood-filling the
    # border-connected matte below, so enclosed subject colors survive.
    alpha = np.full(green.shape, 255.0, dtype=np.float32)

    # Green pixels in the matte can be slightly uneven. Flooding from the
    # border prevents a naturally colored interior pixel from being keyed.
    candidate = (green_dominance > 18.0) & (green > 80.0)
    reachable = np.zeros(candidate.shape, dtype=bool)
    frontier = np.zeros(candidate.shape, dtype=bool)
    frontier[0, :] = candidate[0, :]
    frontier[-1, :] |= candidate[-1, :]
    frontier[:, 0] |= candidate[:, 0]
    frontier[:, -1] |= candidate[:, -1]
    while np.any(frontier):
        frontier &= candidate & ~reachable
        if not np.any(frontier):
            break
        reachable |= frontier
        next_frontier = (
            _shift(frontier, 1, 0)
            | _shift(frontier, -1, 0)
            | _shift(frontier, 0, 1)
            | _shift(frontier, 0, -1)
        )
        frontier = next_frontier & candidate & ~reachable

    # Only the border-connected matte is keyed. An interior green pixel is
    # part of the subject unless it is connected to the outside background.
    alpha[reachable] = np.minimum(alpha[reachable], 255.0 * (1.0 - key_strength[reachable]))
    alpha[alpha < ALPHA_VISIBLE] = 0.0
    rgba[..., 3] = alpha
    rgba[alpha == 0, :3] = 0
    return Image.fromarray(np.clip(rgba, 0, 255).astype(np.uint8), "RGBA")


def _boundary_mask(alpha: np.ndarray) -> np.ndarray:
    visible = alpha >= ALPHA_VISIBLE
    near_transparent = np.zeros_like(visible)
    for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1), (2, 0), (-2, 0), (0, 2), (0, -2)):
        near_transparent |= _shift(~visible, dx, dy, False)
    return visible & near_transparent


def edge_contamination_count(frame: Image.Image) -> int:
    pixels = np.asarray(frame.convert("RGBA"), dtype=np.int16)
    red, green, blue, alpha = [pixels[..., index] for index in range(4)]
    boundary = _boundary_mask(alpha)
    green_spill = green - np.maximum(red, blue) > 10
    magenta_spill = (red - green > 18) & (blue - green > 8)
    return int(np.count_nonzero(boundary & (green_spill | magenta_spill)))


def red_pink_edge_contamination_count(frame: Image.Image) -> int:
    pixels = np.asarray(frame.convert("RGBA"), dtype=np.int16)
    red, green, blue, alpha = [pixels[..., index] for index in range(4)]
    boundary = _boundary_mask(alpha)
    # Opaque warm fur and the tongue are valid. Restrict this check to
    # antialiased edge pixels where a matte can introduce a pink fringe.
    red_pink = (alpha < ALPHA_OPAQUE) & (red - green > 18) & (blue - green > 8)
    return int(np.count_nonzero(boundary & red_pink))


def despill_edges(frame: Image.Image) -> Image.Image:
    """Despill only the two-pixel visible boundary using nearby interior colors."""
    pixels = np.asarray(frame.convert("RGBA"), dtype=np.int16).copy()
    red, green, blue, alpha = [pixels[..., index] for index in range(4)]
    boundary = _boundary_mask(alpha)
    suspicious = boundary & (alpha < ALPHA_OPAQUE) & (
        (green - np.maximum(red, blue) > 8)
        | ((red - green > 14) & (blue - green > 6))
        | ((red - green > 18) & (blue - green > 8))
    )

    interior = alpha >= ALPHA_OPAQUE
    samples = []
    for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1), (2, 0), (-2, 0), (0, 2), (0, -2)):
        samples.append((_shift(interior, dx, dy, False), dx, dy))

    for y, x in zip(*np.where(suspicious)):
        candidate_colors: list[np.ndarray] = []
        for mask, dx, dy in samples:
            source_y = y - dy
            source_x = x - dx
            if 0 <= source_y < alpha.shape[0] and 0 <= source_x < alpha.shape[1] and mask[y, x]:
                candidate_colors.append(pixels[source_y, source_x, :3])
        if not candidate_colors:
            continue
        interior_color = np.median(np.stack(candidate_colors), axis=0)
        # Preserve the subject edge but replace the matte-colored component.
        pixels[y, x, :3] = np.rint(pixels[y, x, :3] * 0.18 + interior_color * 0.82)

    # A second conservative pass removes residual green from the same edge
    # without touching the tongue or any opaque interior feature.
    red, green, blue = [pixels[..., index] for index in range(3)]
    green_edge = boundary & (green - np.maximum(red, blue) > 6)
    green_target = np.maximum(red, blue)
    pixels[..., 1][green_edge] = np.minimum(green[green_edge], green_target[green_edge] + 2)
    pixels[alpha < ALPHA_VISIBLE, :3] = 0
    pixels[alpha < ALPHA_VISIBLE, 3] = 0
    return Image.fromarray(np.clip(pixels, 0, 255).astype(np.uint8), "RGBA")


def _contiguous_runs(values: np.ndarray, merge_gap: int = 0) -> list[tuple[int, int]]:
    runs: list[tuple[int, int]] = []
    start: int | None = None
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


def split_source(source: Image.Image) -> list[Image.Image]:
    """Find each generated subject before cropping so uneven spacing cannot split it."""
    rgb = np.asarray(source.convert("RGB"), dtype=np.int16)
    red, green, blue = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    foreground = (green < 120) | (green - np.maximum(red, blue) < 40)
    frames: list[Image.Image] = []
    for row in range(ROWS_PER_ACTION):
        top = round(source.height * row / ROWS_PER_ACTION)
        bottom = round(source.height * (row + 1) / ROWS_PER_ACTION)
        column_activity = foreground[top:bottom].sum(axis=0) > 5
        runs = _contiguous_runs(column_activity, merge_gap=10)
        if len(runs) != COLUMNS:
            raise ValueError(
                f"expected {COLUMNS} detected subjects in row {row}, found {len(runs)}: {runs}"
            )
        boundaries = [0]
        for previous, current in zip(runs, runs[1:]):
            boundaries.append((previous[1] + current[0]) // 2)
        boundaries.append(source.width)
        for column, (left, right) in enumerate(zip(boundaries, boundaries[1:])):
            # The midpoint boundaries include the full subject and enough matte
            # for antialiased edges; normalize_frame removes the remaining matte.
            frames.append(source.crop((left, top, right, bottom)))
    return frames


def _foreground_bbox(frame: Image.Image) -> tuple[int, int, int, int]:
    alpha = frame.getchannel("A")
    bbox = alpha.point(lambda value: 255 if value >= ALPHA_VISIBLE else 0).getbbox()
    if bbox is None:
        raise ValueError("frame contains no foreground")
    left, top, right, bottom = bbox
    margin_x = max(2, round(frame.width * 0.018))
    margin_y = max(2, round(frame.height * 0.018))
    return (
        max(0, left - margin_x),
        max(0, top - margin_y),
        min(frame.width, right + margin_x),
        min(frame.height, bottom + margin_y),
    )


def _union_bounds(bounds: Iterable[tuple[int, int, int, int]]) -> tuple[int, int, int, int]:
    values = list(bounds)
    if not values:
        raise ValueError("no foreground bounds")
    return (
        min(item[0] for item in values),
        min(item[1] for item in values),
        max(item[2] for item in values),
        max(item[3] for item in values),
    )


def normalize_action_frames(source_frames: list[Image.Image]) -> tuple[list[Image.Image], dict[str, object]]:
    """Normalize an action with one shared crop, scale, and registration anchor."""
    keyed_frames = [despill_edges(chroma_to_alpha(source)) for source in source_frames]
    frame_bounds = [_foreground_bbox(frame) for frame in keyed_frames]
    reference_bounds = _union_bounds(frame_bounds)
    reference_width = reference_bounds[2] - reference_bounds[0]
    reference_height = reference_bounds[3] - reference_bounds[1]
    scale = min(174 / reference_width, 190 / reference_height)
    target_size = (
        max(1, round(reference_width * scale)),
        max(1, round(reference_height * scale)),
    )
    normalized: list[Image.Image] = []
    for keyed in keyed_frames:
        cropped = keyed.crop(reference_bounds)
        foreground = cropped.resize(target_size, Image.Resampling.LANCZOS)
        frame = Image.new("RGBA", (CELL_WIDTH, CELL_HEIGHT), (0, 0, 0, 0))
        frame.alpha_composite(foreground, ((CELL_WIDTH - foreground.width) // 2, 202 - foreground.height))
        normalized.append(despill_edges(frame))
    return normalized, {
        "scale": round(scale, 6),
        "sharedScale": True,
        "referenceBounds": list(reference_bounds),
        "targetSize": list(target_size),
    }


def _visible_bbox(frame: Image.Image) -> tuple[int, int, int, int] | None:
    alpha = np.asarray(frame.convert("RGBA"), dtype=np.uint8)[..., 3]
    ys, xs = np.where(alpha >= ALPHA_VISIBLE)
    if len(xs) == 0:
        return None
    return int(xs.min()), int(ys.min()), int(xs.max() + 1), int(ys.max() + 1)


def _color_signature(frame: Image.Image) -> np.ndarray:
    pixels = np.asarray(frame.convert("RGBA"), dtype=np.uint8)
    subject = pixels[(pixels[..., 3] >= ALPHA_OPAQUE)]
    if len(subject) == 0:
        return np.zeros(3, dtype=np.float32)
    return np.median(subject[..., :3], axis=0).astype(np.float32)


def _continuity_metrics(frames: list[Image.Image], signatures: list[np.ndarray]) -> dict[str, object]:
    boxes = [_visible_bbox(frame) for frame in frames]
    areas = [max(1, (box[2] - box[0]) * (box[3] - box[1])) if box else 1 for box in boxes]
    centers = [((box[0] + box[2]) / 2, (box[1] + box[3]) / 2) if box else (0.0, 0.0) for box in boxes]
    bottoms = [box[3] if box else 0 for box in boxes]
    area_jumps = [abs(current - previous) / max(current, previous) for previous, current in zip(areas, areas[1:])]
    center_jumps = [
        ((current[0] - previous[0]) ** 2 + (current[1] - previous[1]) ** 2) ** 0.5
        for previous, current in zip(centers, centers[1:])
    ]
    bottom_jumps = [abs(current - previous) for previous, current in zip(bottoms, bottoms[1:])]
    reference_color = np.median(np.stack(signatures), axis=0)
    color_drifts = [float(np.max(np.abs(signature - reference_color))) for signature in signatures]
    return {
        "maxAdjacentAreaDeltaRatio": round(max(area_jumps, default=0.0), 4),
        "maxAdjacentCenterDelta": round(max(center_jumps, default=0.0), 4),
        "maxAdjacentBottomDelta": round(max(bottom_jumps, default=0.0), 4),
        "maxColorDrift": round(max(color_drifts, default=0.0), 4),
    }


def _frame_report(frame: Image.Image, action: str, index: int) -> dict[str, int | str]:
    pixels = np.asarray(frame.convert("RGBA"), dtype=np.uint8)
    alpha = pixels[..., 3]
    hidden_rgb = (alpha == 0) & np.any(pixels[..., :3] != 0, axis=2)
    return {
        "action": action,
        "frame": index,
        "visiblePixels": int(np.count_nonzero(alpha > 0)),
        "opaquePixels": int(np.count_nonzero(alpha >= ALPHA_OPAQUE)),
        "hiddenRgbPixels": int(np.count_nonzero(hidden_rgb)),
        "contaminatedEdgePixels": edge_contamination_count(frame),
        "redPinkEdgePixels": red_pink_edge_contamination_count(frame),
    }


def make_contact_sheet(atlas: Image.Image, labels: Iterable[str] = ACTION_ORDER) -> Image.Image:
    sheet = Image.new("RGBA", atlas.size, (237, 240, 237, 255))
    draw = ImageDraw.Draw(sheet)
    tile = 12
    for y in range(0, sheet.height, tile):
        for x in range(0, sheet.width, tile):
            if (x // tile + y // tile) % 2:
                draw.rectangle((x, y, x + tile - 1, y + tile - 1), fill=(216, 221, 217, 255))
    sheet.alpha_composite(atlas)
    font = ImageFont.load_default()
    for action_index, action in enumerate(labels):
        for index in range(FRAMES_PER_ACTION):
            row = action_index * ROWS_PER_ACTION + index // COLUMNS
            column = index % COLUMNS
            x = column * CELL_WIDTH
            y = row * CELL_HEIGHT
            draw.rectangle((x + 3, y + 3, x + 86, y + 17), fill=(255, 255, 255, 224))
            draw.text((x + 6, y + 5), f"{action} {index + 1}", fill=(31, 37, 33, 255), font=font)
    return sheet


def build_atlas(sources: dict[str, Path]) -> tuple[Image.Image, dict[str, object]]:
    atlas = Image.new("RGBA", (CELL_WIDTH * COLUMNS, CELL_HEIGHT * ROWS_PER_ACTION * len(ACTION_ORDER)), (0, 0, 0, 0))
    frame_reports: list[dict[str, int | str]] = []
    action_reports: dict[str, dict[str, object]] = {}

    for action_index, action in enumerate(ACTION_ORDER):
        source = Image.open(sources[action]).convert("RGB")
        source_frames = split_source(source)
        if len(source_frames) != FRAMES_PER_ACTION:
            raise ValueError(f"{action} must provide {FRAMES_PER_ACTION} source cells")
        normalized_frames, registration = normalize_action_frames(source_frames)
        action_frame_reports: list[dict[str, int | str]] = []
        signatures = [_color_signature(frame) for frame in normalized_frames]
        continuity = _continuity_metrics(normalized_frames, signatures)
        for index, frame in enumerate(normalized_frames):
            row = action_index * ROWS_PER_ACTION + index // COLUMNS
            column = index % COLUMNS
            atlas.alpha_composite(frame, (column * CELL_WIDTH, row * CELL_HEIGHT))
            report = _frame_report(frame, action, index)
            action_frame_reports.append(report)
            frame_reports.append(report)
        action_reports[action] = {
            "frames": len(action_frame_reports),
            "emptyFrames": sum(item["visiblePixels"] < 5000 for item in action_frame_reports),
            "hiddenRgbPixels": sum(item["hiddenRgbPixels"] for item in action_frame_reports),
            "contaminatedEdgePixels": max(item["contaminatedEdgePixels"] for item in action_frame_reports),
            "contaminatedEdgePixelTotal": sum(item["contaminatedEdgePixels"] for item in action_frame_reports),
            "redPinkEdgePixels": max(item["redPinkEdgePixels"] for item in action_frame_reports),
            "registration": {**registration, **{key: continuity[key] for key in (
                "maxAdjacentAreaDeltaRatio", "maxAdjacentCenterDelta", "maxAdjacentBottomDelta",
            )}},
            "maxColorDrift": continuity["maxColorDrift"],
        }

    report: dict[str, object] = {
        "ok": False,
        "algorithm": ALGORITHM_ID,
        "dimensions": [atlas.width, atlas.height],
        "columns": COLUMNS,
        "rows": ROWS_PER_ACTION * len(ACTION_ORDER),
        "cell": [CELL_WIDTH, CELL_HEIGHT],
        "actions": action_reports,
        "frames": frame_reports,
    }
    return atlas, report


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--lick", type=Path, required=True)
    parser.add_argument("--blink", type=Path, required=True)
    parser.add_argument("--scratch", type=Path, required=True)
    parser.add_argument("--output", type=Path, default=Path("public/pet/idle-actions-30.webp"))
    parser.add_argument("--contact-sheet", type=Path, default=Path("work/idle-actions-30-contact-sheet.png"))
    parser.add_argument("--report", type=Path, default=Path("work/idle-actions-30-report.json"))
    args = parser.parse_args()

    atlas, report = build_atlas({
        "idle-lick": args.lick,
        "idle-blink": args.blink,
        "idle-scratch": args.scratch,
    })
    action_reports = report["actions"]
    assert isinstance(action_reports, dict)
    def action_is_clean(summary: object) -> bool:
        if not isinstance(summary, dict):
            return False
        registration = summary.get("registration")
        return (
            summary.get("frames") == FRAMES_PER_ACTION
            and summary.get("emptyFrames") == 0
            and summary.get("hiddenRgbPixels") == 0
            and summary.get("contaminatedEdgePixels", EDGE_CONTAMINATION_LIMIT + 1) <= EDGE_CONTAMINATION_LIMIT
            and summary.get("redPinkEdgePixels", RED_PINK_EDGE_CONTAMINATION_LIMIT + 1) <= RED_PINK_EDGE_CONTAMINATION_LIMIT
            and summary.get("maxColorDrift", COLOR_DRIFT_LIMIT + 1) <= COLOR_DRIFT_LIMIT
            and isinstance(registration, dict)
            and registration.get("scale", 0) > 0
            and registration.get("sharedScale") is True
            and registration.get("maxAdjacentAreaDeltaRatio", ADJACENT_AREA_JUMP_LIMIT + 1) <= ADJACENT_AREA_JUMP_LIMIT
        )
    report["ok"] = all(
        action_is_clean(summary)
        for summary in action_reports.values()
    )

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.contact_sheet.parent.mkdir(parents=True, exist_ok=True)
    args.report.parent.mkdir(parents=True, exist_ok=True)
    atlas.save(args.output, "WEBP", lossless=True, quality=100, method=6, exact=True)
    make_contact_sheet(atlas).save(args.contact_sheet, "PNG")
    args.report.write_text(json.dumps(report, ensure_ascii=True, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({
        "ok": report["ok"],
        "dimensions": report["dimensions"],
        "columns": report["columns"],
        "rows": report["rows"],
        "actions": report["actions"],
    }, ensure_ascii=True))
    if not report["ok"]:
        raise SystemExit("idle action atlas validation failed")


if __name__ == "__main__":
    main()
