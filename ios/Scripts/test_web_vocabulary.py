"""Cross-platform vocabulary identities must stay compatible with Firestore word keys."""

import json
from pathlib import Path
import unittest


class WebVocabularyParityTests(unittest.TestCase):
    def test_all_native_words_keep_web_spelling_and_serial(self):
        repository = Path(__file__).resolve().parents[2]
        web = json.loads((repository / "vocab.json").read_text(encoding="utf-8-sig"))
        native = json.loads(
            (repository / "ios/VocabularyTrainer/Resources/vocabulary.json").read_text(encoding="utf-8-sig")
        )
        self.assertEqual(len(web), 9_998)
        self.assertEqual(len(native), len(web))
        self.assertEqual(len({entry["english"].lower() for entry in native}), len(native))
        # Web glosses are corrected independently of the paused native app, so
        # translations are intentionally not compared. Original spelling is the Firestore map key; the source serial selects
        # the same 100-word band on either client. Preserve gaps from duplicates.
        self.assertEqual(
            [(entry["rank"], entry["english"]) for entry in native],
            [(entry["r"], entry["w"]) for entry in web],
            "iOS and web vocabulary identities, or original serials drifted",
        )


if __name__ == "__main__":
    unittest.main()
