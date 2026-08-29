#!/usr/bin/env python3
"""Verify a 90-direction look atlas and write non-destructive QA artifacts."""

from __future__ import annotations

import argparse
import hashlib
import json
from collections.abc import Sequence
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

from build_look_atlas_90 import (
    ALGORITHM_ID,
    COLUMNS,
    EDGE_CONTAMINATION_LIMIT,
    FRAME_COUNT,
    FRAME_HEIGHT,
    FRAME_WIDTH,
    RED_PINK_EDGE_CONTAMINATION_LIMIT,
    ROWS,
    STEP_DEGREES,
    atlas_frames,
    rgba_sha256,
    summarize_frames,
)


DEFAULT_CONTACT_SHEET = Path("work/xiaoman-pet-90/qa/look-90-contact-sheet.png")
DEFAULT_REPORT = Path("work/xiaoman-pet-90/qa/look-90-verify-report.json")


def _is_positive_integer(value: object) -> bool:
    return isinstance(value, int) and not isinstance(value, bool) and value > 0


def _metadata_error(errors: list[str], key: str, actual: object, expected: object) -> None:
    errors.append(f"metadata {key} is {actual!r}, expected {expected!r}")


def _compare_summary(
    errors: list[str],
    name: str,
    metadata_summary: object,
    actual_summary: dict[str, object],
) -> None:
    if not isinstance(metadata_summary, dict):
        errors.append(f"metadata {name} must be an object")
        return
    for key, actual in actual_summary.items():
        expected = metadata_summary.get(key)
        if expected != actual:
            errors.append(
                f"metadata {name}.{key} is {expected!r}, expected actual value {actual!r}"
            )


def verify(
    atlas: Image.Image,
    metadata: object,
    *,
    source_format: str | None = None,
    source_mode: str | None = None,
    initial_errors: Sequence[str] = (),
) -> dict[str, object]:
    errors = list(initial_errors)
    rgba = atlas.convert("RGBA")
    detected_format = source_format or atlas.format
    detected_mode = source_mode or atlas.mode

    if detected_format != "WEBP":
        errors.append(f"atlas format is {detected_format!r}, expected 'WEBP'")
    if detected_mode != "RGBA":
        errors.append(f"atlas mode is {detected_mode!r}, expected 'RGBA'")

    if not isinstance(metadata, dict):
        errors.append("metadata root must be an object")
        metadata = {}

    expected_root_values = {
        "frameCount": FRAME_COUNT,
        "columns": COLUMNS,
        "rows": ROWS,
        "stepDegrees": STEP_DEGREES,
        "format": "RGBA/WebP",
    }
    for key, expected in expected_root_values.items():
        actual = metadata.get(key)
        if actual != expected:
            _metadata_error(errors, key, actual, expected)

    metadata_frame_width = metadata.get("frameWidth")
    metadata_frame_height = metadata.get("frameHeight")
    if not _is_positive_integer(metadata_frame_width):
        errors.append(
            f"metadata frameWidth is {metadata_frame_width!r}, expected a positive integer"
        )
        frame_width = atlas.width // COLUMNS if atlas.width % COLUMNS == 0 else FRAME_WIDTH
    else:
        frame_width = metadata_frame_width
    if not _is_positive_integer(metadata_frame_height):
        errors.append(
            f"metadata frameHeight is {metadata_frame_height!r}, expected a positive integer"
        )
        frame_height = atlas.height // ROWS if atlas.height % ROWS == 0 else FRAME_HEIGHT
    else:
        frame_height = metadata_frame_height

    expected_size = (frame_width * COLUMNS, frame_height * ROWS)
    if atlas.size != expected_size:
        errors.append(f"atlas dimensions are {atlas.size}, expected {expected_size}")
    if metadata.get("dimensions") != [atlas.width, atlas.height]:
        _metadata_error(
            errors,
            "dimensions",
            metadata.get("dimensions"),
            [atlas.width, atlas.height],
        )
    if metadata.get("cell") != [frame_width, frame_height]:
        _metadata_error(
            errors,
            "cell",
            metadata.get("cell"),
            [frame_width, frame_height],
        )

    if atlas.size == expected_size:
        frames = atlas_frames(rgba, frame_width, frame_height)
        alpha_summary, chroma_summary, frame_reports = summarize_frames(frames)
    else:
        frames = []
        alpha_summary, chroma_summary, frame_reports = summarize_frames(frames)

    if len(frame_reports) != FRAME_COUNT:
        errors.append(f"atlas yields {len(frame_reports)} frames, expected {FRAME_COUNT}")
    if alpha_summary["emptyFrames"]:
        errors.append(f"atlas contains {alpha_summary['emptyFrames']} empty frames")
    if alpha_summary["fullyOpaqueFrames"]:
        errors.append(
            f"atlas contains {alpha_summary['fullyOpaqueFrames']} frames without transparency"
        )
    if alpha_summary["hiddenRgbPixels"]:
        errors.append(
            f"atlas contains {alpha_summary['hiddenRgbPixels']} transparent pixels retaining RGB"
        )
    if (
        chroma_summary["maxContaminatedEdgePixelsPerFrame"]
        > EDGE_CONTAMINATION_LIMIT
    ):
        errors.append(
            "atlas exceeds the per-frame edge contamination limit: "
            f"{chroma_summary['maxContaminatedEdgePixelsPerFrame']} > "
            f"{EDGE_CONTAMINATION_LIMIT}"
        )
    if (
        chroma_summary["maxRedPinkEdgePixelsPerFrame"]
        > RED_PINK_EDGE_CONTAMINATION_LIMIT
    ):
        errors.append(
            "atlas exceeds the per-frame red/pink edge limit: "
            f"{chroma_summary['maxRedPinkEdgePixelsPerFrame']} > "
            f"{RED_PINK_EDGE_CONTAMINATION_LIMIT}"
        )

    _compare_summary(errors, "alphaSummary", metadata.get("alphaSummary"), alpha_summary)
    _compare_summary(errors, "chromaSummary", metadata.get("chromaSummary"), chroma_summary)

    actual_rgba_sha256 = rgba_sha256(rgba)
    if metadata.get("rgbaSha256") != actual_rgba_sha256:
        _metadata_error(
            errors,
            "rgbaSha256",
            metadata.get("rgbaSha256"),
            actual_rgba_sha256,
        )

    return {
        "ok": not errors,
        "algorithm": ALGORITHM_ID,
        "format": detected_format,
        "mode": detected_mode,
        "dimensions": [atlas.width, atlas.height],
        "frameCount": len(frame_reports),
        "columns": COLUMNS,
        "rows": ROWS,
        "stepDegrees": STEP_DEGREES,
        "frameWidth": frame_width,
        "frameHeight": frame_height,
        "alphaSummary": alpha_summary,
        "chromaSummary": chroma_summary,
        "rgbaSha256": actual_rgba_sha256,
        "errors": errors,
        "frames": frame_reports,
    }


def make_contact_sheet(
    atlas: Image.Image,
    frame_width: int,
    frame_height: int,
) -> Image.Image:
    rgba = atlas.convert("RGBA")
    sheet = Image.new("RGBA", rgba.size, (236, 239, 236, 255))
    draw = ImageDraw.Draw(sheet)
    tile = 12
    for y in range(0, sheet.height, tile):
        for x in range(0, sheet.width, tile):
            if (x // tile + y // tile) % 2:
                draw.rectangle(
                    (x, y, min(sheet.width - 1, x + tile - 1), min(sheet.height - 1, y + tile - 1)),
                    fill=(217, 222, 218, 255),
                )
    sheet.alpha_composite(rgba)

    font = ImageFont.load_default()
    for index in range(FRAME_COUNT):
        left = (index % COLUMNS) * frame_width
        top = (index // COLUMNS) * frame_height
        if left >= sheet.width or top >= sheet.height:
            continue
        right = min(sheet.width - 1, left + frame_width - 1)
        bottom = min(sheet.height - 1, top + frame_height - 1)
        draw.rectangle((left, top, right, bottom), outline=(72, 79, 74, 150), width=1)
        label = f"{index:02d} {index * STEP_DEGREES:03d} deg"
        label_right = min(right, left + max(52, min(91, frame_width - 4)))
        label_bottom = min(bottom, top + min(16, frame_height - 1))
        if label_right > left + 2 and label_bottom > top + 2:
            draw.rectangle(
                (left + 2, top + 2, label_right, label_bottom),
                fill=(255, 255, 255, 224),
            )
            draw.text((left + 4, top + 4), label, fill=(31, 37, 33, 255), font=font)
    return sheet


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _resolved(path: Path) -> Path:
    return path.expanduser().resolve()


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Verify a 90-direction atlas and its layout/QA metadata."
    )
    parser.add_argument("atlas", type=Path)
    parser.add_argument("metadata", type=Path)
    parser.add_argument("--contact-sheet", type=Path, default=DEFAULT_CONTACT_SHEET)
    parser.add_argument("--report", type=Path, default=DEFAULT_REPORT)
    args = parser.parse_args()

    if not args.atlas.is_file():
        raise SystemExit(f"look atlas verification failed: atlas does not exist: {args.atlas}")
    if not args.metadata.is_file():
        raise SystemExit(
            f"look atlas verification failed: metadata does not exist: {args.metadata}"
        )
    protected_inputs = {_resolved(args.atlas), _resolved(args.metadata)}
    output_paths = {_resolved(args.contact_sheet), _resolved(args.report)}
    if protected_inputs & output_paths:
        raise SystemExit("look atlas verification failed: QA outputs must not overwrite inputs")
    if len(output_paths) != 2:
        raise SystemExit("look atlas verification failed: contact sheet and report paths must differ")

    atlas_file_sha256_before = _sha256_file(args.atlas)
    metadata_file_sha256_before = _sha256_file(args.metadata)
    metadata_errors: list[str] = []
    try:
        metadata: object = json.loads(args.metadata.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        metadata = {}
        metadata_errors.append(f"metadata could not be read as JSON: {error}")

    try:
        with Image.open(args.atlas) as opened:
            source_format = opened.format
            source_mode = opened.mode
            atlas = opened.convert("RGBA")
    except (OSError, ValueError) as error:
        raise SystemExit(f"look atlas verification failed: cannot open atlas: {error}") from error

    report = verify(
        atlas,
        metadata,
        source_format=source_format,
        source_mode=source_mode,
        initial_errors=metadata_errors,
    )
    frame_width = report["frameWidth"]
    frame_height = report["frameHeight"]
    assert isinstance(frame_width, int)
    assert isinstance(frame_height, int)

    args.contact_sheet.parent.mkdir(parents=True, exist_ok=True)
    args.report.parent.mkdir(parents=True, exist_ok=True)
    make_contact_sheet(atlas, frame_width, frame_height).save(args.contact_sheet, "PNG")

    atlas_file_sha256_after = _sha256_file(args.atlas)
    metadata_file_sha256_after = _sha256_file(args.metadata)
    input_unmodified = (
        atlas_file_sha256_before == atlas_file_sha256_after
        and metadata_file_sha256_before == metadata_file_sha256_after
    )
    report["inputUnmodified"] = input_unmodified
    report["inputSha256"] = {
        "atlas": atlas_file_sha256_before,
        "metadata": metadata_file_sha256_before,
    }
    report["contactSheet"] = str(args.contact_sheet)
    if not input_unmodified:
        report["ok"] = False
        errors = report["errors"]
        assert isinstance(errors, list)
        errors.append("input files changed during verification")

    args.report.write_text(
        json.dumps(report, ensure_ascii=True, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    print(
        json.dumps(
            {
                "ok": report["ok"],
                "dimensions": report["dimensions"],
                "frameCount": report["frameCount"],
                "errors": report["errors"],
            },
            ensure_ascii=True,
        )
    )
    if not report["ok"]:
        raise SystemExit("look atlas verification failed")


if __name__ == "__main__":
    main()
