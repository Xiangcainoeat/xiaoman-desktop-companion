import sys
import tempfile
import unittest
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "scripts"
sys.path.insert(0, str(SCRIPTS))

import build_head_look_atlas_96 as builder
import verify_head_look_atlas_96 as verifier


class HeadLookAtlas96Test(unittest.TestCase):
    def test_builds_registered_spatial_only_head_atlas(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            temporary = Path(directory)
            source_dir = temporary / "source"
            source_dir.mkdir()

            body = Image.new("RGBA", (builder.FRAME_WIDTH, builder.FRAME_HEIGHT), (0, 0, 0, 0))
            body_draw = ImageDraw.Draw(body)
            body_draw.ellipse((12, 7, 116, 196), fill=(225, 195, 158, 255))
            body_draw.ellipse((39, 61, 63, 81), fill=(45, 100, 160, 255))
            body_draw.ellipse((72, 58, 98, 80), fill=(45, 100, 160, 255))
            body_path = temporary / "body.webp"
            body.save(body_path, "WEBP", lossless=True)

            for index in range(builder.FRAME_COUNT):
                frame = Image.new("RGBA", (builder.FRAME_WIDTH, builder.FRAME_HEIGHT), (0, 0, 0, 0))
                draw = ImageDraw.Draw(frame)
                shift = (index % 7) - 3
                draw.ellipse(
                    (45 + shift, 26, 137 + shift, 132),
                    fill=(100 + index, 116, 78, 255),
                )
                frame.save(source_dir / f"frame-{index:03d}.png")

            atlas, metadata, frames = builder.build_atlas(source_dir, body_path)
            report = verifier.verify(atlas, metadata, source_format="WEBP")

            self.assertTrue(report["ok"], report["errors"])
            self.assertEqual(atlas.size, (builder.FRAME_WIDTH * builder.COLUMNS, builder.FRAME_HEIGHT * builder.ROWS))
            self.assertEqual(metadata["compositing"], "spatial-mask-only")
            self.assertFalse(metadata["temporalBlend"])
            self.assertEqual(metadata["paletteGrade"]["reference"], str(body_path))
            self.assertEqual(len(frames), builder.FRAME_COUNT)
            for frame in frames:
                pixels = np.asarray(frame.convert("RGBA"), dtype=np.uint8)
                self.assertEqual(
                    int(np.count_nonzero((pixels[..., 3] == 0) & np.any(pixels[..., :3] != 0, axis=2))),
                    0,
                )


if __name__ == "__main__":
    unittest.main()
