#!/usr/bin/env python3
"""Generate app Info.plist, deriving Google callbacks from native Firebase config.

The committed template and optional Firebase plist stay untouched. Xcode calls
this before ProcessInfoPlistFile; no post-signing mutation is needed.
"""

import argparse
from pathlib import Path
import plistlib
import sys


def generate(template: Path, output: Path, firebase: Path, bundle_id: str) -> bool:
    with template.open("rb") as source:
        info = plistlib.load(source)
    info.pop("CFBundleURLTypes", None)
    configured = firebase.is_file()
    if configured:
        with firebase.open("rb") as source:
            config = plistlib.load(source)
        if not isinstance(config, dict):
            raise ValueError("Firebase configuration must be a plist dictionary")
        if config.get("PROJECT_ID") != "vocab-app-meir":
            raise ValueError("Firebase configuration must belong to vocab-app-meir")
        if config.get("BUNDLE_ID") != bundle_id:
            raise ValueError("Firebase BUNDLE_ID must match PRODUCT_BUNDLE_IDENTIFIER")
        client_id = config.get("CLIENT_ID", "")
        scheme = config.get("REVERSED_CLIENT_ID", "")
        if not isinstance(client_id, str) or not client_id.endswith(".apps.googleusercontent.com"):
            raise ValueError("Firebase configuration requires a native Google CLIENT_ID")
        if scheme != ".".join(reversed(client_id.split("."))):
            raise ValueError("Firebase REVERSED_CLIENT_ID must match the native CLIENT_ID")
        app_id = config.get("GOOGLE_APP_ID", "")
        if not isinstance(app_id, str) or ":ios:" not in app_id:
            raise ValueError("Firebase GOOGLE_APP_ID must be an iOS app identifier")
        info["CFBundleURLTypes"] = [{
            "CFBundleTypeRole": "Editor",
            "CFBundleURLSchemes": [scheme],
        }]

    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open("wb") as destination:
        plistlib.dump(info, destination, sort_keys=False)
    return configured


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--template", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--firebase", required=True, type=Path)
    parser.add_argument("--bundle-id", required=True)
    arguments = parser.parse_args()
    try:
        configured = generate(arguments.template, arguments.output, arguments.firebase, arguments.bundle_id)
    except (OSError, ValueError, plistlib.InvalidFileException) as error:
        print(f"error: Unable to generate app Info.plist: {error}", file=sys.stderr)
        return 1
    if not configured:
        print("warning: Native Firebase configuration is absent; cloud sign-in stays unavailable and offline learning remains enabled.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
