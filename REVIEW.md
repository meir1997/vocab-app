# Sense-aligned example review — 2026-10-23

Follow-up to merged PR 13 (`591ed5a`). This is a web content correction; source
translations, learning rules, scoring, sync and native iOS code are unchanged.

## Result

Correction feedback, word cards and quiz prompt context now share one rule:
show only an authored, reviewed sentence whose stored Hebrew meaning matches
the displayed primary meaning after normalization. Otherwise there is no
example block or unavailable-example placeholder. Reverse and typing prompts
mask the English target. Missing or late details cannot weaken this rule.

Generated WordNet/Tatoeba sentences are not evidence of sense alignment. The
generator selects sentences independently and truncates/filters definitions,
so even a single retained definition is insufficient. Generated reference
definitions and synonyms remain available in their existing disclosures.

Added 240 reviewed sentences for confident source senses within the top 300
frequency ranks. All additions and original examples were checked against the
source Hebrew. Removed the old `reason = לנמק` sentence because “reason out”
teaches deducing rather than justifying. Questionable source mappings such as
`the = את` stay without examples; translations were not rewritten.

The requested cases now use:

| Word | Displayed sense (without niqqud) | Authored example |
| --- | --- | --- |
| for | עבור | This gift is for you. |
| it | זה | What is it? It is a small bird. |
| as | כמו | Do as I do. |
| right | ימינה | Turn right at the next street. |

## Coverage report

Counts describe rendered examples, with the committed details loaded. The
same reviewed gate now applies with or without those optional details.

| Measure | PR 13 | This change |
| --- | ---: | ---: |
| All words showing an example | 9,816 / 9,998 | 299 / 9,998 |
| All words without an example | 182 | 9,699 |
| Reviewed examples / prompt contexts | 60 | 299 |
| Top-300 words showing an example | 299 / 300 | 259 / 300 |
| Reviewed top-300 examples / prompt contexts | 19 | 259 |

Reproduce with `node scripts/example-coverage.cjs`. The baseline is the merged
PR 13 commit. `docs/example-coverage.json` contains the full report, including
all 41 top-300 words whose examples remain omitted.

## Rendered screenshot review

The primary agent opened and inspected all 24 final PNGs: quiz prompt,
I-don’t-know correction and word card for `for`, `it`, `as` and `right`, at
390×844 (mobile/touch Chromium emulation) and 1440×1000 desktop. These are real
production DOM renders, not mockups or native Safari captures. Fresh ephemeral
contexts block Firebase, external requests and service workers, and use only
synthetic session/progress state with the real vocabulary and details files.

All four cases show the matching sentence on every requested surface. Hebrew
stays RTL and English sentences LTR. Meaning, sentence and Continue are fully
visible above navigation in all eight correction images. Cards fit both
viewports, with unrelated reference senses collapsed. No page errors occurred.
The footer now accurately distinguishes authored examples from WordNet data.

Screenshot folder:
`C:\Users\meirc\Documents\vocab-app-sense-review-2026-10-23\screenshots`

`manifest.json` records each meaning, sentence, viewport and correction geometry.
Reproduce with `node scripts/sense-examples-browser.test.cjs --screenshots <folder>`.

## Validation

- 17 Node tests pass, including all 9,998 entries with loaded/missing/changed
  senses, exact reported regressions, masking, and 39,992 choice sets.
- 42 production DOM cases pass across choice/reverse/typing modes, covering
  reviewed and omitted examples, unavailable details and a changed Hebrew sense.
  Deliberately misleading generated sentences never appear on any surface.
- Existing browser UX checks pass: durable corrections, one scoring event,
  continuation, keyboard/card behavior, responsive layout and learning rules.
- Actual service-worker cold offline reopen and mocked reconnect/account
  isolation tests pass. The offline cache and readiness indicator both use v7.
- Complete vocabulary/hash integrity and all seven portable native tests pass.
  No vocabulary, native resource or Swift code changed.
- CI runs the coverage report and both browser content suites in addition to
  existing offline/reconnect and vocabulary/native checks.

## Remaining proposals

- Extend reviewed examples beyond the top 300; keep unverified examples omitted.
- Review questionable source translations separately before authoring examples.
- Verify Safari, the virtual keyboard and larger system text on a real iPhone.

The icon, desktop composition and compact 320px quiz proposals are implemented
in the [web visual follow-up](docs/visual-layout-review.md), which also records
the new isolated before/after screenshot review.
