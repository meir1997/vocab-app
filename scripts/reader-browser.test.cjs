// Run with: node scripts/reader-browser.test.cjs
// Exercises the Book tab end to end against the production DOM: EPUB import,
// sanitized rendering, position memory, removal, and the per-word book
// occurrence count shown in the word details sheet.
'use strict';

const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const http = require('node:http');
const path = require('node:path');
const { buildTestEpub, buildTestEpubWithCover, buildLongEpub } = require('./epub-fixture.cjs');

const root = path.resolve(__dirname, '..');
async function openReaderPanel(page) {
  if (await page.locator('#readerPanel.hidden').count()) await page.locator('#readerMenu').click();
  await page.locator('#readerPanel:not(.hidden)').waitFor();
}
async function tapPageEdge(page, side) {
  const b = await page.locator('#bookViewport').boundingBox();
  await page.mouse.click(side === 'next' ? b.x + b.width - 6 : b.x + 6, b.y + b.height / 2);
}
const server = http.createServer((request, response) => {
  const requested = decodeURIComponent(new URL(request.url, 'http://localhost').pathname)
    .replace(/^\/vocab-app(?:\/|$)/, '/');
  const file = path.resolve(root, '.' + (requested.endsWith('/') ? requested + 'index.html' : requested));
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    response.writeHead(404).end();
    return;
  }
  const types = { '.html': 'text/html', '.js': 'application/javascript', '.json': 'application/json', '.css': 'text/css' };
  response.setHeader('Content-Type', (types[path.extname(file)] || 'application/octet-stream') + '; charset=utf-8');
  response.end(fs.readFileSync(file));
});

let browser;
let base;
let epubPath;

async function newPage() {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  await context.route('**/firebase-config.js', route => route.fulfill({ body: '', contentType: 'application/javascript' }));
  await context.route('https://www.gstatic.com/**', route => route.fulfill({ body: '', contentType: 'application/javascript' }));
  const page = await context.newPage();
  await page.goto(base);
  await page.waitForFunction(() => vocab.length > 9000 && typeof VocabReader !== 'undefined');
  return { page, context };
}

async function importFlow() {
  const { page, context } = await newPage();
  try {
    await page.locator('.tab-btn[data-tab="book"]').click();
    await page.locator('#bookImportBtn').waitFor({ state: 'visible' });
    // A stale position from a previous book must not steer a fresh import.
    await page.evaluate(() => localStorage.setItem('vocab-reader-position', JSON.stringify({ chapter: 1, ratio: 0.5, font: 1.6 })));
    await page.locator('#bookFile').setInputFiles(epubPath);
    await page.waitForFunction(() => document.getElementById('bookTitle').textContent === 'Fixture Book');
    assert.equal(await page.locator('#bookAuthor').textContent(), 'Fixture Author');
    const options = await page.locator('#bookChapter option').allTextContents();
    assert.deepEqual(options, ['Beginning', 'Middle'], 'toc labels drive the chapter picker');
    assert.equal(await page.locator('#bookChapter').inputValue(), '0', 'fresh import starts at the beginning, ignoring stale position');
    assert.equal(await page.evaluate(() => getComputedStyle(document.getElementById('bookContent')).fontSize), '18px', 'fresh import resets font scale');
    // Immersive reading: the book fills the screen over the app chrome.
    assert.ok(await page.evaluate(() => document.body.classList.contains('reading')), 'reading mode active with a loaded book');
    const overlay = await page.locator('#bookLoaded').boundingBox();
    assert.ok(overlay && overlay.x <= 0 && overlay.y <= 0 && overlay.width >= 390, 'reader overlay covers the screen');
    assert.equal(await page.evaluate(() => getComputedStyle(document.getElementById('bookLoaded')).position), 'fixed', 'reader overlay is fixed');
    assert.match(await page.locator('#readerTitle').textContent(), /Fixture Book/, 'minimal top chrome shows the title');
    const text = await page.locator('#bookContent').innerText();
    assert.match(text, /The Beginning/);
    assert.match(text, /a link/, 'unwrapped link text survives');
    assert.match(text, /harry’s/, 'curly apostrophe text survives');
    assert.doesNotMatch(text, /must not survive/, 'script content is dropped');
    assert.equal(await page.locator('#bookContent script, #bookContent img, #bookContent iframe').count(), 0, 'active/embedded markup is removed');

    // Chapter switch (controls live in the reader menu panel)
    await openReaderPanel(page);
    await page.locator('#bookChapter').selectOption('1');
    await page.waitForFunction(() => document.getElementById('bookContent').innerText.includes('The Middle'));
    assert.match(await page.locator('#bookContent').innerText(), /After the iframe\./);

    // Position memory: reload restores chapter 2.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => vocab.length > 9000 && typeof VocabReader !== 'undefined');
    await page.locator('.tab-btn[data-tab="book"]').click();
    await page.waitForFunction(() => document.getElementById('bookTitle').textContent === 'Fixture Book');
    await page.waitForFunction(() => document.getElementById('bookContent').innerText.includes('The Middle'));
    assert.equal(await page.locator('#bookChapter').inputValue(), '1', 'last read chapter restored from IndexedDB+localStorage');

    // Font size control persists (via the reader menu panel).
    await openReaderPanel(page);
    const before = await page.evaluate(() => getComputedStyle(document.getElementById('bookContent')).fontSize);
    await page.locator('#bookFontUp').click();
    const after = await page.evaluate(() => getComputedStyle(document.getElementById('bookContent')).fontSize);
    assert.ok(parseFloat(after) > parseFloat(before), 'font grows');

    // X exits immersive reading back to the app; the book tab re-enters it.
    await page.locator('#readerClose').click();
    await page.waitForFunction(() => !document.body.classList.contains('reading'));
    assert.ok(await page.locator('#tab-practice').isVisible(), 'closing the book returns to practice');
    await page.locator('.tab-btn[data-tab="book"]').click();
    await page.waitForFunction(() => document.body.classList.contains('reading'));

    // Removal returns to the empty state.
    page.on('dialog', d => d.accept());
    await openReaderPanel(page);
    await page.locator('#bookRemoveBtn').click();
    await page.locator('#bookImportBtn').waitFor({ state: 'visible' });
    await page.waitForFunction(() => !document.body.classList.contains('reading'));
  } finally {
    await context.close();
  }
  console.log('PASS book tab import, sanitize, toc, position memory, font and removal');
}

async function frequencyInDetails() {
  const { page, context } = await newPage();
  try {
    const freq = JSON.parse(fs.readFileSync(path.join(root, 'book-frequency.json'), 'utf8'));
    const vocabData = JSON.parse(fs.readFileSync(path.join(root, 'vocab.json'), 'utf8'));
    const hit = vocabData.find(item => freq.counts[item.r] > 1);
    assert.ok(hit, 'fixture vocabulary has at least one word counted in the book');
    await page.locator('.tab-btn[data-tab="library"]').click();
    await page.locator('#searchInput').fill(hit.w);
    await page.locator('.word-item .w').first().click();
    await page.locator('#detailSheet:not(.hidden)').waitFor();
    await page.waitForFunction(() => document.querySelector('#detailBody')?.innerText.includes('שכיחות בספר'));
    const body = await page.locator('#detailBody').innerText();
    assert.match(body, new RegExp(`מופיע ${freq.counts[hit.r].toLocaleString('he-IL')} פעמים`));
    assert.match(body, new RegExp(freq.book.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.match(body, /צורת המילה המדויקת/, 'count-scope caveat is visible in the UI');
    const titleBox = await page.locator('.freq-book').boundingBox();
    const lineBox = await page.locator('.freq-line').boundingBox();
    assert.ok(titleBox.y >= lineBox.y + lineBox.height - 1, 'book title is its own block below the Hebrew count line');
  } finally {
    await context.close();
  }
  console.log('PASS word details sheet shows the book occurrence count');
}

async function missingBookKeepsAppUsable() {
  const { page, context } = await newPage();
  try {
    await page.locator('.tab-btn[data-tab="book"]').click();
    assert.equal(await page.locator('#bookError').textContent(), '');
    await page.locator('.tab-btn[data-tab="practice"]').click();
    await page.locator('#startBtn').click();
    await page.locator('#quizCard').waitFor({ state: 'visible', timeout: 3000 });
    assert.equal(await page.locator('.answer').count(), 4);
  } finally {
    await context.close();
  }
  console.log('PASS app stays usable with no imported book');
}

function mockFbScript(savedJson, highlightsJson) {
  return `(() => {
    const state = { saved: ${savedJson || 'null'}, deleted: false, highlights: ${highlightsJson || 'null'}, highlightsDeleted: false };
    const bookDoc = {
      set: async d => { state.saved = d; },
      get: async () => ({ exists: !!state.saved, data: () => state.saved }),
      delete: async () => { state.saved = null; state.deleted = true; }
    };
    const highlightsDoc = {
      set: async d => { state.highlights = d; },
      get: async () => ({ exists: !!state.highlights, data: () => state.highlights }),
      delete: async () => { state.highlights = null; state.highlightsDeleted = true; }
    };
    fb.ready = true;
    fb.user = { uid: 'test-uid', email: 'test@example.com' };
    fb.db = { collection: () => ({ doc: () => ({
      collection: () => ({ doc: id => id === 'highlights' ? highlightsDoc : bookDoc }),
      set: async () => {},
      get: async () => ({ exists: false, data: () => ({}) })
    }) }) };
    window.__fbMock = state;
  })()`;
}

async function cloudSyncFlow() {
  // 1. Signed-in import writes a cloud copy to the account.
  let { page, context } = await newPage();
  let saved;
  try {
    await page.evaluate(mockFbScript());
    await page.locator('.tab-btn[data-tab="book"]').click();
    await page.locator('#bookFile').setInputFiles(epubPath);
    await page.waitForFunction(() => document.getElementById('bookTitle').textContent === 'Fixture Book');
    await page.waitForFunction(() => !!window.__fbMock.saved, { timeout: 5000 });
    saved = await page.evaluate(() => window.__fbMock.saved);
    assert.ok(saved.b64.length > 1000, 'cloud copy carries the book bytes');
    assert.ok(saved.name.endsWith('.epub'));
    assert.equal(saved.title, 'Fixture Book');
  } finally {
    await context.close();
  }
  // 2. A fresh device (no IndexedDB) restores the book from the account cloud copy.
  ({ page, context } = await newPage());
  try {
    await page.evaluate(mockFbScript(JSON.stringify(saved)));
    await page.locator('.tab-btn[data-tab="book"]').click();
    await page.waitForFunction(() => document.getElementById('bookTitle').textContent === 'Fixture Book', { timeout: 8000 });
    assert.equal(await page.locator('#bookChapter').inputValue(), '0');
    assert.match(await page.locator('#bookContent').innerText(), /The Beginning/);
    // Local copy is re-established for offline reading.
    assert.ok(await page.evaluate(() => new Promise(resolve => {
      const req = indexedDB.open('vocab-reader', 1);
      req.onsuccess = () => {
        const get = req.result.transaction('book').objectStore('book').get('current');
        get.onsuccess = () => resolve(!!get.result);
        get.onerror = () => resolve(false);
      };
      req.onerror = () => resolve(false);
    })), 'cloud-restored book is cached locally again');
    // 3. Removal clears the cloud copy as well.
    page.on('dialog', d => d.accept());
    await openReaderPanel(page);
    await page.locator('#bookRemoveBtn').click();
    await page.locator('#bookImportBtn').waitFor({ state: 'visible' });
    await page.waitForFunction(() => window.__fbMock.deleted === true, { timeout: 5000 });
  } finally {
    await context.close();
  }
  console.log('PASS signed-in import writes account cloud copy, fresh device restores it, removal clears it');
}


async function coverOpeningFlow() {
  const coverPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'epub-cover-')), 'covered.epub');
  fs.writeFileSync(coverPath, buildTestEpubWithCover());
  // 1. A fresh import skips the image-only cover and lands on the first readable chapter.
  let { page, context } = await newPage();
  try {
    await page.locator('.tab-btn[data-tab="book"]').click();
    await page.locator('#bookFile').setInputFiles(coverPath);
    await page.waitForFunction(() => document.getElementById('bookTitle').textContent === 'Covered Book');
    assert.equal(await page.locator('#bookChapter').inputValue(), '1', 'fresh import skips the image-only cover');
    assert.match(await page.locator('#bookContent').innerText(), /The Beginning/);
    const options = await page.locator('#bookChapter option').allTextContents();
    assert.deepEqual(options, ['קטע 1', 'Beginning', 'Middle'], 'cover falls back to a generic label, toc labels drive real chapters');
    // 2. Deliberately opening the cover is a saved position and must be respected on reopen.
    await openReaderPanel(page);
    await page.locator('#bookChapter').selectOption('0');
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('vocab-reader-position') || '{}').chapter === 0);
    await page.reload();
    await page.waitForFunction(() => vocab.length > 9000);
    await page.locator('.tab-btn[data-tab="book"]').click();
    await page.waitForFunction(() => document.getElementById('bookTitle').textContent === 'Covered Book');
    assert.equal(await page.locator('#bookChapter').inputValue(), '0', 'saved cover position is respected on reopen');
  } finally {
    await context.close();
  }
  // 3. A fresh device restoring from the account cloud copy also skips the cover.
  let saved;
  ({ page, context } = await newPage());
  try {
    await page.evaluate(mockFbScript());
    await page.locator('.tab-btn[data-tab="book"]').click();
    await page.locator('#bookFile').setInputFiles(coverPath);
    await page.waitForFunction(() => document.getElementById('bookTitle').textContent === 'Covered Book');
    await page.waitForFunction(() => !!window.__fbMock.saved, { timeout: 5000 });
    saved = await page.evaluate(() => window.__fbMock.saved);
  } finally {
    await context.close();
  }
  ({ page, context } = await newPage());
  try {
    await page.evaluate(mockFbScript(JSON.stringify(saved)));
    await page.locator('.tab-btn[data-tab="book"]').click();
    await page.waitForFunction(() => document.getElementById('bookTitle').textContent === 'Covered Book', { timeout: 8000 });
    assert.equal(await page.locator('#bookChapter').inputValue(), '1', 'cloud restore skips the image-only cover');
    assert.match(await page.locator('#bookContent').innerText(), /The Beginning/);
  } finally {
    await context.close();
  }
  console.log('PASS fresh open and cloud restore skip an image-only cover, saved cover position respected');
}


async function paginationFlow() {
  const longPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'epub-long-')), 'long.epub');
  fs.writeFileSync(longPath, buildLongEpub());
  const { page, context } = await newPage();
  try {
    await page.locator('.tab-btn[data-tab="book"]').click();
    await page.locator('#bookFile').setInputFiles(longPath);
    await page.waitForFunction(() => document.getElementById('bookTitle').textContent === 'Long Book');
    // Long chapter spans multiple pages; the indicator counts them.
    await page.waitForFunction(() => {
      const m = document.getElementById('bookPageInfo').textContent.match(/עמוד (\d+) מתוך (\d+)/);
      return m && Number(m[1]) === 1 && Number(m[2]) >= 4;
    });
    const transformOf = () => page.evaluate(() => document.getElementById('bookContent').style.transform);
    const first = await transformOf();
    // Turning forward and back by tapping the page edges.
    await tapPageEdge(page, 'next');
    await page.waitForFunction(() => document.getElementById('bookPageInfo').textContent.startsWith('עמוד 2 '));
    assert.notEqual(await transformOf(), first, 'page turn moves the page strip');
    await tapPageEdge(page, 'prev');
    await page.waitForFunction(() => document.getElementById('bookPageInfo').textContent.startsWith('עמוד 1 '));
    assert.equal(await transformOf(), first, 'back returns to the first page');
    // Arrow keys turn pages too.
    await page.keyboard.press('ArrowRight');
    await page.waitForFunction(() => document.getElementById('bookPageInfo').textContent.startsWith('עמוד 2 '));
    await page.keyboard.press('ArrowLeft');
    await page.waitForFunction(() => document.getElementById('bookPageInfo').textContent.startsWith('עמוד 1 '));
    // Page position survives a reload.
    await tapPageEdge(page, 'next');
    await page.waitForFunction(() => document.getElementById('bookPageInfo').textContent.startsWith('עמוד 2 '));
    const pagesBefore = await page.evaluate(() => document.getElementById('bookPageInfo').textContent);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => vocab.length > 9000 && typeof VocabReader !== 'undefined');
    await page.locator('.tab-btn[data-tab="book"]').click();
    await page.waitForFunction(() => document.getElementById('bookTitle').textContent === 'Long Book');
    await page.waitForFunction(() => document.getElementById('bookPageInfo').textContent.startsWith('עמוד 2 '));
    assert.equal(await page.evaluate(() => document.getElementById('bookPageInfo').textContent), pagesBefore, 'page position restored after reload');
    // Edge taps clamp at the ends: no wrapping past the last or first page.
    let lastInfo = await page.evaluate(() => document.getElementById('bookPageInfo').textContent);
    for (let i = 0; i < 40; i++) {
      await tapPageEdge(page, 'next');
      await page.waitForTimeout(120);
      const now = await page.evaluate(() => document.getElementById('bookPageInfo').textContent);
      if (now === lastInfo) break;
      lastInfo = now;
    }
    await tapPageEdge(page, 'next');
    assert.equal(await page.evaluate(() => document.getElementById('bookPageInfo').textContent), lastInfo, 'past the last page stays put');
    // Bigger font repaginates to at least as many pages and stays near the end.
    await openReaderPanel(page);
    await page.locator('#bookFontUp').click();
    await page.waitForFunction(info => document.getElementById('bookPageInfo').textContent !== info, lastInfo);
    const m = (await page.evaluate(() => document.getElementById('bookPageInfo').textContent)).match(/עמוד (\d+) מתוך (\d+)/);
    const last = lastInfo.match(/עמוד (\d+) מתוך (\d+)/);
    assert.ok(Number(m[2]) >= Number(last[2]), 'bigger font does not shrink the page count');
    assert.ok(Number(m[1]) >= Number(m[2]) - 1, 'relative position kept near the end after repagination');
  } finally {
    await context.close();
  }
  console.log('PASS paged reading: edge-tap and keyboard page turns, indicator, persistence, end clamping and repagination');
}

async function wordTapFlow() {
  const { page, context } = await newPage();
  try {
    await page.locator('.tab-btn[data-tab="book"]').click();
    await page.locator('#bookFile').setInputFiles(epubPath);
    await page.waitForFunction(() => document.getElementById('bookTitle').textContent === 'Fixture Book');

    // Every word is wrapped as a tappable span; text stays intact. The title
    // lands before the wrapping pass, so wait for the spans explicitly.
    await page.waitForFunction(() => document.querySelectorAll('#bookContent .bw').length > 10);
    assert.ok(await page.locator('#bookContent .bw').count() > 10, 'book words are wrapped as tappable spans');
    const text = await page.locator('#bookContent').innerText();
    assert.match(text, /A small chapter with a link and a possessive like harry’s\./, 'wrapping keeps the text identical');

    // Tap a vocab word: sheet shows its app number and fresh state.
    const vocabData = JSON.parse(fs.readFileSync(path.join(root, 'vocab.json'), 'utf8'));
    const rank = vocabData.find(v => v.w === 'chapter').r;
    await page.locator('#bookContent .bw', { hasText: 'chapter' }).first().click();
    await page.locator('#wordSheet:not(.hidden)').waitFor();
    assert.equal(await page.locator('#wordSheetWord').textContent(), 'chapter');
    assert.match(await page.locator('#wordSheetSerial').textContent(), new RegExp(`#${rank.toLocaleString('he-IL')}`), 'app word number shown');
    assert.equal(await page.locator('#wordSheetGloss').textContent(), vocabData.find(v => v.w === 'chapter').t, 'translation shown in the popup');
    assert.match(await page.locator('#wordSheetState').textContent(), /עוד לא נלמדה/);

    // Mark known: mirrors the quiz clean-answer rule (r=1, s=1), due far out.
    await page.locator('#wordKnownBtn').click();
    assert.match(await page.locator('#wordSheetState').textContent(), /מסומנת כידועה/);
    assert.equal(await page.locator('#wordKnownBtn').textContent(), 'סימון כלא ידועה');
    let stored = await page.evaluate(() => JSON.parse(localStorage.getItem('fw.progress.v2')).chapter);
    assert.deepEqual({ r: stored.r, w: stored.w, s: stored.s }, { r: 1, w: 0, s: 1 });
    assert.ok(stored.next > Date.now() + 25 * 86400000, 'known word scheduled at the longest interval');
    let stats = await page.evaluate(() => JSON.parse(localStorage.getItem('fw.stats.v2')));
    assert.equal(stats.attempts, 0, 'book marks are not quiz answers');
    let bands = await page.evaluate(() => JSON.parse(localStorage.getItem('fw.bands.v1')));
    assert.deepEqual(bands.recent || [], [], 'book marks do not move band advancement');

    // Unmark a learned word ("סימון כלא ידועה" on the known toggle): additive,
    // never a quiz mistake - the u flag suppresses the learned status and the
    // word is due now, while counts and the streak stay exactly as they were.
    await page.locator('#wordKnownBtn').click();
    assert.match(await page.locator('#wordSheetState').textContent(), /בתהליך למידה · מסומנת כלא ידועה/);
    stored = await page.evaluate(() => JSON.parse(localStorage.getItem('fw.progress.v2')).chapter);
    assert.deepEqual({ r: stored.r, w: stored.w, s: stored.s, u: stored.u }, { r: 1, w: 0, s: 1, u: 1 }, 'unmarking known records no miss and keeps the streak');
    assert.ok(stored.next <= Date.now(), 'unmarked word is due immediately');
    assert.equal(await page.locator('#wordUnknownBtn').textContent(), 'ביטול סימון כלא ידועה');
    stats = await page.evaluate(() => JSON.parse(localStorage.getItem('fw.stats.v2')));
    assert.equal(stats.attempts, 0, 'unmarking known is not a quiz answer');
    bands = await page.evaluate(() => JSON.parse(localStorage.getItem('fw.bands.v1')));
    assert.deepEqual(bands.recent || [], [], 'unmarking known does not move band advancement');

    // Removing the mark restores the learned status exactly (streak intact).
    await page.locator('#wordUnknownBtn').click();
    stored = await page.evaluate(() => JSON.parse(localStorage.getItem('fw.progress.v2')).chapter);
    assert.deepEqual({ r: stored.r, w: stored.w, s: stored.s, u: stored.u }, { r: 1, w: 0, s: 1, u: undefined }, 'removing the mark deletes only the flag');
    assert.match(await page.locator('#wordSheetState').textContent(), /מסומנת כידועה/);
    await page.locator('#wordSheetClose').click();

    // A genuine in-learning word (a real miss in practice) offers the same
    // additive mark: flag + due now, history untouched, and removable.
    await page.evaluate(() => { markWord('chapter', false); persist(); });
    stored = await page.evaluate(() => JSON.parse(localStorage.getItem('fw.progress.v2')).chapter);
    assert.deepEqual({ r: stored.r, w: stored.w, s: stored.s }, { r: 1, w: 1, s: 0 });
    await page.locator('#bookContent .bw', { hasText: 'chapter' }).first().click();
    await page.locator('#wordSheet:not(.hidden)').waitFor();
    assert.equal(await page.locator('#wordSheetState').textContent(), 'בתהליך למידה');
    assert.equal(await page.locator('#wordUnknownBtn').textContent(), 'סימון כלא ידועה');
    await page.locator('#wordUnknownBtn').click();
    stored = await page.evaluate(() => JSON.parse(localStorage.getItem('fw.progress.v2')).chapter);
    assert.deepEqual({ r: stored.r, w: stored.w, s: stored.s, u: stored.u }, { r: 1, w: 1, s: 0, u: 1 }, 'additive mark: history preserved, no extra miss');
    assert.ok(stored.next <= Date.now(), 'marked word is due immediately');
    assert.match(await page.locator('#wordSheetState').textContent(), /בתהליך למידה · מסומנת כלא ידועה/);
    assert.match(await page.locator('#toast').textContent(), /סומנה כלא ידועה/);
    stats = await page.evaluate(() => JSON.parse(localStorage.getItem('fw.stats.v2')));
    assert.equal(stats.attempts, 0, 'marking unknown is not a quiz answer');
    bands = await page.evaluate(() => JSON.parse(localStorage.getItem('fw.bands.v1')));
    assert.deepEqual(bands.recent || [], [], 'marking unknown does not move band advancement');
    await page.locator('#wordUnknownBtn').click();
    stored = await page.evaluate(() => JSON.parse(localStorage.getItem('fw.progress.v2')).chapter);
    assert.deepEqual({ r: stored.r, w: stored.w, s: stored.s, u: stored.u }, { r: 1, w: 1, s: 0, u: undefined }, 'unmarking deletes only the flag; the due-now nudge is not reverted');
    assert.equal(await page.locator('#wordSheetState').textContent(), 'בתהליך למידה');
    await page.locator('#wordSheetClose').click();

    // Mark unknown on a fresh word (user request, 26.10): a classification
    // record like the sort-mode left swipe, never a miss, and removable.
    await page.locator('#bookContent .bw', { hasText: 'small' }).first().click();
    await page.locator('#wordSheet:not(.hidden)').waitFor();
    assert.equal(await page.locator('#wordSheetWord').textContent(), 'small');
    assert.match(await page.locator('#wordSheetState').textContent(), /עוד לא נלמדה/);
    assert.equal(await page.locator('#wordUnknownBtn').textContent(), 'סימון כלא ידועה');
    await page.locator('#wordUnknownBtn').click();
    assert.match(await page.locator('#wordSheetState').textContent(), /מסומנת ללמידה/);
    assert.equal(await page.locator('#wordUnknownBtn').textContent(), 'ביטול סימון כלא ידועה');
    stored = await page.evaluate(() => JSON.parse(localStorage.getItem('fw.progress.v2')).small);
    assert.deepEqual({ r: stored.r, w: stored.w, s: stored.s, u: stored.u }, { r: 0, w: 0, s: 0, u: 1 }, 'classification record, not a miss');
    stats = await page.evaluate(() => JSON.parse(localStorage.getItem('fw.stats.v2')));
    assert.equal(stats.attempts, 0, 'classifying is not a quiz answer');
    bands = await page.evaluate(() => JSON.parse(localStorage.getItem('fw.bands.v1')));
    assert.deepEqual(bands.recent || [], [], 'classifying does not move band advancement');
    await page.locator('#wordUnknownBtn').click();
    assert.match(await page.locator('#wordSheetState').textContent(), /עוד לא נלמדה/);
    stored = await page.evaluate(() => JSON.parse(localStorage.getItem('fw.progress.v2')).small);
    assert.equal(stored, undefined, 'removing the mark removes only the classification');
    await page.locator('#wordSheetClose').click();

    // The chapter sheet still offers its card after the detour.
    await page.locator('#bookContent .bw', { hasText: 'chapter' }).first().click();
    await page.locator('#wordSheet:not(.hidden)').waitFor();

    // Open its card from the sheet.
    await page.locator('#wordCardBtn').click();
    await page.waitForFunction(() => document.getElementById('wordSheet').classList.contains('hidden'));
    await page.locator('#detailSheet:not(.hidden)').waitFor();
    assert.equal(await page.locator('#detailWord').textContent(), 'chapter');
    await page.locator('#detailClose').click();

    // A word outside the app vocabulary: honest not-found, no actions.
    await page.locator('#bookContent .bw', { hasText: 'possessive' }).first().click();
    await page.locator('#wordSheet:not(.hidden)').waitFor();
    assert.equal(await page.locator('#wordSheetWord').textContent(), 'possessive');
    assert.match(await page.locator('#wordSheetState').textContent(), /לא נמצאת ברשימת המילים/);
    assert.ok(await page.locator('#wordCardBtn').isHidden(), 'no card for a word the app does not teach');
    assert.ok(await page.locator('#wordKnownBtn').isHidden(), 'no known toggle for a word the app does not teach');
    assert.ok(await page.locator('#wordUnknownBtn').isHidden(), 'no classify button for a word the app does not teach');
    assert.ok(await page.locator('#wordSheetGloss').isHidden(), 'no translation for a word the app does not teach');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.getElementById('wordSheet').classList.contains('hidden'));

    // Inflected possessive finds the base-form card and notes the book form.
    await page.locator('#bookContent .bw', { hasText: 'harry’s' }).first().click();
    await page.locator('#wordSheet:not(.hidden)').waitFor();
    assert.equal(await page.locator('#wordSheetWord').textContent(), 'Harry', 'possessive resolves to the base-form card');
    assert.ok(await page.locator('#wordSheetFormRow').isVisible(), 'book form noted when it differs');
    assert.equal(await page.locator('#wordSheetForm').textContent(), 'harry’s');
    await page.locator('#wordSheetClose').click();

    // Inflection lookup: an untaught plural finds the base card, case-insensitively.
    const hit = await page.evaluate(async () => (await lookupBookWord('SMALLS'))?.w || null);
    assert.equal(hit, 'small', 'plural/case-insensitive lookup finds the base form');

    // -ing forms: silent-e restoration and consonant dedoubling find listed bases.
    // crane entered the app list with the book vocabulary, so craning resolves too.
    assert.equal(await page.evaluate(async () => (await lookupBookWord('circling'))?.w || null), 'circle', 'silent-e -ing finds the base');
    assert.equal(await page.evaluate(async () => (await lookupBookWord('cropping'))?.w || null), 'crop', 'consonant-doubling -ing finds the base');
    assert.equal(await page.evaluate(async () => (await lookupBookWord('craning'))?.w || null), 'crane', 'crane is a book-vocabulary card');
  } finally {
    await context.close();
  }
  console.log('PASS book word tap: app number, card, known/unknown toggle, not-found and inflections');
}


async function longPress(page, locator) {
  const box = await locator.boundingBox();
  await page.mouse.move(box.x + 3, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(700);
  await page.mouse.up();
  await page.waitForTimeout(120);
}

async function highlightFlow() {
  const { page, context } = await newPage();
  try {
    await page.locator('.tab-btn[data-tab="book"]').click();
    await page.locator('#bookFile').setInputFiles(epubPath);
    await page.waitForFunction(() => document.getElementById('bookTitle').textContent === 'Fixture Book');

    // Sheet button highlights the tapped word and closes the sheet.
    await page.locator('#bookContent .bw').first().click();
    await page.locator('#wordSheet:not(.hidden)').waitFor();
    assert.equal(await page.locator('#wordHighlightBtn').textContent(), 'הדגשת המילה');
    await page.locator('#wordHighlightBtn').click();
    await page.waitForFunction(() => document.getElementById('wordSheet').classList.contains('hidden'));
    assert.equal(await page.locator('#bookContent .bw.hl').count(), 1, 'sheet button highlights the word');

    // The button label flips on an already-highlighted word.
    await page.locator('#bookContent .bw.hl').first().click();
    await page.locator('#wordSheet:not(.hidden)').waitFor();
    assert.equal(await page.locator('#wordHighlightBtn').textContent(), 'הסרת הדגשה');
    await page.locator('#wordSheetClose').click();

    // Long-press highlights directly and never opens the word sheet.
    await longPress(page, page.locator('#bookContent .bw').nth(2));
    assert.equal(await page.locator('#bookContent .bw.hl').count(), 2, 'long-press highlights another word');
    assert.equal(await page.locator('#wordSheet.hidden').count(), 1, 'long-press leaves the sheet closed');
    // A second long-press on the same word removes its highlight.
    await longPress(page, page.locator('#bookContent .bw').nth(2));
    assert.equal(await page.locator('#bookContent .bw.hl').count(), 1, 'long-press again removes the highlight');

    // Highlighting is a pure reader mark: learning progress stays untouched.
    const stored = await page.evaluate(() => localStorage.getItem('fw.progress.v2'));
    await longPress(page, page.locator('#bookContent .bw').nth(4));
    await longPress(page, page.locator('#bookContent .bw').nth(4));
    assert.equal(await page.evaluate(() => localStorage.getItem('fw.progress.v2')), stored, 'no progress written by highlighting');

    // Highlights survive a chapter switch and a reload.
    await openReaderPanel(page);
    await page.locator('#bookChapter').selectOption('1');
    await page.waitForFunction(() => document.getElementById('bookContent').innerText.includes('The Middle'));
    await page.locator('#bookChapter').selectOption('0');
    await page.waitForFunction(() => document.getElementById('bookContent').innerText.includes('The Beginning'));
    assert.equal(await page.locator('#bookContent .bw.hl').count(), 1, 'highlight survives chapter switch');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => vocab.length > 9000 && typeof VocabReader !== 'undefined');
    await page.locator('.tab-btn[data-tab="book"]').click();
    await page.waitForFunction(() => document.getElementById('bookTitle').textContent === 'Fixture Book');
    await page.waitForFunction(() => document.querySelectorAll('#bookContent .bw.hl').length === 1);
    assert.ok(await page.evaluate(() => (JSON.parse(localStorage.getItem('vocab-reader-highlights')) || []).length === 1), 'highlight persisted in localStorage');

    // Removing the book clears its highlights.
    page.on('dialog', d => d.accept());
    await openReaderPanel(page);
    await page.locator('#bookRemoveBtn').click();
    await page.waitForFunction(() => localStorage.getItem('vocab-reader-highlights') === null);
  } finally {
    await context.close();
  }
  console.log('PASS word highlight: sheet button, long-press toggle, persistence, removal cleanup');
}


async function highlightCloudSyncFlow() {
  // 1. Marks made before sync existed (localStorage without a stamp) migrate up.
  let { page, context } = await newPage();
  let saved;
  try {
    await page.evaluate(mockFbScript());
    await page.locator('.tab-btn[data-tab="book"]').click();
    await page.locator('#bookFile').setInputFiles(epubPath);
    await page.waitForFunction(() => document.getElementById('bookTitle').textContent === 'Fixture Book');
    await page.waitForFunction(() => !!window.__fbMock.saved, { timeout: 5000 });
    saved = await page.evaluate(() => window.__fbMock.saved);
    // Legacy device-local marks: no stamp key, cloud copy does not exist yet.
    await page.evaluate(() => localStorage.setItem('vocab-reader-highlights', JSON.stringify(['0:3'])));
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => vocab.length > 9000 && typeof VocabReader !== 'undefined');
    await page.evaluate(mockFbScript());
    await page.locator('.tab-btn[data-tab="book"]').click();
    await page.waitForFunction(() => document.getElementById('bookTitle').textContent === 'Fixture Book');
    await page.waitForFunction(() => (window.__fbMock.highlights?.list || []).join(',') === '0:3', { timeout: 8000 });
  } finally {
    await context.close();
  }
  // 2. A fresh device pulls the account's marks; a local removal overwrites the cloud list.
  ({ page, context } = await newPage());
  let hlState;
  try {
    await page.evaluate(mockFbScript(JSON.stringify(saved), JSON.stringify({ list: ['0:3', '0:7'], updatedAt: Date.now() })));
    await page.locator('.tab-btn[data-tab="book"]').click();
    await page.waitForFunction(() => document.querySelectorAll('#bookContent .bw.hl').length === 2, { timeout: 8000 });
    const spans = await page.evaluate(() => [...document.querySelectorAll('#bookContent .bw')]);
    await page.evaluate(() => VocabReader.toggleWordHighlight(document.querySelectorAll('#bookContent .bw')[3]));
    await page.waitForFunction(() => (window.__fbMock.highlights?.list || []).join(',') === '0:7', { timeout: 5000 });
    hlState = await page.evaluate(() => window.__fbMock.highlights);
    assert.equal(await page.locator('#bookContent .bw.hl').count(), 1, 'removal reflected locally');
  } finally {
    await context.close();
  }
  // 3. A stale device does not resurrect the removed mark (last write wins).
  ({ page, context } = await newPage());
  try {
    await page.evaluate(mockFbScript(JSON.stringify(saved), JSON.stringify(hlState)));
    await page.evaluate(() => {
      localStorage.setItem('vocab-reader-highlights', JSON.stringify(['0:3', '0:7']));
      localStorage.setItem('vocab-reader-highlights-at', '1'); // stale
    });
    await page.locator('.tab-btn[data-tab="book"]').click();
    await page.waitForFunction(() => document.getElementById('bookTitle').textContent === 'Fixture Book');
    await page.waitForFunction(() => document.querySelectorAll('#bookContent .bw').length > 10);
    await page.waitForFunction(() => localStorage.getItem('vocab-reader-highlights') === '["0:7"]', { timeout: 8000 });
    assert.equal(await page.locator('#bookContent .bw.hl').count(), 1, 'stale local mark not resurrected');
    // 4. Removing the book clears the cloud highlights doc too.
    page.on('dialog', d => d.accept());
    await openReaderPanel(page);
    await page.locator('#bookRemoveBtn').click();
    await page.waitForFunction(() => window.__fbMock.highlightsDeleted === true, { timeout: 5000 });
    assert.equal(await page.evaluate(() => localStorage.getItem('vocab-reader-highlights')), null);
  } finally {
    await context.close();
  }
  console.log('PASS highlight cloud sync: legacy migration, fresh-device restore, LWW removal, cleared with book');
}

(async () => {
  epubPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'epub-')), 'fixture.epub');
  fs.writeFileSync(epubPath, buildTestEpub());
  await new Promise(resolve => server.listen(0, resolve));
  base = `http://localhost:${server.address().port}/`;
  browser = await chromium.launch();
  try {
    await importFlow();
    await frequencyInDetails();
    await missingBookKeepsAppUsable();
    await cloudSyncFlow();
    await coverOpeningFlow();
    await paginationFlow();
    await wordTapFlow();
    await highlightFlow();
    await highlightCloudSyncFlow();
  } finally {
    await browser.close();
    server.close();
  }
})().catch(err => { console.error(err); process.exit(1); });
