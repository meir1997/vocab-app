# Quiz and word-card UX review — 2026-10-23

Historical PR 13 review. Its generated-example policy and coverage notes are
superseded by the sense-aligned content follow-up in [REVIEW.md](../REVIEW.md).

Based on main `acaf5ae` (including the 200-word learning cap and long-word fix).
This change updates the web app; the native Swift UI is unchanged.

## Result

- Wrong answers and “I don't know” retain the source Hebrew meaning and an
  English example until Continue is pressed, in all three practice modes.
  Correct answers retain the existing automatic advance. Scoring records once.
- Choices compare Hebrew without niqqud, punctuation or directional marks,
  exclude common Hebrew equivalents, alternate senses and available WordNet
  synonyms, and reject conflicts between distractors as well as with the target.
  Each option presents a single main meaning. Selection uses identity rather
  than display text. The source vocabulary is unchanged.
- Sixty common ambiguous words have short authored examples matching their
  source Hebrew sense (e.g. right = ימינה, can = פחית, lead = עופרת).
  These examples also supply prompt context; reverse/typing clues mask the word.
  Unreviewed generated examples are never used to disambiguate a prompt.
- Word cards show the Hebrew meaning and example first. English definitions
  and synonyms start collapsed and remain available through labeled disclosures.

## Screenshot findings and safe changes

Real isolated Chromium captures of the running local app were taken before and
after, at 1440×1000 desktop and 390×844 iPhone-size viewports. The same real words
were used: address (#1552) and incomprehensible (#8407). Additional after checks
cover 320×740 and expanded word cards. These are browser viewport checks, not a
physical iPhone or native iOS simulator test.

Additional typing screenshots cover desktop/390/320px, including an example
arriving late from the real details data. Input containment and automatic
navigation clearance also pass in those images.

The reviewer opened the images, including both viewport sizes for quiz,
wrong-answer, word-card and long-word states. Screenshots and the reproducible
capture script are saved locally under Documents:

`C:\Users\meirc\Documents\vocab-app-ux-review-2026-10-23`

Observed problems and implemented changes:

1. Mobile metadata wrapped into fragmented chips: separate level metadata from
   session count/progress and preserve readable lines.
2. Long words stranded an icon on its own row: dedicate one row to the word and
   one stable row to the serial, sound and details controls. Retain fitWord.
3. Tiny controls and faded choices: use 44px sound/details targets, inherited
   fonts, explicit answer borders and readable disabled colors.
4. Examples were buried below unrelated definitions: make the example the first
   card section and disclose reference material on demand.
5. The first revised mobile correction pushed Continue below the fixed nav:
   hide unused distractors and duplicate prompt context after a mistake, keep
   the selected/correct choices, and scroll only as needed to reveal Continue.
   Final images show the correction, example and Continue together above nav.
6. Desktop navigation was spread across the full monitor: center its buttons
   within the app width. Hebrew remains RTL; English examples are marked LTR.
7. Mobile typing controls overflowed: allow the input to shrink within its flex
   row. Browser tests cover typing and long-word containment down to 320px.

Pinch zoom is enabled. The detail dialog restores focus, contains keyboard
navigation and prevents quiz number shortcuts from firing behind it.

## Validation

- 13 Node tests: importer/source integrity, original thousand-skip behavior,
  presentation helpers and 39,992 generated questions across all 9,998 entries.
- The complete vocabulary/source hashes remain unchanged.
- Browser UX suite: all practice modes, persistent wrong/unknown feedback,
  single scoring, correct-answer advance, disclosure/focus behavior, responsive
  containment and visibility above the fixed navigation. A hung optional details
  request cannot block cached practice; startup waits at most 1.2 seconds for it.
- Actual cold offline reopen, cached Firebase scripts/vocabulary/new helper,
  local practice persistence and reconnect scripts pass the existing SW suite.
- Existing mocked transport suite passes remote union, concurrent pending edits
  and account isolation. No production account or Firestore writes were used.
- 100-word levels, 7/10 promotion, 70/100 thousand skip, the 200-word cap and
  untouched unseen-word progress are covered by browser regression assertions.
- All seven portable native configuration/vocabulary tests pass. Native Swift
  source is unchanged; macOS CI owns native builds.

## Remaining proposals and content limits

- Replace mixed emoji/information symbols with a consistent accessible icon set.
- Consider a wider desktop layout while keeping a focused reading column.
- Explore a more compact initial quiz for 320px-wide, short screens; all
  controls remain scrollable, and feedback/Continue are kept in view.
- Verify Safari, the virtual keyboard and larger system text on a real iPhone;
  consider applying the same card/feedback presentation to native iOS.
- Review the remaining source examples against the intended Hebrew sense.
  The current generated data lacks examples for 182 entries, including malformed
  tokens/abbreviations. Those entries display an explicit unavailable message.
  Hebrew synonym filtering is conservative, not a complete Hebrew dictionary;
  no automated test can certify every semantic overlap in this source data.
