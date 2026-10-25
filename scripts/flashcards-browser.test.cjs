// Flashcards mode (user request, 25.10): Quizlet-style cards - tap flips to
// the Hebrew meaning, swipe right (or יודע) grades known like a correct
// answer, swipe left (or לא יודע) grades unknown like "לא יודע". The mode
// shares buildQueue, so the learning-pool cycle rules hold unchanged.
// Isolated synthetic state, no Firebase.
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
async function isolatedPage(progress, mode) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block', hasTouch: true });
  await context.route('https://**/*', route => route.fulfill({ body: '', contentType: 'application/javascript' }));
  await context.route('**/firebase-config.js', route => route.fulfill({ body: '', contentType: 'application/javascript' }));
  const seeded = {
    'fw.progress.v2': JSON.stringify(progress),
    'fw.settings.v2': JSON.stringify({ length: 20, mode: mode || 'cards', goal: 20 }),
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

async function startCardsSession(page) {
  await page.locator('#startBtn').click();
  await page.waitForFunction(() => session.active);
}

async function cardFlowBasics() {
  const { context, page } = await isolatedPage({});
  try {
    await startCardsSession(page);
    assert.equal(await page.locator('#flashcardBox').isVisible(), true, 'card box visible in cards mode');
    assert.equal(await page.locator('#answers').evaluate(el => el.children.length), 0, 'no choice buttons in cards mode');
    assert.equal(await page.locator('#typingBox').isVisible(), false, 'typing hidden in cards mode');
    assert.equal(await page.locator('#knowBtn').isVisible(), true, 'know button visible');
    assert.equal(await page.locator('#dontKnowBtn').isVisible(), true, 'dont-know button visible');
    const word = await page.evaluate(() => session.queue[session.index].w);
    const prompt = await page.locator('#word').textContent();
    assert.equal(prompt, word, 'prompt shows the English word');
    assert.equal(await page.locator('#flashcard').evaluate(el => el.classList.contains('flipped')), false, 'card starts face-down');
    // Tap flips and reveals the meaning matching the displayed word.
    await page.locator('#flashcard').click();
    await page.waitForFunction(() => document.getElementById('flashcard').classList.contains('flipped'));
    const meaning = await page.locator('#fcMeaning').textContent();
    const expected = await page.evaluate(w => VocabQuiz.getWordContent(session.queue[session.index], wordDetails[session.queue[session.index].r]).meaning, word);
    assert.equal(meaning, expected, 'flip reveals the displayed word meaning');
    assert.ok(meaning.length > 0);
  } finally { await context.close(); }
  console.log('PASS cards mode: card renders face-down, tap flips to the correct meaning');
}

async function gradeRightLikeCorrect() {
  const { context, page } = await isolatedPage({});
  try {
    await startCardsSession(page);
    const word = await page.evaluate(() => session.queue[session.index].w);
    await page.locator('#knowBtn').click();
    await page.waitForFunction(() => session.index === 1);
    const result = await page.evaluate(w => ({ rec: progress[w], attempts: stats.attempts, correct: stats.correct, sessionCorrect: session.correct }), word);
    assert.deepEqual({ r: result.rec.r, s: result.rec.s, w: result.rec.w }, { r: 1, s: 1, w: 0 }, 'known grade scores like a correct answer');
    assert.ok(result.rec.last > 0, 'cycle timestamp recorded');
    assert.equal(result.attempts, 1); assert.equal(result.correct, 1); assert.equal(result.sessionCorrect, 1);
  } finally { await context.close(); }
  console.log('PASS know grade: scores like a correct answer (1/1 learned rule, stats, cycle stamp)');
}

async function gradeLeftLikeDontKnow() {
  const { context, page } = await isolatedPage({});
  try {
    await startCardsSession(page);
    const word = await page.evaluate(() => session.queue[session.index].w);
    await page.locator('#dontKnowBtn').click();
    await page.waitForFunction(() => session.index === 1);
    const result = await page.evaluate(w => ({ rec: progress[w], attempts: stats.attempts, correct: stats.correct, wrong: session.wrong }), word);
    assert.deepEqual({ r: result.rec.r, s: result.rec.s, w: result.rec.w }, { r: 0, s: 0, w: 1 }, 'unknown grade scores like a miss');
    assert.equal(result.attempts, 1); assert.equal(result.correct, 0); assert.equal(result.wrong, 1);
  } finally { await context.close(); }
  console.log('PASS dont-know grade: scores like a miss (s resets, word stays in learning)');
}

async function swipeGestures() {
  const { context, page } = await isolatedPage({});
  try {
    await startCardsSession(page);
    // Physical right swipe grades known even on the flipped card.
    const first = await page.evaluate(() => session.queue[session.index].w);
    await page.locator('#flashcard').click();
    const box = await page.locator('#flashcard').boundingBox();
    const y = box.y + box.height / 2;
    await page.mouse.move(box.x + box.width / 2, y);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 160, y, { steps: 5 });
    await page.mouse.up();
    await page.waitForFunction(() => session.index === 1);
    let rec = await page.evaluate(w => progress[w], first);
    assert.equal(rec.r, 1, 'swipe right grades known');
    // Physical left swipe grades unknown.
    const second = await page.evaluate(() => session.queue[session.index].w);
    await page.mouse.move(box.x + box.width / 2, y);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 - 160, y, { steps: 5 });
    await page.mouse.up();
    await page.waitForFunction(() => session.index === 2);
    rec = await page.evaluate(w => progress[w], second);
    assert.equal(rec.w, 1, 'swipe left grades unknown');
    // A short drag snaps back without grading or flipping.
    const thirdIndex = await page.evaluate(() => session.index);
    await page.mouse.move(box.x + box.width / 2, y);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 30, y, { steps: 3 });
    await page.mouse.up();
    await page.waitForTimeout(400);
    assert.equal(await page.evaluate(() => session.index), thirdIndex, 'short drag does not grade');
    assert.equal(await page.locator('#flashcard').evaluate(el => el.classList.contains('flipped')), false, 'short drag does not flip');
  } finally { await context.close(); }
  console.log('PASS swipes: right = know, left = unknown, short drag snaps back ungraded');
}

async function poolSemanticsShared() {
  // 200 learning words with distinct cycle stamps; the cards queue must be
  // the FIFO cycle order from buildQueue - the mode changes presentation only.
  const progress = {};
  // The front word has a miss on record, so grading it known keeps it in
  // learning (s: 1 < 2) and it must move to the back of the cycle.
  progress[byRank(1).w] = { r: 0, w: 1, s: 0, next: past, last: 1000 };
  for (let rank = 2; rank <= 200; rank++) progress[byRank(rank).w] = { r: 1, w: 1, s: 1, next: past, last: rank * 1000 };
  for (let rank = 201; rank <= 230; rank++) progress[byRank(rank).w] = { r: 2, w: 0, s: 2, next: past, last: past };
  const { context, page } = await isolatedPage(progress);
  try {
    await startCardsSession(page);
    const result = await page.evaluate(() => ({
      queue: session.queue.map(item => item.w),
      expected: buildQueue().map(item => item.w),
      learning: learningCount(),
      due: dueCount()
    }));
    assert.equal(result.learning, 200); assert.equal(result.due, 200);
    assert.deepEqual(result.queue, result.expected, 'cards mode uses the shared pool-cycle queue');
    assert.equal(result.queue.length, 20);
    assert.ok(result.queue.every(w => progress[w].s < 2), 'no learned word enters the cards queue');
    // A known swipe moves the word to the back of the cycle.
    const first = result.queue[0];
    await page.locator('#knowBtn').click();
    await page.waitForFunction(() => session.index === 1);
    const order = await page.evaluate(() => vocab.filter(v => isLearning(progress[v.w]))
      .sort((a, b) => ((progress[a.w].last || 0) - (progress[b.w].last || 0)) || a.r - b.r)
      .map(v => v.w));
    assert.equal(order[order.length - 1], first, 'known card moves to the back of the cycle');
  } finally { await context.close(); }
  console.log('PASS cards mode shares the 200-pool FIFO cycle, learned words never queued');
}

async function main() {
  server.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}/vocab-app/`;
  browser = await chromium.launch();
  await cardFlowBasics();
  await gradeRightLikeCorrect();
  await gradeLeftLikeDontKnow();
  await swipeGestures();
  await poolSemanticsShared();
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}

main().catch(error => { console.error(error); process.exit(1); });
