import copy
from pathlib import Path
import plistlib
import tempfile
import unittest

from generate_info_plist import generate


class GenerateInfoPlistTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.template = self.root / "Info.plist"
        self.output = self.root / "Derived" / "Info.plist"
        self.firebase = self.root / "Firebase" / "GoogleService-Info.plist"
        self.bundle_id = "com.example.VocabularyTrainer"
        self.info = {"CFBundleIdentifier": "$(PRODUCT_BUNDLE_IDENTIFIER)", "CFBundleDisplayName": "ארבע מילים"}
        self.template.write_bytes(plistlib.dumps(self.info))
        self.config = {
            "PROJECT_ID": "vocab-app-meir",
            "BUNDLE_ID": self.bundle_id,
            "CLIENT_ID": "12345-native.apps.googleusercontent.com",
            "REVERSED_CLIENT_ID": "com.googleusercontent.apps.12345-native",
            "GOOGLE_APP_ID": "1:12345:ios:test",
        }

    def write_config(self, **changes):
        config = copy.deepcopy(self.config)
        config.update(changes)
        self.firebase.parent.mkdir(exist_ok=True)
        self.firebase.write_bytes(plistlib.dumps(config))

    def run_generator(self):
        return generate(self.template, self.output, self.firebase, self.bundle_id)

    def test_missing_configuration_builds_offline_without_a_placeholder_scheme(self):
        self.assertFalse(self.run_generator())
        self.assertEqual(plistlib.loads(self.output.read_bytes()), self.info)

    def test_native_configuration_registers_its_exact_callback_scheme(self):
        self.write_config()
        original_config = self.firebase.read_bytes()
        self.assertTrue(self.run_generator())
        result = plistlib.loads(self.output.read_bytes())
        self.assertEqual(result["CFBundleURLTypes"][0]["CFBundleURLSchemes"], [self.config["REVERSED_CLIENT_ID"]])
        self.assertEqual(result["CFBundleIdentifier"], "$(PRODUCT_BUNDLE_IDENTIFIER)")
        self.assertEqual(self.firebase.read_bytes(), original_config)
        self.assertEqual(plistlib.loads(self.template.read_bytes()), self.info)

    def test_another_project_is_rejected(self):
        self.write_config(PROJECT_ID="another-project")
        with self.assertRaisesRegex(ValueError, "vocab-app-meir"):
            self.run_generator()
        self.assertFalse(self.output.exists())

    def test_another_bundle_is_rejected(self):
        self.write_config(BUNDLE_ID="com.other.app")
        with self.assertRaisesRegex(ValueError, "BUNDLE_ID"):
            self.run_generator()

    def test_mismatched_callback_is_rejected(self):
        self.write_config(REVERSED_CLIENT_ID="com.googleusercontent.apps.other")
        with self.assertRaisesRegex(ValueError, "REVERSED_CLIENT_ID"):
            self.run_generator()

    def test_web_app_configuration_is_rejected(self):
        self.write_config(GOOGLE_APP_ID="1:12345:web:test")
        with self.assertRaisesRegex(ValueError, "iOS"):
            self.run_generator()


if __name__ == "__main__":
    unittest.main()
