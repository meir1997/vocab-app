// Fresh synthetic sessions only. Simulates CSS env() insets through Chromium CDP.
'use strict';
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const flag = process.argv.indexOf('--screenshots');
const output = flag < 0 ? null : path.resolve(process.argv[flag + 1]);
const manifest = { browser: 'Chromium emulation, not native iOS/Safari', isolation: 'Fresh contexts; Firebase, all external traffic and service workers blocked; synthetic account display only', checks: [] };
const server = http.createServer((request, response) => {
  const requested = decodeURIComponent(new URL(request.url, 'http://localhost').pathname).replace(/^\/vocab-app(?:\/|$)/, '/');
  const file = path.resolve(root, '.' + (requested.endsWith('/') ? requested + 'index.html' : requested));
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return response.writeHead(404).end();
  const types = { '.html': 'text/html', '.js': 'application/javascript', '.json': 'application/json', '.css': 'text/css', '.svg': 'image/svg+xml' };
  response.setHeader('Content-Type', (types[path.extname(file)] || 'application/octet-stream') + '; charset=utf-8');
  response.end(fs.readFileSync(file));
});
let browser;
let base;
async function geometry(page) {
  return page.evaluate(() => {
    const box = selector => {
      const { x, y, width, height, bottom } = document.querySelector(selector).getBoundingClientRect();
      return { x, y, width, height, bottom };
    };
    return {
      paddingTop: parseFloat(getComputedStyle(document.querySelector('.shell')).paddingTop),
      brand: box('.brand'), account: box('#authBtn'), header: box('.topbar'),
      nav: box('.tabbar'), overflow: document.documentElement.scrollWidth > innerWidth,
      connected: !!fb.initialized, progress: localStorage.getItem(K.progress)
    };
  });
}
async function checkDevice(name, width, height, userAgent, mobile) {
  const context = await browser.newContext({ viewport: { width, height }, userAgent, isMobile: mobile, hasTouch: mobile, serviceWorkers: 'block', reducedMotion: 'reduce' });
  try {
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      return url.origin !== new URL(base).origin || url.pathname.endsWith('/firebase-config.js')
        ? route.fulfill({ body: '', contentType: 'application/javascript' }) : route.continue();
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const cdp = await context.newCDPSession(page);
    await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: { top: 0 } });
    await page.goto(base);
    await page.waitForFunction(() => vocab.length > 9000);
    await page.evaluate(() => {
      document.getElementById('authBtn').textContent = 'מאיר בדיקה';
      document.getElementById('authBtn').classList.add('signed');
      document.getElementById('syncStatus').textContent = 'מצב מקומי';
    });
    const normal = await geometry(page);
    assert.equal(normal.paddingTop, width <= 360 ? 8 : width >= 960 ? 28 : 14, `${name}: zero inset preserves existing padding`);
    assert.equal(normal.connected, false);
    assert.equal(normal.progress, null);
    manifest.checks.push({ name, inset: 0, geometry: normal });
    if (output) await page.screenshot({ path: path.join(output, `${name}-inset-0.png`) });
    if (name.startsWith('iphone')) {
      for (const inset of [47, 59]) {
        // Overrides the actual environment variable used by the production CSS.
        await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: { top: inset } });
        await page.evaluate(inset => {
          document.getElementById('simulated-status-bar')?.remove();
          const band = document.createElement('div');
          band.id = 'simulated-status-bar';
          band.setAttribute('aria-hidden', 'true');
          band.textContent = '9:41                 ●  ▰';
          Object.assign(band.style, { position: 'fixed', top: '0', left: '0', right: '0', height: `${inset}px`, zIndex: '9999', background: '#0f1730', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'space-around', font: '600 14px Arial', direction: 'ltr', pointerEvents: 'none' });
          document.body.append(band);
        }, inset);
        const result = await geometry(page);
        assert.equal(result.paddingTop - normal.paddingTop, inset, `${name}: exact safe-area padding`);
        for (const element of ['brand', 'account', 'header']) {
          assert.equal(result[element].y - normal[element].y, inset, `${name}: ${element} moves below inset`);
          assert.ok(result[element].y >= inset, `${name}: ${element} clears status band`);
          assert.equal(result[element].width, normal[element].width);
          assert.equal(result[element].height, normal[element].height);
        }
        assert.deepEqual(result.nav, normal.nav, `${name}: bottom nav unchanged`);
        assert.equal(result.overflow, false);
        manifest.checks.push({ name, inset, geometry: result });
        if (output) await page.screenshot({ path: path.join(output, `${name}-inset-${inset}.png`) });
      }
      await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: { top: 0 } });
      await page.evaluate(() => document.getElementById('simulated-status-bar').remove());
      assert.deepEqual(await geometry(page), normal, `${name}: inset reset restores original layout`);
    }
    assert.deepEqual(errors, []);
    console.log(`PASS ${name}: original zero-inset layout${name.startsWith('iphone') ? ', real CSS env() 47/59px simulation with status-band clearance' : ''}`);
  } finally { await context.close(); }
}
(async () => {
  if (output) fs.mkdirSync(output, { recursive: true });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}/vocab-app/`;
  browser = await chromium.launch({ args: ['--no-sandbox'], ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}) });
  const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1';
  const android = 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36';
  await checkDevice('iphone-390', 390, 844, iphone, true);
  await checkDevice('iphone-320', 320, 568, iphone, true);
  await checkDevice('android-390', 390, 844, android, true);
  await checkDevice('android-320', 320, 568, android, true);
  await checkDevice('desktop-1440', 1440, 1000, undefined, false);
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (output) fs.writeFileSync(path.join(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  if (browser) await browser.close();
  await new Promise(resolve => server.close(resolve));
});
