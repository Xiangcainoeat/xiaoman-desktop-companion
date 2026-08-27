import json
import sys
import tempfile
import unittest
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))


class CareAtlas30ContractTest(unittest.TestCase):
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

        report = verify_care_atlas_30.verify(Image.new("RGBA", (192, 208), (0, 0, 0, 0)), "sleep")
        self.assertFalse(report["ok"])
        self.assertTrue(any("dimensions" in error or "empty" in error for error in report["errors"]))


if __name__ == "__main__":
    unittest.main()
