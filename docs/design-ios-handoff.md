# Design and iOS handoff

Branch: `chatgpt-design-ios`, based on `28993d48ff91dc3b2a0e8249866073e8ddd437b9`.

## Parallel work boundary

The concurrent `v2-cloud-sync` branch changes `app.js`, `firebase-config.js`, `index.html`, `styles.css`, `sw.js`, and `vocab.json` (observed head `93802b1ef149110787062e08e77c924e9725a701`). The user asked us to stop where work overlaps. Consequently **none of those production files is changed here**, and this branch is not merged into `main`.

The initial visual proposal was preserved under `design-preview/`. It is a static review artifact with example answers and inactive controls. It does not load the real quiz or change progress. Its responsive layout was checked at 1440px, 390px, and 320px, plus 200% text size; no horizontal overflow and all visible buttons at least 44px high.

## What can be reviewed separately

- Native iOS Home and Quiz UI: cream/forest palette, semantic feedback symbols, large text layouts, English speech language, and explicit question/feedback accessibility focus.
- Complete bundled vocabulary and the offline data validation/refresh pipeline. Source column C is English; column I is Hebrew. The source has 10,000 usable rows and 9,998 unique words; two exact duplicate word/translation pairs are documented in the manifest.
- The iOS repository uses the complete bundle immediately and keeps a usable local library if refresh fails. Source ranks, entry identity, progress storage, and the quiz engine are preserved.

## Web integration blocked by concurrent scope

After the other agent finishes, its owner should:

1. Compare the verified `data/vocabulary.json` and its manifest with the parallel branch's `vocab.json`. Keep its serial/identity policy; this branch does not redefine it.
2. Connect the complete asset to the web loader and service-worker offline cache in the rewritten core. Do not import the static preview as a functioning app.
3. Apply the visual direction to the final DOM, retaining the rewritten core's hooks. Review question, correct/incorrect feedback, long translations, loading/failure, and summary states.
4. Ensure the PWA updates cached app assets, so installed clients actually receive the design and library. Cache lifecycle changes belong to the parallel core work.
5. Verify installed iOS Safari and Android Chrome, keyboard use, screen reader announcements, large text, first offline launch after installation, and preservation of existing progress.

## Native validation

Windows cannot run Xcode or an iPhone simulator. Source review and offline data checks are local; the macOS CI workflow performs the native build and XCTest run. The native CI run passed with all 12 XCTest tests successful; a real-device review remains required before release. No App Store upload, signing change, Firebase integration, or production deployment is part of this branch.
