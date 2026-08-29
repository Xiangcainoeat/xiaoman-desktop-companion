import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "scripts"
sys.path.insert(0, str(SCRIPTS))

import build_look_atlas_90 as builder
import resample_look_directions as resampler
import verify_look_atlas_90 as verifier


class LookAtlas90ScriptsTest(unittest.TestCase):
    def _write_strip(self, path: Path, row: int) -> None:
        frame_width = 12
        frame_height = 14
        strip = Image.new(
            "RGBA",
            (frame_width * builder.COLUMNS, frame_height),
            (0, 0, 0, 0),
        )
        draw = ImageDraw.Draw(strip)
        for column in range(builder.COLUMNS):
            left = column * frame_width
            color = (40 + row * 3, 70 + column * 2, 110, 255)
            draw.rectangle((left + 3, 3, left + 8, 11), fill=color)
            # This keyed-looking translucent boundary exercises the shared
            # red/pink edge despill used by the idle atlas pipeline.
            strip.putpixel((left + 2, 7), (220, 35, 190, 128))
        strip.save(path, "PNG")

    def test_builder_rejects_the_wrong_number_of_frame_paths(self) -> None:
        result = subprocess.run(
            [
                sys.executable,
                str(SCRIPTS / "build_look_atlas_90.py"),
                "--frame",
                "missing-0.png",
                "--frame",
                "missing-1.png",
                "--output",
                "unused.webp",
                "--metadata",
                "unused.json",
            ],
            cwd=ROOT,
            capture_output=True,
            text=True,
            check=False,
        )

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("expected exactly 90 --frame paths, got 2", result.stderr)

    def test_builds_and_verifies_nine_ordered_strips_without_mutating_inputs(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            temporary = Path(temporary_directory)
            strips = []
            for row in range(builder.ROWS):
                strip = temporary / f"strip-{row:02d}.png"
                self._write_strip(strip, row)
                strips.append(strip)

            atlas_path = temporary / "look-90.webp"
            metadata_path = temporary / "look-90.json"
            contact_sheet_path = temporary / "look-90-contact-sheet.png"
            report_path = temporary / "look-90-verify-report.json"
            build_command = [
                sys.executable,
                str(SCRIPTS / "build_look_atlas_90.py"),
            ]
            for strip in strips:
                build_command.extend(("--strip", str(strip)))
            build_command.extend(
                (
                    "--output",
                    str(atlas_path),
                    "--metadata",
                    str(metadata_path),
                    "--frame-width",
                    "16",
                    "--frame-height",
                    "20",
                    "--provenance",
                    "generated",
                )
            )

            build = subprocess.run(
                build_command,
                cwd=ROOT,
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertEqual(build.returncode, 0, build.stderr)

            metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
            self.assertEqual(metadata["frameCount"], 90)
            self.assertEqual(metadata["columns"], 10)
            self.assertEqual(metadata["rows"], 9)
            self.assertEqual(metadata["stepDegrees"], 4)
            self.assertEqual(metadata["frameWidth"], 16)
            self.assertEqual(metadata["frameHeight"], 20)
            self.assertEqual(metadata["dimensions"], [160, 180])
            self.assertEqual(metadata["source"]["mode"], "strips")
            self.assertEqual(metadata["source"]["imageCount"], 9)
            self.assertEqual(metadata["provenance"], "generated")
            self.assertEqual(metadata["alphaSummary"]["hiddenRgbPixels"], 0)
            self.assertEqual(metadata["alphaSummary"]["emptyFrames"], 0)
            self.assertLessEqual(
                metadata["chromaSummary"]["maxRedPinkEdgePixelsPerFrame"],
                builder.RED_PINK_EDGE_CONTAMINATION_LIMIT,
            )

            with Image.open(atlas_path) as atlas:
                self.assertEqual(atlas.format, "WEBP")
                self.assertEqual(atlas.mode, "RGBA")
                self.assertEqual(atlas.size, (160, 180))

            atlas_bytes_before = atlas_path.read_bytes()
            metadata_bytes_before = metadata_path.read_bytes()
            verify = subprocess.run(
                [
                    sys.executable,
                    str(SCRIPTS / "verify_look_atlas_90.py"),
                    str(atlas_path),
                    str(metadata_path),
                    "--contact-sheet",
                    str(contact_sheet_path),
                    "--report",
                    str(report_path),
                ],
                cwd=ROOT,
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertEqual(verify.returncode, 0, verify.stderr)
            self.assertEqual(atlas_path.read_bytes(), atlas_bytes_before)
            self.assertEqual(metadata_path.read_bytes(), metadata_bytes_before)
            self.assertTrue(contact_sheet_path.is_file())

            report = json.loads(report_path.read_text(encoding="utf-8"))
            self.assertTrue(report["ok"])
            self.assertTrue(report["inputUnmodified"])
            self.assertEqual(report["frameCount"], 90)
            self.assertEqual(report["errors"], [])

    def test_verifier_rejects_stale_layout_metadata(self) -> None:
        atlas = Image.new("RGBA", (160, 180), (0, 0, 0, 0))
        metadata = {
            "frameCount": 89,
            "columns": 10,
            "rows": 9,
            "stepDegrees": 4,
            "frameWidth": 16,
            "frameHeight": 20,
            "dimensions": [160, 180],
            "alphaSummary": {},
            "chromaSummary": {},
        }

        report = verifier.verify(atlas, metadata, source_format="WEBP")

        self.assertFalse(report["ok"])
        self.assertIn("metadata frameCount is 89, expected 90", report["errors"])

    def test_resampler_detects_subjects_when_source_cells_are_not_evenly_spaced(self) -> None:
        source = Image.new("RGB", (1200, 800), (0, 255, 0))
        draw = ImageDraw.Draw(source)
        for row in range(resampler.SOURCE_ROWS):
            top = row * 200 + 62
            bottom = row * 200 + 138
            for column in range(resampler.SOURCE_COLUMNS):
                center = (column + 1) * 150 if column < 7 else 1140
                draw.rectangle((center - 35, top, center + 35, bottom), fill=(35, 45, 55))

        frames = resampler.split_source_sheet(source)
        self.assertEqual(len(frames), resampler.SOURCE_FRAME_COUNT)
        widths = []
        for frame in frames:
            pixels = np.asarray(frame)
            foreground = (pixels[..., 1] < 120) | (
                pixels[..., 1] - np.maximum(pixels[..., 0], pixels[..., 2]) < 40
            )
            _, xs = np.where(foreground)
            widths.append(int(xs.max() - xs.min() + 1))
        self.assertGreaterEqual(min(widths), 70)

    def test_resampler_detects_rows_when_vertical_spacing_is_not_evenly_spaced(self) -> None:
        source = Image.new("RGB", (1200, 1000), (0, 255, 0))
        draw = ImageDraw.Draw(source)
        row_ranges = ((80, 160), (300, 380), (530, 610), (730, 810))
        for row, (top, bottom) in enumerate(row_ranges):
            for column in range(resampler.SOURCE_COLUMNS):
                center = (column + 1) * 150 if column < 7 else 1140
                draw.rectangle((center - 35, top, center + 35, bottom), fill=(35, 45, 55))

        frames = resampler.split_source_sheet(source)
        heights = []
        for frame in frames:
            pixels = np.asarray(frame)
            foreground = (pixels[..., 1] < 120) | (
                pixels[..., 1] - np.maximum(pixels[..., 0], pixels[..., 2]) < 40
            )
            ys, _ = np.where(foreground)
            heights.append(int(ys.max() - ys.min() + 1))
        self.assertLessEqual(max(heights), 82)

    def test_resampler_registers_a_generated_transition_frame_to_the_anchor_geometry(self) -> None:
        source = Image.new("RGB", (600, 600), (0, 255, 0))
        # Keep the fixture close to the cat's portrait ratio so the
        # aspect-ratio-preserving registration can exercise the width bound.
        ImageDraw.Draw(source).rectangle((100, 100, 500, 500), fill=(35, 45, 55))

        frame = resampler.normalize_transition_frame(
            source,
            {"targetSubjectSize": [174, 190], "baseline": 202},
            0,
        )
        pixels = np.asarray(frame)
        alpha = pixels[..., 3]
        ys, xs = np.where(alpha >= builder.ALPHA_VISIBLE)
        self.assertEqual(frame.size, (builder.FRAME_WIDTH, builder.FRAME_HEIGHT))
        visible_width = int(xs.max() - xs.min() + 1)
        self.assertGreaterEqual(visible_width, round(174 * 0.9))
        self.assertLessEqual(visible_width, 174)
        self.assertLessEqual(int(ys.max()), 202)


if __name__ == "__main__":
    unittest.main()
