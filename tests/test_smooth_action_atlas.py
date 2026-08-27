import sys
import unittest
from pathlib import Path

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


if __name__ == "__main__":
    unittest.main()
