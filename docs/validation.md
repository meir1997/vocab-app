# Validation record

## Complete vocabulary

- Source: supplied Google Sheet, tab גיליון1, gid 0; columns C (English) and I (translation).
- 10,000 source rows become 9,998 unique English words; zero rows lack a word or translation.
- Exact duplicate pairs: ll (ranks 8,486 and 8,854) and cause (412 and 9,542). The original first-occurrence policy is preserved.
- All generated entries were independently compared against the CSV with a second CSV reader. All file byte counts and SHA-256 hashes matched.
- Four importer tests pass locally and in GitHub Actions, including malformed quotes, quoted commas/newlines, CRLF, BOM, first-occurrence policy, incomplete sources, conflicting duplicate translations, and complete deterministic outputs.
- `node scripts/vocabulary.mjs --check` passes without network access. Raw CSV bytes are preserved; whitespace checks are disabled only for that source snapshot. Generated JSON uses LF on all platforms so checksum validation is portable.

## Source content follow-up

90 translation values contain no Hebrew characters; 82 are identical to the English word, ignoring case. This is a review queue rather than a claim that every item is incorrect: names, abbreviations, and numeric entries may be intentional. For example, an→an and who→WHO deserve editorial review. All source text is retained; the source Sheet is unchanged.

## Visual and native UI review

The separate static web proposal was rendered at 1440×1000, 390×844, 320×812, and 390×844 with 200% text size. No horizontal overflow was observed; visible controls were at least 44 pixels high. Desktop/mobile screenshots and the help dialog were visually reviewed. This does not certify the rewritten production web app.

Ten native text/background pairs passed contrast calculations for AA (minimum 5.11:1). The native code supports large text layouts, RTL Hebrew with LTR English, English speech attributes, dark appearance, semantic feedback, explicit continuation, and Reduce Motion. The new app icon is an opaque 1024×1024 PNG based on the existing four/check artwork, with an editable SVG source.

The new XCTest suite covers complete first-launch offline loading, incomplete legacy cache replacement, failed/partial refresh preservation, valid refresh persistence, and CSV edge cases. Its shared scheme and resource registrations were inspected. Native build and simulator results are recorded by `.github/workflows/ios-validation.yml`; physical-device, VoiceOver, and large-text visual checks remain release checks.

## Scope verification

Explicit comparison against the starting commit confirms no edits to app.js, firebase-config.js, index.html, styles.css, sw.js, vocab.json, manifest.webmanifest, icon.svg, Models, ProgressStore, QuizEngine, or QuizViewModel. The concurrent web changes have since merged separately into main. This branch remains a draft, without merging or deploying it.

## Native CI result

[GitHub Actions run 39374801029](https://github.com/meir1997/vocab-app/actions/runs/39374801029) succeeded on the tested code commit `97cbcbaa2b2737025428cfaceb68325215471d55`, combined with main `1a33e3c8e5f28ed9957faf1fd0f6229eedbba282`:

- The iOS app compiled successfully for an iPhone simulator.
- All 12 XCTest tests passed (eight data/repository tests and four existing parser/quiz tests).
- Offline vocabulary verification and all four Node tests passed.
- The [Xcode result bundle](https://github.com/meir1997/vocab-app/actions/runs/39374801029/artifacts/12242732267) was uploaded for inspection.

The final follow-up commit contains documentation only; native code and data are unchanged from this passing run. Physical iPhone, VoiceOver interaction, and large-text visual review remain recommended before shipping an iOS release.
