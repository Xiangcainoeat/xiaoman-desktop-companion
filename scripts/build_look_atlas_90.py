#!/usr/bin/env python3
"""Build a deterministic 90-direction RGBA/WebP look atlas."""

from __future__ import annotations

import argparse
import hashlib
import json
from collections.abc import Sequence
from pathlib import Path

import numpy as np
from PIL import Image

from build_idle_atlas_30 import (
    ALPHA_OPAQUE,
    ALPHA_VISIBLE,
    EDGE_CONTAMINATION_LIMIT,
    RED_PINK_EDGE_CONTAMINATION_LIMIT,
    _boundary_mask,
    chroma_to_alpha,
    despill_edges,
    edge_contamination_count,
    red_pink_edge_contamination_count,
)


COLUMNS = 10
ROWS = 9
FRAME_COUNT = COLUMNS * ROWS
STEP_DEGREES = 4
FRAME_WIDTH = 192
FRAME_HEIGHT = 208
MAX_SUBJECT_WIDTH_RATIO = 174 / FRAME_WIDTH
MAX_SUBJECT_HEIGHT_RATIO = 190 / FRAME_HEIGHT
BASELINE_RATIO = 202 / FRAME_HEIGHT
ALGORITHM_ID = "look-atlas-90-v1-shared-registration"
DESPILL_ALGORITHM_ID = "build_idle_atlas_30.despill_edges"
LOOK_EDGE_CLEANUP_RADIUS = 4
PROVENANCE_CHOICES = ("generated", "anchor-interpolated", "mixed", "unspecified")


def _positive_integer(value: str) -> int:
    parsed = int(value)
    if parsed <= 0:
        raise argparse.ArgumentTypeError("must be greater than zero")
    return parsed


def _clear_hidden_rgb(image: Image.Image) -> Image.Image:
    pixels = np.asarray(image.convert("RGBA"), dtype=np.uint8).copy()
    pixels[pixels[..., 3] == 0, :3] = 0
    return Image.fromarray(pixels, "RGBA")


def despill_look_edges(image: Image.Image) -> Image.Image:
    """Clean low-alpha colored pixels introduced by resizing look frames."""
    pixels = np.asarray(image.convert("RGBA"), dtype=np.int16).copy()
    red, green, blue, alpha = [pixels[..., index] for index in range(4)]
    boundary = _boundary_mask(alpha)
    suspicious = boundary & (alpha < ALPHA_OPAQUE) & (
        (green - np.maximum(red, blue) > 8)
        | ((red - green > 14) & (blue - green > 6))
    )

    for y, x in zip(*np.where(suspicious)):
        current_alpha = int(alpha[y, x])
        candidates: list[tuple[int, int, np.ndarray]] = []
        for dy in range(-LOOK_EDGE_CLEANUP_RADIUS, LOOK_EDGE_CLEANUP_RADIUS + 1):
            for dx in range(-LOOK_EDGE_CLEANUP_RADIUS, LOOK_EDGE_CLEANUP_RADIUS + 1):
                if dx == 0 and dy == 0:
                    continue
                source_y, source_x = y + dy, x + dx
                if not (0 <= source_y < alpha.shape[0] and 0 <= source_x < alpha.shape[1]):
                    continue
                source_alpha = int(alpha[source_y, source_x])
                if source_alpha >= max(ALPHA_VISIBLE, current_alpha):
                    candidates.append((abs(dx) + abs(dy), source_alpha, pixels[source_y, source_x, :3]))
        if candidates:
            nearest_distance = min(candidate[0] for candidate in candidates)
            nearest = [candidate[2] for candidate in candidates if candidate[0] <= nearest_distance + 1]
            interior = np.median(np.stack(nearest), axis=0)
            pixels[y, x, :3] = np.rint(pixels[y, x, :3] * 0.15 + interior * 0.85)

    pixels[alpha < ALPHA_VISIBLE, :3] = 0
    pixels[alpha < ALPHA_VISIBLE, 3] = 0
    return Image.fromarray(np.clip(pixels, 0, 255).astype(np.uint8), "RGBA")


def _foreground_bbox(frame: Image.Image, frame_index: int) -> tuple[int, int, int, int]:
    alpha = frame.getchannel("A")
    bbox = alpha.point(lambda value: 255 if value >= ALPHA_VISIBLE else 0).getbbox()
    if bbox is None:
        raise ValueError(f"input frame {frame_index} contains no visible foreground")
    left, top, right, bottom = bbox
    margin_x = max(1, round(frame.width * 0.018))
    margin_y = max(1, round(frame.height * 0.018))
    return (
        max(0, left - margin_x),
        max(0, top - margin_y),
        min(frame.width, right + margin_x),
        min(frame.height, bottom + margin_y),
    )


def prepare_source_frame(
    image: Image.Image,
    frame_index: int,
) -> tuple[Image.Image, dict[str, int]]:
    """Create a keyed, hidden-RGB-free frame and apply the shared edge despill."""
    rgba = image.convert("RGBA")
    source_alpha = np.asarray(rgba.getchannel("A"), dtype=np.uint8)
    if np.all(source_alpha == 255):
        keyed, matte_stats = chroma_to_alpha(rgba, return_stats=True)
        keyed_alpha = np.asarray(keyed.getchannel("A"), dtype=np.uint8)
        if not np.any(keyed_alpha < ALPHA_VISIBLE):
            raise ValueError(
                f"input frame {frame_index} has no transparency and no removable green matte"
            )
    else:
        keyed = _clear_hidden_rgb(rgba)
        matte_stats = {
            "backgroundPixelsRemoved": 0,
            "backgroundHolePixelsRemoved": 0,
        }

    cleaned = _clear_hidden_rgb(despill_look_edges(despill_edges(keyed)))
    _foreground_bbox(cleaned, frame_index)
    return cleaned, matte_stats


def normalize_frames(
    source_frames: Sequence[Image.Image],
    frame_width: int = FRAME_WIDTH,
    frame_height: int = FRAME_HEIGHT,
) -> tuple[list[Image.Image], dict[str, object], dict[str, int]]:
    """Normalize all directions with one scale and a shared center/baseline anchor."""
    if len(source_frames) != FRAME_COUNT:
        raise ValueError(f"expected {FRAME_COUNT} source frames, got {len(source_frames)}")

    prepared_frames: list[Image.Image] = []
    bounds: list[tuple[int, int, int, int]] = []
    matte_reports: list[dict[str, int]] = []
    for index, source in enumerate(source_frames):
        prepared, matte_report = prepare_source_frame(source, index)
        prepared_frames.append(prepared)
        bounds.append(_foreground_bbox(prepared, index))
        matte_reports.append(matte_report)

    cropped_sizes = [
        (right - left, bottom - top)
        for left, top, right, bottom in bounds
    ]
    maximum_source_width = max(width for width, _ in cropped_sizes)
    maximum_source_height = max(height for _, height in cropped_sizes)
    target_width = max(1, round(frame_width * MAX_SUBJECT_WIDTH_RATIO))
    target_height = max(1, round(frame_height * MAX_SUBJECT_HEIGHT_RATIO))
    scale = min(
        target_width / maximum_source_width,
        target_height / maximum_source_height,
    )
    baseline = min(frame_height, max(1, round(frame_height * BASELINE_RATIO)))

    normalized: list[Image.Image] = []
    for prepared, bbox in zip(prepared_frames, bounds):
        foreground = prepared.crop(bbox)
        resized_size = (
            max(1, round(foreground.width * scale)),
            max(1, round(foreground.height * scale)),
        )
        foreground = foreground.resize(resized_size, Image.Resampling.LANCZOS)
        frame = Image.new("RGBA", (frame_width, frame_height), (0, 0, 0, 0))
        x = (frame_width - foreground.width) // 2
        y = baseline - foreground.height
        frame.alpha_composite(foreground, (x, y))
        normalized.append(_clear_hidden_rgb(despill_look_edges(despill_edges(frame))))

    registration: dict[str, object] = {
        "algorithm": "shared-scale-centered-baseline",
        "sharedScale": True,
        "scale": round(float(scale), 8),
        "targetSubjectSize": [target_width, target_height],
        "maximumSourceSubjectSize": [maximum_source_width, maximum_source_height],
        "baseline": baseline,
    }
    matte_summary = {
        "backgroundPixelsRemoved": sum(
            report["backgroundPixelsRemoved"] for report in matte_reports
        ),
        "backgroundHolePixelsRemoved": sum(
            report["backgroundHolePixelsRemoved"] for report in matte_reports
        ),
    }
    return normalized, registration, matte_summary


def frame_report(frame: Image.Image, index: int) -> dict[str, int]:
    pixels = np.asarray(frame.convert("RGBA"), dtype=np.uint8)
    alpha = pixels[..., 3]
    hidden_rgb = (alpha == 0) & np.any(pixels[..., :3] != 0, axis=2)
    return {
        "index": index,
        "degrees": index * STEP_DEGREES,
        "visiblePixels": int(np.count_nonzero(alpha >= ALPHA_VISIBLE)),
        "transparentPixels": int(np.count_nonzero(alpha == 0)),
        "translucentPixels": int(np.count_nonzero((alpha > 0) & (alpha < ALPHA_OPAQUE))),
        "opaquePixels": int(np.count_nonzero(alpha >= ALPHA_OPAQUE)),
        "hiddenRgbPixels": int(np.count_nonzero(hidden_rgb)),
        "contaminatedEdgePixels": edge_contamination_count(frame),
        "redPinkEdgePixels": red_pink_edge_contamination_count(frame),
    }


def summarize_frames(
    frames: Sequence[Image.Image],
) -> tuple[dict[str, int], dict[str, int | str], list[dict[str, int]]]:
    reports = [frame_report(frame, index) for index, frame in enumerate(frames)]
    alpha_summary = {
        "visiblePixels": sum(report["visiblePixels"] for report in reports),
        "transparentPixels": sum(report["transparentPixels"] for report in reports),
        "translucentPixels": sum(report["translucentPixels"] for report in reports),
        "opaquePixels": sum(report["opaquePixels"] for report in reports),
        "hiddenRgbPixels": sum(report["hiddenRgbPixels"] for report in reports),
        "emptyFrames": sum(report["visiblePixels"] == 0 for report in reports),
        "fullyOpaqueFrames": sum(report["transparentPixels"] == 0 for report in reports),
        "minVisiblePixelsPerFrame": min(
            (report["visiblePixels"] for report in reports),
            default=0,
        ),
        "maxVisiblePixelsPerFrame": max(
            (report["visiblePixels"] for report in reports),
            default=0,
        ),
    }
    chroma_summary: dict[str, int | str] = {
        "algorithm": DESPILL_ALGORITHM_ID,
        "contaminatedEdgePixels": sum(
            report["contaminatedEdgePixels"] for report in reports
        ),
        "maxContaminatedEdgePixelsPerFrame": max(
            (report["contaminatedEdgePixels"] for report in reports),
            default=0,
        ),
        "redPinkEdgePixels": sum(report["redPinkEdgePixels"] for report in reports),
        "maxRedPinkEdgePixelsPerFrame": max(
            (report["redPinkEdgePixels"] for report in reports),
            default=0,
        ),
        "edgeContaminationLimitPerFrame": EDGE_CONTAMINATION_LIMIT,
        "redPinkEdgeLimitPerFrame": RED_PINK_EDGE_CONTAMINATION_LIMIT,
    }
    return alpha_summary, chroma_summary, reports


def atlas_frames(
    atlas: Image.Image,
    frame_width: int,
    frame_height: int,
) -> list[Image.Image]:
    return [
        atlas.crop(
            (
                (index % COLUMNS) * frame_width,
                (index // COLUMNS) * frame_height,
                (index % COLUMNS + 1) * frame_width,
                (index // COLUMNS + 1) * frame_height,
            )
        )
        for index in range(FRAME_COUNT)
    ]


def rgba_sha256(image: Image.Image) -> str:
    return hashlib.sha256(image.convert("RGBA").tobytes()).hexdigest()


def build_atlas(
    source_frames: Sequence[Image.Image],
    *,
    frame_width: int = FRAME_WIDTH,
    frame_height: int = FRAME_HEIGHT,
    source_mode: str,
    source_image_count: int,
    provenance: str = "unspecified",
) -> tuple[Image.Image, dict[str, object]]:
    normalized, registration, matte_summary = normalize_frames(
        source_frames,
        frame_width,
        frame_height,
    )
    atlas = Image.new(
        "RGBA",
        (frame_width * COLUMNS, frame_height * ROWS),
        (0, 0, 0, 0),
    )
    for index, frame in enumerate(normalized):
        atlas.alpha_composite(
            frame,
            ((index % COLUMNS) * frame_width, (index // COLUMNS) * frame_height),
        )

    alpha_summary, chroma_summary, frame_reports = summarize_frames(normalized)
    ok = (
        len(frame_reports) == FRAME_COUNT
        and alpha_summary["emptyFrames"] == 0
        and alpha_summary["fullyOpaqueFrames"] == 0
        and alpha_summary["hiddenRgbPixels"] == 0
        and chroma_summary["maxContaminatedEdgePixelsPerFrame"]
        <= EDGE_CONTAMINATION_LIMIT
        and chroma_summary["maxRedPinkEdgePixelsPerFrame"]
        <= RED_PINK_EDGE_CONTAMINATION_LIMIT
    )
    metadata: dict[str, object] = {
        "ok": bool(ok),
        "algorithm": ALGORITHM_ID,
        "format": "RGBA/WebP",
        "frameCount": FRAME_COUNT,
        "columns": COLUMNS,
        "rows": ROWS,
        "stepDegrees": STEP_DEGREES,
        "frameWidth": frame_width,
        "frameHeight": frame_height,
        "cell": [frame_width, frame_height],
        "dimensions": [atlas.width, atlas.height],
        "provenance": provenance,
        "source": {
            "mode": source_mode,
            "imageCount": source_image_count,
        },
        "registration": registration,
        "matteSummary": matte_summary,
        "alphaSummary": alpha_summary,
        "chromaSummary": chroma_summary,
        "rgbaSha256": rgba_sha256(atlas),
        "frames": frame_reports,
    }
    return atlas, metadata


def _open_image(path: Path) -> Image.Image:
    if not path.is_file():
        raise FileNotFoundError(f"input image does not exist: {path}")
    with Image.open(path) as image:
        return image.convert("RGBA")


def load_input_frames(
    frame_paths: Sequence[Path],
    strip_paths: Sequence[Path],
) -> tuple[list[Image.Image], str, int]:
    if frame_paths:
        return [_open_image(path) for path in frame_paths], "frames", len(frame_paths)

    frames: list[Image.Image] = []
    for strip_index, path in enumerate(strip_paths):
        strip = _open_image(path)
        if strip.width % COLUMNS != 0:
            raise ValueError(
                f"strip {strip_index} ({path}) width {strip.width} is not divisible by {COLUMNS}"
            )
        source_frame_width = strip.width // COLUMNS
        if source_frame_width <= 0 or strip.height <= 0:
            raise ValueError(f"strip {strip_index} ({path}) has invalid dimensions {strip.size}")
        for column in range(COLUMNS):
            frames.append(
                strip.crop(
                    (
                        column * source_frame_width,
                        0,
                        (column + 1) * source_frame_width,
                        strip.height,
                    )
                )
            )
    return frames, "strips", len(strip_paths)


def _same_path(first: Path, second: Path) -> bool:
    return first.expanduser().resolve() == second.expanduser().resolve()


def write_outputs(atlas: Image.Image, metadata: dict[str, object], output: Path, metadata_path: Path) -> None:
    if output.suffix.lower() != ".webp":
        raise ValueError(f"atlas output must use a .webp extension: {output}")
    if metadata_path.suffix.lower() != ".json":
        raise ValueError(f"metadata output must use a .json extension: {metadata_path}")
    if _same_path(output, metadata_path):
        raise ValueError("atlas and metadata outputs must be different paths")

    output.parent.mkdir(parents=True, exist_ok=True)
    metadata_path.parent.mkdir(parents=True, exist_ok=True)
    atlas.save(output, "WEBP", lossless=True, quality=100, method=6, exact=True)
    metadata_path.write_text(
        json.dumps(metadata, ensure_ascii=True, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


def main() -> None:
    parser = argparse.ArgumentParser(
        description=(
            "Build a 10x9 look atlas from either 90 ordered frame files or "
            "9 ordered horizontal strips containing 10 equal cells each."
        )
    )
    inputs = parser.add_mutually_exclusive_group(required=True)
    inputs.add_argument(
        "--frame",
        action="append",
        type=Path,
        default=[],
        help="ordered standalone frame path; repeat exactly 90 times",
    )
    inputs.add_argument(
        "--strip",
        action="append",
        type=Path,
        default=[],
        help="ordered horizontal 10-cell strip path; repeat exactly 9 times",
    )
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--metadata", type=Path, required=True)
    parser.add_argument("--frame-width", type=_positive_integer, default=FRAME_WIDTH)
    parser.add_argument("--frame-height", type=_positive_integer, default=FRAME_HEIGHT)
    parser.add_argument(
        "--provenance",
        choices=PROVENANCE_CHOICES,
        default="unspecified",
        help="record whether directions were generated or deterministically interpolated",
    )
    args = parser.parse_args()

    if args.frame and len(args.frame) != FRAME_COUNT:
        parser.error(f"expected exactly {FRAME_COUNT} --frame paths, got {len(args.frame)}")
    if args.strip and len(args.strip) != ROWS:
        parser.error(f"expected exactly {ROWS} --strip paths, got {len(args.strip)}")

    input_paths = [*args.frame, *args.strip]
    if any(_same_path(path, args.output) for path in input_paths):
        parser.error("atlas output must not overwrite an input image")
    if any(_same_path(path, args.metadata) for path in input_paths):
        parser.error("metadata output must not overwrite an input image")

    try:
        source_frames, source_mode, source_image_count = load_input_frames(
            args.frame,
            args.strip,
        )
        atlas, metadata = build_atlas(
            source_frames,
            frame_width=args.frame_width,
            frame_height=args.frame_height,
            source_mode=source_mode,
            source_image_count=source_image_count,
            provenance=args.provenance,
        )
        write_outputs(atlas, metadata, args.output, args.metadata)
    except (FileNotFoundError, OSError, ValueError) as error:
        raise SystemExit(f"look atlas build failed: {error}") from error

    print(
        json.dumps(
            {
                "ok": metadata["ok"],
                "dimensions": metadata["dimensions"],
                "frameCount": metadata["frameCount"],
                "columns": metadata["columns"],
                "rows": metadata["rows"],
                "stepDegrees": metadata["stepDegrees"],
            },
            ensure_ascii=True,
        )
    )
    if not metadata["ok"]:
        raise SystemExit("look atlas deterministic validation failed")


if __name__ == "__main__":
    main()
