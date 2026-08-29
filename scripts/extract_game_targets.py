#!/usr/bin/env python3
"""Extract the generated game target illustrations into small transparent PNGs."""

from __future__ import annotations

from collections import deque
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
ASSET_DIR = ROOT / "work" / "xiaoman-care-assets"
OUTPUT_DIR = ROOT / "public" / "game"


def is_background(pixel: tuple[int, int, int], threshold: int = 52) -> bool:
    distance = sum((255 - channel) ** 2 for channel in pixel) ** 0.5
    return distance <= threshold and max(pixel) - min(pixel) <= 18


def flood_background(image: Image.Image) -> Image.Image:
    rgb = image.convert("RGB")
    width, height = rgb.size
    pixels = rgb.load()
    visited = bytearray(width * height)
    queue: deque[tuple[int, int]] = deque()

    for x in range(width):
        queue.extend(((x, 0), (x, height - 1)))
    for y in range(1, height - 1):
        queue.extend(((0, y), (width - 1, y)))

    while queue:
        x, y = queue.popleft()
        index = y * width + x
        if visited[index] or not is_background(pixels[x, y]):
            continue
        visited[index] = 1
        for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
            if 0 <= nx < width and 0 <= ny < height and not visited[ny * width + nx]:
                queue.append((nx, ny))

    mask = Image.new("L", (width, height), 255)
    mask.putdata([0 if value else 255 for value in visited])
    return mask


def crop_masked(image: Image.Image, mask: Image.Image, output_size: tuple[int, int]) -> Image.Image:
    bbox = mask.getbbox()
    if bbox is None:
        raise RuntimeError("generated target has no foreground")
    left, top, right, bottom = bbox
    pad = max(8, round(max(right - left, bottom - top) * 0.04))
    left = max(0, left - pad)
    top = max(0, top - pad)
    right = min(image.width, right + pad)
    bottom = min(image.height, bottom + pad)
    cropped = image.crop((left, top, right, bottom)).convert("RGBA")
    cropped.putalpha(mask.crop((left, top, right, bottom)))
    cropped.thumbnail(output_size, Image.Resampling.LANCZOS)
    canvas = Image.new("RGBA", output_size, (0, 0, 0, 0))
    canvas.alpha_composite(cropped, ((output_size[0] - cropped.width) // 2, (output_size[1] - cropped.height) // 2))
    return canvas


def extract_fish() -> None:
    source = Image.open(ASSET_DIR / "game-fish-source.png").convert("RGB")
    result = crop_masked(source, flood_background(source), (192, 128))
    result.save(OUTPUT_DIR / "fish-target.png", optimize=True)


def extract_bubble() -> None:
    source = Image.open(ASSET_DIR / "game-bubble-source.png").convert("RGB")
    width, height = source.size
    pixels = source.load()
    colored = [
        (x, y)
        for y in range(height)
        for x in range(width)
        if max(pixels[x, y]) - min(pixels[x, y]) >= 14 or min(pixels[x, y]) < 235
    ]
    if not colored:
        raise RuntimeError("generated bubble has no colored foreground")
    xs = [point[0] for point in colored]
    ys = [point[1] for point in colored]
    left, right = min(xs), max(xs)
    top, bottom = min(ys), max(ys)
    center_x = (left + right) / 2
    center_y = (top + bottom) / 2
    radius_x = (right - left) / 2 + 8
    radius_y = (bottom - top) / 2 + 8
    mask = Image.new("L", source.size, 0)
    mask_pixels = mask.load()
    for y in range(max(0, int(center_y - radius_y - 4)), min(height, int(center_y + radius_y + 5))):
        for x in range(max(0, int(center_x - radius_x - 4)), min(width, int(center_x + radius_x + 5))):
            distance = ((x - center_x) / radius_x) ** 2 + ((y - center_y) / radius_y) ** 2
            if distance <= 0.985:
                mask_pixels[x, y] = 255
            elif distance <= 1.02:
                mask_pixels[x, y] = round(255 * (1.02 - distance) / 0.035)
    result = crop_masked(source, mask, (160, 160))
    result.save(OUTPUT_DIR / "bubble-target.png", optimize=True)


def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    extract_fish()
    extract_bubble()


if __name__ == "__main__":
    main()
