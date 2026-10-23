// Run: node scripts/topbar-stability-browser.test.cjs
// Synthetic page state only. No Firebase, external requests or real data.
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
// Every sync string the app can show, plus longer ones, with signed-out and signed-in labels.
const syncTexts = (source => [...source.matchAll(/setSync\((?:[^'()]*\?\s*)?'([^']+)'(?:\s*:\s*'([^']+)')?\)/g)].flatMap(m => [m[1], m[2]].filter(Boolean)))(fs.readFileSync(path.join(root, 'app.js'), 'utf8'));
const labels = ['כניסה עם Google', 'מחובר', 'מחובר: מאיר כהן', 'מחובר: מאיר שרגא כהן'];

(async () => {
  assert.ok(syncTexts.length >= 6, 'found the app sync texts: ' + syncTexts.length);
  syncTexts.push('השינויים שמורים · ממשיכים לסנכרן עם השרת כשהחיבור יחזור לפעול כרגיל');
  server.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  base = 'http://127.0.0.1:' + server.address().port + '/vocab-app/';
  browser = await chromium.launch({ args: ['--no-sandbox'], ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}) });
  for (const [width, height] of [[320, 568], [375, 667], [390, 664], [390, 844], [430, 932]]) {
    const context = await browser.newContext({ viewport: { width, height }, serviceWorkers: 'block', isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      return url.origin !== new URL(base).origin || url.pathname.endsWith('/firebase-config.js') ? route.fulfill({ body: '', contentType: 'application/javascript' }) : route.continue();
    });
    try {
      const page = await context.newPage();
      await page.goto(base);
      await page.waitForFunction(() => vocab.length > 9000);
      for (const inQuiz of [false, true]) {
        await page.evaluate(inQuiz => {
          if (inQuiz) { document.getElementById('practiceHome').classList.add('hidden'); document.getElementById('quizCard').classList.remove('hidden'); }
        }, inQuiz);
        const measure = () => page.evaluate(() => {
          const rect = id => document.getElementById(id).getBoundingClientRect();
          const bar = document.querySelector('.topbar').getBoundingClientRect();
          const main = document.getElementById('main').getBoundingClientRect();
          const auth = rect('authBtn');
          return { barHeight: bar.height, mainTop: main.top, authWidth: auth.width, scrollWidth: document.documentElement.scrollWidth, innerWidth };
        });
        let reference;
        for (const label of labels) {
          for (const text of syncTexts) {
            await page.evaluate(({ label, text }) => { const b = document.getElementById('authBtn'); b.textContent = label; b.classList.toggle('signed', label.startsWith('מחובר')); setSync(text); }, { label, text });
            const m = await measure();
            const where = `${width}x${height} ${inQuiz ? 'quiz' : 'home'} "${label}" / "${text}"`;
            assert.ok(m.scrollWidth <= m.innerWidth, 'no horizontal overflow: ' + where);
            // Only the label may change the layout, never the sync text.
            reference ||= {};
            const key = label;
            reference[key] ||= m;
            assert.equal(m.barHeight, reference[key].barHeight, 'topbar height stays: ' + where);
            assert.equal(m.mainTop, reference[key].mainTop, 'content does not move: ' + where);
          }
        }
        // And the header is the same single row for every label.
        const heights = new Set();
        for (const label of labels) {
          await page.evaluate(label => { document.getElementById('authBtn').textContent = label; setSync('מסונכרן ✓'); }, label);
          heights.add((await measure()).barHeight);
        }
        assert.equal(heights.size, 1, `topbar height equal across labels at ${width}x${height}: ${[...heights]}`);
      }
    } finally { await context.close(); }
  }
  console.log('topbar stability: ok, ' + syncTexts.length + ' sync texts x ' + labels.length + ' labels');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (browser) await browser.close();
  await new Promise(resolve => server.close(resolve));
});
