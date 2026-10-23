// Isolated production-DOM acceptance checks. Every browser context is new,
// seeded with synthetic local progress, and cannot contact Firebase or users.
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
const future = Date.now() + 30 * DAY;
const keys = ['fw.progress.v2', 'fw.settings.v2', 'fw.stats.v2', 'fw.bands.v1'];
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
  // Never use an existing profile, account, or production endpoint.
  await context.route('https://**/*', route => route.fulfill({ body: '', contentType: 'application/javascript' }));
  await context.route('**/firebase-config.js', route => route.fulfill({ body: '', contentType: 'application/javascript' }));
  const seeded = {
    'fw.progress.v2': JSON.stringify(progress),
    'fw.settings.v2': JSON.stringify({ length: 20, mode: 'choice', goal: 20 }),
    'fw.stats.v2': JSON.stringify({ days: { '2026-01-02': { a: 215, c: 20 } }, attempts: 215, correct: 20 }),
    'fw.bands.v1': JSON.stringify({ current: 3, recent: [], thousandRecent: [] })
  };
  await context.addInitScript(seeded => {
    for (const [key, value] of Object.entries(seeded)) localStorage.setItem(key, value);
  }, seeded);
  const page = await context.newPage();
  await page.goto(base);
  await page.waitForFunction(() => vocab.length > 9000 && typeof VocabQuiz !== 'undefined');
  return { context, page, seeded };
}

async function countsAndReadOnlyDerivation() {
  const progress = {};
  for (let rank = 1; rank <= 190; rank++) progress[byRank(rank).w] = { r: 0, w: 1, s: 0, next: future };
  for (let rank = 191; rank <= 200; rank++) progress[byRank(rank).w] = { r: 1, w: 0, s: 1, next: future };
  for (let rank = 301; rank <= 305; rank++) progress[byRank(rank).w] = { r: 2, w: 1, s: 2, next: future };
  const { context, page, seeded } = await isolatedPage(progress);
  try {
    const result = await page.evaluate(() => {
      const records = Object.values(progress);
      const queue = buildQueue();
      refreshHome(); renderStats();
      return {
        old: { learned: records.filter(p => p.s >= 2).length, learning: records.filter(p => (p.r + p.w) > 0 && p.s < 2).length },
        current: { learned: learnedCount(), learning: learningCount() },
        attempted: records.filter(isAttempted).length,
        home: document.getElementById('learnedStat').textContent,
        stats: document.getElementById('statsLearned').textContent,
        learningNote: document.getElementById('learningNote').textContent,
        queueLength: queue.length,
        allNewCurrentBand: queue.every(item => inCurrentBand(item) && !isAttempted(progress[item.w])),
        intervals: [...INTERVALS],
        inMemoryProgress: JSON.stringify(progress),
        firebaseReady: fb.ready,
        predicates: [
          isLearned(undefined),
          isLearned({ r: 0, w: 0, s: 2, next: 0 }),
          isLearned({ r: 1, w: 0, s: 1, next: 0 }),
          isLearned({ r: 1, w: 1, s: 1, next: 0 }),
          isLearned({ r: 2, w: 1, s: 2, next: 0 })
        ]
      };
    });
    assert.deepEqual(result.old, { learned: 5, learning: 200 });
    assert.deepEqual(result.current, { learned: 15, learning: 190 });
    assert.equal(result.attempted, result.current.learned + result.current.learning, 'learned and learning partition attempted records');
    assert.equal(result.home, '15');
    assert.equal(result.stats, '15');
    assert.match(result.learningNote, /190\/200/);
    assert.equal(result.queueLength, 20, 'queue has no reserved learning slots');
    assert.equal(result.allNewCurrentBand, true, 'freed capacity admits new current-band words');
    assert.deepEqual(result.predicates, [false, false, true, false, true]);
    assert.deepEqual(result.intervals, [1, 3, 7, 14, 30]);
    assert.equal(result.inMemoryProgress, seeded['fw.progress.v2'], 'derivation leaves every answer and next-review date intact');
    assert.equal(result.firebaseReady, false);
    const stored = await page.evaluate(keys => Object.fromEntries(keys.map(key => [key, localStorage.getItem(key)])), keys);
    assert.deepEqual(stored, seeded, 'counting, rendering and queue building perform no data migration or history writes');
    console.log('PASS isolated counts: learned 5 -> 15; learning 200 -> 190; attempted 205 unchanged; 20 new current-band words admitted; stored history/dates/settings/stats/bands unchanged');
  } finally { await context.close(); }
}

async function noReservationAndDynamicCap() {
  const progress = {};
  for (let rank = 1; rank <= 198; rank++) progress[byRank(rank).w] = { r: 0, w: 1, s: 0, next: future };
  progress[byRank(400).w] = { r: 1, w: 1, s: 1, next: future };
  const { context, page } = await isolatedPage(progress);
  try {
    const initial = await page.evaluate(() => {
      const queue = buildQueue(); const secondQueue = buildQueue();
      return { learning: learningCount(), queue: queue.length, secondQueue: secondQueue.length, newWords: queue.every(item => !isAttempted(progress[item.w])) };
    });
    assert.deepEqual(initial, { learning: 199, queue: 20, secondQueue: 20, newWords: true }, 'queues do not reserve slots or increment the learning count');
    await page.evaluate(() => {
      session = { queue: [201, 202, 400, 203].map(rank => vocab.find(item => item.r === rank)), index: 0, correct: 0, wrong: 0, active: true };
      stats = { days: {}, attempts: 0, correct: 0 };
      document.getElementById('practiceHome').classList.add('hidden');
      document.getElementById('quizCard').classList.remove('hidden');
      locked = false; showQuestion();
    });
    await page.locator('#dontKnowBtn').click();
    assert.equal(await page.evaluate(() => learningCount()), 200, 'a new-word miss fills the real cap');
    await page.locator('#nextBtn').click();
    assert.deepEqual(await page.evaluate(() => ({ rank: session.queue[session.index].r, untouched202: !progress[vocab.find(item => item.r === 202).w], learning: learningCount() })),
      { rank: 400, untouched202: true, learning: 200 }, 'full cap skips an unseen queued word, while an attempted review remains available');
    await page.evaluate(() => document.querySelector('.answer[data-correct="true"]').click());
    await page.waitForFunction(() => session.queue[session.index]?.r === 203);
    assert.deepEqual(await page.evaluate(() => ({ learned: learnedCount(), learning: learningCount() })), { learned: 1, learning: 199 }, 'the second correct answer after a miss releases capacity');
    await page.evaluate(() => document.querySelector('.answer[data-correct="true"]').click());
    await page.waitForFunction(() => !session.active);
    const final = await page.evaluate(() => ({
      learned: learnedCount(), learning: learningCount(), attempts: stats.attempts, correct: session.correct, wrong: session.wrong,
      unseenSkipped: !progress[vocab.find(item => item.r === 202).w],
      onceCorrect: progress[vocab.find(item => item.r === 203).w],
      missed: progress[vocab.find(item => item.r === 201).w],
      recovered: progress[vocab.find(item => item.r === 400).w]
    }));
    assert.deepEqual({ learned: final.learned, learning: final.learning, attempts: final.attempts, correct: final.correct, wrong: final.wrong },
      { learned: 2, learning: 199, attempts: 3, correct: 2, wrong: 1 });
    assert.equal(final.unseenSkipped, true);
    assert.deepEqual([final.onceCorrect.r, final.onceCorrect.w, final.onceCorrect.s], [1, 0, 1]);
    assert.deepEqual([final.missed.r, final.missed.w, final.missed.s], [0, 1, 0]);
    assert.deepEqual([final.recovered.r, final.recovered.w, final.recovered.s], [2, 1, 2]);
    assert.ok(Math.abs(final.onceCorrect.next - Date.now() - DAY) < 5000, 'clean first answer retains the one-day SRS interval');
    assert.ok(Math.abs(final.recovered.next - Date.now() - 3 * DAY) < 5000, 'second streak success retains the three-day SRS interval');
    console.log('PASS dynamic cap: 199 learning -> 200 after miss; queued unseen blocked at 200; attempted review allowed; recovery -> 199; next new 1/1 answer learned; final learned 2 / learning 199 / attempts 3');
  } finally { await context.close(); }
}

async function fullCapBlocksNewWords() {
  const progress = {};
  for (let rank = 1; rank <= 200; rank++) progress[byRank(rank).w] = { r: 0, w: 1, s: 0, next: 0 };
  const { context, page, seeded } = await isolatedPage(progress);
  try {
    const result = await page.evaluate(() => {
      const queue = buildQueue();
      return { learning: learningCount(), learned: learnedCount(), queue: queue.length, attemptedOnly: queue.every(item => isAttempted(progress[item.w])), stored: localStorage.getItem(K.progress) };
    });
    assert.deepEqual(result, { learning: 200, learned: 0, queue: 20, attemptedOnly: true, stored: seeded['fw.progress.v2'] });
    console.log('PASS full cap: 200 learning / 0 learned; 20 attempted due reviews admitted; 0 unseen words admitted');
  } finally { await context.close(); }
}

async function laterMissRestoresExistingRule() {
  const { context, page } = await isolatedPage({});
  try {
    const result = await page.evaluate(() => {
      const word = vocab.find(item => item.r === 1).w;
      const states = [true, true, false, true, true].map(correct => {
        const before = Date.now();
        markWord(word, correct);
        const record = progress[word];
        return { learned: isLearned(record), learning: isLearning(record), r: record.r, w: record.w, s: record.s, nextDelay: record.next - before };
      });
      return { states, learned: learnedCount(), learning: learningCount() };
    });
    assert.deepEqual(result.states.map(({ learned, learning, r, w, s }) => ({ learned, learning, r, w, s })), [
      { learned: true, learning: false, r: 1, w: 0, s: 1 },
      { learned: true, learning: false, r: 2, w: 0, s: 2 },
      { learned: false, learning: true, r: 2, w: 1, s: 0 },
      { learned: false, learning: true, r: 3, w: 1, s: 1 },
      { learned: true, learning: false, r: 4, w: 1, s: 2 }
    ], 'a second clean success stays learned, while any later miss restores the existing two-success rule');
    [DAY, 3 * DAY, 0, DAY, 3 * DAY].forEach((delay, index) => {
      assert.ok(Math.abs(result.states[index].nextDelay - delay) < 1000, 'learning status does not change the SRS review interval');
    });
    assert.deepEqual({ learned: result.learned, learning: result.learning }, { learned: 1, learning: 0 });
    console.log('PASS history sequence: 1/1 learned -> 2/2 learned -> later miss learning -> one recovery learning -> second recovery learned; existing SRS intervals unchanged');
  } finally { await context.close(); }
}

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}/vocab-app/`;
  browser = await chromium.launch({ args: ['--no-sandbox'], ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}) });
  await countsAndReadOnlyDerivation();
  await noReservationAndDynamicCap();
  await fullCapBlocksNewWords();
  await laterMissRestoresExistingRule();
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (browser) await browser.close();
  await new Promise(resolve => server.close(resolve));
});
