import json
import sys
import tempfile
import unittest
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))


class CareAtlas30ContractTest(unittest.TestCase):
    def _metadata(self, name: str) -> dict:
        return json.loads((ROOT / "public/pet" / name).read_text())

    def _atlas_frame(self, atlas: Image.Image, row: int, index: int) -> Image.Image:
        column = index % 10
        atlas_row = row + index // 10
        return atlas.crop((column * 192, atlas_row * 208, (column + 1) * 192, (atlas_row + 1) * 208))

    def _synthetic_action_atlas(
        self,
        rows: int,
        action_rows: tuple[int, ...],
        width: int,
        height: int,
    ) -> Image.Image:
        atlas = Image.new("RGBA", (1920, rows * 208), (0, 0, 0, 0))
        for row in action_rows:
            for index in range(30):
                frame = Image.new("RGBA", (192, 208), (0, 0, 0, 0))
                left = 60 + index
                top = 130
                frame.paste((180, 145, 115, 255), (left, top, left + width, top + height))
                atlas.alpha_composite(frame, ((index % 10) * 192, (row + index // 10) * 208))
        return atlas

    def test_source_normalization_handles_eight_and_nine_column_sheets(self) -> None:
        import build_care_atlas_30

        sleep = Image.open(ROOT / "work/xiaoman-care-assets/sleep-source.png")
        care = Image.open(ROOT / "work/xiaoman-care-assets/care-source.png")

        self.assertEqual(len(build_care_atlas_30.extract_source_frames(sleep)), 24)
        self.assertEqual([len(row) for row in build_care_atlas_30._extract_source_rows(care)], [9, 10, 10])
        self.assertGreaterEqual(len(build_care_atlas_30.extract_source_frames(care)), 27)
        self.assertEqual(len(build_care_atlas_30.expand_to_frame_count(
            build_care_atlas_30.extract_source_frames(sleep), 30,
        )), 30)

    def test_source_crops_exclude_neighbor_fragments_inside_the_crop_margin(self) -> None:
        import build_care_atlas_30

        width, row_height = 1620, 324
        source = Image.new("RGB", (width, row_height * 3), (8, 202, 56))
        # Keep the target silhouettes comfortably above the activity threshold,
        # then place a short black seam just outside the first silhouette. The
        # seam is a neighboring-cell artifact, not part of the target pose.
        for row in range(3):
            top = row * row_height
            for column in range(10):
                left = 20 + column * 160
                source.paste((214, 174, 142), (left, top + 48, left + 80, top + 278))
                if row == 0 and column == 0:
                    source.paste((0, 0, 0), (left + 83, top + 170, left + 86, top + 198))

        first = build_care_atlas_30._extract_source_rows(source, tight=True)[0][0]
        pixels = np.asarray(first.convert("RGB"))

        self.assertEqual(first.width, 80)
        self.assertEqual(int(np.count_nonzero(np.max(pixels, axis=2) == 0)), 0)

    def test_source_cleanup_removes_only_the_known_edge_prop_from_prop_free_pose(self) -> None:
        import build_care_atlas_30

        matte = (18, 238, 28)
        source = Image.new("RGB", (96, 120), matte)
        draw = ImageDraw.Draw(source)
        draw.rectangle((24, 20, 72, 108), fill=(214, 174, 142))
        draw.ellipse((0, 76, 22, 103), fill=(38, 125, 214))
        # A small separated anti-aliased fragment is part of the same foreign
        # prop and must not survive merely because it is below the component
        # area threshold.
        draw.rectangle((0, 108, 4, 119), fill=(2, 19, 37))
        draw.ellipse((38, 44, 45, 51), fill=(38, 125, 214))
        draw.ellipse((53, 44, 60, 51), fill=(38, 125, 214))

        cleaned = build_care_atlas_30._remove_known_source_edge_prop(source, row=2, column=9)
        cleaned_pixels = np.asarray(cleaned)
        blue = (cleaned_pixels[..., 2] > cleaned_pixels[..., 0] + 30) & (
            cleaned_pixels[..., 2] > cleaned_pixels[..., 1] + 10
        )

        self.assertEqual(int(np.count_nonzero(blue[76:, :24])), 0)
        self.assertGreater(int(np.count_nonzero(blue[40:55, 35:65])), 0)
        self.assertEqual(tuple(cleaned_pixels[70, 40]), (214, 174, 142))

        other_pose = build_care_atlas_30._remove_known_source_edge_prop(source, row=2, column=8)
        self.assertGreater(int(np.count_nonzero(np.asarray(other_pose)[76:, :24, 2] > 180)), 0)

    def test_built_atlases_have_contract_dimensions_and_non_empty_cells(self) -> None:
        import build_care_atlas_30

        with tempfile.TemporaryDirectory() as directory:
            output_dir = Path(directory)
            result = build_care_atlas_30.build_assets(
                ROOT / "work/xiaoman-care-assets/sleep-source.png",
                ROOT / "work/xiaoman-care-assets/care-source.png",
                output_dir,
            )

            for name, metadata_name in (
                ("sleeping-30.webp", "sleeping-30.json"),
                ("care-actions-30.webp", "care-actions-30.json"),
            ):
                atlas = Image.open(output_dir / name).convert("RGBA")
                metadata = json.loads((output_dir / metadata_name).read_text())
                self.assertEqual(atlas.size, (1920, 624 if "sleeping" in name else 1248))
                self.assertEqual(metadata["frameCount"], 30)
                self.assertEqual(metadata["columns"], 10)
                self.assertEqual(metadata["frameWidth"], 192)
                self.assertEqual(metadata["frameHeight"], 208)
                expected_reports = 30 if "sleeping" in name else 60
                self.assertEqual(len(result["reports"][metadata_name[:-5]]), expected_reports)
                for index in range(30):
                    row = index // 10
                    column = index % 10
                    frame = atlas.crop((column * 192, row * 208, (column + 1) * 192, (row + 1) * 208))
                    self.assertGreater(sum(1 for pixel in frame.getchannel("A").get_flattened_data() if pixel >= 10), 5000)

    def test_care_metadata_preserves_bath_and_feed_rows(self) -> None:
        import build_care_atlas_30

        with tempfile.TemporaryDirectory() as directory:
            output_dir = Path(directory)
            build_care_atlas_30.build_assets(
                ROOT / "work/xiaoman-care-assets/sleep-source.png",
                ROOT / "work/xiaoman-care-assets/care-source.png",
                output_dir,
            )
            metadata = json.loads((output_dir / "care-actions-30.json").read_text())
            self.assertEqual(metadata["actions"]["bath"]["atlasFramePosition"], {"row": 0, "frames": 30, "columns": 10})
            self.assertEqual(metadata["actions"]["feed"]["atlasFramePosition"], {"row": 3, "frames": 30, "columns": 10})
            self.assertEqual(metadata["actions"]["gift"]["atlasFramePosition"], {"row": 3, "frames": 30, "columns": 10})

    def test_every_care_contract_frame_is_non_empty_and_has_transparent_corners(self) -> None:
        atlas = Image.open(ROOT / "public/pet/care-actions-30.webp").convert("RGBA")
        for row in (0, 3):
            for index in range(30):
                frame = self._atlas_frame(atlas, row, index)
                self.assertGreater(np.count_nonzero(np.asarray(frame.getchannel("A")) >= 10), 5000)
                self.assertEqual([frame.getpixel(point)[3] for point in ((0, 0), (191, 0), (0, 207), (191, 207))], [0, 0, 0, 0])

    def test_both_atlases_keep_native_light_fur_palette(self) -> None:
        reference = np.asarray(Image.open(ROOT / "work/xiaoman-pet-96/generation-inputs/native-color-reference.png").convert("RGBA"))

        def light_fur(image: np.ndarray) -> np.ndarray:
            rgb = image[..., :3].astype(int)
            mask = (image[..., 3] > 200) & (rgb[..., 0] > 150) & (rgb[..., 1] > 100) & (rgb[..., 0] - rgb[..., 1] < 100) & (rgb[..., 1] - rgb[..., 2] > 5)
            return np.median(rgb[mask], axis=0)

        expected = light_fur(reference)
        for name in ("sleeping-30.webp", "care-actions-30.webp"):
            actual = light_fur(np.asarray(Image.open(ROOT / "public/pet" / name).convert("RGBA")))
            self.assertLessEqual(float(np.max(np.abs(actual - expected))), 60, name)

    def test_verifier_validates_supplied_metadata_and_action_rows(self) -> None:
        import verify_care_atlas_30

        fixtures = (
            ("sleep", "sleeping-30.webp", "sleeping-30.json", {"sleep": 0}),
            ("care", "care-actions-30.webp", "care-actions-30.json", {"bath": 0, "feed": 3, "gift": 3}),
        )
        for kind, atlas_name, metadata_name, expected_rows in fixtures:
            atlas = Image.open(ROOT / "public/pet" / atlas_name).convert("RGBA")
            metadata = self._metadata(metadata_name)
            report = verify_care_atlas_30.verify(atlas, metadata, kind)
            self.assertTrue(report["ok"], report["errors"])
            self.assertEqual(report["checkedRows"], sorted(set(expected_rows.values())))
            for action, row in expected_rows.items():
                self.assertEqual(report["actions"][action]["row"], row)
                self.assertEqual(report["actions"][action]["frames"], 30)

        atlas = Image.open(ROOT / "public/pet/care-actions-30.webp").convert("RGBA")
        metadata = self._metadata("care-actions-30.json")
        for path, value, needle in (
            (("dimensions",), [1920, 624], "metadata dimensions"),
            (("cell",), [96, 104], "metadata cell"),
            (("columns",), 9, "metadata columns"),
            (("rows",), 3, "metadata rows"),
            (("frameCount",), 29, "metadata frameCount"),
            (("frameWidth",), 96, "metadata frameWidth"),
            (("frameHeight",), 104, "metadata frameHeight"),
            (("actions", "bath", "atlasFramePosition", "row"), 1, "bath"),
            (("actions", "feed", "atlasFramePosition", "frames"), 29, "feed"),
            (("frames", 0, "action"), "feed-gift", "frame entry"),
            (("frames", 0, "frame"), 1, "frame entry"),
        ):
            malformed = json.loads(json.dumps(metadata))
            target = malformed
            for key in path[:-1]:
                target = target[key]
            target[path[-1]] = value
            report = verify_care_atlas_30.verify(atlas, malformed, "care")
            self.assertFalse(report["ok"], path)
            self.assertTrue(any(needle in error for error in report["errors"]), report["errors"])

        for malformed, needle in (
            ({**metadata, "actions": {"bath": metadata["actions"]["bath"]}}, "metadata actions"),
            ({**metadata, "actions": {**metadata["actions"], "extra": {}}}, "metadata actions"),
            ({**metadata, "frames": metadata["frames"][:-1]}, "metadata frame entries count"),
        ):
            report = verify_care_atlas_30.verify(atlas, malformed, "care")
            self.assertFalse(report["ok"])
            self.assertTrue(any(needle in error for error in report["errors"]), report["errors"])

    def test_verifier_rejects_mid_alpha_and_green_magenta_red_pink_edges(self) -> None:
        import verify_care_atlas_30

        atlas = Image.open(ROOT / "public/pet/care-actions-30.webp").convert("RGBA")
        metadata = self._metadata("care-actions-30.json")
        frame = self._atlas_frame(atlas, 0, 0)
        alpha = np.asarray(frame.getchannel("A"))
        boundary = (alpha >= 10) & (
            np.roll(alpha < 10, 1, axis=0) | np.roll(alpha < 10, -1, axis=0)
            | np.roll(alpha < 10, 1, axis=1) | np.roll(alpha < 10, -1, axis=1)
        )
        boundary[[0, -1], :] = False
        boundary[:, [0, -1]] = False
        point = tuple(int(value) for value in np.argwhere(boundary)[0][::-1])
        fixtures = {
            "green": (0, 255, 0, 128),
            "magenta": (255, 0, 255, 128),
            "red-pink": (255, 40, 120, 128),
        }
        for label, color in fixtures.items():
            mutated = atlas.copy()
            x, y = point
            mutated.putpixel((x, y), color)
            report = verify_care_atlas_30.verify(mutated, metadata, "care")
            self.assertFalse(report["ok"], label)
            self.assertTrue(any(label in error for error in report["errors"]), report["errors"])

    def test_verifier_rejects_opaque_red_pink_edge_contamination(self) -> None:
        import verify_care_atlas_30

        atlas = Image.open(ROOT / "public/pet/care-actions-30.webp").convert("RGBA")
        metadata = self._metadata("care-actions-30.json")
        frame = self._atlas_frame(atlas, 0, 0)
        alpha = np.asarray(frame.getchannel("A"))
        boundary = (alpha >= 10) & (
            np.roll(alpha < 10, 1, axis=0) | np.roll(alpha < 10, -1, axis=0)
            | np.roll(alpha < 10, 1, axis=1) | np.roll(alpha < 10, -1, axis=1)
        )
        boundary[[0, -1], :] = False
        boundary[:, [0, -1]] = False
        x, y = (int(value) for value in np.argwhere(boundary)[0][::-1])
        mutated = atlas.copy()
        mutated.putpixel((x, y), (255, 40, 120, 255))
        report = verify_care_atlas_30.verify(mutated, metadata, "care")
        self.assertFalse(report["ok"])
        self.assertTrue(any("red-pink edge contamination" in error for error in report["errors"]), report["errors"])

    def test_verifier_rejects_hidden_rgb_and_nontransparent_corners(self) -> None:
        import verify_care_atlas_30

        metadata = self._metadata("sleeping-30.json")
        atlas = Image.open(ROOT / "public/pet/sleeping-30.webp").convert("RGBA")

        hidden_rgb = atlas.copy()
        hidden_rgb.putpixel((0, 0), (7, 11, 13, 0))
        report = verify_care_atlas_30.verify(hidden_rgb, metadata, "sleep")
        self.assertFalse(report["ok"])
        self.assertTrue(any("transparent pixels retain RGB" in error for error in report["errors"]))

        opaque_corner = atlas.copy()
        opaque_corner.putpixel((0, 0), (220, 180, 150, 255))
        report = verify_care_atlas_30.verify(opaque_corner, metadata, "sleep")
        self.assertFalse(report["ok"])
        self.assertTrue(any("opaque corner" in error for error in report["errors"]))

    def test_verifier_checks_white_charcoal_checkerboard_and_rejects_black_rectangles(self) -> None:
        import verify_care_atlas_30

        metadata = self._metadata("sleeping-30.json")
        atlas = self._synthetic_action_atlas(3, (0,), width=70, height=64)
        clean_report = verify_care_atlas_30.verify(atlas, metadata, "sleep")

        self.assertTrue(clean_report["ok"], clean_report["errors"])
        self.assertEqual(
            set(clean_report["backgrounds"]),
            {"white", "charcoal", "checkerboard"},
        )
        for background in clean_report["backgrounds"]:
            self.assertEqual(clean_report["backgroundChecks"][background]["blackRectangles"], 0)

        contaminated = atlas.copy()
        frame = self._atlas_frame(contaminated, 0, 0)
        draw = ImageDraw.Draw(frame)
        draw.rectangle((18, 18, 54, 58), fill=(0, 0, 0, 255))
        contaminated.alpha_composite(frame, (0, 0))
        report = verify_care_atlas_30.verify(contaminated, metadata, "sleep")

        self.assertFalse(report["ok"])
        self.assertTrue(any("black rectangle" in error for error in report["errors"]), report["errors"])

    def test_verifier_allows_small_irregular_dark_subject_detail(self) -> None:
        import verify_care_atlas_30

        metadata = self._metadata("sleeping-30.json")
        atlas = self._synthetic_action_atlas(3, (0,), width=70, height=64)
        frame = self._atlas_frame(atlas, 0, 0)
        draw = ImageDraw.Draw(frame)
        draw.ellipse((82, 142, 92, 152), fill=(0, 0, 0, 255))
        draw.line((80, 156, 87, 161), fill=(0, 0, 0, 255), width=2)
        atlas.alpha_composite(frame, (0, 0))

        report = verify_care_atlas_30.verify(atlas, metadata, "sleep")

        self.assertTrue(report["ok"], report["errors"])
        self.assertEqual(report["backgroundChecks"]["charcoal"]["blackRectangles"], 0)

    def test_verifier_rejects_a_large_black_block_even_when_subject_pixels_make_holes(self) -> None:
        import verify_care_atlas_30

        metadata = self._metadata("sleeping-30.json")
        atlas = self._synthetic_action_atlas(3, (0,), width=70, height=64)
        frame = self._atlas_frame(atlas, 0, 0)
        draw = ImageDraw.Draw(frame)
        draw.rectangle((16, 16, 78, 190), fill=(0, 0, 0, 255))
        # This hole makes the black component non-rectangular, matching the
        # failure mode where a black background wraps around a cutout subject.
        draw.rectangle((36, 48, 58, 158), fill=(0, 0, 0, 0))
        atlas.alpha_composite(frame, (0, 0))

        report = verify_care_atlas_30.verify(atlas, metadata, "sleep")

        self.assertFalse(report["ok"])
        self.assertTrue(any("black rectangle" in error for error in report["errors"]), report["errors"])

    def test_light_fur_stays_close_to_native_palette(self) -> None:
        import numpy as np

        reference = np.asarray(Image.open(ROOT / "work/xiaoman-pet-96/generation-inputs/native-color-reference.png").convert("RGBA"))
        atlas = np.asarray(Image.open(ROOT / "public/pet/sleeping-30.webp").convert("RGBA"))

        def light_fur(image: object) -> np.ndarray:
            pixels = np.asarray(image)
            rgb = pixels[..., :3].astype(int)
            mask = (pixels[..., 3] > 200) & (rgb[..., 0] > 150) & (rgb[..., 1] > 100) & (rgb[..., 0] - rgb[..., 1] < 100) & (rgb[..., 1] - rgb[..., 2] > 5)
            return np.median(rgb[mask], axis=0)

        self.assertLessEqual(float(np.max(np.abs(light_fur(atlas) - light_fur(reference)))), 60)

    def test_verifier_rejects_wrong_dimensions_and_empty_frames(self) -> None:
        import verify_care_atlas_30

        report = verify_care_atlas_30.verify(Image.new("RGBA", (192, 208), (0, 0, 0, 0)), self._metadata("sleeping-30.json"), "sleep")
        self.assertFalse(report["ok"])
        self.assertTrue(any("dimensions" in error or "empty" in error for error in report["errors"]))

    def test_verifier_allows_compact_sleep_body_but_rejects_a_tiny_body(self) -> None:
        import verify_care_atlas_30

        metadata = self._metadata("sleeping-30.json")
        compact = self._synthetic_action_atlas(3, (0,), width=70, height=64)
        compact_report = verify_care_atlas_30.verify(compact, metadata, "sleep")
        self.assertTrue(compact_report["ok"], compact_report["errors"])
        self.assertEqual(compact_report["actions"]["sleep"]["emptyFrames"], 0)

        tiny = self._synthetic_action_atlas(3, (0,), width=20, height=20)
        tiny_report = verify_care_atlas_30.verify(tiny, metadata, "sleep")
        self.assertFalse(tiny_report["ok"])
        self.assertTrue(any("sleep frame 0 is empty" in error for error in tiny_report["errors"]))

    def test_verifier_keeps_care_body_floor_at_five_thousand_visible_pixels(self) -> None:
        import verify_care_atlas_30

        metadata = self._metadata("care-actions-30.json")
        compact_care = self._synthetic_action_atlas(6, (0, 3), width=70, height=64)
        report = verify_care_atlas_30.verify(compact_care, metadata, "care")

        self.assertFalse(report["ok"])
        self.assertTrue(any("bath frame 0 is empty" in error for error in report["errors"]))
        self.assertTrue(any("feed-gift frame 0 is empty" in error for error in report["errors"]))


if __name__ == "__main__":
    unittest.main()
