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
    _boundary_mask,
    BASELINE_Y,
    chroma_to_alpha,
    despill_edges,
    normalize_action_frames,
    validate_action_sequence,
    DEFAULT_SAFE_INSET,
    NATIVE_FUR_REFERENCE_RGB,
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


def _remove_known_source_edge_prop(frame: Image.Image, *, row: int, column: int) -> Image.Image:
    """Remove the known blue prop fragment attached to care pose row 2/9.

    The generated gift row's last pose is prop-free, but the preceding pose's
    blue yarn ball touches its left crop boundary. Only a sufficiently large,
    lower, edge-touching blue component is eligible; small blue components such
    as eyes and all other poses remain unchanged. The pixels are keyed back to
    the sampled matte instead of painted black, so the normal chroma pass can
    remove them without changing the subject palette.
    """
    if (row, column) != (2, 9):
        return frame.copy()

    original_mode = frame.mode
    rgba = np.asarray(frame.convert("RGBA"), dtype=np.uint8).copy()
    red, green, blue = [rgba[..., index].astype(np.int16) for index in range(3)]
    blue_mask = (blue >= 120) & (blue - red > 30) & (blue - green > 10)
    soft_blue_mask = (blue >= 20) & (blue - red > 8) & (blue - green > 3)
    height, width = blue_mask.shape
    seen = np.zeros_like(blue_mask, dtype=bool)
    components: list[tuple[list[tuple[int, int]], int, int, int, int]] = []
    for y, x in zip(*np.where(blue_mask)):
        if seen[y, x]:
            continue
        stack = [(int(y), int(x))]
        seen[y, x] = True
        pixels: list[tuple[int, int]] = []
        min_x = max_x = int(x)
        min_y = max_y = int(y)
        while stack:
            current_y, current_x = stack.pop()
            pixels.append((current_y, current_x))
            min_x, max_x = min(min_x, current_x), max(max_x, current_x)
            min_y, max_y = min(min_y, current_y), max(max_y, current_y)
            for delta_y in (-1, 0, 1):
                for delta_x in (-1, 0, 1):
                    if not delta_x and not delta_y:
                        continue
                    next_y = current_y + delta_y
                    next_x = current_x + delta_x
                    if (
                        0 <= next_y < height
                        and 0 <= next_x < width
                        and blue_mask[next_y, next_x]
                        and not seen[next_y, next_x]
                    ):
                        seen[next_y, next_x] = True
                        stack.append((next_y, next_x))
        components.append((pixels, min_x, max_x, min_y, max_y))

    border = np.concatenate((rgba[0, :, :3], rgba[-1, :, :3], rgba[:, 0, :3], rgba[:, -1, :3]), axis=0)
    matte = np.rint(np.median(border, axis=0)).astype(np.uint8)
    known_fragment_bounds: list[tuple[int, int, int, int]] = []
    for pixels, min_x, max_x, min_y, max_y in components:
        component_area = len(pixels)
        component_width = max_x - min_x + 1
        component_height = max_y - min_y + 1
        is_known_fragment = (
            component_area >= 100
            and min_x == 0
            and component_width >= 8
            and component_height >= 16
            and min_y >= round(height * 0.45)
        )
        if is_known_fragment:
            known_fragment_bounds.append((min_x, max_x, min_y, max_y))

    if known_fragment_bounds:
        # Anti-aliased edges can split the same foreign prop into small blue
        # islands. Once the large edge-touching component identifies the prop,
        # remove only blue pixels in its lower-edge envelope; the y separation
        # keeps the cat's small blue eyes outside this cleanup region.
        left = min(bounds[0] for bounds in known_fragment_bounds)
        right = max(bounds[1] for bounds in known_fragment_bounds) + 2
        top = min(bounds[2] for bounds in known_fragment_bounds) - 2
        bottom = height - 1
        yy, xx = np.indices(blue_mask.shape)
        fragment_band = soft_blue_mask & (xx >= left) & (xx <= right) & (yy >= top) & (yy <= bottom)
        rgba[fragment_band, :3] = matte

    result = Image.fromarray(rgba, "RGBA")
    return result if "A" in original_mode else result.convert("RGB")


def extract_source_frames(source: Image.Image, *, tight: bool = False) -> list[Image.Image]:
    """Extract all visible cells from a three-row matte sheet.

    Column count is inferred per row, allowing generators to return 8, 9, or
    10 columns without relying on nominal prompt dimensions.
    """
    rgb = np.asarray(source.convert("RGB"), dtype=np.int16)
    red, green, blue = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    foreground = (green < GREEN_THRESHOLD) | (green - np.maximum(red, blue) < GREEN_DOMINANCE)
    return [frame for row in _extract_source_rows(source, tight=tight) for frame in row]


def _extract_source_rows(source: Image.Image, *, tight: bool = False) -> list[list[Image.Image]]:
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
            if tight:
                # The activity run is the ownership boundary for this pose. An
                # extra crop margin used to pull the next pose's tail, prop, or
                # black seam into the cell whenever neighboring generated poses
                # were close together. Antialiased edge pixels are recovered by
                # the matte/registration passes after this deterministic split.
                crop_left, crop_right = left, right
            else:
                margin_x = max(5, round((right - left) * 0.08))
                crop_left = max(0, left - margin_x)
                crop_right = min(source.width, right + margin_x)
            cropped = source.crop((crop_left, top, crop_right, bottom)).convert("RGB")
            row_frames.append(_remove_known_source_edge_prop(cropped, row=row, column=len(row_frames)))
        source_rows.append(row_frames)
    return source_rows


def _projection_boundaries(
    projection: np.ndarray,
    *,
    extent: int,
    expected: int,
    threshold: int,
    merge_gap: int,
    axis: str,
) -> list[int]:
    runs = _runs(projection > threshold, merge_gap=merge_gap)
    if len(runs) != expected:
        raise ValueError(
            f"expanded source {axis} grid needs {expected} subjects, found {len(runs)}: {runs}"
        )
    return [0, *[(left[1] + right[0]) // 2 for left, right in zip(runs, runs[1:])], extent]


def extract_expanded_grid_frames(
    source: Image.Image,
    *,
    columns: int = 6,
    rows: int = 6,
) -> list[Image.Image]:
    """Extract independently generated frames from a dense contact sheet.

    Image models often shift a subject a few pixels inside each nominal cell.
    Projection-derived boundaries keep neighboring props out of the crop while
    retaining the complete silhouette. The returned frames are still discrete
    RGBA images; no pixels are interpolated between poses here.
    """
    if columns <= 0 or rows <= 0:
        raise ValueError("expanded source grid dimensions must be positive")
    rgb = np.asarray(source.convert("RGB"), dtype=np.int16)
    red, green, blue = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    foreground = (green < GREEN_THRESHOLD) | (green - np.maximum(red, blue) < GREEN_DOMINANCE)
    height, width = foreground.shape
    row_boundaries = _projection_boundaries(
        foreground.sum(axis=1),
        extent=height,
        expected=rows,
        threshold=max(5, round(width * 0.02)),
        merge_gap=12,
        axis="row",
    )
    frames: list[Image.Image] = []
    for row, (top, bottom) in enumerate(zip(row_boundaries, row_boundaries[1:])):
        column_boundaries = _projection_boundaries(
            foreground[top:bottom].sum(axis=0),
            extent=width,
            expected=columns,
            threshold=max(5, round((bottom - top) * 0.03)),
            merge_gap=45,
            axis=f"column in row {row}",
        )
        for left, right in zip(column_boundaries, column_boundaries[1:]):
            cell = source.crop((left, top, right, bottom))
            cleaned = _trim_edge_fragments(
                _clean_green_boundary(despill_edges(chroma_to_alpha(cell)))
            )
            alpha = np.asarray(cleaned.convert("RGBA"))[..., 3]
            ys, xs = np.where(alpha >= ALPHA_VISIBLE)
            if len(xs) == 0:
                raise ValueError(f"expanded source frame {row},{len(frames) % columns} is empty")
            margin = max(2, round(min(cleaned.width, cleaned.height) * 0.02))
            box = (
                max(0, int(xs.min()) - margin),
                max(0, int(ys.min()) - margin),
                min(cleaned.width, int(xs.max()) + margin + 1),
                min(cleaned.height, int(ys.max()) + margin + 1),
            )
            frames.append(cleaned.crop(box).convert("RGBA"))
    return frames


def _prepare_expanded_sequence(source_path: Path, *, columns: int = 6, rows: int = 6) -> list[Image.Image]:
    with Image.open(source_path) as image:
        source_frames = extract_expanded_grid_frames(image, columns=columns, rows=rows)
    sampled = expand_to_frame_count(source_frames, FRAMES)
    normalized, _ = normalize_action_frames(sampled)
    equalized = _equalize_expanded_frames(normalized)
    return [_trim_edge_fragments(_clean_green_boundary(frame)) for frame in equalized]


def expand_to_frame_count(frames: list[Image.Image], count: int = FRAMES) -> list[Image.Image]:
    """Expand source poses with discrete registered-frame scheduling.

    A generated contact sheet usually contains ten real poses for one care
    action, while the runtime contract has thirty slots. Cross-pose RGB/alpha
    tweening creates two silhouettes during the transition, so expansion must
    choose an already registered source pose instead of synthesizing pixels.
    Repeating the ordered source cycle keeps every slot populated without
    introducing an afterimage; the sequence validator still rejects a source
    set that is intrinsically too repetitive.
    """
    if not frames:
        raise ValueError("cannot expand an empty source sequence")
    if count <= 0:
        return []
    if len(frames) == count:
        return [frame.copy() for frame in frames]
    registered = _register_interpolation_frames(frames)
    if count <= len(registered):
        indices = [round(index * (len(registered) - 1) / max(1, count - 1)) for index in range(count)]
    else:
        indices = [index % len(registered) for index in range(count)]
    return [registered[index].copy() for index in indices]


def _as_clean_rgba(frame: Image.Image) -> Image.Image:
    if "A" in frame.getbands():
        rgba = np.asarray(frame.convert("RGBA"), dtype=np.uint8).copy()
    else:
        rgba = np.asarray(chroma_to_alpha(frame), dtype=np.uint8).copy()
    rgba[rgba[..., 3] == 0, :3] = 0
    return Image.fromarray(rgba, "RGBA")


def _register_interpolation_frames(frames: list[Image.Image]) -> list[Image.Image]:
    """Place varying-size source crops on one shared baseline-aligned canvas."""
    rgba_frames = [_as_clean_rgba(frame) for frame in frames]
    boxes = [frame.getchannel("A").point(lambda value: 255 if value >= ALPHA_VISIBLE else 0).getbbox() for frame in rgba_frames]
    if any(box is None for box in boxes):
        raise ValueError("cannot register a source frame without visible pixels")
    canvas_width = max(frame.width for frame in rgba_frames)
    canvas_height = max(frame.height for frame in rgba_frames)
    registered: list[Image.Image] = []
    for frame, box in zip(rgba_frames, boxes):
        assert box is not None
        subject = frame.crop(box)
        canvas = Image.new("RGBA", (canvas_width, canvas_height), (0, 0, 0, 0))
        canvas.alpha_composite(subject, ((canvas_width - subject.width) // 2, canvas_height - subject.height))
        registered.append(canvas)
    return registered


def _equalize_expanded_frames(frames: list[Image.Image], *, max_scale: float = 1.2) -> list[Image.Image]:
    """Lift undersized generated poses without changing their silhouette shape.

    Contact-sheet generators occasionally render a late prop/reveal pose much
    smaller than the preceding cat. Scaling only frames below the sequence's
    median visible width keeps the action readable while leaving naturally
    wider prop poses untouched. The baseline and safe inset remain fixed.
    """
    if not frames:
        return []
    if not np.isfinite(max_scale) or max_scale < 1:
        raise ValueError("max_scale must be a finite value greater than or equal to one")
    rgba_frames = [frame.convert("RGBA") for frame in frames]
    boxes = [
        frame.getchannel("A").point(lambda value: 255 if value >= ALPHA_VISIBLE else 0).getbbox()
        for frame in rgba_frames
    ]
    if any(box is None for box in boxes):
        raise ValueError("cannot equalize a frame without visible pixels")
    concrete_boxes = [box for box in boxes if box is not None]
    widths = np.array([box[2] - box[0] for box in concrete_boxes], dtype=np.float32)
    reference_width = float(np.median(widths))
    safe_left, safe_top, safe_right, _ = (
        DEFAULT_SAFE_INSET[0],
        DEFAULT_SAFE_INSET[1],
        CELL_WIDTH - DEFAULT_SAFE_INSET[2],
        CELL_HEIGHT - DEFAULT_SAFE_INSET[3],
    )
    result: list[Image.Image] = []
    for frame, box, width in zip(rgba_frames, concrete_boxes, widths):
        factor = min(float(max_scale), reference_width / max(1.0, float(width)))
        if factor <= 1.01:
            result.append(frame.copy())
            continue
        subject = frame.crop(box)
        target_width = max(1, round(subject.width * factor))
        target_height = max(1, round(subject.height * factor))
        factor = min(
            factor,
            (safe_right - safe_left) / max(1, subject.width),
            (BASELINE_Y - safe_top) / max(1, subject.height),
        )
        target_width = max(1, round(subject.width * factor))
        target_height = max(1, round(subject.height * factor))
        resized = subject.resize((target_width, target_height), Image.Resampling.LANCZOS)
        original_center_x = (box[0] + box[2]) / 2
        left = round(original_center_x - target_width / 2)
        left = max(safe_left, min(left, safe_right - target_width))
        top = BASELINE_Y - target_height
        if top < safe_top:
            factor = min(factor, (BASELINE_Y - safe_top) / max(1, subject.height))
            target_width = max(1, round(subject.width * factor))
            target_height = max(1, round(subject.height * factor))
            resized = subject.resize((target_width, target_height), Image.Resampling.LANCZOS)
            left = round(original_center_x - target_width / 2)
            left = max(safe_left, min(left, safe_right - target_width))
            top = BASELINE_Y - target_height
        canvas = Image.new("RGBA", frame.size, (0, 0, 0, 0))
        canvas.alpha_composite(resized, (left, top))
        result.append(canvas)
    return result


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


def _prepare_frames(source: Image.Image, *, tight: bool = False) -> list[Image.Image]:
    frames = expand_to_frame_count(extract_source_frames(source, tight=tight))
    normalized, _ = normalize_action_frames(frames)
    return [_trim_edge_fragments(_clean_green_boundary(frame)) for frame in normalized]


def _sequence_contract(frames: list[Image.Image]) -> dict[str, object]:
    # Keep props (basins, fish, yarn, and gift wrap) from redefining the
    # sequence's fur palette. The shared validator still measures every frame
    # and compares it against this native reference plus its fur signatures.
    return validate_action_sequence(frames, NATIVE_FUR_REFERENCE_RGB, DEFAULT_SAFE_INSET)


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

    # Removing opaque matte pixels can expose a low-alpha colored fringe that
    # was not adjacent to transparency in the input mask. Recompute the
    # boundary after keying so the final frame cannot retain a pink/green halo.
    red, green, blue = [rgba[..., index] for index in range(3)]
    final_boundary = _boundary_mask(alpha)
    final_pink = final_boundary & (alpha < 245) & (
        (red - green > 18) & (blue - green > 8)
    )
    alpha[final_pink] = 0
    rgba[final_pink, :3] = 0
    final_green = final_boundary & (green - np.maximum(red, blue) > 10)
    alpha[final_green] = 0
    rgba[final_green, :3] = 0
    rgba[..., 3] = alpha
    rgba[alpha < ALPHA_VISIBLE, :3] = 0
    rgba[alpha < ALPHA_VISIBLE, 3] = 0
    return Image.fromarray(np.clip(rgba, 0, 255).astype(np.uint8), "RGBA")


def _metadata_document(actions: dict[str, dict[str, object]], atlas: Image.Image, reports: list[dict[str, object]]) -> dict[str, object]:
    return {
        "algorithm": "xiaoman-care-atlas-30-v3-discrete-alpha-registration",
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
        # Run the edge cleanup once more at the atlas boundary. Normalization
        # can expose a low-alpha fringe after resizing, and the encoded atlas
        # must satisfy the same contract as the in-memory frame.
        cleaned = despill_edges(_clean_green_boundary(frame))
        atlas.alpha_composite(cleaned, ((index % COLUMNS) * CELL_WIDTH, (index // COLUMNS) * CELL_HEIGHT))
        reports.append(_frame_report(cleaned, "sleep" if rows == 3 else "bath", index))
    return atlas, reports


def build_assets(
    sleep_source: Path,
    care_source: Path | None,
    output_dir: Path,
    *,
    bath_source: Path | None = None,
    feed_source: Path | None = None,
) -> dict[str, object]:
    output_dir.mkdir(parents=True, exist_ok=True)
    expanded_sources = (bath_source, feed_source)
    if any(source is not None for source in expanded_sources) and not all(source is not None for source in expanded_sources):
        raise ValueError("expanded bath and feed sources must be provided together")
    if all(source is not None for source in expanded_sources):
        assert bath_source is not None and feed_source is not None
        sleeping_frames = _prepare_expanded_sequence(sleep_source)
        bath_frames = _prepare_expanded_sequence(bath_source)
        care_frames = _prepare_expanded_sequence(feed_source)
    else:
        if care_source is None:
            raise ValueError("care source is required when expanded sources are not provided")
        with Image.open(sleep_source) as image:
            sleeping_frames = _prepare_frames(image)
        with Image.open(care_source) as image:
            care_rows = _extract_source_rows(image, tight=True)
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
    from verify_care_atlas_30 import compact_background_sheet, verify

    qa_dir = output_dir.parent.parent / "work/xiaoman-care-assets"
    _contact_sheet(sleep_atlas, qa_dir / "sleeping-30-contact-sheet.png")
    _contact_sheet(care_atlas, qa_dir / "care-actions-30-contact-sheet.png")
    compact_background_sheet(sleep_atlas, qa_dir / "sleeping-30-background-check.png")
    compact_background_sheet(care_atlas, qa_dir / "care-actions-30-background-check.png")
    sleep_metadata = _write_metadata(output_dir / "sleeping-30.json", {"sleep": {"atlasFramePosition": {"row": 0, "frames": 30, "columns": 10}}}, sleep_atlas, sleep_reports)
    care_metadata = _write_metadata(output_dir / "care-actions-30.json", {
        "bath": {"atlasFramePosition": {"row": 0, "frames": 30, "columns": 10}},
        "feed": {"atlasFramePosition": {"row": 3, "frames": 30, "columns": 10}},
        "gift": {"atlasFramePosition": {"row": 3, "frames": 30, "columns": 10}},
    }, care_atlas, care_reports)
    # Validate the encoded outputs and emitted metadata through the same gate
    # used by the standalone verifier before reporting a successful build.
    built_reports = (
        verify(Image.open(sleep_path).convert("RGBA"), sleep_metadata, "sleep"),
        verify(Image.open(care_path).convert("RGBA"), care_metadata, "care"),
    )
    failures: list[dict[str, object]] = []
    for report in built_reports:
        sequence = report.get("sequence")
        sequence_failed = (
            not isinstance(sequence, dict)
            or any(not isinstance(result, dict) or result.get("ok") is not True for result in sequence.values())
        )
        if not report.get("ok") or sequence_failed:
            failures.append(report)
    if failures:
        first = failures[0]
        raise ValueError(
            f"built care atlas failed verification: {first.get('errors', [])}; "
            f"sequence={first.get('sequence', {})}"
        )
    return {"reports": {"sleeping-30": sleep_reports, "care-actions-30": care_reports}}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--sleep-source", type=Path, required=True)
    parser.add_argument("--care-source", type=Path)
    parser.add_argument("--bath-source", type=Path)
    parser.add_argument("--feed-source", type=Path)
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args()
    expanded_sources = (args.bath_source, args.feed_source)
    if args.care_source is None and not all(source is not None for source in expanded_sources):
        parser.error("provide --care-source or both --bath-source and --feed-source")
    if any(source is not None for source in expanded_sources) and not all(source is not None for source in expanded_sources):
        parser.error("--bath-source and --feed-source must be provided together")
    build_assets(
        args.sleep_source,
        args.care_source,
        args.output_dir,
        bath_source=args.bath_source,
        feed_source=args.feed_source,
    )


if __name__ == "__main__":
    main()
