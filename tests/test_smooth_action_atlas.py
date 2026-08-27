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


def _smooth_source_frames(count: int) -> list[Image.Image]:
    frames: list[Image.Image] = []
    for index in range(count):
        pixels = np.zeros((208, 192, 4), dtype=np.uint8)
        left = 48
        top = 108
        width = 44 + index * 2
        pixels[top:top + 52, left:left + width] = (214, 174, 142, 255)
        pixels[0, 0] = (9, 9, 9, 0)
        frames.append(Image.fromarray(pixels, "RGBA"))
    return frames


class SmoothActionAtlasContractTest(unittest.TestCase):
    def test_chroma_to_alpha_preserves_existing_transparency(self) -> None:
        from build_idle_atlas_30 import chroma_to_alpha

        source = Image.new("RGBA", (8, 8), (0, 0, 0, 0))
        source.putpixel((4, 4), (214, 174, 142, 255))

        result = chroma_to_alpha(source)

        self.assertEqual(result.getpixel((0, 0))[3], 0)
        self.assertEqual(result.getpixel((4, 4))[3], 255)

    def test_expand_cycles_ten_registered_rgba_poses_into_thirty_discrete_frames(self) -> None:
        from build_care_atlas_30 import expand_to_frame_count
        from build_idle_atlas_30 import validate_action_sequence

        expanded = expand_to_frame_count(_smooth_source_frames(10), 30)

        report = validate_action_sequence(expanded, reference_rgb=(214, 174, 142), safe_inset=8)
        self.assertLess(report["duplicateRatio"], 0.1)
        self.assertEqual(len({frame.tobytes() for frame in expanded}), 10)
        self.assertTrue(all(
            np.count_nonzero((np.asarray(frame.getchannel("A")) > 0) & (np.asarray(frame.getchannel("A")) < 255)) == 0
            for frame in expanded
        ))
        for frame in expanded:
            self.assertEqual(frame.mode, "RGBA")
            self.assertEqual(frame.size, (192, 208))
            rgba = np.asarray(frame)
            self.assertEqual(np.count_nonzero((rgba[..., 3] == 0) & np.any(rgba[..., :3] != 0, axis=2)), 0)

    def test_expand_keeps_frames_discrete_without_cross_pose_alpha_or_rgb_tween(self) -> None:
        from build_care_atlas_30 import expand_to_frame_count

        source: list[Image.Image] = []
        for color in ((214, 174, 142, 255), (64, 132, 214, 255)):
            frame = Image.new("RGBA", (96, 96), (0, 0, 0, 0))
            frame.paste(color, (24, 24, 72, 88))
            source.append(frame)

        expanded = expand_to_frame_count(source, 6)
        source_colors = {(214, 174, 142), (64, 132, 214)}
        for frame in expanded:
            pixels = np.asarray(frame)
            visible = pixels[..., 3] >= 245
            self.assertTrue(np.any(visible))
            self.assertTrue(set(map(tuple, pixels[visible, :3])).issubset(source_colors))
            self.assertEqual(np.count_nonzero((pixels[..., 3] > 0) & (pixels[..., 3] < 245)), 0)

        self.assertEqual(len({frame.tobytes() for frame in expanded}), 2)

    def test_expand_keeps_an_already_thirty_frame_sequence_unchanged(self) -> None:
        from build_care_atlas_30 import expand_to_frame_count

        source = _smooth_source_frames(30)
        expanded = expand_to_frame_count(source, 30)

        self.assertEqual([frame.mode for frame in expanded], ["RGBA"] * 30)
        self.assertEqual([frame.size for frame in expanded], [(192, 208)] * 30)
        self.assertEqual([frame.tobytes() for frame in expanded], [frame.tobytes() for frame in source])

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

    def test_validate_ignores_semitransparent_warm_fur_but_flags_clear_pink_hue(self) -> None:
        from build_idle_atlas_30 import validate_action_sequence

        semitransparent_warm_fur = Image.new("RGBA", (32, 32), (0, 0, 0, 0))
        semitransparent_warm_fur.putpixel((16, 16), (218, 192, 157, 112))
        semitransparent_pink = Image.new("RGBA", (32, 32), (0, 0, 0, 0))
        semitransparent_pink.putpixel((16, 16), (220, 100, 180, 128))

        warm_report = validate_action_sequence(
            [semitransparent_warm_fur], reference_rgb=(218, 192, 157), safe_inset=0
        )
        pink_report = validate_action_sequence(
            [semitransparent_pink], reference_rgb=(220, 100, 180), safe_inset=0
        )

        self.assertEqual(warm_report["edgePixels"], 0)
        self.assertGreater(pink_report["edgePixels"], 0)

    def test_validate_does_not_treat_valid_prop_colors_as_red_pink_fur(self) -> None:
        from build_idle_atlas_30 import red_pink_edge_contamination_count, validate_action_sequence

        # These colors model the blue basin/fabric, orange fish snack, and blue
        # yarn that are valid action props rather than matte contamination.
        frame = Image.new("RGBA", (64, 64), (0, 0, 0, 0))
        frame.putpixel((32, 32), (54, 142, 208, 128))
        frame.putpixel((33, 32), (232, 143, 58, 128))
        frame.putpixel((32, 33), (40, 114, 196, 128))
        frame.putpixel((33, 33), (214, 174, 142, 255))

        report = validate_action_sequence(
            [frame], reference_rgb=(214, 174, 142), safe_inset=0
        )

        self.assertEqual(report["edgePixels"], 0)
        self.assertEqual(red_pink_edge_contamination_count(frame), 0)

    def test_despill_drops_isolated_pink_fringe_without_touching_valid_prop_colors(self) -> None:
        from build_idle_atlas_30 import despill_edges, red_pink_edge_contamination_count

        frame = Image.new("RGBA", (32, 32), (0, 0, 0, 0))
        frame.putpixel((16, 16), (54, 142, 208, 128))  # valid blue fabric
        frame.putpixel((17, 16), (232, 143, 58, 128))  # valid orange fish
        frame.putpixel((15, 16), (220, 100, 180, 128))  # isolated matte fringe

        cleaned = despill_edges(frame)

        self.assertEqual(red_pink_edge_contamination_count(cleaned), 0)
        self.assertEqual(cleaned.getpixel((16, 16)), (54, 142, 208, 128))
        self.assertEqual(cleaned.getpixel((17, 16)), (232, 143, 58, 128))

    def test_despill_drops_low_alpha_pink_inside_a_translucent_fringe(self) -> None:
        from build_idle_atlas_30 import despill_edges, red_pink_hue_mask

        frame = Image.new("RGBA", (32, 32), (0, 0, 0, 0))
        for y in range(14, 19):
            for x in range(14, 19):
                frame.putpixel((x, y), (214, 174, 142, 32))
        frame.putpixel((16, 16), (255, 229, 255, 10))

        cleaned = despill_edges(frame)
        rgba = np.asarray(cleaned)

        self.assertEqual(rgba[16, 16, 3], 0)
        self.assertFalse(red_pink_hue_mask(rgba[..., 0], rgba[..., 1], rgba[..., 2])[16, 16])

    def test_despill_drops_pink_inside_a_non_boundary_translucent_fringe(self) -> None:
        from build_idle_atlas_30 import despill_edges, red_pink_hue_mask

        frame = Image.new("RGBA", (32, 32), (0, 0, 0, 0))
        for y in range(12, 21):
            for x in range(12, 21):
                frame.putpixel((x, y), (214, 174, 142, 128))
        # The pixel is surrounded by visible translucent pixels, so it is not
        # discoverable by a transparency-boundary-only check.
        frame.putpixel((16, 16), (158, 137, 147, 137))

        cleaned = despill_edges(frame)
        rgba = np.asarray(cleaned)

        self.assertEqual(rgba[16, 16, 3], 0)
        self.assertFalse(red_pink_hue_mask(rgba[..., 0], rgba[..., 1], rgba[..., 2])[16, 16])

    def test_validate_uses_fur_palette_for_sequence_color_drift_not_action_props(self) -> None:
        from build_idle_atlas_30 import validate_action_sequence

        frames = []
        for prop_color in ((54, 142, 208, 255), (232, 143, 58, 255)):
            frame = Image.new("RGBA", (64, 64), (0, 0, 0, 0))
            frame.paste((214, 174, 142, 255), (4, 4, 34, 34))
            # Props can occupy more pixels than the visible fur. Their color
            # must not become the sequence's fur-color signature.
            frame.paste(prop_color, (38, 4, 62, 58))
            frames.append(frame)

        report = validate_action_sequence(
            frames, reference_rgb=(214, 174, 142), safe_inset=0
        )

        self.assertLessEqual(report["colorDrift"], 5)
        self.assertTrue(report["ok"])

    def test_validate_still_rejects_extreme_body_fur_color_drift(self) -> None:
        from build_idle_atlas_30 import validate_action_sequence

        frames = []
        for fur_color in ((214, 174, 142, 255), (80, 180, 220, 255)):
            frame = Image.new("RGBA", (64, 64), (0, 0, 0, 0))
            frame.paste(fur_color, (20, 20, 40, 50))
            frames.append(frame)

        report = validate_action_sequence(
            frames, reference_rgb=(214, 174, 142), safe_inset=0
        )

        self.assertGreater(report["colorDrift"], 20)
        self.assertFalse(report["ok"])

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
