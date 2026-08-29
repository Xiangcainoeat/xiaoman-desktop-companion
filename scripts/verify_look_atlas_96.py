#!/usr/bin/env python3
"""Verify a 96-direction independent-frame look atlas."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

from build_look_atlas_96 import (
    ALGORITHM_ID,
    COLUMNS,
    FRAME_COUNT,
    FRAME_HEIGHT,
    FRAME_WIDTH,
    MAX_LIGHT_FUR_DISTANCE,
    MAX_MID_ALPHA_RATIO,
    ROWS,
    STEP_DEGREES,
    rgba_sha256,
    summarize_alpha,
    summarize_color,
)


DEFAULT_CONTACT_SHEET = Path("work/xiaoman-pet-96/qa/look-96-contact-sheet.png")
DEFAULT_REPORT = Path("work/xiaoman-pet-96/qa/look-96-verify-report.json")


def _atlas_frames(
    atlas: Image.Image, frame_width: int, frame_height: int
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


def _positive_metadata_integer(metadata: dict[str, object], key: str, fallback: int) -> int:
    value = metadata.get(key)
    if isinstance(value, int) and not isinstance(value, bool) and value > 0:
        return value
    return fallback


def verify(
    atlas: Image.Image,
    metadata: object,
    *,
    reference: Image.Image,
    source_format: str | None = None,
) -> dict[str, object]:
    errors: list[str] = []
    rgba = atlas.convert("RGBA")
    detected_format = source_format or atlas.format
    if detected_format != "WEBP":
        errors.append(f"atlas format is {detected_format!r}, expected 'WEBP'")

    if not isinstance(metadata, dict):
        errors.append("metadata root must be an object")
        metadata = {}

    expected_values: dict[str, object] = {
        "frameCount": FRAME_COUNT,
        "columns": COLUMNS,
        "rows": ROWS,
        "stepDegrees": STEP_DEGREES,
        "compositing": "none",
    }
    for key, expected in expected_values.items():
        if metadata.get(key) != expected:
            errors.append(
                f"metadata {key} is {metadata.get(key)!r}, expected {expected!r}"
            )

    frame_width = _positive_metadata_integer(metadata, "frameWidth", FRAME_WIDTH)
    frame_height = _positive_metadata_integer(metadata, "frameHeight", FRAME_HEIGHT)
    expected_size = (frame_width * COLUMNS, frame_height * ROWS)
    if rgba.size != expected_size:
        errors.append(f"atlas dimensions are {rgba.size}, expected {expected_size}")
        frames: list[Image.Image] = []
    else:
        frames = _atlas_frames(rgba, frame_width, frame_height)

    alpha_summary = summarize_alpha(frames)
    if alpha_summary["emptyFrames"]:
        errors.append(f"atlas contains {alpha_summary['emptyFrames']} empty frames")
    if alpha_summary["hiddenRgbPixels"]:
        errors.append(
            "atlas contains transparent pixels retaining hidden RGB: "
            f"{alpha_summary['hiddenRgbPixels']}"
        )
    if alpha_summary["maxMidAlphaRatio"] > MAX_MID_ALPHA_RATIO:
        errors.append(
            "atlas contains a likely double exposure: max mid-alpha ratio "
            f"{alpha_summary['maxMidAlphaRatio']:.5f} exceeds {MAX_MID_ALPHA_RATIO:.5f}"
        )

    try:
        color_summary = summarize_color(frames, reference)
    except ValueError as error:
        color_summary = {
            "maxLightFurDistance": float("inf"),
            "missingLightFurFrames": list(range(FRAME_COUNT)),
        }
        errors.append(str(error))
    if color_summary["missingLightFurFrames"]:
        errors.append(
            "atlas has frames without measurable light fur: "
            f"{color_summary['missingLightFurFrames']}"
        )
    if color_summary["maxLightFurDistance"] > MAX_LIGHT_FUR_DISTANCE:
        errors.append(
            "atlas light-fur color distance exceeds the native reference: "
            f"{color_summary['maxLightFurDistance']:.5f} > "
            f"{MAX_LIGHT_FUR_DISTANCE:.5f}"
        )

    return {
        "ok": not errors,
        "algorithm": ALGORITHM_ID,
        "format": detected_format,
        "mode": rgba.mode,
        "dimensions": [rgba.width, rgba.height],
        "frameCount": len(frames),
        "columns": COLUMNS,
        "rows": ROWS,
        "stepDegrees": STEP_DEGREES,
        "frameWidth": frame_width,
        "frameHeight": frame_height,
        "compositing": "none",
        "alphaSummary": alpha_summary,
        "colorSummary": color_summary,
        "rgbaSha256": rgba_sha256(rgba),
        "errors": errors,
    }


def make_contact_sheet(
    atlas: Image.Image, frame_width: int, frame_height: int
) -> Image.Image:
    rgba = atlas.convert("RGBA")
    sheet = Image.new("RGBA", rgba.size, (236, 239, 236, 255))
    draw = ImageDraw.Draw(sheet)
    tile = 12
    for y in range(0, sheet.height, tile):
        for x in range(0, sheet.width, tile):
            if (x // tile + y // tile) % 2:
                draw.rectangle(
                    (
                        x,
                        y,
                        min(sheet.width - 1, x + tile - 1),
                        min(sheet.height - 1, y + tile - 1),
                    ),
                    fill=(217, 222, 218, 255),
                )
    sheet.alpha_composite(rgba)

    font = ImageFont.load_default()
    for index in range(FRAME_COUNT):
        left = (index % COLUMNS) * frame_width
        top = (index // COLUMNS) * frame_height
        right = left + frame_width - 1
        bottom = top + frame_height - 1
        draw.rectangle((left, top, right, bottom), outline=(72, 79, 74, 150), width=1)
        label = f"{index:02d} {index * STEP_DEGREES:06.2f} deg"
        draw.rectangle((left + 2, top + 2, left + 100, top + 16), fill=(255, 255, 255, 224))
        draw.text((left + 4, top + 4), label, fill=(31, 37, 33, 255), font=font)
    return sheet


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Verify a 96-direction atlas against a native color reference."
    )
    parser.add_argument("atlas", type=Path)
    parser.add_argument("metadata", type=Path)
    parser.add_argument("--reference", type=Path, required=True)
    parser.add_argument("--contact-sheet", type=Path, default=DEFAULT_CONTACT_SHEET)
    parser.add_argument("--report", type=Path, default=DEFAULT_REPORT)
    args = parser.parse_args()

    for label, path in (
        ("atlas", args.atlas),
        ("metadata", args.metadata),
        ("reference", args.reference),
    ):
        if not path.is_file():
            raise SystemExit(f"look atlas verification failed: {label} does not exist: {path}")

    protected = {path.expanduser().resolve() for path in (args.atlas, args.metadata, args.reference)}
    outputs = {path.expanduser().resolve() for path in (args.contact_sheet, args.report)}
    if protected & outputs or len(outputs) != 2:
        raise SystemExit("look atlas verification failed: QA outputs must be unique and non-destructive")

    atlas_hash_before = _sha256_file(args.atlas)
    metadata_hash_before = _sha256_file(args.metadata)
    try:
        metadata = json.loads(args.metadata.read_text(encoding="utf-8"))
        with Image.open(args.atlas) as opened:
            source_format = opened.format
            atlas = opened.convert("RGBA")
        with Image.open(args.reference) as opened:
            reference = opened.convert("RGBA")
    except (OSError, UnicodeError, ValueError, json.JSONDecodeError) as error:
        raise SystemExit(f"look atlas verification failed: {error}") from error

    report = verify(
        atlas,
        metadata,
        reference=reference,
        source_format=source_format,
    )
    args.contact_sheet.parent.mkdir(parents=True, exist_ok=True)
    args.report.parent.mkdir(parents=True, exist_ok=True)
    make_contact_sheet(atlas, report["frameWidth"], report["frameHeight"]).save(
        args.contact_sheet, "PNG"
    )
    report["inputUnmodified"] = (
        atlas_hash_before == _sha256_file(args.atlas)
        and metadata_hash_before == _sha256_file(args.metadata)
    )
    if not report["inputUnmodified"]:
        report["ok"] = False
        report["errors"].append("input files changed during verification")
    report["contactSheet"] = str(args.contact_sheet)
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
