// Run: node scripts/feedback-layout-browser.test.cjs [--screenshots <directory>]
// Fresh synthetic sessions only. No Firebase, external requests or real data.
'use strict';
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const argument = name => { const i = process.argv.indexOf(name); return i < 0 ? null : process.argv[i + 1]; };
const screenshotDirectory = argument('--screenshots');
const manifest = { isolation: 'Fresh contexts, synthetic sessions, Firebase and service workers blocked', units: 'CSS px; exact x/y/width/height comparison, no tolerance', checks: [] };
const server = http.createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname).replace(/^\/vocab-app(?:\/|$)/, '/');
  const file = path.resolve(root, '.' + (pathname.endsWith('/') ? pathname + 'index.html' : pathname));
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return response.writeHead(404).end();
  const types = { '.html': 'text/html', '.js': 'application/javascript', '.json': 'application/json', '.css': 'text/css', '.svg': 'image/svg+xml' };
  response.setHeader('Content-Type', (types[path.extname(file)] || 'application/octet-stream') + '; charset=utf-8');
  response.end(fs.readFileSync(file));
});
let browser, base;

async function settle(page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
}
async function geometry(page) {
  return page.evaluate(() => {
    const box = element => {
      const r = element.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    };
    const rect = selector => box(document.querySelector(selector));
    const hint = document.getElementById('hint');
    return {
      index: session.index, hint: hint.textContent, wordText: document.getElementById('word').textContent,
      context: document.getElementById('questionContext').textContent,
      word: rect('#word'), answers: [...document.querySelectorAll('.answer')].map(box),
      typing: settings.mode === 'typing' ? rect('#typingBox') : null,
      feedback: rect('#hint'), action: rect('#dontKnowBtn'), nav: rect('.tabbar'),
      head: rect('.quiz-head'), card: rect('#quizCard'), scrollY,
      overflow: document.documentElement.scrollWidth > innerWidth
    };
  });
}
function assertStable(reference, actual, label) {
  for (const key of ['word', 'answers', 'typing']) assert.deepEqual(actual[key], reference[key], `${label}: ${key} delta must be exactly 0px`);
  assert.equal(actual.overflow, false, `${label}: no horizontal overflow`);
  assert.equal(actual.scrollY, reference.scrollY, `${label}: no scroll jump`);
  assert.ok(actual.card.y + actual.card.height <= actual.nav.y, `${label}: complete quiz card stays above navigation`);
  assert.ok(actual.feedback.y + actual.feedback.height <= actual.nav.y, `${label}: feedback stays above navigation (${JSON.stringify(actual)})`);
}
async function screenshot(page, name) {
  if (screenshotDirectory) await page.screenshot({ path: path.join(screenshotDirectory, name + '.png'), fullPage: false, animations: 'disabled' });
}
async function seed(page, mode, words = ['right', 'incomprehensible', 'run']) {
  await page.evaluate(({ mode, words }) => {
    let random = 312413;
    Math.random = () => { random = (Math.imul(random, 1664525) + 1013904223) >>> 0; return random / 4294967296; };
    settings.mode = mode;
    progress = {};
    stats = { days: {}, attempts: 0, correct: 0 };
    bands = { current: 1, recent: [], thousandRecent: [] };
    session = { queue: words.map(word => vocab.find(v => v.w === word)), index: 0, correct: 0, wrong: 0, active: true };
    locked = false;
    document.getElementById('practiceHome').classList.add('hidden');
    document.getElementById('summary').classList.add('hidden');
    document.getElementById('quizCard').classList.remove('hidden');
    document.getElementById('quizBandLabel').textContent = bandLabel();
    showQuestion();
    window.scrollTo(0, 0);
  }, { mode, words });
  await settle(page);
}
async function correct(page, mode) {
  await page.evaluate(mode => {
    if (mode === 'typing') {
      document.getElementById('typingInput').value = session.queue[session.index].w;
      checkTyping();
    } else document.querySelector('.answer[data-correct="true"]').click();
  }, mode);
}
async function feedbackMatrix(page, device, mode) {
  await seed(page, mode);
  const before = await geometry(page);
  await screenshot(page, `${device}-${mode}-before`);
  assert.ok(before.context, 'fixture starts with an example context');
  await page.evaluate(() => {
    // Observe every rendered frame through the real 900ms auto-advance.
    window.feedbackFrames = [];
    window.feedbackSampling = true;
    const sample = () => {
      const box = element => {
        const r = element.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
      };
      window.feedbackFrames.push({ index: session.index, hint: document.getElementById('hint').textContent,
        word: box(document.getElementById('word')), answers: [...document.querySelectorAll('.answer')].map(box),
        typing: settings.mode === 'typing' ? box(document.getElementById('typingBox')) : null });
      if (window.feedbackSampling) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  await correct(page, mode);
  const during = await geometry(page);
  assertStable(before, during, `${device} ${mode} feedback appears`);
  await screenshot(page, `${device}-${mode}-during`);
  await page.waitForTimeout(350);
  assertStable(before, await geometry(page), `${device} ${mode} feedback persists`);
  // Clearing just the text must preserve the permanent slot as well.
  const text = await page.locator('#hint').textContent();
  await page.evaluate(() => { document.getElementById('hint').textContent = ''; });
  const cleared = await geometry(page);
  assertStable(before, cleared, `${device} ${mode} feedback disappears`);
  await screenshot(page, `${device}-${mode}-cleared`);
  await page.evaluate(text => { document.getElementById('hint').textContent = text; }, text);
  await page.waitForFunction(() => session.index === 1);
  await settle(page);
  const next = await geometry(page);
  assert.equal(next.context, '', 'next fixture removes the context');
  assert.notEqual(next.wordText, before.wordText, 'next fixture changes word length and serial width');
  assertStable(before, next, `${device} ${mode} next question`);
  await screenshot(page, `${device}-${mode}-next`);
  const frames = await page.evaluate(() => { window.feedbackSampling = false; return window.feedbackFrames; });
  assert.ok(frames.some(frame => frame.index === 0 && frame.hint), 'real feedback frames observed');
  assert.ok(frames.some(frame => frame.index === 1 && !frame.hint), 'next-question frames observed');
  for (const [i, frame] of frames.entries()) {
    for (const key of ['word', 'answers', 'typing']) assert.deepEqual(frame[key], before[key], `${device} ${mode} frame ${i}, ${key}: exactly 0px delta`);
  }
  assert.deepEqual(await page.evaluate(() => ({ attempts: stats.attempts, correct: stats.correct, sessionCorrect: session.correct, wrong: session.wrong, record: progress.right })),
    { attempts: 1, correct: 1, sessionCorrect: 1, wrong: 0, record: { r: 1, w: 0, s: 1, next: await page.evaluate(() => progress.right.next) } }, 'feedback presentation scores the answer once and preserves SRS history');
  manifest.checks.push({ device, mode, before, during, cleared, next, frames, maximumDelta: 0 });
}
async function reviewBadges(page, device) {
  await seed(page, 'choice', ['right', 'run']);
  const result = await page.evaluate(() => {
    const item = session.queue[0];
    const ownBand = Math.ceil(item.r / BAND_SIZE);
    bands.current = ownBand;
    showQuestion();
    const currentHidden = document.getElementById('reviewBadge').getAttribute('aria-hidden') === 'true';
    const baselineProgress = JSON.stringify(progress);
    bands.current = ownBand + 1;
    document.getElementById('quizBandLabel').textContent = bandLabel();
    showQuestion();
    return { currentHidden, text: document.getElementById('reviewBadge').textContent,
      expected: `חזרה · רמה ${ownBand}`, readOnly: baselineProgress === JSON.stringify(progress) };
  });
  assert.equal(result.currentHidden, true, 'current-band words have no review badge');
  assert.equal(result.text, result.expected, 'outside-band quiz badge names the word band');
  assert.equal(result.readOnly, true, 'rendering the badge does not write progress');
  await screenshot(page, `${device}-review-badge-quiz`);
  await page.evaluate(() => document.querySelector('.answer[data-correct="false"]').click());
  await settle(page);
  assert.equal(await page.locator('#reviewBadge').textContent(), result.expected, 'outside-band correction retains its review badge');
  assert.equal(await page.locator('#nextBtn').isVisible(), true, 'correction retains explicit Continue');
  await screenshot(page, `${device}-review-badge-correction`);
  const correction = await page.evaluate(() => {
    const feedback = document.getElementById('answerFeedback').getBoundingClientRect();
    const next = document.getElementById('nextBtn').getBoundingClientRect();
    return { feedbackBottom: feedback.bottom, nextBottom: next.bottom, navTop: document.querySelector('.tabbar').getBoundingClientRect().top };
  });
  assert.ok(correction.feedbackBottom <= correction.navTop && correction.nextBottom <= correction.navTop, 'correction and Continue stay above nav');
  // Async details completion rerenders the same correction without changing counts.
  await page.evaluate(async () => { await loadDetails(); renderAnswerFeedback(session.queue[session.index]); });
  assert.equal(await page.locator('#reviewBadge').textContent(), result.expected);
  assert.deepEqual(await page.evaluate(() => ({ attempts: stats.attempts, wrong: session.wrong, right: session.correct, record: progress.right })),
    { attempts: 1, wrong: 1, right: 0, record: { r: 0, w: 1, s: 0, next: await page.evaluate(() => progress.right.next) } }, 'badge and correction rerender never rescore');
  // A band transition during scoring must use the new band in the correction.
  const updated = await page.evaluate(() => {
    bands.current = Math.ceil(session.queue[session.index].r / BAND_SIZE);
    renderAnswerFeedback(session.queue[session.index]);
    return document.getElementById('reviewBadge').getAttribute('aria-hidden');
  });
  assert.equal(updated, 'true', 'correction derives badge from the latest current band');
  manifest.checks.push({ device, surface: 'review-badge', ...result, correction });
}
(async () => {
  if (screenshotDirectory) fs.mkdirSync(screenshotDirectory, { recursive: true });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}/vocab-app/`;
  browser = await chromium.launch({ args: ['--no-sandbox'], ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}) });
  for (const [device, viewport] of [['phone-320', { width: 320, height: 568 }], ['phone-390', { width: 390, height: 844 }], ['desktop-1440', { width: 1440, height: 1000 }]]) {
    const context = await browser.newContext({ viewport, serviceWorkers: 'block', isMobile: viewport.width < 500, hasTouch: viewport.width < 500, reducedMotion: 'reduce', locale: 'he-IL' });
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin !== new URL(base).origin || url.pathname.endsWith('/firebase-config.js')) return route.fulfill({ body: '', contentType: 'application/javascript' });
      return route.continue();
    });
    try {
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(base);
      await page.waitForFunction(() => vocab.length > 9000 && Object.keys(wordDetails).length > 9000);
      assert.equal(await page.evaluate(() => !!fb.initialized), false);
      assert.equal(await page.evaluate(() => localStorage.getItem(K.progress)), null);
      for (const mode of ['choice', 'reverse', 'typing']) await feedbackMatrix(page, device, mode);
      await reviewBadges(page, device);
      assert.deepEqual(errors, []);
      console.log(`PASS ${device}: exact 0px word/options delta before, during, cleared, next and every animation frame in all modes; review quiz/correction badges; single scoring`);
    } finally { await context.close(); }
  }
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (screenshotDirectory) fs.writeFileSync(path.join(screenshotDirectory, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  if (browser) await browser.close();
  await new Promise(resolve => server.close(resolve));
});

require("./viewport-stability-browser.test.cjs");
