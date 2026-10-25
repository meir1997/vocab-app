// Run: node scripts/visual-layout-browser.test.cjs [--screenshots <directory>]
// Use --baseline to record the unchanged UI without the new layout assertions.
// --root <directory> can render a clean Git export with this same harness.
'use strict';

const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

function argument(name) {
  const index = process.argv.indexOf(name);
  return index < 0 ? null : process.argv[index + 1];
}
const root = path.resolve(argument('--root') || path.join(__dirname, '..'));
const screenshotDirectory = argument('--screenshots') ? path.resolve(argument('--screenshots')) : null;
const baseline = process.argv.includes('--baseline');
const viewports = [
  ['phone-320', { width: 320, height: 568 }],
  ['phone-390', { width: 390, height: 844 }],
  ['desktop-1440', { width: 1440, height: 1000 }]
];
const manifest = {
  baseline,
  browser: 'Chromium; phone sizes use mobile/touch emulation, not native iOS or Safari',
  isolation: 'Fresh contexts; Firebase, external traffic and service workers blocked; synthetic progress and sessions; production DOM, CSS, JS and vocabulary',
  deterministicChoices: 'Seeded Math.random reset before each question',
  screenshots: [], checks: [], pageErrors: []
};
const server = http.createServer((request, response) => {
  const requested = decodeURIComponent(new URL(request.url, 'http://localhost').pathname)
    .replace(/^\/vocab-app(?:\/|$)/, '/');
  const file = path.resolve(root, '.' + (requested.endsWith('/') ? requested + 'index.html' : requested));
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    response.writeHead(404).end();
    return;
  }
  const types = { '.html': 'text/html', '.js': 'application/javascript', '.json': 'application/json', '.css': 'text/css', '.svg': 'image/svg+xml' };
  response.setHeader('Content-Type', (types[path.extname(file)] || 'application/octet-stream') + '; charset=utf-8');
  response.end(fs.readFileSync(file));
});
let browser;
let base;

async function newPage(viewport) {
  const context = await browser.newContext({
    viewport, deviceScaleFactor: 1, serviceWorkers: 'block',
    isMobile: viewport.width < 500, hasTouch: viewport.width < 500,
    reducedMotion: 'reduce', locale: 'he-IL'
  });
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/firebase-config.js') || url.origin !== new URL(base).origin) {
      return route.fulfill({ body: '', contentType: 'application/javascript' });
    }
    return route.continue();
  });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto(base);
  await page.waitForFunction(() => vocab.length > 9000 && Object.keys(wordDetails).length > 9000);
  assert.equal(await page.evaluate(() => !!fb.initialized), false, 'Firebase stays disconnected');
  assert.equal(await page.evaluate(() => localStorage.getItem(K.progress)), null, 'context starts without real progress');
  if (!baseline) {
    assert.equal(await page.locator('.tabbar .tab-btn').count(), 5);
    await assertIcons(page, '.tabbar .tab-btn, #speakBtn, #detailBtn, .word-item:first-child .speak');
  }
  return { page, context, pageErrors };
}

async function assertIcons(page, selector) {
  const buttons = await page.locator(selector).evaluateAll(elements => elements.map(button => {
    const svg = button.querySelector('svg.icon');
    const use = svg?.querySelector('use');
    const reference = use?.getAttribute('href');
    const symbol = reference?.startsWith('#') ? document.getElementById(reference.slice(1)) : null;
    return {
      id: button.id || button.dataset.tab || button.className,
      label: button.getAttribute('aria-label'),
      iconCount: button.querySelectorAll('svg.icon').length,
      accessibleDecoration: svg?.getAttribute('aria-hidden') === 'true' && svg?.getAttribute('focusable') === 'false',
      consistentStroke: svg?.getAttribute('viewBox') === '0 0 24 24' && svg?.getAttribute('fill') === 'none' && svg?.getAttribute('stroke') === 'currentColor' && svg?.getAttribute('stroke-width') === '2',
      resolvedShape: symbol?.tagName.toLowerCase() === 'symbol' && !!symbol.querySelector('path, circle, rect, line, polyline, polygon'),
      directText: [...button.childNodes].filter(node => node.nodeType === Node.TEXT_NODE).map(node => node.textContent).join('').trim()
    };
  }));
  assert.ok(buttons.length, 'expected icon controls exist');
  for (const button of buttons) {
    assert.ok(button.label?.trim(), `${button.id}: icon control retains its accessible name`);
    assert.equal(button.iconCount, 1, `${button.id}: one shared SVG icon`);
    assert.equal(button.accessibleDecoration, true, `${button.id}: decorative icon stays out of the accessibility tree and focus order`);
    assert.equal(button.consistentStroke, true, `${button.id}: consistent icon geometry and stroke`);
    assert.equal(button.resolvedShape, true, `${button.id}: local sprite reference resolves to a drawn symbol`);
    assert.equal(button.directText, '', `${button.id}: icon has no fallback emoji or text glyph`);
  }
}

async function seedQuestion(page, mode, word = 'right') {
  const expected = await page.evaluate(({ mode, word }) => {
    let seed = 41027;
    Math.random = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    settings.mode = mode;
    progress = {};
    stats = { days: {}, attempts: 0, correct: 0 };
    bands = { current: 1, recent: [], thousandRecent: [] };
    const item = vocab.find(entry => entry.w === word);
    if (!item) throw new Error('Missing real vocabulary fixture: ' + word);
    session = { queue: [item, vocab.find(entry => entry.w === 'run')], index: 0, correct: 0, wrong: 0, active: true };
    locked = false;
    document.getElementById('practiceHome').classList.add('hidden');
    document.getElementById('summary').classList.add('hidden');
    document.getElementById('quizCard').classList.remove('hidden');
    document.getElementById('sessionLabel').textContent = '20 מילים';
    document.getElementById('quizBandLabel').textContent = bandLabel();
    showQuestion();
    window.scrollTo(0, 0);
    return { ...VocabQuiz.getWordContent(item, wordDetails[item.r]), word, rank: item.r };
  }, { mode, word });
  await settle(page);
  return expected;
}

async function settle(page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
}

async function geometry(page, meaning) {
  return page.evaluate(meaning => {
    const visible = element => {
      if (!element) return false;
      const box = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return box.width > 0 && box.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    };
    const box = selector => {
      const element = document.querySelector(selector);
      if (!visible(element)) return null;
      const rect = element.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, top: rect.top, right: rect.right, bottom: rect.bottom, left: rect.left };
    };
    const candidates = [...document.querySelectorAll('#quizCard .answer, #quizCard .word, #quizCard .feedback-meaning')];
    const occurrences = candidates.filter(element => visible(element) && element.textContent.trim() === meaning);
    const sheet = document.querySelector('.sheet');
    return {
      viewport: { width: innerWidth, height: innerHeight }, scrollX, scrollY,
      documentWidth: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
      shell: box('.shell'), quiz: box('#quizCard'), nav: box('.tabbar'),
      answers: [...document.querySelectorAll('.answer')].filter(visible).map(element => {
        const rect = element.getBoundingClientRect();
        return { text: element.textContent, top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right };
      }),
      dontKnow: box('#dontKnowBtn'), feedback: box('#answerFeedback'), next: box('#nextBtn'),
      sheet: box('.sheet'), sheetContentWidth: sheet?.scrollWidth, sheetClientWidth: sheet?.clientWidth,
      meaningOccurrences: occurrences.map(element => ({ tag: element.tagName, id: element.id, className: element.className })),
      credit: box('.detail-credit')
    };
  }, meaning);
}

function assertLayout(layout, surface, label) {
  if (baseline) return;
  assert.ok(layout.documentWidth <= layout.viewport.width, `${label}: zero document horizontal overflow`);
  assert.equal(layout.scrollX, 0, `${label}: no horizontal scrolling`);
  if (surface === 'word-card') {
    assert.ok(layout.sheet.left >= 0 && layout.sheet.right <= layout.viewport.width + 1, `${label}: card fits horizontally`);
    assert.ok(layout.sheetContentWidth <= layout.sheetClientWidth, `${label}: zero horizontal overflow inside card`);
    return;
  }
  if (layout.viewport.width === 1440) {
    assert.ok(layout.shell.width >= 900, `${label}: desktop shell uses the available width`);
    assert.ok(layout.quiz.width >= 900, `${label}: desktop quiz uses the available width`);
  }
  if (surface === 'prompt' && layout.viewport.width === 320) {
    assert.equal(layout.scrollY, 0, `${label}: prompt does not scroll`);
    for (const answer of layout.answers) assert.ok(answer.top >= 0 && answer.bottom <= layout.nav.top, `${label}: every option fits above navigation`);
    assert.ok(layout.dontKnow.top >= 0 && layout.dontKnow.bottom <= layout.nav.top, `${label}: I do not know fits above navigation`);
  }
  if (surface.endsWith('correction')) {
    assert.equal(layout.meaningOccurrences.length, 1, `${label}: correct Hebrew answer is visible exactly once`);
    assert.equal(layout.scrollY, 0, `${label}: correction requires no page scrolling`);
    assert.ok(layout.feedback.top >= 0 && layout.feedback.bottom <= layout.nav.top, `${label}: feedback fits above navigation`);
    assert.ok(layout.next.top >= 0 && layout.next.bottom <= layout.nav.top, `${label}: Continue fits above navigation`);
  }
}

async function record(page, { device, viewport, mode, expected, surface, screenshot = false }) {
  await settle(page);
  // Baseline intentionally shows the unchanged page at its initial scroll position.
  if (baseline) await page.evaluate(() => window.scrollTo(0, 0));
  const layout = await geometry(page, expected.meaning);
  const label = `${device} ${mode} ${expected.word} ${surface}`;
  assertLayout(layout, surface, label);
  const entry = { device, viewport, mode, word: expected.word, rank: expected.rank, surface, meaning: expected.meaning, example: expected.example || null, geometry: layout };
  manifest.checks.push(entry);
  if (screenshot && screenshotDirectory) {
    const filename = `${device}-${mode}-${expected.word}-${surface}.png`;
    await page.screenshot({ path: path.join(screenshotDirectory, filename), fullPage: false, animations: 'disabled' });
    manifest.screenshots.push({ filename, ...entry });
  }
}

async function correctWrongOrUnknown(page, mode, expected, unknown) {
  if (unknown) await page.locator('#dontKnowBtn').click();
  else if (mode === 'typing') {
    await page.locator('#typingInput').fill('definitely incorrect');
    await page.locator('#typingCheck').click();
  } else await page.locator('.answer[data-correct="false"]').first().click();
  await page.locator('#answerFeedback').waitFor({ state: 'visible' });
  assert.equal(await page.locator('.feedback-meaning').innerText(), expected.meaning);
  assert.equal(await page.locator('#answerFeedback .example-text').count(), expected.example ? 1 : 0, 'reviewed-example policy is unchanged in correction');
  if (expected.example) assert.equal(await page.locator('#answerFeedback .example-text').innerText(), expected.example);
  assert.equal(await page.locator('#answerFeedback .detail-empty').count(), 0);
  assert.equal(await page.locator('#nextBtn').isVisible(), true, 'wrong answer has explicit Continue');
  await page.evaluate(() => {
    document.getElementById('dontKnowBtn').click();
    document.getElementById('typingCheck').click();
  });
  assert.deepEqual(await page.evaluate(() => {
    const item = session.queue[session.index];
    return { attempts: stats.attempts, wrong: session.wrong, index: session.index, wordAttempts: progress[item.w].r + progress[item.w].w };
  }), { attempts: 1, wrong: 1, index: 0, wordAttempts: 1 }, 'answer is scored once and waits for Continue');
}

async function openCard(page, expected) {
  await page.locator('#detailBtn').click();
  await page.waitForFunction(() => sheetOpen && !document.getElementById('detailBody').textContent.includes('טוען…'));
  assert.equal(await page.locator('#detailTranslation').innerText(), expected.meaning);
  assert.equal(await page.locator('#detailBody .example-text').count(), expected.example ? 1 : 0, 'reviewed-example policy is unchanged in card');
  if (expected.example) assert.equal(await page.locator('#detailBody .example-text').innerText(), expected.example);
  assert.equal(await page.locator('#detailBody .detail-empty').count(), 0);
  assert.ok((await page.locator('.detail-credit').innerText()).includes('Princeton WordNet'), 'credits remain available');
  if (!baseline) await assertIcons(page, '#detailSheet button');
}

async function runMatrix() {
  for (const [device, viewport] of viewports) {
    for (const mode of ['choice', 'reverse', 'typing']) {
      const { page, context, pageErrors } = await newPage(viewport);
      try {
        for (const unknown of [true, false]) {
          const expected = await seedQuestion(page, mode);
          assert.equal(expected.reviewed, true);
          if (mode !== 'typing') assert.equal(await page.locator('.answer').count(), 4, 'four options remain available');
          assert.equal(await page.locator('#questionContext .example-text').count(), 0);
          await record(page, { device, viewport, mode, expected, surface: 'prompt', screenshot: mode === 'choice' && unknown });
          await correctWrongOrUnknown(page, mode, expected, unknown);
          await record(page, { device, viewport, mode, expected, surface: unknown ? 'unknown-correction' : 'wrong-correction', screenshot: mode === 'choice' });
          await page.waitForTimeout(1000);
          assert.equal(await page.evaluate(() => session.index), 0, 'correction never auto-advances');
          if (mode === 'choice' && unknown) {
            await openCard(page, expected);
            await record(page, { device, viewport, mode, expected, surface: 'word-card', screenshot: true });
            await page.locator('#detailClose').click();
          }
          await page.locator('#nextBtn').click();
          assert.equal(await page.evaluate(() => session.index), 1, 'Continue advances once');
          assert.equal(await page.locator('#answerFeedback').isVisible(), false, 'next question clears correction');
        }
        if (mode === 'choice') {
          const expected = await seedQuestion(page, mode, "mother+'s");
          assert.equal(expected.reviewed, false, 'long-word fixture has no reviewed example');
          await record(page, { device, viewport, mode, expected, surface: 'prompt', screenshot: true });
          await correctWrongOrUnknown(page, mode, expected, true);
          await record(page, { device, viewport, mode, expected, surface: 'unknown-correction', screenshot: true });
          await openCard(page, expected);
          await record(page, { device, viewport, mode, expected, surface: 'word-card', screenshot: true });
          await page.locator('#detailClose').click();
        }
        assert.deepEqual(pageErrors, [], 'no uncaught production page errors');
        manifest.pageErrors.push(...pageErrors);
      } finally { await context.close(); }
    }
    console.log(`PASS ${device}: prompt, unknown/wrong correction in all modes, reviewed/omitted examples, card, single scoring and explicit Continue${baseline ? ' (baseline recording)' : ', responsive geometry and zero horizontal overflow'}`);
  }
}

(async () => {
  if (screenshotDirectory) fs.mkdirSync(screenshotDirectory, { recursive: true });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}/vocab-app/`;
  browser = await chromium.launch({
    args: ['--no-sandbox'],
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {})
  });
  await runMatrix();
  console.log(`PASS ${manifest.checks.length} isolated surface checks${screenshotDirectory ? `; saved ${manifest.screenshots.length} screenshots to ${screenshotDirectory}` : ''}`);
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => {
  if (screenshotDirectory) fs.writeFileSync(path.join(screenshotDirectory, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  if (browser) await browser.close();
  await new Promise(resolve => server.close(resolve));
});
