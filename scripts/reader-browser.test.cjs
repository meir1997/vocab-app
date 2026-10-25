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
const { buildTestEpub } = require('./epub-fixture.cjs');

const root = path.resolve(__dirname, '..');
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
    assert.equal(await page.evaluate(() => getComputedStyle(document.getElementById('bookContent')).fontSize), '16px', 'fresh import resets font scale');
    const text = await page.locator('#bookContent').innerText();
    assert.match(text, /The Beginning/);
    assert.match(text, /a link/, 'unwrapped link text survives');
    assert.match(text, /harry’s/, 'curly apostrophe text survives');
    assert.doesNotMatch(text, /must not survive/, 'script content is dropped');
    assert.equal(await page.locator('#bookContent script, #bookContent img, #bookContent iframe').count(), 0, 'active/embedded markup is removed');

    // Chapter switch
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

    // Font size control persists.
    const before = await page.evaluate(() => getComputedStyle(document.getElementById('bookContent')).fontSize);
    await page.locator('#bookFontUp').click();
    const after = await page.evaluate(() => getComputedStyle(document.getElementById('bookContent')).fontSize);
    assert.ok(parseFloat(after) > parseFloat(before), 'font grows');

    // Removal returns to the empty state.
    page.on('dialog', d => d.accept());
    await page.locator('#bookRemoveBtn').click();
    await page.locator('#bookImportBtn').waitFor({ state: 'visible' });
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
  } finally {
    await browser.close();
    server.close();
  }
})().catch(err => { console.error(err); process.exit(1); });
