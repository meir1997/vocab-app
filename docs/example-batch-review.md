# Reviewed example batches

Original English sentences use the PR 14/17 `REVIEWED` storage and displayed primary `t` meaning from `vocab.json`. Each candidate received a second self-review for exact form, grammar, naturalness and Hebrew sense; doubtful candidates were dropped. No WordNet, Morfix or other source sentences were copied. No purchases.

| Frequency ranks | New reviewed examples | Previously reviewed | Exceptions |
| --- | ---: | ---: | ---: |
| 301–1000 | 639 | 30 | 31 |
| 1001–1700 | 671 | 6 | 23 |
| 1701–2400 | 669 | 3 | 28 |
| 2401–3100 | 666 | 1 | 33 |
| 3101–3800 | 666 | 0 | 34 |
| 3801–4500 | 675 | 0 | 25 |
| 4501–5200 | 670 | 0 | 30 |
| 5201–5900 | 663 | 0 | 37 |
| 5901–6600 | 661 | 0 | 39 |
| 6601–7300 | 657 | 0 | 43 |
| 7301–8000 | 655 | 0 | 45 |
| 8001–8700 | 663 | 0 | 37 |
| 8701–9400 | 651 | 0 | 48 |
| 9401–10000 | 560 | 0 | 39 |

Every word in these batches has a reviewed example or a documented omission in [example-exceptions.md](example-exceptions.md), preserving word, rank, primary gloss and reason. Source glosses are unchanged. Exception gloss cells retain Hebrew RTL direction.

Overall coverage: 9465/9,998 reviewed examples; top 300 remains 259. This continuation adds 6521 examples. Batch exceptions total 492. The reproducible [coverage report](example-coverage.json) retains the PR 13 baseline and lists every omission.

The source preserves ranks through 10,000 despite containing 9,998 words: ranks 8854 and 9542 are absent after duplicate removal. The final batches contain 699 and 599 words. All 6,898 remaining words are accounted for. The final cross-batch audit also removes deer and eagle because their glosses name gazelle and vulture, and tightens claimed to the legal damages sense; batch counts reflect these corrections. Total omissions include 41 in the top 300, beyond the batch exception list.

The existing sense gate and masking behavior are preserved, with loaded or missing details. Browser fixtures include less common primary senses from the new batches. Cache and app readiness use `four-words-offline-v26`. Native iOS, vocab.json, details.json, scoring, synchronization and user progress are untouched. Browser suites use isolated synthetic sessions.

Validation commands:

```sh
node --test scripts/vocabulary.test.mjs scripts/quiz-content.test.cjs
node scripts/vocabulary.mjs --check
node scripts/example-coverage.cjs
python -m unittest discover -s ios/Scripts -p 'test_*.py' -v
node scripts/quiz-ux-browser.test.cjs
node scripts/learning-rule-browser.test.cjs
node scripts/feedback-layout-browser.test.cjs
node scripts/safe-area-browser.test.cjs
node scripts/sense-examples-browser.test.cjs
node scripts/visual-layout-browser.test.cjs
node scripts/offline-browser.test.cjs
node scripts/reconnect-browser.test.cjs
```

The Node tests account for every batch entry, verify exact forms, short sentences, masked prompts, current coverage, all-vocabulary sense isolation and 39,992 choice sets. Local browser execution uses the existing external Chromium harness; CI uses the pinned Playwright installation. Green CI is required before each authorized merge.
