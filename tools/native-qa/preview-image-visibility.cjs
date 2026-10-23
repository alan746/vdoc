const { qaPath } = require('../qa-paths.cjs');
// Owned Chrome pages and local fixture images only. Visibility is controlled;
// this checks real image requests/decoding, not native tab or Safari behavior.
const fs = require('node:fs/promises');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { transformSync } = require('esbuild');
const { chromium } = require('/Users/ph.qian/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const out = qaPath('preview-image-visibility-20261011');
const origin = 'http://127.0.0.1:4194';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j6XcAAAAASUVORK5CYII=', 'base64');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

(async () => {
  const destination = `${out}/browser.json`;
  try { await fs.access(destination); throw Error('Refuse overwrite browser evidence'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const source = await fs.readFile('lib/infrastructure/preview/preview-images.ts', 'utf8');
  const bundle = transformSync(source, { loader: 'ts', format: 'iife', globalName: 'ImageWait' }).code;
  const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
  const results = [], requests = [];
  try {
    const context = await browser.newContext();
    for (const scenario of ['hidden-load', 'resume-budget', 'hidden-error', 'hidden-abort', 'visible-timeout']) {
      const page = await context.newPage(); let imageRoute;
      try {
        await page.route('**/*', async route => {
          const url = new URL(route.request().url()); requests.push({ scenario, url: url.href });
          if (url.origin !== origin) return route.abort();
          if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>VDoc image wait QA</title><main></main>' });
          if (url.pathname === '/image.png') { imageRoute = route; return; }
          return route.abort();
        });
        await page.goto(origin);
        await page.addScriptTag({ content: bundle });
        await page.evaluate(({ hidden }) => {
          window.qaHidden = hidden;
          Object.defineProperty(document, 'hidden', { configurable: true, get: () => window.qaHidden });
          window.setQAVisibility = hidden => { window.qaHidden = hidden; document.dispatchEvent(new Event('visibilitychange')); };
          const root = document.querySelector('main'), image = document.createElement('img');
          image.src = '/image.png'; root.append(image);
          window.controller = new AbortController(); window.outcome = { state: 'pending' };
          window.started = performance.now();
          ImageWait.waitForPreviewImages(root, window.controller.signal, 500).then(
            () => window.outcome = { state: 'resolved', width: image.naturalWidth, height: image.naturalHeight },
            error => window.outcome = { state: 'rejected', name: error.name, message: error.message });
        }, { hidden: scenario.startsWith('hidden-') });
        for (let i = 0; !imageRoute && i < 40; i++) await page.waitForTimeout(25);
        assert.ok(imageRoute, 'Own image request missing');
        const checks = [];
        const state = () => page.evaluate(() => window.outcome);
        if (scenario === 'hidden-load') {
          await page.waitForTimeout(700); checks.push(await state()); assert.equal(checks.at(-1).state, 'pending');
          await page.evaluate(() => window.setQAVisibility(false));
          await imageRoute.fulfill({ contentType: 'image/png', body: png }); imageRoute = null;
          await page.waitForFunction(() => window.outcome.state !== 'pending');
          checks.push(await state()); assert.equal(checks.at(-1).state, 'resolved'); assert.equal(checks.at(-1).width, 1);
        } else if (scenario === 'resume-budget') {
          await page.waitForTimeout(150);
          await page.evaluate(() => window.setQAVisibility(true));
          await page.waitForTimeout(700); checks.push(await state()); assert.equal(checks.at(-1).state, 'pending');
          await page.evaluate(() => window.setQAVisibility(false));
          await page.waitForFunction(() => window.outcome.state !== 'pending');
          checks.push(await state()); assert.match(checks.at(-1).message, /taking too long/);
        } else if (scenario === 'hidden-error') {
          await imageRoute.fulfill({ status: 404, body: '' }); imageRoute = null;
          await page.waitForFunction(() => window.outcome.state !== 'pending');
          checks.push(await state()); assert.match(checks.at(-1).message, /Image 1 could not be loaded/);
        } else if (scenario === 'hidden-abort') {
          await page.evaluate(() => window.controller.abort());
          await page.waitForFunction(() => window.outcome.state !== 'pending');
          checks.push(await state()); assert.equal(checks.at(-1).name, 'AbortError');
          await page.evaluate(() => window.setQAVisibility(false));
          await imageRoute.fulfill({ contentType: 'image/png', body: png }); imageRoute = null;
          await page.waitForFunction(() => document.querySelector('img').naturalWidth === 1);
          checks.push(await state()); assert.deepEqual(checks.at(-1), checks[0]);
        } else {
          await page.waitForFunction(() => window.outcome.state !== 'pending');
          checks.push(await state()); assert.match(checks.at(-1).message, /taking too long/);
        }
        results.push({ scenario, passed: true, checks });
      } catch (error) {
        results.push({ scenario, passed: false, error: error.message });
      } finally {
        if (imageRoute) await imageRoute.abort().catch(() => {});
        await page.close();
      }
    }
    await fs.writeFile(destination, JSON.stringify({ at: new Date().toISOString(), browser: browser.version(),
      sourceSha256: sha(source), toolSha256: sha(await fs.readFile(__filename)),
      scope: 'Real owned Chrome image loading/decoding with controlled document.hidden and visibilitychange. Not native background-tab/Safari or printing acceptance.',
      requests, results }, null, 2) + '\n');
    console.log(JSON.stringify(results));
    assert.ok(results.every(result => result.passed));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
