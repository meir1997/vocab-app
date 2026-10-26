// Sort mode (user request, 26.10): a classification pass over every word never
// graded yet, in order, without skipping. The queue has no band gate, no
// session-length cap and no pool-admission check. Right swipe (or יודע) scores
// like a correct answer; left swipe (or לא יודע) writes a classification
// record ({u:1}), not a miss: the word waits outside the capped 200-word
// learning pool and capped practice admits it first when room frees up.
// Isolated synthetic state, no Firebase.
'use strict';

const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const words = JSON.parse(fs.readFileSync(path.join(root, 'vocab.json'), 'utf8'));
// The app merges the book vocabulary (ranks 10001+) into the word list, so
// sort expectations must cover it too.
const bookWords = JSON.parse(fs.readFileSync(path.join(root, 'book-vocab.json'), 'utf8'));
const allWords = words.concat(bookWords);
const frequency = JSON.parse(fs.readFileSync(path.join(root, 'book-frequency.json'), 'utf8'));
const counts = frequency.counts || {};
const byRank = rank => words.find(word => word.r === rank);
const DAY = 86400000;
const past = Date.now() - DAY;
const server = http.createServer((request, response) => {
  const requested = decodeURIComponent(new URL(request.url, 'http://localhost').pathname)
    .replace(/^\/vocab-app(?:\/|$)/, '/');
  const file = path.resolve(root, '.' + (requested.endsWith('/') ? requested + 'index.html' : requested));
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return response.writeHead(404).end();
  const types = { '.html': 'text/html', '.js': 'application/javascript', '.json': 'application/json', '.css': 'text/css' };
  response.setHeader('Content-Type', (types[path.extname(file)] || 'application/octet-stream') + '; charset=utf-8');
  response.end(fs.readFileSync(file));
});

let browser;
let base;
async function isolatedPage(progress, settings) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block', hasTouch: true });
  await context.route('https://**/*', route => route.fulfill({ body: '', contentType: 'application/javascript' }));
  await context.route('**/firebase-config.js', route => route.fulfill({ body: '', contentType: 'application/javascript' }));
  const seeded = {
    'fw.progress.v2': JSON.stringify(progress),
    'fw.settings.v2': JSON.stringify(Object.assign({ length: 20, mode: 'sort', goal: 20 }, settings)),
    'fw.stats.v2': JSON.stringify({ days: {}, attempts: 0, correct: 0 }),
    'fw.bands.v1': JSON.stringify({ current: 3, recent: [], thousandRecent: [] })
  };
  await context.addInitScript(seeded => {
    for (const [key, value] of Object.entries(seeded)) localStorage.setItem(key, value);
  }, seeded);
  const page = await context.newPage();
  await page.goto(base);
  await page.waitForFunction(() => vocab.length > 9000 && bookFrequency);
  return { context, page };
}

const learnedRec = () => ({ r: 1, w: 0, s: 1, next: past, last: past });
const learningRec = stamp => ({ r: 1, w: 1, s: 0, next: past, last: stamp });
const expectedBookQueue = progress => allWords
  .filter(v => !progress[v.w] && (counts[v.r] || 0) > 0)
  .sort((a, b) => ((counts[b.r] - counts[a.r]) || (a.r - b.r)))
  .map(v => v.w);
// Book priority applies to sorting too (user clarification, 26.10): the 'all'
// scope leads with the book series in book order, then regular rank order.
const byAnyRank = rank => allWords.find(word => word.r === rank);
const expectedAllQueue = progress => allWords.filter(v => !progress[v.w])
  .sort((a, b) => ((a.r > 10000 ? 0 : 1) - (b.r > 10000 ? 0 : 1)) || (a.r - b.r)).map(v => v.w);

async function bookScopeOrder() {
  const progress = {};
  // Words already graded must leave the sort queue, however often the book uses them.
  for (const rank of Object.keys(counts).slice(0, 40)) progress[byRank(Number(rank)).w] = learnedRec();
  const { context, page } = await isolatedPage(progress, { mode: 'sort', sortScope: 'book' });
  try {
    await page.locator('#startBtn').click();
    await page.waitForFunction(() => session.active);
    const result = await page.evaluate(() => ({ queue: session.queue.map(item => item.w), label: document.getElementById('sessionLabel').textContent, band: document.getElementById('quizBandLabel').textContent }));
    const expected = expectedBookQueue(progress);
    assert.deepEqual(result.queue, expected, 'book scope: every unsorted book word, by occurrence count then rank');
    assert.ok(result.queue.length > 1000, 'book scope covers the book vocabulary');
    assert.ok(result.label.includes('מיון'), 'session label names sorting');
    assert.ok(result.band.includes('הספר'), 'band label names the book scope');
    assert.equal(await page.locator('#flashcardBox').isVisible(), true, 'cards presentation in sort mode');
    assert.equal(await page.locator('#answers').evaluate(el => el.children.length), 0, 'no choice buttons in sort mode');
  } finally { await context.close(); }
  console.log('PASS sort book scope: all unsorted book words ordered by book frequency, cards presentation');
}

async function allScopeRankOrder() {
  const progress = {};
  for (let rank = 1; rank <= 10; rank++) progress[byRank(rank).w] = learnedRec();
  // A classified word (sorted left earlier) must not reappear.
  progress[byRank(11).w] = { r: 0, w: 0, s: 0, u: 1, last: past };
  const { context, page } = await isolatedPage(progress, { mode: 'sort', sortScope: 'all' });
  try {
    await page.locator('#startBtn').click();
    await page.waitForFunction(() => session.active);
    const queue = await page.evaluate(() => session.queue.map(item => item.w));
    const expected = expectedAllQueue(progress);
    assert.deepEqual(queue, expected, 'all scope: book series first, then every unsorted word in rank order');
    assert.ok(queue.includes(byRank(50).w), 'words outside the current band are included');
    assert.ok(!queue.includes(byRank(1).w) && !queue.includes(byRank(11).w), 'graded and classified words are excluded');
    assert.equal(queue[0], byAnyRank(10001).w, 'starts at the first unsorted book word');
    assert.equal(queue[1127], byRank(12).w, 'the regular series follows the whole book block, in rank order');
  } finally { await context.close(); }
  console.log('PASS sort all scope: book priority then rank order, no band gate, graded/classified excluded');
}

async function gradeRightScoresKnown() {
  const { context, page } = await isolatedPage({}, { mode: 'sort', sortScope: 'all' });
  try {
    await page.locator('#startBtn').click();
    await page.waitForFunction(() => session.active);
    const word = await page.evaluate(() => session.queue[session.index].w);
    await page.locator('#knowBtn').click();
    await page.waitForFunction(() => session.index === 1);
    const result = await page.evaluate(w => ({ rec: progress[w], attempts: stats.attempts, correct: stats.correct, recent: bands.recent, rank: session.queue[0].r }), word);
    assert.deepEqual({ r: result.rec.r, s: result.rec.s, w: result.rec.w }, { r: 1, s: 1, w: 0 }, 'known sort scores like a correct answer');
    assert.equal(result.attempts, 1); assert.equal(result.correct, 1);
    assert.equal(result.recent.length, result.rank >= 201 && result.rank <= 300 ? 1 : 0, 'band window only counts in-band answers');
  } finally { await context.close(); }
  console.log('PASS sort right swipe: learned record, stats counted, band window follows rank');
}

async function gradeLeftClassifies() {
  const progress = {};
  for (let rank = 1; rank <= 12; rank++) progress[byRank(rank).w] = learningRec(rank * 1000);
  const { context, page } = await isolatedPage(progress, { mode: 'sort', sortScope: 'all' });
  try {
    await page.locator('#startBtn').click();
    await page.waitForFunction(() => session.active);
    const word = await page.evaluate(() => session.queue[session.index].w);
    const learningBefore = await page.evaluate(() => learningCount());
    await page.locator('#dontKnowBtn').click();
    await page.waitForFunction(() => session.index === 1);
    const result = await page.evaluate(w => ({ rec: progress[w], learning: learningCount(), recent: bands.recent.length, attempts: stats.attempts }), word);
    assert.equal(result.rec.u, 1, 'left swipe writes a classification record');
    assert.equal(result.rec.r + result.rec.w, 0, 'classification is not a miss record');
    assert.equal(result.learning, learningBefore, 'classified word does not grow the learning pool');
    assert.equal(result.recent, 0, 'classification is not a band answer');
    assert.equal(result.attempts, 1, 'classification counts as a daily answer');
    // A fresh session must not offer the classified word again.
    const remaining = await page.evaluate(() => session.queue.slice(session.index).map(item => item.w));
    assert.ok(!remaining.includes(word), 'classified word leaves the sort queue');
    // The waiting-not-known status is visible: the library marks the word.
    const level = await page.evaluate(w => {
      libFilter = w; renderLibrary(); // book words sort last in the library; filter to find the row
      const row = [...document.querySelectorAll('.word-item')].find(r => r.querySelector('.w').textContent === w);
      return row ? row.querySelector('.level').textContent : null;
    }, word);
    assert.equal(level, '⏳', 'classified word shows the waiting marker in the library');
  } finally { await context.close(); }
  console.log('PASS sort left swipe: classification record, pool and band untouched');
}

async function noSkipWithFullPool() {
  const progress = {};
  for (let rank = 1; rank <= 200; rank++) progress[byRank(rank).w] = learningRec(rank * 1000);
  const { context, page } = await isolatedPage(progress, { mode: 'sort', sortScope: 'all' });
  try {
    await page.locator('#startBtn').click();
    await page.waitForFunction(() => session.active);
    const result = await page.evaluate(() => ({ length: session.queue.length, first: session.queue[0].w, learning: learningCount() }));
    const expected = expectedAllQueue(progress);
    assert.equal(result.learning, 200, 'pool is full');
    assert.equal(result.length, expected.length, 'a full pool never truncates the sort queue');
    assert.equal(result.first, expected[0], 'the first unsorted word is shown despite the full pool');
    await page.locator('#knowBtn').click();
    await page.waitForFunction(() => session.index === 1);
  } finally { await context.close(); }
  console.log('PASS sort with full pool: no admission gate, nothing skipped');
}

async function resumeAcrossSessions() {
  const progress = {};
  for (let rank = 1; rank <= 5; rank++) progress[byRank(rank).w] = learnedRec();
  const firstRun = await isolatedPage(progress, { mode: 'sort', sortScope: 'all' });
  try {
    await firstRun.page.locator('#startBtn').click();
    await firstRun.page.waitForFunction(() => session.active);
    await firstRun.page.locator('#knowBtn').click();
    await firstRun.page.waitForFunction(() => session.index === 1);
    await firstRun.page.locator('#dontKnowBtn').click();
    await firstRun.page.waitForFunction(() => session.index === 2);
  } finally { await firstRun.context.close(); }
  const saved = {};
  for (let rank = 1; rank <= 5; rank++) saved[byRank(rank).w] = learnedRec();
  saved[byAnyRank(10001).w] = { r: 1, w: 0, s: 1, next: past, last: past };
  saved[byAnyRank(10002).w] = { r: 0, w: 0, s: 0, u: 1, last: past };
  const secondRun = await isolatedPage(saved, { mode: 'sort', sortScope: 'all' });
  try {
    await secondRun.page.locator('#startBtn').click();
    await secondRun.page.waitForFunction(() => session.active);
    const first = await secondRun.page.evaluate(() => session.queue[session.index].w);
    assert.equal(first, byAnyRank(10003).w, 'a later session resumes at the next unsorted book word');
  } finally { await secondRun.context.close(); }
  console.log('PASS sort resume: graded words stay sorted, queue continues in order');
}

async function admissionPriorityAndCap() {
  // Book priority is everywhere (user clarification, 26.10): with room in the
  // pool, the book series fills sessions ahead of a classified regular word.
  const room = {};
  for (let rank = 1; rank <= 190; rank++) room[byRank(rank).w] = learningRec(rank * 1000);
  room[byRank(5000).w] = { r: 0, w: 0, s: 0, u: 1, last: past };
  const { context, page } = await isolatedPage(room, { mode: 'choice' });
  try {
    await page.locator('#startBtn').click();
    await page.waitForFunction(() => session.active);
    const queue = await page.evaluate(() => session.queue.map(item => item.w));
    assert.ok(queue.every(w => bookWords.some(b => b.w === w)), 'the book series fills the session first');
    assert.ok(!queue.includes(byRank(5000).w), 'a classified regular word waits behind the book series');
  } finally { await context.close(); }
  // Once the book series is graded, the classified regular word keeps its
  // priority over band-gated fresh words.
  const afterBook = {};
  for (const b of bookWords) afterBook[b.w] = learnedRec();
  for (let rank = 1; rank <= 190; rank++) afterBook[byRank(rank).w] = learningRec(rank * 1000);
  afterBook[byRank(5000).w] = { r: 0, w: 0, s: 0, u: 1, last: past };
  const secondRun = await isolatedPage(afterBook, { mode: 'choice' });
  try {
    await secondRun.page.locator('#startBtn').click();
    await secondRun.page.waitForFunction(() => session.active);
    const queue = await secondRun.page.evaluate(() => session.queue.map(item => item.w));
    assert.ok(queue.includes(byRank(5000).w), 'classified regular word admitted ahead of band-gated fresh words once the book series is graded');
  } finally { await secondRun.context.close(); }
  // A classified book word leads the book series itself.
  const flaggedBook = {};
  flaggedBook[byAnyRank(10050).w] = { r: 0, w: 0, s: 0, u: 1, last: past };
  const thirdRun = await isolatedPage(flaggedBook, { mode: 'choice' });
  try {
    await thirdRun.page.locator('#startBtn').click();
    await thirdRun.page.waitForFunction(() => session.active);
    const queue = await thirdRun.page.evaluate(() => session.queue.map(item => item.w));
    assert.ok(queue.includes(byAnyRank(10050).w), 'a classified book word leads the book series');
  } finally { await thirdRun.context.close(); }
  // Full pool: the cap holds, the classified word waits.
  const full = {};
  for (let rank = 1; rank <= 200; rank++) full[byRank(rank).w] = learningRec(rank * 1000);
  full[byRank(5000).w] = { r: 0, w: 0, s: 0, u: 1, last: past };
  const second = await isolatedPage(full, { mode: 'choice' });
  try {
    await second.page.locator('#startBtn').click();
    await second.page.waitForFunction(() => session.active);
    const queue = await second.page.evaluate(() => session.queue.map(item => item.w));
    assert.equal(queue.length, 20, 'pool cycle unchanged');
    assert.ok(!queue.includes(byRank(5000).w), 'a full pool keeps the classified word waiting');
    assert.ok(queue.every(w => full[w].s < 2 && full[w].r + full[w].w > 0), 'only pool words are cycled');
  } finally { await second.context.close(); }
  console.log('PASS admission: book series first everywhere, classified book words lead it, classified regular words follow; the full 200 pool keeps everyone waiting');
}

async function defaultScopeIsAllRankOrder() {
  const { context, page } = await isolatedPage({}, { mode: 'sort' }); // no sortScope seeded
  try {
    await page.locator('#startBtn').click();
    await page.waitForFunction(() => session.active);
    const result = await page.evaluate(() => ({ first: session.queue[0].w, length: session.queue.length, band: document.getElementById('quizBandLabel').textContent, bookOptionDisabled: document.querySelector('#sortScopeSelect option[value="book"]').disabled }));
    assert.equal(result.first, byAnyRank(10001).w, 'default scope starts with the book series');
    assert.equal(result.length, allWords.length, 'default scope covers every unsorted word');
    assert.ok(result.band.includes('לפי הסדר'), 'default label is rank order');
    assert.equal(result.bookOptionDisabled, false, 'book scope offered when a book is loaded');
  } finally { await context.close(); }
  console.log('PASS default scope: book series first, then all words by rank; book scope optional');
}

async function main() {
  browser = await chromium.launch();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}/`;
  try {
    await bookScopeOrder();
    await allScopeRankOrder();
    await gradeRightScoresKnown();
    await gradeLeftClassifies();
    await noSkipWithFullPool();
    await resumeAcrossSessions();
    await admissionPriorityAndCap();
    await defaultScopeIsAllRankOrder();
  } finally {
    await browser.close();
    server.close();
  }
}

main().then(() => console.log('sort-mode browser suite passed')).catch(err => { console.error(err); process.exit(1); });
