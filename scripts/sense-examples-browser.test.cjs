// Run with: node scripts/sense-examples-browser.test.cjs
// Also save isolated rendered screenshots with: --screenshots <directory>
// Every context starts without account data; Firebase, external traffic and
// service workers are blocked. Production HTML/CSS/JS and vocabulary are served.
'use strict';

const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const vocabulary = JSON.parse(fs.readFileSync(path.join(root, 'vocab.json'), 'utf8'));
const sourceDetails = JSON.parse(fs.readFileSync(path.join(root, 'details.json'), 'utf8'));
const reviewedWords = ['for', 'it', 'as', 'right', 'arms', 'minutes', 'safe', 'principal', 'refuse', 'royalty', 'foundation', 'Harry', 'etc.', 'stout', 'customs', 'smart', 'helping', 'bonds', 'abstract', 'flush', 'lighter', 'trunks', 'ruling', 'duck', 'piles', 'quotation', 'manifold'];
const BAD_EXAMPLE = 'UNREVIEWED EXAMPLE MUST NEVER APPEAR.';
const screenshotArgument = process.argv.indexOf('--screenshots');
const screenshotDirectory = screenshotArgument < 0 ? null : path.resolve(process.argv[screenshotArgument + 1] || 'sense-screenshots');
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

async function newPage({ details = 'loaded', viewport = { width: 390, height: 844 }, corruptExamples = true } = {}) {
  const context = await browser.newContext({
    viewport, serviceWorkers: 'block', deviceScaleFactor: 1,
    isMobile: viewport.width === 390, hasTouch: viewport.width === 390
  });
  const fixtures = structuredClone(sourceDetails);
  if (corruptExamples) {
    for (const item of vocabulary) {
      fixtures[item.r] = { ...(fixtures[item.r] || {}), e: BAD_EXAMPLE };
    }
  }
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/firebase-config.js') || url.origin !== new URL(base).origin) {
      return route.fulfill({ body: '', contentType: 'application/javascript' });
    }
    if (url.pathname.endsWith('/details.json')) {
      return details === 'loaded'
        ? route.fulfill({ body: JSON.stringify(fixtures), contentType: 'application/json' })
        : route.fulfill({ status: 503, body: 'Optional details unavailable' });
    }
    return route.continue();
  });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto(base);
  await page.waitForFunction(() => vocab.length > 9000 && typeof VocabQuiz !== 'undefined');
  if (details === 'loaded') await page.waitForFunction(() => Object.keys(wordDetails).length > 9000);
  else assert.equal(await page.evaluate(() => Object.keys(wordDetails).length), 0);
  assert.equal(await page.evaluate(() => !!fb.initialized), false, 'Firebase remains disconnected');
  return { page, context, pageErrors };
}

async function seedQuestion(page, word, mode, changedSense = false) {
  return page.evaluate(({ word, mode, changedSense }) => {
    settings.mode = mode;
    progress = {};
    stats = { days: {}, attempts: 0, correct: 0 };
    bands = { current: 1, recent: [], thousandRecent: [] };
    const source = vocab.find(item => item.w === word);
    if (!source) throw new Error('Missing fixture: ' + word);
    const item = changedSense ? { ...source, t: 'משמעות שונה לבדיקה' } : source;
    session = { queue: [item], index: 0, correct: 0, wrong: 0, active: true };
    locked = false;
    document.getElementById('practiceHome').classList.add('hidden');
    document.getElementById('summary').classList.add('hidden');
    document.getElementById('quizCard').classList.remove('hidden');
    document.getElementById('sessionLabel').textContent = 'תרגול';
    document.getElementById('quizBandLabel').textContent = bandLabel();
    showQuestion();
    window.scrollTo(0, 0);
    return {
      ...VocabQuiz.getWordContent(item, wordDetails[item.r]),
      rank: item.r,
      prompt: VocabQuiz.getPromptContext(item, mode, wordDetails[item.r])
    };
  }, { word, mode, changedSense });
}

async function assertPrompt(page, expected) {
  const context = page.locator('#questionContext');
  assert.equal(await context.innerText(), expected.prompt);
  assert.equal(await context.isVisible(), !!expected.example, 'prompt has context only for a reviewed sense');
  assert.equal((await context.innerText()).includes(BAD_EXAMPLE), false);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'prompt fits viewport');
}

async function showCorrection(page, expected) {
  await page.locator('#dontKnowBtn').click();
  await page.locator('#answerFeedback').waitFor({ state: 'visible' });
  // loadDetails can rerender the correction, so let its microtask and paint finish.
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const feedback = page.locator('#answerFeedback');
  assert.equal(await feedback.locator('.feedback-meaning').innerText(), expected.meaning);
  assert.equal(await feedback.locator('.example-text').count(), expected.example ? 1 : 0);
  if (expected.example) {
    assert.equal(await feedback.locator('.example-text[lang="en"]').innerText(), expected.example);
  }
  assert.equal(await feedback.locator('.detail-empty').count(), 0, 'omitted correction example has no placeholder');
  assert.equal((await feedback.innerText()).includes(BAD_EXAMPLE), false);
  assert.equal(await page.locator('#nextBtn').isVisible(), true, 'correction still waits for Continue');
  assert.deepEqual(await page.evaluate(() => ({ attempts: stats.attempts, wrong: session.wrong, index: session.index })),
    { attempts: 1, wrong: 1, index: 0 }, 'unknown answer scoring and continuation are unchanged');
}

async function showWordCard(page, expected) {
  await page.locator('#detailBtn').click();
  await page.waitForFunction(() => sheetOpen && !document.getElementById('detailBody').textContent.includes('טוען…'));
  assert.equal(await page.locator('#detailTranslation').innerText(), expected.meaning);
  assert.equal(await page.locator('#detailBody .example-text').count(), expected.example ? 1 : 0);
  if (expected.example) {
    assert.equal(await page.locator('#detailBody .example-text[lang="en"]').innerText(), expected.example);
  }
  assert.equal(await page.locator('#detailBody .detail-empty').count(), 0, 'omitted word-card example has no placeholder');
  assert.equal((await page.locator('#detailBody').innerText()).includes(BAD_EXAMPLE), false);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'word card fits viewport');
}

async function senseRegressions() {
  for (const details of ['loaded', 'missing']) {
    const { page, context, pageErrors } = await newPage({ details });
    try {
      const unreviewedFrequent = await page.evaluate(() => vocab.find(item => item.r <= 300 && !VocabQuiz.getWordContent(item).reviewed)?.w);
      assert.ok(unreviewedFrequent, 'high-risk frequent words without a reviewed sense stay omitted');
      const cases = [
        ...reviewedWords.map(word => ({ word, reviewed: true })),
        { word: unreviewedFrequent, reviewed: false },
        { word: 'superstitious', reviewed: false },
        { word: 'right', reviewed: false, changedSense: true }
      ];
      for (const fixture of cases) {
        for (const mode of ['choice', 'reverse', 'typing']) {
          const expected = await seedQuestion(page, fixture.word, mode, fixture.changedSense);
          assert.equal(expected.reviewed, fixture.reviewed, `${fixture.word}: reviewed sense guard`);
          assert.equal(!!expected.example, fixture.reviewed, `${fixture.word}: safe example availability`);
          if (expected.example && mode !== 'choice') {
            assert.ok(expected.prompt.includes('____'), 'reverse and typing prompts hide the learned English word');
            const escaped = fixture.word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            assert.doesNotMatch(expected.prompt, new RegExp('(?<!\\w)' + escaped + '(?!\\w)', 'i'));
          }
          await assertPrompt(page, expected);
          await showCorrection(page, expected);
          await showWordCard(page, expected);
          await page.locator('#detailClose').click();
        }
      }
      assert.deepEqual(pageErrors, [], 'no uncaught page errors');
      console.log(`PASS ${details} details: ${reviewedWords.length} reviewed senses and omitted frequent/rare/changed-sense examples across choice/reverse/typing prompts, corrections and word cards`);
    } finally {
      await context.close();
    }
  }
}

async function saveScreenshots() {
  if (!screenshotDirectory) return;
  fs.mkdirSync(screenshotDirectory, { recursive: true });
  const manifest = {
    browser: 'Chromium; the 390px viewport uses isMobile and hasTouch emulation, not actual Safari',
    isolation: 'Fresh Playwright contexts, Firebase/external traffic blocked, service workers blocked, synthetic sessions and progress only',
    pageErrors: [], screenshots: []
  };
  for (const [device, viewport] of [
    ['iphone-390', { width: 390, height: 844 }],
    ['desktop-1440', { width: 1440, height: 1000 }]
  ]) {
    const { page, context, pageErrors } = await newPage({ viewport, corruptExamples: false });
    try {
      for (const word of reviewedWords) {
        const expected = await seedQuestion(page, word, 'choice');
        assert.equal(expected.reviewed, true);
        await assertPrompt(page, expected);
        for (const surface of ['prompt', 'correction', 'word-card']) {
          if (surface === 'correction') await showCorrection(page, expected);
          if (surface === 'word-card') await showWordCard(page, expected);
          await page.evaluate(() => document.fonts.ready);
          let correctionGeometry;
          if (surface === 'correction') {
            correctionGeometry = await page.evaluate(() => {
              const feedback = document.getElementById('answerFeedback').getBoundingClientRect();
              const next = document.getElementById('nextBtn').getBoundingClientRect();
              return {
                feedbackTop: feedback.top, feedbackBottom: feedback.bottom,
                nextTop: next.top, nextBottom: next.bottom,
                navTop: document.querySelector('.tabbar').getBoundingClientRect().top
              };
            });
            assert.ok(correctionGeometry.feedbackTop >= 0 && correctionGeometry.feedbackBottom <= correctionGeometry.navTop,
              `${device} ${word}: correction fits above navigation`);
            assert.ok(correctionGeometry.nextTop >= 0 && correctionGeometry.nextBottom <= correctionGeometry.navTop,
              `${device} ${word}: Continue fits above navigation`);
          }
          const filename = `${device}-${word}-${surface}.png`;
          await page.screenshot({ path: path.join(screenshotDirectory, filename), fullPage: false, animations: 'disabled' });
          manifest.screenshots.push({ filename, device, viewport, word, surface, meaning: expected.meaning, example: expected.example, ...(correctionGeometry ? { correctionGeometry } : {}) });
        }
        await page.locator('#detailClose').click();
      }
      manifest.pageErrors.push(...pageErrors);
      assert.deepEqual(pageErrors, [], 'no uncaught screenshot page errors');
    } finally {
      await context.close();
    }
  }
  fs.writeFileSync(path.join(screenshotDirectory, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log(`PASS saved ${manifest.screenshots.length} isolated rendered screenshots to ${screenshotDirectory}`);
}

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}/vocab-app/`;
  browser = await chromium.launch({
    args: ['--no-sandbox'],
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {})
  });
  await senseRegressions();
  await saveScreenshots();
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => {
  if (browser) await browser.close();
  await new Promise(resolve => server.close(resolve));
});
