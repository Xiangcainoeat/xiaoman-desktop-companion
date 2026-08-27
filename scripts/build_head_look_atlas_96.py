#!/usr/bin/env python3
"""Build the enhanced 96-frame head-only gaze atlas.

The normal pet body stays in the standard atlas. Each frame here is a
registered, spatially masked face cutout derived from the approved 96 look
frames. There is no temporal opacity blend between directions.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

from build_look_atlas_90 import despill_edges, despill_look_edges


FRAME_WIDTH = 192
FRAME_HEIGHT = 208
COLUMNS = 12
ROWS = 8
FRAME_COUNT = COLUMNS * ROWS
STEP_DEGREES = 360 / FRAME_COUNT

# These registration values are measured against the stable enhanced body.
SOURCE_SCALE = 1.18
SOURCE_ANCHOR = (96, 198)
# The head needs its own registration rather than the body's paw anchor. The
# generated source frames have a slightly different head centroid; this offset
# aligns the full ears/face silhouette with the stable canonical head.
TARGET_ANCHOR = (90, 216)
MASK_BBOX = (8, 14, 118, 114)
MASK_FEATHER_PX = 1.0
ALPHA_EROSION_PX = 9
NEUTRAL_EYE_COVER_BOXES = ((25, 45, 74, 90), (62, 39, 113, 88))
NEUTRAL_EYE_COVER_BLUR_PX = 2.0
NEUTRAL_FACE_BLUR_PX = 2.5
PALETTE_GRADE_SCALE = (0.90, 0.92, 0.90)
PALETTE_GRADE_OFFSET = (18.0, 12.0, 12.0)
ALGORITHM_ID = "head-look-atlas-96-v2-spatial-mask"


def _clear_hidden_rgb(image: Image.Image) -> Image.Image:
    pixels = np.asarray(image.convert("RGBA"), dtype=np.uint8).copy()
    pixels[pixels[..., 3] == 0, :3] = 0
    return Image.fromarray(pixels, "RGBA")


def _apply_native_palette_grade(image: Image.Image) -> Image.Image:
    """Match generated fur contrast to the canonical Codex body palette."""
    original = np.asarray(image.convert("RGBA"), dtype=np.float32)
    pixels = original.copy()
    for channel, (scale, offset) in enumerate(zip(PALETTE_GRADE_SCALE, PALETTE_GRADE_OFFSET)):
        pixels[..., channel] = pixels[..., channel] * scale + offset

    # Blue eyes are an intentional accent and must not be desaturated by the
    # fur correction. Keep the source eye pixels exactly as generated.
    blue_eye = (
        (original[..., 2] > original[..., 0] * 1.05)
        & (original[..., 2] > original[..., 1] * 1.02)
        & (original[..., 2] > 70)
        & (original[..., 3] > 0)
    )
    pixels[blue_eye, :3] = original[blue_eye, :3]
    return Image.fromarray(np.clip(pixels, 0, 255).astype(np.uint8), "RGBA")


def _open_frame(path: Path, index: int) -> Image.Image:
    if not path.is_file():
        raise FileNotFoundError(f"source frame {index} does not exist: {path}")
    with Image.open(path) as opened:
        frame = opened.convert("RGBA")
    if frame.size != (FRAME_WIDTH, FRAME_HEIGHT):
        raise ValueError(
            f"source frame {index} has dimensions {frame.size}, "
            f"expected {(FRAME_WIDTH, FRAME_HEIGHT)}"
        )
    return frame


def _mask() -> Image.Image:
    mask = Image.new("L", (FRAME_WIDTH, FRAME_HEIGHT), 0)
    ImageDraw.Draw(mask).ellipse(MASK_BBOX, fill=255)
    return mask.filter(ImageFilter.GaussianBlur(MASK_FEATHER_PX))


def _neutral_eye_cover(body: Image.Image) -> Image.Image:
    # Blur an alpha-safe copy of the canonical body, then remove blue eye
    # chroma. The small fixed cover hides the old body's eyes underneath the
    # direction patch without changing the visible head silhouette.
    flat = Image.new("RGBA", body.size, (115, 90, 80, 255))
    flat.alpha_composite(body)
    blurred = flat.filter(ImageFilter.GaussianBlur(NEUTRAL_FACE_BLUR_PX))
    pixels = np.asarray(blurred, dtype=np.uint8).copy()
    luminance = (
        pixels[..., 0].astype(np.float32) * 0.2126
        + pixels[..., 1].astype(np.float32) * 0.7152
        + pixels[..., 2].astype(np.float32) * 0.0722
    )
    warm_fill = np.stack(
        (
            np.clip(luminance * 1.08, 0, 255),
            np.clip(luminance * 0.80, 0, 255),
            np.clip(luminance * 0.54, 0, 255),
        ),
        axis=-1,
    )
    pixels[..., 3] = np.asarray(body.getchannel("A"), dtype=np.uint8)
    cover = Image.new("L", body.size, 0)
    draw = ImageDraw.Draw(cover)
    for box in NEUTRAL_EYE_COVER_BOXES:
        draw.ellipse(box, fill=255)
    cover = cover.filter(ImageFilter.GaussianBlur(NEUTRAL_EYE_COVER_BLUR_PX))
    # Replace the whole local cover, rather than only obvious blue pixels.
    # Blur spreads the original eye highlight several pixels beyond its exact
    # blue core, so a complete warm fill prevents a cyan/gray halo.
    cover_region = np.asarray(cover, dtype=np.uint8) > 0
    pixels[cover_region, :3] = warm_fill[cover_region]
    neutral = Image.fromarray(pixels, "RGBA")
    neutral.putalpha(cover)
    return _clear_hidden_rgb(neutral)


def build_head_frame(
    source: Image.Image,
    mask: Image.Image,
    neutral_cover: Image.Image,
) -> Image.Image:
    scaled_width = round(FRAME_WIDTH * SOURCE_SCALE)
    scaled_height = round(FRAME_HEIGHT * SOURCE_SCALE)
    scaled = source.resize((scaled_width, scaled_height), Image.Resampling.LANCZOS)
    registered = Image.new("RGBA", (FRAME_WIDTH, FRAME_HEIGHT), (0, 0, 0, 0))
    registered.alpha_composite(
        scaled,
        (
            round(TARGET_ANCHOR[0] - SOURCE_ANCHOR[0] * SOURCE_SCALE),
            round(TARGET_ANCHOR[1] - SOURCE_ANCHOR[1] * SOURCE_SCALE),
        ),
    )

    alpha = np.asarray(registered.getchannel("A"), dtype=np.uint16)
    mask_array = np.asarray(mask, dtype=np.uint16)
    # Erode the source alpha before applying the face window. This removes
    # the colored one-pixel halo produced by the generated look frames.
    eroded = registered.getchannel("A").filter(ImageFilter.MinFilter(ALPHA_EROSION_PX))
    eroded_array = np.asarray(eroded, dtype=np.uint16)
    alpha = ((eroded_array * mask_array) // 255).astype(np.uint8)
    registered.putalpha(Image.fromarray(alpha, "L"))
    graded = _apply_native_palette_grade(registered)
    directional = _clear_hidden_rgb(despill_look_edges(despill_edges(graded)))
    result = neutral_cover.copy()
    result.alpha_composite(directional)
    return _clear_hidden_rgb(result)


def build_atlas(
    source_dir: Path,
    body_reference: Path,
) -> tuple[Image.Image, dict[str, object], list[Image.Image]]:
    mask = _mask()
    with Image.open(body_reference) as opened:
        body_atlas = opened.convert("RGBA")
    if body_atlas.size[0] < FRAME_WIDTH or body_atlas.size[1] < FRAME_HEIGHT:
        raise ValueError(
            f"body reference has dimensions {body_atlas.size}, "
            f"expected an atlas containing a {(FRAME_WIDTH, FRAME_HEIGHT)} cell"
        )
    body = body_atlas.crop((0, 0, FRAME_WIDTH, FRAME_HEIGHT))
    neutral_cover = _neutral_eye_cover(body)
    frames = [
        build_head_frame(
            _open_frame(source_dir / f"frame-{index:03d}.png", index),
            mask,
            neutral_cover,
        )
        for index in range(FRAME_COUNT)
    ]
    atlas = Image.new("RGBA", (FRAME_WIDTH * COLUMNS, FRAME_HEIGHT * ROWS), (0, 0, 0, 0))
    for index, frame in enumerate(frames):
        atlas.alpha_composite(
            frame,
            ((index % COLUMNS) * FRAME_WIDTH, (index // COLUMNS) * FRAME_HEIGHT),
        )

    alpha_summary = summarize_alpha(frames)
    metadata: dict[str, object] = {
        "ok": alpha_summary["emptyFrames"] == 0 and alpha_summary["hiddenRgbPixels"] == 0,
        "algorithm": ALGORITHM_ID,
        "format": "RGBA/WebP",
        "frameCount": FRAME_COUNT,
        "columns": COLUMNS,
        "rows": ROWS,
        "stepDegrees": STEP_DEGREES,
        "frameWidth": FRAME_WIDTH,
        "frameHeight": FRAME_HEIGHT,
        "cell": [FRAME_WIDTH, FRAME_HEIGHT],
        "dimensions": [atlas.width, atlas.height],
        "compositing": "spatial-mask-only",
        "temporalBlend": False,
        "source": {
            "mode": "approved-look-frames",
            "directory": str(source_dir),
            "bodyReference": str(body_reference),
            "imageCount": FRAME_COUNT,
        },
        "registration": {
            "scale": SOURCE_SCALE,
            "sourceAnchor": list(SOURCE_ANCHOR),
            "targetAnchor": list(TARGET_ANCHOR),
            "offset": [
                round(TARGET_ANCHOR[0] - SOURCE_ANCHOR[0] * SOURCE_SCALE),
                round(TARGET_ANCHOR[1] - SOURCE_ANCHOR[1] * SOURCE_SCALE),
            ],
        },
        "mask": {
            "shape": "ellipse",
            "directionBbox": list(MASK_BBOX),
            "neutralEyeCoverBoxes": [list(box) for box in NEUTRAL_EYE_COVER_BOXES],
            "featherPx": MASK_FEATHER_PX,
            "alphaErosionPx": ALPHA_EROSION_PX,
            "neutralEyeCoverBlurPx": NEUTRAL_EYE_COVER_BLUR_PX,
        },
        "paletteGrade": {
            "algorithm": "restrained-native-fur-grade-v1",
            "reference": str(body_reference),
            "scale": list(PALETTE_GRADE_SCALE),
            "offset": list(PALETTE_GRADE_OFFSET),
            "preserveBlueEyes": True,
        },
        "alphaSummary": alpha_summary,
        "rgbaSha256": hashlib.sha256(atlas.tobytes()).hexdigest(),
    }
    return atlas, metadata, frames


def summarize_alpha(frames: list[Image.Image]) -> dict[str, int]:
    empty_frames = 0
    hidden_rgb_pixels = 0
    for frame in frames:
        pixels = np.asarray(frame.convert("RGBA"), dtype=np.uint8)
        alpha = pixels[..., 3]
        if not np.any(alpha >= 10):
            empty_frames += 1
        hidden_rgb_pixels += int(
            np.count_nonzero((alpha == 0) & np.any(pixels[..., :3] != 0, axis=2))
        )
    return {
        "emptyFrames": empty_frames,
        "hiddenRgbPixels": hidden_rgb_pixels,
    }


def make_contact_sheet(atlas: Image.Image) -> Image.Image:
    sheet = Image.new("RGBA", atlas.size, (236, 239, 236, 255))
    draw = ImageDraw.Draw(sheet)
    tile = 12
    for y in range(0, sheet.height, tile):
        for x in range(0, sheet.width, tile):
            if (x // tile + y // tile) % 2:
                draw.rectangle(
                    (x, y, min(sheet.width - 1, x + tile - 1), min(sheet.height - 1, y + tile - 1)),
                    fill=(217, 222, 218, 255),
                )
    sheet.alpha_composite(atlas)
    font = ImageFont.load_default()
    for index in range(FRAME_COUNT):
        left = (index % COLUMNS) * FRAME_WIDTH
        top = (index // COLUMNS) * FRAME_HEIGHT
        draw.rectangle((left + 2, top + 2, left + 99, top + 16), fill=(255, 255, 255, 224))
        draw.text(
            (left + 4, top + 4),
            f"{index:02d} {index * STEP_DEGREES:06.2f} deg",
            fill=(31, 37, 33, 255),
            font=font,
        )
    return sheet


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-dir", type=Path, required=True)
    parser.add_argument("--body-reference", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--metadata", type=Path, required=True)
    parser.add_argument("--contact-sheet", type=Path)
    args = parser.parse_args()

    try:
        atlas, metadata, _ = build_atlas(args.source_dir, args.body_reference)
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.metadata.parent.mkdir(parents=True, exist_ok=True)
        atlas.save(args.output, "WEBP", lossless=True, quality=100, method=6, exact=True)
        args.metadata.write_text(
            json.dumps(metadata, ensure_ascii=True, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
        if args.contact_sheet:
            args.contact_sheet.parent.mkdir(parents=True, exist_ok=True)
            make_contact_sheet(atlas).save(args.contact_sheet, "PNG")
    except (FileNotFoundError, OSError, ValueError) as error:
        raise SystemExit(f"head look atlas build failed: {error}") from error

    print(json.dumps({
        "ok": metadata["ok"],
        "dimensions": metadata["dimensions"],
        "frameCount": metadata["frameCount"],
        "compositing": metadata["compositing"],
        "alphaSummary": metadata["alphaSummary"],
    }, ensure_ascii=True))
    if not metadata["ok"]:
        raise SystemExit("head look atlas validation failed")


if __name__ == "__main__":
    main()
