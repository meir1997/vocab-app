# Web learning and feedback follow-up — 2026-10-23

Baseline: merged PR 15, `731436ef582bca832986e405b49ca091ef61b3bf`.

## Behavior

- Words outside the current 100-word band show `חזרה · רמה N` in the quiz
  and correction header. The badge derives the word's band from its rank.
- Correct-answer feedback has a permanent slot at the bottom of the quiz card.
  The unknown action keeps its space while feedback is visible. Prompt/context
  and answer slots keep question transitions steady at the tested widths.
- Shell padding adds `env(safe-area-inset-top, 0px)` at every breakpoint. A zero
  inset preserves existing desktop and Android spacing.
- `isLearned` derives the state from existing progress: an attempted record
  with no misses needs a streak of one; after any miss it needs a streak of two.
  Home/stats learned counts and the learning count share this predicate.
- The cap counts actual attempted, unlearned words. Queued words reserve no
  slots. Admission is checked again before displaying a question, so a miss
  that fills the cap cannot admit more unseen words from the existing queue.
- Service-worker cache and offline readiness use `four-words-offline-v9`.

There is no migration. Existing answer history, next-review dates, `INTERVALS`,
scoring, vocabulary, reviewed-example policy, sync, and native iOS files stay
unchanged. No real account data was used or edited.

## Isolated learning evidence

| Scenario | Learned | Learning | Admission |
| --- | ---: | ---: | --- |
| Previous definition, 205 attempted synthetic records | 5 | 200 | — |
| Same records, new derived definition | 15 | 190 | 20 new current-band words |
| Cap full with 200 missed records | 0 | 200 | 20 attempted reviews, zero new words |
| Dynamic cap after miss, recovery and a clean first answer | 2 | 199 | Unseen word blocked at 200; later new word learned |

The derivation test compares stored progress, stats, settings and bands byte
for byte before/after counting, rendering and queue building. Answer history
and review dates remain identical. The dynamic test records exactly three
answers (two correct, one wrong), verifies 199 → 200 → 199 learning, and retains
the existing one-day and three-day review intervals.

## Layout evidence

Screenshot folder:
`C:\Users\meirc\Documents\vocab-app-resumed-review-2026-10-23\screenshots`

The primary agent inspected the 72 final screenshots using contact sheets and
full-size spot checks: 42 feedback/badge, 9 safe-area and 21 surface images.
Word, options and typing boxes have exactly 0px delta before, during, after
clearing feedback and on the next question at 320, 390 and 1440px, including
every sampled animation frame. Quiz cards and feedback clear the bottom nav.
The correction suite verifies exactly one visible Hebrew answer in all three
modes for wrong and unknown answers. Removed a stale desktop button grid rule
so feedback and the action occupy the same reserved footer slot.

Validation passed: 17 Node tests, 7 portable native tests, 4 isolated learning
scenarios, 9 feedback mode/viewport cases plus 3 badge cases, 9 safe-area cases,
48 surface checks and 42 content cases; existing quiz UX, offline cold reopen,
reconnect/account isolation and full vocabulary/hash checks also pass.

The browser suites serve production HTML/CSS/JS and local vocabulary in fresh
contexts. Firebase and external traffic are blocked. Layout/learning tests also
block service workers; the separate offline suite exercises the actual worker.
Sessions/progress and the displayed account name are synthetic.

The safe-area suite uses Chromium's
[safe-area override](https://chromedevtools.github.io/devtools-protocol/tot/Emulation/#method-setSafeAreaInsetsOverride)
to exercise the actual CSS environment variable, with 47px and 59px top insets
at 390×844 and 320×568. A fixed status-bar band overlays that area in each
screenshot. Header, brand and account clear it by the exact inset; nav geometry
is unchanged. Resetting to zero restores the original geometry. Zero-inset
Android at both phone widths and desktop at 1440×1000 retain existing padding.
These are Chromium simulations, not real Safari or native iOS captures.

Reproduce:

```sh
node scripts/learning-rule-browser.test.cjs
node scripts/feedback-layout-browser.test.cjs --screenshots <folder>/feedback
node scripts/safe-area-browser.test.cjs --screenshots <folder>/safe-area
node scripts/visual-layout-browser.test.cjs --screenshots <folder>/surfaces
```

All new suites run in web CI; feedback and safe-area screenshots/geometry are
uploaded as `web-layout-evidence`.

## Remaining proposals

- Verify Safari, the virtual keyboard and larger system text on a real iPhone.
- Extend reviewed examples beyond the top 300.
- Review questionable source translations separately.
