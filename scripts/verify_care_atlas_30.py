#!/usr/bin/env python3
"""Strict contract and pixel verification for Xiaoman's care atlases."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image

from build_care_atlas_30 import ALPHA_VISIBLE, CELL_HEIGHT, CELL_WIDTH, COLUMNS, FRAMES
from build_idle_atlas_30 import DEFAULT_SAFE_INSET, red_pink_hue_mask, validate_action_sequence


EXPECTED = {
    "sleep": {
        "dimensions": [CELL_WIDTH * COLUMNS, CELL_HEIGHT * 3],
        "rows": 3,
        "actions": {"sleep": {"row": 0, "frames": FRAMES, "columns": COLUMNS}},
        "frame_entries": 30,
        "row_actions": {0: "sleep"},
    },
    "care": {
        "dimensions": [CELL_WIDTH * COLUMNS, CELL_HEIGHT * 6],
        "rows": 6,
        "actions": {
            "bath": {"row": 0, "frames": FRAMES, "columns": COLUMNS},
            "feed": {"row": 3, "frames": FRAMES, "columns": COLUMNS},
            "gift": {"row": 3, "frames": FRAMES, "columns": COLUMNS},
        },
        "frame_entries": 60,
        "row_actions": {0: "bath", 3: "feed-gift"},
    },
}

MID_ALPHA_MAX = 245
EDGE_CONTAMINATION_LIMIT = 0
MID_ALPHA_CONTAMINATION_LIMIT = 0
# The curled sleep silhouette measures 4365 pixels at its smallest; keep a
# meaningful floor below that observed minimum while retaining the care floor.
MIN_VISIBLE_PIXELS_BY_KIND = {
    "sleep": 4000,
    "care": 5000,
}


def _expected(kind: str) -> dict[str, Any]:
    if kind not in EXPECTED:
        raise ValueError(f"unknown atlas kind: {kind}")
    return EXPECTED[kind]


def _infer_kind(metadata: object, atlas: Image.Image) -> str:
    if isinstance(metadata, dict):
        actions = metadata.get("actions")
        if isinstance(actions, dict) and {"bath", "feed", "gift"}.issubset(actions):
            return "care"
        if isinstance(actions, dict) and "sleep" in actions:
            return "sleep"
    return "care" if atlas.height == EXPECTED["care"]["dimensions"][1] else "sleep"


def _neighbor_mask(mask: np.ndarray) -> np.ndarray:
    """Return a four-neighbor shifted mask without wrapping at image edges."""
    result = np.zeros_like(mask, dtype=bool)
    result[1:, :] |= mask[:-1, :]
    result[:-1, :] |= mask[1:, :]
    result[:, 1:] |= mask[:, :-1]
    result[:, :-1] |= mask[:, 1:]
    return result


def _boundary_mask(alpha: np.ndarray) -> np.ndarray:
    visible = alpha >= ALPHA_VISIBLE
    return visible & _neighbor_mask(~visible)


def contamination_metrics(frame: Image.Image) -> dict[str, int]:
    """Measure key-colored edge pixels and suspicious mid-alpha pixels."""
    rgba = np.asarray(frame.convert("RGBA"), dtype=np.int16)
    red, green, blue, alpha = [rgba[..., index] for index in range(4)]
    boundary = _boundary_mask(alpha)
    green_dominance = green - np.maximum(red, blue)
    green_edge = boundary & (green_dominance > 10)

    # Strong purple/magenta is distinct from Xiaoman's blue eyes and bowls.
    magenta = boundary & (red >= 150) & (blue >= 150) & (red - green > 30) & (blue - green > 30)
    red_pink = boundary & red_pink_hue_mask(red, green, blue) & ~magenta
    mid_alpha = (alpha > 0) & (alpha < MID_ALPHA_MAX)
    suspicious_mid_alpha = mid_alpha & (
        (green_dominance > 10)
        | ((red >= 150) & (blue >= 150) & (red - green > 30) & (blue - green > 30))
        | red_pink_hue_mask(red, green, blue)
    )
    return {
        "greenEdgeContaminationPixels": int(np.count_nonzero(green_edge)),
        "magentaEdgeContaminationPixels": int(np.count_nonzero(magenta)),
        "redPinkEdgeContaminationPixels": int(np.count_nonzero(red_pink)),
        "midAlphaPixels": int(np.count_nonzero(mid_alpha)),
        "midAlphaContaminationPixels": int(np.count_nonzero(suspicious_mid_alpha)),
    }


def _frame(atlas: Image.Image, row: int, index: int) -> Image.Image:
    column = index % COLUMNS
    atlas_row = row + index // COLUMNS
    return atlas.crop((
        column * CELL_WIDTH,
        atlas_row * CELL_HEIGHT,
        (column + 1) * CELL_WIDTH,
        (atlas_row + 1) * CELL_HEIGHT,
    ))


def _metadata_errors(metadata: object, kind: str, atlas: Image.Image) -> list[str]:
    errors: list[str] = []
    expected = _expected(kind)
    if not isinstance(metadata, dict):
        return ["metadata must be a JSON object"]

    for field, expected_value in (
        ("dimensions", expected["dimensions"]),
        ("cell", [CELL_WIDTH, CELL_HEIGHT]),
        ("columns", COLUMNS),
        ("rows", expected["rows"]),
        ("frameCount", FRAMES),
    ):
        if metadata.get(field) != expected_value:
            errors.append(f"metadata {field} is {metadata.get(field)!r}, expected {expected_value!r}")
    if list(atlas.size) != expected["dimensions"]:
        errors.append(f"atlas dimensions are {list(atlas.size)!r}, expected {expected['dimensions']!r}")
    if metadata.get("frameWidth") != CELL_WIDTH:
        errors.append(f"metadata frameWidth is {metadata.get('frameWidth')!r}, expected {CELL_WIDTH}")
    if metadata.get("frameHeight") != CELL_HEIGHT:
        errors.append(f"metadata frameHeight is {metadata.get('frameHeight')!r}, expected {CELL_HEIGHT}")

    actions = metadata.get("actions")
    expected_actions = expected["actions"]
    if not isinstance(actions, dict):
        errors.append("metadata actions must be an object")
    else:
        if set(actions) != set(expected_actions):
            errors.append(f"metadata actions are {sorted(actions)!r}, expected {sorted(expected_actions)!r}")
        for name, position in expected_actions.items():
            actual = actions.get(name)
            if not isinstance(actual, dict):
                errors.append(f"metadata action {name} is missing or not an object")
                continue
            actual_position = actual.get("atlasFramePosition")
            for field, expected_value in position.items():
                if not isinstance(actual_position, dict) or actual_position.get(field) != expected_value:
                    actual_value = None if not isinstance(actual_position, dict) else actual_position.get(field)
                    errors.append(f"metadata action {name} {field} is {actual_value!r}, expected {expected_value}")

    entries = metadata.get("frames")
    expected_entries = expected["frame_entries"]
    if not isinstance(entries, list) or len(entries) != expected_entries:
        actual_count = len(entries) if isinstance(entries, list) else None
        errors.append(f"metadata frame entries count is {actual_count!r}, expected {expected_entries}")
    elif kind == "sleep":
        for index, entry in enumerate(entries):
            if not isinstance(entry, dict) or entry.get("action") != "sleep" or entry.get("frame") != index:
                errors.append(f"metadata sleep frame entry {index} is malformed")
                break
    else:
        for index, entry in enumerate(entries):
            expected_action = "bath" if index < FRAMES else "feed-gift"
            expected_frame = index if index < FRAMES else index - FRAMES
            if not isinstance(entry, dict) or entry.get("action") != expected_action or entry.get("frame") != expected_frame:
                errors.append(f"metadata care frame entry {index} is malformed")
                break
    return errors


def _validate_pixels(atlas: Image.Image, kind: str) -> tuple[list[str], list[dict[str, Any]], dict[str, dict[str, Any]]]:
    expected = _expected(kind)
    minimum_visible_pixels = MIN_VISIBLE_PIXELS_BY_KIND[kind]
    errors: list[str] = []
    frame_results: list[dict[str, Any]] = []
    action_results: dict[str, dict[str, Any]] = {}
    pixels = np.asarray(atlas.convert("RGBA"), dtype=np.uint8)
    hidden = (pixels[..., 3] == 0) & np.any(pixels[..., :3] != 0, axis=2)
    if np.any(hidden):
        errors.append(f"{int(np.count_nonzero(hidden))} transparent pixels retain RGB")

    if list(atlas.size) != expected["dimensions"]:
        return errors, frame_results, action_results

    for row, action in expected["row_actions"].items():
        totals: dict[str, Any] = {
            "emptyFrames": 0,
            "transparentCornerFailures": 0,
            "greenEdgeContaminationPixels": 0,
            "magentaEdgeContaminationPixels": 0,
            "redPinkEdgeContaminationPixels": 0,
            "midAlphaContaminationPixels": 0,
        }
        for index in range(FRAMES):
            frame = _frame(atlas, row, index)
            alpha = np.asarray(frame.getchannel("A"), dtype=np.uint8)
            visible = int(np.count_nonzero(alpha >= ALPHA_VISIBLE))
            corners = [int(alpha[y, x]) for x, y in ((0, 0), (CELL_WIDTH - 1, 0), (0, CELL_HEIGHT - 1), (CELL_WIDTH - 1, CELL_HEIGHT - 1))]
            contamination = contamination_metrics(frame)
            result = {
                "action": action,
                "frame": index,
                "row": row,
                "visiblePixels": visible,
                "transparentCorners": corners,
                **contamination,
            }
            frame_results.append(result)
            if visible < minimum_visible_pixels:
                totals["emptyFrames"] += 1
                errors.append(f"{action} frame {index} is empty")
            if any(corner != 0 for corner in corners):
                totals["transparentCornerFailures"] += 1
                errors.append(f"{action} frame {index} has opaque corner pixels")
            for metric in (
                "greenEdgeContaminationPixels",
                "magentaEdgeContaminationPixels",
                "redPinkEdgeContaminationPixels",
                "midAlphaContaminationPixels",
            ):
                totals[metric] = max(totals[metric], contamination[metric])
            if contamination["greenEdgeContaminationPixels"] > EDGE_CONTAMINATION_LIMIT:
                errors.append(f"{action} frame {index} has green edge contamination")
            if contamination["magentaEdgeContaminationPixels"] > EDGE_CONTAMINATION_LIMIT:
                errors.append(f"{action} frame {index} has magenta edge contamination")
            if contamination["redPinkEdgeContaminationPixels"] > EDGE_CONTAMINATION_LIMIT:
                errors.append(f"{action} frame {index} has red-pink edge contamination")
            if contamination["midAlphaContaminationPixels"] > MID_ALPHA_CONTAMINATION_LIMIT:
                errors.append(f"{action} frame {index} has mid-alpha contamination")
        action_results[action] = {"row": row, "frames": FRAMES, **totals}

    if kind == "care":
        action_results["feed"] = {**action_results["feed-gift"], "row": 3}
        action_results["gift"] = {**action_results["feed-gift"], "row": 3}
    return errors, frame_results, action_results


def verify(atlas: Image.Image, metadata: object = None, kind: str | None = None) -> dict[str, object]:
    """Validate an atlas against the supplied JSON metadata and pixel contract."""
    if isinstance(metadata, str) and kind is None:
        kind = metadata
        metadata = None
    if kind is None:
        kind = _infer_kind(metadata, atlas)
    try:
        expected = _expected(kind)
    except ValueError as error:
        return {"ok": False, "kind": kind, "errors": [str(error)], "frames": [], "actions": {}}

    errors: list[str] = []
    if metadata is None:
        errors.append("metadata is required")
    else:
        errors.extend(_metadata_errors(metadata, kind, atlas))
    pixel_errors, frames, actions = _validate_pixels(atlas, kind)
    errors.extend(pixel_errors)
    sequence_reports: dict[str, dict[str, object]] = {}
    for row, action in expected["row_actions"].items():
        action_frames = [_frame(atlas, row, index) for index in range(FRAMES)]
        opaque = np.concatenate([
            np.asarray(frame.convert("RGBA"))[..., :3][np.asarray(frame.getchannel("A")) >= 245]
            for frame in action_frames
        ], axis=0)
        reference = np.median(opaque, axis=0) if len(opaque) else (0, 0, 0)
        sequence_reports[action] = validate_action_sequence(action_frames, reference, DEFAULT_SAFE_INSET)
        if not sequence_reports[action]["ok"]:
            sequence_errors = sequence_reports[action].get("errors", ["contract failure"])
            errors.append(f"sequence {action} failed: {', '.join(str(error) for error in sequence_errors)}")
    return {
        "ok": not errors,
        "kind": kind,
        "metadataValid": not any(error.startswith("metadata") for error in errors),
        "dimensions": list(atlas.size),
        "expectedDimensions": expected["dimensions"],
        "columns": COLUMNS,
        "rows": expected["rows"],
        "cell": [CELL_WIDTH, CELL_HEIGHT],
        "frameCount": FRAMES,
        "checkedRows": sorted(expected["row_actions"]),
        "errors": errors,
        "actions": actions,
        "sequence": sequence_reports,
        "frames": frames,
    }


def _read_metadata(path: Path) -> tuple[object, str | None]:
    try:
        return json.loads(path.read_text(encoding="utf-8")), None
    except Exception as error:  # pragma: no cover - exercised through CLI
        return None, f"metadata JSON could not be read: {error}"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("atlas", type=Path)
    parser.add_argument("metadata", type=Path)
    parser.add_argument("--report", type=Path)
    args = parser.parse_args()
    metadata, metadata_error = _read_metadata(args.metadata)
    atlas = Image.open(args.atlas).convert("RGBA")
    kind = _infer_kind(metadata, atlas)
    report = verify(atlas, metadata, kind)
    if metadata_error:
        report["ok"] = False
        report["errors"].insert(0, metadata_error)
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(report, ensure_ascii=True, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, ensure_ascii=True))
    sequence_failures = [name for name, result in report.get("sequence", {}).items() if not result.get("ok")]
    if not report["ok"] or sequence_failures:
        raise SystemExit("care atlas verification failed")


if __name__ == "__main__":
    main()
