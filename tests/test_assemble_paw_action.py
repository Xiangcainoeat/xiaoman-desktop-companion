import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))


class AssemblePawActionTest(unittest.TestCase):
    def test_paw_sequence_is_lift_hold_lower_with_ten_frames_each(self) -> None:
        import assemble_paw_action_30

        mapping = assemble_paw_action_30.paw_source_mapping()

        self.assertEqual(len(mapping), 30)
        self.assertEqual(mapping[:10], [
            {"phase": "lift", "sheetCell": index} for index in range(10)
        ])
        self.assertEqual(mapping[10:20], [
            {"phase": "hold", "sheetCell": index} for index in range(10)
        ])
        self.assertEqual(mapping[20:], [
            {"phase": "lower", "sheetCell": index} for index in range(10)
        ])

    def test_generated_sheet_has_five_by_two_source_grid(self) -> None:
        import assemble_paw_action_30

        self.assertEqual(assemble_paw_action_30.PAW_SOURCE_COLUMNS, 5)
        self.assertEqual(assemble_paw_action_30.PAW_SOURCE_ROWS, 2)
        self.assertEqual(assemble_paw_action_30.PAW_FRAMES_PER_SHEET, 10)


if __name__ == "__main__":
    unittest.main()
