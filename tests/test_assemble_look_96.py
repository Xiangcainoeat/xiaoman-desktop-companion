import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))


class AssembleLook96Test(unittest.TestCase):
    def test_maps_every_third_frame_to_an_anchor_and_others_to_generated_cells(self) -> None:
        import assemble_look_96

        mappings = assemble_look_96.source_mapping()

        self.assertEqual(len(mappings), 96)
        self.assertEqual(mappings[0], {"kind": "anchor", "anchor": 0})
        self.assertEqual(mappings[1], {"kind": "generated", "batch": 0, "cell": 0})
        self.assertEqual(mappings[2], {"kind": "generated", "batch": 0, "cell": 1})
        self.assertEqual(mappings[3], {"kind": "anchor", "anchor": 1})
        self.assertEqual(mappings[93], {"kind": "anchor", "anchor": 31})
        self.assertEqual(mappings[94], {"kind": "generated", "batch": 7, "cell": 6})
        self.assertEqual(mappings[95], {"kind": "generated", "batch": 7, "cell": 7})

    def test_targets_only_the_two_known_lower_hemisphere_seams_for_repair(self) -> None:
        import assemble_look_96

        self.assertEqual(assemble_look_96.seam_repair_mapping(), {
            46: 0,
            47: 1,
            70: 2,
            71: 3,
        })


if __name__ == "__main__":
    unittest.main()
