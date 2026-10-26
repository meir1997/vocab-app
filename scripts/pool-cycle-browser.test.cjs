// Learning-pool cycle rules (user request, 25.10): learned words are never
// queued again; before the 200-word pool fills, sessions are new words only;
// once full, the pool cycles least-recently-answered first and every answer
// moves a word to the back. Isolated synthetic state, no Firebase.
'use strict';

const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const words = JSON.parse(fs.readFileSync(path.join(root, 'vocab.json'), 'utf8'));
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
async function isolatedPage(progress) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  await context.route('https://**/*', route => route.fulfill({ body: '', contentType: 'application/javascript' }));
  await context.route('**/firebase-config.js', route => route.fulfill({ body: '', contentType: 'application/javascript' }));
  const seeded = {
    'fw.progress.v2': JSON.stringify(progress),
    'fw.settings.v2': JSON.stringify({ length: 20, mode: 'choice', goal: 20 }),
    'fw.stats.v2': JSON.stringify({ days: {}, attempts: 0, correct: 0 }),
    'fw.bands.v1': JSON.stringify({ current: 3, recent: [], thousandRecent: [] })
  };
  await context.addInitScript(seeded => {
    for (const [key, value] of Object.entries(seeded)) localStorage.setItem(key, value);
  }, seeded);
  const page = await context.newPage();
  await page.goto(base);
  await page.waitForFunction(() => vocab.length > 9000);
  return { context, page };
}

const learningRec = (rank, last) => ({ r: 1, w: 1, s: 1, next: past, last: last ?? rank * 1000 });
const missedRec = (rank, last) => ({ r: 0, w: 1, s: 0, next: past, last: last ?? rank * 1000 });
const learnedDueRec = () => ({ r: 2, w: 0, s: 2, next: past, last: past });

async function noRepeatsBeforePoolFills() {
  const progress = {};
  for (let rank = 1; rank <= 50; rank++) progress[byRank(rank).w] = learningRec(rank);
  for (let rank = 51; rank <= 80; rank++) progress[byRank(rank).w] = learnedDueRec();
  const { context, page } = await isolatedPage(progress);
  try {
    const result = await page.evaluate(() => {
      const queue = buildQueue();
      return {
        length: queue.length,
        allFresh: queue.every(item => !isAttempted(progress[item.w])),
        allBook: queue.every(item => isBookWord(item)),
        due: dueCount(),
        learned: learnedCount(),
        learning: learningCount()
      };
    });
    assert.equal(result.length, 20, 'session fills with 20 new words');
    assert.ok(result.allFresh, 'no attempted word repeats before the pool fills');
    assert.ok(result.allBook, 'the unsorted book series is admitted before band-gated words');
    assert.equal(result.due, 0, 'nothing counts as due during ramp-up');
    assert.equal(result.learned, 30);
    assert.equal(result.learning, 50);
  } finally { await context.close(); }
  console.log('PASS before 200 in learning: book words first, no repeats, nothing due');
}

async function fullPoolCyclesInOrder() {
  const progress = {};
  for (let rank = 1; rank <= 200; rank++) progress[byRank(rank).w] = rank % 2 ? missedRec(rank) : learningRec(rank);
  for (let rank = 301; rank <= 310; rank++) progress[byRank(rank).w] = learnedDueRec();
  const { context, page } = await isolatedPage(progress);
  try {
    const result = await page.evaluate(() => {
      const first = buildQueue();
      const order = first.map(item => item.w);
      const expected = [...Array(20)].map((_, i) => vocab.find(v => v.r === i + 1).w);
      const noLearned = first.every(item => !isLearned(progress[item.w]));
      markWord(order[0], false); // a miss still goes to the back of the cycle
      const second = buildQueue().map(item => item.w);
      return {
        orderMatches: JSON.stringify(order) === JSON.stringify(expected),
        noLearned,
        secondStartsWithFormerSecond: second[0] === expected[1],
        answeredWordAbsent: !second.includes(order[0]),
        due: dueCount()
      };
    });
    assert.ok(result.orderMatches, 'first session is the 20 least-recently-answered pool words, in order');
    assert.ok(result.noLearned, 'learned words never enter the queue');
    assert.ok(result.secondStartsWithFormerSecond, 'the next session continues the cycle in order');
    assert.ok(result.answeredWordAbsent, 'an answered word moves to the back (word 1 returns only after word 200)');
    assert.equal(result.due, 200, 'while cycling, the whole pool counts as due');
  } finally { await context.close(); }
  console.log('PASS at 200: FIFO cycle, answer to the back, learned words excluded');
}

async function graduationRefillsWithNewWords() {
  const progress = {};
  for (let rank = 1; rank <= 200; rank++) progress[byRank(rank).w] = learningRec(rank);
  const { context, page } = await isolatedPage(progress);
  try {
    const result = await page.evaluate(() => {
      const first = buildQueue().map(item => item.w);
      markWord(first[0], true); // s:1 -> s:2 with a miss on record: graduates
      const learnedNow = isLearned(progress[first[0]]);
      const second = buildQueue();
      return {
        learnedNow,
        length: second.length,
        allFresh: second.every(item => !isAttempted(progress[item.w])),
        graduatedAbsent: !second.some(item => item.w === first[0]),
        learning: learningCount()
      };
    });
    assert.ok(result.learnedNow, 'second consecutive correct answer graduates the word');
    assert.equal(result.learning, 199, 'pool drops below the cap');
    assert.equal(result.length, 20);
    assert.ok(result.allFresh, 'below the cap the session is new words again, not early repeats');
    assert.ok(result.graduatedAbsent, 'the graduated word is never queued again');
  } finally { await context.close(); }
  console.log('PASS graduation: learned word exits for good, freed slot takes new words');
}

async function statsShowLearningAndVaryingBars() {
  const progress = {};
  for (let rank = 1; rank <= 7; rank++) progress[byRank(rank).w] = learningRec(rank);
  const { context, page } = await isolatedPage(progress);
  try {
    const result = await page.evaluate(() => {
      const seq = [300, 149, 132, 290, 2, 45, 163];
      for (let i = 0; i < 7; i++) {
        const d = new Date(); d.setDate(d.getDate() - (6 - i));
        const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        stats.days[k] = { a: seq[i], c: seq[i] };
      }
      switchTab('stats'); // bars measure only while the tab is visible
      renderStats();
      const heights = [...document.querySelectorAll('#weekBars .bar i')].map(i => i.getBoundingClientRect().height);
      return { learning: document.getElementById('statsLearning').textContent, heights };
    });
    assert.equal(result.learning, '7', 'in-learning count visible in stats');
    const distinct = new Set(result.heights.map(h => Math.round(h)));
    assert.ok(distinct.size >= 5, `week bars vary with the data (got ${JSON.stringify(result.heights)})`);
    assert.ok(Math.min(...result.heights) < 6, 'a 2-answer day stays near the minimum');
  } finally { await context.close(); }
  console.log('PASS stats: in-learning counter and week bars follow the data');
}

(async () => {
  await new Promise(resolve => server.listen(0, resolve));
  base = `http://localhost:${server.address().port}/`;
  browser = await chromium.launch();
  try {
    await noRepeatsBeforePoolFills();
    await fullPoolCyclesInOrder();
    await graduationRefillsWithNewWords();
    await statsShowLearningAndVaryingBars();
  } finally {
    await browser.close();
    server.close();
  }
})().catch(err => { console.error(err); process.exit(1); });
