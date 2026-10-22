// QA only. Unmodified official demo assets, local existing PDFs, no OS clipboard.
const fs = require('node:fs/promises');
const crypto = require('node:crypto');
const { chromium } = require('/Users/ph.qian/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const out = 'tests/fixtures/pdf-direction-space-20261012';
const root = 'tmp/pdf-reader-upstream-20261012';
const suite = process.argv[2] || 'demo';
if (!['demo', 'repaired', 'repaired-ready'].includes(suite)) throw Error('Unknown QA suite');
const collapse = s => s.replace(/\s+/gu, ' ').trim();
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
(async () => {
  try { await fs.access(out + '/' + suite + '-results.json'); throw Error('Refuse overwrite'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  let inputs = suite === 'demo' ? [...JSON.parse(await fs.readFile('tests/fixtures/local-pdf-production-20261012/readers/inputs.json')),
    ...JSON.parse(await fs.readFile('tests/fixtures/pdf-libreoffice-20261012/explicit-fonts/inputs.json'))] : [
      { label: 'upstream-td', file: root + '/upstream-td.pdf', sourceText: 'सप्रणाम' },
      ...JSON.parse(await fs.readFile('tests/fixtures/pdf-direct-readers-20261012/inputs.json'))];
  if (suite === 'repaired-ready') inputs = inputs.filter(x => x.label.startsWith('flow-'));
  inputs = JSON.parse(await fs.readFile(out + '/inputs.json'));
  const assetNames = { '/web/viewer.html': 'viewer.html', '/web/viewer.mjs': 'viewer.mjs', '/web/viewer.css': 'viewer.css', '/build/pdf.mjs': 'demo-pdf.mjs', '/build/pdf.worker.mjs': 'demo-worker.mjs' };
  const assets = {};
  const report = { at: new Date().toISOString(), scope: 'Unmodified official online demo 6.5.128. DOM Range selection and official copy handler via synthetic in-memory ClipboardEvent, not native clipboard acceptance.', assets: [], results: [] };
  for (const [url, name] of Object.entries(assetNames)) {
    const bytes = await fs.readFile(root + '/' + name); assets[url] = bytes;
    if (name.endsWith('.mjs') && (!bytes.includes('pdfjsVersion = 6.5.128') || !bytes.includes('pdfjsBuild = e1412d3a5'))) throw Error('Mixed official build');
    report.assets.push({ url: 'https://mozilla.github.io/pdf.js' + url, local: root + '/' + name, sha256: sha(bytes) });
  }
  const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
  report.browser = browser.version();
  try {
    for (const input of inputs) {
      const bytes = await fs.readFile(input.file);
      const context = await browser.newContext({ viewport: { width: 1200, height: 1100 } });
      const errors = [], missing = [];
      const result = { ...input, sha256: sha(bytes), errors, missing };
      try {
        await context.route('**/*', async route => {
          const u = new URL(route.request().url());
          if (u.origin !== 'http://127.0.0.1:4194') throw Error('External request refused: ' + u.origin);
          if (u.pathname === '/input.pdf') return route.fulfill({ contentType: 'application/pdf', body: bytes });
          if (assets[u.pathname]) return route.fulfill({ contentType: u.pathname.endsWith('.mjs') ? 'text/javascript' : u.pathname.endsWith('.css') ? 'text/css' : 'text/html', body: assets[u.pathname] });
          missing.push(u.pathname); return route.fulfill({ status: 404, body: '' });
        });
        const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
        await page.goto('http://127.0.0.1:4194/web/viewer.html?file=%2Finput.pdf');
        await page.waitForFunction(() => window.PDFViewerApplication?.pdfDocument?.numPages > 0, null, { timeout: 20000 });
        result.pages = await page.evaluate(() => PDFViewerApplication.pdfDocument.numPages);
        result.copies = []; result.rawSelections = []; result.items = [];
        for (let index = 0; index < result.pages; index++) {
          await page.evaluate(i => { PDFViewerApplication.page = i + 1; }, index);
          // The official handler is attached after all text spans are rendered.
          await page.waitForFunction(i => PDFViewerApplication.pdfViewer.getPageView(i)?.textLayer?.div?.querySelector('.endOfContent'), index, { timeout: 20000 });
          const r = await page.evaluate(async i => {
            const view = PDFViewerApplication.pdfViewer.getPageView(i);
            await document.fonts.ready;
            const layer = view.textLayer.div, selection = getSelection(), range = document.createRange();
            range.selectNodeContents(layer); selection.removeAllRanges(); selection.addRange(range);
            const raw = selection.toString(), data = new DataTransfer();
            const event = new ClipboardEvent('copy', { bubbles: true, cancelable: true, clipboardData: data });
            layer.dispatchEvent(event);
            if (!event.defaultPrevented || !data.types.includes('text/plain')) throw Error('Official copy handler absent');
            selection.removeAllRanges();
            const content = await (await PDFViewerApplication.pdfDocument.getPage(i + 1)).getTextContent();
            return { raw, copied: data.getData('text/plain'), items: content.items.map(x => ({ str: x.str, width: x.width, dir: x.dir })) };
          }, index);
          result.copies.push(r.copied); result.rawSelections.push(r.raw); result.items.push(r.items);
        }
        result.copiedText = result.copies.join('\n');
        result.exactCollapsedMatch = collapse(input.sourceText) === collapse(result.copiedText);
        result.hindiWholeWord = result.copiedText.includes('हिन्दी');
        await page.screenshot({ path: out + '/' + suite + '-' + input.label + '.png' });
      } catch (e) { result.error = e.stack; }
      finally { report.results.push(result); await context.close(); }
      console.log(JSON.stringify({ label: input.label, match: result.exactCollapsedMatch, hindiWholeWord: result.hindiWholeWord, error: result.error, errors }));
    }
  } finally { await browser.close(); await fs.writeFile(out + '/' + suite + '-results.json', JSON.stringify(report, null, 2), { flag: 'wx' }); }
  if (report.results.some(r => r.error)) process.exitCode = 1;
})().catch(e => { console.error(e); process.exitCode = 1; });
