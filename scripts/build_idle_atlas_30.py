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
NEUTRAL_TARGET_WIDTH = 124
NEUTRAL_TARGET_HEIGHT = 178
BACKGROUND_COLOR_TOLERANCE = 64
ALPHA_VISIBLE = 10
ALPHA_OPAQUE = 245
# A generated matte can be slightly darker than the ideal chroma key. Once
# the pixel still has a strong matte signature, retaining its soft alpha
# creates a visible rectangle when the sprite is composited on charcoal.
HARD_MATTE_KEY_STRENGTH = 0.90
# The accepted native Codex sprite uses a warm cream body. Keep this anchor in
# the shared validator so generated action props cannot redefine the palette.
NATIVE_FUR_REFERENCE_RGB = (242.0, 208.0, 171.0)
FUR_SIGNATURE_SPACE = "normalized-rgb-chroma"
MIN_FUR_SIGNATURE_SAMPLES = 32
LOW_ALPHA_FRINGE_LIMIT = 64
ALGORITHM_ID = "idle-atlas-30-v2-stable-registration"
BASELINE_Y = 202
DEFAULT_SAFE_INSET = (8, 8, 8, 0)


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


def chroma_to_alpha(image: Image.Image, return_stats: bool = False) -> Image.Image | tuple[Image.Image, dict[str, int]]:
    """Remove the sampled green matte while retaining natural subject colors."""
    rgba = np.asarray(image.convert("RGBA"), dtype=np.float32).copy()
    red, green, blue = rgba[..., 0], rgba[..., 1], rgba[..., 2]
    source_alpha = rgba[..., 3].copy()
    green_dominance = green - np.maximum(red, blue)

    # Estimate the matte from the source border. This catches holes between
    # legs even when they are not connected to an image edge.
    border = np.concatenate((
        rgba[0, :, :3], rgba[-1, :, :3], rgba[:, 0, :3], rgba[:, -1, :3],
    ), axis=0)
    background_color = np.median(border, axis=0)
    color_distance = np.max(np.abs(rgba[..., :3] - background_color), axis=2)
    candidate = (
        (color_distance <= BACKGROUND_COLOR_TOLERANCE)
        & (green >= 120.0)
        & (green_dominance >= 45.0)
    )

    # The generated sheets use a bright green matte. A soft key preserves
    # antialiased fur while the later edge pass removes the matte hue.
    key_strength = np.clip((green_dominance - 10.0) / 42.0, 0.0, 1.0)
    key_strength *= np.clip((green - 70.0) / 130.0, 0.0, 1.0)
    # Preserve alpha supplied by an earlier compositing/interpolation stage.
    # RGB contact sheets arrive fully opaque, while registered RGBA frames may
    # already contain transparent pixels that must not turn into black solids.
    alpha = source_alpha

    # Green pixels in the matte can be slightly uneven. Flooding from the
    # border prevents a naturally colored interior pixel from being keyed.
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

    # Every component matching the sampled matte is background, including
    # components enclosed by the subject. A clearly different interior green
    # pixel does not match this mask and remains opaque.
    alpha[candidate] = np.minimum(alpha[candidate], 255.0 * (1.0 - key_strength[candidate]))
    hard_matte = candidate & (key_strength >= HARD_MATTE_KEY_STRENGTH)
    alpha[hard_matte] = 0.0
    alpha[alpha < ALPHA_VISIBLE] = 0.0
    rgba[..., 3] = alpha
    rgba[alpha == 0, :3] = 0
    result = Image.fromarray(np.clip(rgba, 0, 255).astype(np.uint8), "RGBA")
    if not return_stats:
        return result
    stats = {
        "backgroundPixelsRemoved": int(np.count_nonzero(candidate & (alpha < ALPHA_VISIBLE))),
        "backgroundHolePixelsRemoved": int(np.count_nonzero(candidate & ~reachable & (alpha < ALPHA_VISIBLE))),
    }
    return result, stats


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


def red_pink_hue_mask(red: np.ndarray, green: np.ndarray, blue: np.ndarray) -> np.ndarray:
    """Identify a pink/magenta hue by its channel relationship, not warmth."""
    red_channel = np.asarray(red, dtype=np.int16)
    green_channel = np.asarray(green, dtype=np.int16)
    blue_channel = np.asarray(blue, dtype=np.int16)
    return (
        (red_channel >= 150)
        & (red_channel - green_channel > 18)
        & (blue_channel - green_channel > 8)
    )


def red_pink_edge_contamination_count(frame: Image.Image) -> int:
    pixels = np.asarray(frame.convert("RGBA"), dtype=np.int16)
    red, green, blue, alpha = [pixels[..., index] for index in range(4)]
    boundary = _boundary_mask(alpha)
    # Opaque warm fur and the tongue are valid. Restrict this check to
    # antialiased edge pixels where a matte can introduce a pink fringe.
    red_pink = (alpha < ALPHA_OPAQUE) & red_pink_hue_mask(red, green, blue)
    return int(np.count_nonzero(boundary & red_pink))


def _light_fur_mask(pixels: np.ndarray) -> np.ndarray:
    """Select Xiaoman's light fur while excluding saturated action props."""
    rgba = np.asarray(pixels, dtype=np.uint8)
    rgb = rgba[..., :3].astype(np.float32)
    alpha = rgba[..., 3]
    maximum = np.max(rgb, axis=2)
    minimum = np.min(rgb, axis=2)
    luminance = rgb[..., 0] * 0.2126 + rgb[..., 1] * 0.7152 + rgb[..., 2] * 0.0722
    return (
        (alpha >= ALPHA_OPAQUE)
        & (luminance >= 125.0)
        & ((maximum - minimum) <= 120.0)
        & (rgb[..., 0] >= rgb[..., 2] - 8.0)
    )


def _normalized_rgb_chroma(samples: np.ndarray) -> np.ndarray:
    values = np.asarray(samples, dtype=np.float32).reshape(-1, 3)
    totals = values.sum(axis=1, keepdims=True)
    valid = totals[:, 0] > 1e-6
    if not np.any(valid):
        return np.empty((0, 3), dtype=np.float32)
    return values[valid] / totals[valid] * 255.0


def fur_color_signature(frame: Image.Image | np.ndarray) -> np.ndarray | None:
    """Return a brightness-independent signature for Xiaoman's light fur.

    Action props are intentionally absent from this statistic: blue/cyan
    materials fail the warm-channel relation and orange props normally exceed
    the native fur chroma range. A missing signature is a quality failure, not
    a reason to fall back to the prop colors.
    """
    pixels = np.asarray(frame.convert("RGBA") if isinstance(frame, Image.Image) else frame, dtype=np.uint8)
    samples = pixels[..., :3][_light_fur_mask(pixels)]
    if len(samples) < MIN_FUR_SIGNATURE_SAMPLES:
        return None
    chroma = _normalized_rgb_chroma(samples)
    if len(chroma) < MIN_FUR_SIGNATURE_SAMPLES:
        return None
    return np.median(chroma, axis=0).astype(np.float32)


def _reference_fur_signature(reference_rgb: Image.Image | np.ndarray | tuple[int, int, int]) -> np.ndarray | None:
    if isinstance(reference_rgb, Image.Image):
        signature = fur_color_signature(reference_rgb)
        if signature is not None:
            return signature
        values = np.asarray(reference_rgb.convert("RGB"), dtype=np.float32)
    else:
        values = np.asarray(reference_rgb, dtype=np.float32)
    if values.shape != (3,):
        values = np.median(values.reshape(-1, 3), axis=0)
    chroma = _normalized_rgb_chroma(values)
    return chroma[0] if len(chroma) else None


def _is_light_fur_reference(reference_rgb: Image.Image | np.ndarray | tuple[int, int, int]) -> bool:
    if isinstance(reference_rgb, Image.Image):
        pixels = np.asarray(reference_rgb.convert("RGBA"), dtype=np.uint8)
        return fur_color_signature(pixels) is not None
    values = np.asarray(reference_rgb, dtype=np.float32)
    if values.shape != (3,):
        values = np.median(values.reshape(-1, 3), axis=0)
    maximum = float(np.max(values))
    minimum = float(np.min(values))
    luminance = float(values @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32))
    return (
        luminance >= 125.0
        and maximum - minimum <= 120.0
        and float(values[0]) >= float(values[2]) - 8.0
    )


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

    # A generated matte can leave an isolated pink pixel with no opaque
    # interior sample. Keeping that pixel creates a visible halo; dropping the
    # low-alpha fringe is deterministic and does not alter valid blue/orange
    # action props, which do not match the pink hue mask.
    red, green, blue = [pixels[..., index] for index in range(3)]
    # Resampling can leave a pink pixel surrounded only by translucent pixels,
    # so it is invisible to a transparency-boundary test. Clear every
    # semitransparent pixel with this contamination hue, not only pixels on
    # the outer boundary. Valid blue/orange props do not match the relation.
    pink_fringe = (alpha < ALPHA_OPAQUE) & red_pink_hue_mask(red, green, blue)
    alpha[pink_fringe] = 0
    pixels[pink_fringe, :3] = 0
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


def _composite_clipped(destination: Image.Image, foreground: Image.Image, xy: tuple[int, int]) -> None:
    """Composite only complete foregrounds; clipping would hide broken assets."""
    left, top = xy
    right = left + foreground.width
    bottom = top + foreground.height
    if left < 0 or top < 0 or right > destination.width or bottom > destination.height:
        raise ValueError(
            f"foreground placement {(left, top, right, bottom)} exceeds destination {destination.size}"
        )
    destination.alpha_composite(foreground, xy)


def _matte_regression() -> dict[str, bool]:
    image = Image.new("RGB", (64, 64), (18, 238, 28))
    draw = ImageDraw.Draw(image)
    draw.rectangle((12, 12, 51, 51), outline=(25, 25, 25), width=5)
    image.putpixel((32, 32), (28, 126, 44))
    result = chroma_to_alpha(image)
    return {
        "enclosedBackgroundHoleRemoved": result.getpixel((24, 24))[3] == 0,
        "enclosedGreenPixelPreserved": result.getpixel((32, 32))[3] == 255,
    }


def normalize_action_frames(
    source_frames: list[Image.Image],
    scale_multiplier: float = 1.0,
    safe_inset: int | tuple[int, int, int, int] = DEFAULT_SAFE_INSET,
) -> tuple[list[Image.Image], dict[str, object]]:
    """Normalize action motion around a shared neutral subject size.

    ``scale_multiplier`` is used by actions assembled from a different source
    sheet when their neutral pose needs to match an already accepted atlas.
    It scales the complete foreground uniformly, preserving the cat's aspect
    ratio while keeping the feet on the same baseline.
    """
    if not source_frames:
        raise ValueError("source_frames must not be empty")
    if not np.isfinite(scale_multiplier) or scale_multiplier <= 0:
        raise ValueError("scale_multiplier must be a positive finite number")
    if isinstance(safe_inset, int):
        inset = (safe_inset,) * 4
    elif len(safe_inset) == 4:
        inset = tuple(int(value) for value in safe_inset)
    else:
        raise ValueError("safe_inset must be an integer or (left, top, right, bottom)")
    if any(value < 0 for value in inset):
        raise ValueError("safe_inset values must be non-negative")
    keyed_frames: list[Image.Image] = []
    matte_stats: list[dict[str, int]] = []
    for source in source_frames:
        keyed, stats = chroma_to_alpha(source, return_stats=True)
        keyed_frames.append(despill_edges(keyed))
        matte_stats.append(stats)
    frame_bounds = [_foreground_bbox(frame) for frame in keyed_frames]
    union_bbox = _union_bounds(frame_bounds)
    neutral_indices = list(range(min(4, len(frame_bounds)))) + list(range(max(0, len(frame_bounds) - 4), len(frame_bounds)))
    neutral_dimensions = np.array([
        (frame_bounds[index][2] - frame_bounds[index][0], frame_bounds[index][3] - frame_bounds[index][1])
        for index in neutral_indices
    ], dtype=np.float32)
    neutral_width, neutral_height = np.median(neutral_dimensions, axis=0)
    union_width = union_bbox[2] - union_bbox[0]
    union_height = union_bbox[3] - union_bbox[1]
    scale = min(NEUTRAL_TARGET_WIDTH / union_width, NEUTRAL_TARGET_HEIGHT / union_height)
    scale *= float(scale_multiplier)
    neutral_size = (
        max(1, round(neutral_width * scale)),
        max(1, round(neutral_height * scale)),
    )
    scaled_union_size = (max(1, round(union_width * scale)), max(1, round(union_height * scale)))
    registration_left = (CELL_WIDTH - scaled_union_size[0]) // 2
    registration_top = BASELINE_Y - scaled_union_size[1]
    safe_box = (
        inset[0], inset[1], CELL_WIDTH - inset[2], CELL_HEIGHT - inset[3],
    )
    if (
        registration_left < safe_box[0]
        or registration_top < safe_box[1]
        or registration_left + scaled_union_size[0] > safe_box[2]
        or registration_top + scaled_union_size[1] > safe_box[3]
    ):
        raise ValueError(f"union foreground exceeds safe inset {inset}: {scaled_union_size}")

    normalized: list[Image.Image] = []
    for keyed, bounds in zip(keyed_frames, frame_bounds):
        cropped = keyed.crop(bounds)
        target_size = (
            max(1, round(cropped.width * scale)),
            max(1, round(cropped.height * scale)),
        )
        foreground = cropped.resize(target_size, Image.Resampling.LANCZOS)
        frame = Image.new("RGBA", (CELL_WIDTH, CELL_HEIGHT), (0, 0, 0, 0))
        offset_x = round((bounds[0] - union_bbox[0]) * scale)
        x = registration_left + offset_x
        y = BASELINE_Y - foreground.height
        if (
            x < safe_box[0]
            or y < safe_box[1]
            or x + foreground.width > safe_box[2]
            or y + foreground.height > safe_box[3]
        ):
            raise ValueError(
                f"frame placement {(x, y, x + foreground.width, y + foreground.height)} exceeds safe inset {inset}"
            )
        _composite_clipped(frame, foreground, (x, y))
        cleaned = despill_edges(frame)
        pixels = np.asarray(cleaned).copy()
        pixels[pixels[..., 3] < ALPHA_VISIBLE, :3] = 0
        pixels[pixels[..., 3] < ALPHA_VISIBLE, 3] = 0
        normalized.append(Image.fromarray(pixels, "RGBA"))
    return normalized, {
        "scale": float(round(float(scale), 6)),
        "scaleMultiplier": float(round(float(scale_multiplier), 6)),
        "sharedScale": True,
        "sharedRegistration": True,
        "unionBBox": list(union_bbox),
        "safeInset": list(inset),
        "baseline": BASELINE_Y,
        "neutralReferenceSize": [NEUTRAL_TARGET_WIDTH, NEUTRAL_TARGET_HEIGHT],
        "neutralSubjectSize": list(neutral_size),
        "backgroundPixelsRemoved": sum(item["backgroundPixelsRemoved"] for item in matte_stats),
        "backgroundHolePixelsRemoved": sum(item["backgroundHolePixelsRemoved"] for item in matte_stats),
    }


def _safe_box(safe_inset: int | tuple[int, int, int, int], size: tuple[int, int]) -> tuple[int, int, int, int]:
    inset = (safe_inset,) * 4 if isinstance(safe_inset, int) else tuple(safe_inset)
    if len(inset) != 4 or any(int(value) < 0 for value in inset):
        raise ValueError("safe_inset must be an integer or (left, top, right, bottom)")
    return int(inset[0]), int(inset[1]), size[0] - int(inset[2]), size[1] - int(inset[3])


def validate_action_sequence(
    frames: list[Image.Image],
    reference_rgb: Image.Image | np.ndarray | tuple[int, int, int],
    safe_inset: int | tuple[int, int, int, int] = DEFAULT_SAFE_INSET,
) -> dict[str, object]:
    """Return deterministic action quality metrics without modifying frames."""
    if not frames:
        raise ValueError("frames must not be empty")
    safe = _safe_box(safe_inset, frames[0].size)
    arrays = [np.asarray(frame.convert("RGBA"), dtype=np.uint8) for frame in frames]
    duplicate_pairs = sum(np.array_equal(previous, current) for previous, current in zip(arrays, arrays[1:]))
    duplicate_ratio = duplicate_pairs / max(1, len(frames) - 1)
    edge_pixels = 0
    matte_pixels = 0
    bbox_violations = 0
    signatures: list[np.ndarray] = []
    frame_signatures: list[np.ndarray | None] = []
    for pixels in arrays:
        alpha = pixels[..., 3]
        visible = alpha >= ALPHA_VISIBLE
        hidden_rgb = (alpha == 0) & np.any(pixels[..., :3] != 0, axis=2)
        matte = visible & (pixels[..., 1].astype(int) - np.maximum(pixels[..., 0], pixels[..., 2]).astype(int) > 10)
        boundary = visible & (~_shift(visible.astype(np.uint8), 1, 0).astype(bool) | ~_shift(visible.astype(np.uint8), -1, 0).astype(bool))
        boundary |= visible & (~_shift(visible.astype(np.uint8), 0, 1).astype(bool) | ~_shift(visible.astype(np.uint8), 0, -1).astype(bool))
        red, green, blue = [pixels[..., index].astype(int) for index in range(3)]
        edge_pixels += int(np.count_nonzero(
            boundary & (
                (green - np.maximum(red, blue) > 10)
                | ((alpha < ALPHA_OPAQUE) & red_pink_hue_mask(red, green, blue))
            )
        ))
        matte_pixels += int(np.count_nonzero(hidden_rgb | matte))
        ys, xs = np.where(visible)
        if not len(xs) or xs.min() < safe[0] or ys.min() < safe[1] or xs.max() + 1 > safe[2] or ys.max() + 1 > safe[3]:
            bbox_violations += 1
        signature = fur_color_signature(pixels)
        frame_signatures.append(signature)
        if signature is not None:
            signatures.append(signature)
    native_reference = _normalized_rgb_chroma(np.asarray(NATIVE_FUR_REFERENCE_RGB, dtype=np.float32))[0]
    reference_signature = _reference_fur_signature(reference_rgb)
    reference_signatures = [native_reference]
    if reference_signature is not None and _is_light_fur_reference(reference_rgb):
        reference_signatures.append(reference_signature)
    sequence_reference = np.median(np.stack(signatures), axis=0) if signatures else None
    if sequence_reference is not None:
        reference_signatures.append(sequence_reference)
    missing_fur_frames = [index for index, signature in enumerate(frame_signatures) if signature is None]
    color_drift = (
        float("inf") if missing_fur_frames else max(
            (float(np.max(np.abs(signature - reference)))
             for signature in signatures for reference in reference_signatures),
            default=0.0,
        )
    )
    return {
        "duplicateRatio": round(float(duplicate_ratio), 6),
        "edgePixels": edge_pixels,
        "mattePixels": matte_pixels,
        "bboxViolations": bbox_violations,
        "colorDrift": round(color_drift, 6) if np.isfinite(color_drift) else float("inf"),
        "colorSignature": FUR_SIGNATURE_SPACE,
        "missingFurFrames": missing_fur_frames,
        "ok": (
            duplicate_ratio < 0.1
            and edge_pixels == 0
            and matte_pixels == 0
            and bbox_violations == 0
            and not missing_fur_frames
            and color_drift <= COLOR_DRIFT_LIMIT
        ),
        "errors": [
            name for name, failed in (
                ("duplicateRatio", duplicate_ratio >= 0.1),
                ("edgePixels", edge_pixels > 0),
                ("mattePixels", matte_pixels > 0),
                ("bboxViolations", bbox_violations > 0),
                ("colorSignature", bool(missing_fur_frames)),
                ("colorDrift", color_drift > COLOR_DRIFT_LIMIT),
            ) if failed
        ],
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
    total_hole_pixels_removed = 0

    for action_index, action in enumerate(ACTION_ORDER):
        source = Image.open(sources[action]).convert("RGB")
        source_frames = split_source(source)
        if len(source_frames) != FRAMES_PER_ACTION:
            raise ValueError(f"{action} must provide {FRAMES_PER_ACTION} source cells")
        normalized_frames, registration = normalize_action_frames(source_frames)
        action_frame_reports: list[dict[str, int | str]] = []
        signatures = [_color_signature(frame) for frame in normalized_frames]
        continuity = _continuity_metrics(normalized_frames, signatures)
        sequence_contract = validate_action_sequence(
            normalized_frames,
            np.median(np.stack(signatures), axis=0),
            DEFAULT_SAFE_INSET,
        )
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
            "sequence": sequence_contract,
            "backgroundHolePixelsRemoved": registration["backgroundHolePixelsRemoved"],
        }
        total_hole_pixels_removed += int(registration["backgroundHolePixelsRemoved"])

    report: dict[str, object] = {
        "ok": False,
        "algorithm": ALGORITHM_ID,
        "dimensions": [atlas.width, atlas.height],
        "columns": COLUMNS,
        "rows": ROWS_PER_ACTION * len(ACTION_ORDER),
        "cell": [CELL_WIDTH, CELL_HEIGHT],
        "backgroundHolePixelsRemoved": total_hole_pixels_removed,
        "regressions": _matte_regression(),
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
            and isinstance(summary.get("sequence"), dict)
            and summary["sequence"].get("ok") is True
        )
    report["ok"] = all(
        action_is_clean(summary)
        for summary in action_reports.values()
    ) and report["backgroundHolePixelsRemoved"] >= 0 and all(report["regressions"].values())

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
