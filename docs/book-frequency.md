# Book word-frequency counts and the in-app reader

## What the user asked

1. Show, for every word in the app, how many times it appears in the book he
   supplied (an EPUB sent over WhatsApp on 2026-10-25).
2. Read that book inside the app, like Apple Books.

## Counts: `book-frequency.json`

- Source: the user-supplied EPUB of *Harry Potter and the Sorcerer's Stone*
  (~78k tokens after markup removal). The EPUB itself is **not** in this
  repository and is never served by the site; only per-word occurrence counts
  (numbers) are stored. Book text stays on the user's device.
- Method (also recorded in the JSON's `method` field):
  - Exact word-form match, case-insensitive (`Harry` matches `harry`).
  - Curly apostrophes (U+2018/U+2019/U+02BC) normalized to straight `'`;
    contractions and possessives kept whole (`don't`, `harry's`).
  - Hyphenated forms split into parts.
  - No stemming or inflection merging: `run` does not count `ran`.
  - Multi-word entries: none exist in vocab.json, so no phrase handling.
- 3,430 of 9,998 vocabulary words appear at least once. Missing rank = 0
  occurrences. Keys are vocab ranks (`r`), which are stable word keys.
- Count scope: the entire spine in reading order, including the title page
  and running page headers (each chapter file repeats the book title once,
  e.g. `harry` gets +19 across the book). No navigation documents exist in
  this EPUB's spine; the NCX table of contents is not counted. Counts describe
  this exact EPUB edition; a different edition or book yields different
  counts. The details sheet always names the source book next to the number
  so a count is never read as describing another imported book.
- Regeneration: tokenize the EPUB spine in order with
  `[a-z]+(?:'[a-z]+)*` over lowercased, apostrophe-normalized text, then map
  `w.toLowerCase()` to counts. Requires the original EPUB, which is private.

## Reader: `reader.js` + the "ספר" tab

- The site is a public static page, so the book cannot ship with it. Instead
  the user imports the EPUB from his device; it is stored in IndexedDB
  (`vocab-reader` db) and never uploaded. Reading position and font size are
  in `localStorage` (`vocab-reader-position`).
- `reader.js` is dependency-free: a minimal ZIP reader (stored entries and
  raw-deflate via `DecompressionStream`), OPF/NCX parsing, and a sanitizer
  that keeps reading markup (headings, paragraphs, emphasis, lists) and drops
  scripts, styles, images and embedded content. `require('node:zlib')` is a
  Node-only fallback for tests.
- Chapter navigation uses the NCX table of contents when present, with a
  generic label fallback.
- Known limits: images (including covers) are not rendered; fixed-layout or
  DRM-protected EPUBs are unsupported; one book slot at a time.

## Tests

- `scripts/epub-reader.test.cjs` — Node unit tests for ZIP/EPUB parsing using
  a synthetic in-memory EPUB from `scripts/epub-fixture.cjs`.
- `scripts/reader-browser.test.cjs` — Playwright flow: import, sanitize, TOC,
  position memory, font size, removal, and the details-sheet count line.

The real book cannot be tested on a real iPhone/Safari from CI; the reader
uses widely supported web APIs (`DecompressionStream`, IndexedDB), but a
real-device check is still pending.
