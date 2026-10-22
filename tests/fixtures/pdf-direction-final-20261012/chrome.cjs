const fs = require('node:fs/promises'), http = require('node:http'), crypto = require('node:crypto');
const { chromium } = require('/Users/ph.qian/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const out = 'tests/fixtures/pdf-direction-final-20261012';
const suite = process.argv[2] || 'copy';
if (!['copy', 'marked', 'page-order', 'page-order-full'].includes(suite)) throw Error('Unknown QA suite');
const collapse = s => s.replace(/\s+/gu, ' ').trim();
const compare = (e, a) => {
  e = collapse(e); a = collapse(a); let i = 0;
  while (i < Math.min(e.length, a.length) && e[i] === a[i]) i++;
  return { exactCollapsedMatch: e === a, firstDifference: i, expectedContext: e.slice(Math.max(0, i - 30), i + 120), actualContext: a.slice(Math.max(0, i - 30), i + 120) };
};
(async () => {
  try { await fs.access(out + '/' + suite + '.json'); throw Error('Refuse overwrite'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  const inputs = [];
  inputs.push(...JSON.parse(await fs.readFile(out + '/inputs.json')));
  const files = await Promise.all(inputs.map(async x => ({ ...x, bytes: await fs.readFile(x.file) })));
  const server = http.createServer((req, res) => {
    const m = /^\/(\d+)\.pdf$/.exec(req.url), input = m && files[Number(m[1])];
    if (!input) { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Length': input.bytes.length }); res.end(input.bytes);
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  let browser;
  const report = { at: new Date().toISOString(), scope: 'Official Chrome for Testing with disposable profile; stock plugin selectAll/getSelectedText, not OS clipboard. Existing PDFs unchanged.', results: [] };
  try {
    browser = await chromium.launch({ executablePath: 'tmp/pdf-chrome155-20261012/unpacked/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing', headless: true });
    report.version = browser.version();
    if (report.version !== '155.0.8059.39') throw Error('Unexpected browser version');
    const origin = 'http://127.0.0.1:' + server.address().port;
    for (const [i, input] of files.entries()) {
      const context = await browser.newContext({ viewport: { width: 1200, height: 1100 } });
      const result = { label: input.label, file: input.file, sha256: crypto.createHash('sha256').update(input.bytes).digest('hex'), expected: input.sourceText };
      try {
        await context.route('http{,s}://**/*', r => new URL(r.request().url()).origin === origin ? r.continue() : r.abort());
        const page = await context.newPage(); await page.goto(origin + '/' + i + '.pdf');
        let frame;
        for (let j = 0; j < 60; j++) { frame = page.frames().find(f => f.url().startsWith('chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/')); if (frame) break; await page.waitForTimeout(100); }
        if (!frame) throw Error('Stock PDF viewer absent');
        await frame.waitForFunction(() => document.querySelector('pdf-viewer')?.loadState_ === 'success', null, { timeout: 20000 });
        const selected = await frame.evaluate(async () => {
          const v = document.querySelector('pdf-viewer'); v.pluginController_.selectAll();
          return Promise.race([v.pluginController_.getSelectedText(), new Promise((_, reject) => setTimeout(() => reject(Error('Selection timeout')), 10000))]);
        });
        if (!selected.selectedText) throw Error('No text selected');
        result.actual = selected.selectedText;
        result.full = compare(input.sourceText, result.actual);
        result.body = compare(input.sourceText, result.actual.replace(/^VDoc system acceptance [^\n]*\n/gm, '').replace(/^Local document acceptance \d+ \/ \d+\n/gm, ''));
        await page.screenshot({ path: out + '/' + suite + '-' + input.label + '.png' });
      } catch (e) { result.error = e.stack; }
      finally { report.results.push(result); await context.close(); }
      console.log(JSON.stringify({ label: result.label, match: result.full?.exactCollapsedMatch, body: result.body?.exactCollapsedMatch, error: result.error }));
    }
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); await fs.writeFile(out + '/' + suite + '.json', JSON.stringify(report, null, 2), { flag: 'wx' }); }
  if (report.results.some(r => r.error)) process.exitCode = 1;
})().catch(e => { console.error(e); process.exitCode = 1; });
