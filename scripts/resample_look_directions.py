#!/usr/bin/env python3
"""Expand a generated 8x4 look sheet into 90 registered direction frames."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path

import numpy as np
from PIL import Image

import build_look_atlas_90 as atlas_builder


SOURCE_COLUMNS = 8
SOURCE_ROWS = 4
SOURCE_FRAME_COUNT = SOURCE_COLUMNS * SOURCE_ROWS
SOURCE_STEP_DEGREES = 360 / SOURCE_FRAME_COUNT
TARGET_FRAME_COUNT = atlas_builder.FRAME_COUNT
TARGET_FRAME_WIDTH = atlas_builder.FRAME_WIDTH
TARGET_FRAME_HEIGHT = atlas_builder.FRAME_HEIGHT
ALGORITHM_ID = "look-directions-90-from-32-anchors-v2-local-registration"


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _portable_path(path: Path) -> str:
    """Keep checked-in provenance portable when an input lives in the repo."""
    root = Path.cwd().resolve()
    try:
        return str(path.resolve().relative_to(root))
    except ValueError:
        return str(path)


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


def split_source_sheet(source: Image.Image) -> list[Image.Image]:
    """Split each row at detected subject gaps instead of assuming equal cells."""
    rgb = np.asarray(source.convert("RGB"), dtype=np.int16)
    red, green, blue = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    foreground = (green < 120) | (green - np.maximum(red, blue) < 40)
    frames: list[Image.Image] = []
    row_activity = foreground.sum(axis=1) > 20
    row_runs = _contiguous_runs(row_activity, merge_gap=10)
    if len(row_runs) != SOURCE_ROWS:
        raise ValueError(
            f"expected {SOURCE_ROWS} detected rows, found {len(row_runs)}: {row_runs}"
        )
    row_boundaries = [0]
    for previous, current in zip(row_runs, row_runs[1:]):
        row_boundaries.append((previous[1] + current[0]) // 2)
    row_boundaries.append(source.height)
    for row, (top, bottom) in enumerate(zip(row_boundaries, row_boundaries[1:])):
        column_activity = foreground[top:bottom].sum(axis=0) > 5
        runs = _contiguous_runs(column_activity, merge_gap=10)
        if len(runs) != SOURCE_COLUMNS:
            raise ValueError(
                f"expected {SOURCE_COLUMNS} detected subjects in row {row}, found {len(runs)}: {runs}"
            )
        boundaries = [0]
        for previous, current in zip(runs, runs[1:]):
            boundaries.append((previous[1] + current[0]) // 2)
        boundaries.append(source.width)
        for left, right in zip(boundaries, boundaries[1:]):
            frames.append(source.crop((left, top, right, bottom)).convert("RGBA"))
    return frames


def foreground_bbox(frame: Image.Image, index: int) -> tuple[int, int, int, int]:
    alpha = frame.getchannel("A")
    visible = alpha.point(lambda value: 255 if value >= atlas_builder.ALPHA_VISIBLE else 0)
    bbox = visible.getbbox()
    if bbox is None:
        raise ValueError(f"source anchor {index} contains no visible foreground")
    left, top, right, bottom = bbox
    margin_x = max(1, round(frame.width * 0.018))
    margin_y = max(1, round(frame.height * 0.018))
    return (
        max(0, left - margin_x),
        max(0, top - margin_y),
        min(frame.width, right + margin_x),
        min(frame.height, bottom + margin_y),
    )


def normalize_anchor_frames(
    source_frames: list[Image.Image],
) -> tuple[list[Image.Image], dict[str, object]]:
    if len(source_frames) != SOURCE_FRAME_COUNT:
        raise ValueError(f"expected {SOURCE_FRAME_COUNT} source anchors, got {len(source_frames)}")

    prepared: list[Image.Image] = []
    bounds: list[tuple[int, int, int, int]] = []
    matte_removed = 0
    matte_holes_removed = 0
    for index, source in enumerate(source_frames):
        frame, stats = atlas_builder.prepare_source_frame(source, index)
        prepared.append(frame)
        bounds.append(foreground_bbox(frame, index))
        matte_removed += stats["backgroundPixelsRemoved"]
        matte_holes_removed += stats["backgroundHolePixelsRemoved"]

    sizes = [(right - left, bottom - top) for left, top, right, bottom in bounds]
    maximum_width = max(width for width, _ in sizes)
    maximum_height = max(height for _, height in sizes)
    target_width = max(1, round(TARGET_FRAME_WIDTH * atlas_builder.MAX_SUBJECT_WIDTH_RATIO))
    target_height = max(1, round(TARGET_FRAME_HEIGHT * atlas_builder.MAX_SUBJECT_HEIGHT_RATIO))
    scale = min(target_width / maximum_width, target_height / maximum_height)
    baseline = min(TARGET_FRAME_HEIGHT, max(1, round(TARGET_FRAME_HEIGHT * atlas_builder.BASELINE_RATIO)))

    normalized: list[Image.Image] = []
    for frame, bbox in zip(prepared, bounds):
        foreground = frame.crop(bbox)
        resized = foreground.resize(
            (
                max(1, round(foreground.width * scale)),
                max(1, round(foreground.height * scale)),
            ),
            Image.Resampling.LANCZOS,
        )
        target = Image.new("RGBA", (TARGET_FRAME_WIDTH, TARGET_FRAME_HEIGHT), (0, 0, 0, 0))
        target.alpha_composite(
            resized,
            ((TARGET_FRAME_WIDTH - resized.width) // 2, baseline - resized.height),
        )
        normalized.append(atlas_builder.despill_edges(target))

    normalized_sizes = []
    for index, frame in enumerate(normalized):
        left, top, right, bottom = foreground_bbox(frame, index)
        normalized_sizes.append([right - left, bottom - top])

    return normalized, {
        "algorithm": "shared-scale-centered-baseline",
        "sharedScale": True,
        "scale": round(float(scale), 8),
        "targetSubjectSize": [target_width, target_height],
        "maximumSourceSubjectSize": [maximum_width, maximum_height],
        "anchorSubjectSizes": normalized_sizes,
        "baseline": baseline,
        "backgroundPixelsRemoved": matte_removed,
        "backgroundHolePixelsRemoved": matte_holes_removed,
    }


def transition_subject_size(
    registration: dict[str, object],
    target_index: int,
) -> list[int]:
    """Use the neighboring anchor geometry for generated transition frames."""
    fallback = registration.get("targetSubjectSize", [
        round(TARGET_FRAME_WIDTH * atlas_builder.MAX_SUBJECT_WIDTH_RATIO),
        round(TARGET_FRAME_HEIGHT * atlas_builder.MAX_SUBJECT_HEIGHT_RATIO),
    ])
    if not isinstance(fallback, list) or len(fallback) != 2:
        fallback = [174, 190]

    anchor_sizes = registration.get("anchorSubjectSizes")
    if not isinstance(anchor_sizes, list) or len(anchor_sizes) != SOURCE_FRAME_COUNT:
        return [int(fallback[0]), int(fallback[1])]
    if any(
        not isinstance(size, list)
        or len(size) != 2
        or not all(isinstance(value, (int, float)) and value > 0 for value in size)
        for size in anchor_sizes
    ):
        return [int(fallback[0]), int(fallback[1])]

    source_position = target_index * SOURCE_FRAME_COUNT / TARGET_FRAME_COUNT
    lower = math.floor(source_position) % SOURCE_FRAME_COUNT
    upper = (lower + 1) % SOURCE_FRAME_COUNT
    weight = source_position - math.floor(source_position)
    lower_size = anchor_sizes[lower]
    upper_size = anchor_sizes[upper]
    return [
        max(1, round(float(lower_size[0]) * (1.0 - weight) + float(upper_size[0]) * weight)),
        max(1, round(float(lower_size[1]) * (1.0 - weight) + float(upper_size[1]) * weight)),
    ]


def normalize_transition_frame(
    source: Image.Image,
    registration: dict[str, object],
    index: int,
    target_subject_size: list[int] | None = None,
) -> Image.Image:
    """Register an independently generated frame to the anchor scale/baseline."""
    prepared, _ = atlas_builder.prepare_source_frame(source, index)
    bbox = foreground_bbox(prepared, index)
    target_size = target_subject_size or transition_subject_size(registration, index)
    if not isinstance(target_size, list) or len(target_size) != 2:
        raise ValueError("registration targetSubjectSize must contain width and height")
    target_width, target_height = (int(target_size[0]), int(target_size[1]))
    baseline = int(registration.get("baseline", round(TARGET_FRAME_HEIGHT * atlas_builder.BASELINE_RATIO)))
    source_width = bbox[2] - bbox[0]
    source_height = bbox[3] - bbox[1]
    scale = min(target_width / source_width, target_height / source_height)
    foreground = prepared.crop(bbox).resize(
        (
            max(1, round(source_width * scale)),
            max(1, round(source_height * scale)),
        ),
        Image.Resampling.LANCZOS,
    )
    frame = Image.new("RGBA", (TARGET_FRAME_WIDTH, TARGET_FRAME_HEIGHT), (0, 0, 0, 0))
    frame.alpha_composite(
        foreground,
        ((TARGET_FRAME_WIDTH - foreground.width) // 2, baseline - foreground.height),
    )
    return atlas_builder.despill_edges(frame)


def blend_premultiplied(first: Image.Image, second: Image.Image, weight: float) -> Image.Image:
    """Blend RGBA frames without dark or colored fringes at transparent edges."""
    left = np.asarray(first.convert("RGBA"), dtype=np.float32)
    right = np.asarray(second.convert("RGBA"), dtype=np.float32)
    amount = min(1.0, max(0.0, float(weight)))
    left_alpha = left[..., 3:4] / 255.0
    right_alpha = right[..., 3:4] / 255.0
    alpha = left_alpha * (1.0 - amount) + right_alpha * amount
    premultiplied = (
        left[..., :3] * left_alpha * (1.0 - amount)
        + right[..., :3] * right_alpha * amount
    )
    rgb = np.zeros_like(premultiplied)
    np.divide(premultiplied, alpha, out=rgb, where=alpha > 1e-6)
    output = np.concatenate((rgb, alpha * 255.0), axis=2)
    output[output[..., 3] < atlas_builder.ALPHA_VISIBLE, :3] = 0
    output[output[..., 3] < atlas_builder.ALPHA_VISIBLE, 3] = 0
    return atlas_builder.despill_edges(Image.fromarray(np.clip(output, 0, 255).astype(np.uint8), "RGBA"))


def expand_to_target_frames(
    anchors: list[Image.Image],
) -> tuple[list[Image.Image], list[dict[str, float | int | str]]]:
    if len(anchors) != SOURCE_FRAME_COUNT:
        raise ValueError(f"expected {SOURCE_FRAME_COUNT} normalized anchors, got {len(anchors)}")
    frames: list[Image.Image] = []
    mappings: list[dict[str, float | int | str]] = []
    for target_index in range(TARGET_FRAME_COUNT):
        source_position = target_index * SOURCE_FRAME_COUNT / TARGET_FRAME_COUNT
        lower = math.floor(source_position) % SOURCE_FRAME_COUNT
        upper = (lower + 1) % SOURCE_FRAME_COUNT
        weight = source_position - math.floor(source_position)
        frames.append(blend_premultiplied(anchors[lower], anchors[upper], weight))
        mappings.append({
            "targetIndex": target_index,
            "degrees": target_index * atlas_builder.STEP_DEGREES,
            "lowerAnchor": lower,
            "upperAnchor": upper,
            "weight": round(weight, 8),
        })
    return frames, mappings


def apply_transition_overrides(
    frames: list[Image.Image],
    overrides: list[tuple[int, Image.Image]],
    registration: dict[str, object],
) -> tuple[list[Image.Image], list[int]]:
    """Replace selected target directions with registered generated transitions."""
    if len(frames) != TARGET_FRAME_COUNT:
        raise ValueError(f"expected {TARGET_FRAME_COUNT} target frames, got {len(frames)}")
    updated = list(frames)
    applied: list[int] = []
    for target_index, source in overrides:
        if not 0 <= target_index < TARGET_FRAME_COUNT:
            raise ValueError(f"transition target index out of range: {target_index}")
        target_size = transition_subject_size(registration, target_index)
        updated[target_index] = normalize_transition_frame(
            source,
            registration,
            target_index,
            target_subject_size=target_size,
        )
        applied.append(target_index)
    return updated, applied


def write_frames(frames: list[Image.Image], output_dir: Path) -> list[str]:
    output_dir.mkdir(parents=True, exist_ok=True)
    paths: list[str] = []
    for index, frame in enumerate(frames):
        output = output_dir / f"frame-{index:03d}.png"
        frame.save(output, "PNG", optimize=True)
        paths.append(str(output))
    return paths


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, required=True, help="8x4 generated anchor sheet")
    parser.add_argument("--output-dir", type=Path, required=True, help="directory for 90 ordered PNG frames")
    parser.add_argument("--provenance", type=Path, required=True, help="JSON provenance output")
    parser.add_argument(
        "--transition",
        action="append",
        default=[],
        metavar="DEGREES=PATH",
        help="replace a target direction with a generated transition frame; repeat as needed",
    )
    args = parser.parse_args()

    source_path = args.input.expanduser().resolve()
    output_dir = args.output_dir.expanduser().resolve()
    provenance_path = args.provenance.expanduser().resolve()
    if not source_path.is_file():
        raise SystemExit(f"look direction resampling failed: input does not exist: {source_path}")
    if source_path == output_dir or source_path == provenance_path:
        raise SystemExit("look direction resampling failed: output must not overwrite input")

    try:
        with Image.open(source_path) as source_image:
            source = source_image.convert("RGBA")
        source_frames = split_source_sheet(source)
        anchors, registration = normalize_anchor_frames(source_frames)
        frames, mappings = expand_to_target_frames(anchors)
        transition_inputs: list[tuple[int, Image.Image]] = []
        transition_sources: list[dict[str, object]] = []
        for raw_spec in args.transition:
            if "=" not in raw_spec:
                raise ValueError(f"transition must use DEGREES=PATH: {raw_spec}")
            degrees_text, input_text = raw_spec.split("=", 1)
            degrees = int(degrees_text)
            if degrees < 0 or degrees >= 360 or degrees % atlas_builder.STEP_DEGREES != 0:
                raise ValueError(f"transition degrees must be a multiple of {atlas_builder.STEP_DEGREES}: {degrees}")
            input_path = Path(input_text).expanduser().resolve()
            with Image.open(input_path) as transition_image:
                transition_inputs.append((degrees // atlas_builder.STEP_DEGREES, transition_image.convert("RGBA")))
            transition_sources.append({
                "degrees": degrees,
                "path": _portable_path(input_path),
                "sha256": _sha256_file(input_path),
            })
        frames, applied_transitions = apply_transition_overrides(frames, transition_inputs, registration)
        for target_index in applied_transitions:
            mappings[target_index]["source"] = "generated-transition"
        frame_paths = write_frames(frames, output_dir)
    except (OSError, ValueError) as error:
        raise SystemExit(f"look direction resampling failed: {error}") from error

    provenance = {
        "ok": True,
        "algorithm": ALGORITHM_ID,
        "input": {
            "path": _portable_path(source_path),
            "sha256": _sha256_file(source_path),
            "dimensions": [source.width, source.height],
            "columns": SOURCE_COLUMNS,
            "rows": SOURCE_ROWS,
            "frameCount": SOURCE_FRAME_COUNT,
            "stepDegrees": SOURCE_STEP_DEGREES,
        },
        "output": {
            "directory": _portable_path(output_dir),
            "frameCount": TARGET_FRAME_COUNT,
            "frameWidth": TARGET_FRAME_WIDTH,
            "frameHeight": TARGET_FRAME_HEIGHT,
            "stepDegrees": atlas_builder.STEP_DEGREES,
        },
        "registration": registration,
        "method": {
            "type": "circular-premultiplied-alpha-linear-interpolation",
            "generatedAnchorCount": SOURCE_FRAME_COUNT,
            "targetFrameCount": TARGET_FRAME_COUNT,
            "independentAiFrameGeneration": bool(transition_sources),
            "transitionOverrides": transition_sources,
        },
        "frames": [_portable_path(Path(frame_path)) for frame_path in frame_paths],
        "mapping": mappings,
    }
    provenance_path.parent.mkdir(parents=True, exist_ok=True)
    provenance_path.write_text(json.dumps(provenance, ensure_ascii=True, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({
        "ok": True,
        "algorithm": ALGORITHM_ID,
        "inputDimensions": [source.width, source.height],
        "anchorCount": SOURCE_FRAME_COUNT,
        "frameCount": TARGET_FRAME_COUNT,
        "outputDir": str(output_dir),
    }, ensure_ascii=True))


if __name__ == "__main__":
    main()
