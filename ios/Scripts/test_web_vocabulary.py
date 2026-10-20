"""Cross-platform vocabulary identities must stay compatible with Firestore word keys."""

import json
from pathlib import Path
import unittest


class WebVocabularyParityTests(unittest.TestCase):
    def test_all_native_words_keep_web_spelling_serial_and_translation(self):
        repository = Path(__file__).resolve().parents[2]
        web = json.loads((repository / "vocab.json").read_text(encoding="utf-8-sig"))
        native = json.loads(
            (repository / "ios/VocabularyTrainer/Resources/vocabulary.json").read_text(encoding="utf-8-sig")
        )
        self.assertEqual(len(web), 9_998)
        self.assertEqual(len(native), len(web))
        self.assertEqual(len({entry["english"].lower() for entry in native}), len(native))
        # Original spelling is the Firestore map key; the source serial selects
        # the same 100-word band on either client. Preserve gaps from duplicates.
        self.assertEqual(
            [(entry["rank"], entry["english"], entry["hebrew"]) for entry in native],
            [(entry["r"], entry["w"], entry["t"]) for entry in web],
            "iOS and web vocabulary identities, original serials or translations drifted",
        )


if __name__ == "__main__":
    unittest.main()
