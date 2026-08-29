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


class LookAtlas96ScriptsTest(unittest.TestCase):
    def _write_frame(
        self,
        path: Path,
        *,
        color: tuple[int, int, int, int] = (222, 211, 185, 255),
        ghost: bool = False,
        offset_y: int = 0,
        background: tuple[int, int, int, int] = (0, 255, 0, 255),
    ) -> None:
        image = Image.new("RGBA", (32, 36), background)
        draw = ImageDraw.Draw(image)
        draw.rounded_rectangle((8, 7 + offset_y, 23, 32 + offset_y), radius=5, fill=color)
        if ghost:
            draw.rounded_rectangle((13, 7 + offset_y, 28, 32 + offset_y), radius=5, fill=(222, 211, 185, 116))
        image.save(path, "PNG")

    def _build_command(
        self,
        frames: list[Path],
        reference: Path,
        atlas: Path,
        metadata: Path,
    ) -> list[str]:
        command = [sys.executable, str(SCRIPTS / "build_look_atlas_96.py")]
        for frame in frames:
            command.extend(("--frame", str(frame)))
        command.extend(
            (
                "--reference",
                str(reference),
                "--output",
                str(atlas),
                "--metadata",
                str(metadata),
                "--frame-width",
                "40",
                "--frame-height",
                "44",
            )
        )
        return command

    def test_builder_requires_exactly_96_single_frame_inputs(self) -> None:
        result = subprocess.run(
            [
                sys.executable,
                str(SCRIPTS / "build_look_atlas_96.py"),
                "--frame",
                "one.png",
                "--output",
                "unused.webp",
                "--metadata",
                "unused.json",
                "--reference",
                "reference.png",
            ],
            cwd=ROOT,
            capture_output=True,
            text=True,
            check=False,
        )

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("expected exactly 96 --frame paths, got 1", result.stderr)

    def test_builds_12_by_8_single_subject_atlas_with_no_compositing(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            temporary = Path(directory)
            reference = temporary / "native-reference.png"
            self._write_frame(reference)
            frames: list[Path] = []
            for index in range(96):
                frame = temporary / f"frame-{index:03d}.png"
                self._write_frame(frame, color=(224, 212 + index % 2, 185, 255))
                frames.append(frame)

            atlas = temporary / "look-96.webp"
            metadata = temporary / "look-96.json"
            build = subprocess.run(
                self._build_command(frames, reference, atlas, metadata),
                cwd=ROOT,
                capture_output=True,
                text=True,
                check=False,
            )

            self.assertEqual(build.returncode, 0, build.stderr)
            payload = json.loads(metadata.read_text(encoding="utf-8"))
            self.assertEqual(payload["frameCount"], 96)
            self.assertEqual(payload["columns"], 12)
            self.assertEqual(payload["rows"], 8)
            self.assertEqual(payload["stepDegrees"], 3.75)
            self.assertEqual(payload["dimensions"], [480, 352])
            self.assertEqual(payload["compositing"], "none")
            self.assertEqual(payload["source"]["imageCount"], 96)
            self.assertLessEqual(payload["alphaSummary"]["maxMidAlphaRatio"], 0.08)
            self.assertLessEqual(payload["colorSummary"]["maxLightFurDistance"], 24)
            with Image.open(atlas) as image:
                self.assertEqual(image.format, "WEBP")
                self.assertEqual(image.mode, "RGBA")
                self.assertEqual(image.size, (480, 352))

    def test_verifier_rejects_a_double_exposure_frame(self) -> None:
        sys.path.insert(0, str(SCRIPTS))
        import verify_look_atlas_96 as verifier

        frames: list[Image.Image] = []
        for index in range(96):
            path = Path(tempfile.gettempdir()) / f"xiaoman-test-frame-{index:03d}.png"
            self._write_frame(
                path,
                ghost=index == 31,
                background=(0, 0, 0, 0),
            )
            frames.append(Image.open(path).convert("RGBA"))
        atlas = Image.new("RGBA", (40 * 12, 44 * 8), (0, 0, 0, 0))
        for index, frame in enumerate(frames):
            normalized = frame.resize((40, 44), Image.Resampling.NEAREST)
            atlas.alpha_composite(normalized, ((index % 12) * 40, (index // 12) * 44))
        metadata = {
            "frameCount": 96,
            "columns": 12,
            "rows": 8,
            "stepDegrees": 3.75,
            "frameWidth": 40,
            "frameHeight": 44,
            "dimensions": [480, 352],
            "compositing": "none",
        }

        report = verifier.verify(atlas, metadata, reference=frames[0], source_format="WEBP")

        self.assertFalse(report["ok"])
        self.assertTrue(any("mid-alpha" in error for error in report["errors"]), report["errors"])

    def test_verifier_rejects_red_shifted_light_fur(self) -> None:
        sys.path.insert(0, str(SCRIPTS))
        import verify_look_atlas_96 as verifier

        reference = Image.new("RGBA", (40, 44), (0, 0, 0, 0))
        ImageDraw.Draw(reference).rectangle((10, 8, 29, 40), fill=(222, 211, 185, 255))
        atlas = Image.new("RGBA", (40 * 12, 44 * 8), (0, 0, 0, 0))
        for index in range(96):
            frame = Image.new("RGBA", (40, 44), (0, 0, 0, 0))
            color = (244, 172, 151, 255) if index == 20 else (222, 211, 185, 255)
            ImageDraw.Draw(frame).rectangle((10, 8, 29, 40), fill=color)
            atlas.alpha_composite(frame, ((index % 12) * 40, (index // 12) * 44))
        metadata = {
            "frameCount": 96,
            "columns": 12,
            "rows": 8,
            "stepDegrees": 3.75,
            "frameWidth": 40,
            "frameHeight": 44,
            "dimensions": [480, 352],
            "compositing": "none",
        }

        report = verifier.verify(atlas, metadata, reference=reference, source_format="WEBP")

        self.assertFalse(report["ok"])
        self.assertTrue(any("light-fur color distance" in error for error in report["errors"]), report["errors"])


if __name__ == "__main__":
    unittest.main()
