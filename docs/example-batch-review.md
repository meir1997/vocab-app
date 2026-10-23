# Reviewed example batches

Adds original English sentences to the PR 14 `REVIEWED` map. Every sentence
was authored against the displayed primary `t` meaning in `vocab.json`, then
reread in a second self-review for word form, grammar, naturalness and the same
Hebrew sense. Doubtful candidates were dropped. No WordNet, Morfix or other
source sentences were copied, and no purchases were made.

| Frequency ranks | New reviewed examples | Previously reviewed | Exceptions |
| --- | ---: | ---: | ---: |
| 301–1000 | 639 | 30 | 31 |
| 1001–1700 | 671 | 6 | 23 |
| 1701–2400 | 669 | 3 | 28 |
| 2401–3100 | 666 | 1 | 33 |
| Total | 2645 | 40 | 115 |

All 2,800 words in the four batches have either a reviewed example or an entry
in [example-exceptions.md](example-exceptions.md). That file preserves each
word, rank and primary gloss and explains the omission. Some entries are
deferred for register or malformed tokens, as well as ambiguous/bad glosses.
The source translations remain unchanged.

Overall reviewed coverage rises from 299 to 2,944 of 9,998 words. The top-300
coverage remains 259. Other words continue to omit unreviewed examples.
The historical PR 13 comparison remains in
[example-coverage.json](example-coverage.json); `frequencyBatches` adds counts
and the complete omission list for each new batch. Metadata is in
[example-batches.json](example-batches.json).

The reviewed gate still binds every sentence to its stored Hebrew meaning,
with the same behavior when optional details are absent. Prompt masking now
handles punctuation-ending targets such as `etc.`; reverse/typing clues hide
the full literal target. The service-worker cache and readiness check use v10.
Native iOS, source vocabulary, generated details, learning/scoring/sync and
user progress data are untouched. Browser tests use isolated synthetic data.

Validation commands:

```sh
node --test scripts/vocabulary.test.mjs scripts/quiz-content.test.cjs
node scripts/vocabulary.mjs --check
node scripts/example-coverage.cjs
node scripts/sense-examples-browser.test.cjs
```

The content tests account for every batch entry, verify exact target forms,
short sentences, masked prompts and current coverage, and retain the existing
all-vocabulary sense gate and 39,992 choice-set checks. Browser sense tests now
cover 13 reviewed words, including additions from every batch and `etc.`, plus
omitted and changed-sense cases, in all three quiz modes with loaded/missing
details: 96 scenarios across prompts, corrections and word cards.
