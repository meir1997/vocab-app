// Run with: node scripts/quiz-ux-browser.test.cjs
// This exercises the production DOM. Offline transport and account sync have
// separate browser suites; this suite blocks them to keep UX checks isolated.
'use strict';

const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

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

async function newPage(viewport = { width: 390, height: 844 }, { stallDetails = false } = {}) {
  const context = await browser.newContext({ viewport, serviceWorkers: 'block' });
  const stalledRoutes = [];
  await context.route('**/firebase-config.js', route => route.fulfill({ body: '', contentType: 'application/javascript' }));
  await context.route('https://www.gstatic.com/**', route => route.fulfill({ body: '', contentType: 'application/javascript' }));
  if (stallDetails) await context.route('**/details.json', route => { stalledRoutes.push(route); });
  const page = await context.newPage();
  await page.goto(base);
  await page.waitForFunction(() => vocab.length > 9000 && typeof VocabQuiz !== 'undefined');
  return { page, context, stalledRoutes };
}

async function stalledDetailsDoNotBlockPractice() {
  const { page, context, stalledRoutes } = await newPage(undefined, { stallDetails: true });
  try {
    assert.equal(await page.evaluate(() => readJSON(K.vocab, []).length > 9000), true, 'vocabulary is cached before reopening');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => vocab.length > 9000);
    assert.equal(await page.evaluate(() => Object.keys(wordDetails).length), 0, 'detail responses are still stalled');
    const startedAt = Date.now();
    await page.locator('#startBtn').click();
    await page.locator('#quizCard').waitFor({ state: 'visible', timeout: 3000 });
    assert.ok(Date.now() - startedAt < 3000, 'cached practice starts within three seconds despite a hung detail request');
    assert.equal(await page.locator('.answer').count(), 4, 'fallback still renders four safe choices');
  } finally {
    await Promise.all(stalledRoutes.map(route => route.abort().catch(() => {})));
    await context.close();
  }
  console.log('PASS cached practice starts with a stalled details request');
}

async function seedQuestion(page, mode, words = ['right', 'run', 'light']) {
  await page.evaluate(({ mode, words }) => {
    settings.mode = mode;
    progress = {};
    stats = { days: {}, attempts: 0, correct: 0 };
    bands = { current: 1, recent: [], thousandRecent: [] };
    session = { queue: words.map(word => vocab.find(item => item.w === word)), index: 0, correct: 0, wrong: 0, active: true };
    locked = false;
    document.getElementById('practiceHome').classList.add('hidden');
    document.getElementById('summary').classList.add('hidden');
    document.getElementById('quizCard').classList.remove('hidden');
    showQuestion();
  }, { mode, words });
}

async function chooseAnswer(page, correct) {
  await page.evaluate(correct => {
    const button = [...document.querySelectorAll('.answer')]
      .find(button => button.dataset.correct === String(correct));
    if (!button) throw new Error('Expected answer option was not rendered');
    button.click();
  }, correct);
}

async function assertCorrection(page) {
  const feedback = page.locator('#answerFeedback');
  await feedback.waitFor({ state: 'visible' });
  assert.match(await feedback.innerText(), /[\u05d0-\u05ea]/, 'correction includes Hebrew');
  const meaning = await page.evaluate(() => VocabQuiz.getWordContent(session.queue[session.index], null).meaning);
  assert.ok((await feedback.innerText()).includes(meaning), 'correction includes the intended Hebrew translation');
  const visibleMeaningCount = await page.locator('#quizCard').evaluate((card, meaning) =>
    [...card.querySelectorAll('*')].filter(element =>
      element.children.length === 0 && element.checkVisibility() && element.textContent.trim() === meaning
    ).length, meaning);
  assert.equal(visibleMeaningCount, 1, 'correction shows the Hebrew answer exactly once in every mode');
  const example = feedback.locator('.example-text[lang="en"]');
  assert.ok(await example.count(), 'correction has an English example with its language marked');
  assert.match(await example.first().innerText(), /[A-Za-z].*[.!?]/, 'correction contains a sentence');
  assert.equal(await page.locator('#nextBtn').isVisible(), true, 'wrong answer waits for explicit continuation');
  await page.waitForTimeout(1950);
  assert.equal(await page.evaluate(() => session.index), 0, 'correction remains visible past the old advance timer');
  const reviewLayout = await page.evaluate(() => {
    const feedback = document.getElementById('answerFeedback').getBoundingClientRect();
    const next = document.getElementById('nextBtn').getBoundingClientRect();
    const navTop = document.querySelector('.tabbar').getBoundingClientRect().top;
    return { feedbackTop: feedback.top, feedbackBottom: feedback.bottom, nextTop: next.top, nextBottom: next.bottom, navTop };
  });
  assert.ok(reviewLayout.feedbackTop >= 0 && reviewLayout.feedbackBottom <= reviewLayout.navTop + 1,
    'mobile correction fits above the fixed navigation');
  assert.ok(reviewLayout.nextTop >= 0 && reviewLayout.nextBottom <= reviewLayout.navTop + 1,
    'mobile Continue button fits above the fixed navigation');
  await page.evaluate(() => {
    document.getElementById('dontKnowBtn').click();
    document.getElementById('typingCheck').click();
  });
  assert.deepEqual(await page.evaluate(() => ({ attempts: stats.attempts, wrong: session.wrong, wordAttempts: progress.right.r + progress.right.w })),
    { attempts: 1, wrong: 1, wordAttempts: 1 }, 'duplicate actions do not record a second answer');
  await page.locator('#nextBtn').click();
  assert.equal(await page.evaluate(() => session.index), 1);
  assert.equal(await feedback.isVisible(), false, 'next question clears correction');
}

async function feedbackAndContinuation() {
  for (const mode of ['choice', 'reverse', 'typing']) {
    for (const unknown of [false, true]) {
      const { page, context } = await newPage();
      try {
        await seedQuestion(page, mode);
        if (unknown) await page.locator('#dontKnowBtn').click();
        else if (mode === 'typing') {
          await page.locator('#typingInput').fill('definitely incorrect');
          await page.locator('#typingCheck').click();
        } else await chooseAnswer(page, false);
        await assertCorrection(page);

        if (mode === 'typing') {
          await page.locator('#typingInput').fill('run');
          await page.locator('#typingCheck').click();
        } else await chooseAnswer(page, true);
        await page.waitForFunction(() => session.index === 2, null, { timeout: 3000 });
        assert.deepEqual(await page.evaluate(() => ({ attempts: stats.attempts, correct: session.correct })),
          { attempts: 2, correct: 1 }, 'correct answer still records once and advances automatically');
      } finally { await context.close(); }
    }
  }
  console.log('PASS wrong answers and unknown answers in all three modes, durable correction, single recording, correct-answer advance');
}

async function unambiguousChoicesAndContext() {
  const { page, context } = await newPage();
  try {
    const result = await page.evaluate(() => {
      const entries = [
        { r: 1, w: 'dog', t: 'כלב' },
        { r: 2, w: 'hound', t: 'כֶּלֶב' },
        { r: 3, w: 'canine', t: 'כלב' },
        { r: 4, w: 'cat', t: 'חתול' },
        { r: 5, w: 'table', t: 'שולחן' },
        { r: 6, w: 'chair', t: 'כיסא' },
        { r: 7, w: 'feline', t: 'חָתוּל' }
      ];
      const details = { 1: { s: ['hound', 'canine'] } };
      const forward = VocabQuiz.buildChoices(entries[0], entries, 'choice', details, () => 0.5);
      const reverse = VocabQuiz.buildChoices(entries[0], entries, 'reverse', details, () => 0.5);
      const item = vocab.find(item => item.w === 'right');
      return { forward, reverse, context: VocabQuiz.getPromptContext(item, 'choice', null), content: VocabQuiz.getWordContent(item, null) };
    });
    assert.equal(result.forward.length, 4);
    assert.equal(result.reverse.length, 4);
    for (const options of [result.forward, result.reverse]) {
      assert.equal(options.filter(choice => choice.correct).length, 1);
      assert.equal(new Set(options.map(choice => choice.label.normalize('NFD').replace(/[\u0591-\u05c7]/g, ''))).size, 4,
        'niqqud variants cannot produce duplicate visible answers');
    }
    assert.equal(result.reverse.some(choice => ['hound', 'canine'].includes(choice.label)), false,
      'reverse choices exclude English alternatives for the same Hebrew meaning');
    assert.ok(result.context, 'multi-meaning prompt includes a sense context');
    assert.match(result.content.meaning, /[\u05d0-\u05ea]/);
    assert.match(result.content.example, /right/i);
    assert.doesNotMatch(result.content.example, /I am right/i, 'directional right uses a matching example');
    await seedQuestion(page, 'choice');
    assert.ok(await page.locator('#questionContext').innerText(), 'sense context is visible in the quiz');
  } finally { await context.close(); }
  console.log('PASS normalized duplicate and shared-meaning distractors, contextual prompts, matching example');
}

async function simpleWordCardAndLongWords() {
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }, { width: 320, height: 812 }]) {
    const { page, context } = await newPage(viewport);
    try {
      await seedQuestion(page, 'choice', ['right', 'incomprehensible']);
      await page.locator('#detailBtn').click();
      await page.locator('#detailBody .example-text').waitFor({ state: 'visible' });
      const card = await page.locator('#detailBody').evaluate(body => ({
        firstSectionHasExample: !!body.querySelector('section')?.querySelector('.example-text'),
        extras: [...body.querySelectorAll('details')].map(extra => ({ open: extra.open, summary: extra.querySelector('summary')?.textContent.trim() }))
      }));
      assert.equal(card.firstSectionHasExample, true, 'example is presented before optional reference material');
      assert.ok(card.extras.length, 'extra meanings and synonyms are available on demand');
      assert.ok(card.extras.every(extra => !extra.open && extra.summary), 'reference details start collapsed and labeled');
      await page.keyboard.press('Shift+Tab');
      await page.keyboard.press('Shift+Tab');
      assert.equal(await page.evaluate(() => !!document.activeElement.closest('#detailSheet')), true, 'modal keeps keyboard focus inside the card');
      await page.keyboard.press('1');
      assert.equal(await page.evaluate(() => stats.attempts), 0, 'quiz shortcuts do not answer behind the card');
      await page.locator('#detailBody details summary').first().click();
      assert.equal(await page.locator('#detailBody details').first().evaluate(extra => extra.open), true);
      await page.keyboard.press('Escape');
      assert.equal(await page.evaluate(() => document.activeElement.id), 'detailBtn', 'closing the card restores focus');

      await seedQuestion(page, 'choice', ["mother+'s"]);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'long quiz word causes no horizontal overflow');
      await page.locator('#detailBtn').click();
      await page.waitForFunction(() => sheetOpen && !document.getElementById('detailBody').textContent.includes('טוען…'));
      assert.equal(await page.locator('#detailBody .example-text').count(), 0, 'unreviewed long-word example is omitted');
      assert.equal(await page.locator('#detailBody .detail-empty').count(), 0, 'omitted example leaves no placeholder');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'long word card fits the viewport');
      await page.locator('#detailClose').click();
      await seedQuestion(page, 'typing', ['right']);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'typing controls fit the viewport');
    } finally { await context.close(); }
  }
  console.log('PASS main example first, collapsed reference material, card focus, desktop/390px/320px long-word containment');
}

// iPhone speaker fix (user report, 26.10): iOS WebKit drops an utterance
// spoken synchronously after cancel(), leaving every tap silent. The app must
// cancel first, speak on a short delay, and resume the queue; rapid taps
// debounce to the latest word.
async function speakerPlaysWord() {
  const { page, context } = await newPage();
  try {
    await seedQuestion(page, 'choice');
    await page.evaluate(() => {
      const calls = [];
      window.__speechCalls = calls;
      class FakeUtterance { constructor(text) { this.text = text; } }
      Object.defineProperty(window, 'SpeechSynthesisUtterance', { configurable: true, value: FakeUtterance });
      Object.defineProperty(window, 'speechSynthesis', {
        configurable: true,
        value: {
          speaking: true, pending: false,
          getVoices: () => [{ lang: 'en-US', name: 'Samantha' }],
          cancel: () => calls.push(['cancel', performance.now()]),
          speak: u => calls.push(['speak', performance.now(), u.text, u.lang, u.rate, u.voice && u.voice.name]),
          resume: () => calls.push(['resume', performance.now()]),
        },
      });
    });
    await page.locator('#speakBtn').click();
    await page.waitForTimeout(200);
    let calls = await page.evaluate(() => window.__speechCalls);
    assert.deepEqual(calls.map(c => c[0]), ['cancel', 'speak', 'resume'], 'cancel, then speak, then resume');
    assert.ok(calls[1][1] - calls[0][1] >= 50, 'speak is delayed after cancel (iOS WebKit wedging)');
    assert.equal(calls[1][2], 'right', 'the shown word is spoken');
    assert.equal(calls[1][3], 'en-US');
    assert.equal(calls[1][5], 'Samantha', 'an English voice is selected');

    // Rapid double-tap: only the latest speak survives the debounce.
    await page.locator('#speakBtn').click();
    await page.locator('#speakBtn').click();
    await page.waitForTimeout(200);
    calls = await page.evaluate(() => window.__speechCalls);
    assert.equal(calls.filter(c => c[0] === 'speak').length, 2, 'rapid taps debounce to one extra speak');
  } finally { await context.close(); }
  console.log('PASS speaker: cancel-delay-speak-resume order, word/voice, rapid-tap debounce');
}

async function preservedLearningRules() {
  const { page, context } = await newPage();
  try {
    const result = await page.evaluate(() => {
      progress = {};
      bands = { current: 1, recent: [1, 1, 1, 1, 1, 0, 0, 0, 0], thousandRecent: [] };
      recordBandAnswer(true, 1);
      const sixStays = bands.current === 1;
      bands = { current: 1, recent: [1, 1, 1, 1, 1, 1, 0, 0, 0], thousandRecent: [] };
      markWord(vocab.find(item => item.r === 1).w, true);
      const sevenAdvances = bands.current === 2 && bands.recent.length === 0;
      const noUnseenProgress = Object.keys(progress).length === 1;
      const levelBounds = bandLo(2) === 101 && bandHi(2) === 200;

      bands = { current: 5, recent: [], thousandRecent: [...Array(69).fill(1), ...Array(30).fill(0)] };
      recordBandAnswer(true, 1); // Review in the current thousand, outside this hundred.
      const thousandAdvances = bands.current === 11 && bands.recent.length === 0 && bands.thousandRecent.length === 0;
      bands = { current: 1, recent: [1], thousandRecent: [1] };
      recordBandAnswer(true, 1001);
      const otherThousandIgnored = bands.current === 1 && bands.recent.length === 1 && bands.thousandRecent.length === 1;

      settings.length = 20;
      bands = { current: 3, recent: [], thousandRecent: [] };
      progress = Object.fromEntries(vocab.slice(0, 200).map(item => [item.w, { r: 0, w: 1, s: 0, next: 0 }]));
      const fullQueue = buildQueue();
      const fullCap = learningCount() === 200 && fullQueue.length === 20 && fullQueue.every(item => !!progress[item.w]);
      const fullNoSideEffects = Object.keys(progress).length === 200;
      progress = Object.fromEntries(vocab.slice(0, 199).map(item => [item.w, { r: 0, w: 1, s: 0, next: Date.now() + DAY }]));
      const oneSlotQueue = buildQueue();
      const noReservedSlots = oneSlotQueue.length === 20 && oneSlotQueue.every(item => !progress[item.w]) && learningCount() === 199;
      return { sixStays, sevenAdvances, noUnseenProgress, levelBounds, thousandAdvances, otherThousandIgnored, fullCap, fullNoSideEffects, noReservedSlots };
    });
    assert.deepEqual(result, Object.fromEntries(Object.keys(result).map(key => [key, true])));
  } finally { await context.close(); }
  console.log('PASS 100-word levels, 7/10 threshold, 70/100 thousand skip, untouched unseen progress, 200-word learning cap');
}

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}/vocab-app/`;
  browser = await chromium.launch({
    args: ['--no-sandbox'],
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {})
  });
  await stalledDetailsDoNotBlockPractice();
  await unambiguousChoicesAndContext();
  await feedbackAndContinuation();
  await simpleWordCardAndLongWords();
  await speakerPlaysWord();
  await preservedLearningRules();
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => {
  if (browser) await browser.close();
  await new Promise(resolve => server.close(resolve));
});
