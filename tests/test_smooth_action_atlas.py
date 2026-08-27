import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import numpy as np
from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))


def _source_frame(left: int, top: int, width: int = 24, height: int = 36) -> Image.Image:
    image = Image.new("RGBA", (96, 96), (18, 238, 28, 255))
    pixels = image.load()
    for y in range(top, top + height):
        for x in range(left, left + width):
            pixels[x, y] = (214, 174, 142, 255)
    return image


class SmoothActionAtlasContractTest(unittest.TestCase):
    def test_normalize_uses_common_registration_and_cleans_transparent_rgb(self) -> None:
        from build_idle_atlas_30 import CELL_HEIGHT, CELL_WIDTH, normalize_action_frames

        frames, registration = normalize_action_frames([
            _source_frame(8, 12, 24, 36),
            _source_frame(24, 18, 30, 30),
        ])

        self.assertEqual(len(frames), 2)
        self.assertTrue(registration["sharedRegistration"])
        self.assertIn("unionBBox", registration)
        self.assertEqual({frame.size for frame in frames}, {(CELL_WIDTH, CELL_HEIGHT)})
        boxes = [np.asarray(frame.getchannel("A")) >= 10 for frame in frames]
        visible_boxes = [Image.fromarray(mask.astype(np.uint8) * 255).getbbox() for mask in boxes]
        self.assertEqual([box[3] for box in visible_boxes], [202, 202])
        for frame in frames:
            rgba = np.asarray(frame)
            self.assertEqual(np.count_nonzero((rgba[..., 3] == 0) & np.any(rgba[..., :3] != 0, axis=2)), 0)

    def test_normalize_rejects_foreground_outside_safe_inset_instead_of_clipping(self) -> None:
        from build_idle_atlas_30 import normalize_action_frames

        with self.assertRaises(ValueError):
            normalize_action_frames([_source_frame(0, 0, 90, 90)], safe_inset=80)

    def test_normalize_rejects_bottom_only_inset_that_conflicts_with_baseline(self) -> None:
        from build_idle_atlas_30 import normalize_action_frames

        with self.assertRaises(ValueError):
            normalize_action_frames([_source_frame(24, 12, 30, 40)], safe_inset=(0, 0, 0, 16))

    def test_validate_reports_contract_metrics_and_rejects_duplicate_sequence(self) -> None:
        from build_idle_atlas_30 import validate_action_sequence

        frame = Image.new("RGBA", (192, 208), (0, 0, 0, 0))
        for y in range(140, 202):
            for x in range(70, 122):
                frame.putpixel((x, y), (214, 174, 142, 255))
        frame.putpixel((1, 1), (9, 9, 9, 0))
        frames = [frame.copy() for _ in range(4)] + [frame.copy() for _ in range(26)]

        report = validate_action_sequence(frames, reference_rgb=(214, 174, 142), safe_inset=8)

        self.assertTrue({"duplicateRatio", "edgePixels", "mattePixels", "bboxViolations", "colorDrift"}.issubset(report))
        self.assertGreater(report["duplicateRatio"], 0.1)
        self.assertGreater(report["bboxViolations"], 0)
        self.assertGreater(report["mattePixels"], 0)

    def test_validate_ignores_opaque_warm_fur_but_flags_semitransparent_red_pink_edges(self) -> None:
        from build_idle_atlas_30 import validate_action_sequence

        opaque_warm_fur = Image.new("RGBA", (32, 32), (0, 0, 0, 0))
        opaque_warm_fur.putpixel((16, 16), (214, 174, 142, 255))
        semitransparent_red_pink = Image.new("RGBA", (32, 32), (0, 0, 0, 0))
        semitransparent_red_pink.putpixel((16, 16), (220, 100, 180, 128))

        opaque_report = validate_action_sequence([opaque_warm_fur], reference_rgb=(214, 174, 142), safe_inset=0)
        semitransparent_report = validate_action_sequence(
            [semitransparent_red_pink], reference_rgb=(214, 174, 142), safe_inset=0
        )

        self.assertEqual(opaque_report["edgePixels"], 0)
        self.assertGreater(semitransparent_report["edgePixels"], 0)

    def test_verify_propagates_sequence_failure_when_pixels_are_valid(self) -> None:
        import verify_care_atlas_30

        atlas = Image.new("RGBA", (1920, 624), (0, 0, 0, 0))
        frame = Image.new("RGBA", (192, 208), (0, 0, 0, 0))
        for y in range(80, 180):
            for x in range(60, 130):
                frame.putpixel((x, y), (214, 174, 142, 255))
        for index in range(30):
            atlas.alpha_composite(frame, ((index % 10) * 192, (index // 10) * 208))
        metadata = json.loads((ROOT / "public/pet/sleeping-30.json").read_text())

        report = verify_care_atlas_30.verify(atlas, metadata, "sleep")

        self.assertFalse(any("pixel" in error for error in report["errors"]))
        self.assertFalse(report["sequence"]["sleep"]["ok"])
        self.assertTrue(any(error.startswith("sequence") for error in report["errors"]))
        self.assertFalse(report["ok"])

    def test_build_assets_rejects_sequence_failure_even_when_pixel_report_is_clean(self) -> None:
        import build_care_atlas_30
        import verify_care_atlas_30

        def clean_pixels_but_bad_sequence(*_args: object) -> dict[str, object]:
            return {"ok": True, "errors": [], "sequence": {"sleep": {"ok": False}}}

        def contact_sheet(path: Path, rows: int, columns: int) -> None:
            image = Image.new("RGB", (300, 300), (18, 238, 28))
            for row in range(rows):
                y = row * 100 + 20
                for column in range(columns):
                    x = column * 30
                    for pixel_y in range(y, y + 60):
                        for pixel_x in range(x, x + 10):
                            image.putpixel((pixel_x, pixel_y), (214, 174, 142))
            image.save(path)

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            sleep_source = root / "sleep.png"
            care_source = root / "care.png"
            contact_sheet(sleep_source, 3, 8)
            contact_sheet(care_source, 3, 10)
            with patch.object(verify_care_atlas_30, "verify", clean_pixels_but_bad_sequence):
                with self.assertRaisesRegex(ValueError, "sequence"):
                    build_care_atlas_30.build_assets(sleep_source, care_source, root / "output")


if __name__ == "__main__":
    unittest.main()
