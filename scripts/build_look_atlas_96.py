#!/usr/bin/env python3
"""Build a 96-direction look atlas from independent source frames."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
from collections.abc import Sequence
from pathlib import Path

import numpy as np
from PIL import Image

from build_look_atlas_90 import (
    ALPHA_OPAQUE,
    ALPHA_VISIBLE,
    _clear_hidden_rgb,
    _foreground_bbox,
    despill_edges,
    despill_look_edges,
    prepare_source_frame,
)


COLUMNS = 12
ROWS = 8
FRAME_COUNT = COLUMNS * ROWS
STEP_DEGREES = 360 / FRAME_COUNT
FRAME_WIDTH = 192
FRAME_HEIGHT = 208
MAX_SUBJECT_WIDTH_RATIO = 174 / FRAME_WIDTH
MAX_SUBJECT_HEIGHT_RATIO = 190 / FRAME_HEIGHT
BASELINE_RATIO = 202 / FRAME_HEIGHT
MAX_MID_ALPHA_RATIO = 0.08
MAX_LIGHT_FUR_DISTANCE = 24.0
ALGORITHM_ID = "look-atlas-96-v1-independent-frames"


def _positive_integer(value: str) -> int:
    parsed = int(value)
    if parsed <= 0:
        raise argparse.ArgumentTypeError("must be greater than zero")
    return parsed


def _open_image(path: Path) -> Image.Image:
    if not path.is_file():
        raise FileNotFoundError(f"input image does not exist: {path}")
    with Image.open(path) as image:
        return image.convert("RGBA")


def _same_path(first: Path, second: Path) -> bool:
    return first.expanduser().resolve() == second.expanduser().resolve()


def rgba_sha256(image: Image.Image) -> str:
    return hashlib.sha256(image.convert("RGBA").tobytes()).hexdigest()


def normalize_frames(
    source_frames: Sequence[Image.Image],
    *,
    frame_width: int,
    frame_height: int,
) -> tuple[list[Image.Image], dict[str, object], dict[str, int]]:
    """Normalize independent frames using one scale and one baseline."""
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

    maximum_source_width = max(right - left for left, _, right, _ in bounds)
    maximum_source_height = max(bottom - top for _, top, _, bottom in bounds)
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
        size = (
            max(1, round(foreground.width * scale)),
            max(1, round(foreground.height * scale)),
        )
        foreground = foreground.resize(size, Image.Resampling.LANCZOS)
        frame = Image.new("RGBA", (frame_width, frame_height), (0, 0, 0, 0))
        frame.alpha_composite(
            foreground,
            ((frame_width - foreground.width) // 2, baseline - foreground.height),
        )
        normalized.append(
            _clear_hidden_rgb(despill_look_edges(despill_edges(frame)))
        )

    registration: dict[str, object] = {
        "algorithm": "shared-scale-centered-baseline",
        "sharedScale": True,
        "scale": round(float(scale), 8),
        "targetSubjectSize": [target_width, target_height],
        "maximumSourceSubjectSize": [
            maximum_source_width,
            maximum_source_height,
        ],
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


def _mid_alpha_ratio(frame: Image.Image) -> float:
    alpha = np.asarray(frame.convert("RGBA"), dtype=np.uint8)[..., 3]
    pixel_count = alpha.size
    if not np.any(alpha >= ALPHA_VISIBLE):
        return 1.0
    mid_alpha = int(np.count_nonzero((alpha >= 48) & (alpha <= 207)))
    return mid_alpha / pixel_count


def _light_fur_color(image: Image.Image) -> np.ndarray | None:
    pixels = np.asarray(image.convert("RGBA"), dtype=np.uint8)
    rgb = pixels[..., :3].astype(np.float32)
    alpha = pixels[..., 3]
    maximum = np.max(rgb, axis=2)
    minimum = np.min(rgb, axis=2)
    luminance = rgb[..., 0] * 0.2126 + rgb[..., 1] * 0.7152 + rgb[..., 2] * 0.0722
    mask = (
        (alpha >= ALPHA_OPAQUE)
        & (luminance >= 125)
        & ((maximum - minimum) <= 120)
        & (rgb[..., 0] >= rgb[..., 2] - 8)
    )
    samples = rgb[mask]
    if samples.size == 0:
        return None
    return np.median(samples, axis=0)


def summarize_alpha(frames: Sequence[Image.Image]) -> dict[str, object]:
    ratios = [_mid_alpha_ratio(frame) for frame in frames]
    empty_frames = 0
    hidden_rgb_pixels = 0
    for frame in frames:
        pixels = np.asarray(frame.convert("RGBA"), dtype=np.uint8)
        alpha = pixels[..., 3]
        empty_frames += int(not np.any(alpha >= ALPHA_VISIBLE))
        hidden_rgb_pixels += int(
            np.count_nonzero((alpha == 0) & np.any(pixels[..., :3] != 0, axis=2))
        )
    return {
        "maxMidAlphaRatio": round(max(ratios, default=1.0), 8),
        "meanMidAlphaRatio": round(float(np.mean(ratios)) if ratios else 1.0, 8),
        "emptyFrames": empty_frames,
        "hiddenRgbPixels": hidden_rgb_pixels,
    }


def summarize_color(
    frames: Sequence[Image.Image], reference: Image.Image
) -> dict[str, object]:
    reference_color = _light_fur_color(reference)
    if reference_color is None:
        raise ValueError("reference image contains no measurable light-fur pixels")

    distances: list[float] = []
    missing_frames: list[int] = []
    frame_colors: list[list[float] | None] = []
    for index, frame in enumerate(frames):
        color = _light_fur_color(frame)
        if color is None:
            missing_frames.append(index)
            frame_colors.append(None)
            distances.append(math.inf)
            continue
        frame_colors.append([round(float(channel), 3) for channel in color])
        distances.append(float(np.linalg.norm(color - reference_color)))

    finite_distances = [distance for distance in distances if math.isfinite(distance)]
    maximum = max(finite_distances, default=math.inf)
    return {
        "referenceLightFurRgb": [
            round(float(channel), 3) for channel in reference_color
        ],
        "maxLightFurDistance": round(maximum, 5),
        "meanLightFurDistance": round(
            float(np.mean(finite_distances)) if finite_distances else math.inf,
            5,
        ),
        "missingLightFurFrames": missing_frames,
        "frameLightFurRgb": frame_colors,
    }


def build_atlas(
    source_frames: Sequence[Image.Image],
    reference: Image.Image,
    *,
    frame_width: int = FRAME_WIDTH,
    frame_height: int = FRAME_HEIGHT,
) -> tuple[Image.Image, dict[str, object]]:
    normalized, registration, matte_summary = normalize_frames(
        source_frames,
        frame_width=frame_width,
        frame_height=frame_height,
    )
    prepared_reference, _ = prepare_source_frame(reference, -1)
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

    alpha_summary = summarize_alpha(normalized)
    color_summary = summarize_color(normalized, prepared_reference)
    metadata: dict[str, object] = {
        "ok": (
            alpha_summary["emptyFrames"] == 0
            and alpha_summary["hiddenRgbPixels"] == 0
            and alpha_summary["maxMidAlphaRatio"] <= MAX_MID_ALPHA_RATIO
            and not color_summary["missingLightFurFrames"]
            and color_summary["maxLightFurDistance"] <= MAX_LIGHT_FUR_DISTANCE
        ),
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
        "compositing": "none",
        "source": {"mode": "frames", "imageCount": len(source_frames)},
        "registration": registration,
        "matteSummary": matte_summary,
        "alphaSummary": alpha_summary,
        "colorSummary": color_summary,
        "rgbaSha256": rgba_sha256(atlas),
    }
    return atlas, metadata


def write_outputs(
    atlas: Image.Image,
    metadata: dict[str, object],
    output: Path,
    metadata_path: Path,
) -> None:
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
        description="Build a 12x8 look atlas from 96 ordered standalone frames."
    )
    parser.add_argument(
        "--frame",
        action="append",
        type=Path,
        default=[],
        help="ordered standalone frame path; repeat exactly 96 times",
    )
    parser.add_argument("--reference", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--metadata", type=Path, required=True)
    parser.add_argument("--frame-width", type=_positive_integer, default=FRAME_WIDTH)
    parser.add_argument("--frame-height", type=_positive_integer, default=FRAME_HEIGHT)
    args = parser.parse_args()

    if len(args.frame) != FRAME_COUNT:
        parser.error(
            f"expected exactly {FRAME_COUNT} --frame paths, got {len(args.frame)}"
        )

    input_paths = [*args.frame, args.reference]
    if any(_same_path(path, args.output) for path in input_paths):
        parser.error("atlas output must not overwrite an input image")
    if any(_same_path(path, args.metadata) for path in input_paths):
        parser.error("metadata output must not overwrite an input image")

    try:
        frames = [_open_image(path) for path in args.frame]
        reference = _open_image(args.reference)
        atlas, metadata = build_atlas(
            frames,
            reference,
            frame_width=args.frame_width,
            frame_height=args.frame_height,
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
        raise SystemExit(
            "look atlas deterministic validation failed: "
            + json.dumps(
                {
                    "alphaSummary": metadata["alphaSummary"],
                    "colorSummary": {
                        "maxLightFurDistance": metadata["colorSummary"][
                            "maxLightFurDistance"
                        ],
                        "missingLightFurFrames": metadata["colorSummary"][
                            "missingLightFurFrames"
                        ],
                    },
                },
                ensure_ascii=True,
            )
        )


if __name__ == "__main__":
    main()
