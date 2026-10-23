// Run: node scripts/viewport-stability-browser.test.cjs
// Fresh synthetic sessions only. No Firebase, external requests or real data.
'use strict';
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
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

async function stability(page, viewport) {
  const words = await page.evaluate(() => {
    const entries = vocab.map(item => ({ w: item.w, ...VocabQuiz.getWordContent(item, wordDetails[item.r]) }));
    const longest = key => [...entries].sort((a,b) => (b[key] || '').length - (a[key] || '').length).map(x => x.w);
    return [...new Set(['right', 'run', 'incomprehensible', ...longest('meaning').slice(0,8), ...longest('example').slice(0,8), ...longest('w')])].slice(0,20);
  });
  assert.equal(words.length, 20, 'twenty distinct production words');
  const geometry = () => page.evaluate(() => {
    const card = document.getElementById('quizCard').getBoundingClientRect();
    return { scrollHeight: document.documentElement.scrollHeight, cardHeight: card.height, cardTop: card.top, scrollY };
  });
  let reference;
  for (const mode of ['choice', 'typing']) {
    for (const action of ['correct', 'wrong', 'unknown']) {
      await seed(page, mode, [...words, words[0]]);
      const before = await geometry();
      assert.equal(before.scrollHeight, viewport.height, 'quiz fits viewport without document overflow');
      reference ||= before;
      assert.deepEqual(before, reference, 'mode changes retain card geometry');
      // Record every animation frame, including focus and the real auto-advance.
      await page.evaluate(() => {
        window.stabilityFrames = [];
        window.stabilitySampling = true;
        const sample = () => {
          const c = document.getElementById('quizCard').getBoundingClientRect();
          window.stabilityFrames.push({ scrollHeight: document.documentElement.scrollHeight, cardHeight: c.height, cardTop: c.top, scrollY });
          if (window.stabilitySampling) requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
      });
      for (let i=0; i<20; i++) {
        assert.deepEqual(await geometry(), reference, mode + ' prompt ' + words[i]);
        await page.evaluate(({mode,action}) => {
          if (action === 'unknown') document.getElementById('dontKnowBtn').click();
          else if (mode === 'typing') {
            document.getElementById('typingInput').value = action === 'correct' ? session.queue[session.index].w : 'zzzz definitely incorrect';
            document.getElementById('typingCheck').click();
          } else document.querySelector('.answer[data-correct="' + (action === 'correct') + '"]').click();
        }, {mode,action});
        await settle(page);
        assert.deepEqual(await geometry(), reference, mode + ' ' + action + ' ' + words[i]);
        if (action === 'correct') await page.waitForFunction(i => session.index === i+1, i);
        else {
          const layout = await page.evaluate(() => {
            const box = document.getElementById('answerFeedback').getBoundingClientRect();
            const example = document.querySelector('#answerFeedback .example-text');
            return { bottom: example?.getBoundingClientRect().bottom || box.top, limit: box.bottom };
          });
          assert.ok(layout.bottom <= layout.limit, 'example stays inside fixed correction slot');
          await page.evaluate(() => renderAnswerFeedback(session.queue[session.index]));
          await settle(page);
          assert.deepEqual(await geometry(), reference, 'late details');
          await page.locator('#nextBtn').click();
        }
        await settle(page);
        assert.deepEqual(await geometry(), reference, 'next question');
      }
      const frames = await page.evaluate(() => { window.stabilitySampling = false; return window.stabilityFrames; });
      for (const frame of frames) assert.deepEqual(frame, reference, 'every rendered frame');
    }
  }
  if (viewport.width === 390) {
    for (const height of [553, 664, 750, 844]) {
      await page.setViewportSize({ width: 390, height });
      await settle(page);
      const changed = await geometry();
      assert.equal(changed.cardHeight, reference.cardHeight, 'toolbar-height changes preserve card height');
      assert.equal(changed.cardTop, reference.cardTop, 'toolbar-height changes preserve card top');
      assert.equal(changed.scrollY, reference.scrollY, 'toolbar-height changes preserve scrollY');
      assert.equal(changed.scrollHeight, height, 'document tracks viewport min-height');
    }
  }
  console.log('PASS ' + viewport.width + 'x' + viewport.height + ': 20 longest-content words, choice/typing, correct/wrong/unknown, every frame: ' + JSON.stringify(reference));
}
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = 'http://127.0.0.1:' + server.address().port + '/vocab-app/';
  browser = await chromium.launch({ args: ['--no-sandbox'], ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}) });
  await Promise.all([[320,568],[375,553],[390,664],[390,750],[390,844],[1440,900]].map(async ([width,height]) => {
    const viewport = {width,height};
    const context = await browser.newContext({viewport, serviceWorkers:'block', isMobile:width<500, hasTouch:width<500, reducedMotion:'reduce'});
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      return url.origin !== new URL(base).origin || url.pathname.endsWith('/firebase-config.js') ? route.fulfill({body:'',contentType:'application/javascript'}) : route.continue();
    });
    try {
      const page = await context.newPage();
      await page.goto(base);
      await page.waitForFunction(() => vocab.length>9000 && Object.keys(wordDetails).length>9000);
      await stability(page, viewport);
    } finally { await context.close(); }
  }));
})().catch(error => { console.error(error); process.exitCode=1; }).finally(async () => {
  if(browser) await browser.close();
  await new Promise(resolve => server.close(resolve));
});
