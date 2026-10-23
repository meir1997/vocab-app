# Web visual follow-up — 2026-10-23

Baseline: merged PR 14, `268089ceb942cc62c64c810dbc1fc1dea1cf0b9d`.

## Changes

- Wrong and unknown answers have one visible correct Hebrew meaning, in the
  existing correction panel. The green revealed option is hidden during review;
  a selected wrong option remains visible. Reverse/typing Hebrew prompts are
  hidden during review as well. The reviewed English example stays in the panel.
- Bottom navigation and quiz, word-card and library action buttons share a
  local outline SVG sprite. Accessible button names and handlers are preserved.
- At desktop widths of 960px and above, the shell expands to 1120px and the
  quiz places the prompt beside its answers/correction. At 1440px, the quiz is
  1056px wide instead of 528px. The library uses two columns; the desktop word
  card is a centered, wider dialog. Phone sheets retain their bottom position.
- At widths up to 360px, tighter spacing and an inline prompt/action row keep
  the quiz compact. Options and actions retain a minimum 44px height. Content
  can grow naturally, including larger text and long words; it is never clipped.
- The English word-card heading and rank share a left edge. Example text is
  LTR, Hebrew content remains RTL, and credits have two blocks, larger type,
  more line spacing and isolated English attribution.
- Offline cache and readiness indicator both use `four-words-offline-v8`.

Learning rules, scoring, synchronization, vocabulary, reviewed-example policy
and native iOS sources/resources are unchanged.

## Isolated before/after render review

Screenshot folder:
`C:\Users\meirc\Documents\vocab-app-visual-review-2026-10-23\screenshots`

The `before` and `after` subfolders each contain 21 PNGs plus a JSON manifest.
They render the real production HTML/CSS/JS at 320×568, 390×844 and 1440×1000.
Every size includes `right` prompt, unknown correction, wrong correction and
word card, plus an unreviewed long-word prompt, correction and card. The primary
agent personally opened and viewed all 42 images. This is Chromium emulation,
not native Safari or an iOS app capture.

Each context is fresh, with synthetic progress and sessions only. Firebase,
external traffic and service workers are blocked. Vocabulary/details are real
local files; seeded random choices make before/after comparisons repeatable.
The baseline was served from an untouched Git archive of PR 14.

The baseline 320px prompt has options below the visible area. Its unknown and
wrong correction Continue buttons end at approximately 641px and 701px, below
the navigation starting at 498px. In the updated UI those buttons end at 380px
and 424px, above navigation at 504px, with scroll position zero. All four initial
options and the unknown action fit as well. The 390px view retains its familiar
single-column layout. The desktop prompt and response use separate columns.
Word-card headings, actions and credits are aligned and readable at every size.

The final matrix passes 48 surface checks: every quiz mode with wrong/unknown
answers, one visible Hebrew meaning, reviewed/omitted examples, single scoring,
explicit continuation, desktop width, and no horizontal page or sheet overflow.
No uncaught page errors occurred. Existing content coverage remains 299 reviewed
examples overall and 259 in the top 300.

Reproduce the current renders with:

```sh
node scripts/visual-layout-browser.test.cjs --screenshots <after-folder>
```

For a baseline, export the baseline Git commit to a separate directory, then:

```sh
node scripts/visual-layout-browser.test.cjs --root <baseline-directory> --baseline --screenshots <before-folder>
```

The new script runs in web CI with the existing UX, example, offline and
reconnect suites. Local validation also includes all 17 Node content/vocabulary
tests, the coverage report and seven portable native configuration tests.

## Remaining proposals

- Extend reviewed examples beyond the top 300; keep unverified examples omitted.
- Review questionable source translations separately before authoring examples.
- Verify Safari, the virtual keyboard and larger system text on a real iPhone.
