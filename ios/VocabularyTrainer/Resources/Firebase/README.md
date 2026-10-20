# Native Firebase configuration

Download **GoogleService-Info.plist** for the iOS app registered in the existing
Firebase project **vocab-app-meir**, and place it in this folder. Keep its filename
unchanged. The file is ignored by Git; do not substitute the web Firebase config
or invent a native OAuth client ID.

The Firebase iOS app's bundle ID must exactly match the app target's
`PRODUCT_BUNDLE_IDENTIFIER` (currently `com.example.VocabularyTrainer`). If a
production bundle ID is registered instead, update both the target's Debug and
Release bundle IDs to that registered value. Enable Google as an Authentication
provider for the same Firebase project.

This folder is an Xcode folder resource, so an added plist is copied into the app
as `Firebase/GoogleService-Info.plist` without editing the project. Before Xcode
processes Info.plist, `ios/Scripts/generate_info_plist.py` reads the native plist
and registers its `REVERSED_CLIENT_ID` callback scheme in a generated Info.plist.
The checked-in template and downloaded Firebase configuration are never rewritten.
Invalid project, bundle ID or callback scheme fails the build with a clear error.

Without the native file, the app and XCTest target still build and local learning
works. Cloud sign-in explains that native Firebase setup is missing. No real
Firebase credentials or live user writes are used by the automated tests.

Dependencies are pinned directly in the Xcode project to Firebase Apple SDK
**12.19.2** and Google Sign-In **10.0.0**. Use **Xcode 26.2 or newer**. Resolve Swift
packages on a Mac before building. A `Package.resolved` file should be committed
only after a real Xcode resolution; no dependency lock is fabricated here.

References:

- [Firebase Apple setup](https://firebase.google.com/docs/ios/setup)
- [Firebase Google authentication](https://firebase.google.com/docs/auth/ios/google-signin)
- [Google Sign-In iOS setup](https://developers.google.com/identity/sign-in/ios/start-integrating)
- [Firebase Apple release notes](https://firebase.google.com/support/release-notes/ios)
